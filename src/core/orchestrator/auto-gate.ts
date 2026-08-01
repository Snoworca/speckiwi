// @req FR-NODE-124, FR-NODE-122 — the `--auto` gate kernel and the gate-id vocabulary it closes over.
//
// 05 §12 states the contract in force, as amended by `08` §2: a gate offering a recommended option
// adopts it immediately with no committee; otherwise a committee of 3 — 5 under `--max` — decides by
// simple majority; if no majority exists the gate escalates to critical and halts for the user; and
// gates in `critical_gates[]` halt regardless of `--auto`.

/**
 * Every gate id a phase-1 refusal can emit at exit 2, in §13's own four groups.
 *
 * @req FR-NODE-122 — 05 §13's 39 orchestrator-owned phase-1 rows, the four `business-decision`
 * routing gates, and the three groups §13 requires the phase-1 skill to declare alongside them: the
 * ids inherited verbatim from `kiwi-wave-master`, the two never auto-granted by `--auto` alone, and
 * the three adopted as-is from `auto-option.md:254-274`.
 *
 * §13's 20 phase-2 rows are **not** members: an undeclared gate falls to `business-decision`, which a
 * committee auto-approves at confidence at or above 0.7, so declaring a gate whose machinery does not
 * exist is worse than omitting it. The parity assertion runs the other way — what a variant declares
 * must be **in** this union — so an id the skill is required to declare and this union omits fails
 * the harness on correct text.
 *
 * Deliberately **not** registered in `journal-schema.ts`'s closed-enum list: that list is asserted
 * set-equal to `waves-event.md`'s field tables, and the v1.4.0 table carries no `gate` field.
 */
export const GATE_IDS = [
  // — Orchestrator-owned, §13's rows marked phase 1 —
  "run-root-preflight-mismatch",
  "invalid-run-scope-option",
  "orchestrator-run-lock-held",
  "route-probe-unreadable",
  "route-escalation-after-landed-state",
  "route-deescalation-refused",
  "partition-review-unrecorded",
  "serial-unit-failed",
  "resume-card-missing-or-invalid",
  "ledger-reconciliation-divergent",
  "run-invariant-drift",
  "interrupted-external-action",
  "integration-branch-unavailable",
  "design-intake-insufficient",
  "unmarked-normative-prose",
  "design-not-frozen",
  "wave-design-insufficient",
  "convergence-without-recipe",
  "unallocated-req-id",
  "requirement-not-ready",
  "schedule-cycle",
  "tdd-pair-split",
  "unknown-write-set-refused",
  "files-not-grounded",
  "non-code-write-set-refused",
  "lane-plan-drift",
  "handoff-not-english",
  "handoff-unresolvable-reference",
  "handoff-untested-ac-over-cap",
  "handoff-verify-failed",
  "stage-coupling-unresolved",
  "dispatch-base-dirty",
  "lane-design-refuted",
  "post-merge-index-drift",
  "plan-coverage-unclosed",
  "cross-lane-duplication-unresolved",
  "verification-oscillation",
  "wave-issues-open",
  "design-contradiction-at-wave-boundary",

  // — `business-decision` routing gates: severities are declared, `critical_gates[]` membership is
  //   deliberately withheld because `route-proposal` fires on every run and promoting it would stall
  //   every unattended run at its first decision (§13, `09` §8.1) —
  "route-proposal",
  "route-step-requires-mode-switch",
  "tdd-route-unattended",
  "route-downgrade-available",

  // — Inherited verbatim from `kiwi-wave-master` (§13) —
  "unsafe-option-refused",
  "wt-delegation-refused",
  "decomposition-input-missing",
  "wave-decomposition-coverage-gap",
  "out-of-scope-user-consent",
  "wave-append-cap-exhausted",
  "wave-verify-residual-critical",
  "wave-verify-fail-residual",
  "wave-verify-cross-wave-fix-required",
  "final-verify-residual-critical",
  "child-pipeline-needs-user-or-failed",
  "child-srs-needs-user-or-failed",
  "invalid-loop-option",

  // — Never auto-granted by `--auto` alone; each needs its own explicit pass-through option (§13) —
  "integration-test-user-consent",
  "cost-warning-large-task",

  // — Adopted as-is from `auto-option.md:254-274` (§13) —
  "external-module-impact",
  "mcp-cli-both-unavailable",
  "self-recursive-spawn",

  // — Emitted by a phase-1 kernel but absent from §13's table (@req FR-NODE-166) —
  //
  //   Both reach exit 2 from a live CLI path — `handoff-pin-untrusted` from `pinning.ts` at
  //   `orchestrate freeze <target>`, `lane-plan-incomplete` from `lane-plan.ts` at
  //   `orchestrate schedule plan` — and both were outside this union until `refuse()` stopped
  //   accepting a bare string. They stay out of every variant's `critical_gates[]`, which leaves
  //   their `--auto` classification at `business-decision` exactly as it already was: that
  //   classification is keyed on the skill tables, not on this union, so admission here changes no
  //   `--auto` behaviour. Declaring them is a separate decision, and taking it means adding a §13
  //   row across three variants plus the `.agents` mirror.
  "handoff-pin-untrusted",
  "lane-plan-incomplete"
] as const;

export type GateId = (typeof GATE_IDS)[number];

/**
 * The closed action vocabulary.
 *
 * `add-two-and-revote` is a member because a reversal of `08` §2 would return it; no phase-1 branch
 * produces it, which is the mechanical form of "no tie rung ships".
 */
export const AUTO_GATE_ACTIONS = ["adopt-recommended", "adopt-default-if-auto", "adopt-majority", "escalate-critical", "add-two-and-revote"] as const;

export type AutoGateAction = (typeof AUTO_GATE_ACTIONS)[number];

/** `auto-option.md:157`'s `merge_method.rule` vocabulary, restated in full (05 §12 edit 12.5). */
export const AUTO_GATE_RULES = ["recommended-fastpath", "default-if-auto", "majority", "escalated"] as const;

export type AutoGateRule = (typeof AUTO_GATE_RULES)[number];

/**
 * `decideAutoGate`'s sole argument — exactly seven fields, so a fixture is constructible from the
 * declaration without reading the implementation.
 *
 * @req FR-NODE-124 AC-8 — there is deliberately **no** field describing *why* an option carries its
 * recommendation. 05 §12 puts that judgment out of scope on the ground that an architecture which
 * cannot express the excluded feature cannot leak it back in, and a schema field for it is exactly
 * the mechanism by which it would.
 */
export interface AutoGateInput {
  gateId: string;
  critical: boolean;
  options: Array<{ id: string; recommended: boolean; defaultIfAuto: boolean }>;
  mode: "auto" | "auto-max";
  votes: Array<{ member: string; optionId: string; confidence: number }> | null;
  quorum: { expected: number; present: number };
  /**
   * 05 §12: constructed `false` at every call site. It is retained so that a reversal of `08` §2 is
   * additive rather than structural — no rung is implemented behind it.
   */
  tieRung: boolean;
}

export interface AutoGateDecision {
  action: AutoGateAction;
  /** Zero on both bypasses, because neither forms a committee. */
  memberCount: number;
  rule: AutoGateRule;
  reason: string;
}

/** 3 under `--auto`, 5 under `--auto --max` (`auto-option.md:32` seeds `--max` with 5 directly). */
function committeeSize(mode: AutoGateInput["mode"]): number {
  return mode === "auto-max" ? 5 : 3;
}

/**
 * @req FR-NODE-124 — pure, total, and with the precedence `recommended` > `default_if_auto` >
 * committee. `critical` is checked before both bypasses: a gate in `critical_gates[]` halts for the
 * user regardless of `--auto`, and a recommendation cannot buy past it.
 */
export function decideAutoGate(input: AutoGateInput): AutoGateDecision {
  if (input.critical) {
    return { action: "escalate-critical", memberCount: 0, rule: "escalated", reason: `gate ${input.gateId} is critical and halts regardless of --auto` };
  }

  if (input.options.some((option) => option.recommended)) {
    return { action: "adopt-recommended", memberCount: 0, rule: "recommended-fastpath", reason: "a recommended option adopts immediately, with no committee" };
  }

  if (input.options.some((option) => option.defaultIfAuto)) {
    return { action: "adopt-default-if-auto", memberCount: 0, rule: "default-if-auto", reason: "no recommended option; the default-if-auto option adopts with no committee" };
  }

  const memberCount = committeeSize(input.mode);

  // A committee that produces no majority *including through member failure* escalates: closing only
  // the quorum row would leave the lead-member tie-break live one row below it (05 §12 edit 12.6).
  if (input.quorum.present < input.quorum.expected) {
    return { action: "escalate-critical", memberCount, rule: "escalated", reason: `degraded quorum: ${input.quorum.present} of ${input.quorum.expected} members present` };
  }

  const votes = input.votes ?? [];
  const tally = new Map<string, number>();
  for (const vote of votes) tally.set(vote.optionId, (tally.get(vote.optionId) ?? 0) + 1);

  const leader = [...tally.entries()].reduce<{ optionId: string; count: number }>((best, [optionId, count]) => (count > best.count ? { optionId, count } : best), { optionId: "", count: 0 });

  if (votes.length > 0 && leader.count * 2 > votes.length) {
    return { action: "adopt-majority", memberCount, rule: "majority", reason: `simple majority for ${leader.optionId}: ${leader.count} of ${votes.length}` };
  }

  return { action: "escalate-critical", memberCount, rule: "escalated", reason: `no majority among ${votes.length} votes; the gate halts for the user` };
}
