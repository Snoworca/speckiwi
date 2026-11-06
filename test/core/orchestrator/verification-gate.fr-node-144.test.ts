import { describe, expect, it } from "vitest";
import { LOOP_MODES, REQUIRED_CLEAN_STREAK, ROUND_VERDICTS } from "../../../src/core/orchestrator/journal-schema.js";
import { evaluateRound, type Round } from "../../../src/core/orchestrator/verification-gate.js";

// FR-NODE-144 — evaluateRound is a pure predicate over one round, given the mode explicitly.
// FR-NODE-254 replaced the severity rows with keep/drop rows under a declared verifier list: a `--max`
// round names two verifiers, every other mode one.

const V = "verifier-1";
const MAX_VERIFIERS = ["verifier-1", "verifier-2"];

/** A finding a run proved: the only kind that blocks the gate. */
const KEPT = { id: "R1", verdict: "gap", kept: true, evidence: "test/a.test.ts > red", verifier: V };
/** A finding no run proved: it never blocks the gate. */
const DROPPED = { id: "R1", verdict: "gap", kept: false, verifier: V };

function round(overrides: Partial<Round> = {}): Round {
  const mode = overrides.mode ?? "normal";
  return {
    loop: "P",
    scope: "wave-1",
    roundIndex: 2,
    mode,
    cap: 5,
    streakBefore: 0,
    frozenDenominator: 3,
    verifiers: mode === "max" ? MAX_VERIFIERS : [V],
    rows: [
      { id: "R1", verdict: "pass", kept: false, verifier: V },
      { id: "R2", verdict: "match", kept: false, verifier: V },
      { id: "R3", verdict: "intended-improvement", kept: false, verifier: V }
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
      round({ rows: [KEPT, { id: "R2", verdict: "pass", kept: false, verifier: V }, { id: "R3", verdict: "pass", kept: false, verifier: V }] })
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
    const dirty = { rows: [KEPT], frozenDenominator: 1 };
    const exhausted = evaluateRound(round({ mode: "max", cap: 8, roundIndex: 8, ...dirty }));

    expect(exhausted.unreachable).toBe(true);
    expect(exhausted.verdict).toBe("fail-cap");
    expect(exhausted.capRemaining).toBe(0);

    const roomy = evaluateRound(round({ mode: "max", cap: 12, roundIndex: 8, ...dirty }));
    expect(roomy.unreachable).toBe(false);
    expect(roomy.verdict).toBe("fail-residual");
  });

  it("AC-4 subtracts the clean rounds already counted from the streak the remaining rounds must still supply", () => {
    // "@req FR-NODE-144 AC-4"
    // The etc profile requires three consecutive clean rounds. A clean round 6 of cap 8 leaves a
    // streak of 1, so rounds 7 and 8 can still supply the two it needs: not unreachable.
    const etc = { mode: "max" as const, profile: "etc-local-llm" as const, cap: 8, roundIndex: 6, frozenDenominator: 3 };
    const counted = evaluateRound(round(etc));
    expect(counted).toMatchObject({ verdict: "fail-residual", streak: 1, capRemaining: 2, unreachable: false });

    // A clean first round of cap 3 (etc --mini, or --loops 3) likewise stays open.
    const mini = evaluateRound(round({ ...etc, mode: "normal", cap: 3, roundIndex: 1 }));
    expect(mini).toMatchObject({ verdict: "fail-residual", streak: 1, capRemaining: 2, unreachable: false });

    // The same round 6 with no clean round counted (a fix was applied) still needs three: unreachable.
    const uncounted = evaluateRound(round({ ...etc, fixAppliedThisRound: true }));
    expect(uncounted).toMatchObject({ verdict: "fail-cap", streak: 0, capRemaining: 2, unreachable: true });

    // A clean round that leaves one short with no round left is still unreachable.
    const last = evaluateRound(round({ ...etc, roundIndex: 8, streakBefore: 1 }));
    expect(last).toMatchObject({ verdict: "fail-cap", streak: 2, capRemaining: 0, unreachable: true });
  });

  it("AC-5 can return different verdicts for two calls differing only in mode", () => {
    // Literally identical but for mode: one verifier is the normal count and too few for --max.
    const value = round({ mode: "normal" });
    expect(evaluateRound(value).verdict).toBe("pass");
    expect(evaluateRound({ ...value, mode: "max" }).verdict).toBe("invalid");

    // The same clean round under --max, reviewed by its two verifiers, needs a second consecutive
    // clean round.
    const max = evaluateRound(round({ mode: "max" }));
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

  it("blocks a pass on an unapproved-damage row and on a kept row", () => {
    const damaged = evaluateRound(
      round({ rows: [{ id: "R1", verdict: "unapproved-damage", kept: false, verifier: V }], frozenDenominator: 1 })
    );
    expect(damaged.violations).toContain("unapproved-damage");
    expect(damaged.verdict).not.toBe("pass");

    expect(evaluateRound(round({ rows: [KEPT], frozenDenominator: 1 })).verdict).toBe("fail-residual");

    // A dropped finding blocks neither gate, so --max differs from normal only by its verifier count
    // and its streak.
    expect(evaluateRound(round({ rows: [DROPPED], frozenDenominator: 1 })).verdict).toBe("pass");
    expect(evaluateRound(round({ mode: "max", streakBefore: 1, rows: [DROPPED], frozenDenominator: 1 })).verdict).toBe("pass");
    expect(evaluateRound(round({ mode: "max", streakBefore: 1, rows: [KEPT], frozenDenominator: 1 })).verdict).toBe(
      "fail-residual"
    );
  });

  it("returns fail-cap once the cap is consumed without a pass", () => {
    const outcome = evaluateRound(
      round({ roundIndex: 5, cap: 5, rows: [KEPT], frozenDenominator: 1 })
    );

    expect(outcome.verdict).toBe("fail-cap");
    expect(outcome.violations).toContain("cap-exhausted");
    expect(outcome.capRemaining).toBe(0);
  });
});
