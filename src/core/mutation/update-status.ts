import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan } from "../patch/patch-plan.js";
import type { MutationResult, ProjectRoot, RequirementStatus } from "../types.js";
import { isRequirementStatus } from "../schema.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findMetadataLine, loadRecord } from "./internal.js";

export interface UpdateStatusInput {
  id: string;
  status: RequirementStatus;
  dryRun?: boolean;
}

export async function updateStatus(root: ProjectRoot, input: UpdateStatusInput): Promise<MutationResult> {
  if (!isRequirementStatus(input.status)) return mutationFail("USAGE", `Invalid status: ${input.status}`);
  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const nextRecord = { ...loaded.record, status: input.status };
  if (
    input.status === "verified" &&
    !(
      nextRecord.acceptanceCriteria.length > 0 &&
      nextRecord.acceptanceCriteria.every((criterion) => criterion.checked) &&
      nextRecord.verificationEvidence.some((row) => row.reference.trim() !== "")
    )
  ) {
    return mutationFail("MUTATION_DENIED", "Cannot mark verified without checked AC and evidence");
  }
  const line = findMetadataLine(loaded.file, loaded.record, "Status");
  if (!line) return mutationFail("MUTATION_DENIED", "Status metadata row not found");
  const original = loaded.file.lines[line - 1];
  if (original === undefined) return mutationFail("MUTATION_DENIED", "Status metadata row is outside file");
  const plan = createPatchPlan(loaded.file, [{ type: "replaceLine", line, original, replacement: `| Status | ${input.status} |` }]);
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });
  return mutationOk({ id: input.id, status: input.status, written: applied.written });
}
