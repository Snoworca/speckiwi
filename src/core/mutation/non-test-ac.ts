import { todayStamp } from "../date-stamp.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import { createPatchPlan } from "../patch/patch-plan.js";
import { nonTestCriterionText } from "../parser/ac-parser.js";
import type { AcceptanceCriterion, MutationResult, ProjectRoot } from "../types.js";
import { assertOpensNoBlockBoundary } from "./block-prose.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { loadRecordWithWorkspace, planSectionRowsInsert } from "./internal.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { tableCellText } from "./table-cell.js";

// @req FR-NODE-315 AC-1 AC-2 AC-3 — marks one live acceptance criterion non-test, or removes the mark.
// The line keeps its number, text and box; the reason lands in a Change Notes row of the same patch,
// so the record of why a criterion is checked by hand never lags the marker.

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

export interface NonTestMarkInput {
  /** The requirement holding the criterion. */
  id: string;
  /** The live criterion, e.g. `AC-2`. */
  acId: string;
  /** Why the criterion is (or is no longer) checked by something other than this repository's tests. Required. */
  reason: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface NonTestMarkOutput {
  id: string;
  acId: string;
  nonTest: boolean;
  written: boolean;
}

type Direction = "mark" | "unmark";

const OPERATION: Record<Direction, string> = { mark: "mark_acceptance_criterion_non_test", unmark: "unmark_acceptance_criterion_non_test" };

export async function markAcceptanceCriterionNonTest(root: ProjectRoot, input: NonTestMarkInput): Promise<MutationResult<NonTestMarkOutput>> {
  return withSrsMutationLock(root, { operation: OPERATION.mark, dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    setNonTestMark(root, input, "mark")
  );
}

export async function unmarkAcceptanceCriterionNonTest(root: ProjectRoot, input: NonTestMarkInput): Promise<MutationResult<NonTestMarkOutput>> {
  return withSrsMutationLock(root, { operation: OPERATION.unmark, dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    setNonTestMark(root, input, "unmark")
  );
}

/** The line of `criterion` with the marker added or taken off, after its `AC-<n>:` prefix. */
function rewrittenLine(original: string, criterion: AcceptanceCriterion, direction: Direction): string | undefined {
  const prefix = `${criterion.id}:`;
  const at = original.indexOf(prefix);
  if (at < 0) return undefined;
  const text = direction === "mark" ? nonTestCriterionText(criterion.text) : criterion.text;
  return `${original.slice(0, at + prefix.length)} ${text}`;
}

async function setNonTestMark(root: ProjectRoot, input: NonTestMarkInput, direction: Direction): Promise<MutationResult<NonTestMarkOutput>> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "") return mutationFail("USAGE", "reason is required: say why the criterion is checked by something other than this repository's automated tests");
  if (CONTROL_CHAR_RE.test(reason)) return mutationFail("USAGE", "reason contains forbidden control characters");
  const unsafeReason = assertOpensNoBlockBoundary<NonTestMarkOutput>("reason", reason);
  if (unsafeReason) return unsafeReason;

  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const { record, file } = loaded;
  // A verified requirement never holds a marked criterion its evidence did not cover: demote first.
  if (record.status === "verified") {
    return mutationFail("MUTATION_DENIED", `${input.id} is verified; demote it before changing the non-test marker of ${input.acId}, then add evidence and re-promote`);
  }
  if ((record.expiredAcceptanceCriteria ?? []).some((criterion) => criterion.id === input.acId)) {
    return mutationFail("MUTATION_DENIED", `${input.acId} of ${input.id} is expired; an expired criterion keeps no non-test marker`);
  }
  const criterion = record.acceptanceCriteria.find((entry) => entry.id === input.acId);
  if (!criterion) return mutationFail("NOT_FOUND", `Acceptance Criterion not found: ${input.acId}`);
  if (direction === "mark" && criterion.nonTest === true) return mutationFail("MUTATION_DENIED", `${input.acId} of ${input.id} is already marked non-test`);
  if (direction === "unmark" && criterion.nonTest !== true) return mutationFail("MUTATION_DENIED", `${input.acId} of ${input.id} is not marked non-test`);

  const original = file.lines[criterion.line - 1] ?? "";
  const replacement = rewrittenLine(original, criterion, direction);
  if (replacement === undefined) return mutationFail("MUTATION_DENIED", `Acceptance Criterion prefix not found for ${input.acId}`);
  const change = `${direction === "mark" ? "Marked" : "Unmarked"} ${criterion.id} non-test`;
  const note = planSectionRowsInsert(file, record, "Change Notes", [{ Date: todayStamp(), Change: change, Reason: tableCellText(reason) }]);
  if (!note.ok) return mutationFail("MUTATION_DENIED", note.message);

  const plan = createPatchPlan(file, [{ type: "replaceLine", line: criterion.line, original, replacement }, note.operation]);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  return {
    ...withMutationEnvelope(
      mutationOk({ id: input.id, acId: criterion.id, nonTest: direction === "mark", written: applied.written }),
      mutationEnvelopeFromPlan(OPERATION[direction], plan, dryRun, applied.written)
    ),
    patch: summarizePatch(plan, dryRun)
  };
}
