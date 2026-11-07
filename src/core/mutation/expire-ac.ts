import { todayStamp } from "../date-stamp.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import { createPatchPlan } from "../patch/patch-plan.js";
import { expiredCriterionText, successorProblem } from "../parser/ac-parser.js";
import type { MutationResult, ProjectRoot } from "../types.js";
import { assertOpensNoBlockBoundary } from "./block-prose.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { loadRecordWithWorkspace, planSectionRowsInsert } from "./internal.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { tableCellText } from "./table-cell.js";

// @req FR-NODE-243 AC-1 AC-2 AC-3 — marks one acceptance criterion expired. The criterion keeps its
// number and text; the line gains the marker with the writer's local date, and the reason lands in a
// Change Notes row of the same patch, so the record of why never lags the marker.

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

export interface ExpireAcceptanceCriterionInput {
  /** The requirement holding the criterion. */
  id: string;
  /** The live criterion to expire, e.g. `AC-2`. */
  acId: string;
  /** Why the criterion no longer describes intended behaviour. Required. */
  reason: string;
  /** A requirement that now carries the behaviour; it must exist. */
  successor?: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface ExpireAcceptanceCriterionOutput {
  id: string;
  acId: string;
  expiredOn: string;
  successor?: string;
  written: boolean;
}

export async function expireAcceptanceCriterion(root: ProjectRoot, input: ExpireAcceptanceCriterionInput): Promise<MutationResult<ExpireAcceptanceCriterionOutput>> {
  return withSrsMutationLock(root, { operation: "expire_acceptance_criterion", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    expireAcceptanceCriterionUnlocked(root, input)
  );
}

async function expireAcceptanceCriterionUnlocked(root: ProjectRoot, input: ExpireAcceptanceCriterionInput): Promise<MutationResult<ExpireAcceptanceCriterionOutput>> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") return mutationFail("USAGE", "reason is required: say why the criterion no longer applies");
  if (CONTROL_CHAR_RE.test(reason)) return mutationFail("USAGE", "reason contains forbidden control characters");
  const unsafeReason = assertOpensNoBlockBoundary<ExpireAcceptanceCriterionOutput>("reason", reason);
  if (unsafeReason) return unsafeReason;
  const successor = input.successor?.trim() || undefined;

  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const { record, file } = loaded;
  if ((record.expiredAcceptanceCriteria ?? []).some((criterion) => criterion.id === input.acId)) {
    return mutationFail("MUTATION_DENIED", `${input.acId} of ${input.id} is already expired`);
  }
  const criterion = record.acceptanceCriteria.find((entry) => entry.id === input.acId);
  if (!criterion) return mutationFail("NOT_FOUND", `Acceptance Criterion not found: ${input.acId}`);
  // A requirement with no live criterion is not a requirement; retiring all of it is discard or supersede.
  if (record.acceptanceCriteria.length === 1) {
    return mutationFail("MUTATION_DENIED", `${input.acId} is the last live criterion of ${input.id}; discard or supersede the requirement instead`);
  }
  const unusable = successor === undefined ? undefined : successorProblem(input.id, successor, loaded.records);
  if (unusable) return mutationFail(unusable.endsWith("does not exist") ? "NOT_FOUND" : "MUTATION_DENIED", `Successor cannot be used: ${unusable}`);

  const original = file.lines[criterion.line - 1] ?? "";
  const marker = `${criterion.id}:`;
  const markerIndex = original.indexOf(marker);
  if (markerIndex < 0) return mutationFail("MUTATION_DENIED", `Acceptance Criterion prefix not found for ${input.acId}`);
  const expiredOn = todayStamp();
  // @req FR-NODE-259 AC-1 @req FR-NODE-278 AC-3
  const note = planSectionRowsInsert(file, record, "Change Notes", [{ Date: expiredOn, Change: `Expired ${criterion.id}`, Reason: tableCellText(reason) }]);
  if (!note.ok) return mutationFail("MUTATION_DENIED", note.message);

  const replacement = `${original.slice(0, markerIndex + marker.length)} ${expiredCriterionText(criterion.text, expiredOn, successor)}`;
  const plan = createPatchPlan(file, [{ type: "replaceLine", line: criterion.line, original, replacement }, note.operation]);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  return {
    ...withMutationEnvelope(
      mutationOk({ id: input.id, acId: criterion.id, expiredOn, ...(successor ? { successor } : {}), written: applied.written }),
      mutationEnvelopeFromPlan("expire_acceptance_criterion", plan, dryRun, applied.written)
    ),
    patch: summarizePatch(plan, dryRun)
  };
}
