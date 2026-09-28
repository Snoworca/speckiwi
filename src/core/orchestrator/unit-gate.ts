import { waveNumber, type WavesEvent } from "./journal-schema.js";
import { hasMergeWitness, type LaneKey, type OrchTrailerCommit } from "./lane-state.js";

/**
 * The two gate predicates whose evidence is the repository tree and the journal rather than a lane
 * manifest — `serial-unit-failed` and `partition-review-unrecorded`.
 *
 * @req FR-NODE-119 — `serial-unit-failed`
 * @req FR-NODE-120 — `partition-review-unrecorded`
 *
 * Both are pure. The impure half — running `verification_cmd`, reading the commit trailers, diffing
 * the write set between base and head — happens in the caller, and its results arrive as parameters.
 * That split is what makes the witnesses checkable facts rather than the unit's own report.
 */

// ---------------------------------------------------------------------------------------------
// serial-unit-failed — a unit is one wave's worker running its SDS
// ---------------------------------------------------------------------------------------------

/** The three disjuncts, in the order the gate states them. */
export const SERIAL_UNIT_DISJUNCTS = ["verification-cmd-failed", "commitless-and-undeclared", "pm-needs-user-or-failed"] as const;
export type SerialUnitDisjunct = (typeof SERIAL_UNIT_DISJUNCTS)[number];

/** §6.5 closure 2's bar, reused rather than reinvented. */
export const INTENTIONALLY_EMPTY_MIN_REASON_LENGTH = 20;

/** What the unit's `/kiwi-pm` run declared in its `docs/analysis/` bundle, keyed by lane id. */
export interface IntentionallyEmptyDeclaration {
  readonly laneId: string;
  readonly reason: string;
}

export interface SerialUnitInput {
  readonly runId: string;
  readonly key: LaneKey;
  /** The unit's `verification_cmd`: the first exit, and the one retry against the **same** SDS. */
  readonly verification: { readonly firstExit: number; readonly retryExit: number | null };
  readonly pmOutcome: "TASK_DONE" | "NEEDS_USER" | "FAILED";
  /** Commits on the integration branch, with their `Orch-*` trailers. */
  readonly integrationCommits: readonly OrchTrailerCommit[];
  /** Recomputed by the orchestrator from the tree: no path of the unit's write set differs base..head. */
  readonly writeSetUnchanged: boolean;
  readonly intentionallyEmpty: readonly IntentionallyEmptyDeclaration[];
}

export interface SerialUnitOutcome {
  readonly verdict: "pass" | "retry-verification" | "refuse";
  readonly code: "serial-unit-failed" | null;
  readonly disjunct: SerialUnitDisjunct | null;
  readonly detail: string;
  /** True once the one permitted re-run against the same SDS has been made and judged. */
  readonly retryConsumed: boolean;
  /** Why this unit's declaration failed a witness, or null. A failed one is treated as never made. */
  readonly illegalDeclaration: string | null;
  /** The wave verification's denominator. A legal declaration never removes the unit from it. */
  readonly expectedLaneIds: readonly string[];
  /** The unit, once it landed — by a trailered commit, or by a legal `intentionally_empty` declaration. */
  readonly checkedLaneIds: readonly string[];
}

/** Why a declaration fails its witnesses, or null when both hold. */
function declarationFailure(input: SerialUnitInput, declaration: IntentionallyEmptyDeclaration): string | null {
  // Two witnesses, and the declaration selects only *which rule applies*: a self-reported empty delta
  // would shrink the verification denominator on the unit's own say-so.
  const failures: string[] = [];
  if (declaration.reason.trim().length < INTENTIONALLY_EMPTY_MIN_REASON_LENGTH) {
    failures.push(`reason is under ${INTENTIONALLY_EMPTY_MIN_REASON_LENGTH} characters`);
  }
  if (input.verification.firstExit !== 0) failures.push(`verification_cmd exited ${input.verification.firstExit}`);
  if (!input.writeSetUnchanged) failures.push("a path in the unit's write set differs between base and head");
  return failures.length > 0 ? failures.join("; ") : null;
}

/**
 * @req FR-NODE-119 — three disjuncts, evaluable from the tree.
 *
 * The two disjuncts a re-run cannot change are evaluated first, so `retryConsumed` stays false for
 * them: re-running a unit whose `/kiwi-pm` returned `NEEDS_USER` spends a run to learn nothing.
 */
export function evaluateSerialUnitGate(input: SerialUnitInput): SerialUnitOutcome {
  const lane = input.key.lane;
  // @req FR-NODE-119 AC-3 — the landing witness is the shared merge-witness predicate over the run,
  // wave, stage and lane trailers, so the gate and resume cannot disagree about what landed.
  const landed = hasMergeWitness(input.integrationCommits, input.runId, input.key);
  const declaration = input.intentionallyEmpty.find((entry) => entry.laneId === lane);
  const illegalDeclaration = !landed && declaration !== undefined ? declarationFailure(input, declaration) : null;
  const legallyEmpty = !landed && declaration !== undefined && illegalDeclaration === null;

  const base = {
    retryConsumed: false,
    illegalDeclaration,
    expectedLaneIds: [lane],
    checkedLaneIds: landed || legallyEmpty ? [lane] : []
  };

  if (input.pmOutcome !== "TASK_DONE") {
    return { ...base, verdict: "refuse", code: "serial-unit-failed", disjunct: "pm-needs-user-or-failed", detail: `/kiwi-pm returned ${input.pmOutcome} for ${lane}` };
  }

  if (!landed && !legallyEmpty) {
    return {
      ...base,
      verdict: "refuse",
      code: "serial-unit-failed",
      disjunct: "commitless-and-undeclared",
      detail:
        illegalDeclaration !== null
          ? `${lane} produced no trailered commit and its intentionally_empty declaration is not legal: ${illegalDeclaration}`
          : `${lane} produced no commit carrying its Orch-Run, Orch-Wave, Orch-Stage and Orch-Lane trailers and declared no intentionally_empty reason`
    };
  }

  if (input.verification.firstExit !== 0) {
    if (input.verification.retryExit === null) {
      return { ...base, verdict: "retry-verification", code: null, disjunct: null, detail: "verification_cmd exited non-zero; re-run it once against the same SDS" };
    }
    if (input.verification.retryExit !== 0) {
      return {
        ...base,
        retryConsumed: true,
        verdict: "refuse",
        code: "serial-unit-failed",
        disjunct: "verification-cmd-failed",
        detail: `verification_cmd exited ${input.verification.firstExit} and ${input.verification.retryExit} on the retry against the same SDS`
      };
    }
    return { ...base, retryConsumed: true, verdict: "pass", code: null, disjunct: null, detail: "verification_cmd passed on the retry against the same SDS" };
  }

  return { ...base, verdict: "pass", code: null, disjunct: null, detail: `${lane} landed and verified` };
}

// ---------------------------------------------------------------------------------------------
// §7.9 (a), §13 — partition-review-unrecorded
// ---------------------------------------------------------------------------------------------

export const PARTITION_REVIEW_VERDICTS = ["pass", "revise", "abort"] as const;
export type PartitionReviewVerdict = (typeof PARTITION_REVIEW_VERDICTS)[number];

/** §4.2's `partition_review` object. */
export const PARTITION_REVIEW_FIELDS = ["doc_path", "digest", "lane_plan_digest", "reviewer", "verdict"] as const;

export interface PartitionReviewGateInput {
  readonly wave: number;
  readonly events: readonly WavesEvent[];
  /**
   * The `lane_plan.digest` frozen at Phase 3.e′ — **not** the card's current `frozen.lane_lock`
   * pointer, which a later re-freeze may move; a verdict answers the plan it was given over.
   */
  readonly threeEPrimeLanePlanDigest: string;
}

export interface PartitionReviewOutcome {
  readonly refused: boolean;
  readonly code: "partition-review-unrecorded" | null;
  readonly detail: string;
}

function latestPartitionReview(input: PartitionReviewGateInput): Record<string, unknown> | null {
  let latest: Record<string, unknown> | null = null;
  for (const event of input.events) {
    if (event.event !== "result" || event.verb !== "review-partition") continue;
    if (waveNumber(event.wave) !== input.wave) continue;
    if (event.partition_review === undefined || event.partition_review === null || typeof event.partition_review !== "object") continue;
    latest = event.partition_review as Record<string, unknown>;
  }
  return latest;
}

/**
 * @req FR-NODE-120 — the partition must be frozen, published **and** reviewed. Freezing alone
 * satisfies one of the three, and the verdict lives in the journal rather than in `partition.md` so
 * that the gate has a machine-readable record to read.
 */
export function evaluatePartitionReviewGate(input: PartitionReviewGateInput): PartitionReviewOutcome {
  const review = latestPartitionReview(input);
  if (review === null) {
    return { refused: true, code: "partition-review-unrecorded", detail: `wave-${input.wave} carries no review-partition result line with a partition_review object` };
  }

  const recordedDigest = review.lane_plan_digest;
  if (recordedDigest !== input.threeEPrimeLanePlanDigest) {
    return {
      refused: true,
      code: "partition-review-unrecorded",
      detail: `partition_review.lane_plan_digest is ${JSON.stringify(recordedDigest)} but the 3.e-prime freeze recorded ${input.threeEPrimeLanePlanDigest}`
    };
  }

  const verdict = review.verdict;
  if (typeof verdict !== "string" || !(PARTITION_REVIEW_VERDICTS as readonly string[]).includes(verdict)) {
    return {
      refused: true,
      code: "partition-review-unrecorded",
      detail: `partition_review.verdict ${JSON.stringify(verdict)} is outside the closed vocabulary: ${PARTITION_REVIEW_VERDICTS.join(" | ")}`
    };
  }
  if (verdict !== "pass") {
    return { refused: true, code: "partition-review-unrecorded", detail: `partition_review.verdict is ${verdict}` };
  }

  return { refused: false, code: null, detail: `wave-${input.wave}'s partition review passed against the 3.e-prime freeze` };
}
