import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import type { MutationResult, PatchSummary, ProjectRoot } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { loadRecordWithWorkspace, planSectionRowsInsert } from "./internal.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";
import { todayStamp } from "../date-stamp.js";

// @req FR-NODE-061
/**
 * FR-NODE-061 (AC-2) — addChangeNote appends exactly one dated row to the
 * `Change Notes` table of a requirement with date, change, and reason cells,
 * preserving the existing rows. Every supplied cell is guarded by the shared
 * Markdown table cell safety helper (AC-3) so a pipe or newline yields
 * MUTATION_DENIED with no write. Unknown ids return NOT_FOUND (AC-4); dryRun
 * returns a patch summary and writes nothing (AC-5).
 */
export interface AddChangeNoteInput {
  id: string;
  /** `YYYY-MM-DD`; omitted, the writer's local date (FR-NODE-205 AC-7). */
  date?: string;
  change: string;
  reason: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface AddChangeNoteOutput {
  id: string;
  written: boolean;
}

function patchSummary(filePath: string, preview: string[], dryRun: boolean): PatchSummary {
  return { filePath, operations: 1, dryRun, preview };
}

// @req FR-NODE-061
// @req FR-MCP-049 AC-6 — the core holds the SRS mutation lock, so the CLI and the MCP tool both do.
export async function addChangeNote(
  root: ProjectRoot,
  input: AddChangeNoteInput
): Promise<MutationResult<AddChangeNoteOutput>> {
  // @req FR-NODE-205 AC-7 — the one default for every surface: the shared local-date helper.
  const dated = { ...input, date: input.date ?? todayStamp() };
  return withSrsMutationLock(root, { operation: "add_change_note", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    addChangeNoteUnlocked(root, dated)
  );
}

async function addChangeNoteUnlocked(
  root: ProjectRoot,
  input: AddChangeNoteInput & { date: string }
): Promise<MutationResult<AddChangeNoteOutput>> {
  const denied = assertSafeMarkdownTableCells<AddChangeNoteOutput>({
    "Change Notes date": input.date,
    "Change Notes change": input.change,
    "Change Notes reason": input.reason
  });
  if (denied) return denied;

  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);

  // @req FR-NODE-259 AC-1 @req FR-NODE-278 AC-1 AC-2 — under the table's own header, the table made when missing.
  const insert = planSectionRowsInsert(loaded.file, loaded.record, "Change Notes", [{ Date: input.date, Change: input.change, Reason: input.reason }]);
  if (!insert.ok) return mutationFail("MUTATION_DENIED", insert.message);
  const operations: PatchOperation[] = [insert.operation];
  const preview = insert.operation.type === "insertLines" ? insert.operation.lines : [];
  const plan = createPatchPlan(loaded.file, operations);
  const dryRun = input.dryRun ?? false;

  try {
    const applied = await applyPatchPlan(plan, { dryRun });
    return {
      ...mutationOk({ id: input.id, written: applied.written }),
      patch: patchSummary(applied.filePath, preview, dryRun)
    };
  } catch (error) {
    if (isStalePatchError(error)) {
      return mutationFail("STALE_PATCH", `target file changed before write: ${loaded.file.relativePath}`);
    }
    throw error;
  }
}
