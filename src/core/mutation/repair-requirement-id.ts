import { readFile, stat, writeFile } from "node:fs/promises";
import { diagnostic, summarizeDiagnostics } from "../diagnostic.js";
import { createTextFileSnapshot } from "../fs/read-text.js";
import { isStalePatchError } from "../patch/apply-patch.js";
import { applyPatchPlans } from "../patch/apply-patch-plans.js";
import { createPatchPlan, renderPatchedLines, type PatchOperation, type PatchPlan } from "../patch/patch-plan.js";
import { scanRequirementBlocks } from "../parser/block-scanner.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { validateWorkspace } from "../validator/validate-workspace.js";
import type { Diagnostic, MutationEnvelope, MutationResult, ParsedWorkspace, ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { assertSingleLine } from "./block-prose.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withMutationEnvelope } from "./envelope.js";
import { requirementReferenceRewrites, type RequirementReferenceRewrite } from "./requirement-references.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { checkRequirementIdAvailable } from "./requirement-id-availability.js";
import { isRequirementType } from "../schema.js";

export interface RequirementOccurrenceIdentity {
  filePath: string;
  headingLine: number;
  blockHash: string;
}

/**
 * @req FR-NODE-317 AC-2 — one explicit rewrite of a line. `occurrence` says which matches of `from` it
 * changes: every one (`"all"`) or the n-th from the start of the line. Without it `from` must match once.
 */
export interface RequirementReferenceEdit {
  filePath: string;
  line: number;
  from: string;
  to: string;
  occurrence?: "all" | number;
}

/** @req FR-NODE-317 AC-6 — a line confirmed as naming the kept occurrence, by position only. */
export interface RequirementKeepReference {
  filePath: string;
  line: number;
}

export interface RequirementReferenceLine {
  filePath: string;
  line: number;
  excerpt: string;
}

export interface RequirementIdCollisionRepairPlanInput {
  duplicateId: string;
  keep: RequirementOccurrenceIdentity;
  rename: RequirementOccurrenceIdentity;
  replacementId?: string;
  allocationStrategy?: "next_available";
  referenceEdits?: RequirementReferenceEdit[];
  keepReferences?: RequirementKeepReference[];
  dryRun?: boolean;
}

export interface RequirementIdCollisionRepairApplyInput extends RequirementIdCollisionRepairPlanInput {
  ignoreLock?: boolean;
  skipLock?: boolean;
  /** @req FR-NODE-317 AC-8 — the lines a written plan recorded, checked before an apply from that plan. */
  expectedLines?: Array<{ filePath: string; line: number; original: string }>;
}

export interface RequirementIdCollisionGroup {
  duplicateId: string;
  occurrences: RequirementOccurrenceIdentity[];
  candidateReplacementIds: string[];
  ambiguousReferences: RequirementReferenceLine[];
  /** @req FR-NODE-317 AC-5 — the lines inside each occurrence's own block, with that block's heading line. */
  blockReferences: Array<RequirementReferenceLine & { headingLine: number }>;
  repairReady: boolean;
  conflictMarkers: boolean;
  diagnostic: Diagnostic;
}

export interface RequirementIdCollisionRepairPlan {
  duplicateId: string;
  keep: RequirementOccurrenceIdentity;
  rename: RequirementOccurrenceIdentity;
  replacementId: string;
  referenceEdits: RequirementReferenceEdit[];
  keepReferences: RequirementKeepReference[];
  touchedFiles: string[];
  operations: Array<{ filePath: string; line: number; original?: string; replacement: string }>;
  ambiguousReferences: RequirementReferenceLine[];
  /** @req FR-NODE-317 AC-5 AC-6 */
  keptReferences: Array<RequirementReferenceLine & { source: "kept-block" | "keepReferences" }>;
  /** @req FR-NODE-317 AC-7 */
  remainingReferences: Array<RequirementReferenceLine & { matches: number }>;
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
  /** @req FR-NODE-317 AC-7 */
  remainingReferences: Array<RequirementReferenceLine & { matches: number }>;
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
    const duplicateId = details.duplicateId;
    const blockReferences = occurrences.flatMap((occurrence) =>
      blockLines(workspace, occurrence, duplicateId).map((reference) => ({ ...reference, headingLine: occurrence.headingLine }))
    );
    return [
      {
        duplicateId: details.duplicateId,
        occurrences,
        candidateReplacementIds: candidate ? [candidate] : [],
        ambiguousReferences: ambiguous,
        blockReferences,
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
  // @req FR-NODE-312 AC-7 — above the series maximum, the first number no SRS document mentions, so the
  // plan's in-use check accepts the candidate. The search stops at 9999, the last number the ID pattern
  // allows: a series that already holds it has no next number, and the loop would otherwise never end.
  const scope = scopeOf(duplicateId);
  for (let number = Math.max(0, ...used) + 1; number <= LAST_REQUIREMENT_NUMBER; number += 1) {
    const id = `${base}${String(number).padStart(3, "0")}`;
    if (checkRequirementIdAvailable(workspace, { id, scope }).ok) return id;
  }
  return null;
}

/** The last number SRS-MD Rules §11.2 allows in a Requirement ID (`[0-9]{3,4}`). */
const LAST_REQUIREMENT_NUMBER = 9999;

function scopeOf(id: string): string {
  return /^[A-Z]+-([A-Z0-9][A-Z0-9-]{1,24})-[0-9]{3,4}$/.exec(id)?.[1] ?? "";
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
      if (!namesId(line, duplicateId)) return;
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
  // @req FR-NODE-312 AC-7 — the replacement passes the rule a caller-chosen id passes: the renamed
  // requirement's type prefix and scope segment, and no mention in any SRS document of this checkout,
  // the completed-work history file and the step documents included.
  const type = isRequirementType(renameRecord.type) ? renameRecord.type : undefined;
  const availability = checkRequirementIdAvailable(workspace, { id: replacementId, ...(type ? { type } : {}), scope: scopeOf(input.duplicateId) });
  if (!availability.ok) {
    if (availability.check !== "in-use") return mutationFail("MUTATION_DENIED", availability.message);
    const where = availability.filePath === undefined ? {} : { filePath: availability.filePath, ...(availability.line === undefined ? {} : { line: availability.line }) };
    const collision = diagnostic("SRS-E032", "error", availability.message, where, { replacementId });
    return mutationFail("GENERATED_ID_COLLISION", availability.message, [collision]);
  }
  return mutationOk(replacementId);
}

function staleReference(filePath: string, line: number, message: string): MutationResult<never> {
  return mutationFail("STALE_PATCH", message, [diagnostic("SRS-E032", "error", message, { filePath, line })], {
    staleGuard: { filePath, retry: "rerun repair requirement-id-collisions plan" }
  }) as MutationResult<never>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where `needle` starts in `line`, left to right, without overlap. @req FR-NODE-317 AC-1 AC-2
 * The one matching rule of this repair: every test of whether a line names the duplicate id goes
 * through it, so counting, ambiguity, the kept block, keepReferences, the swap check and the
 * remaining-match report cannot disagree about one line. A match stands on its own: an id that merely
 * starts with the needle (one more digit, or an NFR prefix) is another requirement, and counted it let
 * "all" rewrite that requirement's id. Punctuation around it (`_`, `*`, quotes, brackets) does not
 * make it another id.
 */
function matchStarts(line: string, needle: string): number[] {
  const startsWord = /^[A-Za-z0-9]/.test(needle);
  const endsWord = /[A-Za-z0-9]$/.test(needle);
  const starts: number[] = [];
  for (let at = line.indexOf(needle); needle.length > 0 && at !== -1; at = line.indexOf(needle, at + 1)) {
    if (startsWord && /[A-Za-z0-9-]/.test(line[at - 1] ?? "")) continue;
    if (endsWord && /[A-Za-z0-9]/.test(line[at + needle.length] ?? "")) continue;
    if (starts.length > 0 && at < starts[starts.length - 1]! + needle.length) continue;
    starts.push(at);
  }
  return starts;
}

function namesId(line: string, id: string): boolean {
  return matchStarts(line, id).length > 0;
}

/** The non-heading lines inside one occurrence's block that name the duplicate id. */
function blockLines(workspace: ParsedWorkspace, occurrence: RequirementOccurrenceIdentity, duplicateId: string): RequirementReferenceLine[] {
  const record = findRecord(workspace, occurrence);
  const file = findFile(workspace, occurrence.filePath);
  if (!record || !file) return [];
  const end = record.blockEndLine ?? file.lines.length;
  const lines: RequirementReferenceLine[] = [];
  for (let lineNo = occurrence.headingLine + 1; lineNo <= end; lineNo += 1) {
    const text = file.lines[lineNo - 1] ?? "";
    if (namesId(text, duplicateId)) lines.push({ filePath: file.relativePath, line: lineNo, excerpt: text.trim().slice(0, 160) });
  }
  return lines;
}

/** The lines the rename rewrites by itself: its heading and its own Trace Link and successor references. */
function renameOwnLineKeys(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput, replacementId: string): Set<string> {
  return new Set([
    explicitReferenceKey({ filePath: input.rename.filePath, line: input.rename.headingLine }),
    ...renamedBlockReferences(workspace, input, replacementId).map((rewrite) => explicitReferenceKey({ filePath: rewrite.file.relativePath, line: rewrite.line }))
  ]);
}

interface ReferenceLineRewrite {
  file: TextFile;
  line: number;
  original: string;
  replacement: string;
}

interface ResolvedReferences {
  rewrites: ReferenceLineRewrite[];
  keptReferences: RequirementIdCollisionRepairPlan["keptReferences"];
  remainingReferences: RequirementIdCollisionRepairPlan["remainingReferences"];
  /** Lines a reference edit or a keepReferences entry names: none of them is ambiguous. */
  explicitKeys: Set<string>;
}

/**
 * @req FR-NODE-317 AC-1 AC-2 AC-3 AC-4 AC-6 AC-7 — every reference edit and keep confirmation resolved
 * against the documents as they stand, or the first reason none of them may be written. A reference
 * edit only swaps the duplicate id for the replacement id, on the matches it names; edits on one line
 * become one rewrite of that line, so apply never meets two operations on one original line.
 */
function resolveReferences(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput, replacementId: string): MutationResult<ResolvedReferences> {
  const ownKeys = renameOwnLineKeys(workspace, input, replacementId);
  const explicitKeys = new Set<string>();
  const keepKeys = new Set<string>();
  const keptReferences: ResolvedReferences["keptReferences"] = [];

  for (const keep of input.keepReferences ?? []) {
    const file = findFile(workspace, keep.filePath);
    const line = file?.lines[keep.line - 1];
    if (!file || line === undefined || !namesId(line, input.duplicateId)) {
      return staleReference(keep.filePath, keep.line, `keepReferences names ${keep.filePath}:${keep.line}, which does not hold ${input.duplicateId}`);
    }
    if (ownKeys.has(explicitReferenceKey(keep))) {
      return mutationFail("MUTATION_DENIED", `keepReferences names ${keep.filePath}:${keep.line}, a line the rename rewrites by itself`);
    }
    keepKeys.add(explicitReferenceKey(keep));
    explicitKeys.add(explicitReferenceKey(keep));
    keptReferences.push({ filePath: keep.filePath, line: keep.line, excerpt: line.trim().slice(0, 160), source: "keepReferences" });
  }

  const spansByLine = new Map<string, { file: TextFile; line: number; original: string; spans: Array<{ start: number; end: number; to: string }> }>();
  const confirmKeys = new Set<string>();
  for (const edit of input.referenceEdits ?? []) {
    const where = `${edit.filePath}:${edit.line}`;
    // A `to` carrying a newline writes whatever follows it at column zero of a spec file: measured
    // landing `| Status | verified |` plus an unclosed fence through a repair that is supposed to
    // renumber an identifier. A reference edit replaces text inside one line.
    const oneLine = assertSingleLine<RequirementIdCollisionRepairOutput>(`referenceEdits[${where}].to`, edit.to);
    if (oneLine) return oneLine as MutationResult<never>;
    const file = findFile(workspace, edit.filePath);
    const line = file?.lines[edit.line - 1];
    if (!file || line === undefined || !line.includes(edit.from)) return staleReference(edit.filePath, edit.line, `Explicit reference edit is stale for ${where}`);
    // @req FR-NODE-317 AC-4 — the edit swaps the duplicate id and nothing else, so a repair cannot
    // write a Status, a relation or any other text no gate in its path would check.
    const idStarts = matchStarts(edit.from, input.duplicateId);
    if (idStarts.length === 0) {
      return mutationFail("MUTATION_DENIED", `referenceEdits[${where}]: from must contain ${input.duplicateId}`);
    }
    const pieces = [...idStarts, edit.from.length].map((end, index) => edit.from.slice(index === 0 ? 0 : idStarts[index - 1]! + input.duplicateId.length, end));
    const swap = new RegExp(`^${pieces.map(escapeRegExp).join(`(?:${escapeRegExp(input.duplicateId)}|${escapeRegExp(replacementId)})`)}$`);
    if (!swap.test(edit.to)) {
      return mutationFail("MUTATION_DENIED", `referenceEdits[${where}]: to may differ from from only by ${input.duplicateId} replaced with ${replacementId}`);
    }
    if (ownKeys.has(explicitReferenceKey(edit))) {
      return mutationFail("MUTATION_DENIED", `referenceEdits[${where}] names a line the rename rewrites by itself`);
    }
    explicitKeys.add(explicitReferenceKey(edit));
    // @req FR-NODE-317 AC-1 — from equal to confirms the line as kept. Its matches still take part in
    // the occurrence and overlap checks, so a rewrite on the same line cannot change what it keeps.
    const confirms = edit.from === edit.to;
    if (confirms) confirmKeys.add(where);
    const starts = matchStarts(line, edit.from);
    if (starts.length === 0) return staleReference(edit.filePath, edit.line, `Explicit reference edit is stale for ${where}`);
    let chosen: number[];
    if (edit.occurrence === "all" || (edit.occurrence === undefined && confirms)) chosen = starts;
    else if (edit.occurrence === undefined) {
      if (starts.length > 1) {
        const message = `${where}: ${starts.length} matches of "${edit.from}"; name occurrence "all" or the match number`;
        return mutationFail("AMBIGUOUS_REFERENCE", message, [diagnostic("SRS-E076", "error", message, { filePath: edit.filePath, line: edit.line }, { matches: starts.length })]);
      }
      chosen = starts;
    } else if (!Number.isInteger(edit.occurrence) || edit.occurrence < 1) {
      return mutationFail("MUTATION_DENIED", `referenceEdits[${where}]: occurrence must be "all" or a whole number from 1`);
    } else if (edit.occurrence > starts.length) {
      return staleReference(edit.filePath, edit.line, `${where}: occurrence ${edit.occurrence} but the line holds ${starts.length} matches of "${edit.from}"`);
    } else chosen = [starts[edit.occurrence - 1]!];
    const entry = spansByLine.get(where) ?? { file, line: edit.line, original: line, spans: [] };
    entry.spans.push(...chosen.map((start) => ({ start, end: start + edit.from.length, to: edit.to })));
    spansByLine.set(where, entry);
  }

  const rewrites: ReferenceLineRewrite[] = [];
  const remainingReferences: ResolvedReferences["remainingReferences"] = [];
  for (const [where, entry] of spansByLine) {
    const spans = [...entry.spans].sort((left, right) => left.start - right.start);
    // @req FR-NODE-317 AC-3 — overlapping edits on one line are refused here, before any write.
    if (spans.some((span, index) => index > 0 && span.start < spans[index - 1]!.end)) {
      return mutationFail("MUTATION_DENIED", `${where}: reference edits on this line overlap`);
    }
    let replacement = entry.original;
    for (const span of [...spans].reverse()) replacement = replacement.slice(0, span.start) + span.to + replacement.slice(span.end);
    // @req FR-NODE-317 AC-7 — counted per match: a match no edit rewrites or confirms is reported, so a
    // confirmation of one match never hides another on the same line. keepReferences keeps a whole line.
    const left = matchStarts(entry.original, input.duplicateId).filter((start) => !spans.some((span) => start >= span.start && start < span.end)).length;
    if (left > 0 && !keepKeys.has(where)) remainingReferences.push({ filePath: entry.file.relativePath, line: entry.line, excerpt: replacement.trim().slice(0, 160), matches: left });
    // A line only confirmed as kept is not rewritten: no operation, as before.
    if (replacement !== entry.original) rewrites.push({ file: entry.file, line: entry.line, original: entry.original, replacement });
  }

  // @req FR-NODE-317 AC-5 — the kept block's own lines name the kept requirement: kept, and listed,
  // unless an edit rewrites them. A from-equal-to confirmation keeps them and is listed the same way.
  const rewritten = new Set(rewrites.map((rewrite) => explicitReferenceKey({ filePath: rewrite.file.relativePath, line: rewrite.line })));
  const listed = new Set(keptReferences.map(explicitReferenceKey));
  const keptBlock = blockLines(workspace, input.keep, input.duplicateId);
  const inKeptBlock = new Set(keptBlock.map(explicitReferenceKey));
  for (const reference of keptBlock) {
    const key = explicitReferenceKey(reference);
    if (listed.has(key) || (rewritten.has(key) && !confirmKeys.has(key))) continue;
    explicitKeys.add(key);
    keptReferences.push({ ...reference, source: "kept-block" });
  }
  for (const key of confirmKeys) {
    if (listed.has(key) || inKeptBlock.has(key)) continue;
    const separator = key.lastIndexOf(":");
    const filePath = key.slice(0, separator);
    const line = Number(key.slice(separator + 1));
    keptReferences.push({ filePath, line, excerpt: (findFile(workspace, filePath)?.lines[line - 1] ?? "").trim().slice(0, 160), source: "keepReferences" });
  }
  const byPosition = <T extends { filePath: string; line: number }>(items: T[]) => items.sort((left, right) => left.filePath.localeCompare(right.filePath) || left.line - right.line);
  return mutationOk({ rewrites, keptReferences: byPosition(keptReferences), remainingReferences: byPosition(remainingReferences), explicitKeys });
}

function ambiguousReferences(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput, groupOccurrences: RequirementOccurrenceIdentity[], replacementId: string, explicitKeys: Set<string>): RequirementReferenceLine[] {
  const occurrenceHeadingKeys = new Set(groupOccurrences.map((occurrence) => explicitReferenceKey({ filePath: occurrence.filePath, line: occurrence.headingLine })));
  // The renamed block's own references are rewritten with it, so they are not ambiguous.
  const ownLines = new Set(renamedBlockReferences(workspace, input, replacementId).map((rewrite) => explicitReferenceKey({ filePath: rewrite.file.relativePath, line: rewrite.line })));
  const references: RequirementReferenceLine[] = [];
  for (const file of workspace.files) {
    file.lines.forEach((line, index) => {
      if (!namesId(line, input.duplicateId)) return;
      const lineNo = index + 1;
      if (occurrenceHeadingKeys.has(explicitReferenceKey({ filePath: file.relativePath, line: lineNo }))) return;
      // The selected occurrence's heading line, which the plan has matched against the parsed records.
      if (file.relativePath === input.rename.filePath && lineNo === input.rename.headingLine) return;
      if (file.relativePath === input.keep.filePath && lineNo === input.keep.headingLine) return;
      if (ownLines.has(explicitReferenceKey({ filePath: file.relativePath, line: lineNo }))) return;
      references.push({ filePath: file.relativePath, line: lineNo, excerpt: line.trim().slice(0, 160) });
    });
  }
  return references.filter((item) => !explicitKeys.has(explicitReferenceKey(item)));
}

/**
 * @req FR-PARSE-044 AC-4 — the references the renamed block itself makes to the duplicate id, from the
 * shared collector, so a Trace Link row and an expired-marker successor move together.
 */
function renamedBlockReferences(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput, replacementId: string): RequirementReferenceRewrite[] {
  const renamed = findRecord(workspace, input.rename);
  return renamed ? requirementReferenceRewrites(workspace, [renamed], input.duplicateId, replacementId) : [];
}

function buildRenameOperations(workspace: ParsedWorkspace, file: TextFile, input: RequirementIdCollisionRepairPlanInput, replacementId: string): PatchOperation[] {
  const headingLine = file.lines[input.rename.headingLine - 1] ?? "";
  return [
    { type: "replaceLine", line: input.rename.headingLine, original: headingLine, replacement: headingLine.replace(input.duplicateId, replacementId) },
    ...renamedBlockReferences(workspace, input, replacementId).map((rewrite): PatchOperation => ({ type: "replaceLine", line: rewrite.line, original: rewrite.original, replacement: rewrite.replacement }))
  ];
}

function buildOperationsByFile(workspace: ParsedWorkspace, input: RequirementIdCollisionRepairPlanInput, replacementId: string, rewrites: readonly ReferenceLineRewrite[]): Map<TextFile, PatchOperation[]> {
  const result = new Map<TextFile, PatchOperation[]>();
  const renameFile = findFile(workspace, input.rename.filePath);
  if (renameFile) result.set(renameFile, buildRenameOperations(workspace, renameFile, input, replacementId));
  for (const rewrite of rewrites) {
    const operations = result.get(rewrite.file) ?? [];
    operations.push({ type: "replaceLine", line: rewrite.line, original: rewrite.original, replacement: rewrite.replacement });
    result.set(rewrite.file, operations);
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

/**
 * @req FR-NODE-261 AC-1 — whether the documents as the repair would leave them hold the replacement ID
 * on more than one requirement heading. The planner refuses an ID already in the workspace; this
 * catches the one the repair's own reference edits would put on another heading, and it is asked
 * before the first write, so a refusal never follows a write.
 */
function replacementCollisionAfter(workspace: ParsedWorkspace, plans: readonly PatchPlan[], replacementId: string): MutationResult<RequirementIdCollisionRepairOutput> | undefined {
  const sources = new Set(workspace.records.map((record) => record.filePath));
  const patched = plans.filter((plan) => sources.has(plan.file.relativePath));
  const patchedPaths = new Set(patched.map((plan) => plan.file.relativePath));
  const headings = [
    ...workspace.records.filter((record) => record.id === replacementId && !patchedPaths.has(record.filePath)).map((record) => ({ filePath: record.filePath, line: record.headingLine })),
    ...patched.flatMap((plan) =>
      scanRequirementBlocks(renderPatchedLines(plan), plan.file.relativePath)
        .blocks.filter((block) => block.heading.id === replacementId)
        .map((block) => ({ filePath: plan.file.relativePath, line: block.startLine }))
    )
  ];
  if (headings.length <= 1) return undefined;
  const collision = diagnostic("SRS-E032", "error", `Replacement Requirement ID would collide after repair: ${replacementId}`, headings[0]!, { replacementId, headings });
  return mutationFail("GENERATED_ID_COLLISION", `Replacement Requirement ID would collide after repair: ${replacementId}`, [collision]);
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
  const resolved = resolveReferences(workspace, input, replacement.value);
  if (!resolved.ok || !resolved.value) {
    return mutationFail(
      resolved.error?.code ?? "STALE_PATCH",
      resolved.error?.message ?? "Explicit reference edit is stale",
      resolved.diagnostics,
      resolved.error?.staleGuard ? { staleGuard: resolved.error.staleGuard } : {}
    );
  }
  const ambiguous = ambiguousReferences(workspace, input, group.occurrences, replacement.value, resolved.value.explicitKeys);
  const operationsByFile = buildOperationsByFile(workspace, input, replacement.value, resolved.value.rewrites);
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
    keepReferences: input.keepReferences ?? [],
    touchedFiles,
    operations,
    ambiguousReferences: ambiguous,
    keptReferences: resolved.value.keptReferences,
    remainingReferences: resolved.value.remainingReferences,
    pendingDuplicateGroups,
    written: false
  });
}

export async function applyRequirementIdCollisionRepair(root: ProjectRoot, input: RequirementIdCollisionRepairApplyInput): Promise<MutationResult<RequirementIdCollisionRepairOutput>> {
  return withSrsMutationLock(root, { operation: "repair_requirement_id_collision", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, async () => {
    // @req FR-NODE-317 AC-8 — a plan file names lines by number; a table re-sorted since then can leave
    // every edit matching on the wrong row, so the lines it recorded must still read as they did.
    if (input.expectedLines && input.expectedLines.length > 0) {
      const current = await parseWorkspace(root);
      for (const expected of input.expectedLines) {
        if (findFile(current, expected.filePath)?.lines[expected.line - 1] !== expected.original) {
          return staleReference(expected.filePath, expected.line, `The plan recorded ${expected.filePath}:${expected.line} as it no longer reads; rerun the plan`);
        }
      }
    }
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
            pendingDuplicateGroups: [],
            remainingReferences: []
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
    const resolved = resolveReferences(workspace, input, plan.replacementId);
    if (!resolved.ok || !resolved.value) return resolved as MutationResult<never>;
    const operationsByFile = buildOperationsByFile(workspace, input, plan.replacementId, resolved.value.rewrites);
    const patchPlans = [...operationsByFile.entries()].map(([file, operations]) => createPatchPlan(file, operations));
    if (patchPlans.length === 0) return mutationFail("STALE_PATCH", "Requirement ID collision repair has no patchable files");
    try {
      if (!input.dryRun) await assertFreshPlans(patchPlans);
      const collision = replacementCollisionAfter(workspace, patchPlans, plan.replacementId);
      if (collision) return collision;
      // Every touched document is written as one transaction: a failed write restores the ones before it.
      const { written } = await applyPatchPlans(patchPlans, { dryRun: input.dryRun ?? false });
      const postWorkspace = input.dryRun ? workspace : await parseWorkspace(root);
      const postGroups = toGroups(postWorkspace, duplicateDiagnostics(postWorkspace));
      const pendingDuplicateGroups = postGroups.map((group) => group.duplicateId).sort();
      const result = mutationOk<RequirementIdCollisionRepairOutput>({
        duplicateId: input.duplicateId,
        replacementId: plan.replacementId,
        touchedFiles: plan.touchedFiles,
        written,
        completedOperations: written ? plan.operations.length : 0,
        pendingOperations: written ? 0 : plan.operations.length,
        pendingDuplicateGroups,
        remainingReferences: plan.remainingReferences,
        ...(!written || pendingDuplicateGroups.length > 0 ? { pendingRepair: { ...plan, pendingDuplicateGroups } } : {})
      });
      return withMutationEnvelope(result, repairEnvelope(patchPlans, input.dryRun ?? false, written), {
        filePath: patchPlans.length === 1 ? patchPlans[0]!.file.relativePath : "<multiple>",
        operations: patchPlans.reduce((sum, patchPlan) => sum + patchPlan.operations.length, 0),
        dryRun: input.dryRun ?? false,
        preview: patchPlans.flatMap((patchPlan) => renderPatchedLines(patchPlan).slice(0, 20))
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

export async function readRequirementIdCollisionRepairPlan(filePath: string): Promise<RequirementIdCollisionRepairApplyInput> {
  const plan = JSON.parse(await readFile(filePath, "utf8")) as RequirementIdCollisionRepairPlan;
  return {
    duplicateId: plan.duplicateId,
    keep: plan.keep,
    rename: plan.rename,
    replacementId: plan.replacementId,
    referenceEdits: referenceEditsFromInput(plan.referenceEdits),
    keepReferences: keepReferencesFromInput(plan.keepReferences),
    expectedLines: (plan.operations ?? []).flatMap((operation) => (typeof operation.original === "string" ? [{ filePath: operation.filePath, line: operation.line, original: operation.original }] : []))
  };
}

/**
 * @req FR-NODE-317 AC-2 AC-6 — the one reader of `referenceEdits` and `keepReferences` from an untyped
 * payload (MCP arguments, a CLI JSON flag, a written plan), so every surface takes the same shape.
 */
export function referenceEditsFromInput(value: unknown): RequirementReferenceEdit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Partial<RequirementReferenceEdit>;
    if (typeof record.filePath !== "string" || typeof record.line !== "number" || typeof record.from !== "string" || typeof record.to !== "string") return [];
    // Passed through as given: an occurrence the core cannot read is refused there, never dropped (a
    // dropped "2" left the edit applying to whatever the line held). @req FR-NODE-317 AC-2
    const occurrence = record.occurrence === undefined ? {} : { occurrence: record.occurrence as "all" | number };
    return [{ filePath: record.filePath, line: record.line, from: record.from, to: record.to, ...occurrence }];
  });
}

export function keepReferencesFromInput(value: unknown): RequirementKeepReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Partial<RequirementKeepReference>;
    return typeof record.filePath === "string" && typeof record.line === "number" ? [{ filePath: record.filePath, line: record.line }] : [];
  });
}
