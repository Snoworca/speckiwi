import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, patchSummaryFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { REQUIREMENT_STATUSES, REQUIREMENT_TYPES, TYPE_PREFIX, type Diagnostic, type MutationResult, type ProjectRoot, type RequirementType, type RollupSyncFailure, type TextFile } from "../types.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { findHeadingMatching } from "../parser/index-parser.js";
import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { parseMarkdownTable, type ParsedTable } from "../parser/table.js";
import { planTableRowsInsert, planTableRowUpdate } from "./internal.js";

export interface SyncIndexRollupsInput {
  dryRun?: boolean;
  expectedSha256?: string;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface SyncIndexRollupsOutput {
  filePath: string;
  written: boolean;
  statusSummaryChanged: boolean;
  typeSummaryChanged: boolean;
  statusCounts: Record<string, number>;
  typeCounts: Record<string, number>;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function recordCounts<T extends string>(order: readonly T[], counts: Map<string, number>): Record<string, number> {
  const output: Record<string, number> = {};
  for (const key of order) output[key] = counts.get(key) ?? 0;
  for (const [key, count] of counts) {
    if (!(key in output)) output[key] = count;
  }
  return output;
}

function staleFailure<T>(filePath: string, expectedSha256?: string, actualSha256?: string): MutationResult<T> {
  const message = `Mutation snapshot is stale for ${filePath}; rerun the command to retry against the latest file.`;
  const staleDiagnostic = diagnostic("SRS-E032", "error", message, { filePath }, { expectedSha256, actualSha256 });
  return mutationFail("STALE_PATCH", message, [staleDiagnostic], { staleGuard: { filePath, retry: "rerun sync-index" } }) as MutationResult<T>;
}

/** The two rollup tables: the columns that hold the rollup itself, and the one a table may leave out. */
const ROLLUP_TABLES = {
  status: { title: "Status Summary", keyColumn: "Status", required: ["Status", "Count"], optional: [] as string[] },
  type: { title: "Requirement Type Summary", keyColumn: "Type", required: ["Type", "Count"], optional: ["Prefix"] }
} as const;

type RollupSpec = (typeof ROLLUP_TABLES)[keyof typeof ROLLUP_TABLES];

function rollupTable(file: TextFile, title: string): ParsedTable | undefined {
  const heading = findHeadingMatching(file.lines, new RegExp(`^##\\s+\\d+\\.\\s+${title}$`));
  return heading >= 0 ? parseMarkdownTable(file.lines, heading + 1) : undefined;
}

/**
 * Whether the index rollups can be synced at all, decided from the tables alone, before any mutation
 * writes: every rollup table that exists has its key and Count columns. Only what makes the sync refuse
 * whatever the counts are is checked here; a refusal that depends on the counts (a cut row the sync
 * would have to rewrite) is left to the sync, which a mutation runs after its write through
 * {@link syncIndexRollupsAfterWrite}.
 */
export function checkIndexRollupsWritable(indexFile: TextFile): string | undefined {
  for (const spec of Object.values(ROLLUP_TABLES)) {
    const table = rollupTable(indexFile, spec.title);
    if (!table) continue;
    const missing = spec.required.filter((column) => !table.headers.includes(column));
    if (missing.length > 0) return `${spec.title} table has no ${missing.join(", ")} column, so the index rollups cannot be synced; nothing was written`;
  }
  return undefined;
}

/** Reads the index and applies {@link checkIndexRollupsWritable}. */
export async function checkIndexRollupsWritableAt(root: ProjectRoot): Promise<string | undefined> {
  return checkIndexRollupsWritable(await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root));
}

/**
 * One rollup table, rewritten through the shared row writer: each row by the table's own header at
 * the line the parser read it from, and each missing key appended after the last row. Only a row whose
 * count (or empty Prefix) is wrong is rewritten, so an already correct row keeps its own spelling.
 */
function rollupOperations(
  file: TextFile,
  spec: RollupSpec,
  keys: readonly string[],
  actual: Map<string, number>,
  extraCells: (key: string) => Record<string, string> = () => ({})
): { ok: true; operations: PatchOperation[] } | { ok: false; message: string } {
  const { keyColumn, optional } = spec;
  const table = rollupTable(file, spec.title);
  if (!table) return { ok: true, operations: [] };
  const operations: PatchOperation[] = [];
  const present = new Set<string>();
  for (const [index, row] of table.rows.entries()) {
    const key = (row[keyColumn] ?? "").trim();
    present.add(key);
    const updates: Record<string, string> = {};
    const count = String(actual.get(key) ?? 0);
    if ((row.Count ?? "").trim() !== count) updates.Count = count;
    // An empty cell is filled only when there is a value to fill it with; an unknown key has none.
    for (const [column, value] of Object.entries(extraCells(key))) {
      if (value && !(row[column] ?? "").trim()) updates[column] = value;
    }
    if (Object.keys(updates).length === 0) continue;
    const write = planTableRowUpdate(file, table, index, updates, { optional });
    if (!write.ok) return write;
    if (write.operation.type !== "replaceLine" || write.operation.replacement !== write.operation.original) operations.push(write.operation);
  }
  const missing = keys.filter((key) => !present.has(key) && (actual.get(key) ?? 0) > 0);
  if (missing.length > 0) {
    const insert = planTableRowsInsert(file, table, missing.map((key) => ({ [keyColumn]: key, ...extraCells(key), Count: String(actual.get(key) ?? 0) })), { optional });
    if (!insert.ok) return insert;
    operations.push(insert.operation);
  }
  return { ok: true, operations };
}

/** The rollup sync a mutation runs after its own write, as the mutation reports it. */
export interface RollupSyncAfterWrite {
  /** The result fields to spread into the mutation's result: `indexSync` on success, `rollupSync` on failure. */
  fields: { indexSync?: SyncIndexRollupsOutput; rollupSync?: RollupSyncFailure };
  diagnostics: Diagnostic[];
}

/**
 * Runs the rollup sync after a mutation has written. The mutation's change is already in the document,
 * so a sync that fails (the index changed underneath, or a row it has to rewrite is cut) does not turn
 * the mutation into a failure: it is reported as `rollupSync` with a warning saying how to catch up.
 */
export async function syncIndexRollupsAfterWrite(root: ProjectRoot): Promise<RollupSyncAfterWrite> {
  const synced = await syncIndexRollups(root, { skipLock: true });
  if (synced.ok) return { fields: synced.value ? { indexSync: synced.value } : {}, diagnostics: synced.diagnostics };
  const code = synced.error?.code ?? "MUTATION_DENIED";
  const message = synced.error?.message ?? "index rollup sync failed";
  const warning: Diagnostic = {
    code: "INDEX_ROLLUP_SYNC_FAILED",
    severity: "warning",
    message: `The change was written, but the index rollups were not updated (${code}: ${message}). Run speckiwi sync-index to update them.`,
    filePath: "docs/spec/00.index.md"
  };
  return { fields: { rollupSync: { ok: false, code, message } }, diagnostics: [warning] };
}

export async function syncIndexRollups(root: ProjectRoot, input: SyncIndexRollupsInput = {}): Promise<MutationResult<SyncIndexRollupsOutput>> {
  return withSrsMutationLock(root, { operation: "sync_index_rollups", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => syncIndexRollupsUnlocked(root, input));
}

async function syncIndexRollupsUnlocked(root: ProjectRoot, input: SyncIndexRollupsInput = {}): Promise<MutationResult<SyncIndexRollupsOutput>> {
  const workspace = await parseWorkspace(root);
  const file = workspace.files.find((candidate) => candidate.relativePath === "docs/spec/00.index.md");
  if (!file) return mutationFail("NOT_FOUND", "SRS index not found: docs/spec/00.index.md");
  if (input.expectedSha256 && file.snapshot?.sha256 && input.expectedSha256 !== file.snapshot.sha256) {
    return staleFailure(file.relativePath, input.expectedSha256, file.snapshot.sha256);
  }
  const statusCounts = countBy(workspace.records.map((record) => record.status));
  const typeCounts = countBy(workspace.records.map((record) => record.type));
  const status = rollupOperations(file, ROLLUP_TABLES.status, REQUIREMENT_STATUSES, statusCounts);
  if (!status.ok) return mutationFail("MUTATION_DENIED", `Status Summary: ${status.message}`);
  const type = rollupOperations(file, ROLLUP_TABLES.type, REQUIREMENT_TYPES, typeCounts, (key) => ({ Prefix: TYPE_PREFIX[key as RequirementType] ?? "" }));
  if (!type.ok) return mutationFail("MUTATION_DENIED", `Requirement Type Summary: ${type.message}`);
  const statusSummaryOps = status.operations;
  const typeSummaryOps = type.operations;
  const operations = [...statusSummaryOps, ...typeSummaryOps];
  const dryRun = input.dryRun ?? false;
  const valueBase = {
    filePath: file.relativePath,
    statusSummaryChanged: statusSummaryOps.length > 0,
    typeSummaryChanged: typeSummaryOps.length > 0,
    statusCounts: recordCounts(REQUIREMENT_STATUSES, statusCounts),
    typeCounts: recordCounts(REQUIREMENT_TYPES, typeCounts)
  };
  if (operations.length === 0) {
    return withMutationEnvelope(
      mutationOk({ ...valueBase, written: false }),
      mutationNoopEnvelope("sync_index_rollups", file.relativePath, dryRun),
      { filePath: file.relativePath, operations: 0, dryRun, preview: [] }
    );
  }
  const plan = createPatchPlan(file, operations);
  try {
    const applied = await applyPatchPlan(plan, { dryRun });
    return withMutationEnvelope(
      mutationOk({ ...valueBase, written: applied.written }),
      mutationEnvelopeFromPlan("sync_index_rollups", plan, dryRun, applied.written),
      patchSummaryFromPlan(plan, dryRun)
    );
  } catch (error) {
    if (isStalePatchError(error)) return staleFailure(file.relativePath);
    throw error;
  }
}
