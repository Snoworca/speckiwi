import { waveNumber, type WavesEvent } from "./journal-schema.js";
import type { LaneKey, OrchTrailerCommit } from "./lane-state.js";

/**
 * The two phase-1 gate predicates whose evidence is the repository tree and the journal rather than a
 * lane manifest — 05 §5.14's `serial-unit-failed` and §7.9 (a) / §13's `partition-review-unrecorded`.
 *
 * @req FR-NODE-119 — `serial-unit-failed`
 * @req FR-NODE-120 — `partition-review-unrecorded`
 *
 * Both are pure. The impure half — running `verification_cmd`, reading the commit trailers, diffing
 * the write set between base and head — happens in the command, and its results arrive as parameters.
 * That split is what makes the witnesses in §5.14 checkable facts rather than the unit's own report.
 */

// ---------------------------------------------------------------------------------------------
// §5.14 — serial-unit-failed
// ---------------------------------------------------------------------------------------------

/** The three disjuncts, in the order §5.14's gate paragraph states them. */
export const SERIAL_UNIT_DISJUNCTS = ["verification-cmd-failed", "commitless-and-undeclared", "pm-needs-user-or-failed"] as const;
export type SerialUnitDisjunct = (typeof SERIAL_UNIT_DISJUNCTS)[number];

/** §6.5 closure 2's bar, reused rather than reinvented. */
export const INTENTIONALLY_EMPTY_MIN_REASON_LENGTH = 20;

/** One task's two recomputed witnesses. Neither is a value the unit asserted about itself. */
export interface UnitTaskFacts {
  readonly taskId: string;
  /** The exit code of the task's own `verification_cmd`, re-run by the orchestrator. */
  readonly verificationCmdExit: number;
  /** True when no path in the task's `write_set` differs between the unit's base and head. */
  readonly writeSetUnchanged: boolean;
}

/** What the unit's `/kiwi-pm` run declared in its `docs/analysis/` bundle, per task. */
export interface IntentionallyEmptyDeclaration {
  readonly taskId: string;
  readonly reason: string;
}

export interface SerialUnitInput {
  readonly runId: string;
  readonly key: LaneKey;
  /** The unit's `verification_cmd`: the first exit, and the one retry against the **same** handoff. */
  readonly verification: { readonly firstExit: number; readonly retryExit: number | null };
  readonly pmOutcome: "TASK_DONE" | "NEEDS_USER" | "FAILED";
  /** Commits on the integration branch, with their `Orch-*` trailers. */
  readonly integrationCommits: readonly OrchTrailerCommit[];
  readonly tasks: readonly UnitTaskFacts[];
  readonly intentionallyEmpty: readonly IntentionallyEmptyDeclaration[];
}

export interface IllegalDeclaration {
  readonly taskId: string;
  readonly reason: string;
}

export interface SerialUnitOutcome {
  readonly verdict: "pass" | "retry-verification" | "refuse";
  readonly code: "serial-unit-failed" | null;
  readonly disjunct: SerialUnitDisjunct | null;
  readonly detail: string;
  /** True once the one permitted re-run against the same handoff has been made and judged. */
  readonly retryConsumed: boolean;
  /** Declarations that failed a witness, and why. Each is treated as though never made. */
  readonly illegalDeclarations: readonly IllegalDeclaration[];
  /** §7.6's denominator. A legal declaration never removes a task from it. */
  readonly expectedTaskIds: readonly string[];
  /** The subset that landed — by a trailered commit, or by a legal `intentionally_empty` declaration. */
  readonly checkedTaskIds: readonly string[];
}

function hasTaskCommit(commits: readonly OrchTrailerCommit[], runId: string, key: LaneKey, taskId: string): boolean {
  return commits.some(
    (commit) =>
      commit.trailers["Orch-Run"] === runId &&
      commit.trailers["Orch-Wave"] === String(key.wave) &&
      commit.trailers["Orch-Stage"] === String(key.stage) &&
      commit.trailers["Orch-Lane"] === key.lane &&
      commit.trailers["Orch-Task"] === taskId
  );
}

/**
 * @req FR-NODE-119 — three disjuncts, evaluable from the tree.
 *
 * The two disjuncts a re-run cannot change are evaluated first, so `retryConsumed` stays false for
 * them: re-running a unit whose `/kiwi-pm` returned `NEEDS_USER` spends a run to learn nothing.
 */
export function evaluateSerialUnitGate(input: SerialUnitInput): SerialUnitOutcome {
  const expectedTaskIds = input.tasks.map((task) => task.taskId);
  const declarations = new Map(input.intentionallyEmpty.map((entry) => [entry.taskId, entry]));

  const illegalDeclarations: IllegalDeclaration[] = [];
  const checkedTaskIds: string[] = [];
  let landedAnyCommit = false;

  for (const task of input.tasks) {
    if (hasTaskCommit(input.integrationCommits, input.runId, input.key, task.taskId)) {
      landedAnyCommit = true;
      checkedTaskIds.push(task.taskId);
      continue;
    }
    const declaration = declarations.get(task.taskId);
    if (declaration === undefined) continue;

    // Two witnesses, and the declaration selects only *which rule applies*: a self-reported empty
    // delta would shrink the verification denominator on the unit's own say-so.
    const failures: string[] = [];
    if (declaration.reason.trim().length < INTENTIONALLY_EMPTY_MIN_REASON_LENGTH) {
      failures.push(`reason is under ${INTENTIONALLY_EMPTY_MIN_REASON_LENGTH} characters`);
    }
    if (task.verificationCmdExit !== 0) failures.push(`verification_cmd exited ${task.verificationCmdExit}`);
    if (!task.writeSetUnchanged) failures.push("a path in the task's write_set differs between base and head");

    if (failures.length > 0) {
      illegalDeclarations.push({ taskId: task.taskId, reason: failures.join("; ") });
      continue;
    }
    // AC-8: the task stays in `expected` and enters `checked`, so the denominator is unchanged.
    checkedTaskIds.push(task.taskId);
  }

  const base = { retryConsumed: false, illegalDeclarations, expectedTaskIds, checkedTaskIds };

  if (input.pmOutcome !== "TASK_DONE") {
    return {
      ...base,
      verdict: "refuse",
      code: "serial-unit-failed",
      disjunct: "pm-needs-user-or-failed",
      detail: `/kiwi-pm returned ${input.pmOutcome} for ${input.key.lane}`
    };
  }

  const commitless = !landedAnyCommit;
  const undeclared = checkedTaskIds.length === 0;
  if (commitless && undeclared) {
    return {
      ...base,
      verdict: "refuse",
      code: "serial-unit-failed",
      disjunct: "commitless-and-undeclared",
      detail:
        illegalDeclarations.length > 0
          ? `${input.key.lane} produced no trailered commit and its intentionally_empty declarations are not legal: ${illegalDeclarations.map((entry) => `${entry.taskId} (${entry.reason})`).join(", ")}`
          : `${input.key.lane} produced no commit carrying its Orch-Lane and Orch-Task trailers and declared no intentionally_empty reason`
    };
  }

  if (input.verification.firstExit !== 0) {
    if (input.verification.retryExit === null) {
      return { ...base, verdict: "retry-verification", code: null, disjunct: null, detail: "verification_cmd exited non-zero; re-run it once against the same handoff" };
    }
    if (input.verification.retryExit !== 0) {
      return {
        ...base,
        retryConsumed: true,
        verdict: "refuse",
        code: "serial-unit-failed",
        disjunct: "verification-cmd-failed",
        detail: `verification_cmd exited ${input.verification.firstExit} and ${input.verification.retryExit} on the retry against the same handoff`
      };
    }
    return { ...base, retryConsumed: true, verdict: "pass", code: null, disjunct: null, detail: "verification_cmd passed on the retry against the same handoff" };
  }

  return { ...base, verdict: "pass", code: null, disjunct: null, detail: `${input.key.lane} landed and verified` };
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
   * pointer. A 3.f″ coupling re-freeze moves the pointer, and reading the pointer here would reopen a
   * review the user already gave over a strictly more conservative plan.
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
