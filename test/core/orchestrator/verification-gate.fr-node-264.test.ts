import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOOP_MODES, REQUIRED_CLEAN_STREAK, requiredCleanStreak } from "../../../src/core/orchestrator/journal-schema.js";
import { evaluateRound, roundPayloadProblems, type Round } from "../../../src/core/orchestrator/verification-gate.js";

// FR-NODE-264 — the required clean streak comes from the loop mode and the run's execution profile,
// so the etc local-LLM profile's three consecutive passes are enforced by the engine itself.

const CLEAN_ROWS = [
  { id: "R1", verdict: "pass", kept: false, verifier: "verifier-1" },
  { id: "R2", verdict: "match", kept: false, verifier: "verifier-1" }
];

function round(overrides: Partial<Round> = {}): Round {
  return {
    loop: "P",
    scope: "wave-1-post",
    roundIndex: 1,
    mode: "normal",
    cap: 8,
    streakBefore: 0,
    frozenDenominator: 2,
    verifiers: ["verifier-1"],
    rows: CLEAN_ROWS,
    fixAppliedThisRound: false,
    regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 },
    residual: [],
    ...overrides
  };
}

const MAX_VERIFIERS = { verifiers: ["verifier-1", "verifier-2"], rows: [CLEAN_ROWS[0]!, { ...CLEAN_ROWS[1]!, verifier: "verifier-2" }] };

describe("FR-NODE-264 the etc local-LLM profile's streak is enforced by the engine", () => {
  it("@req FR-NODE-264 AC-1: no pass before the third consecutive clean round, and pass on it", () => {
    for (const mode of LOOP_MODES) {
      const verifiers = mode === "max" ? MAX_VERIFIERS : {};
      const first = evaluateRound(round({ mode, ...verifiers, profile: "etc-local-llm", roundIndex: 1, streakBefore: 0 }));
      const second = evaluateRound(round({ mode, ...verifiers, profile: "etc-local-llm", roundIndex: 2, streakBefore: 1 }));
      const third = evaluateRound(round({ mode, ...verifiers, profile: "etc-local-llm", roundIndex: 3, streakBefore: 2 }));
      expect([first.verdict, second.verdict, third.verdict], mode).toEqual(["fail-residual", "fail-residual", "pass"]);
      expect(third.streak, mode).toBe(3);
    }
    expect(requiredCleanStreak("max", "etc-local-llm")).toBe(3);
  });

  it("@req FR-NODE-264 AC-1: round record accepts the profile in its payload and refuses an unknown one", () => {
    const accepted = round({ profile: "etc-local-llm" }) as unknown as Record<string, unknown>;
    expect(roundPayloadProblems(accepted)).toEqual([]);
    const unknown = { ...accepted, profile: "local" };
    expect(roundPayloadProblems(unknown)).toEqual(["--payload.profile must be one of: etc-local-llm"]);
  });

  it("@req FR-NODE-264 AC-2: without a profile the streak stays normal 1, max 2, mini 1, explicit 1 and outcomes are unchanged", () => {
    expect(REQUIRED_CLEAN_STREAK).toEqual({ normal: 1, max: 2, mini: 1, explicit: 1 });
    for (const mode of LOOP_MODES) expect(requiredCleanStreak(mode), mode).toBe(REQUIRED_CLEAN_STREAK[mode]);
    expect(evaluateRound(round({ mode: "normal" }))).toEqual({ verdict: "pass", violations: [], streak: 1, capRemaining: 7, unreachable: false });
    expect(evaluateRound(round({ mode: "max", ...MAX_VERIFIERS }))).toEqual({ verdict: "fail-residual", violations: [], streak: 1, capRemaining: 7, unreachable: false });
    expect(evaluateRound(round({ mode: "max", ...MAX_VERIFIERS, roundIndex: 2, streakBefore: 1 }))).toEqual({ verdict: "pass", violations: [], streak: 2, capRemaining: 6, unreachable: false });
    expect(evaluateRound(round({ mode: "max", ...MAX_VERIFIERS, roundIndex: 7, cap: 8, fixAppliedThisRound: true }))).toEqual({
      verdict: "fail-cap",
      violations: ["fix-in-clean-round", "cap-exhausted"],
      streak: 0,
      capRemaining: 1,
      unreachable: true
    });
  });

  it("@req FR-NODE-264 AC-3: unreachable is computed from the profile's required streak", () => {
    // Two rounds left: enough for max's 2, not for the profile's 3.
    const unclean = { mode: "max" as const, ...MAX_VERIFIERS, roundIndex: 6, cap: 8, fixAppliedThisRound: true };
    expect(evaluateRound(round(unclean))).toMatchObject({ verdict: "fail-residual", capRemaining: 2, unreachable: false });
    expect(evaluateRound(round({ ...unclean, profile: "etc-local-llm" }))).toMatchObject({ verdict: "fail-cap", capRemaining: 2, unreachable: true });
    // A void round (denominator mismatch) reports unreachable from the same streak.
    const voided = { ...unclean, fixAppliedThisRound: false, frozenDenominator: 3 };
    expect(evaluateRound(round(voided))).toMatchObject({ verdict: "invalid", unreachable: false });
    expect(evaluateRound(round({ ...voided, profile: "etc-local-llm" }))).toMatchObject({ verdict: "invalid", unreachable: true });
  });

  it("@req FR-NODE-264 AC-4: the etc verify-loop passes the profile to round record and runs no extra round after pass", async () => {
    const body = await readFile(path.join(process.cwd(), "skills/etc/_shared/kiwi/verify-loop.md"), "utf8");
    const recordLine = body.split("\n").find((line) => line.includes("orchestrate_round_record")) ?? "";
    expect(recordLine).toContain('"profile": "etc-local-llm"');
    expect(body).not.toMatch(/한 라운드를 더/);
    expect(body).not.toMatch(/스트릭 2 에서 `pass`/);
  });
});
