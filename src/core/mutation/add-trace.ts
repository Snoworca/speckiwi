import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan } from "../patch/patch-plan.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findSectionTableInsertionLine, loadRecord } from "./internal.js";

export interface AddTraceInput {
  id: string;
  type: string;
  reference: string;
  relation: string;
  notes?: string;
  dryRun?: boolean;
}

export async function addTraceLink(root: ProjectRoot, input: AddTraceInput): Promise<MutationResult> {
  const workspace = await parseWorkspace(root);
  if (input.type === "Requirement" && !workspace.records.some((record) => record.id === input.reference)) {
    return mutationFail("MUTATION_DENIED", `Trace target not found: ${input.reference}`);
  }
  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Trace Links");
  if (!insertLine) return mutationFail("MUTATION_DENIED", "Trace Links table not found");
  const row = `| ${input.type} | ${input.reference} | ${input.relation} | ${input.notes ?? "-"} |`;
  const applied = await applyPatchPlan(createPatchPlan(loaded.file, [{ type: "insertLines", line: insertLine, lines: [row] }]), { dryRun: input.dryRun ?? false });
  return mutationOk({ id: input.id, reference: input.reference, written: applied.written });
}
