import path from "node:path";
import { diagnostic, summarizeDiagnostics } from "../diagnostic.js";
import { readUtf8File } from "../fs/read-text.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { isCanonicalStability, isKnownStability, isRequirementType } from "../schema.js";
import type { Diagnostic, MutationResult, ParsedWorkspace, Priority, ProjectRoot, RequirementRecord, RequirementType, Risk, Stability, TextFile } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { getWorkMode } from "./work-mode.js";
import { mutationEnvelopeFromPlan } from "./envelope.js";
import { DEFAULT_REQUIREMENT_STABILITY, prefixForType, renderRequirementBlock, type RenderRequirementInput } from "./render-requirement.js";
import { assertSafeMarkdownTableCell, assertSafeMarkdownTableCells } from "./table-cell.js";
import { syncIndexRollups } from "./sync-index.js";
import { allocateRequirementIdFromStatusCache } from "../status-cache.js";
import { withSrsMutationLock } from "./srs-lock.js";

export interface AddRequirementInput extends Omit<RenderRequirementInput, "id" | "type" | "target"> {
  type: RequirementType;
  scope: string;
  target?: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface AddRequirementOutput {
  requirementId: string;
  filePath: string;
  written: boolean;
  targetSource: "explicit" | "active-target";
  record: RequirementRecord;
}

type ResolvedAddRequirementInput = AddRequirementInput & { target: string };

export function generateNextRequirementId(workspace: ParsedWorkspace, type: RequirementType, scopePrefix: string): string {
  const prefix = prefixForType(type);
  const used = workspace.records
    .map((record) => new RegExp(`^${prefix}-${scopePrefix}-(\\d{3,4})$`).exec(record.id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number.parseInt(value, 10));
  return `${prefix}-${scopePrefix}-${String((Math.max(0, ...used) || 0) + 1).padStart(3, "0")}`;
}

function canBeVerified(input: AddRequirementInput): boolean {
  if (input.status !== "verified") return true;
  const acCount = input.acceptanceCriteria.length;
  const checked = new Set(input.checkedAcceptanceCriteria ?? []);
  return acCount > 0 && input.acceptanceCriteria.every((criterion, index) => checked.has(`AC-${index + 1}`) || checked.has(criterion)) && (input.evidence ?? []).some((row) => (row.reference ?? "").trim() !== "");
}

function findRequirementsAppendLine(lines: string[]): number {
  const heading = lines.findIndex((line) => line.trim() === "## 4. Requirements");
  if (heading < 0) return lines.length + 1;
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("## ") && index !== heading) return index + 1;
  }
  return lines.length + 1;
}

function insertLinesOperation(file: TextFile, line: number, lines: string[]): PatchOperation {
  const operation: PatchOperation = { type: "insertLines", line, lines };
  const expectedBefore = file.lines[line - 2];
  if (expectedBefore !== undefined) operation.expectedBefore = expectedBefore;
  const expectedAfter = file.lines[line - 1];
  if (expectedAfter !== undefined) operation.expectedAfter = expectedAfter;
  return operation;
}

function findWorkspaceFile(workspace: ParsedWorkspace, root: ProjectRoot, filePath: string): TextFile | undefined {
  const relativePath = path.relative(root.root, filePath).replace(/\\/g, "/");
  return workspace.files.find((file) => file.relativePath === relativePath);
}

function stalePatchMutationFailure<T>(error: unknown, filePath: string): MutationResult<T> | undefined {
  if (!isStalePatchError(error)) return undefined;
  const message = `Mutation snapshot is stale for ${filePath}; rerun the command to retry against the latest file.`;
  const staleDiagnostic = diagnostic("SRS-E032", "error", message, { filePath });
  return mutationFail("STALE_PATCH", message, [staleDiagnostic], { staleGuard: { filePath, retry: "rerun the command" } }) as MutationResult<T>;
}

function generatedIdConflictFailure(id: string, filePath: string): MutationResult<AddRequirementOutput> {
  const message = `Generated Requirement ID ${id} is no longer available; rerun the command to retry against the latest file.`;
  const staleDiagnostic = diagnostic("SRS-E032", "error", message, { filePath });
  return mutationFail("STALE_PATCH", message, [staleDiagnostic], { staleGuard: { filePath, retry: "rerun the command" } }) as MutationResult<AddRequirementOutput>;
}

function assertSafeChangeNotes(input: AddRequirementInput): MutationResult<AddRequirementOutput> | undefined {
  if (!input.changeNotes) return undefined;
  const newlineFailure = assertSafeMarkdownTableCell<AddRequirementOutput>("Change Notes", input.changeNotes.replaceAll("|", ""));
  if (newlineFailure) return newlineFailure;
  const cells = input.changeNotes.split("|").map((cell) => cell.trim());
  if (cells.length !== 3 || cells.some((cell) => !cell)) {
    return mutationFail("MUTATION_DENIED", "Change Notes must contain date, change, and reason cells") as MutationResult<AddRequirementOutput>;
  }
  return assertSafeMarkdownTableCells<AddRequirementOutput>({
    "Change Notes date": cells[0] ?? "",
    "Change Notes change": cells[1] ?? "",
    "Change Notes reason": cells[2] ?? ""
  });
}

function assertKnownStabilityInput(input: AddRequirementInput): MutationResult<AddRequirementOutput> | undefined {
  if (input.stability === undefined) return undefined;
  if (!isKnownStability(input.stability)) return mutationFail("USAGE", "Invalid stability");
  if (!isCanonicalStability(input.stability)) return mutationFail("MUTATION_DENIED", `Legacy stability is not valid for new requirements: ${input.stability}`);
  return undefined;
}

function assertSafeAddRequirementTableCells(input: ResolvedAddRequirementInput): MutationResult<AddRequirementOutput> | undefined {
  const metadataFailure = assertSafeMarkdownTableCells<AddRequirementOutput>({
    "Requirement metadata Type": input.type,
    "Requirement metadata Target": input.target,
    "Requirement metadata Status": input.status ?? "planned",
    "Requirement metadata Priority": input.priority ?? "medium",
    "Requirement metadata Tags": (input.tags ?? []).join(", ") || "-",
    "Requirement metadata Risk": input.risk ?? "medium",
    "Requirement metadata Stability": input.stability ?? DEFAULT_REQUIREMENT_STABILITY,
    "Requirement metadata Verification Method": input.verificationMethod ?? "test",
    "Requirement metadata GitHub Issue": input.githubIssue ?? "-",
    "Requirement metadata Related Docs": (input.relatedDocs ?? []).join(", ") || "-"
  });
  if (metadataFailure) return metadataFailure;

  for (const [index, row] of (input.evidence ?? []).entries()) {
    const evidenceFailure = assertSafeMarkdownTableCells<AddRequirementOutput>({
      [`Evidence row ${index + 1} ID`]: row.id ?? `VE-${index + 1}`,
      [`Evidence row ${index + 1} type`]: row.type ?? "test",
      [`Evidence row ${index + 1} reference`]: row.reference ?? "",
      [`Evidence row ${index + 1} covers`]: row.covers ?? "all",
      [`Evidence row ${index + 1} notes`]: row.notes ?? "-"
    });
    if (evidenceFailure) return evidenceFailure;
  }

  for (const [index, row] of (input.trace ?? []).entries()) {
    const traceFailure = assertSafeMarkdownTableCells<AddRequirementOutput>({
      [`Trace row ${index + 1} type`]: row.type ?? "Requirement",
      [`Trace row ${index + 1} reference`]: row.reference ?? "",
      [`Trace row ${index + 1} relation`]: row.relation ?? "related_to",
      [`Trace row ${index + 1} notes`]: row.notes ?? "-"
    });
    if (traceFailure) return traceFailure;
  }

  return assertSafeChangeNotes(input);
}

async function resolveScopeDocumentPath(root: ProjectRoot, document: string): Promise<string> {
  const clean = document.replace(/^\.\//, "");
  const candidate = path.join("docs", "spec", clean);
  const resolved = await resolveInsideRoot(root.root, candidate);
  const specRoot = await resolveInsideRoot(root.root, path.join("docs", "spec"));
  const relative = path.relative(specRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Scope document is outside docs/spec: ${document}`);
  }
  return resolved;
}

function buildOutputRecord(input: ResolvedAddRequirementInput, id: string, filePath: string): RequirementRecord {
  const checked = new Set(input.checkedAcceptanceCriteria ?? []);
  const changeNoteCells = input.changeNotes?.split("|").map((cell) => cell.trim());
  const record: RequirementRecord = {
    id,
    title: input.title,
    type: input.type,
    target: input.target,
    status: input.status ?? "planned",
    scope: input.scope,
    filePath,
    headingLine: 0,
    metadata: {
      Type: input.type,
      Target: input.target,
      Status: input.status ?? "planned",
      Priority: input.priority ?? "medium",
      Tags: (input.tags ?? []).join(", ") || "-",
      Risk: input.risk ?? "medium",
      Stability: input.stability ?? DEFAULT_REQUIREMENT_STABILITY,
      "Verification Method": input.verificationMethod ?? "test",
      "GitHub Issue": input.githubIssue ?? "-",
      "Related Docs": (input.relatedDocs ?? []).join(", ") || "-"
    },
    acceptanceCriteria: input.acceptanceCriteria.map((criterion, index) => ({
      id: `AC-${index + 1}`,
      text: criterion,
      checked: checked.has(`AC-${index + 1}`) || checked.has(criterion),
      line: 0
    })),
    verificationEvidence: (input.evidence ?? []).map((row, index) => ({
      id: row.id ?? `VE-${index + 1}`,
      type: row.type ?? "test",
      reference: row.reference ?? "",
      covers: row.covers ?? "all",
      notes: row.notes ?? "-"
    })),
    traceLinks: (input.trace ?? []).map((row) => ({
      type: row.type ?? "Requirement",
      reference: row.reference ?? "",
      relation: row.relation ?? "related_to",
      notes: row.notes ?? "-"
    })),
    changeNotes: changeNoteCells
      ? [{ date: changeNoteCells[0] ?? "", change: changeNoteCells[1] ?? "", reason: changeNoteCells[2] ?? "" }]
      : [{ date: new Date().toISOString().slice(0, 10), change: "Created", reason: "add-requirement" }],
    tags: input.tags ?? [],
    requirement: input.statement
  };
  if (input.priority) record.priority = input.priority as Priority;
  if (input.risk) record.risk = input.risk as Risk;
  record.stability = (input.stability ?? DEFAULT_REQUIREMENT_STABILITY) as Stability;
  if (input.rationale) record.rationale = input.rationale;
  return record;
}

export async function addRequirement(root: ProjectRoot, input: AddRequirementInput): Promise<MutationResult<AddRequirementOutput>> {
  return withSrsMutationLock(root, { operation: "add_requirement", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => addRequirementUnlocked(root, input));
}

async function addRequirementUnlocked(root: ProjectRoot, input: AddRequirementInput): Promise<MutationResult<AddRequirementOutput>> {
  if (!isRequirementType(input.type)) return mutationFail("USAGE", "Invalid requirement type");
  if (!input.scope || !input.title || !input.statement || input.acceptanceCriteria.length === 0) {
    return mutationFail("USAGE", "type, scope, title, statement, and acceptanceCriteria are required; target may be omitted only when Active Target is set");
  }
  const workspace = await parseWorkspace(root);
  const explicitTarget = input.target?.trim();
  const resolvedTarget = explicitTarget || workspace.index.activeTarget.trim();
  if (!resolvedTarget) return mutationFail("USAGE", "target is required when Active Target is empty");
  const targetSource: AddRequirementOutput["targetSource"] = explicitTarget ? "explicit" : "active-target";
  const resolvedInput: ResolvedAddRequirementInput = { ...input, target: resolvedTarget };
  const stabilityFailure = assertKnownStabilityInput(input);
  if (stabilityFailure) return stabilityFailure;
  if (!canBeVerified(resolvedInput)) return mutationFail("MUTATION_DENIED", "verified requires all checked AC and evidence");
  const unsafeCell = assertSafeAddRequirementTableCells(resolvedInput);
  if (unsafeCell) return unsafeCell;

  const scope = workspace.index.scopes.find((candidate) => candidate.prefix === resolvedInput.scope);
  if (!scope) return mutationFail("MUTATION_DENIED", `Unknown scope: ${resolvedInput.scope}`);
  if (!workspace.index.targets.some((target) => target.target === resolvedInput.target)) {
    return mutationFail("MUTATION_DENIED", `Unknown target: ${resolvedInput.target}`);
  }
  for (const trace of resolvedInput.trace ?? []) {
    if (trace.type === "Requirement" && trace.reference && !workspace.records.some((record: RequirementRecord) => record.id === trace.reference)) {
      return mutationFail("MUTATION_DENIED", `Trace target not found: ${trace.reference}`);
    }
  }
  let filePath: string;
  try {
    filePath = await resolveScopeDocumentPath(root, scope.document);
  } catch (error) {
    return mutationFail("MUTATION_DENIED", (error as Error).message);
  }
  const cacheAllocation = await allocateRequirementIdFromStatusCache(root, workspace, resolvedInput.type, resolvedInput.scope);
  const diagnostics = [...cacheAllocation.diagnostics];
  let id = cacheAllocation.id ?? generateNextRequirementId(workspace, resolvedInput.type, resolvedInput.scope);
  if (workspace.records.some((record) => record.id === id)) {
    diagnostics.push(diagnostic("SRS-W065", "warning", `SRS status cache ignored: cached Requirement ID already exists: ${id}`, { filePath: "kiwi/.status.json" }, { reason: "cached-id-collision", requirementId: id, fallback: "full-workspace-parse" }));
    id = generateNextRequirementId(workspace, resolvedInput.type, resolvedInput.scope);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latestWorkspace = await parseWorkspace(root);
    const relativePath = path.relative(root.root, filePath).replace(/\\/g, "/");
    if (latestWorkspace.records.some((record) => record.id === id)) {
      if (attempt === 0) {
        id = generateNextRequirementId(latestWorkspace, resolvedInput.type, resolvedInput.scope);
        continue;
      }
      return generatedIdConflictFailure(id, relativePath);
    }
    const file = findWorkspaceFile(latestWorkspace, root, filePath) ?? (await readUtf8File(filePath, root.root));
    const block = renderRequirementBlock({ ...resolvedInput, id });
    const insertLine = findRequirementsAppendLine(file.lines);
    const lines = insertLine > file.lines.length ? ["", ...block] : [...block, ""];
    const plan = createPatchPlan(file, [insertLinesOperation(file, insertLine, lines)]);
    try {
      const dryRun = input.dryRun ?? false;
      const applied = await applyPatchPlan(plan, { dryRun });
      const indexSync = applied.written ? await syncIndexRollups(root, { skipLock: true }) : undefined;
      if (indexSync && !indexSync.ok) return indexSync as unknown as MutationResult<AddRequirementOutput>;
      const mergedDiagnostics = [...diagnostics, ...(indexSync?.diagnostics ?? [])];
      return {
        ok: true,
        value: {
          requirementId: id,
          filePath: file.relativePath,
          written: applied.written,
          targetSource,
          record: buildOutputRecord(resolvedInput, id, file.relativePath)
        },
        diagnostics: mergedDiagnostics,
        diagnosticsSummary: summarizeDiagnostics(mergedDiagnostics),
        patch: summarizePatch(plan, dryRun),
        mutation: mutationEnvelopeFromPlan("add_requirement", plan, dryRun, applied.written),
        ...(indexSync?.value ? { indexSync: indexSync.value } : {})
      };
    } catch (error) {
      const staleFailure = stalePatchMutationFailure<AddRequirementOutput>(error, file.relativePath);
      if (staleFailure) return staleFailure;
      throw error;
    }
  }
  return generatedIdConflictFailure(id, path.relative(root.root, filePath).replace(/\\/g, "/"));
}

// FR-NODE-046 — promote_step_requirement mutation.
//
// Promotes a step-scoped requirement into a body scope, inserting the step's pre-minted
// canonical Requirement ID verbatim (no auto-generation) after verifying the id is globally
// unique against the reservation view (HEAD body records). The step block is copied
// byte-for-byte so the promoted body requirement keeps the step's id, title, and content.

export interface PromoteStepRequirementInput {
  id: string;
  fromStep: string;
  toScope: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export async function promoteStepRequirement(root: ProjectRoot, input: PromoteStepRequirementInput): Promise<MutationResult<AddRequirementOutput>> {
  return withSrsMutationLock(root, { operation: "promote_step_requirement", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => promoteStepRequirementUnlocked(root, input));
}

async function promoteStepRequirementUnlocked(root: ProjectRoot, input: PromoteStepRequirementInput): Promise<MutationResult<AddRequirementOutput>> {
  const workspace = await parseWorkspace(root);

  // Reservation uniqueness: the pre-minted step id must not already exist in the body scope.
  if (workspace.records.some((record) => record.id === input.id)) {
    return mutationFail("MUTATION_DENIED", `Requirement ID already exists in the reservation view: ${input.id}`) as MutationResult<AddRequirementOutput>;
  }

  const stepRecord = (workspace.stepRecords ?? []).find((record) => record.id === input.id && record.stepName === input.fromStep);
  if (!stepRecord) {
    return mutationFail("NOT_FOUND", `Step requirement not found: ${input.id} in step ${input.fromStep}`) as MutationResult<AddRequirementOutput>;
  }
  if (!stepRecord.markdown) {
    return mutationFail("MUTATION_DENIED", `Step requirement block is empty: ${input.id}`) as MutationResult<AddRequirementOutput>;
  }

  // FR-NODE-074 — evidence gate. A post-hoc SRS promotion without verification
  // evidence reproduces the traceability-loss failure mode, so a tdd-mode flow
  // refuses it outright; other modes keep promoting but surface an advisory
  // warning (enforced-for-mode pattern of the FR-NODE-058 completion gate).
  let advisories: Diagnostic[] = [];
  if ((stepRecord.verificationEvidence ?? []).length === 0) {
    const workMode = await getWorkMode(root);
    if (workMode.mode === "tdd") {
      return mutationFail(
        "EVIDENCE_REQUIRED",
        `Step requirement ${input.id} has no verification evidence; tdd-mode promotion requires at least one evidence entry`
      ) as MutationResult<AddRequirementOutput>;
    }
    advisories = [
      {
        code: "STEP_PROMOTE_NO_EVIDENCE",
        severity: "warning",
        message: `Step requirement ${input.id} was promoted without verification evidence`,
        requirementId: input.id
      }
    ];
  }

  const scope = workspace.index.scopes.find((candidate) => candidate.prefix === input.toScope);
  if (!scope) return mutationFail("MUTATION_DENIED", `Unknown scope: ${input.toScope}`) as MutationResult<AddRequirementOutput>;
  let filePath: string;
  try {
    filePath = await resolveScopeDocumentPath(root, scope.document);
  } catch (error) {
    return mutationFail("MUTATION_DENIED", (error as Error).message) as MutationResult<AddRequirementOutput>;
  }

  const file = findWorkspaceFile(workspace, root, filePath) ?? (await readUtf8File(filePath, root.root));
  const block = stepRecord.markdown.split(/\r?\n/);
  const insertLine = findRequirementsAppendLine(file.lines);
  const lines = insertLine > file.lines.length ? ["", ...block] : [...block, ""];
  const plan = createPatchPlan(file, [insertLinesOperation(file, insertLine, lines)]);
  try {
    const dryRun = input.dryRun ?? false;
    const applied = await applyPatchPlan(plan, { dryRun });
    const indexSync = applied.written ? await syncIndexRollups(root, { skipLock: true }) : undefined;
    if (indexSync && !indexSync.ok) return indexSync as unknown as MutationResult<AddRequirementOutput>;
    return {
      ...mutationOk<AddRequirementOutput>(
        {
          requirementId: input.id,
          filePath: file.relativePath,
          written: applied.written,
          targetSource: "explicit",
          record: stepRecord
        },
        advisories
      ),
      patch: summarizePatch(plan, dryRun),
      mutation: mutationEnvelopeFromPlan("promote_step_requirement", plan, dryRun, applied.written),
      ...(indexSync?.value ? { indexSync: indexSync.value } : {})
    };
  } catch (error) {
    const staleFailure = stalePatchMutationFailure<AddRequirementOutput>(error, file.relativePath);
    if (staleFailure) return staleFailure;
    throw error;
  }
}
