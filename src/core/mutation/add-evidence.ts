import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan } from "../patch/patch-plan.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findSectionTableInsertionLine, loadRecord } from "./internal.js";

export interface AddEvidenceInput {
  id: string;
  type: string;
  reference: string;
  covers?: string;
  notes?: string;
  dryRun?: boolean;
}

export async function addVerificationEvidence(root: ProjectRoot, input: AddEvidenceInput): Promise<MutationResult> {
  if (!input.reference.trim()) return mutationFail("USAGE", "Evidence reference is required");
  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const next = `VE-${loaded.record.verificationEvidence.length + 1}`;
  const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Verification Evidence");
  if (!insertLine) return mutationFail("MUTATION_DENIED", "Verification Evidence table not found");
  const row = `| ${next} | ${input.type} | ${input.reference} | ${input.covers ?? "all"} | ${input.notes ?? "-"} |`;
  const applied = await applyPatchPlan(createPatchPlan(loaded.file, [{ type: "insertLines", line: insertLine, lines: [row] }]), { dryRun: input.dryRun ?? false });
  return mutationOk({ id: input.id, evidenceId: next, written: applied.written });
}
