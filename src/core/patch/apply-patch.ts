import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createTextFileSnapshot } from "../fs/read-text.js";
import { renderPatchedLines, type PatchPlan } from "./patch-plan.js";
import type { TextFileSnapshot } from "../types.js";

export interface PatchResult {
  written: boolean;
  filePath: string;
  preview: string[];
}

export class StalePatchError extends Error {
  readonly code = "STALE_PATCH";

  constructor(readonly filePath: string) {
    super(`Stale patch: target file changed before write: ${filePath}`);
  }
}

export function isStalePatchError(error: unknown): error is StalePatchError {
  return error instanceof StalePatchError || (error instanceof Error && "code" in error && (error as { code?: string }).code === "STALE_PATCH");
}

function snapshotsMatch(expected: TextFileSnapshot, current: TextFileSnapshot): boolean {
  return expected.sha256 === current.sha256 && expected.size === current.size;
}

async function readCurrentSnapshot(filePath: string): Promise<TextFileSnapshot> {
  try {
    const [text, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return createTextFileSnapshot(text, stats);
  } catch {
    throw new StalePatchError(filePath);
  }
}

export async function assertFreshSnapshot(plan: PatchPlan): Promise<void> {
  const expected = plan.file.snapshot ?? createTextFileSnapshot(plan.file.text);
  const current = await readCurrentSnapshot(plan.file.path);
  if (!snapshotsMatch(expected, current)) {
    throw new StalePatchError(plan.file.relativePath);
  }
}

export async function applyPatchPlan(plan: PatchPlan, options: { dryRun: boolean; staleCheck?: boolean }): Promise<PatchResult> {
  const lines = renderPatchedLines(plan);
  const text = `${lines.join(plan.file.newline)}${plan.file.text.endsWith(plan.file.newline) ? plan.file.newline : ""}`;
  const preview = lines.slice(0, 20);
  if (options.dryRun) {
    return { written: false, filePath: plan.file.path, preview };
  }
  if (options.staleCheck !== false) {
    await assertFreshSnapshot(plan);
  }
  const tmp = path.join(dirname(plan.file.path), `.speckiwi-${randomUUID()}.tmp`);
  await writeFile(tmp, text, "utf8");
  await rename(tmp, plan.file.path);
  return { written: true, filePath: plan.file.path, preview };
}
