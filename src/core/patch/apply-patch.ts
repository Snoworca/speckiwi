import { rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { renderPatchedLines, type PatchPlan } from "./patch-plan.js";

export interface PatchResult {
  written: boolean;
  filePath: string;
  preview: string[];
}

export async function applyPatchPlan(plan: PatchPlan, options: { dryRun: boolean }): Promise<PatchResult> {
  const lines = renderPatchedLines(plan);
  const text = `${lines.join(plan.file.newline)}${plan.file.text.endsWith(plan.file.newline) ? plan.file.newline : ""}`;
  const preview = lines.slice(0, 20);
  if (options.dryRun) {
    return { written: false, filePath: plan.file.path, preview };
  }
  const tmp = path.join(dirname(plan.file.path), `.speckiwi-${randomUUID()}.tmp`);
  await writeFile(tmp, text, "utf8");
  await rename(tmp, plan.file.path);
  return { written: true, filePath: plan.file.path, preview };
}
