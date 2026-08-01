import { describe, expect, it } from "vitest";
import {
  INTENTIONALLY_EMPTY_MIN_REASON_LENGTH,
  SERIAL_UNIT_DISJUNCTS,
  evaluateSerialUnitGate,
  type SerialUnitInput
} from "../../../src/core/orchestrator/unit-gate.js";

// @req FR-NODE-119 — `serial-unit-failed`: three disjuncts, all evaluable from the repository tree.
// The commitless escape is legal only on two witnesses neither of which is the unit's own assertion.

const RUN_ID = "2026-08-02.speckiwi.v260";

function unitCommit(taskId: string, lane = "lane-1") {
  return { commit: `sha-${taskId}`, trailers: { "Orch-Run": RUN_ID, "Orch-Wave": "1", "Orch-Stage": "1", "Orch-Lane": lane, "Orch-Task": taskId } };
}

function input(overrides: Partial<SerialUnitInput> = {}): SerialUnitInput {
  return {
    runId: RUN_ID,
    key: { wave: 1, stage: 1, lane: "lane-1" },
    verification: { firstExit: 0, retryExit: null },
    pmOutcome: "TASK_DONE",
    integrationCommits: [unitCommit("T-1")],
    tasks: [{ taskId: "T-1", verificationCmdExit: 0, writeSetUnchanged: false }],
    intentionallyEmpty: [],
    ...overrides
  };
}

const LEGAL_REASON = "the convergence point already consolidated this helper in T-0";

describe("FR-NODE-119 — the three disjuncts", () => {
  it("declares exactly three, in the order §5.14 states them", () => {
    expect([...SERIAL_UNIT_DISJUNCTS]).toEqual(["verification-cmd-failed", "commitless-and-undeclared", "pm-needs-user-or-failed"]);
    expect(SERIAL_UNIT_DISJUNCTS).toHaveLength(3);
  });

  it("passes a unit that committed, verified clean and returned TASK_DONE", () => {
    const outcome = evaluateSerialUnitGate(input());
    expect(outcome.verdict).toBe("pass");
    expect(outcome.code).toBeNull();
    expect(outcome.disjunct).toBeNull();
  });
});

describe("FR-NODE-119 AC-1/AC-2 — the verification_cmd disjunct and its one retry", () => {
  it("AC-1: refuses when the command exits non-zero, is re-run once against the same handoff, and exits non-zero again", () => {
    const outcome = evaluateSerialUnitGate(input({ verification: { firstExit: 1, retryExit: 1 } }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.code).toBe("serial-unit-failed");
    expect(outcome.disjunct).toBe("verification-cmd-failed");
  });

  it("asks for the retry rather than refusing when the first run failed and no retry has been made", () => {
    const outcome = evaluateSerialUnitGate(input({ verification: { firstExit: 1, retryExit: null } }));
    expect(outcome.verdict).toBe("retry-verification");
    expect(outcome.code).toBeNull();
    expect(outcome.retryConsumed).toBe(false);
  });

  it("passes when the retry against the same handoff exits zero", () => {
    const outcome = evaluateSerialUnitGate(input({ verification: { firstExit: 1, retryExit: 0 } }));
    expect(outcome.verdict).toBe("pass");
    expect(outcome.retryConsumed).toBe(true);
  });

  it("AC-2: the commitless-and-undeclared disjunct refuses with no retry", () => {
    const outcome = evaluateSerialUnitGate(input({ integrationCommits: [], verification: { firstExit: 1, retryExit: null } }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.disjunct).toBe("commitless-and-undeclared");
    expect(outcome.retryConsumed, "no retry is spent on a disjunct a retry cannot change").toBe(false);
  });

  it("AC-2: the NEEDS_USER / FAILED disjunct refuses with no retry", () => {
    for (const pmOutcome of ["NEEDS_USER", "FAILED"] as const) {
      const outcome = evaluateSerialUnitGate(input({ pmOutcome, verification: { firstExit: 1, retryExit: null } }));
      expect(outcome.verdict).toBe("refuse");
      expect(outcome.disjunct).toBe("pm-needs-user-or-failed");
      expect(outcome.retryConsumed).toBe(false);
    }
  });
});

describe("FR-NODE-119 AC-3 — the commitless disjunct", () => {
  it("refuses a unit with no trailered commit and no intentionally_empty entry", () => {
    const outcome = evaluateSerialUnitGate(input({ integrationCommits: [] }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.code).toBe("serial-unit-failed");
    expect(outcome.disjunct).toBe("commitless-and-undeclared");
  });

  it("requires the commit to carry this unit's own Orch-Lane and Orch-Task trailers", () => {
    const wrongLane = { ...unitCommit("T-1"), trailers: { ...unitCommit("T-1").trailers, "Orch-Lane": "lane-9" } };
    expect(evaluateSerialUnitGate(input({ integrationCommits: [wrongLane] })).verdict).toBe("refuse");
    const wrongTask = { ...unitCommit("T-1"), trailers: { ...unitCommit("T-1").trailers, "Orch-Task": "T-OTHER" } };
    expect(evaluateSerialUnitGate(input({ integrationCommits: [wrongTask] })).verdict).toBe("refuse");
  });

  it("does not fire when at least one of the unit's tasks committed", () => {
    const outcome = evaluateSerialUnitGate(
      input({
        tasks: [
          { taskId: "T-1", verificationCmdExit: 0, writeSetUnchanged: false },
          { taskId: "T-2", verificationCmdExit: 0, writeSetUnchanged: false }
        ],
        integrationCommits: [unitCommit("T-1")]
      })
    );
    expect(outcome.verdict).toBe("pass");
  });
});

describe("FR-NODE-119 AC-4/AC-5/AC-7 — the intentionally_empty declaration and its two witnesses", () => {
  const commitless = {
    integrationCommits: [],
    tasks: [{ taskId: "T-1", verificationCmdExit: 0, writeSetUnchanged: true }]
  };

  it("AC-4: does not refuse when a per-task entry carries the task id, a reason of at least 20 characters, and both witnesses hold", () => {
    expect(LEGAL_REASON.length).toBeGreaterThanOrEqual(INTENTIONALLY_EMPTY_MIN_REASON_LENGTH);
    const outcome = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [{ taskId: "T-1", reason: LEGAL_REASON }] }));
    expect(outcome.verdict).toBe("pass");
  });

  it("declares the reason bar as twenty characters, reusing §6.5 closure 2's", () => {
    expect(INTENTIONALLY_EMPTY_MIN_REASON_LENGTH).toBe(20);
  });

  it("AC-5: an entry whose reason is under the bar is not a legal declaration", () => {
    const outcome = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [{ taskId: "T-1", reason: "no reason" }] }));
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.disjunct).toBe("commitless-and-undeclared");
    expect(outcome.illegalDeclarations.map((entry) => entry.taskId)).toContain("T-1");
  });

  it("AC-5: an entry whose verification_cmd exits non-zero is not a legal declaration", () => {
    const outcome = evaluateSerialUnitGate(
      input({
        integrationCommits: [],
        tasks: [{ taskId: "T-1", verificationCmdExit: 1, writeSetUnchanged: true }],
        intentionallyEmpty: [{ taskId: "T-1", reason: LEGAL_REASON }]
      })
    );
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.illegalDeclarations.some((entry) => entry.reason.includes("verification_cmd"))).toBe(true);
  });

  it("AC-5: an entry whose write set changed between base and head is not a legal declaration", () => {
    const outcome = evaluateSerialUnitGate(
      input({
        integrationCommits: [],
        tasks: [{ taskId: "T-1", verificationCmdExit: 0, writeSetUnchanged: false }],
        intentionallyEmpty: [{ taskId: "T-1", reason: LEGAL_REASON }]
      })
    );
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.illegalDeclarations.some((entry) => entry.reason.includes("write_set"))).toBe(true);
  });

  it("AC-5: the task is then treated exactly as though no declaration had been made", () => {
    const undeclared = evaluateSerialUnitGate(input({ integrationCommits: [], tasks: commitless.tasks }));
    const illegal = evaluateSerialUnitGate(
      input({ ...commitless, intentionallyEmpty: [{ taskId: "T-1", reason: "too short" }] })
    );
    expect(illegal.verdict).toBe(undeclared.verdict);
    expect(illegal.disjunct).toBe(undeclared.disjunct);
    expect(illegal.checkedTaskIds).toEqual(undeclared.checkedTaskIds);
    expect(illegal.expectedTaskIds).toEqual(undeclared.expectedTaskIds);
  });

  it("AC-7: the unchanged-write-set witness is a recomputed fact of the input, never a value the unit reported", () => {
    // The declaration carries a task id and a reason and nothing else. There is no field through
    // which a unit could assert its own diff was empty.
    const declaration = { taskId: "T-1", reason: LEGAL_REASON };
    expect(Object.keys(declaration).sort()).toEqual(["reason", "taskId"]);
    const witnessed = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [declaration] }));
    const unwitnessed = evaluateSerialUnitGate(
      input({ integrationCommits: [], tasks: [{ taskId: "T-1", verificationCmdExit: 0, writeSetUnchanged: false }], intentionallyEmpty: [declaration] })
    );
    expect(witnessed.verdict).toBe("pass");
    expect(unwitnessed.verdict).toBe("refuse");
  });

  it("ignores a declaration naming a task the unit does not carry", () => {
    const outcome = evaluateSerialUnitGate(input({ ...commitless, intentionallyEmpty: [{ taskId: "T-GHOST", reason: LEGAL_REASON }] }));
    expect(outcome.verdict).toBe("refuse");
  });
});

describe("FR-NODE-119 AC-8 — the denominator is unchanged by a legal declaration", () => {
  it("keeps a legally declared task in expected and enters it into checked", () => {
    const outcome = evaluateSerialUnitGate(
      input({
        integrationCommits: [unitCommit("T-1")],
        tasks: [
          { taskId: "T-1", verificationCmdExit: 0, writeSetUnchanged: false },
          { taskId: "T-2", verificationCmdExit: 0, writeSetUnchanged: true }
        ],
        intentionallyEmpty: [{ taskId: "T-2", reason: LEGAL_REASON }]
      })
    );
    expect(outcome.verdict).toBe("pass");
    expect(outcome.expectedTaskIds).toEqual(["T-1", "T-2"]);
    expect(outcome.checkedTaskIds).toEqual(["T-1", "T-2"]);
  });

  it("does not remove the declared task from expected, which would shrink the denominator on the unit's say-so", () => {
    const outcome = evaluateSerialUnitGate(
      input({
        integrationCommits: [unitCommit("T-1")],
        tasks: [
          { taskId: "T-1", verificationCmdExit: 0, writeSetUnchanged: false },
          { taskId: "T-2", verificationCmdExit: 0, writeSetUnchanged: true }
        ],
        intentionallyEmpty: [{ taskId: "T-2", reason: LEGAL_REASON }]
      })
    );
    expect(outcome.expectedTaskIds).toContain("T-2");
    expect(outcome.expectedTaskIds).toHaveLength(2);
  });

  it("leaves an unlanded, undeclared task out of checked while keeping it in expected", () => {
    const outcome = evaluateSerialUnitGate(
      input({
        integrationCommits: [unitCommit("T-1")],
        tasks: [
          { taskId: "T-1", verificationCmdExit: 0, writeSetUnchanged: false },
          { taskId: "T-2", verificationCmdExit: 0, writeSetUnchanged: true }
        ]
      })
    );
    expect(outcome.expectedTaskIds).toEqual(["T-1", "T-2"]);
    expect(outcome.checkedTaskIds).toEqual(["T-1"]);
  });
});
