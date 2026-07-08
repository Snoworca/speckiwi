import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import type { MutationResult, PatchSummary, ProjectRoot } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findSectionTableInsertionLine, loadRecordWithWorkspace } from "./internal.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";

// @req FR-NODE-049
/**
 * FR-NODE-049 (AC-2) — addChangeNote appends exactly one dated row to the
 * `Change Notes` table of a requirement with date, change, and reason cells,
 * preserving the existing rows. Every supplied cell is guarded by the shared
 * Markdown table cell safety helper (AC-3) so a pipe or newline yields
 * MUTATION_DENIED with no write. Unknown ids return NOT_FOUND (AC-4); dryRun
 * returns a patch summary and writes nothing (AC-5).
 */
export interface AddChangeNoteInput {
  id: string;
  date: string;
  change: string;
  reason: string;
  dryRun?: boolean;
}

export interface AddChangeNoteOutput {
  id: string;
  written: boolean;
}

function patchSummary(filePath: string, row: string, dryRun: boolean): PatchSummary {
  return { filePath, operations: 1, dryRun, preview: [row] };
}

// @req FR-NODE-049
export async function addChangeNote(
  root: ProjectRoot,
  input: AddChangeNoteInput
): Promise<MutationResult<AddChangeNoteOutput>> {
  const denied = assertSafeMarkdownTableCells<AddChangeNoteOutput>({
    "Change Notes date": input.date,
    "Change Notes change": input.change,
    "Change Notes reason": input.reason
  });
  if (denied) return denied;

  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);

  const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Change Notes");
  if (!insertLine) return mutationFail("MUTATION_DENIED", "Change Notes section not found for row append");

  const row = `| ${input.date} | ${input.change} | ${input.reason} |`;
  const operations: PatchOperation[] = [{ type: "insertLines", line: insertLine, lines: [row] }];
  const plan = createPatchPlan(loaded.file, operations);
  const dryRun = input.dryRun ?? false;

  try {
    const applied = await applyPatchPlan(plan, { dryRun });
    return {
      ...mutationOk({ id: input.id, written: applied.written }),
      patch: patchSummary(applied.filePath, row, dryRun)
    };
  } catch (error) {
    if (isStalePatchError(error)) {
      return mutationFail("STALE_PATCH", `target file changed before write: ${loaded.file.relativePath}`);
    }
    throw error;
  }
}
