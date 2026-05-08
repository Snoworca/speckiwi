import type { PatchSummary } from "../types.js";
import type { PatchPlan } from "./patch-plan.js";

export function summarizePatch(plan: PatchPlan, dryRun: boolean): PatchSummary {
  return {
    filePath: plan.file.relativePath,
    operations: plan.operations.length,
    dryRun,
    preview: plan.operations.map((operation) => operation.type)
  };
}
