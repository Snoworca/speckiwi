// @req FR-NODE-140, FR-NODE-141, FR-NODE-142, FR-NODE-143, FR-NODE-144, FR-NODE-150, FR-NODE-151,
// @req FR-NODE-152 — the `waves.jsonl` v1.4.0 schema as data, and every closed enum the orchestrator
// journal, the resume card and the verification gate draw on.
//
// The vocabularies live here once rather than beside each consumer, because the contract-parity test
// class asserts them set-equal to the field tables and bullet invariants in the four shipped copies of
// `skills/**/\_shared/kiwi/waves-event.md`. A second declaration would let one copy drift silently,
// which is the drift class the parity test exists to catch.

// ---------------------------------------------------------------------------------------------
// Journal identity
// ---------------------------------------------------------------------------------------------

/** The closed set of schema versions the reader accepts (waves-event.md v1.0.0 through v1.4.0). */
export const WAVES_SCHEMA_VERSIONS = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"] as const;
export type WavesSchemaVersion = (typeof WAVES_SCHEMA_VERSIONS)[number];

/** The producing skill. @req FR-NODE-140 — a line with no `engine` field is `kiwi-wave-master`. */
export const ENGINES = ["kiwi-wave-master", "kiwi-orchestrator"] as const;
export type Engine = (typeof ENGINES)[number];
export const DEFAULT_ENGINE: Engine = "kiwi-wave-master";

/** waves-event.md §2.1 `status`. */
export const EVENT_STATUSES = ["pending", "in_progress", "complete", "failed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** `status` is the only positive completion signal (waves-event.md §2.3 last bullet). */
export const COMPLETION_STATUS: EventStatus = "complete";

/** waves-event.md §2.2 `phase`, plus the eight members v1.4.0 adds (05 §4.2). */
export const WAVE_PHASES = [
  "pipeline",
  "srs-authoring",
  "wave-verify",
  "final-verify",
  "intake",
  "design",
  "wave-design",
  "schedule",
  "handoff",
  "lane",
  "integrate",
  "stage-close"
] as const;
export type WavePhase = (typeof WAVE_PHASES)[number];

/** 05 §4.3's write-ahead / write-behind pair. */
export const EVENT_KINDS = ["intent", "result"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Verbs and recovery classes — 05 §4.4
// ---------------------------------------------------------------------------------------------

export const RECOVERY_CLASSES = ["pure-reauthor", "idempotent-by-key", "externally-visible"] as const;
export type RecoveryClass = (typeof RECOVERY_CLASSES)[number];

/**
 * The closed verb enum and each verb's recovery class. `halt` is terminal and declares none, which is
 * why the map's value type admits `null` rather than defaulting a class onto it.
 */
export const VERB_RECOVERY_CLASS = {
  "probe-isolation": "externally-visible",
  "create-integration-branch": "externally-visible",
  "commit-run-artifacts": "externally-visible",
  "intake-qna": "pure-reauthor",
  "intake-document": "pure-reauthor",
  "intake-issue": "externally-visible",
  "intake-investigate": "pure-reauthor",
  "probe-route": "idempotent-by-key",
  "freeze-route": "idempotent-by-key",
  "dispatch-route": "externally-visible",
  "escalate-route": "externally-visible",
  "downgrade-route": "externally-visible",
  "author-design": "pure-reauthor",
  "verify-design": "idempotent-by-key",
  "freeze-design": "idempotent-by-key",
  "decompose-waves": "pure-reauthor",
  "author-convergence-registry": "pure-reauthor",
  "verify-convergence-registry": "idempotent-by-key",
  "author-wave-design": "pure-reauthor",
  "verify-wave-design": "idempotent-by-key",
  "register-wave-srs": "externally-visible",
  "plan-wave": "externally-visible",
  "derive-readiness": "idempotent-by-key",
  "commit-wave-inputs": "externally-visible",
  "freeze-lane-plan": "idempotent-by-key",
  "review-partition": "pure-reauthor",
  "author-handoff": "pure-reauthor",
  "verify-handoff": "idempotent-by-key",
  "commit-dispatch-base": "externally-visible",
  "execute-unit": "externally-visible",
  "dispatch-lane": "externally-visible",
  "collect-lane": "idempotent-by-key",
  "verify-lane": "idempotent-by-key",
  "remediate-lane": "externally-visible",
  "release-lane": "externally-visible",
  "integrate-lane": "externally-visible",
  "run-serial-epilogue": "externally-visible",
  "replay-deferred-mutations": "idempotent-by-key",
  "post-merge-verify": "idempotent-by-key",
  "wave-issue-triage": "pure-reauthor",
  "resolve-wave-issues": "externally-visible",
  "amend-design": "externally-visible",
  "promote-requirements": "externally-visible",
  "final-verify": "idempotent-by-key",
  "emit-and-finish": "idempotent-by-key",
  "abort-run": "externally-visible",
  halt: null
} as const satisfies Record<string, RecoveryClass | null>;

export type VerbName = keyof typeof VERB_RECOVERY_CLASS;
export const VERBS = Object.keys(VERB_RECOVERY_CLASS) as VerbName[];

export function isVerb(value: string): value is VerbName {
  return Object.prototype.hasOwnProperty.call(VERB_RECOVERY_CLASS, value);
}

export function recoveryClassOf(verb: string): RecoveryClass | null {
  return isVerb(verb) ? VERB_RECOVERY_CLASS[verb] : null;
}

// ---------------------------------------------------------------------------------------------
// Proofs, dispositions and the rest of the closed vocabularies
// ---------------------------------------------------------------------------------------------

/** 05 §4.5, ordered by trust. */
export const PROOF_KINDS = ["git-ancestor", "git-ref", "git-trailer", "digest", "mcp-state", "fs-exists", "journal"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

/**
 * The five kinds recomputable without the journal. @req FR-NODE-152 — a verdict-bearing line needs at
 * least one of these; `fs-exists` is absent because a file's presence witnesses no verdict.
 */
export const EXTERNAL_PROOF_KINDS = ["git-ancestor", "git-ref", "git-trailer", "digest", "mcp-state"] as const;
export type ExternalProofKind = (typeof EXTERNAL_PROOF_KINDS)[number];

/** 05 §5.2. */
export const CONFLICT_REASONS = [
  "task-dependency",
  "phase-dependency",
  "write-set-overlap",
  "tdd-pair",
  "req-shared",
  "convergence-point",
  "module-barrier",
  "unknown-write-set",
  "srs-write",
  "non-code-write-set"
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/** 05 §5.2's convergence-point recipe kinds. */
export const RECIPE_KINDS = ["exclusive-lane", "orchestrator-only", "regenerate", "replay"] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];

/** waves-event.md §2.4 — the closed reason a top-level section is out of every wave's scope. */
export const EXCLUSION_CLASSES = ["already-implemented", "superseded", "external-ownership", "user-excluded", "non-normative"] as const;
export type ExclusionClass = (typeof EXCLUSION_CLASSES)[number];

/**
 * waves-event.md §2.3 — why an unresolved finding is still open at termination.
 *
 * Re-exported from `issue-ledger.ts`, which owns the vocabulary because `deferIssue` is what refuses
 * a value outside it. It was restated here and had already drifted: this copy carried six values
 * while the shipped `waves-event.md` v1.4.0 carries eight, so `oscillation` and `budget-exhausted` —
 * the two the orchestrator's own oscillation and budget stops write — were diagnosed as invalid by
 * `waves-validate`. Two spellings of one vocabulary is how that happens.
 */
export { DEFERRAL_REASON_CLASSES as REASON_CLASSES, type DeferralReasonClass as ReasonClass } from "./issue-ledger.js";

/** 05 §8 — the wave-boundary issue vocabulary, owned by the module whose predicates enforce it. */
export { ISSUE_CLASSES, type IssueClass } from "./issue-ledger.js";

/** 05 §3.4's closed seven-value lane-manifest status enum. */
export const MANIFEST_STATUSES = [
  "complete",
  "complete-unreported",
  "dead",
  "lease-breach-requested",
  "needs-user",
  "design-refuted",
  "no-response"
] as const;
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

/** 05 §4.2 — a lane leaving the run without merging. Every member is terminal. */
export const LANE_DISPOSITION_KINDS = ["demoted", "quarantined", "coupling-reset", "refuted"] as const;
export type LaneDispositionKind = (typeof LANE_DISPOSITION_KINDS)[number];

/** waves-event.md §2.3 — the verdict a `verification` object records. */
export const VERIFICATION_VERDICTS = ["in-progress", "pass", "fail-residual", "fail-cap"] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

/**
 * `evaluateRound`'s verdict vocabulary (05 §10.1). Deliberately wider than the journal's: `invalid`
 * is a round the denominator mismatch voided, which consumes the cap without failing the round, and
 * `pass-with-residual` is Normal's early exit.
 */
export const ROUND_VERDICTS = ["pass", "pass-with-residual", "fail-residual", "fail-cap", "invalid"] as const;
export type RoundVerdict = (typeof ROUND_VERDICTS)[number];

/** @req FR-NODE-144 — supplied by the caller, never inferred from the round's other fields. */
export const LOOP_MODES = ["normal", "max", "mini", "explicit"] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

/**
 * The consecutive clean rounds each mode requires, from `kiwi-wave-master §5.5.4`, which
 * `waves-event.md` names as the SSOT for the value. `mini` and `explicit` vary the cap, not the gate,
 * so they carry Normal's requirement.
 */
export const REQUIRED_CLEAN_STREAK: Record<LoopMode, number> = { normal: 1, max: 2, mini: 1, explicit: 1 };

/** 05 §4.1 property 1 — the resume card's precondition vocabulary, exactly five values. */
export const CARD_PRECONDITIONS = [
  "P-DESIGN-FROZEN",
  "P-LANE-PLAN-FROZEN",
  "P-HANDOFF-VERIFIED",
  "P-WAVE-ISSUES-CLOSED",
  "P-PRIOR-STAGES-INTEGRATED"
] as const;
export type CardPrecondition = (typeof CARD_PRECONDITIONS)[number];

/**
 * 05 §10.1 — `decideAutoGate`'s action vocabulary, registered here so the parity test covers it.
 *
 * Declared on `auto-gate.ts` and re-exported rather than restated. `GateId` is deliberately **not**
 * registered alongside it: this list is asserted set-equal to `waves-event.md`'s field tables, and
 * the v1.4.0 table carries no `gate` field.
 */
export { AUTO_GATE_ACTIONS, type AutoGateAction } from "./auto-gate.js";

/** 05 §4.6's reduction outcomes. */
export const RECONCILIATION_OUTCOMES = [
  "consistent",
  "card-stale",
  "interrupted-external-action",
  "ledger-reconciliation-divergent"
] as const;
export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

/** 05 §4.7 — a drift digest's three outcomes. */
export const DRIFT_OUTCOMES = ["match", "stale-not-wrong", "drift"] as const;
export type DriftOutcome = (typeof DRIFT_OUTCOMES)[number];

/**
 * The gates `computeResumeState` can block on. A superset lives in `auto-gate.ts`'s `GateId`; this is
 * the subset resume itself emits, declared here so `ResumeState.blocking` has a closed type without
 * this module depending on the gate census.
 */
export const RESUME_BLOCKING_GATES = [
  "run-invariant-drift",
  "lane-plan-drift",
  "interrupted-external-action",
  "ledger-reconciliation-divergent"
] as const;
export type ResumeBlockingGate = (typeof RESUME_BLOCKING_GATES)[number];

/** 05 §4.6's per-lane classification, first match wins. */
export const LANE_CLASS_NAMES = [
  "lane-possibly-live",
  "lane-quarantined",
  "not-dispatched",
  "lane-collectable",
  "lane-integrable",
  "lane-landed",
  "journal-behind-git",
  "divergent"
] as const;
export type LaneClassName = (typeof LANE_CLASS_NAMES)[number];

/** 05 §4.1 — the writer-enforced hard cap on the serialised resume card. */
export const RESUME_CARD_MAX_BYTES = 8192;

/** The version at and above which `writer` is required, and the terminality rule applies (05 §4.2). */
export const WRITER_REQUIRED_FROM: WavesSchemaVersion = "1.4.0";

// ---------------------------------------------------------------------------------------------
// The event shape
// ---------------------------------------------------------------------------------------------

export interface JournalProof {
  kind: string;
  ref?: string;
}

/**
 * One parsed `waves.jsonl` line. Every schema field is optional because the reader spans five schema
 * versions and a v1.0.0 line carries none of the v1.4.0 additions; the validator is what refuses a
 * field a rule requires.
 *
 * `journalLine` is attached by the parser rather than read from the line — it is provenance, not a
 * journal field, which is why `WAVES_EVENT_FIELDS` below does not list it.
 */
export interface WavesEvent {
  journalLine: number;
  ts?: string;
  schema_version?: string;
  run_id?: string;
  wave?: string;
  order?: number;
  target?: string;
  status?: string;
  summary?: string;
  engine?: string;
  writer?: string;
  event?: string;
  verb?: string;
  stage?: number;
  lane?: string;
  phase?: string;
  proof?: JournalProof | JournalProof[];
  verification?: Record<string, unknown>;
  design_baseline?: Record<string, unknown>;
  lane_plan?: Record<string, unknown>;
  lane_disposition?: Record<string, unknown>;
  isolation?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * The v1.4.0 field set, per event scope. The parity test asserts this set-equal to `waves-event.md`'s
 * field tables; nothing at runtime reads it, which is the point — it is the contract, as data.
 */
export const WAVES_EVENT_FIELDS = {
  required: ["ts", "schema_version", "run_id", "wave", "order", "target", "status", "summary"],
  optional: [
    "scope",
    "pipeline_run_id",
    "req_ids",
    "notes",
    "phase",
    "verification",
    "design_baseline",
    "constraints_path",
    "srs_authored",
    "diff_window",
    "pipeline_run_ids",
    "plan_run_id",
    "run_diff_window",
    "engine",
    "writer",
    "event",
    "verb",
    "inputs_digest",
    "lane",
    "stage",
    "lane_plan",
    "partition_review",
    "isolation",
    "lane_layer",
    "wave_issues",
    "convergence",
    "allocation",
    "lane_disposition",
    "decision",
    "deadline_at",
    "postmortem",
    "coverage_residual",
    "card_digest",
    "proof",
    "strict_grounding"
  ]
} as const;

// ---------------------------------------------------------------------------------------------
// The two rule tables — 05 §10.1
// ---------------------------------------------------------------------------------------------

/**
 * @req FR-NODE-141 — the eleven violation codes, in the order 05 §10.1's table states them. Nine are
 * sourced from `waves-event.md`'s round-record bullets; `fix-in-clean-round` and `cap-exhausted` come
 * from `kiwi-wave-master §5.5.4`.
 */
export const VIOLATION_CODES = [
  "unmapped-design-item",
  "constraint-violation",
  "unapproved-damage",
  "new-regression",
  "no-baseline-nonzero-exit",
  "denominator-mismatch",
  "truncated-residual",
  "complete-without-verification",
  "verification-without-status",
  "fix-in-clean-round",
  "cap-exhausted"
] as const;
export type ViolationCode = (typeof VIOLATION_CODES)[number];

export const JOURNAL_RULE_CODES = [
  "complete-without-latest-pass",
  "cross-run-complete",
  "final-verify-not-passed-complete",
  "reason-class-outside-vocabulary",
  "exclusion-class-outside-vocabulary",
  "unstamped-writer",
  "journal-version-downgrade",
  "lane-not-terminal",
  "integrated-lane-without-merge-sha",
  "journal-only-verdict"
] as const;
export type JournalRuleCode = (typeof JOURNAL_RULE_CODES)[number];

export type WavesRuleCode = ViolationCode | JournalRuleCode;

export interface WavesRule {
  code: WavesRuleCode;
  /** What the rule refuses, in one sentence. */
  rule: string;
  /** Where the rule comes from, for the citation the parity test resolves. */
  source: string;
  /**
   * Distinctive substrings of the `waves-event.md` §2.3 bullets this rule is drawn from. Absent when
   * the source is outside that bullet list. A snippet that no longer resolves is red, so the anchor
   * is maintained with the contract rather than drifting behind a line number.
   */
  sourceBullets?: readonly string[];
  /**
   * `diagnostic` rules emit their code; `by-construction` rules are enforced by the parser's run
   * filter and have no diagnostic to emit. Stating this is what stops a test asserting a code that
   * can never be produced.
   */
  enforcement: "diagnostic" | "by-construction";
  /** Which module produces the code. `round` codes need a mode or a fix flag no journal line carries. */
  producer: "journal" | "round";
}

export const VIOLATION_RULES: readonly WavesRule[] = [
  {
    code: "unmapped-design-item",
    rule: "one design_layer.unmapped entry forbids ALL_MATCH",
    source: "waves-event.md §2.3",
    sourceBullets: ["`design_layer.unmapped` 에 **1건이라도**"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "constraint-violation",
    rule: "one constraint_layer.violations entry forbids ALL_MATCH",
    source: "waves-event.md §2.3",
    sourceBullets: ["`constraint_layer.violations` 에 **1건이라도** 항목이 있으면"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "unapproved-damage",
    rule: "one preservation_layer row with verdict unapproved-damage forbids pass",
    source: "waves-event.md §2.3",
    sourceBullets: ["`preservation_layer.rows` 에 `verdict` 가 `unapproved-damage`"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "new-regression",
    rule: "failing_tests not a subset of baseline_failing_tests forbids pass",
    source: "waves-event.md §2.3",
    sourceBullets: ["`regression.failing_tests` 가 `baseline_failing_tests` 의 부분집합이 아니면"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "no-baseline-nonzero-exit",
    rule: "with no baseline captured, a pass requires exit_code 0",
    source: "waves-event.md §2.3",
    sourceBullets: ["기준선 **캡처에 실패**해"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "denominator-mismatch",
    rule: "an enumerated count differing from frozen_denominator invalidates the round",
    source: "waves-event.md §2.3",
    sourceBullets: ["열거한 **행 수**가 `frozen_denominator`"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "truncated-residual",
    rule: "residual and unmapped are complete, never truncated",
    source: "waves-event.md §2.3",
    sourceBullets: ["`residual` 은 **전량**이어야 하며", "`unmapped` 은 **전량**이어야 하며"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "complete-without-verification",
    rule: "a complete with no verification object reads as unverified, not as clean",
    source: "waves-event.md §2.3",
    sourceBullets: ["`complete` 이벤트에 `verification` 이 **부재**하면"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "verification-without-status",
    rule: "verification is evidence, not authority: a verification-bearing line needs a valid status",
    source: "waves-event.md §2.3",
    sourceBullets: ["`verification` 은 **증거일 뿐 권한이 아니다**"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "fix-in-clean-round",
    rule: "a round that applied a fix cannot be the passing round",
    source: "kiwi-wave-master §5.5.4",
    enforcement: "diagnostic",
    producer: "round"
  },
  {
    code: "cap-exhausted",
    rule: "reaching the cap is not a pass",
    source: "kiwi-wave-master §5.5.4",
    enforcement: "diagnostic",
    producer: "journal"
  }
];

export const JOURNAL_RULES: readonly WavesRule[] = [
  {
    code: "complete-without-latest-pass",
    rule: "a complete needs its own run's own wave's latest wave-verify record to have verdict pass",
    source: "waves-event.md §3",
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "cross-run-complete",
    rule: "run scoping carries no version exemption: another run's complete is never this run's",
    source: "waves-event.md §4",
    enforcement: "by-construction",
    producer: "journal"
  },
  {
    code: "final-verify-not-passed-complete",
    rule: "a final-verify that did not pass is written status=failed, never complete",
    source: "waves-event.md §3",
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "reason-class-outside-vocabulary",
    rule: "a residual reason_class outside the closed vocabulary",
    source: "waves-event.md §2.3",
    sourceBullets: ["`reason_class` ∈ `draft-stability-skip`"],
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "exclusion-class-outside-vocabulary",
    rule: "an out_of_scope exclusion_class outside the closed vocabulary",
    source: "waves-event.md §2.4",
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "unstamped-writer",
    rule: "writer is required on a 1.4.0 or higher line",
    source: "05 §4.2",
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "journal-version-downgrade",
    rule: "a lower schema_version after a 1.4.0 line in the same run",
    source: "05 §4.2",
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "lane-not-terminal",
    rule: "on a complete or final-verify line only, every lane of lane_plan has a terminal state",
    source: "05 §4.2",
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "integrated-lane-without-merge-sha",
    rule: "on a complete or final-verify line only, an integrated lane carries a merge_sha",
    source: "05 §4.2",
    enforcement: "diagnostic",
    producer: "journal"
  },
  {
    code: "journal-only-verdict",
    rule: "a verdict-bearing line carrying proofs needs one externally recomputable kind",
    source: "05 §4.5",
    enforcement: "diagnostic",
    producer: "journal"
  }
];

/**
 * The `waves-event.md` §2.3 bullets that are deliberately *not* violation sources: three state that a
 * denominator is fixed externally, one requires an empty-array artifact, one describes a cross-wave
 * carry-forward field. Declared so the parity test can assert that every measured bullet is either
 * cited by a rule or listed here — a new bullet lands in neither and fails.
 */
export const WAVES_EVENT_NON_VIOLATION_BULLETS = [
  "`design_layer.expected` 는 그 wave 의 `design_items` 길이로",
  "`constraint_layer.expected` 는 최신 `constraints_path`",
  "이벤트의 `design_layer.expected` 는 모든 wave",
  "제약이 선언되지 않은 run 도 **빈 배열**",
  "`cross_wave` 가 `true` 인 항목은"
] as const;

// ---------------------------------------------------------------------------------------------
// Small shared predicates
// ---------------------------------------------------------------------------------------------

/** Compares two dotted SemVer-ish schema versions. Returns <0, 0 or >0. */
export function compareSchemaVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** `wave-{n}` -> n. `"all"` and anything unparseable -> null, which is what excludes run-scope lines. */
export function waveNumber(wave: string | undefined): number | null {
  if (typeof wave !== "string") return null;
  const match = /^wave-(\d+)$/.exec(wave);
  if (!match) return null;
  return Number.parseInt(match[1] as string, 10);
}
