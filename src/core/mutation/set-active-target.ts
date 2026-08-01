import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseMarkdownTable } from "../parser/table.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { isTargetType, TARGET_STATUS_ACTIVE, TARGET_STATUS_COMPLETED, TARGET_STATUS_PLANNED, TARGET_TYPES_SENTENCE, type TargetStatus } from "../target-types.js";
import type { MutationResult, ProjectRoot, RequirementRecord, TargetEntry, TextFile } from "../types.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";

export interface SetActiveTargetInput {
  target: string;
  create?: boolean;
  targetType?: string;
  description?: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

function findHeadingMatching(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function findMetadataRowLine(file: TextFile, field: string): number | undefined {
  for (let index = 0; index < file.lines.length; index += 1) {
    const line = file.lines[index] ?? "";
    if (line.startsWith(`| ${field} |`)) return index + 1;
    if (index > 0 && line.startsWith("## ")) break;
  }
  return undefined;
}

function renderTargetRow(row: TargetEntry, status: string): string {
  return `| ${row.target} | ${row.type} | ${status} | ${row.description} |`;
}

function normalizeTargetType(value: string | undefined): string {
  return value?.trim() || "version";
}

function assertTargetCreationInput(input: { target: string; targetType: string; description: string }): MutationResult | undefined {
  // @req FR-NODE-098 — the accepted set comes from TARGET_TYPES, not from a local array.
  if (!isTargetType(input.targetType)) return mutationFail("USAGE", `target type must be ${TARGET_TYPES_SENTENCE}`);
  return assertSafeMarkdownTableCells({
    "Target Map Target": input.target,
    "Target Map Type": input.targetType,
    "Target Map Description": input.description
  });
}

export async function setActiveTarget(root: ProjectRoot, input: SetActiveTargetInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "set_active_target", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => setActiveTargetUnlocked(root, input));
}

async function setActiveTargetUnlocked(root: ProjectRoot, input: SetActiveTargetInput): Promise<MutationResult> {
  const target = input.target.trim();
  if (!target) return mutationFail("USAGE", "target is required");

  const file = await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
  const metadataTable = parseMarkdownTable(file.lines, 1);
  if (!metadataTable) return mutationFail("MUTATION_DENIED", "Index metadata table is missing");

  const targetHeading = findHeadingMatching(file.lines, /^##\s+\d+\.\s+Target Map$/);
  const targetTable = targetHeading >= 0 ? parseMarkdownTable(file.lines, targetHeading + 1) : undefined;
  if (!targetTable) return mutationFail("MUTATION_DENIED", "Target Map table is missing");

  const rows: TargetEntry[] = targetTable.rows.map((row) => ({
    target: row.Target ?? "",
    type: row.Type ?? "",
    status: row.Status ?? "",
    description: row.Description ?? ""
  }));
  const targetExists = rows.some((row) => row.target === target);
  if (!targetExists && !input.create) {
    return mutationFail("NOT_FOUND", `Target is not registered: ${target}`);
  }
  const createdRow: TargetEntry | undefined = targetExists
    ? undefined
    : {
        target,
        type: normalizeTargetType(input.targetType),
        status: "planned",
        description: input.description?.trim() || `Registered target ${target}`
      };
  if (createdRow) {
    const creationFailure = assertTargetCreationInput({ target: createdRow.target, targetType: createdRow.type, description: createdRow.description });
    if (creationFailure) return creationFailure;
  }

  const previousActiveTarget = findExistingActiveTarget(file, rows);
  const operations: PatchOperation[] = [];
  const metadataLine = findMetadataRowLine(file, "Active Target");
  if (metadataLine) {
    const original = file.lines[metadataLine - 1];
    if (original === undefined) return mutationFail("MUTATION_DENIED", "Active Target metadata row is outside file");
    const replacement = `| Active Target | ${target} |`;
    if (original !== replacement) operations.push({ type: "replaceLine", line: metadataLine, original, replacement });
  } else {
    operations.push({ type: "insertLines", line: metadataTable.endLine, lines: [`| Active Target | ${target} |`] });
  }

  // @req FR-NODE-099 — the departing target's status is derived from its own requirements. Fixing it
  // to "planned" told the reader "not started yet" about work that was finished and, in one case,
  // tagged and shipped.
  const derivable = rows.some((row) => row.status === TARGET_STATUS_ACTIVE && row.target !== target)
    ? await loadRecordsForDerivation(root)
    : undefined;

  for (const [index, row] of rows.entries()) {
    const nextStatus = row.target === target
      ? TARGET_STATUS_ACTIVE
      : row.status === TARGET_STATUS_ACTIVE
        ? deriveStatusFor(row.target, derivable)
        : row.status;
    if (nextStatus === row.status) continue;
    const line = targetTable.startLine + 2 + index;
    const original = file.lines[line - 1];
    if (original === undefined) return mutationFail("MUTATION_DENIED", "Target Map row is outside file");
    operations.push({ type: "replaceLine", line, original, replacement: renderTargetRow(row, nextStatus) });
  }
  if (createdRow) {
    const line = targetTable.endLine + 1;
    const operation: PatchOperation = {
      type: "insertLines",
      line,
      lines: [renderTargetRow(createdRow, "active")]
    };
    const expectedBefore = file.lines[line - 2];
    if (expectedBefore !== undefined) operation.expectedBefore = expectedBefore;
    const expectedAfter = file.lines[line - 1];
    if (expectedAfter !== undefined) operation.expectedAfter = expectedAfter;
    operations.push(operation);
  }

  if (operations.length === 0) {
    return withMutationEnvelope(
      mutationOk({ activeTarget: target, previousActiveTarget, created: false, written: false }),
      mutationNoopEnvelope("set_active_target", file.relativePath, input.dryRun ?? false)
    );
  }

  const plan = createPatchPlan(file, operations);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  return withMutationEnvelope(
    mutationOk({ activeTarget: target, previousActiveTarget, created: Boolean(createdRow), written: applied.written }),
    mutationEnvelopeFromPlan("set_active_target", plan, dryRun, applied.written)
  );
}

/**
 * @req FR-NODE-099 — read the requirements once, for every departing row.
 *
 * Returns `undefined` when completion must not be inferred at all: a parse that threw, or a parse
 * that reported errors. A malformed Requirement Block is dropped from `records` with a diagnostic
 * rather than throwing, so an unfinished requirement can simply vanish and leave a target looking
 * finished — completion may not be claimed from a parse the caller never checked. In both cases every
 * departing row keeps `planned`, which is exactly what the tool did before this requirement existed.
 */
async function loadRecordsForDerivation(root: ProjectRoot): Promise<RequirementRecord[] | undefined> {
  try {
    const workspace = await parseWorkspace(root);
    if (workspace.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return undefined;
    // A Requirement Block whose metadata table does not parse is NOT dropped and emits no parse
    // diagnostic. It survives with an empty `target`, so it silently leaves its target's set and the
    // target looks finished. A record with no target may belong to the departing one, so no completion
    // may be claimed while any exists. Deliberately narrower than "the workspace validates": an error
    // in an unrelated scope says nothing about whether this target's requirements were counted.
    if (workspace.records.some((record) => !record.target.trim())) return undefined;
    return workspace.records;
  } catch {
    return undefined;
  }
}

/**
 * @req FR-NODE-099 — what one outgoing active row becomes.
 *
 * `completed` only when the target carries at least one live requirement and every one is verified.
 * Discarded requirements are excluded, matching every other completion rule in the codebase —
 * release readiness and the target summary both exclude them, and `supersede_requirement` produces
 * that state as a normal step, so counting a discarded requirement as unfinished would hold most real
 * targets at "not started yet".
 *
 * A target with no live requirements is not complete, it is unstarted, so it keeps `planned`.
 * `released` is never derived: the rules reserve it for a target that passed release readiness, which
 * is a decision a human makes and records with `set-target-status` (FR-NODE-100).
 *
 * Each row is judged on its own requirements. Deriving once and applying the answer to every active
 * row wrote one target's completion onto another whenever a repository carried two active rows —
 * an invalid state, but the one an author reaches for this command to repair.
 *
 * Step-scoped requirements live in `stepRecords` and are deliberately out of scope: an unpromoted
 * step is not body-scope work and does not gate a target.
 */
function deriveStatusFor(departingTarget: string, records: RequirementRecord[] | undefined): TargetStatus {
  if (!records) return TARGET_STATUS_PLANNED;
  const live = records.filter((record) => record.target === departingTarget && record.status !== "discarded");
  if (live.length === 0) return TARGET_STATUS_PLANNED;
  return live.every((record) => record.status === "verified") ? TARGET_STATUS_COMPLETED : TARGET_STATUS_PLANNED;
}

function findExistingActiveTarget(file: TextFile, rows: TargetEntry[]): string {
  const metadataLine = findMetadataRowLine(file, "Active Target");
  if (metadataLine) {
    const cells = (file.lines[metadataLine - 1] ?? "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells[1]) return cells[1];
  }
  return rows.find((row) => row.status === TARGET_STATUS_ACTIVE)?.target ?? rows[0]?.target ?? "";
}
