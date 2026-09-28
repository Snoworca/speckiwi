import { describe, expect, it } from "vitest";
import {
  INTENTIONALLY_EMPTY_MIN_REASON_LENGTH,
  SERIAL_UNIT_DISJUNCTS,
  evaluateSerialUnitGate,
  type SerialUnitInput
} from "../../../src/core/orchestrator/unit-gate.js";

// @req FR-NODE-119 — `serial-unit-failed`: three disjuncts, all evaluable from the repository tree. A
// unit is one wave's worker running its SDS, so it lands by a commit carrying its run, wave, stage and
// lane trailers, and its commitless escape is one `intentionally_empty` entry carrying its lane id,
// legal only on two witnesses neither of which is the unit's own assertion.

const RUN_ID = "2026-09-27.speckiwi.v400";
const LANE = "lane-run-wave-1";

function unitCommit(overrides: Record<string, string> = {}) {
  return { commit: "sha-1", trailers: { "Orch-Run": RUN_ID, "Orch-Wave": "1", "Orch-Stage": "1", "Orch-Lane": LANE, ...overrides } };
}

function input(overrides: Partial<SerialUnitInput> = {}): SerialUnitInput {
  return {
    runId: RUN_ID,
    key: { wave: 1, stage: 1, lane: LANE },
    verification: { firstExit: 0, retryExit: null },
    pmOutcome: "TASK_DONE",
    integrationCommits: [unitCommit()],
    writeSetUnchanged: false,
    intentionallyEmpty: [],
    ...overrides
  };
}

const LEGAL_REASON = "the convergence point already consolidated this helper in wave 1";

describe("FR-NODE-119 — the three disjuncts", () => {
  it("FR-NODE-119 AC-1 declares exactly three, in the order the gate states them", () => {
    expect([...SERIAL_UNIT_DISJUNCTS]).toEqual(["verification-cmd-failed", "commitless-and-undeclared", "pm-needs-user-or-failed"]);
  });

  it("FR-NODE-119 AC-3 passes a unit that committed under its trailers, verified clean and returned TASK_DONE", () => {
    const outcome = evaluateSerialUnitGate(input());
    expect(outcome.verdict).toBe("pass");
    expect(outcome.code).toBeNull();
    expect(outcome.disjunct).toBeNull();
  });
});

describe("FR-NODE-119 AC-1/AC-2 — the verification_cmd disjunct and its one retry against the same SDS", () => {
  it("FR-NODE-119 AC-1 refuses when the command exits non-zero, is re-run once against the same SDS, and exits non-zero again", () => {
    const outcome = evaluateSerialUnitGate(input({ verification: { firstExit: 1, retryExit: 1 } }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.code).toBe("serial-unit-failed");
    expect(outcome.disjunct).toBe("verification-cmd-failed");
    expect(outcome.detail).toContain("same SDS");
  });

  it("FR-NODE-119 AC-1 asks for the retry rather than refusing when the first run failed and no retry has been made", () => {
    const outcome = evaluateSerialUnitGate(input({ verification: { firstExit: 1, retryExit: null } }));
    expect(outcome.verdict).toBe("retry-verification");
    expect(outcome.code).toBeNull();
    expect(outcome.retryConsumed).toBe(false);
  });

  it("FR-NODE-119 AC-1 passes when the retry against the same SDS exits zero", () => {
    const outcome = evaluateSerialUnitGate(input({ verification: { firstExit: 1, retryExit: 0 } }));
    expect(outcome.verdict).toBe("pass");
    expect(outcome.retryConsumed).toBe(true);
  });

  it("FR-NODE-119 AC-2 the commitless-and-undeclared disjunct refuses with no retry", () => {
    const outcome = evaluateSerialUnitGate(input({ integrationCommits: [], verification: { firstExit: 1, retryExit: null } }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.disjunct).toBe("commitless-and-undeclared");
    expect(outcome.retryConsumed, "no retry is spent on a disjunct a retry cannot change").toBe(false);
  });

  it("FR-NODE-119 AC-6 AC-2 the NEEDS_USER / FAILED disjunct refuses with no retry", () => {
    for (const pmOutcome of ["NEEDS_USER", "FAILED"] as const) {
      const outcome = evaluateSerialUnitGate(input({ pmOutcome, verification: { firstExit: 1, retryExit: null } }));
      expect(outcome.verdict).toBe("refuse");
      expect(outcome.disjunct).toBe("pm-needs-user-or-failed");
      expect(outcome.retryConsumed).toBe(false);
    }
  });
});

describe("FR-NODE-119 AC-3 — the commitless disjunct", () => {
  it("FR-NODE-119 AC-3 refuses a unit with no trailered commit and no intentionally_empty entry", () => {
    const outcome = evaluateSerialUnitGate(input({ integrationCommits: [] }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.code).toBe("serial-unit-failed");
    expect(outcome.disjunct).toBe("commitless-and-undeclared");
  });

  it("FR-NODE-119 AC-3 requires the commit to carry this unit's own run, wave, stage and lane trailers", () => {
    for (const [trailer, value] of [
      ["Orch-Run", "another-run"],
      ["Orch-Wave", "2"],
      ["Orch-Stage", "2"],
      ["Orch-Lane", "lane-run-wave-9"]
    ] as const) {
      expect(evaluateSerialUnitGate(input({ integrationCommits: [unitCommit({ [trailer]: value })] })).verdict, trailer).toBe("refuse");
    }
  });

  it("FR-NODE-119 AC-3 needs no task trailer: the four run, wave, stage and lane trailers land the unit", () => {
    const commit = unitCommit();
    expect(Object.keys(commit.trailers).sort()).toEqual(["Orch-Lane", "Orch-Run", "Orch-Stage", "Orch-Wave"]);
    expect(evaluateSerialUnitGate(input({ integrationCommits: [commit] })).verdict).toBe("pass");
  });
});

describe("FR-NODE-119 AC-4/AC-5/AC-7 — the intentionally_empty declaration and its two witnesses", () => {
  const commitless = { integrationCommits: [], writeSetUnchanged: true };

  it("FR-NODE-119 AC-4 does not refuse when an entry carries the unit's lane id, a reason of at least 20 characters, and both witnesses hold", () => {
    expect(LEGAL_REASON.length).toBeGreaterThanOrEqual(INTENTIONALLY_EMPTY_MIN_REASON_LENGTH);
    const outcome = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [{ laneId: LANE, reason: LEGAL_REASON }] }));
    expect(outcome.verdict).toBe("pass");
  });

  it("FR-NODE-119 AC-4 declares the reason bar as twenty characters", () => {
    expect(INTENTIONALLY_EMPTY_MIN_REASON_LENGTH).toBe(20);
  });

  it("FR-NODE-119 AC-5 an entry whose reason is under the bar is not a legal declaration", () => {
    const outcome = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [{ laneId: LANE, reason: "no reason" }] }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.disjunct).toBe("commitless-and-undeclared");
    expect(outcome.illegalDeclaration).toContain("characters");
  });

  it("FR-NODE-119 AC-5 an entry whose verification_cmd exits non-zero is not a legal declaration", () => {
    const outcome = evaluateSerialUnitGate(
      input({ ...commitless, verification: { firstExit: 1, retryExit: null }, intentionallyEmpty: [{ laneId: LANE, reason: LEGAL_REASON }] })
    );
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.illegalDeclaration).toContain("verification_cmd");
  });

  it("FR-NODE-119 AC-5 an entry whose write set changed between base and head is not a legal declaration", () => {
    const outcome = evaluateSerialUnitGate(
      input({ integrationCommits: [], writeSetUnchanged: false, intentionallyEmpty: [{ laneId: LANE, reason: LEGAL_REASON }] })
    );
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.illegalDeclaration).toContain("write set");
  });

  it("FR-NODE-119 AC-5 the unit is then treated exactly as though no declaration had been made", () => {
    const undeclared = evaluateSerialUnitGate(input({ ...commitless }));
    const illegal = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [{ laneId: LANE, reason: "too short" }] }));
    expect(illegal.verdict).toBe(undeclared.verdict);
    expect(illegal.disjunct).toBe(undeclared.disjunct);
    expect(illegal.checkedLaneIds).toEqual(undeclared.checkedLaneIds);
    expect(illegal.expectedLaneIds).toEqual(undeclared.expectedLaneIds);
  });

  it("FR-NODE-119 AC-7 the unchanged-write-set witness is an input the orchestrator recomputed, never a value the declaration carries", () => {
    const declaration = { laneId: LANE, reason: LEGAL_REASON };
    expect(Object.keys(declaration).sort()).toEqual(["laneId", "reason"]);
    const witnessed = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [declaration] }));
    const unwitnessed = evaluateSerialUnitGate(input({ integrationCommits: [], writeSetUnchanged: false, intentionallyEmpty: [declaration] }));
    expect(witnessed.verdict).toBe("pass");
    expect(unwitnessed.verdict).toBe("refuse");
  });

  it("FR-NODE-119 AC-4 ignores a declaration naming another unit's lane", () => {
    const outcome = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [{ laneId: "lane-run-wave-9", reason: LEGAL_REASON }] }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.illegalDeclaration).toBeNull();
  });
});

describe("FR-NODE-119 AC-8 — the denominator is unchanged by a legal declaration", () => {
  it("FR-NODE-119 AC-8 keeps a legally declared unit in expected and enters it into checked", () => {
    const outcome = evaluateSerialUnitGate(input({ integrationCommits: [], writeSetUnchanged: true, intentionallyEmpty: [{ laneId: LANE, reason: LEGAL_REASON }] }));
    expect(outcome.verdict).toBe("pass");
    expect(outcome.expectedLaneIds).toEqual([LANE]);
    expect(outcome.checkedLaneIds).toEqual([LANE]);
  });

  it("FR-NODE-119 AC-8 enters a landed unit into checked as well", () => {
    const outcome = evaluateSerialUnitGate(input());
    expect(outcome.expectedLaneIds).toEqual([LANE]);
    expect(outcome.checkedLaneIds).toEqual([LANE]);
  });

  it("FR-NODE-119 AC-8 leaves an unlanded, undeclared unit out of checked while keeping it in expected", () => {
    const outcome = evaluateSerialUnitGate(input({ integrationCommits: [] }));
    expect(outcome.expectedLaneIds).toEqual([LANE]);
    expect(outcome.checkedLaneIds).toEqual([]);
  });
});
