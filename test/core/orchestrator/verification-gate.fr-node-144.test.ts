import { describe, expect, it } from "vitest";
import { LOOP_MODES, REQUIRED_CLEAN_STREAK, ROUND_VERDICTS } from "../../../src/core/orchestrator/journal-schema.js";
import { evaluateRound, type Round } from "../../../src/core/orchestrator/verification-gate.js";

// FR-NODE-144 — evaluateRound is a pure predicate over one round, given the mode explicitly.

function round(overrides: Partial<Round> = {}): Round {
  return {
    loop: "P",
    scope: "wave-1",
    roundIndex: 2,
    mode: "normal",
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 3,
    rows: [
      { id: "R1", verdict: "pass", severity: "LOW" },
      { id: "R2", verdict: "match", severity: "LOW" },
      { id: "R3", verdict: "intended-improvement", severity: "LOW" }
    ],
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: [],
    ...overrides
  };
}

describe("FR-NODE-144 evaluateRound", () => {
  it("AC-1 returns all five fields and a verdict from the closed five-value set", () => {
    const outcome = evaluateRound(round());

    expect(Object.keys(outcome).sort()).toEqual(["capRemaining", "streak", "unreachable", "verdict", "violations"]);
    expect([...ROUND_VERDICTS]).toEqual(["pass", "pass-with-residual", "fail-residual", "fail-cap", "invalid"]);
    expect(ROUND_VERDICTS).toContain(outcome.verdict);
    expect(outcome.verdict).toBe("pass");
    expect(outcome.streak).toBe(1);
    expect(outcome.capRemaining).toBe(3);
    expect(outcome.unreachable).toBe(false);
  });

  it("AC-2 invalidates a round whose row count differs from its frozen denominator", () => {
    const invalid = evaluateRound(round({ frozenDenominator: 4, streakBefore: 1 }));

    expect(invalid.verdict).toBe("invalid");
    expect(invalid.violations).toContain("denominator-mismatch");
    // The cap is consumed by an invalid round and the streak is reset.
    expect(invalid.capRemaining).toBe(3);
    expect(invalid.streak).toBe(0);

    const failing = evaluateRound(
      round({ rows: [{ id: "R1", verdict: "gap", severity: "HIGH" }, { id: "R2", verdict: "pass", severity: "LOW" }, { id: "R3", verdict: "pass", severity: "LOW" }] })
    );
    expect(failing.verdict).toBe("fail-residual");
    // Distinguishable: an invalid round is not a failed round.
    expect(failing.verdict).not.toBe(invalid.verdict);
  });

  it("AC-3 refuses to pass a round in which a fix was applied", () => {
    const outcome = evaluateRound(round({ fixAppliedThisRound: true }));

    expect(outcome.verdict).not.toBe("pass");
    expect(outcome.verdict).toBe("fail-residual");
    expect(outcome.violations).toEqual(["fix-in-clean-round"]);
    expect(outcome.streak).toBe(0);
  });

  it("AC-4 reports PASS unreachable when the rounds left are fewer than the mode's streak", () => {
    // --max requires two consecutive clean rounds; at round 8 of 8 with a dirty round there is no
    // arithmetic path to a pass.
    const dirty = { rows: [{ id: "R1", verdict: "gap", severity: "HIGH" as const }], frozenDenominator: 1 };
    const exhausted = evaluateRound(round({ mode: "max", cap: 8, roundIndex: 8, ...dirty }));

    expect(exhausted.unreachable).toBe(true);
    expect(exhausted.verdict).toBe("fail-cap");
    expect(exhausted.capRemaining).toBe(0);

    const roomy = evaluateRound(round({ mode: "max", cap: 12, roundIndex: 8, ...dirty }));
    expect(roomy.unreachable).toBe(false);
    expect(roomy.verdict).toBe("fail-residual");
  });

  it("AC-5 can return different verdicts for two calls differing only in mode", () => {
    const normal = evaluateRound(round({ mode: "normal" }));
    const max = evaluateRound(round({ mode: "max" }));

    expect(normal.verdict).toBe("pass");
    // The same clean round under --max needs a second consecutive clean round.
    expect(max.verdict).toBe("fail-residual");
    expect(max.streak).toBe(1);

    // And the mode is never inferred: a `cap` of 8 is ambiguous between --max and --loops 8, so a
    // round carrying cap 8 under `explicit` still uses the explicit mode's streak requirement.
    expect(evaluateRound(round({ mode: "explicit", cap: 8 })).verdict).toBe("pass");
    expect(evaluateRound(round({ mode: "max", cap: 8 })).verdict).toBe("fail-residual");
  });

  it("AC-5 declares a streak requirement for every mode", () => {
    expect([...LOOP_MODES]).toEqual(["normal", "max", "mini", "explicit"]);
    expect(REQUIRED_CLEAN_STREAK).toEqual({ normal: 1, max: 2, mini: 1, explicit: 1 });
  });

  it("AC-6 is pure and deterministic", () => {
    const value = round();
    expect(evaluateRound(value)).toEqual(evaluateRound(value));
    // A pure predicate does not mutate its argument.
    expect(value).toEqual(round());
    expect(evaluateRound.length).toBe(1);
  });

  it("passes with residual when the gate is met and unresolved findings remain", () => {
    const outcome = evaluateRound(round({ residual: [{ id: "F-1", reasonClass: "scope-boundary-deferred" }] }));

    expect(outcome.verdict).toBe("pass-with-residual");
    expect(outcome.violations).toEqual([]);
  });

  it("reaches --max's pass on the second consecutive clean round", () => {
    expect(evaluateRound(round({ mode: "max", streakBefore: 1 })).verdict).toBe("pass");
  });

  it("blocks a pass on a new regression and on a missing baseline with a non-zero exit", () => {
    const regressed = evaluateRound(
      round({ regression: { failingTests: ["t/new.test.ts"], baselineFailingTests: [], exitCode: 1 } })
    );
    expect(regressed.violations).toContain("new-regression");
    expect(regressed.verdict).not.toBe("pass");

    const noBaseline = evaluateRound(
      round({ regression: { failingTests: ["t/a.test.ts"], baselineFailingTests: null, exitCode: 1 } })
    );
    expect(noBaseline.violations).toContain("no-baseline-nonzero-exit");
    expect(noBaseline.verdict).not.toBe("pass");

    // A pre-existing failure that is still in the baseline is not a new regression.
    const preexisting = evaluateRound(
      round({ regression: { failingTests: ["t/a.test.ts"], baselineFailingTests: ["t/a.test.ts"], exitCode: 1 } })
    );
    expect(preexisting.violations).toEqual([]);
    expect(preexisting.verdict).toBe("pass");
  });

  it("blocks a pass on an unapproved-damage row and on an open CRITICAL row", () => {
    const damaged = evaluateRound(
      round({ rows: [{ id: "R1", verdict: "unapproved-damage", severity: "LOW" }], frozenDenominator: 1 })
    );
    expect(damaged.violations).toContain("unapproved-damage");
    expect(damaged.verdict).not.toBe("pass");

    const critical = evaluateRound(round({ rows: [{ id: "R1", verdict: "gap", severity: "CRITICAL" }], frozenDenominator: 1 }));
    expect(critical.verdict).toBe("fail-residual");

    // Normal's early exit: an open MEDIUM does not block the Normal gate.
    const medium = evaluateRound(round({ rows: [{ id: "R1", verdict: "gap", severity: "MEDIUM" }], frozenDenominator: 1 }));
    expect(medium.verdict).toBe("pass");
    // --max additionally requires MEDIUM = 0, so the same round does not build a streak there.
    expect(evaluateRound(round({ mode: "max", streakBefore: 1, rows: [{ id: "R1", verdict: "gap", severity: "MEDIUM" }], frozenDenominator: 1 })).verdict).toBe(
      "fail-residual"
    );
  });

  it("returns fail-cap once the cap is consumed without a pass", () => {
    const outcome = evaluateRound(
      round({ roundIndex: 5, cap: 5, rows: [{ id: "R1", verdict: "gap", severity: "HIGH" }], frozenDenominator: 1 })
    );

    expect(outcome.verdict).toBe("fail-cap");
    expect(outcome.violations).toContain("cap-exhausted");
    expect(outcome.capRemaining).toBe(0);
  });
});
