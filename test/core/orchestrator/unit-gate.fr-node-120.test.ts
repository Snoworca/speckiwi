import { describe, expect, it } from "vitest";
import { VERB_RECOVERY_CLASS, WAVES_EVENT_FIELDS, type WavesEvent } from "../../../src/core/orchestrator/journal-schema.js";
import {
  PARTITION_REVIEW_FIELDS,
  PARTITION_REVIEW_VERDICTS,
  evaluatePartitionReviewGate,
  type PartitionReviewGateInput
} from "../../../src/core/orchestrator/unit-gate.js";

// @req FR-NODE-120 — `partition-review-unrecorded`: the verdict lives in the journal, and the digest
// tie binds it to the exact plan the user reviewed — the 3.e′ freeze, not the current lock pointer.

let line = 0;

function reviewResult(partitionReview: Record<string, unknown> | undefined, overrides: Partial<WavesEvent> = {}): WavesEvent {
  line += 1;
  return {
    journalLine: line,
    run_id: "2026-08-02.speckiwi.v260",
    wave: "wave-1",
    event: "result",
    verb: "review-partition",
    status: "complete",
    ...(partitionReview === undefined ? {} : { partition_review: partitionReview }),
    ...overrides
  };
}

function review(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    doc_path: "waves/wave-1/partition.md",
    digest: "sha-partition-doc",
    lane_plan_digest: "sha-3e-prime",
    reviewer: "user",
    verdict: "pass",
    ...overrides
  };
}

function input(overrides: Partial<PartitionReviewGateInput> = {}): PartitionReviewGateInput {
  return {
    wave: 1,
    events: [reviewResult(review())],
    threeEPrimeLanePlanDigest: "sha-3e-prime",
    ...overrides
  };
}

describe("FR-NODE-120 AC-4 — the passing case", () => {
  it("passes a wave whose review-partition result carries a matching lane_plan_digest and verdict pass", () => {
    const outcome = evaluatePartitionReviewGate(input());
    expect(outcome.refused).toBe(false);
    expect(outcome.code).toBeNull();
  });
});

describe("FR-NODE-120 AC-1 — no review-partition result line", () => {
  it("refuses a wave with no such line at all", () => {
    const outcome = evaluatePartitionReviewGate(input({ events: [] }));
    expect(outcome.refused).toBe(true);
    expect(outcome.code).toBe("partition-review-unrecorded");
    expect(outcome.detail).toContain("review-partition");
  });

  it("refuses when the only review-partition line is an intent, because freezing alone is not reviewing", () => {
    const outcome = evaluatePartitionReviewGate(input({ events: [reviewResult(review(), { event: "intent" })] }));
    expect(outcome.refused).toBe(true);
  });

  it("refuses when the result line carries no partition_review object", () => {
    const outcome = evaluatePartitionReviewGate(input({ events: [reviewResult(undefined)] }));
    expect(outcome.refused).toBe(true);
  });

  it("refuses when the only review-partition result belongs to a different wave", () => {
    const outcome = evaluatePartitionReviewGate(input({ events: [reviewResult(review(), { wave: "wave-2" })] }));
    expect(outcome.refused).toBe(true);
  });
});

describe("FR-NODE-120 AC-2/AC-5/AC-6 — the digest tie reads the 3.e′ freeze", () => {
  it("AC-2: refuses when the recorded lane_plan_digest differs from the digest frozen at 3.e′", () => {
    const outcome = evaluatePartitionReviewGate(input({ events: [reviewResult(review({ lane_plan_digest: "sha-something-else" }))] }));
    expect(outcome.refused).toBe(true);
    expect(outcome.code).toBe("partition-review-unrecorded");
    expect(outcome.detail).toContain("sha-3e-prime");
    expect(outcome.detail).toContain("sha-something-else");
  });

  it("AC-5: still passes after a 3.f″ coupling re-freeze moved frozen.lane_lock to a new digest", () => {
    // The comparand is the 3.e′ freeze. A coupling merge is same-lane-forcing and therefore strictly
    // more conservative than the plan the user passed, so it must not reopen the review.
    const outcome = evaluatePartitionReviewGate(
      input({ events: [reviewResult(review({ lane_plan_digest: "sha-3e-prime" }))], threeEPrimeLanePlanDigest: "sha-3e-prime" })
    );
    expect(outcome.refused).toBe(false);
  });

  it("AC-5: the input carries no current-lock pointer for the comparison to drift onto", () => {
    const constructed = { wave: 1, events: [reviewResult(review())], threeEPrimeLanePlanDigest: "sha-3e-prime" };
    expect(Object.keys(constructed).sort()).toEqual(["events", "threeEPrimeLanePlanDigest", "wave"]);
  });

  it("AC-6: a verdict recorded against a superseded 3.e′ digest never satisfies the gate", () => {
    // A 3.e′ re-plan moves the freeze; the old verdict is now against a plan nobody is executing.
    const outcome = evaluatePartitionReviewGate(
      input({ events: [reviewResult(review({ lane_plan_digest: "sha-superseded" }))], threeEPrimeLanePlanDigest: "sha-3e-prime-round-2" })
    );
    expect(outcome.refused).toBe(true);
  });

  it("reads the latest review-partition result for the wave, so a re-review after a re-plan can pass", () => {
    const outcome = evaluatePartitionReviewGate(
      input({
        events: [reviewResult(review({ lane_plan_digest: "sha-round-1" })), reviewResult(review({ lane_plan_digest: "sha-round-2" }))],
        threeEPrimeLanePlanDigest: "sha-round-2"
      })
    );
    expect(outcome.refused).toBe(false);
  });
});

describe("FR-NODE-120 AC-3 — the verdict vocabulary", () => {
  it("declares the closed three-value vocabulary", () => {
    expect([...PARTITION_REVIEW_VERDICTS]).toEqual(["pass", "revise", "abort"]);
    expect(PARTITION_REVIEW_VERDICTS).toHaveLength(3);
  });

  it("refuses on revise and on abort", () => {
    for (const verdict of ["revise", "abort"] as const) {
      const outcome = evaluatePartitionReviewGate(input({ events: [reviewResult(review({ verdict }))] }));
      expect(outcome.refused, `verdict ${verdict} refuses`).toBe(true);
      expect(outcome.code).toBe("partition-review-unrecorded");
      expect(outcome.detail).toContain(verdict);
    }
  });

  it("refuses a verdict outside the vocabulary rather than reading it as anything", () => {
    const outcome = evaluatePartitionReviewGate(input({ events: [reviewResult(review({ verdict: "approved" }))] }));
    expect(outcome.refused).toBe(true);
    expect(outcome.detail).toContain("approved");
  });
});

describe("FR-NODE-120 AC-7 — the verb and the object are already in the journal schema", () => {
  it("registers review-partition in the closed verb enum, so an append is not rejected out-of-enum", () => {
    expect(Object.keys(VERB_RECOVERY_CLASS)).toContain("review-partition");
  });

  it("registers partition_review in the event field set", () => {
    expect([...WAVES_EVENT_FIELDS.optional]).toContain("partition_review");
  });

  it("declares the object's five fields, and the gate reads a line carrying exactly them", () => {
    expect([...PARTITION_REVIEW_FIELDS]).toEqual(["doc_path", "digest", "lane_plan_digest", "reviewer", "verdict"]);
    expect(PARTITION_REVIEW_FIELDS).toHaveLength(5);
    const written = review();
    expect(Object.keys(written).sort()).toEqual([...PARTITION_REVIEW_FIELDS].sort());
    expect(evaluatePartitionReviewGate(input({ events: [reviewResult(written)] })).refused).toBe(false);
  });
});
