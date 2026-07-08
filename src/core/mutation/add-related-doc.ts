import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import type { MutationResult, PatchSummary, ProjectRoot } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findMetadataLine, loadRecordWithWorkspace } from "./internal.js";
import { assertSafeMarkdownTableCell } from "./table-cell.js";

// @req FR-NODE-061
/**
 * FR-NODE-061 (AC-1) — addRelatedDoc appends one document reference to the
 * `Related Docs` metadata value of a requirement and rewrites only that single
 * metadata line. The placeholder `-` is replaced by the supplied reference;
 * an existing comma-separated value gets the reference appended. The reference
 * is guarded by the shared Markdown table cell safety helper (AC-3) so a pipe
 * or newline yields MUTATION_DENIED with no write. Unknown ids return NOT_FOUND
 * (AC-4); dryRun returns a patch summary and writes nothing (AC-5).
 */
export interface AddRelatedDocInput {
  id: string;
  reference: string;
  dryRun?: boolean;
}

export interface AddRelatedDocOutput {
  id: string;
  reference: string;
  written: boolean;
}

function patchSummary(filePath: string, replacement: string, dryRun: boolean): PatchSummary {
  return { filePath, operations: 1, dryRun, preview: [replacement] };
}

// @req FR-NODE-061
export async function addRelatedDoc(
  root: ProjectRoot,
  input: AddRelatedDocInput
): Promise<MutationResult<AddRelatedDocOutput>> {
  const denied = assertSafeMarkdownTableCell<AddRelatedDocOutput>("Related Docs reference", input.reference);
  if (denied) return denied;

  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);

  const metadataLine = findMetadataLine(loaded.file, loaded.record, "Related Docs");
  if (!metadataLine) return mutationFail("MUTATION_DENIED", "Related Docs metadata row not found");
  const original = loaded.file.lines[metadataLine - 1];
  if (original === undefined) return mutationFail("MUTATION_DENIED", "Related Docs metadata row is outside file");

  const current = parseMetadataValue(original);
  const replacement = `| Related Docs | ${appendReference(current, input.reference)} |`;
  const operations: PatchOperation[] = [{ type: "replaceLine", line: metadataLine, original, replacement }];
  const plan = createPatchPlan(loaded.file, operations);
  const dryRun = input.dryRun ?? false;

  try {
    const applied = await applyPatchPlan(plan, { dryRun });
    return {
      ...mutationOk({ id: input.id, reference: input.reference, written: applied.written }),
      patch: patchSummary(applied.filePath, replacement, dryRun)
    };
  } catch (error) {
    if (isStalePatchError(error)) {
      return mutationFail("STALE_PATCH", `target file changed before write: ${loaded.file.relativePath}`);
    }
    throw error;
  }
}

function parseMetadataValue(line: string): string {
  const match = line.match(/^\|\s*Related Docs\s*\|\s*(.*?)\s*\|\s*$/);
  return match?.[1]?.trim() ?? "";
}

function appendReference(current: string, reference: string): string {
  if (current === "" || current === "-") return reference;
  return `${current}, ${reference}`;
}
