import { describe, expect, it } from "vitest";
import {
  DEFERRABLE_MUTATION_TOOLS,
  type ReplayAttempt,
  admitReplayCalls,
  reduceReplayOutcomes
} from "../../../src/core/orchestrator/replay-admission.js";
import { type ReplayPlan, replayDeferredMutations } from "../../../src/core/orchestrator/replay.js";

// @req FR-NODE-185
//
// The deferred-mutation queue is written by the lane and the planner reads only `tool` and `args`
// from it, comparing the tool against nothing. Replay then executes at the HOST root with full
// authority, so an unadmitted tool name is the lane reaching back into the very `docs/spec/` that
// charter C1 keeps it out of. Admission is the check that was missing; checkpoint reduction is what
// stops an interrupted run from appending `add_completed_work` rows twice.

const TRACE = "add_trace_link";
const STATUS = "update_status";
const COMPLETED = "add_completed_work";
const EVIDENCE = "add_verification_evidence";

function planOf(...entries: Array<{ tool: string; args: unknown }>): ReplayPlan {
  return replayDeferredMutations(entries, {});
}

describe("FR-NODE-185 — replay admission", () => {
  it("AC-1: admits each of the four mutations kiwi-coder may defer", () => {
    const plan = planOf(
      { tool: TRACE, args: { id: "FR-NODE-185" } },
      { tool: EVIDENCE, args: { id: "FR-NODE-185" } },
      { tool: STATUS, args: { id: "FR-NODE-185" } },
      { tool: COMPLETED, args: { id: "FR-NODE-185" } }
    );

    const { admitted, refused } = admitReplayCalls(plan, null);

    expect(admitted.map((entry) => entry.call.tool)).toEqual([TRACE, EVIDENCE, STATUS, COMPLETED]);
    expect(refused).toEqual([]);
  });

  it("AC-2: refuses any other tool with tool-not-deferrable and names its index in the plan", () => {
    const plan = planOf(
      { tool: STATUS, args: { id: "A" } },
      { tool: "set_active_target", args: { target: "whatever" } },
      { tool: "supersede_requirement", args: { id: "A" } },
      { tool: "__proto__", args: { id: "A" } }
    );

    const { admitted, refused } = admitReplayCalls(plan, null);

    expect(admitted).toHaveLength(1);
    expect(refused).toEqual([
      { index: 1, tool: "set_active_target", reason: "tool-not-deferrable" },
      { index: 2, tool: "supersede_requirement", reason: "tool-not-deferrable" },
      { index: 3, tool: "__proto__", reason: "tool-not-deferrable" }
    ]);
  });

  it("AC-3: no argument widens the allowed set", () => {
    const plan = planOf({ tool: "set_active_target", args: { target: "x" } });

    // Widening is a code change, not a call-site choice: an extra argument is simply ignored.
    const widened = (admitReplayCalls as unknown as (p: ReplayPlan, t: string | null, extra: string[]) => ReturnType<typeof admitReplayCalls>)(
      plan,
      null,
      ["set_active_target"]
    );

    expect(widened.admitted).toEqual([]);
    expect(widened.refused[0]?.reason).toBe("tool-not-deferrable");
    expect([...DEFERRABLE_MUTATION_TOOLS]).toEqual([TRACE, EVIDENCE, STATUS, COMPLETED]);
  });

  it("AC-4: refuses a call whose target differs from the run's frozen target", () => {
    const plan = planOf(
      { tool: STATUS, args: { id: "A", target: "2.6.0-phase2-parallel-lanes" } },
      { tool: STATUS, args: { id: "B", target: "some-other-target" } },
      { tool: STATUS, args: { id: "C" } }
    );

    const { admitted, refused } = admitReplayCalls(plan, "2.6.0-phase2-parallel-lanes");

    expect(admitted.map((entry) => entry.index)).toEqual([0, 2]);
    expect(refused).toEqual([{ index: 1, tool: STATUS, reason: "target-not-frozen" }]);
  });

  it("AC-5: never admits a skip-duplicate call — the plan already accounts for it", () => {
    const args = { id: "A" };
    const plan = planOf({ tool: STATUS, args }, { tool: STATUS, args });
    expect(plan.calls.map((call) => call.action)).toEqual(["apply", "skip-duplicate"]);

    const { admitted } = admitReplayCalls(plan, null);

    expect(admitted.map((entry) => entry.index)).toEqual([0]);
  });
});

describe("FR-NODE-185 — checkpoint reduction", () => {
  const plan = planOf(
    { tool: TRACE, args: { id: "A" } },
    { tool: STATUS, args: { id: "A" } },
    { tool: COMPLETED, args: { id: "B" } }
  );

  function attempt(index: number, outcome: "applied" | "failed"): ReplayAttempt {
    const call = plan.calls[index]!;
    return { tool: call.tool, argsHash: call.argsHash, outcome };
  }

  it("AC-6: excludes every call the record shows succeeded", () => {
    const admission = admitReplayCalls(plan, null);

    const reduction = reduceReplayOutcomes(admission, [attempt(0, "applied"), attempt(1, "applied")]);

    expect(reduction.remaining.map((entry) => entry.call.tool)).toEqual([COMPLETED]);
    expect(reduction.applied).toHaveLength(2);
    expect(reduction.failed).toEqual([]);
  });

  it("AC-7: a recorded failure is reported and is not silently retried", () => {
    const admission = admitReplayCalls(plan, null);

    const reduction = reduceReplayOutcomes(admission, [attempt(0, "applied"), attempt(1, "failed")]);

    expect(reduction.failed.map((entry) => entry.tool)).toEqual([STATUS]);
    expect(reduction.remaining.map((entry) => entry.call.tool)).toEqual([COMPLETED]);
    expect(reduction.remaining.map((entry) => entry.call.tool)).not.toContain(STATUS);
  });

  it("AC-8: an empty record leaves every admitted call, a complete record leaves none", () => {
    const admission = admitReplayCalls(plan, null);

    expect(reduceReplayOutcomes(admission, []).remaining).toHaveLength(3);
    expect(
      reduceReplayOutcomes(admission, [attempt(0, "applied"), attempt(1, "applied"), attempt(2, "applied")]).remaining
    ).toEqual([]);
  });

  it("AC-6: reduction keys on the (tool, argsHash) pair, not on the hash alone", () => {
    // `update_status` and `add_completed_work` share an {id} args shape, so a hash-only key would let
    // whichever ran first mark the other as done.
    const shared = planOf({ tool: STATUS, args: { id: "A" } }, { tool: COMPLETED, args: { id: "A" } });
    expect(shared.calls[0]!.argsHash).toBe(shared.calls[1]!.argsHash);
    const admission = admitReplayCalls(shared, null);

    const reduction = reduceReplayOutcomes(admission, [
      { tool: STATUS, argsHash: shared.calls[0]!.argsHash, outcome: "applied" }
    ]);

    expect(reduction.remaining.map((entry) => entry.call.tool)).toEqual([COMPLETED]);
  });
});
