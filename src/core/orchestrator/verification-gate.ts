// @req FR-NODE-144 — `evaluateRound` as a pure predicate over one round.
//
// The verification engine's mechanical arithmetic — caps, streaks, unreachable-PASS and the
// invalid-round rule — exists today only as skill prose applied by an agent. Nothing here reads a
// file, a clock or a process: every fact the verdict rests on arrives on the `Round` argument.
import {
  REQUIRED_CLEAN_STREAK,
  REQUIRED_VERIFIER_COUNT,
  type LoopMode,
  type ReasonClass,
  type RoundVerdict,
  type ViolationCode
} from "./journal-schema.js";

/**
 * One verifier's finding. `kept` holds only when `evidence` names a red test or a command output;
 * no severity is recorded, because a finding counts by what a run proved, not by a class a reader
 * assigned. @req FR-NODE-254 AC-1
 */
export interface RoundRow {
  id: string;
  verdict: string;
  kept: boolean;
  evidence?: string;
  /** One of the round's `verifiers`. */
  verifier: string;
}

export interface Round {
  /** Loop H retired in 4.0.0 with the English handoff documents (FR-NODE-169). */
  loop: "D" | "W" | "L" | "P" | "F";
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
  /** The distinct verifiers (subagent or pass names) that reviewed the round. @req FR-NODE-254 AC-1 */
  verifiers: string[];
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
 * The row verdicts that leave a row closed. Everything else is a finding, kept or dropped.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What keeps a `--payload` out of the keep/drop shape, one sentence per problem; empty when the round
 * may be evaluated. Only the verifier list and the rows are checked: the fields the keep/drop model
 * added. @req FR-NODE-254 AC-1
 */
export function roundPayloadProblems(payload: Record<string, unknown>): string[] {
  const verifiers = payload.verifiers;
  // An empty list, or a blank name, names no verifier, so it is a round without verifiers too.
  if (!Array.isArray(verifiers) || verifiers.length === 0 || !verifiers.every((name) => typeof name === "string" && name.trim() !== "")) {
    return ["--payload.verifiers must list the names of the verifiers that reviewed the round"];
  }
  if (!Array.isArray(payload.rows)) return ["--payload.rows must be an array"];

  const named = new Set<string>(verifiers);
  const problems: string[] = [];
  payload.rows.forEach((entry: unknown, index) => {
    const at = `--payload.rows[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} must be an object`);
      return;
    }
    if ("severity" in entry) problems.push(`${at} carries severity; a finding is kept by evidence, not by severity`);
    if (typeof entry.kept !== "boolean") problems.push(`${at}.kept must be a boolean`);
    if (entry.kept === true && (typeof entry.evidence !== "string" || entry.evidence.trim().length === 0)) {
      problems.push(`${at} is kept without evidence naming a red test or a command output`);
    }
    if (typeof entry.verifier !== "string") problems.push(`${at}.verifier is required`);
    else if (!named.has(entry.verifier)) problems.push(`${at}.verifier '${entry.verifier}' is not one of --payload.verifiers`);
  });
  return problems;
}

export function evaluateRound(round: Round): RoundOutcome {
  const violations: ViolationCode[] = [];
  const capRemaining = Math.max(0, round.cap - round.roundIndex);
  const requiredStreak = REQUIRED_CLEAN_STREAK[round.mode];

  // The denominator mismatch and a verifier count other than the mode's are checked first and
  // short-circuit: the round is void, so nothing measured inside it is worth reporting. A void round
  // consumes the cap and resets the streak, which is different from failing the round. The verifier
  // count is read even on a round with no row, or a one-verifier `--max` round would pass by saying
  // nothing. @req FR-NODE-254 AC-2
  const denominatorMismatch = round.rows.length !== round.frozenDenominator;
  const verifierCountMismatch = new Set(round.verifiers).size !== REQUIRED_VERIFIER_COUNT[round.mode];
  if (denominatorMismatch || verifierCountMismatch) {
    if (denominatorMismatch) violations.push("denominator-mismatch");
    return {
      verdict: "invalid",
      violations,
      streak: 0,
      capRemaining,
      unreachable: capRemaining < requiredStreak
    };
  }

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

  // One kept finding blocks the gate; a dropped one never does. @req FR-NODE-254 AC-2
  const gateMet = violations.length === 0 && !round.rows.some((row) => row.kept);
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
 * `waveNumber` is `/^wave-(\d+)$/`, so of the five legal scopes only `wave-{n}` parses as written:
 * `wave-1-post`, `wave-1-lane-2`, `design` and `run` all return `null`. Writing a scope through as the
 * `wave` field therefore refuses the wave's own completion — four of the five forms, not one — which
 * is why the reduction happens here rather than at the call site.
 * @req FR-NODE-169 AC-5
 */
export interface RoundScope {
  loop: Round["loop"];
  wave: string;
  order: number;
  target: string;
}

const RUN_SCOPES: Record<string, Round["loop"]> = { design: "D", run: "F" };

/** The loop-H form `wave-{n}-lane-{k}-handoff` retired in 4.0.0 and matches none of these. @req FR-NODE-169 AC-1 */
const WAVE_SCOPES: Array<{ pattern: RegExp; loop: Round["loop"] }> = [
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

/**
 * What keeps a round that ends at the cap from recording its residual in full; empty otherwise.
 *
 * The severity line's `truncated-residual` compared the residual with `axis_b.open`. With `axis_b`
 * gone, the open findings of a round that ran out of cap are its kept rows, so its residual must name
 * every kept row and nothing more. Only the journal's `fail-cap` is terminal here: a `pass` holds no
 * kept row and carries its residual as given. @req FR-NODE-254 AC-3
 */
export function terminalResidualProblems(round: Round, outcome: RoundOutcome): string[] {
  if (journalVerdict(outcome) !== "fail-cap") return [];
  const kept = round.rows.filter((row) => row.kept).map((row) => row.id);
  const carried = new Set(round.residual.map((item) => item.id));
  const missing = kept.filter((id) => !carried.has(id));
  if (missing.length === 0 && round.residual.length === kept.length) return [];
  return [
    `a fail-cap round's --payload.residual must list exactly its kept findings: ${round.residual.length} listed for ${kept.length} kept` +
      (missing.length > 0 ? `, missing ${missing.join(", ")}` : "")
  ];
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
 * diagnostics under this projection and none under a whole-object dump. `findings` counts this
 * round's own rows, kept and dropped (a finding not kept; a clean row is no finding), and `red_tests`
 * lists the kept rows' evidence, in place of the severity-bucketed `axis_b` and the `axis_a` row
 * count. @req FR-NODE-169 AC-8, @req FR-NODE-170 AC-5, @req FR-NODE-254 AC-3
 */
export function projectRound(round: Round, outcome: RoundOutcome): RoundLine | null {
  const scope = parseRoundScope(round.scope);
  if (!scope || scope.loop !== round.loop) return null;

  const shape = LOOP_JOURNAL_SHAPE[round.loop];
  const kept = round.rows.filter((row) => row.kept);
  const verification: Record<string, unknown> = {
    verdict: journalVerdict(outcome),
    rounds: round.roundIndex,
    cap: round.cap,
    residual: round.residual.map((item) => ({ id: item.id, reason_class: item.reasonClass })),
    findings: { kept: kept.length, dropped: round.rows.filter((row) => !row.kept && isOpen(row)).length },
    red_tests: kept.map((row) => row.evidence),
    frozen_denominator: { round: round.roundIndex, req_ac: round.frozenDenominator }
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
