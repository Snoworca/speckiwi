import { existsSync } from "node:fs";
import { assertFreshSnapshot, renderPlanText, StalePatchError } from "./apply-patch.js";
import { runFileTransaction } from "./file-transaction.js";
import type { PatchPlan } from "./patch-plan.js";

// @req FR-NODE-243 AC-7 — one change to several documents, all or nothing. Every plan is rendered and
// checked against its snapshot before the first write, so a broken operation or a document changed
// underneath refuses the whole change (a dryRun refuses it the same way); a write that fails part-way
// puts every document already written back to its original bytes and rethrows, so no caller is left
// with half a change.
// @req FR-NODE-279 AC-2 — the one multi-document write transaction. It writes through the file-level
// transaction, so it can also create documents: a created document is removed when a later write fails.

export interface PlansResult {
  /** True when at least one document was written. */
  readonly written: boolean;
}

/** A document the change creates; it must not exist when the change is written. */
export interface NewDocument {
  readonly path: string;
  readonly text: string;
}

export interface ApplyPatchPlansOptions {
  readonly dryRun: boolean;
  /** Documents created in the same transaction, written before the patched documents. */
  readonly newDocuments?: readonly NewDocument[];
}

export async function applyPatchPlans(plans: readonly PatchPlan[], options: ApplyPatchPlansOptions): Promise<PlansResult> {
  const newDocuments = options.newDocuments ?? [];
  // Two writes to one document would each be rendered from the same snapshot, so the second write
  // would silently undo the first. That is a caller bug, refused before anything is written.
  const paths = [...newDocuments.map((document) => document.path), ...plans.map((plan) => plan.file.path)];
  const repeated = paths.find((filePath, index) => paths.indexOf(filePath) !== index);
  if (repeated !== undefined) throw new Error(`applyPatchPlans got two plans for the same document: ${repeated}; merge their operations into one plan`);
  // A document whose rendered text equals its current text has nothing to write and is left alone.
  const changed = plans.map((plan) => ({ plan, rendered: renderPlanText(plan) })).filter(({ rendered }) => rendered.changed);
  if (options.dryRun) return { written: false };
  for (const { plan } of changed) await assertFreshSnapshot(plan);
  // A document that appeared since the change was planned is someone else's; creating it would overwrite it.
  const appeared = newDocuments.find((document) => existsSync(document.path));
  if (appeared !== undefined) throw new StalePatchError(appeared.path);
  await runFileTransaction(async (transaction) => {
    for (const document of newDocuments) await transaction.write(document.path, document.text);
    for (const { plan, rendered } of changed) await transaction.write(plan.file.path, rendered.text);
  });
  return { written: newDocuments.length + changed.length > 0 };
}
