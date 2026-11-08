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
import { assertSafeMarkdownTableCells, replaceTableCell } from "./table-cell.js";
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

function assertTargetCreationInput(input: { target: string; targetType: string }): MutationResult | undefined {
  // @req FR-NODE-098 — the accepted set comes from TARGET_TYPES, not from a local array.
  if (!isTargetType(input.targetType)) return mutationFail("USAGE", `target type must be ${TARGET_TYPES_SENTENCE}`);
  return assertSafeMarkdownTableCells({
    "Target Map Target": input.target,
    "Target Map Type": input.targetType
  });
}

/** Unicode control characters (Cc): C0, DEL and C1; line breaks and tabs are among them. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * The one check of a Target Map description a caller gives, on registration and on replacement alike:
 * the trimmed description, or a USAGE refusal of an empty one or one holding a pipe or a control
 * character. Judged on the text as given, so a trailing line break is refused, not trimmed away.
 * @req FR-NODE-276 AC-3
 */
function checkTargetDescription(value: string): string | MutationResult {
  if (value.includes("|") || CONTROL_CHARACTER.test(value)) {
    return mutationFail("USAGE", "description cannot contain a pipe, a line break or a control character");
  }
  const description = value.trim();
  return description ? description : mutationFail("USAGE", "description is required");
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
  const type = normalizeTargetType(input.targetType);
  const refused = assertTargetCreationInput({ target, targetType: type });
  if (refused) return refused;
  const description = input.description === undefined ? `Registered target ${target}` : checkTargetDescription(input.description);
  if (typeof description !== "string") return description;
  return { target, type, status: TARGET_STATUS_PLANNED, description };
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

export interface SetTargetDescriptionInput {
  target: string;
  description: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

/**
 * @req FR-NODE-276 — replaces a registered target's Target Map description. The index has no Change
 * Notes, so the change is recorded in the result: `previousDescription` beside the new one.
 */
export async function setTargetDescription(root: ProjectRoot, input: SetTargetDescriptionInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "set_target_description", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => setTargetDescriptionUnlocked(root, input));
}

async function setTargetDescriptionUnlocked(root: ProjectRoot, input: SetTargetDescriptionInput): Promise<MutationResult> {
  const target = input.target.trim();
  if (!target) return mutationFail("USAGE", "target is required");
  // @req FR-NODE-276 AC-3
  const description = checkTargetDescription(input.description);
  if (typeof description !== "string") return description;

  const map = readTargetMap(await readIndexFile(root));
  if (isMutationResult(map)) return map;
  const index = map.rows.findIndex((row) => row.target === target);
  if (index < 0) return mutationFail("USAGE", `Target is not registered: ${target}`);
  const previousDescription = (map.rows[index] as TargetEntry).description;
  const dryRun = input.dryRun ?? false;
  if (previousDescription === description) {
    return withMutationEnvelope(
      mutationOk({ target, previousDescription, description, written: false }),
      mutationNoopEnvelope("set_target_description", map.file.relativePath, dryRun)
    );
  }

  // @req FR-NODE-276 AC-1 — the one cell is replaced in place: re-rendering the row would also rewrite
  // the padding of the cells around it.
  const line = map.table.rowLines[index];
  const column = map.table.headers.indexOf("Description");
  const original = line === undefined ? undefined : map.file.lines[line - 1];
  const replacement = original === undefined || column < 0 ? undefined : replaceTableCell(original, column, previousDescription, description);
  if (line === undefined || original === undefined || replacement === undefined) {
    return mutationFail("MUTATION_DENIED", `Target Map row for ${target} has no Description cell to rewrite`);
  }
  const plan = createPatchPlan(map.file, [{ type: "replaceLine", line, original, replacement }]);
  const applied = await applyPatchPlan(plan, { dryRun });
  return withMutationEnvelope(
    mutationOk({ target, previousDescription, description, written: applied.written }),
    mutationEnvelopeFromPlan("set_target_description", plan, dryRun, applied.written)
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
  // @req FR-NODE-276 AC-4 — the description is used only when this call registers the row; dropping it
  // for a registered target lost the value with a success reply.
  if (targetExists && input.description !== undefined) {
    return mutationFail("USAGE", `Target is already registered: ${target}; change its description with set-target-description (MCP set_target_description), not set-active-target --description`);
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
