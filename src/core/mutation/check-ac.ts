import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
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
