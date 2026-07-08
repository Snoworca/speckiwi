import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type {
  MutationResult,
  ProjectRoot,
  RequirementRecord,
  StatusSummaryEntry,
  RequirementTypeSummaryEntry,
  SyncCountsCell,
  SyncCountsResult,
  TextFile
} from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";

// @req FR-NODE-050

/**
 * FR-NODE-050 — options for the syncCounts mutation. Defaults to a non-writing check
 * (apply omitted/false). `onBeforeWrite` is an injectable pre-write hook used to exercise
 * the patch-plan stale-snapshot guard (AC-5); it runs after the patch plan is built and
 * before the on-disk write, so a concurrent edit makes the snapshot stale.
 */
export interface SyncCountsOptions {
  apply?: boolean;
  onBeforeWrite?: () => void | Promise<void>;
}

/**
 * FR-NODE-050 — GLOBAL (cross-target, no target filter) count of a record field across the
 * full workspace record set. Shares the countsByStatus/countsByType arithmetic of
 * summarizeTarget but, per the requirement's Implementation Notes, selects ALL records with
 * no target filter (the index Status/Type summaries are cross-target totals).
 * @req FR-NODE-050
 */
function countBy(records: readonly RequirementRecord[], field: "status" | "type"): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = record[field];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * FR-NODE-050 — collect the drifting summary cells for one summary section. A cell drifts
 * when its declared (on-disk) count differs from the actual GLOBAL recount. Cells whose
 * declared count already equals the recount are omitted, so an in-sync section contributes
 * nothing and a settled file produces zero writes.
 * @req FR-NODE-050
 */
function collectDrift(
  section: "status" | "type",
  entries: ReadonlyArray<{ key: string; count: number; line: number | undefined }>,
  actual: Map<string, number>
): Array<SyncCountsCell & { line: number }> {
  const drifted: Array<SyncCountsCell & { line: number }> = [];
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key || entry.line === undefined) continue;
    const actualCount = actual.get(key) ?? 0;
    if (actualCount === entry.count) continue;
    drifted.push({ section, key, expected: entry.count, actual: actualCount, line: entry.line });
  }
  return drifted;
}

/**
 * FR-NODE-050 — rewrite the trailing count in a summary table row, preserving every other
 * character (cell labels, spacing, prefix column) so only the count value changes. The count
 * is the last pipe-delimited cell; its inner text is replaced with the actual count while the
 * surrounding whitespace of that cell is kept.
 * @req FR-NODE-050
 */
function rewriteCountInLine(line: string, actual: number): string {
  const lastPipe = line.lastIndexOf("|");
  const prevPipe = line.lastIndexOf("|", lastPipe - 1);
  if (prevPipe < 0 || lastPipe <= prevPipe) return line;
  const cell = line.slice(prevPipe + 1, lastPipe);
  const leading = cell.match(/^\s*/)?.[0] ?? "";
  const trailing = cell.match(/\s*$/)?.[0] ?? "";
  return `${line.slice(0, prevPipe + 1)}${leading}${actual}${trailing}${line.slice(lastPipe)}`;
}

/**
 * FR-NODE-050 — recompute the 00.index Status Summary and Requirement Type Summary count
 * cells from the FULL (cross-target) set of Requirement Block records. Defaults to a check
 * that reports each drifting cell as expected-vs-actual and writes nothing. With apply, it
 * rewrites only the drifting count cells in place (touching no other line, no Requirement
 * Block, and not the Active Target) and reuses the patch-plan stale-snapshot guard so a
 * concurrent edit yields a STALE_PATCH failure. When declared already equals actual it
 * performs zero write operations.
 * @req FR-NODE-050
 */
export async function syncCounts(
  root: ProjectRoot,
  options: SyncCountsOptions = {}
): Promise<MutationResult<SyncCountsResult>> {
  const workspace = await parseWorkspace(root);
  const indexFile: TextFile | undefined = workspace.files[0];
  if (!indexFile) return mutationFail("NOT_FOUND", "00.index.md not found");

  const statusActual = countBy(workspace.records, "status");
  const typeActual = countBy(workspace.records, "type");

  const statusEntries: ReadonlyArray<StatusSummaryEntry> = workspace.index.statusSummary ?? [];
  const typeEntries: ReadonlyArray<RequirementTypeSummaryEntry> = workspace.index.requirementTypeSummary ?? [];

  const drift = [
    ...collectDrift(
      "status",
      statusEntries.map((entry) => ({ key: entry.status, count: entry.count, line: entry.line })),
      statusActual
    ),
    ...collectDrift(
      "type",
      typeEntries.map((entry) => ({ key: entry.type, count: entry.count, line: entry.line })),
      typeActual
    )
  ];

  const cells: SyncCountsCell[] = drift.map(({ section, key, expected, actual }) => ({ section, key, expected, actual }));

  // Check mode (default) or nothing drifting: report cells, write nothing.
  if (options.apply !== true || drift.length === 0) {
    return mutationOk({ written: false, cells });
  }

  const operations: PatchOperation[] = drift.map((cell) => {
    const original = indexFile.lines[cell.line - 1] ?? "";
    return {
      type: "replaceLine",
      line: cell.line,
      original,
      replacement: rewriteCountInLine(original, cell.actual)
    };
  });

  const plan = createPatchPlan(indexFile, operations);
  // AC-5: run the injected pre-write hook before applyPatchPlan's own stale check so a
  // concurrent edit diverges the on-disk sha from the snapshot, tripping STALE_PATCH.
  if (options.onBeforeWrite) await options.onBeforeWrite();

  try {
    const applied = await applyPatchPlan(plan, { dryRun: false });
    return mutationOk({ written: applied.written, cells });
  } catch (error) {
    if (isStalePatchError(error)) {
      return mutationFail("STALE_PATCH", error.message) as MutationResult<SyncCountsResult>;
    }
    throw error;
  }
}
