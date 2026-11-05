import { describe, expect, it } from "vitest";
import { REQUIRED_VERIFIER_COUNT } from "../../../src/core/orchestrator/journal-schema.js";
import { evaluateRound, projectRound, roundPayloadProblems, terminalResidualProblems, type Round } from "../../../src/core/orchestrator/verification-gate.js";

// FR-NODE-254 — a round is judged and recorded by kept findings proven by a run, never by severity.

function round(overrides: Partial<Round> = {}): Round {
  return {
    loop: "P",
    scope: "wave-1-post",
    roundIndex: 1,
    mode: "normal",
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 2,
    verifiers: ["verifier-1"],
    rows: [
      { id: "R1", verdict: "pass", kept: false, verifier: "verifier-1" },
      { id: "R2", verdict: "match", kept: false, verifier: "verifier-1" }
    ],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: [],
    ...overrides
  };
}

const KEPT = { id: "R1", verdict: "mismatch", kept: true, evidence: "test/a.test.ts > fails red", verifier: "verifier-1" };
const DROPPED = { id: "R2", verdict: "mismatch", kept: false, verifier: "verifier-1" };

describe("FR-NODE-254 AC-1 — the round payload carries verifiers and keep/drop rows", () => {
  // @req FR-NODE-254 AC-1
  it("accepts a round whose rows are {id, verdict, kept, evidence?, verifier} under its verifiers", () => {
    expect(roundPayloadProblems(round({ rows: [KEPT, DROPPED] }) as unknown as Record<string, unknown>)).toEqual([]);
  });

  // @req FR-NODE-254 AC-1
  it("refuses a row carrying severity", () => {
    const payload = round({ rows: [{ ...DROPPED, severity: "HIGH" } as never, KEPT] });
    const problems = roundPayloadProblems(payload as unknown as Record<string, unknown>);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("rows[0]");
    expect(problems[0]).toContain("severity");
  });

  // @req FR-NODE-254 AC-1
  it("refuses a kept row without evidence, and a kept row whose evidence is blank", () => {
    const missing = roundPayloadProblems(round({ rows: [{ ...KEPT, evidence: undefined } as never, DROPPED] }) as unknown as Record<string, unknown>);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("evidence");
    const blank = roundPayloadProblems(round({ rows: [{ ...KEPT, evidence: "  " }, DROPPED] }) as unknown as Record<string, unknown>);
    expect(blank).toHaveLength(1);
    // A dropped row needs no evidence.
    expect(roundPayloadProblems(round({ rows: [DROPPED, { ...DROPPED, id: "R3" }] }) as unknown as Record<string, unknown>)).toEqual([]);
  });

  // @req FR-NODE-254 AC-1
  it("refuses a row without verifier, and a row whose verifier is not one of the round's verifiers", () => {
    const missing = roundPayloadProblems(round({ rows: [{ ...DROPPED, verifier: undefined } as never, KEPT] }) as unknown as Record<string, unknown>);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("verifier");
    const stranger = roundPayloadProblems(round({ rows: [{ ...DROPPED, verifier: "verifier-9" }, KEPT] }) as unknown as Record<string, unknown>);
    expect(stranger).toHaveLength(1);
    expect(stranger[0]).toContain("verifier-9");
  });

  // @req FR-NODE-254 AC-1
  it("refuses a round without verifiers", () => {
    const payload = { ...round() } as Record<string, unknown>;
    delete payload.verifiers;
    const problems = roundPayloadProblems(payload);
    expect(problems.some((problem) => problem.includes("verifiers"))).toBe(true);
    // An empty list names no verifier, so it is a round without verifiers too.
    const empty = roundPayloadProblems(round({ verifiers: [], rows: [], frozenDenominator: 0 }) as unknown as Record<string, unknown>);
    expect(empty).toHaveLength(1);
    expect(empty[0]).toContain("verifiers");
  });

  // @req FR-NODE-254 AC-1
  it("refuses a row whose kept is not a boolean, so a missing kept is never read as dropped", () => {
    const problems = roundPayloadProblems(round({ rows: [{ ...DROPPED, kept: undefined } as never, KEPT] }) as unknown as Record<string, unknown>);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("kept");
  });
});

describe("FR-NODE-254 AC-2 — evaluateRound passes on no kept row and the mode's verifier count", () => {
  // @req FR-NODE-254 AC-2
  it("passes a round with dropped rows and no kept row, in normal and in max", () => {
    expect(evaluateRound(round({ rows: [DROPPED, { ...DROPPED, id: "R3" }] })).verdict).toBe("pass");
    const max = round({
      mode: "max",
      streakBefore: 1,
      verifiers: ["verifier-1", "verifier-2"],
      rows: [DROPPED, { ...DROPPED, id: "R3", verifier: "verifier-2" }]
    });
    expect(evaluateRound(max).verdict).toBe("pass");
  });

  // @req FR-NODE-254 AC-2
  it("does not pass a round holding one kept row", () => {
    const outcome = evaluateRound(round({ rows: [KEPT, DROPPED] }));
    expect(outcome.verdict).toBe("fail-residual");
    expect(outcome.streak).toBe(0);
  });

  // @req FR-NODE-254 AC-2
  it("does not pass a clean round in which a fix was applied or which shows a new failure", () => {
    expect(evaluateRound(round({ fixAppliedThisRound: true })).verdict).not.toBe("pass");
    expect(
      evaluateRound(round({ regression: { failingTests: ["t/new.test.ts"], baselineFailingTests: [], exitCode: 1 } })).verdict
    ).not.toBe("pass");
  });

  // @req FR-NODE-254 AC-2
  it("lets no severity class enter the verdict: a stray severity on a dropped row changes nothing", () => {
    const plain = evaluateRound(round({ rows: [DROPPED, { ...DROPPED, id: "R3" }] }));
    const withStray = evaluateRound(
      round({ rows: [{ ...DROPPED, severity: "CRITICAL" } as never, { ...DROPPED, id: "R3", severity: "HIGH" } as never] })
    );
    expect(withStray).toEqual(plain);
    expect(withStray.verdict).toBe("pass");
  });

  // @req FR-NODE-254 AC-2
  it("declares one verifier for every mode but max, which declares two", () => {
    expect(REQUIRED_VERIFIER_COUNT).toEqual({ normal: 1, max: 2, mini: 1, explicit: 1 });
  });

  // @req FR-NODE-254 AC-2
  it("returns invalid for a --max round reviewed by one verifier, even when it holds no row", () => {
    const outcome = evaluateRound(round({ mode: "max", streakBefore: 1, frozenDenominator: 0, rows: [] }));
    expect(outcome.verdict).toBe("invalid");
    expect(outcome.streak).toBe(0);
    expect(outcome.capRemaining).toBe(4);
  });

  // @req FR-NODE-254 AC-2
  it("returns invalid for a default-mode round reviewed by two verifiers, or by none", () => {
    expect(evaluateRound(round({ verifiers: ["verifier-1", "verifier-2"] })).verdict).toBe("invalid");
    expect(evaluateRound(round({ verifiers: [], rows: [], frozenDenominator: 0 })).verdict).toBe("invalid");
    // Distinct identifiers are counted, so naming one verifier twice is still one verifier.
    expect(evaluateRound(round({ mode: "max", streakBefore: 1, verifiers: ["verifier-1", "verifier-1"] })).verdict).toBe("invalid");
  });
});

describe("FR-NODE-254 AC-3 — the projected line carries findings and red_tests, not axis_a or axis_b", () => {
  // @req FR-NODE-254 AC-3
  it("counts kept and dropped findings and lists the kept rows' evidence as red_tests", () => {
    const value = round({
      frozenDenominator: 5,
      rows: [
        KEPT,
        { ...KEPT, id: "R4", evidence: "npm test exit 1: t/b.test.ts" },
        DROPPED,
        { ...DROPPED, id: "R5" },
        // A clean row is not a finding at all, so it is neither kept nor dropped.
        { id: "R6", verdict: "pass", kept: false, verifier: "verifier-1" }
      ]
    });
    const line = projectRound(value, evaluateRound(value));
    const verification = line?.verification as Record<string, unknown>;

    expect(line?.phase).toBe("wave-verify");
    expect(verification.findings).toEqual({ kept: 2, dropped: 2 });
    expect(verification.red_tests).toEqual(["test/a.test.ts > fails red", "npm test exit 1: t/b.test.ts"]);
    expect(Object.keys(verification)).not.toContain("axis_a");
    expect(Object.keys(verification)).not.toContain("axis_b");
  });
});

describe("FR-NODE-254 AC-3 — a terminal fail-cap round lists every kept finding in its residual", () => {
  // The severity line's `truncated-residual` compared the residual with `axis_b.open`; with `axis_b`
  // gone, the open kept findings of a round that ran out of cap are what the residual must carry.
  const exhausted = (overrides: Partial<Round> = {}): Round =>
    round({ cap: 1, roundIndex: 1, frozenDenominator: 2, rows: [KEPT, DROPPED], ...overrides });

  // @req FR-NODE-254 AC-3
  it("refuses a fail-cap round whose kept row is missing from residual", () => {
    const value = exhausted({ residual: [] });
    expect(evaluateRound(value).verdict).toBe("fail-cap");
    const problems = terminalResidualProblems(value, evaluateRound(value));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("fail-cap");
    expect(problems[0]).toContain("R1");
  });

  // @req FR-NODE-254 AC-3
  it("refuses a fail-cap round whose residual names another finding in place of its kept row", () => {
    const value = exhausted({ residual: [{ id: "R9", reasonClass: "design-gap" }] });
    const problems = terminalResidualProblems(value, evaluateRound(value));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("missing R1");
  });

  // @req FR-NODE-254 AC-3
  it("refuses a fail-cap round whose residual carries more than its kept rows", () => {
    const value = exhausted({ residual: [{ id: "R1", reasonClass: "design-gap" }, { id: "R9", reasonClass: "design-gap" }] });
    expect(terminalResidualProblems(value, evaluateRound(value))).toHaveLength(1);
  });

  // @req FR-NODE-254 AC-3
  it("accepts a fail-cap round whose residual is exactly its kept rows, and checks no other verdict", () => {
    const complete = exhausted({ residual: [{ id: "R1", reasonClass: "design-gap" }] });
    expect(terminalResidualProblems(complete, evaluateRound(complete))).toEqual([]);
    // A round that may still run (journal verdict in-progress) carries no terminal residual yet.
    const running = round({ rows: [KEPT, DROPPED], residual: [] });
    expect(evaluateRound(running).verdict).toBe("fail-residual");
    expect(terminalResidualProblems(running, evaluateRound(running))).toEqual([]);
  });
});
