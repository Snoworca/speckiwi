import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseMarkdownTable, type ParsedTable } from "../parser/table.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { isTargetType, TARGET_STATUS_ACTIVE, TARGET_STATUS_COMPLETED, TARGET_STATUS_PLANNED, TARGET_TYPES_SENTENCE, type TargetStatus } from "../target-types.js";
import type { MutationResult, ProjectRoot, RequirementRecord, TargetEntry, TextFile } from "../types.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";
import { findHeadingMatching, TARGET_MAP_HEADING } from "../parser/index-parser.js";
import { planIndexMetadataWrite, planTableRowInsert, planTableRowUpdate, readIndexMetadataValue, type TableRowPlan } from "./internal.js";

export interface SetActiveTargetInput {
  target: string;
  create?: boolean;
  targetType?: string;
  description?: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
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

export interface RegisterTargetInput {
  target: string;
  targetType?: string;
  description?: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

interface TargetMapRead {
  file: TextFile;
  table: ParsedTable;
  rows: TargetEntry[];
}

async function readIndexFile(root: ProjectRoot): Promise<TextFile> {
  return readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
}

/** The index file's Target Map, read the way the index parser reads it. */
function readTargetMap(file: TextFile): TargetMapRead | MutationResult {
  const targetHeading = findHeadingMatching(file.lines, TARGET_MAP_HEADING);
  const table = targetHeading >= 0 ? parseMarkdownTable(file.lines, targetHeading + 1) : undefined;
  if (!table) return mutationFail("MUTATION_DENIED", "Target Map table is missing");
  const rows: TargetEntry[] = table.rows.map((row) => ({
    target: row.Target ?? "",
    type: row.Type ?? "",
    status: row.Status ?? "",
    description: row.Description ?? ""
  }));
  return { file, table, rows };
}

/** A not-yet-registered target's row, with the defaults both registration paths share, or the refusal. */
function newTargetRow(target: string, input: { targetType?: string | undefined; description?: string | undefined }): TargetEntry | MutationResult {
  const row: TargetEntry = {
    target,
    type: normalizeTargetType(input.targetType),
    status: TARGET_STATUS_PLANNED,
    description: input.description?.trim() || `Registered target ${target}`
  };
  return assertTargetCreationInput({ target: row.target, targetType: row.type, description: row.description }) ?? row;
}

/**
 * Inserts a new row through the shared row writer. Target and Status are what the index reads a
 * target by; Type is the caller's classification and has to land, but Description is a note a Target
 * Map may leave out, so it is dropped there.
 */
function planTargetRowInsert(map: TargetMapRead, row: TargetEntry, status: TargetStatus): TableRowPlan {
  return planTableRowInsert(map.file, map.table, { Target: row.target, Type: row.type, Status: status, Description: row.description }, { optional: ["Description"] });
}

function isMutationResult(value: object): value is MutationResult {
  return "ok" in value;
}

export async function setActiveTarget(root: ProjectRoot, input: SetActiveTargetInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "set_active_target", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => setActiveTargetUnlocked(root, input));
}

/**
 * @req IR-CLI-116 — adds a Target Map row as `planned` and leaves the Active Target where it is.
 * `setActiveTarget` with `create` is the other registration path; it shares the row construction and
 * the refusals here, and differs only in activating the row it adds.
 */
export async function registerTarget(root: ProjectRoot, input: RegisterTargetInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "register_target", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => registerTargetUnlocked(root, input));
}

async function registerTargetUnlocked(root: ProjectRoot, input: RegisterTargetInput): Promise<MutationResult> {
  const target = input.target.trim();
  if (!target) return mutationFail("USAGE", "target is required");
  const map = readTargetMap(await readIndexFile(root));
  if (isMutationResult(map)) return map;
  if (map.rows.some((row) => row.target === target)) return mutationFail("MUTATION_DENIED", `Target is already registered: ${target}`);
  const row = newTargetRow(target, input);
  if (isMutationResult(row)) return row;
  const planned = planTargetRowInsert(map, row, TARGET_STATUS_PLANNED);
  if (!planned.ok) return mutationFail("MUTATION_DENIED", planned.message);
  const plan = createPatchPlan(map.file, [planned.operation]);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  return withMutationEnvelope(
    mutationOk({ target, type: row.type, status: row.status, description: row.description, written: applied.written }),
    mutationEnvelopeFromPlan("register_target", plan, dryRun, applied.written)
  );
}

async function setActiveTargetUnlocked(root: ProjectRoot, input: SetActiveTargetInput): Promise<MutationResult> {
  const target = input.target.trim();
  if (!target) return mutationFail("USAGE", "target is required");

  const file = await readIndexFile(root);
  const metadataTable = parseMarkdownTable(file.lines, 1);
  if (!metadataTable) return mutationFail("MUTATION_DENIED", "Index metadata table is missing");

  const map = readTargetMap(file);
  if (isMutationResult(map)) return map;
  const { table: targetTable, rows } = map;

  const targetExists = rows.some((row) => row.target === target);
  if (!targetExists && !input.create) {
    return mutationFail("NOT_FOUND", `Target is not registered: ${target}`);
  }
  const created = targetExists ? undefined : newTargetRow(target, input);
  if (created && isMutationResult(created)) return created;
  const createdRow: TargetEntry | undefined = created;

  const previousActiveTarget = findExistingActiveTarget(file, rows);
  const operations: PatchOperation[] = [];
  // Both tables are written through the shared row writer, by header name, at the rows the index
  // parser reads; a row it cannot rewrite whole is a refusal, never a second row the parser reads instead.
  const push = (planned: TableRowPlan): MutationResult | undefined => {
    if (!planned.ok) return mutationFail("MUTATION_DENIED", planned.message);
    const operation = planned.operation;
    if (operation.type !== "replaceLine" || operation.original !== operation.replacement) operations.push(operation);
    return undefined;
  };
  if (readIndexMetadataValue(file, "Active Target")?.trim() !== target) {
    const refused = push(planIndexMetadataWrite(file, "Active Target", target, { insertWhenMissing: true }));
    if (refused) return refused;
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
    const refused = push(planTableRowUpdate(file, targetTable, index, { Status: nextStatus }));
    if (refused) return refused;
  }
  if (createdRow) {
    const refused = push(planTargetRowInsert(map, createdRow, TARGET_STATUS_ACTIVE));
    if (refused) return refused;
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
  const value = readIndexMetadataValue(file, "Active Target")?.trim();
  if (value) return value;
  return rows.find((row) => row.status === TARGET_STATUS_ACTIVE)?.target ?? rows[0]?.target ?? "";
}
