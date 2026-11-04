import { readFile, writeFile } from "node:fs/promises";
import { retryBusy } from "../lock/busy-retry.js";
import { applyPatchPlan, assertFreshSnapshot, renderPlanText } from "./apply-patch.js";
import type { PatchPlan } from "./patch-plan.js";

// @req FR-NODE-243 AC-7 — one change to several documents, all or nothing. Every plan is rendered and
// checked against its snapshot before the first write, so a broken operation or a document changed
// underneath refuses the whole change (a dryRun refuses it the same way); a write that fails part-way
// puts every document already written back to its original bytes and rethrows, so no caller is left
// with half a change.

export interface PlansResult {
  /** True when at least one document was written. */
  readonly written: boolean;
}

/** A failed change whose restore also failed: these documents still hold the partial change. */
export class PlansRestoreError extends Error {
  readonly unrestored: string[];

  constructor(unrestored: string[], cause: unknown) {
    super(`A multi-document change failed and these documents could not be restored: ${unrestored.join(", ")}`, { cause });
    this.name = "PlansRestoreError";
    this.unrestored = unrestored;
  }
}

export async function applyPatchPlans(plans: readonly PatchPlan[], options: { dryRun: boolean }): Promise<PlansResult> {
  // Two plans for one document would each be rendered from the same snapshot, so the second write
  // would silently undo the first. That is a caller bug, refused before anything is written.
  const paths = plans.map((plan) => plan.file.path);
  const repeated = paths.find((filePath, index) => paths.indexOf(filePath) !== index);
  if (repeated !== undefined) throw new Error(`applyPatchPlans got two plans for the same document: ${repeated}; merge their operations into one plan`);
  // A document whose rendered text equals its current text has nothing to write and is left alone.
  const changed = plans.filter((plan) => renderPlanText(plan).changed);
  if (options.dryRun) return { written: false };
  for (const plan of changed) await assertFreshSnapshot(plan);
  const done: { filePath: string; original: Buffer }[] = [];
  try {
    for (const plan of changed) {
      const original = await readFile(plan.file.path);
      await applyPatchPlan(plan, { dryRun: false, staleCheck: false });
      done.push({ filePath: plan.file.path, original });
    }
  } catch (error) {
    const unrestored: string[] = [];
    for (const { filePath, original } of done.reverse()) {
      // Windows reports a document a scanner briefly holds as EPERM/EBUSY; the shared retry absorbs it.
      await retryBusy(() => writeFile(filePath, original)).catch(() => unrestored.push(filePath));
    }
    if (unrestored.length > 0) throw new PlansRestoreError(unrestored, error);
    throw error;
  }
  return { written: done.length > 0 };
}
