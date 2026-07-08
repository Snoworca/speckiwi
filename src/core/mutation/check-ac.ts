import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { loadRecord } from "./internal.js";
import { withSrsMutationLock } from "./srs-lock.js";

export interface SetAcCheckedInput {
  id: string;
  acIds: string[];
  checked: boolean;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export async function setAcceptanceCriteriaChecked(root: ProjectRoot, input: SetAcCheckedInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "check_acceptance_criteria", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => setAcceptanceCriteriaCheckedUnlocked(root, input));
}

async function setAcceptanceCriteriaCheckedUnlocked(root: ProjectRoot, input: SetAcCheckedInput): Promise<MutationResult> {
  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const all = input.acIds.includes("all");
  const selected = loaded.record.acceptanceCriteria.filter((criterion) => all || input.acIds.includes(criterion.id));
  if (selected.length === 0) return mutationFail("MUTATION_DENIED", "No matching Acceptance Criteria");
  const operations: PatchOperation[] = selected.map((criterion) => {
    const original = loaded.file.lines[criterion.line - 1] ?? "";
    return {
      type: "replaceLine",
      line: criterion.line,
      original,
      replacement: original.replace(/-\s+\[( |x|X)]/, `- [${input.checked ? "x" : " "}]`)
    };
  });
  const dryRun = input.dryRun ?? false;
  const plan = createPatchPlan(loaded.file, operations);
  const applied = await applyPatchPlan(plan, { dryRun });
  return withMutationEnvelope(
    mutationOk({ id: input.id, acIds: selected.map((criterion) => criterion.id), checked: input.checked, written: applied.written }),
    mutationEnvelopeFromPlan("check_acceptance_criteria", plan, dryRun, applied.written)
  );
}

// FR-NODE-026 — edit_acceptance_criteria mutation.
//
// Replaces the prose text of a single targeted acceptance criterion, preserving its
// checked/unchecked state and its `AC-N:` id prefix, and leaving sibling criteria and every
// other section (Requirement statement, Trace Links, …) byte-for-byte intact. `text` is
// written verbatim onto the AC line, so it is rejected (USAGE, no write) when empty, over the
// maximum length, or carrying a newline / control character that would corrupt the row (FND-005).

// eslint-disable-next-line no-control-regex
const AC_UNSAFE_TEXT_RE = /[\x00-\x1F\x7F]/;
const MAX_AC_TEXT_LENGTH = 2000;

export interface EditAcceptanceCriteriaInput {
  id: string;
  acId: string;
  text: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export async function editAcceptanceCriteria(root: ProjectRoot, input: EditAcceptanceCriteriaInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "edit_acceptance_criteria", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => editAcceptanceCriteriaUnlocked(root, input));
}

async function editAcceptanceCriteriaUnlocked(root: ProjectRoot, input: EditAcceptanceCriteriaInput): Promise<MutationResult> {
  if (typeof input.text !== "string" || input.text.length === 0) {
    return mutationFail("USAGE", "text is required");
  }
  if (input.text.length > MAX_AC_TEXT_LENGTH) {
    return mutationFail("USAGE", `text exceeds ${MAX_AC_TEXT_LENGTH} UTF-16 code units`);
  }
  if (AC_UNSAFE_TEXT_RE.test(input.text)) {
    return mutationFail("USAGE", "text contains forbidden newline or control characters");
  }

  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const criterion = loaded.record.acceptanceCriteria.find((entry) => entry.id === input.acId);
  if (!criterion) return mutationFail("MUTATION_DENIED", `Acceptance Criterion not found: ${input.acId}`);

  const original = loaded.file.lines[criterion.line - 1];
  if (original === undefined) return mutationFail("MUTATION_DENIED", "Acceptance Criterion line is outside file");
  const marker = `${criterion.id}:`;
  const markerIndex = original.indexOf(marker);
  if (markerIndex < 0) return mutationFail("MUTATION_DENIED", `Acceptance Criterion prefix not found for ${input.acId}`);
  const prefix = original.slice(0, markerIndex + marker.length);
  const replacement = `${prefix} ${input.text}`;

  const dryRun = input.dryRun ?? false;
  const plan = createPatchPlan(loaded.file, [{ type: "replaceLine", line: criterion.line, original, replacement }]);
  const applied = await applyPatchPlan(plan, { dryRun });
  return {
    ...withMutationEnvelope(
      mutationOk({ id: input.id, acId: input.acId, written: applied.written }),
      mutationEnvelopeFromPlan("edit_acceptance_criteria", plan, dryRun, applied.written)
    ),
    patch: summarizePatch(plan, dryRun)
  };
}
