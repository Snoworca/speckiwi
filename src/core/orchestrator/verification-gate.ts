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

// ---------------------------------------------------------------------------------------------
// The journal projection — 05 §5.1's closed `{scope}` vocabulary, and the line a round becomes.
// ---------------------------------------------------------------------------------------------

/**
 * The loop a scope belongs to, and the wave triple it reduces to.
 *
 * `waveNumber` is `/^wave-(\d+)$/`, so of the six legal scopes only `wave-{n}` parses as written:
 * `wave-1-post`, `wave-1-lane-2`, `wave-1-lane-2-handoff`, `design` and `run` all return `null`.
 * Writing a scope through as the `wave` field therefore refuses the wave's own completion — five of
 * the six forms, not one — which is why the reduction happens here rather than at the call site.
 * @req FR-NODE-169 AC-5
 */
export interface RoundScope {
  loop: Round["loop"];
  wave: string;
  order: number;
  target: string;
}

const RUN_SCOPES: Record<string, Round["loop"]> = { design: "D", run: "F" };

/** Longest form first: `wave-1-lane-2-handoff` also matches the lane pattern's prefix. */
const WAVE_SCOPES: Array<{ pattern: RegExp; loop: Round["loop"] }> = [
  { pattern: /^wave-(\d+)-lane-\d+-handoff$/, loop: "H" },
  { pattern: /^wave-(\d+)-lane-\d+$/, loop: "L" },
  { pattern: /^wave-(\d+)-post$/, loop: "P" },
  { pattern: /^wave-(\d+)$/, loop: "W" }
];

/** `null` for anything outside 05 §5.1's closed vocabulary. @req FR-NODE-169 AC-1 */
export function parseRoundScope(scope: string): RoundScope | null {
  const runLoop = RUN_SCOPES[scope];
  if (runLoop) return { loop: runLoop, wave: "all", order: 0, target: "all" };

  for (const { pattern, loop } of WAVE_SCOPES) {
    const match = pattern.exec(scope);
    if (!match) continue;
    const order = Number.parseInt(match[1] as string, 10);
    return { loop, wave: `wave-${order}`, order, target: `wave-${order}` };
  }
  return null;
}

/** What each loop calls the step it is verifying. Both vocabularies are closed. @req FR-NODE-169 */
const LOOP_JOURNAL_SHAPE: Record<Round["loop"], { phase: string; verb: string }> = {
  D: { phase: "design", verb: "verify-design" },
  W: { phase: "wave-design", verb: "verify-wave-design" },
  H: { phase: "handoff", verb: "verify-handoff" },
  L: { phase: "lane", verb: "verify-lane" },
  P: { phase: "wave-verify", verb: "post-merge-verify" },
  F: { phase: "final-verify", verb: "final-verify" }
};

/**
 * The journal verdict a round verdict becomes.
 *
 * `invalid` is two cases, not one. `evaluateRound` short-circuits the denominator mismatch *before*
 * the cap check, so an arithmetically unpassable round returns `invalid` rather than `fail-cap`;
 * mapping every `invalid` to `in-progress` would write "the loop is still running" onto a round the
 * tool's own arithmetic has declared unpassable. `fail-residual` maps to `in-progress` because the
 * kernel's `fail-residual` means "did not pass yet" while the journal's is terminal by definition.
 * @req FR-NODE-169 AC-9
 */
function journalVerdict(outcome: RoundOutcome): string {
  switch (outcome.verdict) {
    case "pass":
    case "pass-with-residual":
      return "pass";
    case "fail-cap":
      return "fail-cap";
    case "invalid":
      return outcome.unreachable ? "fail-cap" : "in-progress";
    default:
      return "in-progress";
  }
}

/** The round-shaped half of a journal line. The envelope, `ts` and `proof` are the caller's. */
export interface RoundLine {
  phase: string;
  verb: string;
  wave: string;
  order: number;
  target: string;
  status: "in_progress";
  round: number;
  summary: string;
  verification: Record<string, unknown>;
}

/**
 * Projects a round and its outcome onto the journal contract. `null` when the scope is outside the
 * closed vocabulary, or when it belongs to a loop other than the one the round declares — a line
 * carrying a phase from one loop and a wave from another describes no round that ran.
 *
 * `verification` is an explicit snake_case mapping and never the `Round` object: `Round` is
 * camelCase, the validator reads snake_case, and the same dishonest round validated with five
 * diagnostics under this projection and none under a whole-object dump. `residual` and
 * `axis_b.open` come from two different sources on purpose — the caller's carried list and this
 * round's own open rows — so `truncated-residual` stays live rather than comparing a value with
 * itself. @req FR-NODE-169 AC-8, @req FR-NODE-170 AC-5
 */
export function projectRound(round: Round, outcome: RoundOutcome): RoundLine | null {
  const scope = parseRoundScope(round.scope);
  if (!scope || scope.loop !== round.loop) return null;

  const shape = LOOP_JOURNAL_SHAPE[round.loop];
  const open = round.rows.filter(isOpen);
  const verification: Record<string, unknown> = {
    verdict: journalVerdict(outcome),
    rounds: round.roundIndex,
    cap: round.cap,
    residual: round.residual.map((item) => ({ id: item.id, reason_class: item.reasonClass })),
    axis_b: {
      open: {
        critical: open.filter((row) => row.severity === "CRITICAL").length,
        high: open.filter((row) => row.severity === "HIGH").length,
        medium: open.filter((row) => row.severity === "MEDIUM").length,
        low: open.filter((row) => row.severity === "LOW").length
      }
    },
    frozen_denominator: { round: round.roundIndex, req_ac: round.frozenDenominator },
    axis_a: { checked: round.rows.length }
  };
  // Declared, never inferred: the key says the round is void, and it is set from the kernel's own
  // verdict and from nothing else, so it cannot be used to launder a mismatch. @req FR-NODE-170
  if (outcome.verdict === "invalid") verification.invalid_round = true;

  return {
    phase: shape.phase,
    verb: shape.verb,
    wave: scope.wave,
    order: scope.order,
    target: scope.target,
    status: "in_progress",
    round: round.roundIndex,
    summary: `${round.scope} round ${round.roundIndex}: ${outcome.verdict}`,
    verification
  };
}
