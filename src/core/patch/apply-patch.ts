import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { retryBusy } from "../lock/busy-retry.js";
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

/** The document text a plan renders, and whether it differs from the text the plan was made from. */
export function renderPlanText(plan: PatchPlan): { lines: string[]; text: string; changed: boolean } {
  const lines = renderPatchedLines(plan);
  const text = `${lines.join(plan.file.newline)}${plan.file.text.endsWith(plan.file.newline) ? plan.file.newline : ""}`;
  return { lines, text, changed: text !== plan.file.text };
}

export async function applyPatchPlan(plan: PatchPlan, options: { dryRun: boolean; staleCheck?: boolean }): Promise<PatchResult> {
  const { lines, text, changed } = renderPlanText(plan);
  const preview = lines.slice(0, 20);
  // A plan that renders the text it was made from changes nothing, so the document is not replaced
  // and the write is reported as not done.
  if (options.dryRun || !changed) {
    return { written: false, filePath: plan.file.path, preview };
  }
  if (options.staleCheck !== false) {
    await assertFreshSnapshot(plan);
  }
  await replaceFileAtomically(plan.file.path, text);
  return { written: true, filePath: plan.file.path, preview };
}

/**
 * Writes `text` to a temporary file beside `filePath` and renames it over the target, so a reader
 * never sees a half-written document. The target is created when it does not exist.
 */
export async function replaceFileAtomically(filePath: string, text: string): Promise<void> {
  const tmp = path.join(dirname(filePath), `.speckiwi-${randomUUID()}.tmp`);
  await writeFile(tmp, text, "utf8");
  try {
    // Windows reports a target a scanner briefly holds as EPERM/EBUSY; the shared short retry absorbs it.
    await retryBusy(() => rename(tmp, filePath));
  } catch (error) {
    // The target was not replaced, so the temporary copy must not stay beside it.
    await rm(tmp, { force: true });
    throw error;
  }
}
