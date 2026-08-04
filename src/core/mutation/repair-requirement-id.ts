import { readFile, stat, writeFile } from "node:fs/promises";
import { diagnostic, summarizeDiagnostics } from "../diagnostic.js";
import { createTextFileSnapshot } from "../fs/read-text.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation, type PatchPlan } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { validateWorkspace } from "../validator/validate-workspace.js";
import type { Diagnostic, MutationEnvelope, MutationResult, ParsedWorkspace, ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { assertSingleLine } from "./block-prose.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withMutationEnvelope } from "./envelope.js";
import { withSrsMutationLock } from "./srs-lock.js";

export interface RequirementOccurrenceIdentity {
  filePath: string;
  headingLine: number;
  blockHash: string;
}

export interface RequirementIdCollisionRepairPlanInput {
  duplicateId: string;
  keep: RequirementOccurrenceIdentity;
  rename: RequirementOccurrenceIdentity;
  replacementId?: string;
  allocationStrategy?: "next_available";
  referenceEdits?: Array<{ filePath: string; line: number; from: string; to: string }>;
  dryRun?: boolean;
}

export interface RequirementIdCollisionRepairApplyInput extends RequirementIdCollisionRepairPlanInput {
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface RequirementIdCollisionGroup {
  duplicateId: string;
  occurrences: RequirementOccurrenceIdentity[];
  candidateReplacementIds: string[];
  ambiguousReferences: Array<{ filePath: string; line: number; excerpt: string }>;
  repairReady: boolean;
  conflictMarkers: boolean;
  diagnostic: Diagnostic;
}

export interface RequirementIdCollisionRepairPlan {
  duplicateId: string;
  keep: RequirementOccurrenceIdentity;
  rename: RequirementOccurrenceIdentity;
  replacementId: string;
  referenceEdits: Array<{ filePath: string; line: number; from: string; to: string }>;
  touchedFiles: string[];
  operations: Array<{ filePath: string; line: number; original?: string; replacement: string }>;
  ambiguousReferences: Array<{ filePath: string; line: number; excerpt: string }>;
  pendingDuplicateGroups: string[];
  written: false;
}

export interface RequirementIdCollisionRepairOutput {
  duplicateId: string;
  replacementId: string;
  touchedFiles: string[];
  written: boolean;
  completedOperations: number;
  pendingOperations: number;
  pendingDuplicateGroups: string[];
  pendingRepair?: RequirementIdCollisionRepairPlan;
}

interface DuplicateDiagnosticDetails {
  duplicateId?: string;
  occurrences?: Array<{
    filePath?: unknown;
    headingLine?: unknown;
    blockHash?: unknown;
  }>;
}

function duplicateDiagnostics(workspace: ParsedWorkspace): Diagnostic[] {
  return validateWorkspace(workspace).diagnostics.filter((item) => item.code === "SRS-E002");
}

function toGroups(workspace: ParsedWorkspace, diagnostics: Diagnostic[]): RequirementIdCollisionGroup[] {
  const conflictMarkers = hasConflictMarkers(workspace);
  return diagnostics.flatMap((item) => {
    const details = item.details as DuplicateDiagnosticDetails | undefined;
    if (typeof details?.duplicateId !== "string" || !Array.isArray(details.occurrences)) return [];
    const occurrences = details.occurrences.flatMap((occurrence) => {
      if (typeof occurrence.filePath !== "string" || typeof occurrence.headingLine !== "number" || typeof occurrence.blockHash !== "string") return [];
      return [{ filePath: occurrence.filePath, headingLine: occurrence.headingLine, blockHash: occurrence.blockHash }];
    });
    const candidate = allocateNextId(workspace, details.duplicateId);
    const ambiguous = findInboundReferences(workspace, details.duplicateId, occurrences);
    return [
      {
        duplicateId: details.duplicateId,
        occurrences,
        candidateReplacementIds: candidate ? [candidate] : [],
        ambiguousReferences: ambiguous,
        repairReady: !conflictMarkers && occurrences.length > 1,
        conflictMarkers,
        diagnostic: item
      }
    ];
  });
}

function sameOccurrence(left: RequirementOccurrenceIdentity, right: RequirementOccurrenceIdentity): boolean {
  return left.filePath === right.filePath && left.headingLine === right.headingLine && left.blockHash === right.blockHash;
}

function findRecord(workspace: ParsedWorkspace, occurrence: RequirementOccurrenceIdentity): RequirementRecord | undefined {
  return workspace.records.find((record) => record.filePath === occurrence.filePath && record.headingLine === occurrence.headingLine);
}

function findFile(workspace: ParsedWorkspace, relativePath: string): TextFile | undefined {
  return workspace.files.find((file) => file.relativePath === relativePath);
}

function hasConflictMarkers(workspace: ParsedWorkspace): boolean {
  return workspace.files.some((file) => /^(<<<<<<<|=======|>>>>>>>)($|\s)/m.test(file.text));
}

function prefixBase(id: string): string | null {
  const match = /^([A-Z]+-[A-Z]+-)(\d{3,4})$/.exec(id);
  return match?.[1] ?? null;
}

function allocateNextId(workspace: ParsedWorkspace, duplicateId: string): string | null {
  const base = prefixBase(duplicateId);
  if (!base) return null;
  const used = workspace.records
    .map((record) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{3,4})$`).exec(record.id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number.parseInt(value, 10));
  return `${base}${String(Math.max(0, ...used) + 1).padStart(3, "0")}`;
}

function explicitReferenceKey(edit: { filePath: string; line: number }): string {
  return `${edit.filePath}:${edit.line}`;
}

function findInboundReferences(
  workspace: ParsedWorkspace,
  duplicateId: string,
  occurrences: RequirementOccurrenceIdentity[],
  explicitEdits: Array<{ filePath: string; line: number }> = []
): Array<{ filePath: string; line: number; excerpt: string }> {
  const headingKeys = new Set(occurrences.map((occurrence) => explicitReferenceKey({ filePath: occurrence.filePath, line: occurrence.headingLine })));
  const explicit = new Set(explicitEdits.map(explicitReferenceKey));
  const references: Array<{ filePath: string; line: number; excerpt: string }> = [];
  for (const file of workspace.files) {
    file.lines.forEach((line, index) => {
      if (!line.includes(duplicateId)) return;
      const lineNo = index + 1;
      const key = explicitReferenceKey({ filePath: file.relativePath, line: lineNo });
      if (headingKeys.has(key) || explicit.has(key)) return;
      references.push({ filePath: file.relativePath, line: lineNo, excerpt: line.trim().slice(0, 160) });
    });
  }
  return references.sort((left, right) => left.filePath.localeCompare(right.filePath) || left.line - right.line);
}

function resolveReplacementId(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput, renameRecord: RequirementRecord): MutationResult<string> {
  const replacementId = input.replacementId ?? (input.allocationStrategy === "next_available" ? allocateNextId(workspace, input.duplicateId) : null);
  if (!replacementId) return mutationFail("MUTATION_DENIED", "replacementId or allocationStrategy=next_available is required");
  if (!prefixBase(replacementId)) return mutationFail("MUTATION_DENIED", `Invalid replacement Requirement ID: ${replacementId}`);
  const colliding = workspace.records.find((record) => record.id === replacementId && record !== renameRecord);
  if (colliding) {
    const collision = diagnostic("SRS-E032", "error", `Generated replacement Requirement ID already exists: ${replacementId}`, { filePath: colliding.filePath, line: colliding.headingLine }, { replacementId });
    return mutationFail("GENERATED_ID_COLLISION", `Replacement Requirement ID already exists: ${replacementId}`, [collision]);
  }
  return mutationOk(replacementId);
}

function validateReferenceEdits(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput): MutationResult | undefined {
  for (const edit of input.referenceEdits ?? []) {
    // The write is `line.replace(from, to)` and the only other check is that the line contains
    // `from`. A `to` carrying a newline therefore writes whatever follows it at column zero of a
    // spec file: measured landing `| Status | verified |` plus an unclosed fence through a repair
    // that is supposed to renumber an identifier, with no acceptance-criterion, evidence or
    // stability gate anywhere in its path. A reference edit replaces text inside one line.
    const oneLine = assertSingleLine<RequirementIdCollisionRepairOutput>(`referenceEdits[${edit.filePath}:${edit.line}].to`, edit.to);
    if (oneLine) return oneLine;
    const file = findFile(workspace, edit.filePath);
    const line = file?.lines[edit.line - 1];
    if (!file || line === undefined || !line.includes(edit.from)) {
      const message = `Explicit reference edit is stale for ${edit.filePath}:${edit.line}`;
      return mutationFail("STALE_PATCH", message, [diagnostic("SRS-E032", "error", message, { filePath: edit.filePath, line: edit.line })], {
        staleGuard: { filePath: edit.filePath, retry: "rerun repair requirement-id-collisions plan" }
      });
    }
  }
  return undefined;
}

function ambiguousReferences(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput, groupOccurrences: RequirementOccurrenceIdentity[]): Array<{ filePath: string; line: number; excerpt: string }> {
  const occurrenceHeadingKeys = new Set(groupOccurrences.map((occurrence) => explicitReferenceKey({ filePath: occurrence.filePath, line: occurrence.headingLine })));
  const references: Array<{ filePath: string; line: number; excerpt: string }> = [];
  for (const file of workspace.files) {
    file.lines.forEach((line, index) => {
      if (!line.includes(input.duplicateId)) return;
      const lineNo = index + 1;
      if (occurrenceHeadingKeys.has(explicitReferenceKey({ filePath: file.relativePath, line: lineNo }))) return;
      const inRenamedBlock = file.relativePath === input.rename.filePath && lineNo >= input.rename.headingLine;
      const isHeading = /^###\s+/.test(line);
      if (inRenamedBlock && isHeading && lineNo === input.rename.headingLine) return;
      if (file.relativePath === input.keep.filePath && lineNo === input.keep.headingLine) return;
      if (file.relativePath === input.rename.filePath && lineNo >= input.rename.headingLine && lineNo <= input.rename.headingLine + 120 && /^\|\s*Requirement\s*\|/.test(line)) return;
      references.push({ filePath: file.relativePath, line: lineNo, excerpt: line.trim().slice(0, 160) });
    });
  }
  const explicit = new Set((input.referenceEdits ?? []).map((item) => `${item.filePath}:${item.line}`));
  return references.filter((item) => !explicit.has(`${item.filePath}:${item.line}`));
}

function requirementBlockEndLine(file: TextFile, headingLine: number): number {
  const nextHeadingIndex = file.lines.findIndex((line, index) => index + 1 > headingLine && /^###\s+/.test(line));
  return nextHeadingIndex >= 0 ? nextHeadingIndex : file.lines.length;
}

function buildRenameOperations(file: TextFile, input: RequirementIdCollisionRepairPlanInput, replacementId: string): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const headingLine = file.lines[input.rename.headingLine - 1] ?? "";
  operations.push({
    type: "replaceLine",
    line: input.rename.headingLine,
    original: headingLine,
    replacement: headingLine.replace(input.duplicateId, replacementId)
  });
  const endLine = requirementBlockEndLine(file, input.rename.headingLine);
  for (let lineNo = input.rename.headingLine + 1; lineNo <= endLine; lineNo += 1) {
    const line = file.lines[lineNo - 1] ?? "";
    if (/^\|\s*Requirement\s*\|/.test(line) && line.includes(input.duplicateId)) {
      operations.push({ type: "replaceLine", line: lineNo, original: line, replacement: line.replace(input.duplicateId, replacementId) });
    }
  }
  return operations;
}

function buildOperationsByFile(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput, replacementId: string): Map<TextFile, PatchOperation[]> {
  const operationsByPath = new Map<string, PatchOperation[]>();
  const renameFile = findFile(workspace, input.rename.filePath);
  if (renameFile) {
    operationsByPath.set(renameFile.relativePath, buildRenameOperations(renameFile, input, replacementId));
  }
  for (const edit of input.referenceEdits ?? []) {
    const operations = operationsByPath.get(edit.filePath) ?? [];
    operationsByPath.set(edit.filePath, operations);
  }

  const result = new Map<TextFile, PatchOperation[]>();
  for (const [filePath, operations] of operationsByPath.entries()) {
    const file = findFile(workspace, filePath);
    if (!file) continue;
    const fileOperations = operations.length > 0 ? operations : [];
    for (const edit of input.referenceEdits ?? []) {
      if (edit.filePath !== file.relativePath) continue;
      const line = file.lines[edit.line - 1] ?? "";
      fileOperations.push({ type: "replaceLine", line: edit.line, original: line, replacement: line.replace(edit.from, edit.to) });
    }
    result.set(file, fileOperations);
  }
  return result;
}

function repairEnvelope(plans: PatchPlan[], dryRun: boolean, written: boolean): MutationEnvelope {
  return {
    kind: "repair_requirement_id_collision",
    filePath: plans.length === 1 ? plans[0]!.file.relativePath : "<multiple>",
    dryRun,
    written,
    operations: plans.flatMap((plan) =>
      plan.operations.map((operation) => ({
        type: operation.type,
        ...("line" in operation ? { line: operation.line } : {}),
        ...("original" in operation && operation.original !== undefined ? { original: operation.original } : {}),
        ...("replacement" in operation ? { replacement: operation.replacement } : {})
      }))
    ),
    preview: plans.flatMap((plan) => plan.operations.flatMap((operation) => ("replacement" in operation ? [operation.replacement] : [])))
  };
}

async function assertFreshPlans(plans: PatchPlan[]): Promise<void> {
  for (const plan of plans) {
    const expected = plan.file.snapshot ?? createTextFileSnapshot(plan.file.text);
    const [text, stats] = await Promise.all([readFile(plan.file.path, "utf8"), stat(plan.file.path)]);
    const current = createTextFileSnapshot(text, stats);
    if (expected.sha256 !== current.sha256 || expected.size !== current.size) {
      throw new Error(`STALE_PATCH:${plan.file.relativePath}`);
    }
  }
}

export async function diagnoseRequirementIdCollisions(root: ProjectRoot): Promise<{
  ok: true;
  value: { groups: RequirementIdCollisionGroup[]; written: false };
  diagnostics: Diagnostic[];
  diagnosticsSummary: ReturnType<typeof summarizeDiagnostics>;
}> {
  const workspace = await parseWorkspace(root);
  const diagnostics = duplicateDiagnostics(workspace);
  return { ok: true, value: { groups: toGroups(workspace, diagnostics), written: false }, diagnostics, diagnosticsSummary: summarizeDiagnostics(diagnostics) };
}

export async function planRequirementIdCollisionRepair(root: ProjectRoot, input: RequirementIdCollisionRepairPlanInput): Promise<MutationResult<RequirementIdCollisionRepairPlan>> {
  const workspace = await parseWorkspace(root);
  if (hasConflictMarkers(workspace)) return mutationFail("MUTATION_DENIED", "Resolve Git conflict markers before planning Requirement ID collision repair");
  const groups = toGroups(workspace, duplicateDiagnostics(workspace));
  const group = groups.find((item) => item.duplicateId === input.duplicateId);
  if (!group) return mutationFail("AMBIGUOUS_REQUIREMENT_DUPLICATE", `No duplicate Requirement ID group selected: ${input.duplicateId}`);
  if (!group.occurrences.some((occurrence) => sameOccurrence(occurrence, input.keep)) || !group.occurrences.some((occurrence) => sameOccurrence(occurrence, input.rename))) {
    return mutationFail("STALE_PATCH", "Duplicate occurrence identity is stale or not part of the selected duplicate group", [
      diagnostic("SRS-E032", "error", "Duplicate occurrence identity is stale", { filePath: input.rename.filePath }, { duplicateId: input.duplicateId })
    ]);
  }
  if (sameOccurrence(input.keep, input.rename)) return mutationFail("MUTATION_DENIED", "keep and rename occurrences must be different");
  const renameRecord = findRecord(workspace, input.rename);
  const file = findFile(workspace, input.rename.filePath);
  if (!renameRecord || !file) return mutationFail("STALE_PATCH", "Selected rename occurrence no longer exists");
  const replacement = resolveReplacementId(workspace, input, renameRecord);
  if (!replacement.ok || !replacement.value) {
    return mutationFail(
      replacement.error?.code ?? "MUTATION_DENIED",
      replacement.error?.message ?? "Requirement ID collision repair could not resolve a replacement ID",
      replacement.diagnostics,
      replacement.error?.staleGuard ? { staleGuard: replacement.error.staleGuard } : {}
    );
  }
  const staleReferenceEdit = validateReferenceEdits(workspace, input);
  if (staleReferenceEdit) {
    return mutationFail(
      staleReferenceEdit.error?.code ?? "STALE_PATCH",
      staleReferenceEdit.error?.message ?? "Explicit reference edit is stale",
      staleReferenceEdit.diagnostics,
      staleReferenceEdit.error?.staleGuard ? { staleGuard: staleReferenceEdit.error.staleGuard } : {}
    );
  }
  const ambiguous = ambiguousReferences(workspace, input, group.occurrences);
  const operationsByFile = buildOperationsByFile(workspace, input, replacement.value);
  const operations = [...operationsByFile.entries()].flatMap(([operationFile, fileOperations]) =>
    fileOperations.map((operation) => ({
      filePath: operationFile.relativePath,
      line: "line" in operation ? operation.line : 0,
      ...("original" in operation && operation.original !== undefined ? { original: operation.original } : {}),
      replacement: "replacement" in operation ? operation.replacement : ""
    }))
  );
  const touchedFiles = [...operationsByFile.keys()].map((operationFile) => operationFile.relativePath).sort();
  const pendingDuplicateGroups = groups.filter((item) => item.duplicateId !== input.duplicateId).map((item) => item.duplicateId);
  return mutationOk({
    duplicateId: input.duplicateId,
    keep: input.keep,
    rename: input.rename,
    replacementId: replacement.value,
    referenceEdits: input.referenceEdits ?? [],
    touchedFiles,
    operations,
    ambiguousReferences: ambiguous,
    pendingDuplicateGroups,
    written: false
  });
}

export async function applyRequirementIdCollisionRepair(root: ProjectRoot, input: RequirementIdCollisionRepairApplyInput): Promise<MutationResult<RequirementIdCollisionRepairOutput>> {
  return withSrsMutationLock(root, { operation: "repair_requirement_id_collision", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, async () => {
    const planned = await planRequirementIdCollisionRepair(root, input);
    if (!planned.ok && planned.error?.code === "AMBIGUOUS_REQUIREMENT_DUPLICATE" && input.replacementId) {
      const workspace = await parseWorkspace(root);
      const file = findFile(workspace, input.rename.filePath);
      const line = file?.lines[input.rename.headingLine - 1] ?? "";
      if (line.includes(input.replacementId)) {
        return withMutationEnvelope(
          mutationOk<RequirementIdCollisionRepairOutput>({
            duplicateId: input.duplicateId,
            replacementId: input.replacementId,
            touchedFiles: [],
            written: false,
            completedOperations: 0,
            pendingOperations: 0,
            pendingDuplicateGroups: []
          }),
          { kind: "repair_requirement_id_collision", filePath: "<none>", dryRun: input.dryRun ?? false, written: false, operations: [], preview: [] },
          { filePath: "<none>", operations: 0, dryRun: input.dryRun ?? false, preview: [] }
        );
      }
    }
    if (!planned.ok || !planned.value) {
      return mutationFail(
        planned.error?.code ?? "MUTATION_DENIED",
        planned.error?.message ?? "Requirement ID collision repair planning failed",
        planned.diagnostics,
        planned.error?.staleGuard ? { staleGuard: planned.error.staleGuard } : {}
      );
    }
    const plan = planned.value;
    if (plan.ambiguousReferences.length > 0) {
      return mutationFail("AMBIGUOUS_REFERENCE", "Ambiguous inbound references require explicit reference edits", [
        diagnostic("SRS-E076", "error", "Ambiguous Requirement ID references require explicit edits", {}, { ambiguousReferences: plan.ambiguousReferences })
      ]);
    }
    const workspace = await parseWorkspace(root);
    const operationsByFile = buildOperationsByFile(workspace, input, plan.replacementId);
    const patchPlans = [...operationsByFile.entries()].map(([file, operations]) => createPatchPlan(file, operations));
    if (patchPlans.length === 0) return mutationFail("STALE_PATCH", "Requirement ID collision repair has no patchable files");
    try {
      if (!input.dryRun) await assertFreshPlans(patchPlans);
      const patches = [];
      for (const patchPlan of patchPlans) {
        patches.push(await applyPatchPlan(patchPlan, { dryRun: input.dryRun ?? false }));
      }
      const written = patches.some((patch) => patch.written);
      const postWorkspace = input.dryRun ? workspace : await parseWorkspace(root);
      const postGroups = toGroups(postWorkspace, duplicateDiagnostics(postWorkspace));
      const replacementCollision = postGroups.find((group) => group.duplicateId === plan.replacementId);
      if (replacementCollision) {
        return mutationFail("GENERATED_ID_COLLISION", `Replacement Requirement ID still collides after repair: ${plan.replacementId}`, [replacementCollision.diagnostic]);
      }
      const pendingDuplicateGroups = postGroups.map((group) => group.duplicateId).sort();
      const result = mutationOk<RequirementIdCollisionRepairOutput>({
        duplicateId: input.duplicateId,
        replacementId: plan.replacementId,
        touchedFiles: plan.touchedFiles,
        written,
        completedOperations: written ? plan.operations.length : 0,
        pendingOperations: written ? 0 : plan.operations.length,
        pendingDuplicateGroups,
        ...(!written || pendingDuplicateGroups.length > 0 ? { pendingRepair: { ...plan, pendingDuplicateGroups } } : {})
      });
      return withMutationEnvelope(result, repairEnvelope(patchPlans, input.dryRun ?? false, written), {
        filePath: patchPlans.length === 1 ? patchPlans[0]!.file.relativePath : "<multiple>",
        operations: patchPlans.reduce((sum, patchPlan) => sum + patchPlan.operations.length, 0),
        dryRun: input.dryRun ?? false,
        preview: patches.flatMap((patch) => patch.preview)
      });
    } catch (error) {
      if (isStalePatchError(error)) {
        return mutationFail("STALE_PATCH", "Requirement ID collision repair snapshot is stale", [diagnostic("SRS-E032", "error", "Requirement ID collision repair snapshot is stale", { filePath: (error as { filePath?: string }).filePath ?? input.rename.filePath })], {
          staleGuard: { filePath: input.rename.filePath, retry: "rerun repair requirement-id-collisions plan" }
        });
      }
      if (error instanceof Error && error.message.startsWith("STALE_PATCH:")) {
        const filePath = error.message.slice("STALE_PATCH:".length);
        return mutationFail("STALE_PATCH", "Requirement ID collision repair snapshot is stale", [diagnostic("SRS-E032", "error", "Requirement ID collision repair snapshot is stale", { filePath })], {
          staleGuard: { filePath, retry: "rerun repair requirement-id-collisions plan" }
        });
      }
      throw error;
    }
  });
}

export async function writeRequirementIdCollisionRepairPlan(filePath: string, plan: RequirementIdCollisionRepairPlan): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

export async function readRequirementIdCollisionRepairPlan(filePath: string): Promise<RequirementIdCollisionRepairPlanInput> {
  const plan = JSON.parse(await readFile(filePath, "utf8")) as RequirementIdCollisionRepairPlan;
  return {
    duplicateId: plan.duplicateId,
    keep: plan.keep,
    rename: plan.rename,
    replacementId: plan.replacementId,
    referenceEdits: plan.referenceEdits
  };
}
