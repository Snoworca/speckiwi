import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findRequirementStatementRange, loadRecordWithWorkspace } from "./internal.js";

// @req FR-NODE-025
/**
 * FR-NODE-025 — update_requirement_statement mutation.
 * Re-declares MAX/CONTROL constants intentionally (kept in sync with append-section-note).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
const MAX_TEXT_LENGTH = 2000;

export interface UpdateRequirementStatementInput {
  id: string;
  text: string;
  dryRun?: boolean;
}

export interface UpdateRequirementStatementOutput {
  id: string;
  written: boolean;
}

// @req FR-NODE-025
/**
 * Replaces the prose statement of a requirement's `#### Requirement` section with `text`.
 * Uses findRequirementStatementRange so only the first prose paragraph is replaced, leaving
 * the Acceptance Criteria section and any adjacent GFM tables or fenced code blocks intact.
 */
export async function updateRequirementStatement(
  root: ProjectRoot,
  input: UpdateRequirementStatementInput
): Promise<MutationResult<UpdateRequirementStatementOutput>> {
  if (typeof input.text !== "string" || input.text.length === 0) {
    return mutationFail("USAGE", "text is required");
  }
  if (input.text.length > MAX_TEXT_LENGTH) {
    return mutationFail("USAGE", `text exceeds ${MAX_TEXT_LENGTH} UTF-16 code units`);
  }
  if (CONTROL_CHAR_RE.test(input.text)) {
    return mutationFail("USAGE", "text contains forbidden control characters (only TAB/LF/CR allowed)");
  }

  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);

  const range = findRequirementStatementRange(loaded.file, loaded.record);
  if (!range) return mutationFail("MUTATION_DENIED", `cannot locate Requirement statement for '${input.id}'`);

  const operations: PatchOperation[] = [];
  for (let line = range.startLine; line <= range.endLine; line += 1) {
    const original = loaded.file.lines[line - 1];
    if (original === undefined) continue;
    if (line === range.startLine) {
      operations.push({ type: "replaceLine", line, original, replacement: input.text });
    } else {
      operations.push({ type: "replaceLine", line, original, replacement: "" });
    }
  }

  if (operations.length === 0) {
    return mutationOk({ id: input.id, written: false });
  }

  const plan = createPatchPlan(loaded.file, operations);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  // Attach a patch summary so callers (e.g. the IR-CLI-040 CLI command) can surface a
  // dry-run preview without re-deriving the plan. Mirrors add-requirement's envelope.
  return { ...mutationOk({ id: input.id, written: applied.written }), patch: summarizePatch(plan, dryRun) };
}
