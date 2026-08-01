// @req FR-NODE-144 — `evaluateRound` as a pure predicate over one round.
//
// The verification engine's mechanical arithmetic — caps, streaks, unreachable-PASS and the
// invalid-round rule — exists today only as skill prose applied by an agent. Nothing here reads a
// file, a clock or a process: every fact the verdict rests on arrives on the `Round` argument.
import {
  REQUIRED_CLEAN_STREAK,
  type LoopMode,
  type ReasonClass,
  type RoundVerdict,
  type ViolationCode
} from "./journal-schema.js";

export type RowSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface RoundRow {
  id: string;
  verdict: string;
  severity: RowSeverity;
}

export interface Round {
  loop: "D" | "W" | "H" | "L" | "P" | "F";
  scope: string;
  /** 1-based. */
  roundIndex: number;
  /**
   * Supplied by the caller and never inferred: the recorded round object carries neither mode nor
   * variant, and a `cap` of 8 is ambiguous between `--max` and an explicit `--loops 8`.
   */
  mode: LoopMode;
  cap: number;
  streakBefore: number;
  /** Externally fixed at round entry; the verifier never computes it. */
  frozenDenominator: number;
  rows: RoundRow[];
  fixAppliedThisRound: boolean;
  regression: { failingTests: string[]; baselineFailingTests: string[] | null; exitCode: number };
  residual: Array<{ id: string; reasonClass: ReasonClass | string }>;
}

export interface RoundOutcome {
  verdict: RoundVerdict;
  violations: ViolationCode[];
  /** The consecutive clean-round streak *after* this round. An unclean round resets it to zero. */
  streak: number;
  capRemaining: number;
  /** True when the rounds left under the cap cannot build the mode's required streak. */
  unreachable: boolean;
}

/**
 * The row verdicts that leave a row closed. Everything else is an open finding at the row's severity.
 * Declared as a module constant so a test imports it rather than re-deriving the vocabulary:
 * `pass` is the gate vocabulary, `match` is axis A's, `intended-improvement` is the preservation
 * layer's (`waves-event.md` §2.3).
 */
export const CLEAN_ROW_VERDICTS = ["pass", "match", "intended-improvement"] as const;

function isOpen(row: RoundRow): boolean {
  return !(CLEAN_ROW_VERDICTS as readonly string[]).includes(row.verdict);
}

function isSubset(subject: string[], of: string[]): boolean {
  const superset = new Set(of);
  return subject.every((item) => superset.has(item));
}

export function evaluateRound(round: Round): RoundOutcome {
  const violations: ViolationCode[] = [];
  const capRemaining = Math.max(0, round.cap - round.roundIndex);
  const requiredStreak = REQUIRED_CLEAN_STREAK[round.mode];

  // The denominator mismatch is checked first and short-circuits: the round is void for both
  // verifiers, so nothing measured inside it is worth reporting. It consumes the cap and resets the
  // streak, which is different from failing the round.
  if (round.rows.length !== round.frozenDenominator) {
    violations.push("denominator-mismatch");
    return {
      verdict: "invalid",
      violations,
      streak: 0,
      capRemaining,
      unreachable: capRemaining < requiredStreak
    };
  }

  const open = round.rows.filter(isOpen);
  if (round.rows.some((row) => row.verdict === "unapproved-damage")) violations.push("unapproved-damage");

  const { failingTests, baselineFailingTests, exitCode } = round.regression;
  if (baselineFailingTests === null) {
    if (exitCode !== 0) violations.push("no-baseline-nonzero-exit");
  } else if (!isSubset(failingTests, baselineFailingTests)) {
    violations.push("new-regression");
  }

  // A round that applied a fix cannot be the passing round: it would stamp PASS on a state neither
  // verifier has read.
  if (round.fixAppliedThisRound) violations.push("fix-in-clean-round");

  const blockingSeverities: RowSeverity[] = round.mode === "max" ? ["CRITICAL", "HIGH", "MEDIUM"] : ["CRITICAL", "HIGH"];
  const gateMet = violations.length === 0 && !open.some((row) => blockingSeverities.includes(row.severity));
  const streak = gateMet ? round.streakBefore + 1 : 0;

  if (streak >= requiredStreak) {
    return {
      verdict: round.residual.length > 0 ? "pass-with-residual" : "pass",
      violations,
      streak,
      capRemaining,
      unreachable: false
    };
  }

  // PASS is arithmetically impossible when fewer rounds remain than the streak the mode requires, so
  // the loop stops here rather than recommending a round that cannot close it.
  const unreachable = capRemaining < requiredStreak;
  if (unreachable || round.roundIndex >= round.cap) {
    violations.push("cap-exhausted");
    return { verdict: "fail-cap", violations, streak, capRemaining, unreachable };
  }

  return { verdict: "fail-residual", violations, streak, capRemaining, unreachable: false };
}
