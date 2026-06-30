import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, patchSummaryFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { REQUIREMENT_STATUSES, REQUIREMENT_TYPES, TYPE_PREFIX, type MutationResult, type ProjectRoot, type RequirementType, type TextFile } from "../types.js";
import { withSrsMutationLock } from "./srs-lock.js";

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

interface TableLocation {
  headingLine: number;
  insertLine: number;
}

function findHeading(lines: readonly string[], title: string): number | undefined {
  const pattern = new RegExp(`^##\\s+\\d+\\.\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const index = lines.findIndex((line) => pattern.test(line.trim()));
  return index >= 0 ? index + 1 : undefined;
}

function findTableLocation(file: TextFile, title: string, rowLines: Array<{ line?: number }>): TableLocation | undefined {
  const headingLine = findHeading(file.lines, title);
  if (!headingLine) return undefined;
  const lastRowLine = Math.max(0, ...rowLines.map((row) => row.line ?? 0));
  if (lastRowLine > 0) return { headingLine, insertLine: lastRowLine + 1 };
  for (let line = headingLine + 1; line <= file.lines.length; line += 1) {
    const text = file.lines[line - 1] ?? "";
    if (line > headingLine + 1 && !text.trim().startsWith("|")) return { headingLine, insertLine: line };
  }
  return { headingLine, insertLine: file.lines.length + 1 };
}

function replaceLine(file: TextFile, line: number, replacement: string): PatchOperation | undefined {
  const original = file.lines[line - 1];
  if (original === undefined || original === replacement) return undefined;
  return { type: "replaceLine", line, original, replacement };
}

function insertLines(file: TextFile, line: number, lines: string[]): PatchOperation | undefined {
  if (lines.length === 0) return undefined;
  const operation: PatchOperation = { type: "insertLines", line, lines };
  const expectedBefore = file.lines[line - 2];
  if (expectedBefore !== undefined) operation.expectedBefore = expectedBefore;
  const expectedAfter = file.lines[line - 1];
  if (expectedAfter !== undefined) operation.expectedAfter = expectedAfter;
  return operation;
}

function statusOperations(file: TextFile, entries: NonNullable<Awaited<ReturnType<typeof parseWorkspace>>["index"]["statusSummary"]>, actual: Map<string, number>): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const existing = new Set(entries.map((entry) => entry.status));
  for (const entry of entries) {
    if (typeof entry.line !== "number") continue;
    const operation = replaceLine(file, entry.line, `| ${entry.status} | ${actual.get(entry.status) ?? 0} |`);
    if (operation) operations.push(operation);
  }
  const missing = REQUIREMENT_STATUSES.filter((status) => !existing.has(status) && (actual.get(status) ?? 0) > 0).map((status) => `| ${status} | ${actual.get(status) ?? 0} |`);
  const location = findTableLocation(file, "Status Summary", entries);
  const insert = location ? insertLines(file, location.insertLine, missing) : undefined;
  if (insert) operations.push(insert);
  return operations;
}

function typeOperations(file: TextFile, entries: NonNullable<Awaited<ReturnType<typeof parseWorkspace>>["index"]["requirementTypeSummary"]>, actual: Map<string, number>): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const existing = new Set(entries.map((entry) => entry.type));
  for (const entry of entries) {
    if (typeof entry.line !== "number") continue;
    const prefix = entry.prefix || TYPE_PREFIX[entry.type as RequirementType] || "";
    const operation = replaceLine(file, entry.line, `| ${entry.type} | ${prefix} | ${actual.get(entry.type) ?? 0} |`);
    if (operation) operations.push(operation);
  }
  const missing = REQUIREMENT_TYPES.filter((type) => !existing.has(type) && (actual.get(type) ?? 0) > 0).map((type) => `| ${type} | ${TYPE_PREFIX[type]} | ${actual.get(type) ?? 0} |`);
  const location = findTableLocation(file, "Requirement Type Summary", entries);
  const insert = location ? insertLines(file, location.insertLine, missing) : undefined;
  if (insert) operations.push(insert);
  return operations;
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
  const statusSummaryOps = workspace.index.statusSummary ? statusOperations(file, workspace.index.statusSummary, statusCounts) : [];
  const typeSummaryOps = workspace.index.requirementTypeSummary ? typeOperations(file, workspace.index.requirementTypeSummary, typeCounts) : [];
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
