import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { toolSchemas } from "../../src/mcp/server.js";
import { renderToolDescriptions } from "../../src/mcp/schemas.js";
import { renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";
import { REQUIREMENT_STATUSES, STABILITY_LEVELS } from "../../src/core/types.js";
import { buildCommand } from "../../src/cli/command.js";
import { registerReadCommands } from "../../src/cli/commands/read.js";
import { registerMutationCommands } from "../../src/cli/commands/mutations.js";
import { registerSkillCommands } from "../../src/cli/commands/skills.js";
import { registerDoctorCommand } from "../../src/cli/commands/doctor.js";
import { registerRepairCommands } from "../../src/cli/commands/repair.js";
import { registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";
import { REPO_ROOT, readVariant, stripFrontmatter } from "./kiwi-orchestrator-variants.js";
import { GOLDEN, unpairedSites } from "../../scripts/value-site-diff.mjs";

// @req FR-FLOW-154 — the skill text and the code constants are two copies of one contract. This
// file makes the code copy authoritative and the text copy checked.
//
// The scan is slot-driven, not token-driven. The same words appear in identifier fragments
// (`proposed_rung`), output paths (`outputs/proposed-plan/`) and ordinary prose (`per-REQ proposed
// change 표`), and skills run several state machines whose vocabularies are legitimately their own —
// a lane manifest carries `status: design-refuted`, a journal result line carries `status:
// "complete"`, a report channel carries `status: sent`, a plan Task carries `status = "skipped"`.
// None of those are requirement statuses. So a slot counts only when the surrounding expression
// binds it to a requirement: a speckiwi mutation that takes a requirement status, a `REQ.status`
// predicate, a requirement-id-keyed snapshot, or the requirement's own `Status` metadata row.
//
// A slot scan reads VALUES. It cannot read a rule stated in prose, because a rule and its negation
// carry the same words — the branch that says `update_status` refuses `draft` with `USAGE` and the
// branch that says `update_status` accepts it both contain `update_status`, `draft` and `USAGE`.
// The conflict branch is therefore held by a golden text (see AC-3 below) rather than by presence
// checks, which is the same lesson FR-FLOW-152/153 recorded: a vocabulary check does not catch an
// inversion.

/**
 * The shipped renderings plus the mirror, READ FROM DISK rather than listed.
 *
 * A literal here is an inclusion test one level above the corpus boundary: a fourth rendering added
 * under `skills/` would simply not be swept, and nothing would say so — the same silence the file
 * KIND list was inverted to remove, one level further out. Every directory under `skills/` is a
 * rendering by construction, and `.agents/skills` is the mirror the requirement names beside them.
 * What the walk yields is asserted below, so a new rendering has to be read in the diff and given
 * its floors rather than joining the sweep unmeasured.
 */
const RENDERINGS: readonly string[] = [
  ...readdirSync(path.join(REPO_ROOT, "skills"))
    .filter((entry) => statSync(path.join(REPO_ROOT, "skills", entry)).isDirectory())
    .sort()
    .map((entry) => `skills/${entry}`),
  ".agents/skills"
];

/**
 * The skill directories every shipped rendering carries. Frozen here because `markdownFiles()`
 * enumerates what exists: a file that vanished is not in the list, so it is never checked, and a
 * scan over the survivors passes for the same reason a clean sweep does.
 */
const SKILL_DIRECTORIES = [
  "_shared",
  "kiwi-coder",
  "kiwi-commit-auto-pr",
  "kiwi-commit-auto-push",
  "kiwi-hot-fix",
  "kiwi-orchestrator",
  "kiwi-pipeline",
  "kiwi-planner",
  "kiwi-pm",
  "kiwi-review-fix-loop",
  "kiwi-srs",
  "kiwi-srs-feasibility",
  "kiwi-srs-from-code",
  "kiwi-srs-research",
  "kiwi-srs-sync",
  "kiwi-step",
  "kiwi-tdd",
  "kiwi-wave-master"
] as const;

/** The skills `package-doctor` leaves out of the mirror, so the mirror's set is derived, not restated. */
const MIRROR_EXCLUDED = ["kiwi-step", "kiwi-wave-master"] as const;

/** Markdown file counts measured on the shipped tree. A rendering may grow; losing a file is a defect. */
const FILE_FLOOR: Record<string, number> = {
  "skills/claude": 29,
  "skills/codex": 42,
  "skills/etc": 43,
  ".agents/skills": 39
};

/**
 * A value token, and an optional quote/backtick/markdown emphasis around it.
 *
 * The class admits uppercase, digits and the hyphen so that a MISSPELLED value is still read as a
 * value. Under a lowercase-only class `update_status(in-progress)` does not fail as a wrong value —
 * the slot stops matching and the call disappears from the scan, leaving only the per-slot floor,
 * which absorbs the loss wherever a rendering has one firing to spare. `in_progress` written
 * `in-progress` is the likeliest typo in this enum, and the runtime rejects it with `USAGE`.
 */
const TOKEN = "[A-Za-z][A-Za-z0-9_-]*";
/**
 * The same class with a leading hyphen admitted, used wherever a pattern captures the VALUE a call
 * is sent. `status: "--draft"` is a flag name written into an argument literal, and the homonym
 * rule that speaks for real flags used to fall over it while `TOKEN` could not read it at all —
 * the two layers were blind in exactly the same place. Read as a value it is one token outside the
 * enum, which is what it is.
 */
const VALUE = "-{0,2}[A-Za-z][A-Za-z0-9_-]*";
// `**\`planned\`**` is one of the shapes the shipped prose writes a value in, and it is the shape
// that dictates what `add_requirement` receives. A quote class that stops at the backtick walks
// past the whole slot.
const QUOTE = "(?:\\*{1,2})?[\"'`]?(?:\\*{1,2})?";

/**
 * Requirement-status slots. Each entry is [name, pattern]; every lowercase token captured by a
 * pattern must be a member of `REQUIREMENT_STATUSES`.
 */
const STATUS_SLOTS: Array<[string, RegExp]> = [
  // `update_status { id: "REQ-X", status: "discarded" }` and its inline prose variants.
  ["update_status-argument", new RegExp(`update_status[^\\n]{0,80}?\\bstatus\\s*[:=]\\s*${QUOTE}(${VALUE})`, "g")],
  // `update_status("implemented")` / `update_status(id, "implemented")` / `update_status(in_progress)`.
  ["update_status-positional", new RegExp(`update_status\\s*\\(\\s*(?:id\\s*,\\s*)?${QUOTE}(${VALUE})${QUOTE}\\s*\\)`, "g")],
  // `add_requirement — … / status=planned / …`, the creation site FR-NODE-198 now guards.
  ["add_requirement-argument", new RegExp(`add_requirement[^\\n]{0,200}?\\bstatus\\s*[:=]\\s*${QUOTE}(${VALUE})`, "g")],
  // `list_requirements({status:"in_progress"})`.
  ["list_requirements-argument", new RegExp(`list_requirements[^\\n]{0,80}?\\bstatus\\s*[:=]\\s*${QUOTE}(${VALUE})`, "g")],
  // `REQ.status ∈ {planned, blocked}` — a predicate over a requirement's status.
  ["req-status-set", new RegExp(`REQ[^\\n]{0,12}?\\bstatus\\s*∈\\s*\\{([^}]*)\\}`, "g")],
  // `REQ status = \`planned\``, `REQ-X", status: "discarded"` and `REQ {X} 의 status ≠ \`verified\``.
  ["req-status-value", new RegExp(`REQ[^\\n]{0,12}?\\bstatus\\s*[:=≠]\\s*${QUOTE}(${VALUE})`, "g")],
  // `REQ 의 status 는 \`planned\` 상한`, `REQ status 가 \`implemented\` 로 승급` — the value bound by a
  // Korean particle rather than by a colon, which is how the prose names a requirement's status
  // outside a call signature. No `[:=≠]` slot sees this shape. The object particle 을/를 needs the
  // trailing 로/으로 before it counts: `REQ status 를 backward … 전이` binds an adverb, not a value,
  // and reading it as one reports `backward` as a violation in all four renderings, while
  // `REQ 의 Status 를 \`deferred\` 로 둔다` names a value and has to be read.
  [
    "req-status-particle-value",
    new RegExp(
      `REQ[^\\n]{0,12}?\\b[Ss]tatus\\b\\s*(?:(?:은|는|이|가)\\s*${QUOTE}(${VALUE})|(?:을|를)\\s*${QUOTE}(${VALUE})${QUOTE}\\s*(?:로|으로))`,
      "g"
    )
  ],
  // `REQ status 를 backward (verified → implemented 등)` — a transition written with a particle
  // between the axis and the values, which is how this skill set most often writes one. `에서`
  // joins the two arrows because `verified 에서 implemented 로` is the same transition spelled in
  // Korean: without the alternation, rewriting an arrow that way takes both values out of the scan
  // rather than reporting whichever one is wrong.
  ["req-status-arrow", new RegExp(`REQ[^\\n]{0,12}?\\bstatus\\b[^\\n]{0,24}?${QUOTE}(${VALUE})${QUOTE}\\s*(?:→|->|에서)\\s*${QUOTE}(${VALUE})`, "g")],
  // A bullet whose whole content is the status field of a call being specified above it.
  ["status-literal-bullet", new RegExp(`^\\s*[-*]\\s*\`status:\\s*"(${VALUE})"\`\\s*$`, "gm")],
  // `status: planned → in_progress` — a transition written on the status axis.
  ["status-transition", new RegExp(`\\bstatus\\s*[:=]\\s*${QUOTE}(${VALUE})${QUOTE}\\s*(?:→|->)\\s*${QUOTE}(${VALUE})`, "g")],
  // `STATUS_ORDER = ["planned", "in_progress", …]` — the forward-only ladder kiwi-pm walks.
  ["status-order-ladder", new RegExp(`STATUS_ORDER\\s*=\\s*\\[([^\\]]*)\\]`, "g")],
  // `"status_snapshot": { "REQ-CORE-001": "planned", … }` — the enclosing key names the axis, so
  // the sibling `stability_snapshot` with the same entry shape is read on the other axis instead.
  ["status-snapshot-map", new RegExp(`\\bstatus_snapshot"?\\s*:\\s*\\{((?:\\s*"[A-Z][A-Z0-9_-]*"\\s*:\\s*"${TOKEN}"\\s*,?)+)\\s*\\}`, "g")],
  // `Status=discarded` — the requirement's metadata row, named by its capitalised field name.
  ["metadata-status-row", new RegExp(`\\bStatus\\s*=\\s*${QUOTE}(${VALUE})`, "g")],
  // `status 상한 = \`planned\`` — a ceiling on what a call may set, written with a Korean noun
  // standing between the axis and the `=`. It dictates the value `add_requirement` receives as
  // directly as a call signature does, and no `status\s*[:=]` slot reaches across the noun.
  ["status-bound-value", new RegExp(`\\bstatus\\s*(?:상한|하한|기본값|기본|default)\\s*[:=]\\s*${QUOTE}(${VALUE})`, "g")],
  // `5. update_status — implemented / verified 전이` — the numbered mutation list `kiwi-srs-sync`
  // walks. The character class stops at the first Korean syllable, because `verified 전이` read as
  // one token fails the token test and takes the second value out of the scan rather than checking
  // it.
  ["update_status-list-line", new RegExp(`^\\s*\\d+\\.\\s*update_status\\s*—\\s*([A-Za-z0-9_ /,→>-]*)`, "gm")],
  // `{ "req_id": "FR-TODO-001", … "status": "planned" }` — a JSON example of a requirement record.
  // The axis word is a quoted KEY here, so no `\bstatus\s*[:=]` slot reaches it, and a bare quoted
  // `"status"` cannot be read on this axis: the same key carries `TASK_DONE`, `complete`, `pending`
  // and `sent` for four other machines in this corpus. The requirement id in the same object is
  // what separates them, which is the binding `status-snapshot-map` already uses one level up.
  // `update_status: 기존 status > 제안 status 면 backward 차단 (예: verified → implemented 금지)` —
  // the guard-direction rule, whose example transition sits far enough past the tool name that no
  // window anchored on `update_status` can reach it without also swallowing `red→green` and
  // `evidence → add_verification_evidence`. The guard vocabulary binds it instead, and the
  // stability twin of this line is read by the widened `update_stability-transition`.
  [
    "status-backward-guard",
    new RegExp(
      `\\bstatus\\b[^\\n]{0,60}?\\bbackward\\b[^\\n]{0,20}?\\((?:예:\\s*)?${QUOTE}(${VALUE})${QUOTE}\\s*(?:→|->)\\s*${QUOTE}(${VALUE})`,
      "g"
    )
  ],
  [
    "req-keyed-status",
    new RegExp(
      `["'\`](?:req_)?id["'\`]\\s*:\\s*["'\`][A-Z]{2,}-[A-Z0-9]+-\\d+["'\`][^{}]{0,200}?["'\`]status["'\`]\\s*:\\s*["'\`](${VALUE})["'\`]`,
      "g"
    )
  ]
];

/** Requirement-stability slots, checked against `STABILITY_LEVELS` the same way. */
const STABILITY_SLOTS: Array<[string, RegExp]> = [
  ["update_stability-argument", new RegExp(`update_stability[^\\n]{0,80}?\\bstability\\s*[:=]\\s*${QUOTE}(${VALUE})`, "g")],
  // The window is 80, not 40: `update_stability: 기존 stability > 제안 stability 면 backward 차단
  // (frozen → evolving 금지)` states the guard direction 45 characters after the tool name, and a
  // 40-character window stops just short of it. The status axis cannot be widened the same way —
  // `update_status` 호출, red→green` and `update_status, evidence → add_verification_evidence`
  // both sit inside 80 characters and name no status at all.
  ["update_stability-transition", new RegExp(`update_stability[^\\n]{0,80}?\\b(${VALUE})\\s*(?:→|->)\\s*(${VALUE})`, "g")],
  ["stability-transition", new RegExp(`\\bstability\\s*(?:→|->)\\s*${QUOTE}(${VALUE})`, "g")],
  ["stability-snapshot-map", new RegExp(`\\bstability_snapshot"?\\s*:\\s*\\{((?:\\s*"[A-Z][A-Z0-9_-]*"\\s*:\\s*"${TOKEN}"\\s*,?)+)\\s*\\}`, "g")],
  ["metadata-stability-row", new RegExp(`\\bStability\\s*=\\s*${QUOTE}(${VALUE})`, "g")],
  ["req-stability-value", new RegExp(`REQ[^\\n]{0,15}?\\bstability\\s*[:=≠]\\s*${QUOTE}(${VALUE})`, "g")],
  // `stability 가 \`frozen\` 인 REQ`, `기본 stability 가 \`draft\`` — the particle-bound shape, the same
  // hole as on the status axis. The binding is looser here because it can be: `stability` names one
  // axis across this corpus, where `status` is shared with the lane, journal, report and plan-Task
  // machines and therefore has to be bound to a requirement before it counts.
  ["stability-particle-value", new RegExp(`\\b[Ss]tability\\b\\s*(?:은|는|이|가)\\s*${QUOTE}(${VALUE})`, "g")],
  // `stability = \`draft\` 제외` — the axis bound to a value with no requirement, tool or particle
  // in front of it. The status axis cannot be read this loosely because four other state machines
  // in this corpus carry a `status` field; `stability` names one axis and only one.
  ["stability-value", new RegExp(`\\bstability\\s*[:=]\\s*${QUOTE}(${VALUE})`, "g")],
  // `"stability": "evolving"` and `"current_stability": "draft"` — the axis word as a quoted
  // JSON key, which `\bstability\s*[:=]` walks past because the closing quote sits between the
  // word and the colon. The three qualifiers are the ones the feasibility report writes. A bare
  // quoted `"status"` cannot be read the same way: four other machines in this corpus key their
  // own state on that name.
  [
    "stability-quoted-key",
    new RegExp(`(?<![A-Za-z0-9_-])["'\`](?:current_|proposed_|then\\.)?stability["'\`]\\s*[:=]\\s*${QUOTE}(${VALUE})`, "g")
  ],
  // `Stability ∈ {evolving, stable}`, `req.stability IN {"draft", "deprecated", "frozen"}` — a
  // set predicate over the axis, the stability twin of `req-status-set`.
  ["stability-set", new RegExp(`\\b[Ss]tability\\s*(?:∈|IN)\\s*\\{([^}]*)\\}`, "g")],
  // The feasibility policy schema restates the enum in prose — a fourth copy, and the one a
  // policy file is validated against. The list is read up to the ", or `keep`" tail, which names
  // the schema's no-change outcome rather than a stability level.
  ["stability-enum-restatement", new RegExp(`stability[^\\n]{0,30}?must be one of\\s*([^.\\n]*?)(?:,\\s*or\\b|\\.)`, "g")]
];

/**
 * How often each slot fires in the rendering that carries it least, measured on the shipped tree.
 * A pattern that stops matching — because the prose it reads was rewritten into a shape it no
 * longer recognises — otherwise reports zero violations and reads as clean. The floors are per
 * slot, not on the sum: the corpus holds 59 status slots against a sum-of-floors of 59, so a total
 * floor leaves room for several patterns to die unnoticed.
 */
const STATUS_SLOT_FLOOR: Record<string, number> = {
  "update_status-argument": 8,
  "update_status-positional": 7,
  "add_requirement-argument": 4,
  "list_requirements-argument": 1,
  "req-status-set": 5,
  "req-status-value": 8,
  "req-status-particle-value": 1,
  "req-status-arrow": 4,
  "status-literal-bullet": 2,
  "status-transition": 2,
  "status-order-ladder": 4,
  "status-snapshot-map": 3,
  "metadata-status-row": 1,
  "status-bound-value": 1,
  "update_status-list-line": 2,
  "status-backward-guard": 4,
  "req-keyed-status": 2
};

const STABILITY_SLOT_FLOOR: Record<string, number> = {
  "update_stability-argument": 1,
  "update_stability-transition": 6,
  "stability-transition": 1,
  "stability-snapshot-map": 3,
  "metadata-stability-row": 11,
  "req-stability-value": 2,
  "stability-particle-value": 2,
  // 13 -> 12 (FR-FLOW-161, 2026-08-28). The codex/etc/mirror sentence
  // `Exclude non-implemented, draft, deprecated, and already-verified candidates.` was
  // replaced by the four-name table and the accounting rules, and that one sentence carried
  // one firing of this slot. Both values are still written in three places in that skill —
  // the `eligible` row, the exclusion sentence, and the gate table row — so what left is a
  // restatement, not a value. A floor is only sound to lower when what left is named.
  "stability-value": 12,
  "stability-quoted-key": 8,
  "stability-set": 11,
  "stability-enum-restatement": 5
};

/**
 * Two shapes that occupy a slot syntactically while naming no value at all, both measured in the
 * shipped text: a schema line writing the argument's TYPE (`{ id: string, status: string }`) and a
 * signature line writing the parameter's NAME (`update_status(id, status)`).
 */
const NOT_A_VALUE = new Set(["string", "status"]);

/**
 * A requirement id, which the widened `TOKEN` also matches. A snapshot map is keyed by id, so
 * without this the three ids it carries are read as three wrong values. Measured across the four
 * renderings: on the status axis and the stability axis alike this removes exactly the twelve
 * snapshot keys per axis and nothing else, leaving the scan at zero violations.
 */
const REQUIREMENT_ID = /^[A-Z]{2,}-[A-Z0-9]+-\d+$/;

/**
 * The backstop the slot scan cannot provide: words that read as a requirement lifecycle value,
 * are in neither enum, and have no legitimate use anywhere in the shipped corpus. A value in one
 * of these words reaches an agent even when it sits outside every slot shape.
 *
 * `rejected`, `pending`, `superseded` and `review` are deliberately absent. Each names a value of
 * a different state machine the skills legitimately run — a finding classification, a plan Task
 * status, a wave `exclusion_class`, a plan `TaskType` — and banning the bare token would fail on
 * text that is correct. Those axes are covered by the slot scan, which reads the binding.
 */
const FORBIDDEN_LIFECYCLE_WORDS = ["proposed", "approved", "obsolete", "wontfix", "in_review", "not_started"] as const;

/**
 * Prose uses argued for rather than slipped in, as [word, what may follow it]. `proposed` in
 * particular has landed in requirement documents twice, and the 2026-07-16 repair changed eleven
 * requirement blocks while leaving the text that dictates it in place.
 */
const ALLOWED_LIFECYCLE_PROSE: Array<[string, RegExp]> = [["proposed", /^\s+change\b/]];

/**
 * Spellings that belong to another machine and are written in caps there: `APPROVED` /
 * `CHANGES_REQUESTED` is the GitHub review verdict `kiwi-review-fix-loop` reads back, and
 * `[OBSOLETE]` is the NON-STANDARD heading marker the packaged rules document §30.4 names three
 * times in order to say the tool gives it no meaning and that a requirement carrying one is still
 * live. Both are the all-caps spelling only: `obsolete` written as a value still fails here, which
 * is what this layer exists for.
 *
 * The scan below is case-insensitive, because `| status 상한 = \`Proposed\` |` instructs an agent
 * exactly as `proposed` does and a case-sensitive scan walks past it. That makes the verdict
 * constant an exception that has to be named rather than one granted by accident.
 */
const ALLOWED_LIFECYCLE_SPELLINGS = ["APPROVED", "OBSOLETE"] as const;

/**
 * A decision-table column whose header NAMES one of the two axes. `THEN (stability)` in
 * `kiwi-srs-feasibility` §0.G6 dictates the argument `update_stability` is sent, but the value sits
 * alone in a cell — no tool name, no particle, no `[:=]` — so every line-shaped slot walks past it,
 * and that column is the stability half of the very defect this requirement closes on the status
 * axis. The header has to name the axis rather than talk about it: `May update stability` heads a
 * column of skill names.
 */
const AXIS_COLUMN_HEADER = (axis: string): RegExp =>
  new RegExp(`^(?:THEN|IF)?\\s*\\(?\\s*(?:REQ\\s+)?${axis}\\s*(?:result)?\\s*\\)?$`, "i");

/** `keep` is not a stability level. It is the table's explicit "make no call at all" outcome. */
const NO_CHANGE_OUTCOME = ["keep"] as const;

/**
 * What the readers that are not line-shaped find in the rendering that carries the least, as
 * measured. Each of these reads a value the axis word does not sit beside, so every line-shaped
 * slot walks past it — and a survey of the lines no slot reads found all four of these carrying
 * real instructions.
 */
const DECISION_FLOOR: Record<string, number> = {
  "stability-decision-column": 23,
  "status-decision-predicate": 3,
  "status-rule-bullet": 4,
  "stability-rule-bullet": 5,
  "transition-table": 5
};

/**
 * A rendering ships executable files beside its prose, and one of them holds a third copy of the
 * stability enum: `kiwi-planner`'s `validator.mjs` compares `r.stability` against a hardcoded
 * `'deprecated'` in two checks. The requirement text says "skill text", so this is a guard the
 * contract test adds rather than an obligation AC-1 states — but a code copy drifting silently is
 * the situation this requirement exists to prevent, and a markdown-only walk cannot see it.
 */
const SCRIPT_STABILITY_FLOOR = 2;

// ---------------------------------------------------------------------------------------------
// The coverage layer, which reads by EXCLUSION rather than by slot.
//
// A slot is an inclusion test: it looks for a sentence shape and reads the value inside it. When
// the shape is not among the patterns, the value is not read — and nothing fails. That silence is
// why four verification rounds did not converge (docs/research/29 §3.3): every round the verifier
// planted a mutation at an unslotted site, the mutation survived, and the finding was always real.
// A measurement of this corpus found 419 value-bearing lines in one rendering taking 62 sentence
// shapes, the largest group being the lines no shape matched at all, so the pattern set was never
// going to close.
//
// This layer inverts the direction. EVERY line that still names a lifecycle value after the
// homonym dictionary has taken its own words out is read, whatever shape it has, and the values
// it names are counted. Leaving a homonym out of the dictionary is then a FALSE POSITIVE on the
// next run rather than a silent gap, and the two floors below make a value that quietly leaves
// the corpus fail instead of shrinking the sweep.
//
// The dictionary is not a way to make failures go away. An entry is added only after the site is
// judged to be a genuine homonym; a wrong value put there would be silenced exactly the way a
// missing slot silenced one, which is the failure mode this layer exists to remove.
// ---------------------------------------------------------------------------------------------

/** The eleven words the two code enums define, checked as one vocabulary. */
const LIFECYCLE_VALUES: readonly string[] = [...REQUIREMENT_STATUSES, ...STABILITY_LEVELS];

interface Homonym {
  /** Named so a failure, a freeze and a report all say the same thing. */
  id: string;
  /** The enum member this entry speaks for; `null` when the entry is about the position, not the word. */
  value: string | null;
  /**
   * Tested against `<text before the value>\0<text after it>`, so `\0` marks exactly where the
   * value sits. One regex covers both sides and no entry can drift into matching a whole line.
   */
  at: RegExp;
  why: string;
}

/**
 * Rules — homonym classes wide enough that naming their sites one by one would be a list of
 * dozens. Measured hit counts across the four renderings sit in the report; each is a vocabulary
 * this repository legitimately runs beside the requirement lifecycle.
 */
const HOMONYM_RULES: Homonym[] = [
  { id: "frozen-field-path", value: "frozen", at: /\0\.[a-z]/, why: "재개 카드의 `frozen.<field>` 필드 경로다" },
  // The left context is narrowed to what a flag can actually follow. Written `/--\0/` the rule also
  // spoke for `status: "--draft"` — a flag NAME written into an argument literal, which is not a
  // flag use at all — and the slot layer could not read that token either, so the two layers were
  // blind in the same place. A quote in front of the `--` now leaves the rule silent and `VALUE`
  // reads the token, which is the direction the two layers are supposed to disagree in.
  { id: "cli-flag", value: null, at: /(?:^|[\s([|/])--\0/, why: "`--` 로 시작하는 플래그 이름이다" },
  {
    id: "feasibility-label",
    value: "blocked",
    at: /(?:feasibilit|implementabilit)\w*[^\n]{0,22}\0|\blow\b[^\n]{0,14}\0|\0[^\n]{0,14}\blow\b/i,
    why: "feasibility · implementability 라벨 사다리(high·medium·low·blocked)의 최하단이다"
  },
  {
    id: "task-status",
    value: "blocked",
    at: /\b(?:skipped|running|failed|pending|done)\b[^\n]{0,22}\0|\0[^\n]{0,22}\b(?:skipped|running|failed|pending|done)\b/,
    why: "plan Task 진행 status(pending·running·done·failed·blocked·skipped)의 한 값이다"
  },
  {
    id: "journal-status",
    value: "in_progress",
    at: /\b(?:pending|complete|failed|phase)\b[^\n]{0,26}\0|\0[^\n]{0,26}\b(?:pending|complete|failed|phase)\b/,
    why: "waves.jsonl 저널 이벤트 status(pending·in_progress·complete·failed)의 한 값이다"
  }
];

/**
 * Named sites — the residue the rules do not reach. Each `why` says which machine owns the word
 * there, so the list reads as a homonym dictionary rather than as a list of silencings: it is what
 * tells a later reader where `draft` is not a Stability value and where `blocked` is not a Status.
 */
const HOMONYM_SITES: Homonym[] = [
  { id: "review-round-blocked-warn", value: "blocked", at: /\0\/warn/, why: "리뷰 라운드의 blocked/warn 상태 표기다" },
  { id: "planned-tasks-adjective", value: "planned", at: /\0\s+tasks\b/, why: "영어 형용사다 — planned tasks" },
  { id: "verified-changes-adjective", value: "verified", at: /\0\s+changes\b/, why: "영어 형용사다 — verified changes" },
  { id: "card-frozen-json-key", value: "frozen", at: /"\0"\s*:\s*\{/, why: "재개 카드 JSON 의 `frozen` 블록 키다" },
  { id: "card-frozen-block", value: "frozen", at: /\0`?\s*(?:블록|block)/, why: "재개 카드의 `frozen` 블록 이름이다" },
  { id: "card-frozen-inside", value: "frozen", at: /\0`?\s*안에\s/, why: "재개 카드의 `frozen` 블록 안이라는 위치 서술이다" },
  { id: "card-frozen-record", value: "frozen", at: /\0`?\s*에\s*기록/, why: "재개 카드의 `frozen` 블록에 기록한다는 서술이다" },
  { id: "frozen-denominator", value: "frozen", at: /\0\s+denominator\b/, why: "영어 형용사다 — frozen denominator table" },
  { id: "plan-freeze-path", value: "frozen", at: /outputs\/\0/, why: "plan freeze 산출물 경로 `outputs/frozen/` 의 한 마디다" },
  { id: "waves-event-name", value: "in_progress", at: /\0`?\**\s*(?:이벤트|타임스탬프|event)/, why: "waves.jsonl 저널 이벤트의 이름이다" },
  { id: "waves-event-particle", value: "in_progress", at: /\0`?\s*(?:에서는|1줄|\*\*에서는)/, why: "waves.jsonl 저널 이벤트의 이름이다" },
  { id: "wave-issues-field", value: "planned", at: /\bopen,\s\0/, why: "wave_issues 집계 객체의 필드 이름이다" },
  { id: "coder-task-status", value: "in_progress", at: /current_task_id\b[^\n]{0,40}\0/, why: "kiwi-coder 실행 상태 파일의 Task status 다" },
  { id: "tdd-draft-phase", value: "draft", at: /\bTDD\s\0/, why: "TDD 초안 단계 이름(tdd-draft)이다" },
  { id: "pr-draft-flag-ko", value: "draft", at: /\0\s*(?:로 생성|비활성)/, why: "GitHub PR 의 draft 플래그 설명이다" },
  { id: "pr-draft-flag-en", value: "draft", at: /\0\s+(?:PR\b|a PR body)/, why: "GitHub PR 의 draft 플래그이거나 영어 동사 draft 다" },
  { id: "alias-deprecated-note", value: "deprecated", at: /alias\*{0,2}\s*\(\0/, why: "반환 필드 alias 의 폐기 예정 표기다" },
  { id: "plan-draft-artifact", value: "draft", at: /\0`?\s*만\s*보존/, why: "plan 초안 산출물을 가리킨다" },
  { id: "pm-task-status-literal", value: "blocked", at: /status\s*=\s*"\0/, why: "kiwi-pm 실행 상태 파일의 Task status 다" },
  { id: "pm-task-status-record", value: "blocked", at: /\0\s*기록/, why: "kiwi-pm 실행 상태 파일의 Task status 다" },
  { id: "pm-task-counter-key", value: "blocked", at: /^\s*"\0"\s*:\s*\d/, why: "kiwi-pm 상태 파일의 Task 집계 카운터 키다" },
  { id: "pm-pseudocode-init", value: "blocked", at: /\0\s*=\s*\[\]/, why: "kiwi-pm 의사코드의 지역 변수다" },
  { id: "pm-pseudocode-append", value: "blocked", at: /\0\.append/, why: "kiwi-pm 의사코드의 지역 변수다" },
  { id: "pm-pseudocode-ref", value: "blocked", at: /\b(?:IN|NOT)\s\0/, why: "kiwi-pm 의사코드의 지역 변수다" },
  { id: "predecessor-skill-note", value: "deprecated", at: /\0\s*예정/, why: "선행 스킬이 폐기될 예정이라는 서술이다" },
  { id: "dependency-feasibility", value: "blocked", at: /unstable\/\0/, why: "의존 REQ 의 feasibility 서술이다" },
  { id: "policy-rerun-diff", value: "blocked", at: /ok\s*(?:→|->)\s*\0|\0\s*(?:→|->)\s*ok/, why: "정책 재실행 비교표의 feasibility 판정 변화다" },
  {
    id: "qna-alias-deprecated",
    value: "deprecated",
    at: /(?:qna|alias)[^\n]{0,25}\0|\0[^\n]{0,25}(?:qna|alias|별칭)/i,
    why: "`--qna` 플래그가 폐기 예정이라는 표기다"
  }
];

const HOMONYM_DICTIONARY: Homonym[] = [...HOMONYM_RULES, ...HOMONYM_SITES];

/**
 * Words that read as a near miss of an enum member and are nonetheless correct English or a real
 * identifier. Measured on the shipped tree: these are every token within edit distance 2 of a
 * lifecycle value that appears on a line the sweep reads.
 *
 * The list is short on purpose. `in-progress` written for `in_progress` is distance 1 and is the
 * likeliest typo in this enum, so the near-miss reader has to stay wide enough to see it.
 */
const ALLOWED_NEAR_MISS = [
  "state",
  "planner",
  "unverified",
  "drift",
  "blockers",
  // Both surfaced when the near-miss domain moved from the census lines to every line: `REQ
  // rename/deprecate 시` and `의존 REQ 가 unstable/blocked` are English beside the requirement, and
  // the wider domain is what reaches them. Neither can hide a value: a stability slot naming
  // `unstable` is read by `stability-value`, and `deprecate` in a slot fails the enum test there.
  "unstable",
  "deprecate"
] as const;

/**
 * How often each enum member is named, per rendering, after the dictionary has taken the homonyms
 * out — measured on the shipped tree.
 *
 * This is the floor that replaces the per-slot floor. A slot floor speaks for a PATTERN, so it
 * dies with the pattern; this one speaks for a VALUE, and the eleven values are imported from the
 * code rather than restated, so no key can be dropped without the enum losing a member. Mutating
 * one site takes its value out of the count whatever the mutation writes in its place — a
 * misspelling, a word from another vocabulary, a deletion — and the count falls below the floor.
 * Widening the dictionary has the same effect, so an exclusion cannot be added quietly either.
 */
const VALUE_FLOOR: Record<string, Record<string, number>> = {
  "skills/claude": {
    planned: 25,
    in_progress: 26,
    blocked: 10,
    implemented: 46,
    verified: 52,
    discarded: 24,
    draft: 87,
    evolving: 38,
    stable: 56,
    frozen: 81,
    deprecated: 43
  },
  "skills/codex": {
    planned: 26,
    in_progress: 27,
    blocked: 12,
    implemented: 48,
    verified: 42,
    discarded: 24,
    draft: 97,
    evolving: 37,
    stable: 57,
    frozen: 69,
    deprecated: 49
  },
  "skills/etc": {
    planned: 26,
    in_progress: 27,
    blocked: 12,
    implemented: 45,
    verified: 39,
    discarded: 24,
    draft: 93,
    evolving: 34,
    stable: 50,
    frozen: 64,
    deprecated: 45
  },
  ".agents/skills": {
    planned: 26,
    in_progress: 27,
    blocked: 12,
    implemented: 48,
    verified: 42,
    discarded: 24,
    draft: 91,
    evolving: 37,
    stable: 54,
    frozen: 69,
    deprecated: 48
  }
};

// ---------------------------------------------------------------------------------------------
// The TOOL axis, which reads by anchoring on the TOOL NAME rather than on the value.
//
// The value axis above — slots and the exclusion census alike — can only read a line that already
// names an enum member. So a line that names a value the enum does NOT define is invisible to both:
// `` [^st]: `update_status` 에 보낼 값은 `landed` 다 `` deletes nothing, so no count falls, and
// `landed` is not an enum word, so the census never looks at the line. That is how a direct
// instruction to send a value the runtime refuses with `USAGE` passed a full sweep.
//
// The anchor here is the tool name, which is a CLOSED set the MCP schema defines. Around it the
// reader takes every value-shaped token in a value position and asks whether it is a lifecycle
// value or one of the words this corpus is measured to write there. A wrong value bound by a
// Korean particle, sitting in a footnote, or written into frontmatter is read the same way a call
// signature is, because none of that changes where the token stands relative to the tool.
// ---------------------------------------------------------------------------------------------

/** Every MCP tool name, and every argument name any of them declares. Both derived from the schema. */
const MCP_TOOL_NAMES: readonly string[] = Object.keys(toolSchemas);
const MCP_ARGUMENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(toolSchemas).flatMap((shape) => Object.keys(shape))
);

/**
 * The tools whose arguments carry a REQUIREMENT lifecycle value, derived rather than listed: a
 * schema that declares `status` or `stability` and does not declare `step`, `task` or `taskId`.
 * The three excluded by that second clause — `update_step_state`, `set_sds_status`,
 * `workflow_task_status_set` — key their `status` on a step or a plan Task, so their vocabulary
 * (`merged`, `abandoned`, `acknowledged`) is a different state machine and reading it on this axis
 * would report correct text as wrong.
 *
 * Deriving the list rather than freezing it means a tool that GAINS a requirement-status argument
 * is read from the day the schema says so, which a literal here would have to be told about.
 */
const AXIS_TOOLS: readonly string[] = Object.entries(toolSchemas)
  .filter(([, shape]) => ("status" in shape || "stability" in shape) && !("step" in shape) && !("task" in shape) && !("taskId" in shape))
  .map(([name]) => name)
  .sort();

// ---------------------------------------------------------------------------------------------
// The CLI spelling of the same axis.
//
// `speckiwi update-status` is a first-class surface of this repository, not a near-miss of the MCP
// name: the repository CLAUDE.md makes the CLI the documented fallback when MCP is unavailable, and
// every skill's §13 table puts an MCP column and a CLI column side by side. The subcommand set is a
// closed, finite set exactly as the tool schema is, so it is derived from the CLI program the same
// way — and until it was, `update-status` sat in the RESIDUE list below, which is to say the design
// had classified the CLI spelling as noise rather than as something that carries a value.
// ---------------------------------------------------------------------------------------------

interface CliSurface {
  /** `update-status`, `step update-state` — the path, joined. */
  readonly path: string;
  readonly name: string;
  readonly argumentNames: readonly string[];
  readonly optionNames: readonly string[];
}

/** Every subcommand the CLI registers, with the arguments and long options it declares. */
function cliSurfaces(): CliSurface[] {
  const io = { stdout: { write: () => true }, stderr: { write: () => true } } as never;
  const program = buildCommand({ io }, [
    registerReadCommands,
    registerMutationCommands,
    registerSkillCommands,
    registerDoctorCommand,
    registerRepairCommands,
    registerOrchestrateCommands
  ]);
  const out: CliSurface[] = [];
  const walk = (command: { commands: unknown[] }, prefix: string[]): void => {
    for (const raw of command.commands) {
      const sub = raw as {
        commands: unknown[];
        name(): string;
        registeredArguments?: Array<{ name(): string }>;
        options: Array<{ long?: string }>;
      };
      const argumentNames = (sub.registeredArguments ?? []).map((argument) => argument.name());
      const optionNames = sub.options.map((option) => option.long ?? "").filter((long) => long !== "");
      out.push({ path: [...prefix, sub.name()].join(" "), name: sub.name(), argumentNames, optionNames });
      walk(sub, [...prefix, sub.name()]);
    }
  };
  walk(program as unknown as { commands: unknown[] }, []);
  return out;
}

const CLI_SURFACES: readonly CliSurface[] = cliSurfaces();

/** Every subcommand name and every long option the CLI declares — the derived residue of a command line. */
const CLI_COMMAND_NAMES: ReadonlySet<string> = new Set(CLI_SURFACES.map((surface) => surface.name));
const CLI_OPTION_NAMES: ReadonlySet<string> = new Set(CLI_SURFACES.flatMap((surface) => surface.optionNames));

/**
 * The CLI subcommands that carry a REQUIREMENT lifecycle value, derived by the same two clauses the
 * MCP list uses: it declares a `status` or a `stability` (as a positional or as an option) and it
 * does not key that on a step, a plan Task or a target. `step update-state`, `step sds-status` and
 * `workflow task-status-set` fall out on the second clause exactly as their MCP twins do, and
 * `set-target-status` falls out with them because a target's status is not a requirement's.
 */
const AXIS_CLI_COMMANDS: readonly string[] = CLI_SURFACES.filter((surface) => {
  const declared = [...surface.argumentNames, ...surface.optionNames.map((long) => long.replace(/^--/, ""))];
  const carries = declared.some((name) => name === "status" || name === "stability");
  // The POSITIONAL is what a subcommand keys its status on. `--target` is a filter — `speckiwi list
  // --target v3.0.0 --status planned` still asks about requirements — where `set-target-status
  // <target> <status>` takes the target as the subject and moves the target's own status.
  const keyedElsewhere = surface.argumentNames.some((name) => ["step", "task", "taskId", "target"].includes(name));
  return carries && !keyedElsewhere;
})
  .map((surface) => surface.name)
  .sort();

/**
 * How far from the anchor a value can stand and still be an argument of it, measured.
 *
 * The window reaches BOTH ways. Korean puts the object before the verb, so `` `landed` 를
 * `update_status` 에 보낸다 `` is the more natural of the two orders and a forward-only reader walks
 * straight past it.
 *
 * Eighty, not sixty. A sentence that names the tool first and the value last — `` `update_status` 는
 * … 그 인자로 `landed` 를 보낸다 `` — puts sixty-nine characters between them without any contrivance,
 * and at sixty that sentence passed. The measured cost of the extra twenty characters is five more
 * residue entries, which is what a window has instead of a hard edge.
 */
const TOOL_AXIS_WINDOW = 80;

/**
 * Words that stand in a value position beside one of those tool names and are not lifecycle values.
 * Measured across all four renderings; every entry is asserted below to still claim an occurrence,
 * so an entry added to make a failure go away has to keep earning its place.
 *
 * Tool names, declared argument names, skill names and requirement ids are excluded by derivation
 * instead of appearing here — those four classes are the bulk of what stands beside a call, and
 * listing them would be restating the schema in a place that can drift from it.
 */
const TOOL_AXIS_NON_VALUES = [
  "COMPACT_FIELDS",
  "Conflicts",
  "MUTATION_DENIED",
  "REQ-X",
  // The whole measured price of refusing the derived surface names in a handing position. All five
  // are the shipped corpus writing a PLACEHOLDER where a value goes — `list_requirements { scope:
  // prefix, target: TARGET }` names two argument names and one caps placeholder as stand-ins, and
  // `구현 증거 path:line 제시` puts an argument name after a colon in ordinary prose. Named here
  // rather than left to the 485-token derivation, so each one is frozen, is checked below for still
  // claiming an occurrence, and had to be read once.
  "TARGET",
  "USAGE",
  "addition_site",
  "apply_patch",
  "args",
  "args_hash",
  "compact",
  "conflict_reqs_deferred",
  "conflicts_with",
  "demote",
  "expected",
  "fence",
  "finding",
  "freeze-route",
  "green",
  "json",
  "lifecycle_override",
  "line",
  "lock",
  "mechanism",
  "mutation",
  "new-feature",
  // The two the packaged RULES document costs, and the whole of it. Both are ordinary English words
  // standing where this reader looks for a value, in a register the renderings do not write in:
  // `update_status` to `implemented` is not gated: none of the §14.3 conditions is checked` binds
  // `none` on the sentence colon, and `Use `update_status` and `update_stability` to reach the
  // standard markers` binds `reach` on the English preposition the YAML prompts needed. Neither is
  // a misspelling of an enum member — asserted below — so neither can hide the attack this position
  // exists to catch.
  "none",
  "out_of_scope",
  "p",
  "planner",
  "prefix",
  "reach",
  "read",
  "reference",
  "req_id",
  "reqs",
  "response_hash",
  "result",
  "result_id",
  "rung",
  "scope",
  "sha1",
  "skip",
  "speckiwi",
  "srs_authored",
  "state",
  "string",
  "t_final_dryrun_only",
  "target",
  "test",
  "traceLinks",
  "true",
  "unit",
  "v",
  "with",
  "workflow",
  "--close-reqs",
  "--inventory-file",
  "--skip-lifecycle-gate"
] as const;

/** A value-shaped token: lowercase, at least four characters. Every lifecycle value is one. */
const TOOL_AXIS_NARROW_CORE = "-{0,2}[a-z][a-z0-9_-]{3,}";

/**
 * The class the reader actually scans: any token, any case, any length, digits included.
 * `TOOL_AXIS_NARROW_CORE` above then decides which POSITIONS a token outside the narrow class is read
 * in — see `axisPositions`.
 *
 * The narrow class exists because bare prose beside a call is mostly lowercase English words, and
 * reading all of them reports ordinary text. But it is narrower than the shapes a wrong value takes:
 * `wip` is three letters, `DONE` is shouted, `Landed` is capitalised and `3` is a number, and all
 * four stood inside a backtick with a Korean particle after them — the most explicit value position
 * this corpus has — and all four passed. A token is not made harmless by being short or capitalised.
 */
const TOOL_AXIS_ANY_TOKEN = "(?<![A-Za-z0-9_-])(-{0,2}[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?)(?![A-Za-z0-9_-])";

/** The Korean particles that bind a value to what precedes it. */
const VALUE_PARTICLE = "(?:을|를|로|으로|은|는|이|가|다|와|과|이나|거나)";

/**
 * `landed 상태로`, `landed(최종) 로` — a value with ONE noun, or one parenthetical, between it and
 * the particle that binds it. `REQ 를 X 상태로 올린다` is the most natural Korean word order this
 * corpus has for naming a state, and the three-shape value position walked straight past it.
 *
 * Only the directional particles 로 / 으로 close the group. The full particle set would read
 * `backward 전이` as a value bound by 이, and 전이 is a noun.
 */
const NOUN_BOUND_PARTICLE = `(?:\\s*\\([^)\\n]{0,16}\\))?[\`"'*]{0,2}\\s?(?:[가-힣]{1,3})?(?:으로|로)(?![가-힣])`;

/**
 * The English half of the same binding. `Then call `update_status` to `verified`` is how this corpus
 * writes the instruction when it writes it in English, and `agents/openai.yaml` carries its
 * `default_prompt` in English only — so a prompt reading `Set update_stability to reviewed` has no
 * particle for the reader above to find and no backtick either.
 *
 * `to` and `as` are the prepositions that introduce the value, which is what 로 / 으로 do. Measured
 * across the whole corpus this admits six positions and every one of them names a lifecycle value:
 * it costs the residue list nothing.
 */
const ENGLISH_VALUE_PREPOSITION = /(?:^|[^A-Za-z0-9_-])(?:to|as)\s+[`"'*]{0,2}$/;

/**
 * Usage placeholders, blanked before the scan. `speckiwi update-status <id> <status>` names no value
 * — `<id>` and `<status>` are the shapes a value goes IN — and `wave-{n}` is a template. Blanking
 * them rather than allow-listing `id`, `status` and `n` keeps those three words readable everywhere
 * else, which is where a real value could be written with one of them beside it.
 */
function blankPlaceholders(text: string): string {
  return text
    .replace(/<[A-Za-z0-9_.,[\]|-]*>/g, (match) => " ".repeat(match.length))
    .replace(/\{[A-Za-z0-9_.-]+\}/g, (match) => " ".repeat(match.length));
}

interface AxisAnchor {
  start: number;
  end: number;
  /** `update_status`, `speckiwi update-status` — what the failure names. */
  label: string;
}

/** Every axis surface named on one line: an MCP tool by name, a CLI subcommand by its invocation. */
function axisAnchors(text: string): AxisAnchor[] {
  const found: AxisAnchor[] = [];
  for (const tool of AXIS_TOOLS) {
    const scan = new RegExp(`\\b${tool}\\b`, "g");
    for (let match = scan.exec(text); match; match = scan.exec(text)) {
      found.push({ start: match.index, end: match.index + tool.length, label: tool });
    }
  }
  for (const command of AXIS_CLI_COMMANDS) {
    // Anchored on the whole invocation, not on the subcommand alone: `list` and `search` are
    // ordinary words, and only `speckiwi … list` is the CLI being told what to do.
    const scan = new RegExp(`\\bspeckiwi\\b[^\\n]{0,40}?\\b${command}\\b`, "g");
    for (let match = scan.exec(text); match; match = scan.exec(text)) {
      found.push({ start: match.index, end: match.index + match[0].length, label: `speckiwi ${command}` });
    }
  }
  return found;
}

/**
 * The inline code spans that ARE an invocation of an axis surface, so the tokens inside them are its
 * arguments. `` `speckiwi update-status <id> landed` `` writes the value as a bare token — space in
 * front, closing backtick behind — which is none of the three value positions, and it is also the
 * shape every CLI example in this corpus is written in. Restricted to spans that OPEN with the
 * invocation, so an ordinary code span that merely mentions a tool is not read this way.
 */
function invocationSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const cli = new RegExp(`^\\s*(?:(?:npx|node)\\s+\\S+\\s+)*speckiwi\\b[^\\n]{0,40}?\\b(?:${AXIS_CLI_COMMANDS.join("|")})\\b`);
  const mcp = new RegExp(`^\\s*(?:${AXIS_TOOLS.join("|")})\\b`);
  const scan = /`[^`\n]+`/g;
  for (let match = scan.exec(text); match; match = scan.exec(text)) {
    const body = match[0].slice(1, -1);
    if (!cli.test(body) && !mcp.test(body)) continue;
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

interface AxisPosition {
  tool: string;
  token: string;
  /** Which of the value positions admitted it, so a failure says why the token was read. */
  position: string;
}

function axisPositions(line: string): AxisPosition[] {
  const found: AxisPosition[] = [];
  const text = blankPlaceholders(line);
  const spans = invocationSpans(text);
  const narrow = new RegExp(`^${TOOL_AXIS_NARROW_CORE}$`);
  const particled = new RegExp(`^[\`"'*]{0,2}\\s?${VALUE_PARTICLE}`);
  const nounParticled = new RegExp(`^[\`"'*]{0,2}${NOUN_BOUND_PARTICLE}`);
  for (const anchor of axisAnchors(text)) {
    for (const hit of text.matchAll(new RegExp(TOOL_AXIS_ANY_TOKEN, "g"))) {
      const at = hit.index as number;
      const token = hit[1] as string;
      if (at >= anchor.start && at + token.length <= anchor.end) continue;
      if (at < anchor.start - TOOL_AXIS_WINDOW || at >= anchor.end + TOOL_AXIS_WINDOW) continue;
      const before = text.slice(Math.max(0, at - 3), at);
      const after = text.slice(at + token.length, at + token.length + 8);
      const quoted = /[`"'*]$/.test(before) && /^[`"'*]/.test(after);
      const bound = /(?:→|->|:|=)\s*[`"'*]{0,2}$/.test(before);
      const isNarrow = narrow.test(token);
      // Behind the anchor only a particle or an arrow binds. Korean puts the object first, so
      // `\`landed\` 를 update_status 에 보낸다` is a call being told what to send; but the text behind
      // a tool name is also where table cells, JSON keys and prose sit, and reading every quoted
      // token there reports 22 ordinary words in the shipped tree.
      const behind = at < anchor.start;
      const english = ENGLISH_VALUE_PREPOSITION.test(text.slice(Math.max(0, at - 12), at));
      let position = "";
      if (isNarrow && (particled.test(after) || bound || (!behind && quoted))) position = "quoted-or-bound";
      else if (isNarrow && nounParticled.test(after)) position = "noun-particle";
      else if (isNarrow && english) position = "english-preposition";
      else if (quoted && particled.test(after)) position = "quoted-and-particle";
      else if (spans.some(([from, to]) => at > from && at + token.length < to)) position = "invocation";
      if (position === "") continue;
      found.push({ tool: anchor.label, token, position });
    }
  }
  return found;
}

interface ToolAxisHit {
  file: string;
  line: number;
  tool: string;
  token: string;
  position: string;
  excerpt: string;
}

/** `axisPositions` run over the corpus. */
function toolAxisHits(files: string[]): ToolAxisHit[] {
  const found: ToolAxisHit[] = [];
  for (const file of files) {
    const lines = readCorpus(file).replace(/\r\n/g, "\n").split("\n");
    lines.forEach((text, index) => {
      for (const hit of axisPositions(text)) {
        found.push({
          file,
          line: index + 1,
          tool: hit.tool,
          token: hit.token,
          position: hit.position,
          excerpt: text.trim().replace(/\s+/g, " ").slice(0, 100)
        });
      }
    });
  }
  return found;
}

/**
 * How many value positions the axis reads in the rendering that carries the fewest, measured. The
 * same argument the slot floors carry: a reader that stopped matching reports zero violations.
 */
const TOOL_AXIS_FLOOR: Record<string, number> = {
  // 396 → 394 (FR-FLOW-159, 2026-08-28). The claude call-log example gained a third tool name in
  // its `"tool"` field, and that name is 25 characters, so two tokens that had been inside the
  // 80-character window after the `update_status` anchor fell outside it. Both are JSON scaffolding
  // of that example — the `sha1` placeholder and the `ok` key — and neither is a requirement
  // status: the values the axis exists to read are unchanged, and the value-site golden records
  // the change as +40/−24 sites, a net gain. Lowering a floor is a coverage reduction and is only
  // sound when what left is named; that is why the two are named here.
  "skills/claude": 394,
  "skills/codex": 301,
  "skills/etc": 297,
  ".agents/skills": 297
};

/**
 * The axis surfaces each rendering actually writes a value beside, measured. `search_requirements`
 * is in the axis because its schema takes a status and a stability, and no rendering currently
 * writes a value beside it — recorded here rather than asserted away, so that the day one does the
 * list has to be updated and read.
 *
 * Per rendering, because the renderings differ on exactly this: `skills/claude` ships a CLI
 * fallback and writes values beside `speckiwi update-status` / `speckiwi update-stability`, while
 * codex and etc call the CLI diagnostic-only and write no value beside it. A single list would hide
 * that difference behind whichever rendering carried the most.
 */
const TOOL_AXIS_SURFACES_IN_USE: Record<string, readonly string[]> = {
  "skills/claude": [
    "add_requirement",
    "list_requirements",
    "speckiwi add-requirement",
    "speckiwi list",
    "speckiwi update-stability",
    "speckiwi update-status",
    "update_stability",
    "update_status"
  ],
  "skills/codex": ["add_requirement", "list_requirements", "update_stability", "update_status"],
  "skills/etc": ["add_requirement", "list_requirements", "update_stability", "update_status"],
  ".agents/skills": ["add_requirement", "list_requirements", "update_stability", "update_status"]
};

/**
 * What the axis will not report, derived rather than listed: the two enums, the MCP schema's tool
 * and argument names, the CLI's own subcommand and option names, this repository's skill names and
 * requirement ids. Those six classes are the bulk of what stands beside a call, and writing any of
 * them out here would be restating a contract in a place that can drift from it.
 */
/**
 * The argument names the AXIS tools themselves declare — what a lifecycle call actually takes.
 *
 * This is the narrowing. `MCP_ARGUMENT_NAMES` is every argument of every one of the schema's tools,
 * `CLI_COMMAND_NAMES` every subcommand and `CLI_OPTION_NAMES` every long option: about 485 tokens,
 * exempt from being read beside a lifecycle call because SOME tool somewhere declares them. That is
 * derivation used as an argument for width, and the two are different questions. The set carries
 * `acknowledged`, `applied` and `resolution` — arguments of the orchestrator's issue and replay
 * tools — and `promote`, `freeze` and `close`, which are subcommands of `read` and `orchestrate`.
 * None of those six has anything to do with `update_status`, and all six are exactly the words
 * someone inventing a requirement status would reach for.
 *
 * Derived, still: a lifecycle call's own arguments come out of its own schema entry, so a tool that
 * gains one is exempt the day the schema says so. What it no longer inherits is every other tool's
 * vocabulary.
 */
const AXIS_TOOL_ARGUMENTS: ReadonlySet<string> = new Set(
  AXIS_TOOLS.flatMap((tool) => Object.keys(toolSchemas[tool] as Record<string, unknown>))
);

/** The same for the CLI half: the arguments and options the axis subcommands themselves declare. */
const AXIS_CLI_ARGUMENTS: ReadonlySet<string> = new Set(
  CLI_SURFACES.filter((surface) => AXIS_CLI_COMMANDS.includes(surface.name)).flatMap((surface) => [
    ...surface.argumentNames,
    ...surface.optionNames,
    ...surface.optionNames.map((long) => long.replace(/^--/, ""))
  ])
);

function toolAxisAllows(token: string, position = ""): boolean {
  const always = new Set<string>([...LIFECYCLE_VALUES, ...MCP_TOOL_NAMES, ...TOOL_AXIS_NON_VALUES]);
  // The axis words themselves, whatever their case: `Status` and `Stability` name the axis, and a
  // sentence naming the axis beside a call is naming what the call moves, not what it moves it to.
  if (AXIS_TOOL_ARGUMENTS.has(token.toLowerCase())) return true;
  if (always.has(token) || /^kiwi-[a-z-]+$/.test(token) || REQUIREMENT_ID.test(token)) return true;
  // `update-status` beside `update_status` is the CLI spelling of the same surface, and every
  // rendering's §13 table writes the two side by side.
  if (AXIS_CLI_ARGUMENTS.has(token) || AXIS_CLI_COMMANDS.includes(token)) return true;
  // Inside a code span that IS an invocation every token is part of a command line by construction,
  // so a subcommand name and a flag belong there and nowhere else in this reader.
  if (position === "invocation") return CLI_COMMAND_NAMES.has(token) || CLI_OPTION_NAMES.has(token) || MCP_ARGUMENT_NAMES.has(token);
  return false;
}

/** The hits the tool axis rejects: a value-shaped token beside a call that neither enum defines. */
function toolAxisViolations(files: string[]): ToolAxisHit[] {
  return toolAxisHits(files).filter((hit) => !toolAxisAllows(hit.token, hit.position));
}

/**
 * The tool axis run over one line of text rather than over the tree, so that what it REJECTS can be
 * asserted. A layer whose corpus is clean reports the same empty list whether it works or not; this
 * is what separates the two.
 *
 * The same reader the tree walk uses, not a second copy of it: the two used to be transcribed side
 * by side, which meant the probes could go on passing while the reader that walks the corpus had
 * drifted away from them.
 */
function toolAxisProbe(line: string): string[] {
  return axisPositions(line)
    .filter((hit) => !toolAxisAllows(hit.token, hit.position))
    .map((hit) => hit.token);
}

// ---------------------------------------------------------------------------------------------
// The SITE axis, which raises the observable from a count to a SET.
//
// The value census counts. A count is one integer per value per rendering, and an integer can be
// repaid: break one site and write the same word once more anywhere else in the same rendering and
// the number comes back. The 2026-08-26 judgement did exactly that six times — the compensating
// edit was a word added to a heading, which reads as nothing in review — and every one survived.
// Measured on the two sites it used, both sit in ONE file, so freezing per-file counts would have
// closed none of them; the resolution has to be finer than a file.
//
// So each occurrence is recorded as (value, file, the text around it) and the recorded set has to
// still be there. Moving a value now removes an entry and adds a different one, and the golden diff
// says which line lost it and which line gained it. Adding a site is allowed — prose that names a
// value correctly is not a defect, and refusing it would fail the ordinary act of writing a
// paragraph — so the relation is containment, not equality.
// ---------------------------------------------------------------------------------------------

/** Where each occurrence of each enum member stands, held as a set rather than counted. */
const VALUE_SITE_GOLDEN = "test/skills/status-enum-contract.value-sites.golden.md";

/**
 * How much of the surrounding line identifies a site. Line NUMBERS move whenever anything above
 * them is edited, and a hash of the whole line breaks on a typo fix half a paragraph away; the
 * text immediately around the value moves with the value and with nothing else. Thirty-two
 * characters on each side is enough to separate the sites this corpus actually has — the two the
 * compensation attack used differ four characters in — while leaving an edit at the far end of a
 * long table row alone.
 */
const SITE_CONTEXT = 32;

/** How many sites each rendering carries, so an emptied or truncated golden cannot read as clean. */
const VALUE_SITE_FLOOR: Record<string, number> = {
  "skills/claude": 595,
  "skills/codex": 593,
  "skills/etc": 560,
  ".agents/skills": 577
};

/** The text around one occurrence, normalised so that emphasis and re-wrapping are not a change. */
function siteFingerprint(text: string, word: Word): string {
  const from = Math.max(0, word.index - SITE_CONTEXT);
  const to = Math.min(text.length, word.index + word.token.length + SITE_CONTEXT);
  return text.slice(from, to).replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Every `value <tab> claim <tab> file <tab> fingerprint` of one rendering, sorted so the golden
 * groups by value and then by which dictionary entry speaks for the occurrence.
 *
 * EVERY occurrence is recorded, including the ones the homonym dictionary claims. That is the
 * change: the dictionary used to run BELOW this axis, so a line the dictionary claimed left no
 * trace here at all, and putting a wrong value on a line that happened to carry a trigger word made
 * the count, the census and this golden all agree that nothing had happened. Recording the claim
 * instead of honouring it keeps the occurrence in the diff and says who silenced it — so adding a
 * dictionary entry moves a line from the `-` group into that entry's group, which is a change a
 * reviewer reads, and a new line naming any value is an added line whatever the sentence says.
 */
function valueSitesOf(files: readonly string[], prefix: string): string[] {
  const out: string[] = [];
  for (const entry of lifecycleLines([...files])) {
    for (const site of entry.sites) {
      const shown = prefix !== "" && entry.file.startsWith(prefix) ? entry.file.slice(prefix.length) : entry.file;
      out.push(`${site.word.token}\t${site.claim}\t${shown}\t${siteFingerprint(entry.text, site.word)}`);
    }
  }
  return out.sort();
}

function valueSites(rendering: string): string[] {
  return valueSitesOf(corpusFiles(rendering), `${rendering}/`);
}

const VALUE_SITE_HEADER =
  "<!-- Generated. Regenerate with: UPDATE_VALUE_SITE_GOLDEN=1 npx vitest run test/skills/status-enum-contract.fr-flow-154.test.ts -->\n" +
  "<!-- One line per occurrence: value <tab> the homonym entry that speaks for it (`-` when none does) <tab> file <tab>\n" +
  "     the text around it. Sorted by value, so a value that MOVED shows as one deleted line and one added line inside\n" +
  "     the same block, and a value that was SILENCED shows as a move between the `-` group and an entry's group. -->";

/** The golden rendered from the tree as it stands. */
function renderValueSiteGolden(): string {
  const parts = [VALUE_SITE_HEADER];
  for (const rendering of RENDERINGS) parts.push(`## ${rendering}\n\n${valueSites(rendering).join("\n")}`);
  // The documents the manifest ships beside the renderings, recorded in the same file so that one
  // regeneration and one diff cover every place this package writes a lifecycle value.
  parts.push(`## ${PACKAGED_DOCUMENTS}\n\n${packagedDocumentSites().join("\n")}`);
  return `${parts.join("\n\n")}\n`;
}

/**
 * The golden as it stood when this file was loaded — BEFORE the regeneration test could rewrite it.
 *
 * The floor assertions report a number. A number does not say which place was lost, and the one
 * edit measured to trip a floor legitimately — splitting a sentence so the tool and the value land
 * in different clauses — leaves the golden regenerable and the floor short, so by the time the
 * failure is read the recorded set may already have absorbed the change. Vitest evaluates the
 * module body before it runs any test, so this snapshot is the PREVIOUS record even on the run that
 * regenerates, and the difference between it and the tree is the list of places to look at.
 */
const VALUE_SITE_GOLDEN_AT_LOAD = readVariant(VALUE_SITE_GOLDEN);

/** The golden's recorded sites, per rendering. */
function readValueSiteGolden(): Record<string, string[]> {
  return parseValueSiteGolden(readVariant(VALUE_SITE_GOLDEN));
}

function parseValueSiteGolden(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string | undefined;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^##\s+(\S+)\s*$/.exec(line);
    if (heading) {
      current = heading[1] as string;
      out[current] = [];
      continue;
    }
    if (current === undefined || line.trim() === "" || line.startsWith("<!--") || line.startsWith("  ")) continue;
    (out[current] as string[]).push(line);
  }
  return out;
}

/** The multiset difference `left \ right`, one entry per unmatched occurrence. */
function siteDifference(left: readonly string[], right: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const site of right) remaining.set(site, (remaining.get(site) ?? 0) + 1);
  const out: string[] = [];
  for (const site of left) {
    const count = remaining.get(site) ?? 0;
    if (count === 0) out.push(site);
    else remaining.set(site, count - 1);
  }
  return out;
}

/** Recorded sites that the tree no longer carries, with multiplicity — the value moved or vanished. */
function missingValueSites(rendering: string, recorded: readonly string[]): string[] {
  return siteDifference(recorded, valueSites(rendering));
}

/**
 * Whether a recorded fingerprint still shows a lifecycle surface.
 *
 * A fingerprint is 32 characters either side of the value with backticks and emphasis stripped, so
 * the axis reader cannot be re-run over it — the quoting it binds on is gone, and the window can cut
 * a tool name in half. This only ORDERS the lost sites in a failure message, so a name it misses
 * costs nothing: the site is still listed, one line further down.
 */
function fingerprintNamesACall(fingerprint: string): boolean {
  return [...AXIS_TOOLS, "speckiwi"].some((surface) => fingerprint.includes(surface));
}

/**
 * The places this rendering has LOST since the golden was last written, for a floor to point at.
 *
 * A floor reports a number, and a number does not say which position went missing. The site record
 * already carries (value, claimant, file, surrounding text) for every occurrence, so the sites that
 * were recorded and are no longer there ARE the edited places — and the ones whose text also names
 * a lifecycle surface are where a tool-axis position can have been lost. Read against the load-time
 * snapshot rather than the file on disk, so a run that regenerates the golden still reports against
 * the previous record.
 */
function lostSiteReport(rendering: string): string {
  const recorded = parseValueSiteGolden(VALUE_SITE_GOLDEN_AT_LOAD)[rendering] ?? [];
  const gone = siteDifference(recorded, valueSites(rendering));
  if (gone.length === 0) {
    return (
      `\n  No recorded site left ${rendering} since the golden was last written, so the position was lost` +
      ` inside a line whose values did not move — read \`git diff\` on ${VALUE_SITE_GOLDEN} and on the rendering.`
    );
  }
  // Sites whose recorded window still shows a lifecycle surface come first, because a tool-axis
  // position can only have been lost at one of those; the rest follow, since the window is finite.
  const ordered = [
    ...gone.filter((line) => fingerprintNamesACall(line.split("\t")[3] ?? "")),
    ...gone.filter((line) => !fingerprintNamesACall(line.split("\t")[3] ?? ""))
  ];
  return (
    `\n  ${gone.length} recorded site(s) left ${rendering} since the golden was last written` +
    ` — the position this floor lost is among them:\n    ${ordered.slice(0, 10).join("\n    ")}`
  );
}

/**
 * Sites the tree carries that the golden does not record — the other half of the equality.
 *
 * Containment was the choice this layer shipped with, and the reason given for it was sound on its
 * face: a paragraph that names a value CORRECTLY is not a defect, and refusing it would fail the
 * ordinary act of writing. But containment makes every ADDITION invisible, and addition is the
 * direction almost everything that survived six rounds of judgement travelled in — a wrong value
 * written into a sentence of its own (`Status 칸에 frozen 을 적는다`, a legitimate enum word on the
 * wrong axis, which no vocabulary check can call wrong), and the same recorded line copied once more
 * into the same file to repay a count that a mutation had taken away. Under containment both are
 * silent AND leave the golden byte-identical, so review has nothing to look at either.
 *
 * Under equality the machine still cannot judge that `Status 칸에 frozen` is wrong — nothing can,
 * from the shape of the sentence. What it can do is make that line appear in the golden diff, every
 * time, as an added line naming the value, the file and the text around it. The reviewable surface
 * becomes finite and complete: the diff of this one generated file IS the list of places the commit
 * newly wrote a lifecycle value.
 *
 * The cost is that writing such a sentence now takes a golden regeneration. Measured against this
 * session's own working tree, that is one command per commit that touches lifecycle prose.
 */
function unrecordedValueSites(rendering: string, recorded: readonly string[]): string[] {
  return siteDifference(valueSites(rendering), recorded);
}

/**
 * The site reader run over one line rather than over the tree, for the reason `toolAxisProbe` and
 * `nearMissProbe` exist: a layer whose corpus is clean reports the same empty list whether it works
 * or not. This one says, for each enum member the line names, which dictionary entry speaks for the
 * occurrence — `-` when none does, which is when the occurrence is recorded as a site of its own.
 */
function siteProbe(line: string): Array<[string, string]> {
  return wordsOf(line)
    .filter((word) => LIFECYCLE_VALUES.includes(word.token))
    .map((word) => [word.token, homonymFor(line, word)?.id ?? "-"] as [string, string]);
}

/**
 * Every occurrence in the shipped tree that a dictionary entry WOULD have claimed and the axis-field
 * scoping refuses it. The soundness counterpart of the liveness assertion: liveness asks whether an
 * entry still claims something, and this asks whether anything it claims stands where a wrong value
 * could stand. Measured at zero on the shipped tree, which is the claim — no homonym in this corpus
 * sits in the requirement's own Status or Stability field.
 */
function scopedOutHomonyms(): string[] {
  const out: string[] = [];
  for (const rendering of RENDERINGS) {
    for (const file of corpusFiles(rendering)) {
      const lines = readCorpus(file).replace(/\r\n/g, "\n").split("\n");
      lines.forEach((text, index) => {
        for (const word of wordsOf(text)) {
          if (!LIFECYCLE_VALUES.includes(word.token)) continue;
          const raw = rawHomonymFor(text, word);
          if (raw === undefined || homonymFor(text, word) !== undefined) continue;
          out.push(`${raw.id} silences \`${word.token}\` at ${file}:${index + 1}   ${text.trim().slice(0, 80)}`);
        }
      });
    }
  }
  return out;
}

/** The conflict branch, held byte for byte so that no rewrite of it can be silent. */
const CONFLICT_GOLDEN = "test/skills/status-enum-contract.conflict-branch.golden.md";

/** Every file under `rel` with the given extension, repo-relative and slash-separated. */
function filesUnder(rel: string, extension: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(extension)) out.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
    }
  };
  walk(path.join(REPO_ROOT, rel));
  return out.sort();
}

/** Every markdown file under `rel`, repo-relative and slash-separated. */
function markdownFiles(rel: string): string[] {
  return filesUnder(rel, ".md");
}

// ---------------------------------------------------------------------------------------------
// The CORPUS boundary, which decides WHICH FILES are read — by exclusion rather than by inclusion.
//
// Every layer above reads a file the walk handed it, and until now the walk handed it `.md` (plus
// `.mjs` for the one script reader). That made the boundary itself an inclusion test one level
// below the ones §3.3 diagnosed: a rendering ships `agents/openai.yaml` files whose `default_prompt`
// is read by the agent verbatim, and `default_prompt: "… call update_status with status: \"landed\""`
// passed every assertion in this file AND `skills mirror --check`, because no walk ever opened the
// file. Anchor, value and instruction were all present in the most explicit form there is; the file
// was not being looked at.
//
// So the walk takes EVERY file a rendering ships and the KIND list below is what has to be argued
// for. A kind with no reader throws rather than being skipped, which makes a new kind appearing in
// the tree a failure instead of a silence, and a file whose bytes do not parse throws for the same
// reason — quietly skipping an unparseable file is exactly the silence this layer removes.
// ---------------------------------------------------------------------------------------------

/**
 * The file kinds the shipped renderings carry, each with the reader that turns it into the text an
 * agent acts on. Frozen: a kind that appears in the tree without an entry here fails.
 */
const CORPUS_KINDS = [".json", ".md", ".mjs", ".yaml"] as const;

/**
 * Kinds deliberately left unread, with the reason. It is EMPTY, and that is the claim: every file
 * these renderings ship is read. The list exists so that an exclusion has to be written down and
 * defended rather than arising from a walk that only ever looked for one extension — and an entry
 * added here is asserted below to actually exclude a file, because an exclusion that excludes
 * nothing silences whatever grows into its shape next.
 */
const CORPUS_EXCLUDED_KINDS: ReadonlyArray<{ kind: string; why: string }> = [];

/** Every file of every kind a rendering ships, repo-relative and slash-separated. */
function corpusFiles(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
    }
  };
  walk(path.join(REPO_ROOT, rel));
  return out.sort().filter((file) => !CORPUS_EXCLUDED_KINDS.some((entry) => file.endsWith(entry.kind)));
}

/**
 * The string scalars of a YAML document, one per line.
 *
 * A hand-written reader rather than a parser, and a STRICT one: it accepts the two line shapes the
 * shipped agent manifests are written in and throws on anything else. That is the point — a YAML
 * file growing a construct this reader does not know is a file whose contents stop being read, and
 * a silent skip there is the failure this whole layer exists to remove. The throw names the line.
 */
function yamlStrings(file: string, raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim() === "") continue;
    // `interface:` — a mapping key opening a block, carrying no value of its own.
    if (/^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(line)) continue;
    // `  display_name: "Kiwi SRS"` — a double-quoted scalar under it.
    const pair = /^\s+[A-Za-z_][A-Za-z0-9_]*:\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (!pair) throw new Error(`${file}: this YAML line is outside every shape the corpus reader knows: ${line.trim()}`);
    out.push((pair[1] as string).replace(/\\(.)/g, "$1"));
  }
  return out;
}

/** Every string scalar of a JSON document, one per line. `JSON.parse` throws on malformed bytes. */
function jsonStrings(raw: string): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(JSON.parse(raw));
  return out;
}

/**
 * What an agent reads out of one shipped file. Markdown and the shipped scripts are their own text;
 * a structured file is reduced to the strings it carries, because that is the part an agent acts on
 * and reading the punctuation around it would report keys and syntax as values.
 */
function readCorpus(file: string): string {
  const raw = readVariant(file);
  if (file.endsWith(".md") || file.endsWith(".mjs")) return raw;
  if (file.endsWith(".yaml")) return yamlStrings(file, raw).join("\n");
  if (file.endsWith(".json")) return jsonStrings(raw).join("\n");
  throw new Error(`${file}: no corpus reader for this file kind — add one or exclude the kind with a reason`);
}

// ---------------------------------------------------------------------------------------------
// The corpus ROOTS, decided by the packaging manifest rather than by a list.
//
// `RENDERINGS` is derived — every directory under `skills/` — but that derivation STARTS from a
// directory somebody typed, and the file kinds inside it were inverted while the roots were not.
// `package.json`'s `files` is this repository's only statement of what the published package
// actually contains, and it names two documents no rendering carries:
// `docs/rule/SRS-MD-Rules-v2.5.0.md` and `docs/rule/SDS-MD-Rules-v2.5.0.md`. The first names
// lifecycle values on 85 lines, this repository's own CLAUDE.md instructs agents to read it, and
// `speckiwi init` installs it into a consumer repository — where it reads as the authoritative
// statement of the enum. No walk opened either of them, so `Status 칸에는 frozen 을 적는다` and
// `` `update_status` 로 REQ 를 `landed` 로 `` planted in the rules document passed every assertion
// in this file: the `agents/openai.yaml` defect one level further out again.
//
// So the roots come out of the manifest. A packaged path this sweep does not read has to be named
// in `PACKAGED_UNREAD` with a reason, and each reason is CHECKED below rather than believed.
// ---------------------------------------------------------------------------------------------

/** What the published tarball contains, read from the manifest rather than transcribed. */
const PACKAGED_ROOTS: readonly string[] = [
  ...((JSON.parse(readVariant("package.json")) as { files?: string[] }).files ?? [])
].sort();

/**
 * The packaged paths the document sweep does not read, each with the reason.
 *
 * Unlike `CORPUS_EXCLUDED_KINDS` this list is NOT empty, because the manifest ships build output
 * and a launcher beside the prose. Both reasons are asserted rather than stated: `bin` is checked
 * to name no axis word and no lifecycle value, and `dist` is checked to be generated rather than
 * authored. An exclusion that outlived its reason is the shape every other exemption in this file
 * is guarded against.
 */
const PACKAGED_UNREAD: ReadonlyArray<{ root: string; why: string }> = [
  {
    root: "bin",
    why: "the launcher: it imports dist/cli/index.js and sets an exit code. It names no axis word and no lifecycle value, which is asserted below."
  },
  {
    root: "dist",
    why: "compiled from src/ by `npm run build` and gitignored, so it is generated rather than authored. The copies of this contract that live in src/ are already derived by contractSourceSites() and frozen by CONTRACT_SOURCE_INVENTORY; reading dist would report each of them a second time in transpiled form."
  }
];

/** The packaged roots the rendering sweep already reads, so the document sweep does not read them twice. */
function packagedRenderingRoots(): string[] {
  return PACKAGED_ROOTS.filter((root) => (RENDERINGS as readonly string[]).includes(root));
}

/** Every file under one packaged root, repo-relative and slash-separated. A root may be one file. */
function filesUnderRoot(root: string): string[] {
  const full = path.join(REPO_ROOT, root);
  if (!statSync(full).isDirectory()) return [root];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const child = path.join(dir, entry);
      if (statSync(child).isDirectory()) walk(child);
      else out.push(path.relative(REPO_ROOT, child).split(path.sep).join("/"));
    }
  };
  walk(full);
  return out.sort();
}

/**
 * Every file the manifest ships that no rendering carries and no exclusion names — the shipped
 * DOCUMENTS. Read with the same readers the renderings use, so a kind with no reader throws here
 * for the same reason it throws there.
 */
function shippedDocumentFiles(): string[] {
  const skipped = new Set<string>([...packagedRenderingRoots(), ...PACKAGED_UNREAD.map((entry) => entry.root)]);
  return PACKAGED_ROOTS.filter((root) => !skipped.has(root))
    .flatMap(filesUnderRoot)
    .sort();
}

/** The golden block the shipped documents are recorded under, beside the four renderings. */
const PACKAGED_DOCUMENTS = "packaged-documents";

/** Where each lifecycle value stands in the shipped documents, recorded the way a rendering's sites are. */
function packagedDocumentSites(): string[] {
  return valueSitesOf(shippedDocumentFiles(), "");
}

/** How many sites the shipped documents carry, measured. An emptied block cannot read as clean. */
const PACKAGED_DOCUMENT_SITE_FLOOR = 143;

/** How many lines of the SRS rules document name a lifecycle value, measured. */
const PACKAGED_RULES_LINE_FLOOR = 101;

// ---------------------------------------------------------------------------------------------
// The FOURTH copy — the contract as it lives in this package's own code.
//
// `RENDERINGS` used to be a literal list of three directories and a mirror, which made the question
// "where does contract-carrying text live" an inclusion test one level above the corpus boundary:
// the answer was whatever someone had typed. The list is now read off the disk, and this is the
// other half of that inversion. `speckiwi init` writes an agent instruction block into a consumer
// repository's CLAUDE.md and AGENTS.md, and that block names `Stability=draft`,
// `Stability=deprecated`, `status=in_progress`, `status=blocked`, `status=implemented` and
// `verified`. It is a copy of this contract that no rendering carries and no walk over `skills/`
// opens — the same shape as the `agents/openai.yaml` defect, one level further out.
//
// Two things follow. The rendered block is swept by the value layers, because it is agent-facing
// text this package ships. And "where a copy lives" is DERIVED: any string literal in `src/` long
// enough to be prose, naming an axis word and naming a lifecycle value, is a copy — so a fifth one
// written into a new file fails the inventory below instead of joining the three unremarked.
// ---------------------------------------------------------------------------------------------

/** The block `speckiwi init` writes into a consumer's CLAUDE.md / AGENTS.md, rendered rather than transcribed. */
const AGENT_INSTRUCTION_TEXT = renderAgentInstructionSnippet();

/** Every `.ts` file under `src/`, repo-relative and slash-separated. */
function sourceFiles(): string[] {
  return filesUnder("src", ".ts");
}

/** A string literal long enough to be prose. Below this the matches are identifiers and format strings. */
const CONTRACT_STRING_FLOOR = 40;

/** The axis words a copy of this contract has to name to be one. */
const CONTRACT_AXIS_WORD = /(?:^|[^A-Za-z0-9_-])(?:Status|Stability|update_status|update_stability)(?![A-Za-z0-9_-])/;

interface ContractSite {
  file: string;
  line: number;
  text: string;
}

/**
 * Every place in this package's code that carries agent-facing text naming both an axis and a
 * lifecycle value. Derived, so a new copy appears here the day it is written; the inventory is
 * frozen below, so appearing here is a failure that has to be read rather than a silent fourth copy.
 */
function contractSourceSites(): ContractSite[] {
  const found: ContractSite[] = [];
  const namesAValue = new RegExp(`(?:^|[^A-Za-z0-9_-])(?:${LIFECYCLE_VALUES.join("|")})(?![A-Za-z0-9_-])`);
  for (const file of sourceFiles()) {
    readVariant(file)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .forEach((line, index) => {
        for (const match of line.matchAll(new RegExp(`"((?:[^"\\\\]|\\\\.){${CONTRACT_STRING_FLOOR},})"`, "g"))) {
          const text = (match[1] as string).replace(/\\(.)/g, "$1");
          if (!CONTRACT_AXIS_WORD.test(text) || !namesAValue.test(text)) continue;
          found.push({ file, line: index + 1, text });
        }
      });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// The one exemption this inventory grants, and why it is a comparison rather than a permission.
//
// FR-MCP-060 gave every MCP tool a description, and five of those descriptions are string literals
// long enough to be prose that name an axis and a lifecycle value — so the derivation above reports
// five new copies of this contract in `src/mcp/schemas.ts`. Two of them restate an ENUM IN FULL,
// because an agent choosing a value learns that vocabulary from the description and nowhere else:
// `update_status` presents `REQUIREMENT_STATUSES` and `update_stability` presents
// `STABILITY_LEVELS`.
//
// What this requirement is against is a copy NOTHING CHECKS, because that is a place the contract
// can drift unobserved. These two are checked in both directions — FR-MCP-060 AC-8 holds each
// presented list against the runtime constant that tool's own guard decides by — and the exemption
// below makes THE SAME COMPARISON HERE rather than pointing at the requirement that makes it
// elsewhere, so the excuse does not rest on another file's assertions still running. A description
// that drops its list, invents a value or withholds one stops being exempt on the spot and lands
// back in the frozen inventory.
//
// The other three — `edit_requirement_fields`, `replace_acceptance_criteria` and
// `edit_requirement_table_rows` — name one value inside a guard clause (`refused while the
// requirement's Status is verified`). They present no list, so nothing pins them and nothing
// excuses them: they are frozen in the inventory like every other copy.
// ---------------------------------------------------------------------------------------------

/** Every MCP tool description this package ships, by tool name, rendered rather than transcribed. */
const TOOL_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(Object.entries(renderToolDescriptions()));

/**
 * The values a description presents: the first em-dash-delimited run, comma- or `or`-separated.
 *
 * That presentation is a contract FR-MCP-060 AC-8 states, and this is its reading side — so a run
 * that stopped being findable reads as "presents nothing" here for the same reason it does there,
 * and a description with no run at all is never excused.
 */
function presentedValues(description: string): string[] {
  const run = /\s—\s([^—]+)\s—\s/.exec(description);
  if (!run) return [];
  return (run[1] as string)
    .split(/,|\bor\b/)
    .map((token) => token.replace(/[`.]/g, "").trim())
    .filter((token) => /^[a-z][a-z_]*$/.test(token));
}

/**
 * A contract-carrying literal, with the MCP tool it is the shipped description OF when it is one.
 *
 * The tool arrives as its own field rather than being recovered inside the rule, so a constructed
 * sample can reach the comparison. Recovered by text equality inside the rule, every mutation of a
 * description would fall out on the lookup instead — the rule would answer "not excused" without
 * ever comparing anything, and a soundness check written against it would prove nothing.
 */
interface DescribedLiteral {
  /** The MCP tool this literal is the shipped description of, or `null` when it is not one. */
  tool: string | null;
  text: string;
}

interface ContractExemption {
  /** Named so a failure, the frozen roster and the report all say the same thing. */
  id: string;
  why: string;
  /** The name this entry excuses the literal under, or `null` when it does not speak for it. */
  claims: (literal: DescribedLiteral) => string | null;
}

const CONTRACT_SOURCE_EXEMPTIONS: readonly ContractExemption[] = [
  {
    id: "mcp-description-pinned-enum",
    why: "an MCP tool description whose presented list equals, in both directions, one of the two enums this file is written about. FR-MCP-060 AC-8 holds the same list against the same constant from the other side.",
    claims: ({ tool, text }) => {
      if (tool === null) return null;
      const presented = presentedValues(text);
      if (presented.length === 0) return null;
      const pinned = [REQUIREMENT_STATUSES, STABILITY_LEVELS].some(
        (values) =>
          values.length === presented.length && (values as readonly string[]).every((value) => presented.includes(value))
      );
      return pinned ? tool : null;
    }
  }
];

/**
 * The copies the exemptions excuse today, frozen by the name they are excused under.
 *
 * Liveness alone would leave the rule excusing whatever grows into its shape: a third description
 * that began restating an enum would be waved through in silence, which is exactly the unobserved
 * copy this requirement exists to prevent. Both of these are among the five tools FR-MCP-060 AC-8
 * names, and they are the only two of the five whose description presents a list at all.
 */
const CONTRACT_SOURCE_EXEMPT_TOOLS = ["update_stability", "update_status"] as const;

interface ExemptedSite extends ContractSite {
  /** The exemption that spoke for this site, and the name it spoke under. Both `null` when none did. */
  exemption: string | null;
  claimedAs: string | null;
}

/** Every derived site, paired with the exemption that speaks for it. */
function contractSourceSitesWithExemption(): ExemptedSite[] {
  return contractSourceSites().map((site) => {
    const literal: DescribedLiteral = { tool: describedTool(site.text), text: site.text };
    for (const exemption of CONTRACT_SOURCE_EXEMPTIONS) {
      const claimedAs = exemption.claims(literal);
      if (claimedAs !== null) return { ...site, exemption: exemption.id, claimedAs };
    }
    return { ...site, exemption: null, claimedAs: null };
  });
}

/** The tool whose shipped description this literal IS, or `null` when the literal is not one. */
function describedTool(text: string): string | null {
  for (const [tool, description] of TOOL_DESCRIPTIONS) if (description === text) return tool;
  return null;
}

/**
 * How many contract-carrying string literals each source file holds that no exemption speaks for,
 * measured. The three `src/mcp/schemas.ts` rows are the guard-clause descriptions named above;
 * the two pinned ones are excused by `mcp-description-pinned-enum` and counted by its own roster.
 */
const CONTRACT_SOURCE_INVENTORY: Record<string, number> = {
  "src/core/bootstrap/templates.ts": 2,
  "src/core/diagnostic-registry.ts": 1,
  "src/mcp/schemas.ts": 3
};

/** How many files of each kind a rendering ships, measured. A kind that vanished is a defect. */
const CORPUS_KIND_FLOOR: Record<string, Record<string, number>> = {
  "skills/claude": { ".md": 29, ".mjs": 1 },
  "skills/codex": { ".md": 42, ".mjs": 1, ".yaml": 13 },
  "skills/etc": { ".md": 43, ".mjs": 1 },
  ".agents/skills": { ".json": 15, ".md": 39, ".mjs": 1, ".yaml": 13 }
};

/** The skill directory names a rendering ships, read from disk. */
function skillDirectories(rendering: string): string[] {
  const base = path.join(REPO_ROOT, rendering);
  return readdirSync(base)
    .filter((entry) => statSync(path.join(base, entry)).isDirectory())
    .sort();
}

/** The skill directories `rendering` is expected to carry. */
function expectedSkills(rendering: string): string[] {
  const excluded = new Set<string>(rendering === ".agents/skills" ? MIRROR_EXCLUDED : []);
  return SKILL_DIRECTORIES.filter((skill) => !excluded.has(skill));
}

interface Slot {
  file: string;
  slot: string;
  token: string;
  line: number;
  excerpt: string;
}

function collectSlots(files: string[], patterns: Array<[string, RegExp]>): Slot[] {
  return collectSlotsInText(
    files.map((file) => ({ file, text: readCorpus(file) })),
    patterns
  );
}

/** The slot scan over text that is already in hand, so a corpus that is not a file can be swept too. */
function collectSlotsInText(entries: Array<{ file: string; text: string }>, patterns: Array<[string, RegExp]>): Slot[] {
  const slots: Slot[] = [];
  for (const { file, text } of entries) {
    for (const [slot, pattern] of patterns) {
      const scan = new RegExp(pattern.source, pattern.flags);
      for (let match = scan.exec(text); match; match = scan.exec(text)) {
        const tokens = match
          .slice(1)
          .filter(Boolean)
          // `:` and the newline split a captured snapshot body into its `"REQ-ID": "value"` parts;
          // the id half fails the lowercase token test below and drops out.
          .flatMap((group) => group.split(/[,|/\n:]/))
          .map((token) => token.replace(/[`"'\s]/g, ""))
          .filter((token) => new RegExp(`^${VALUE}$`).test(token) && !NOT_A_VALUE.has(token))
          .filter((token) => !REQUIREMENT_ID.test(token));
        for (const token of tokens) {
          slots.push({
            file,
            slot,
            token,
            line: text.slice(0, match.index).split("\n").length,
            excerpt: match[0].trim().replace(/\s+/g, " ").slice(0, 90)
          });
        }
      }
    }
  }
  return slots;
}

const describeSlot = (found: Slot): string => `${found.file}:${found.line} [${found.slot}] -> ${found.token}   ${found.excerpt}`;

/** The members of `NOT_A_VALUE` that no slot capture in the shipped tree actually hands it. */
function notAValueHits(): string[] {
  const silenced = new Set<string>();
  for (const rendering of RENDERINGS) {
    for (const file of corpusFiles(rendering)) {
      const text = readCorpus(file);
      for (const [, pattern] of [...STATUS_SLOTS, ...STABILITY_SLOTS]) {
        const scan = new RegExp(pattern.source, pattern.flags);
        for (let match = scan.exec(text); match; match = scan.exec(text)) {
          for (const group of match.slice(1).filter(Boolean)) {
            for (const raw of (group as string).split(/[,|/\n:]/)) {
              const token = raw.replace(/[`"'\s]/g, "");
              if (NOT_A_VALUE.has(token)) silenced.add(token);
            }
          }
        }
      }
    }
  }
  return [...NOT_A_VALUE].filter((token) => !silenced.has(token));
}

function countBySlot(files: string[], patterns: Array<[string, RegExp]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [name] of patterns) counts[name] = 0;
  for (const found of collectSlots(files, patterns)) counts[found.slot] = (counts[found.slot] ?? 0) + 1;
  return counts;
}

/** The `|`-separated cells of one markdown table row. */
function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

interface DecisionRow {
  file: string;
  line: number;
  headers: string[];
  cells: string[];
}

/**
 * Every body row of every table that names one of the two axes in a column header. A table that
 * decides a requirement's status or stability binds every predicate in it to that requirement, so
 * these rows are read on both axes — the axis-named column for the value the table DECIDES, and any
 * cell for the predicate the table decides ON.
 */
function decisionRows(files: string[]): DecisionRow[] {
  const rows: DecisionRow[] = [];
  const axes = [AXIS_COLUMN_HEADER("status"), AXIS_COLUMN_HEADER("stability")];
  for (const file of files) {
    const lines = readCorpus(file).replace(/\r\n/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^\s*\|/.test(lines[index] as string)) continue;
      const start = index;
      while (index < lines.length && /^\s*\|/.test(lines[index] as string)) index += 1;
      const block = lines.slice(start, index);
      if (block.length < 3 || !/^\|[\s:|-]+\|?\s*$/.test((block[1] as string).trim())) continue;
      const headers = tableCells(block[0] as string);
      if (!headers.some((cell) => axes.some((axis) => axis.test(cell)))) continue;
      for (let row = 2; row < block.length; row += 1) {
        rows.push({ file, line: start + row + 1, headers, cells: tableCells(block[row] as string) });
      }
    }
  }
  return rows;
}

/** The backticked tokens of the column `axis` names, across every decision table. */
function decisionColumnSlots(rows: DecisionRow[], axis: "status" | "stability"): Slot[] {
  const header = AXIS_COLUMN_HEADER(axis);
  const found: Slot[] = [];
  for (const row of rows) {
    for (const [index, name] of row.headers.entries()) {
      if (!header.test(name)) continue;
      const cell = row.cells[index];
      if (cell === undefined) continue;
      for (const match of cell.matchAll(new RegExp(`\`(${VALUE})\``, "g"))) {
        found.push({ file: row.file, slot: `${axis}-decision-column`, token: match[1] as string, line: row.line, excerpt: cell.slice(0, 90) });
      }
    }
  }
  return found;
}

/** `status ∈ {in_progress, implemented, verified}` written in any cell of a decision table. */
function decisionPredicateSlots(rows: DecisionRow[]): Slot[] {
  const found: Slot[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      for (const match of cell.matchAll(new RegExp(`\\bstatus\\s*(?:∈\\s*\\{([^}]*)\\}|[:=]\\s*\`?(${VALUE})\`?)`, "g"))) {
        for (const token of (match[1] ?? match[2] ?? "").split(",").map((value) => value.replace(/[`\s]/g, ""))) {
          if (token && !NOT_A_VALUE.has(token)) {
            found.push({ file: row.file, slot: "status-decision-predicate", token, line: row.line, excerpt: cell.slice(0, 90) });
          }
        }
      }
    }
  }
  return found;
}

const INDENT = (line: string): number => ((/^(\s*)/.exec(line) as RegExpExecArray)[1] as string).length;

/**
 * Values named by a rule bullet inside a block whose OPENING line names the axis. `3. update_status`
 * is followed by four `- 조건 → "value"` rules that dictate exactly what the call is sent, and
 * `- REQ 를 Stability 별로 분류:` by three `- \`value\` → 처분` bullets that decide who enters a plan.
 * Neither shape puts the axis word on the same line as the value, so every line-shaped slot walks
 * past both. The opener must be a list item, not a table row: `| Status 변경 | \`update_status\` |`
 * names the tool inside a table and opens no block.
 */
function axisBlockSlots(files: string[], axis: "status" | "stability"): Slot[] {
  const opener =
    axis === "status"
      ? /^\s*(?:\d+\.|[-*])\s+[^|]*\bupdate_status\b/
      : /^\s*(?:\d+\.|[-*])\s+[^|]*(?:\bupdate_stability\b|[Ss]tability 별로 분류)/;
  const leadingValue = new RegExp(`^\\s*[-*]\\s*${QUOTE}(${VALUE}(?:\\|${VALUE})*)${QUOTE}\\s*(?:→|->)`);
  const trailingValue = new RegExp(`(?:→|->)\\s*${QUOTE}(${VALUE})`, "g");
  const found: Slot[] = [];
  for (const file of files) {
    const lines = readCorpus(file).replace(/\r\n/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!opener.test(lines[index] as string)) continue;
      const base = INDENT(lines[index] as string);
      for (let row = index + 1; row < lines.length; row += 1) {
        const line = lines[row] as string;
        if (line.trim() === "" || INDENT(line) <= base) break;
        // The value sits on whichever side of the arrow the bullet puts it: `- 조건 → "value"`
        // names it on the right, `- \`value\` → 처분` on the left.
        const leading = leadingValue.exec(line);
        const tokens = leading
          ? ((leading[1] as string).split("|") as string[])
          : [...line.matchAll(trailingValue)].map((match) => match[1] as string);
        for (const token of tokens) {
          found.push({ file, slot: `${axis}-rule-bullet`, token, line: row + 1, excerpt: line.trim().slice(0, 90) });
        }
      }
    }
  }
  return found;
}

/**
 * `| From | To | 조건 |` — a transition table, grouped one entry per table. Its header names a
 * direction, not an axis, and its cells carry no axis word either, so nothing else reads it. One
 * table names ONE axis: a table mixing the two enums is the axis swap this requirement closes,
 * written as a table rather than as a sentence.
 */
function transitionTables(files: string[]): Array<{ key: string; slots: Slot[] }> {
  const tables: Array<{ key: string; slots: Slot[] }> = [];
  for (const file of files) {
    const lines = readCorpus(file).replace(/\r\n/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^\s*\|/.test(lines[index] as string)) continue;
      const start = index;
      while (index < lines.length && /^\s*\|/.test(lines[index] as string)) index += 1;
      const block = lines.slice(start, index);
      if (block.length < 3 || !/^\|[\s:|-]+\|?\s*$/.test((block[1] as string).trim())) continue;
      const headers = tableCells(block[0] as string);
      if (headers[0] !== "From" || headers[1] !== "To") continue;
      const slots: Slot[] = [];
      for (let row = 2; row < block.length; row += 1) {
        const cells = tableCells(block[row] as string);
        for (const column of [0, 1]) {
          for (const match of (cells[column] ?? "").matchAll(new RegExp(`\`(${VALUE})\``, "g"))) {
            slots.push({
              file,
              slot: "transition-table",
              token: match[1] as string,
              line: start + row + 1,
              excerpt: (cells[column] as string).slice(0, 90)
            });
          }
        }
      }
      tables.push({ key: `${file}:${start + 1}`, slots });
    }
  }
  return tables;
}

/** The stability values a rendering's shipped scripts compare against, as executable literals. */
function scriptStabilitySlots(rendering: string): Slot[] {
  const found: Slot[] = [];
  for (const file of filesUnder(rendering, ".mjs")) {
    const text = readCorpus(file);
    const scan = /\.stability\b[^\n]{0,60}?['"]([a-z_]+)['"]/g;
    for (let match = scan.exec(text); match; match = scan.exec(text)) {
      found.push({
        file,
        slot: "script-stability-literal",
        token: match[1] as string,
        line: text.slice(0, match.index).split("\n").length,
        excerpt: match[0].trim().replace(/\s+/g, " ").slice(0, 90)
      });
    }
  }
  return found;
}

interface Word {
  token: string;
  index: number;
}

/** One occurrence of an enum member, with the dictionary entry that speaks for it — `-` when none does. */
interface ValueSite {
  word: Word;
  claim: string;
}

interface LifecycleLine {
  file: string;
  line: number;
  text: string;
  /** Every word on the line, so the near-miss reader sees the same line the census counted. */
  words: Word[];
  /** The enum members the line names that the dictionary did not claim. */
  values: Word[];
  /**
   * EVERY enum member the line names, claimed or not. The census reads `values`; the site golden
   * reads this. A dictionary entry therefore changes what the golden SAYS about a site rather than
   * removing the site from it, which is what makes widening the dictionary a diff a reviewer sees.
   */
  sites: ValueSite[];
}

/** Every `[A-Za-z][A-Za-z0-9_-]*` run of a line. Hyphen and underscore are part of the word, so
 *  `already-implemented`, `draft-stability-skip` and `lifecycle-gate-evolving` are single tokens
 *  that name no enum member and never enter the sweep — 31 of the 419 measured lines leave this
 *  way, without costing the dictionary an entry. */
function wordsOf(line: string): Word[] {
  return [...line.matchAll(new RegExp(TOKEN, "g"))].map((match) => ({ token: match[0], index: match.index as number }));
}

/**
 * The requirement's OWN metadata field, naming a value that follows it.
 *
 * Capitalised on purpose. `Status` and `Stability` written that way are the field names of an SRS
 * requirement block; the lowercase `status` is shared with the lane, journal, report and plan-Task
 * machines, which is why every reader in this file that binds on the lowercase word has to bind it
 * to a requirement first. Two shapes: the field followed by the noun that names the cell
 * (`Status 칸`, `Stability 란`), and the field bound straight to what follows it (`Status 는`,
 * `Stability =`).
 */
const AXIS_FIELD_ASSIGNMENT =
  /(?:^|[^A-Za-z0-9_-])(?:Status|Stability)\s*(?:(?:칸|란|필드|행)\s*(?:에는|엔|에|은|는|이|가|을|를)?|(?:에는|엔|에|은|는|이|가|을|를|=|:))/g;

/** How far past that field a value still belongs to it, measured on the shapes this corpus writes. */
const AXIS_FIELD_REACH = 24;

/**
 * Whether `word` stands as the value of the requirement's own Status or Stability field.
 *
 * Forward only: the field has to be named BEFORE the value for the value to be the one it assigns.
 * `- **Status 변경 권한 없음** … feasibility=blocked 라도 Status 는 그대로 두고` names `blocked` as a
 * feasibility label and names `Status` twice around it, and reading either mention backwards would
 * call that line an assignment. It is the one line in the shipped corpus that separates the two
 * readings, and it is why the reach runs one way.
 */
function inAxisFieldAssignment(line: string, word: Word): boolean {
  for (const match of line.matchAll(AXIS_FIELD_ASSIGNMENT)) {
    const end = (match.index as number) + match[0].length;
    if (end <= word.index && word.index - end <= AXIS_FIELD_REACH) return true;
  }
  return false;
}

/**
 * The dictionary entry that claims this occurrence, if any.
 *
 * The dictionary is the one exclusion this file applies BELOW the axes: the value census and the
 * site golden both reach a value through here, so an entry that speaks silences two axes at once.
 * Every entry was checked for LIVENESS — that it still claims something — and none for SOUNDNESS —
 * that the context it silences cannot host a wrong value. It could: `- 신규 REQ 의 Status 칸에는
 * draft 로 생성한다고 적는다` puts a stability word in the Status field, and `pr-draft-flag-ko`
 * (`draft 로 생성`) claimed it, so neither the count nor the recorded site moved. Seven of the eleven
 * values had a rule that did this.
 *
 * So the dictionary does not speak where the requirement's own field is assigning the value. A
 * homonym claim says "another machine owns this word here", and no machine other than the
 * requirement lifecycle owns the word written into `Status 칸` — whatever else the sentence says
 * around it. Measured across all four renderings this takes NO occurrence away from any entry.
 */
function homonymFor(line: string, word: Word): Homonym | undefined {
  if (inAxisFieldAssignment(line, word)) return undefined;
  return rawHomonymFor(line, word);
}

/** The dictionary matched with no scoping at all, so that what the scoping REFUSES can be asserted. */
function rawHomonymFor(line: string, word: Word): Homonym | undefined {
  const frame = `${line.slice(0, word.index)}\0${line.slice(word.index + word.token.length)}`;
  return HOMONYM_DICTIONARY.find((entry) => (entry.value === null || entry.value === word.token) && entry.at.test(frame));
}

const lifecycleCache = new Map<string, LifecycleLine[]>();

/**
 * Every line of `files` that still names a lifecycle value once the dictionary has taken its
 * homonyms out. No sentence shape is required: a line qualifies by naming a value, and that is the
 * whole membership test.
 */
function lifecycleLines(files: string[]): LifecycleLine[] {
  const cacheKey = files.join("\n");
  const cached = lifecycleCache.get(cacheKey);
  if (cached) return cached;
  const out: LifecycleLine[] = [];
  for (const file of files) {
    const lines = readCorpus(file).replace(/\r\n/g, "\n").split("\n");
    lines.forEach((text, index) => {
      const words = wordsOf(text);
      const sites = words
        .filter((word) => LIFECYCLE_VALUES.includes(word.token))
        .map((word) => ({ word, claim: homonymFor(text, word)?.id ?? "-" }));
      if (sites.length === 0) return;
      const values = sites.filter((site) => site.claim === "-").map((site) => site.word);
      out.push({ file, line: index + 1, text, words, values, sites });
    });
  }
  lifecycleCache.set(cacheKey, out);
  return out;
}

/**
 * The `STATUS_ORDER = [...]` ladders the shipped text writes, as ordered lists. The slot scan reads
 * the ladder as a SET — every token is checked for membership and nothing asks what order they came
 * in — so reversing the four entries leaves every value inside the enum and every count unchanged
 * while turning `kiwi-pm`'s forward-only rule into a licence for backward transitions. The code
 * constant already carries the order; this reads it back out.
 */
function statusOrderLadders(files: string[]): Array<{ file: string; line: number; values: string[] }> {
  const ladders: Array<{ file: string; line: number; values: string[] }> = [];
  const pattern = STATUS_SLOTS.find(([name]) => name === "status-order-ladder");
  expect(pattern, "the status-order-ladder slot must exist for its order to be read").toBeDefined();
  for (const file of files) {
    const text = readCorpus(file);
    const scan = new RegExp((pattern as [string, RegExp])[1].source, "g");
    for (let match = scan.exec(text); match; match = scan.exec(text)) {
      const values = (match[1] as string)
        .split(",")
        .map((token) => token.replace(/[`"'\s]/g, ""))
        .filter((token) => (REQUIREMENT_STATUSES as readonly string[]).includes(token));
      ladders.push({ file, line: text.slice(0, match.index).split("\n").length, values });
    }
  }
  return ladders;
}

/** Levenshtein distance, used only to decide whether a word is a misspelling of an enum member. */
function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (previous[column] as number) + 1,
        (current[column - 1] as number) + 1,
        (previous[column - 1] as number) + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length] as number;
}

/** A word that reads as an enum member spelled wrong. `in-progress` for `in_progress` is one edit. */
function isNearMiss(token: string): boolean {
  return token.length >= 5 && !LIFECYCLE_VALUES.includes(token) && LIFECYCLE_VALUES.some((value) => editDistance(token, value) <= 2);
}

/**
 * The words that make a token beside them a VALUE rather than a word: the two axis names, the
 * requirement, and the tools that carry a lifecycle argument.
 */
const NEAR_MISS_ANCHOR = new RegExp(`\\b(?:[Ss]tatus|[Ss]tability|REQ|${AXIS_TOOLS.join("|")})\\b`);

/** How far in front of a token an anchor still binds it, measured on the shapes this corpus writes. */
const NEAR_MISS_REACH = 24;

/**
 * How far BEHIND a token an anchor still binds it.
 *
 * Korean puts the object before the verb, so `plannd 를 REQ 의 Status 에 적는다` names the axis AFTER
 * the value it is naming — and a forward-only reader walks straight past it while reading the same
 * sentence written the other way round. The tool axis was made bidirectional for exactly this reason
 * last round and this layer was not, which is the defect AC-6 exists to prevent happening inside one
 * file: a repair that leaves its mirror standing.
 *
 * Sixteen, not twenty-four. Measured over all four renderings the backward direction costs NOTHING
 * at sixteen — no line in the shipped tree gains a hit — while at twenty-four it reports three
 * ordinary English words (`landed` in `landed 하지 않은 요구는 현재 status`, `verifies` in
 * `` `addition_site` → `verifies` 로 trace 갱신 → status 승급 ``, `implements` in a frontmatter
 * description) whose only way out would be the near-miss allow list, and `landed` sitting in that
 * list with nothing to claim is the exact defect AC-9 was rewritten to remove. A reach that has to
 * be paid for with an exemption is the wrong reach.
 */
const NEAR_MISS_BACK_REACH = 16;

/**
 * What has to bind a token before an anchor BEHIND it counts — the tool axis's own rule, which it
 * states as "behind the anchor only a particle or an arrow binds". The text before an axis word is
 * also where ordinary English sits: `Requirement Block status` puts a capitalised English noun two
 * edits from `blocked` directly in front of the axis word, and reading every such token reports it.
 * A particle or an arrow is what a sentence puts after a VALUE, and it is what the attack this
 * direction exists to catch has: `plannd 를 REQ 의 Status 에 적는다`. One Korean noun may stand
 * between the two — `plannd 값을 REQ 의 Status 에 적는다` binds the value through 값, the same way the
 * tool axis reads `landed 상태로` through 상태 — and the noun is what the first version of this
 * binder walked past.
 */
const NEAR_MISS_BACK_BINDING = new RegExp(`^[\`"'*]{0,2}\\s?(?:[가-힣]{1,3})?(?:${VALUE_PARTICLE}|→|->)`);

/**
 * Whether `word` stands where a value goes: within `NEAR_MISS_REACH` characters after an axis word,
 * or bound as a value within `NEAR_MISS_BACK_REACH` characters before one.
 *
 * This is what separates a misspelled value from an English word that happens to be one edit from
 * one. `table` is one edit from `stable`, and writing 표 as `table` is ordinary — so `table` is not
 * put on an allow list, where it would also hide a real misspelling of `stable`; instead it is not
 * read at all unless it stands somewhere a value would.
 */
function inValuePosition(text: string, word: Word): boolean {
  const reach = text.slice(Math.max(0, word.index - NEAR_MISS_REACH), word.index);
  const behind = lastAnchorIn(reach);
  if (behind !== -1 && (!reach.slice(behind).includes("|") || fillsItsCell(text, word) || boundAsAValue(text, word))) return true;
  const after = text.slice(word.index + word.token.length, word.index + word.token.length + NEAR_MISS_BACK_REACH);
  if (!NEAR_MISS_BACK_BINDING.test(after) || !NEAR_MISS_ANCHOR.test(after)) return false;
  const gap = after.slice(0, after.search(NEAR_MISS_ANCHOR));
  return !gap.includes("|") || fillsItsCell(text, word);
}

/** Whether something INSIDE the token's own cell binds it as a value — a particle, an arrow, a quote. */
function boundAsAValue(text: string, word: Word): boolean {
  const after = text.slice(word.index + word.token.length, word.index + word.token.length + NEAR_MISS_BACK_REACH);
  const edge = after.indexOf("|");
  return NEAR_MISS_BACK_BINDING.test(edge === -1 ? after : after.slice(0, edge));
}

/** Where the NEAREST axis word behind the token starts, or -1. Only the gap it leaves is examined. */
function lastAnchorIn(reach: string): number {
  const scan = new RegExp(NEAR_MISS_ANCHOR.source, "g");
  let last = -1;
  for (let match = scan.exec(reach); match; match = scan.exec(reach)) last = match.index;
  return last;
}

/**
 * Whether the word is the WHOLE content of its markdown table cell.
 *
 * An axis word in one cell binds a word in the next when that word is what the cell HOLDS, or when
 * something inside the cell binds it as a value (`boundAsAValue` below). The packaged rules
 * document writes `| ``status`` | metadata table |` — the field on the left, where it comes from on
 * the right — and reading `table` there as a misspelling of `stable` reads a two-word English
 * phrase as a value because an axis word happens to stand in the cell beside it.
 *
 * The cross-cell reach is not given up, which is the point: `| REQ status | landed |` is a value in
 * a cell of its own and `| ``status`` | plannd 로 둔다 |` is a value bound by a particle inside one,
 * and both are shapes this corpus writes. What is refused is a cell holding a PHRASE where the near
 * miss is one unbound word of several, which is the only shape the rules document produced.
 */
function fillsItsCell(text: string, word: Word): boolean {
  const from = text.lastIndexOf("|", word.index);
  const to = text.indexOf("|", word.index + word.token.length);
  if (from === -1 || to === -1) return false;
  return text.slice(from + 1, to).replace(/[`*\s]/g, "") === word.token;
}

/**
 * Near misses standing where a value goes, minus the ones measured to be ordinary words.
 *
 * The domain is every line, not the lines the census reads. Walking `lifecycleLines` made the check
 * unreachable exactly where it was needed: misspelling the ONLY enum word on a line takes the line
 * out of the census, so the reader that would have named the misspelling never sees it.
 */
function nearMissViolations(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const lines = readCorpus(file).replace(/\r\n/g, "\n").split("\n");
    lines.forEach((text, index) => {
      for (const word of wordsOf(text)) {
        const lower = word.token.toLowerCase();
        if (!isNearMiss(lower)) continue;
        if ((ALLOWED_NEAR_MISS as readonly string[]).includes(lower)) continue;
        if (homonymFor(text, word) !== undefined) continue;
        if (!inValuePosition(text, word)) continue;
        found.push(`${file}:${index + 1} -> ${word.token}   ${text.trim().replace(/\s+/g, " ").slice(0, 90)}`);
      }
    });
  }
  return found;
}

/**
 * The forbidden-word layer as a function over text, so that what it REJECTS can be asserted.
 *
 * This layer's hit count on the shipped tree is zero, and it will stay zero while the text is
 * correct — a blocklist that is being complied with catches nothing, and that is not the same as a
 * blocklist that has stopped working. The two are told apart by running it over text that should
 * fail, which is what `it("the forbidden-word layer rejects…")` does below. The layer is kept, not
 * deleted: the tool axis anchors on a tool name and this one needs no anchor at all, so a sentence
 * naming `approved` with no call beside it is read here and nowhere else.
 */
function forbiddenLifecycleHits(text: string): Array<{ line: number; excerpt: string }> {
  const hits: Array<{ line: number; excerpt: string }> = [];
  for (const word of FORBIDDEN_LIFECYCLE_WORDS) {
    const allowed = ALLOWED_LIFECYCLE_PROSE.filter(([name]) => name === word).map(([, rule]) => rule);
    // Case-insensitive: a value written `Proposed` reaches an agent exactly as `proposed` does, and
    // outside a slot shape nothing else reads it. The spellings another machine owns are named in
    // ALLOWED_LIFECYCLE_SPELLINGS rather than granted by letter case.
    const scan = new RegExp(`(?:^|[^A-Za-z0-9_-])${word}(?![A-Za-z0-9_-])(.{0,20})`, "gi");
    for (let match = scan.exec(text); match; match = scan.exec(text)) {
      if (allowed.some((rule) => rule.test(match![1] ?? ""))) continue;
      const spelling = match[0].replace(/^[^A-Za-z0-9_-]/, "").slice(0, word.length);
      if ((ALLOWED_LIFECYCLE_SPELLINGS as readonly string[]).includes(spelling)) continue;
      hits.push({ line: text.slice(0, match.index).split("\n").length, excerpt: match[0].trim() });
    }
  }
  return hits;
}

/** The near-miss reader run over one line, for the same reason `toolAxisProbe` exists. */
function nearMissProbe(line: string): string[] {
  const out: string[] = [];
  for (const word of wordsOf(line)) {
    const lower = word.token.toLowerCase();
    if (!isNearMiss(lower)) continue;
    if ((ALLOWED_NEAR_MISS as readonly string[]).includes(lower)) continue;
    if (homonymFor(line, word) !== undefined) continue;
    if (!inValuePosition(line, word)) continue;
    out.push(word.token);
  }
  return out;
}

/** How often each enum member is named across `files`, counting only what the sweep reads. */
function valueCensus(files: string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(LIFECYCLE_VALUES.map((value) => [value, 0]));
  for (const entry of lifecycleLines(files)) for (const word of entry.values) counts[word.token] = (counts[word.token] as number) + 1;
  return counts;
}

/** Which files name `value`, so a floor failure points at a place rather than at a number. */
function whereValueLives(files: string[], value: string): string[] {
  const counts = new Map<string, number>();
  for (const entry of lifecycleLines(files))
    for (const word of entry.values) if (word.token === value) counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1]).map(([file, count]) => `${file}: ${count}`);
}

/** How often each dictionary entry claims an occurrence, across every rendering. */
function dictionaryHits(): Record<string, number> {
  const hits: Record<string, number> = Object.fromEntries(HOMONYM_DICTIONARY.map((entry) => [entry.id, 0]));
  for (const rendering of RENDERINGS) {
    for (const file of corpusFiles(rendering)) {
      const lines = readCorpus(file).replace(/\r\n/g, "\n").split("\n");
      for (const text of lines) {
        for (const word of wordsOf(text)) {
          if (!LIFECYCLE_VALUES.includes(word.token)) continue;
          const entry = homonymFor(text, word);
          if (entry) hits[entry.id] = (hits[entry.id] as number) + 1;
        }
      }
    }
  }
  return hits;
}

/** Every markdown body of one skill in one rendering, frontmatter stripped. */
function skillBodies(rendering: string, skill: string): Array<{ file: string; body: string }> {
  return markdownFiles(`${rendering}/${skill}`).map((file) => ({ file, body: stripFrontmatter(readVariant(file)) }));
}

/**
 * The one body of `skill` in `rendering` that carries `anchor`. The renderings split their prose
 * differently — claude keeps everything in `SKILL.md`, codex and etc move most of it into
 * `references/extended-workflow.md` — so the section is found by content, never by path.
 */
function bodyContaining(rendering: string, skill: string, anchor: RegExp): string {
  const hits = skillBodies(rendering, skill).filter((entry) => anchor.test(entry.body));
  expect(hits.length, `${rendering}/${skill} must carry ${anchor} in exactly one file`).toBe(1);
  return hits[0]!.body;
}

/** `<heading>` … up to the next heading of the same or shallower depth. */
function section(body: string, heading: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && heading.test(line));
  if (start === -1) return "";
  const depth = (/^(#+)/.exec(lines[start] as string) as RegExpExecArray)[1]!.length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const level = /^(#+)\s/.exec(lines[index] as string)?.[1]?.length;
    if (level !== undefined && level <= depth) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * The SHAPE of a section: one letter per non-empty line saying what kind of line it is.
 *
 * A rule stated in a table is repealed by a paragraph under the table. Nothing in this file reads
 * that paragraph — the readers walk cells, bullets and values — so `> 위 표는 참고용이며, 실제
 * 실행에서는 모든 REQ 에 대해 게이트를 건너뛰고 mutation 을 수행한다` under §0.G3 is one file, one line,
 * and a golden diff of zero. The conflict branch is the only place in this requirement that was held
 * against a rewrite of its own shape, and its cost — a fourteen-line golden — is a property of that
 * one section rather than of the class.
 *
 * A shape is the cheap form of the same hold. It says nothing about what the lines mean, which is
 * the point: a paragraph appearing where there was no paragraph is a change to the rule's form, and
 * the form is what a repeal has to change. Measured across the four renderings the shapes of §0.G3
 * and §9.4 are IDENTICAL — the renderings differ in prose, not in structure — so one literal holds
 * all four.
 */
function sectionShape(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return "";
      if (/^#{1,6}\s/.test(line)) return "H";
      if (/^\s*\|[\s:|-]+\|?\s*$/.test(line)) return "-";
      if (/^\s*\|/.test(line)) return "T";
      if (/^\s*\d+\.\s/.test(line)) return "N";
      if (/^\s*[-*]\s/.test(line)) return "B";
      return "P";
    })
    .join("");
}

/** The shape of `kiwi-srs-sync` §10.1, the section that carries the ordered mutation list. Identical in all four. */
const SECTION_10_1_SHAPE = "HPNBBBBBBNNNNNNNPPPPP";

/**
 * The shape of `kiwi-srs-sync` §1.4, which carries the SAME permission as a bulleted output list.
 *
 * The skill states the mutation set twice — once here as an output and once in §10.1 as the ordered
 * call sequence — and AC-6 froze only the second. `> 위 mutation 목록은 참고용이며 …` placed under
 * this one passed every assertion in this file: the repair that leaves its mirror standing, one
 * section apart instead of one line. Identical in all four renderings, so one literal holds them.
 */
const SECTION_1_4_SHAPE = "HBBBBBBBBBBBBP";

/**
 * The shape of `kiwi-srs-sync` §0's rules table, up to its first subsection.
 *
 * The permission is stated a THIRD time here, as the `§0.10` row that names the seven tools and the
 * three the skill may not call. Freezing §1.4 and §10.1 and leaving this one open would repeat the
 * defect at one remove again: `| §0.10a | 위 mutation 권한 목록은 참고용이다 |` appended to the table
 * passed everything. The preamble only — the `### §0.G` gate subsections keep their own assertions
 * — so the price is that adding a rule row to §0 has to be read here, and no more than that.
 */
const SECTION_0_TABLE_SHAPE: Record<string, string> = {
  "skills/claude": "HT-TTTTTTTTTTTTTTTTT",
  "skills/codex": "HT-TTTTTTTTTTTTTTTTT",
  "skills/etc": "HT-TTTTTTTTTTTTTTT",
  ".agents/skills": "HT-TTTTTTTTTTTTTTTTT"
};

/** The §13 tool-table shape each rendering carries, measured. See the AC-4 test for why it is per rendering. */
const SECTION_13_SHAPE: Record<string, string> = {
  "skills/claude": "HT-TTTTTTTTTTTTTP",
  "skills/codex": "HPPPPPT-TTTTTTTTTTTTP",
  "skills/etc": "HPPT-TTTTTTTTTTTTP",
  ".agents/skills": "HPPPPPT-TTTTTTTTTTTTP"
};

/** Line endings and trailing blanks only — every other byte of the golden is load-bearing. */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

describe("FR-FLOW-154 AC-2 — the scan reads every rendering, and reads something", () => {
  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-2: ${rendering} ships the whole skill inventory, not just the files that survive`, () => {
      // `readdirSync` enumerates what is there. Moving a skill file out of the tree removes it from
      // every list built that way, so the checks below never see it and every one of them passes.
      // These three assertions are what a lost file has to get past.
      expect(skillDirectories(rendering), `${rendering}: skill directories`).toEqual(expectedSkills(rendering));
      const files = markdownFiles(rendering);
      const missingSkillDoc = expectedSkills(rendering)
        .filter((skill) => skill !== "_shared")
        .filter((skill) => !files.includes(`${rendering}/${skill}/SKILL.md`));
      expect(missingSkillDoc, `${rendering}: skills with no SKILL.md`).toEqual([]);
      expect(files.length, `${rendering}: markdown files`).toBeGreaterThanOrEqual(FILE_FLOOR[rendering] as number);
    });

    it(`FR-FLOW-154 AC-2: every markdown file under ${rendering} is read, not folded to an empty string`, () => {
      const files = markdownFiles(rendering);
      const unread = files.filter((file) => readVariant(file).trim().length === 0);
      // The shared reader folds ENOENT to an empty string by design, so a file that vanished reads
      // as clean rather than as missing. This is the assertion that separates the two.
      expect(unread, `${rendering}: unreadable or empty files`).toEqual([]);
    });

    it(`FR-FLOW-154 AC-2: every file ${rendering} ships is in the corpus, whatever kind it is`, () => {
      const files = corpusFiles(rendering);
      // The walk enumerates the tree; this states that every kind it found has a reader. A kind
      // with no reader used to be skipped one level above every layer in this file — that is how
      // `default_prompt: "… update_status … \\"landed\\""` in a shipped `agents/openai.yaml` passed
      // all of it and `skills mirror --check` besides.
      const kinds = [...new Set(files.map((file) => file.slice(file.lastIndexOf("."))))].sort();
      expect(kinds.filter((kind) => !(CORPUS_KINDS as readonly string[]).includes(kind)), `${rendering}: kinds with no reader`).toEqual(
        []
      );
      const counted: Record<string, number> = {};
      for (const file of files) {
        const kind = file.slice(file.lastIndexOf("."));
        counted[kind] = (counted[kind] ?? 0) + 1;
      }
      // Measured per kind, so a rendering that lost every YAML file fails rather than shrinking the
      // sweep — the same argument FILE_FLOOR carries one kind at a time.
      for (const [kind, floor] of Object.entries(CORPUS_KIND_FLOOR[rendering] as Record<string, number>)) {
        expect(counted[kind] ?? 0, `${rendering}: ${kind} files`).toBeGreaterThanOrEqual(floor);
      }
      // And every one of them reads as text an agent could act on. A reader that returned "" for a
      // whole kind would leave the layers sweeping nothing and reporting clean.
      const silent = files.filter((file) => readCorpus(file).trim().length === 0);
      expect(silent, `${rendering}: files the corpus reader turns into nothing`).toEqual([]);
    });

    it(`FR-FLOW-154 AC-2: every slot pattern still fires in ${rendering}`, () => {
      const files = markdownFiles(rendering);
      const statusCounts = countBySlot(files, STATUS_SLOTS);
      for (const [name, floor] of Object.entries(STATUS_SLOT_FLOOR)) {
        expect(statusCounts[name] ?? 0, `${rendering}: status slot "${name}" fired`).toBeGreaterThanOrEqual(floor);
      }
      const stabilityCounts = countBySlot(files, STABILITY_SLOTS);
      for (const [name, floor] of Object.entries(STABILITY_SLOT_FLOOR)) {
        expect(stabilityCounts[name] ?? 0, `${rendering}: stability slot "${name}" fired`).toBeGreaterThanOrEqual(floor);
      }
      // The two readers that are not line-shaped need the same protection: a renamed table header
      // takes a whole decision column out of observation and reports nothing.
      const rows = decisionRows(files);
      expect(decisionColumnSlots(rows, "stability").length, `${rendering}: stability decision column`).toBeGreaterThanOrEqual(
        DECISION_FLOOR["stability-decision-column"] as number
      );
      expect(decisionPredicateSlots(rows).length, `${rendering}: status decision predicate`).toBeGreaterThanOrEqual(
        DECISION_FLOOR["status-decision-predicate"] as number
      );
      expect(axisBlockSlots(files, "status").length, `${rendering}: status rule bullets`).toBeGreaterThanOrEqual(
        DECISION_FLOOR["status-rule-bullet"] as number
      );
      expect(axisBlockSlots(files, "stability").length, `${rendering}: stability rule bullets`).toBeGreaterThanOrEqual(
        DECISION_FLOOR["stability-rule-bullet"] as number
      );
      expect(
        transitionTables(files).flatMap(({ slots }) => slots).length,
        `${rendering}: transition-table cells`
      ).toBeGreaterThanOrEqual(DECISION_FLOOR["transition-table"] as number);
      expect(scriptStabilitySlots(rendering).length, `${rendering}: stability literals in shipped scripts`).toBeGreaterThanOrEqual(
        SCRIPT_STABILITY_FLOOR
      );
    });
  }

  it("FR-FLOW-154 AC-2: the renderings are read off the disk, not listed", () => {
    // Derived, and stated. Every directory under `skills/` is a rendering: a fourth one added to the
    // tree joins the sweep on the day it appears rather than waiting for someone to type it into a
    // literal — which is the same silence the file KIND list was inverted to remove, one level out.
    // What the walk yields is named here so a new rendering has to be read in the diff and given its
    // floors, because a rendering with no floor is swept and measured against nothing.
    expect([...RENDERINGS], "the renderings this package ships").toEqual([
      "skills/claude",
      "skills/codex",
      "skills/etc",
      ".agents/skills"
    ]);
    for (const key of ["FILE_FLOOR", "VALUE_FLOOR", "TOOL_AXIS_FLOOR", "VALUE_SITE_FLOOR", "CORPUS_KIND_FLOOR"] as const) {
      const floors: Record<string, unknown> = {
        FILE_FLOOR,
        VALUE_FLOOR,
        TOOL_AXIS_FLOOR,
        VALUE_SITE_FLOOR,
        CORPUS_KIND_FLOOR
      }[key];
      expect(Object.keys(floors).sort(), `${key} covers every rendering`).toEqual([...RENDERINGS].sort());
    }
  });

  it("FR-FLOW-154 AC-1 · AC-2: the copy of this contract that lives in code is read too", () => {
    // `speckiwi init` writes an agent instruction block into a consumer repository's CLAUDE.md and
    // AGENTS.md. That block names both axes and five lifecycle values, and it is a copy of this
    // contract that no rendering carries — so no walk over `skills/` opens it, exactly as no walk
    // opened `agents/openai.yaml` before the corpus boundary was inverted. It is rendered here
    // rather than transcribed, so what is swept is the text an agent actually receives.
    const corpus = [{ file: "src/core/bootstrap/templates.ts (renderAgentInstructionSnippet)", text: AGENT_INSTRUCTION_TEXT }];
    expect(AGENT_INSTRUCTION_TEXT.length, "the rendered agent instruction must not be empty").toBeGreaterThan(1000);
    const statusViolations = collectSlotsInText(corpus, STATUS_SLOTS)
      .filter((found) => !(REQUIREMENT_STATUSES as readonly string[]).includes(found.token))
      .map(describeSlot);
    expect(statusViolations, "the agent instruction names a status the code does not define").toEqual([]);
    const stabilityViolations = collectSlotsInText(corpus, STABILITY_SLOTS)
      .filter((found) => !(STABILITY_LEVELS as readonly string[]).includes(found.token))
      .map(describeSlot);
    expect(stabilityViolations, "the agent instruction names a stability the code does not define").toEqual([]);
    // And the readers that need no slot shape, run line by line the way the tree walk runs them.
    for (const [index, line] of AGENT_INSTRUCTION_TEXT.split("\n").entries()) {
      expect(toolAxisProbe(line), `agent instruction:${index + 1} names a value beside a call: ${line.slice(0, 90)}`).toEqual([]);
      expect(nearMissProbe(line), `agent instruction:${index + 1} misspells a lifecycle value: ${line.slice(0, 90)}`).toEqual([]);
    }
    expect(
      forbiddenLifecycleHits(AGENT_INSTRUCTION_TEXT).map((hit) => `${hit.line}: ${hit.excerpt}`),
      "the agent instruction names a lifecycle word neither enum defines"
    ).toEqual([]);
    // The block still says the thing this requirement is about, so a rewrite that dropped the axis
    // rule would not pass by having nothing left to check.
    expect(AGENT_INSTRUCTION_TEXT, "the agent instruction must still separate the two axes").toMatch(
      /`Status` tracks implementation[\s\S]{0,200}`Stability` tracks requirement/
    );
  });

  it("FR-FLOW-154 AC-2: no other copy of this contract has appeared in the code", () => {
    // "Where contract-carrying text lives" is derived rather than listed: a string literal long
    // enough to be prose, naming an axis word, naming a lifecycle value. Three such literals exist
    // and each is a place an agent or a human reads the rule — the init block twice, and the
    // diagnostic that tells an agent to promote Stability before marking a requirement verified.
    // A fourth one written anywhere under `src/` lands here, and the inventory below fails until it
    // has been read and either swept or argued for.
    const counted: Record<string, number> = {};
    for (const site of contractSourceSitesWithExemption()) {
      if (site.exemption !== null) continue;
      counted[site.file] = (counted[site.file] ?? 0) + 1;
    }
    expect(counted, "source files carrying an agent-facing copy of the lifecycle contract").toEqual(CONTRACT_SOURCE_INVENTORY);
    // And the detector is not vacuous: it finds the literal this requirement was written about.
    expect(
      contractSourceSites().some((site) => /Stability=draft/.test(site.text)),
      "the detector must find the init block's own axis rule"
    ).toBe(true);
    // Every one of them names only values the code defines, on the axis it names.
    const entries = contractSourceSites().map((site) => ({ file: `${site.file}:${site.line}`, text: site.text }));
    expect(
      collectSlotsInText(entries, STATUS_SLOTS)
        .filter((found) => !(REQUIREMENT_STATUSES as readonly string[]).includes(found.token))
        .map(describeSlot),
      "a code-embedded copy names a status the code does not define"
    ).toEqual([]);
    expect(
      collectSlotsInText(entries, STABILITY_SLOTS)
        .filter((found) => !(STABILITY_LEVELS as readonly string[]).includes(found.token))
        .map(describeSlot),
      "a code-embedded copy names a stability the code does not define"
    ).toEqual([]);
  });

  it("FR-FLOW-154 AC-2: every exemption still excuses a copy, and only the copies recorded here", () => {
    const claimed = contractSourceSitesWithExemption().filter((site) => site.exemption !== null);
    for (const exemption of CONTRACT_SOURCE_EXEMPTIONS) {
      expect(
        claimed.some((site) => site.exemption === exemption.id),
        `the \`${exemption.id}\` exemption excuses nothing under src/ any more — it speaks for ${exemption.why} If the shape it covered is gone, delete it: an exemption that excuses nothing is a hole waiting for whatever grows into its shape.`
      ).toBe(true);
    }
    expect(
      claimed.map((site) => site.claimedAs as string).sort(),
      "the copies excused from the frozen inventory. A third description that began restating an enum would be excused in silence without this line, which is the unobserved copy this requirement exists to prevent."
    ).toEqual([...CONTRACT_SOURCE_EXEMPT_TOOLS].sort());
  });

  it("FR-FLOW-154 AC-2: the exemption is that comparison, so a copy that stopped agreeing is not excused", () => {
    // Liveness asks whether an entry still claims something; soundness asks whether anything it
    // claims stands where a drifting copy could stand. The four samples below are constructed, so
    // each drops ONE property of a pinned description and the rule's verdict is the answer to that
    // property alone — which is what an exemption checked only for survival never establishes.
    const shipped = TOOL_DESCRIPTIONS.get("update_status") as string;
    const claims = (literal: DescribedLiteral): string | null =>
      CONTRACT_SOURCE_EXEMPTIONS.reduce<string | null>((found, exemption) => found ?? exemption.claims(literal), null);
    expect(claims({ tool: "update_status", text: shipped }), "the shipped description is what this exemption is for").toBe(
      "update_status"
    );
    expect(
      claims({ tool: "update_status", text: shipped.replace("blocked, ", "") }),
      "a description withholding a value its guard admits was excused, so the rule is not comparing both directions"
    ).toBe(null);
    expect(
      claims({ tool: "update_status", text: shipped.replace("discarded —", "discarded, landed —") }),
      "a description inventing a value its guard refuses was excused, so the rule reads omissions only"
    ).toBe(null);
    expect(
      claims({ tool: "update_status", text: shipped.replace(/ — planned[^—]*— /, " ") }),
      "a description presenting no list at all was excused, so the rule excuses the tool rather than the comparison"
    ).toBe(null);
    expect(
      claims({ tool: null, text: "Refused while the requirement's Status is `verified`, which is a rule and not a list." }),
      "a literal that merely names the axis and a value was excused without being a shipped description"
    ).toBe(null);
  });

  it("FR-FLOW-154 AC-2: the corpus boundary is frozen, and reads by exclusion rather than by extension", () => {
    // The kind list is what has to be argued for now, so it is named here rather than left to
    // whichever extension a walk happened to ask for.
    expect([...CORPUS_KINDS], "the file kinds the corpus reads").toEqual([".json", ".md", ".mjs", ".yaml"]);
    expect(CORPUS_KIND_FLOOR, "how many files of each kind each rendering ships").toEqual({
      "skills/claude": { ".md": 29, ".mjs": 1 },
      "skills/codex": { ".md": 42, ".mjs": 1, ".yaml": 13 },
      "skills/etc": { ".md": 43, ".mjs": 1 },
      ".agents/skills": { ".json": 15, ".md": 39, ".mjs": 1, ".yaml": 13 }
    });

    // The exclusion list is EMPTY: every file these renderings ship is read. Kept as a list rather
    // than as silence so that an exclusion has to be written down with a reason — and so that a
    // reason has to still be true, because an exclusion that excludes nothing is an exemption
    // waiting for whatever grows into its shape, the same argument the dictionary and the tool-axis
    // residue each carry.
    expect(CORPUS_EXCLUDED_KINDS.map((entry) => entry.kind), "kinds deliberately left unread").toEqual([]);
    for (const entry of CORPUS_EXCLUDED_KINDS) {
      expect(entry.why.trim().length, `the ${entry.kind} exclusion must say why`).toBeGreaterThan(0);
      const excluded = RENDERINGS.flatMap((rendering) =>
        [...new Set(corpusFiles(rendering))].filter((file) => file.endsWith(entry.kind))
      );
      expect(excluded.length, `the ${entry.kind} exclusion excludes nothing`).toBeGreaterThan(0);
    }

    // The corpus contains the markdown walk rather than replacing it, so nothing the previous
    // boundary read has quietly fallen out of the new one.
    for (const rendering of RENDERINGS) {
      const corpus = new Set(corpusFiles(rendering));
      expect(markdownFiles(rendering).filter((file) => !corpus.has(file)), `${rendering}: markdown outside the corpus`).toEqual([]);
    }

    // A kind with no reader, an unparseable YAML line and malformed JSON all THROW. Silently
    // skipping any of the three is how a file stops being read without anything failing, which is
    // the whole failure mode this boundary exists to remove — so the loudness is asserted, not
    // stated in a comment.
    expect(() => readCorpus("skills/codex/kiwi-srs/agents/openai.png")).toThrow(/no corpus reader/);
    expect(() => yamlStrings("probe.yaml", "interface:\n  - a list item\n")).toThrow(/outside every shape/);
    expect(() => jsonStrings("{ not json")).toThrow();
    // And the readers that do exist return the strings an agent acts on, not the syntax around them.
    expect(yamlStrings("probe.yaml", 'interface:\n  default_prompt: "Use $kiwi-srs to draft."\n')).toEqual([
      "Use $kiwi-srs to draft."
    ]);
    expect(jsonStrings('{ "a": "one", "b": [2, "two"], "c": { "d": "three" } }')).toEqual(["one", "two", "three"]);
  });

  it("FR-FLOW-154 AC-2: the slot inventory itself is frozen", () => {
    // A floor only speaks for a pattern that is still in the array. Deleting one takes its defect
    // class out of observation without failing anything, so the inventory is named here and a
    // deletion has to be argued for in the diff.
    //
    // Named as a literal, not as `Object.keys(STATUS_SLOT_FLOOR)`. Both sides of that comparison
    // live in this file and one is written from the other, so deleting a pattern together with its
    // floor — the obvious follow-up once the floor starts failing — left the two derived lists
    // agreeing with each other and proved nothing. A third statement of the inventory does not make
    // the deletion impossible; it makes it a three-place edit that has to be read as one.
    expect(STATUS_SLOTS.map(([name]) => name), "status slot inventory").toEqual([
      "update_status-argument",
      "update_status-positional",
      "add_requirement-argument",
      "list_requirements-argument",
      "req-status-set",
      "req-status-value",
      "req-status-particle-value",
      "req-status-arrow",
      "status-literal-bullet",
      "status-transition",
      "status-order-ladder",
      "status-snapshot-map",
      "metadata-status-row",
      "status-bound-value",
      "update_status-list-line",
      "status-backward-guard",
      "req-keyed-status"
    ]);
    expect(Object.keys(STATUS_SLOT_FLOOR), "every status slot carries a floor").toEqual(STATUS_SLOTS.map(([name]) => name));

    expect(STABILITY_SLOTS.map(([name]) => name), "stability slot inventory").toEqual([
      "update_stability-argument",
      "update_stability-transition",
      "stability-transition",
      "stability-snapshot-map",
      "metadata-stability-row",
      "req-stability-value",
      "stability-particle-value",
      "stability-value",
      "stability-quoted-key",
      "stability-set",
      "stability-enum-restatement"
    ]);
    expect(Object.keys(STABILITY_SLOT_FLOOR), "every stability slot carries a floor").toEqual(
      STABILITY_SLOTS.map(([name]) => name)
    );

    // A floor of zero is a floor in name only: it lets its pattern stop matching and still reports
    // the slot as covered, which is the same blindness as deleting the pattern outright and does
    // not show up as a deletion in the diff. Every slot in this corpus fires at least once.
    for (const [name, floor] of [...Object.entries(STATUS_SLOT_FLOOR), ...Object.entries(STABILITY_SLOT_FLOOR)]) {
      expect(floor, `slot "${name}" must carry a floor above zero`).toBeGreaterThan(0);
    }

    // Frozen for the same reason as the inventory: this set silences tokens, so a wrong value added
    // to it disappears from every slot at once.
    expect([...NOT_A_VALUE], "the not-a-value set").toEqual(["string", "status"]);
    // And every member still silences something. `number`, `boolean` and `id` were measured at zero
    // firings across all four renderings and were removed: a silencer that silences nothing is an
    // exemption waiting for whatever grows into its shape, the same argument the dictionary carries.
    expect(notAValueHits(), "not-a-value members that silence nothing").toEqual([]);

    // The backstop is one line of six words guarding the 133-to-139 lines per rendering that name a
    // status outside every slot shape. Deleting a word from it, or adding an exception to either
    // allow-list, silences that whole area at once and fails nothing — the same blindness as
    // deleting a pattern, and cheaper. All three lists are named here.
    expect([...FORBIDDEN_LIFECYCLE_WORDS], "the forbidden lifecycle words").toEqual([
      "proposed",
      "approved",
      "obsolete",
      "wontfix",
      "in_review",
      "not_started"
    ]);
    expect(ALLOWED_LIFECYCLE_PROSE.map(([word]) => word), "the lifecycle prose exceptions").toEqual(["proposed"]);
    expect([...ALLOWED_LIFECYCLE_SPELLINGS], "the lifecycle spelling exceptions").toEqual(["APPROVED", "OBSOLETE"]);

    // Same argument as the slot floors, one level up: a file moved out of a rendering is caught by
    // the file floor alone, so lowering the floor by one in the same commit restores the sweep.
    expect(FILE_FLOOR, "the per-rendering markdown file floor").toEqual({
      "skills/claude": 29,
      "skills/codex": 42,
      "skills/etc": 43,
      ".agents/skills": 39
    });
    expect(DECISION_FLOOR, "the floor for the readers that are not line-shaped").toEqual({
      "stability-decision-column": 23,
      "status-decision-predicate": 3,
      "status-rule-bullet": 4,
      "stability-rule-bullet": 5,
      "transition-table": 5
    });
    expect([...NO_CHANGE_OUTCOME], "the no-change outcome").toEqual(["keep"]);
  });
});

describe("FR-FLOW-154 AC-11 — the corpus roots come out of the packaging manifest", () => {
  it("FR-FLOW-154 AC-11: every packaged root is swept, or excluded with a reason that still holds", () => {
    // Frozen, so a root added to the manifest has to be read in the diff and given a home rather
    // than riding in the tarball unswept — the argument RENDERINGS carries, one level further out.
    expect([...PACKAGED_ROOTS], "what the published package contains").toEqual([
      "bin",
      "dist",
      "docs/.kiwi/hooks",
      "docs/rule/SDS-MD-Rules-v2.5.0.md",
      "docs/rule/SRS-MD-Rules-v2.5.0.md",
      "skills/claude",
      "skills/codex",
      "skills/etc"
    ]);
    const documents = new Set(shippedDocumentFiles());
    const excluded = new Set(PACKAGED_UNREAD.map((entry) => entry.root));
    const rendered = new Set(packagedRenderingRoots());
    const homeless = PACKAGED_ROOTS.filter(
      (root) => !rendered.has(root) && !excluded.has(root) && !filesUnderRoot(root).every((file) => documents.has(file))
    );
    expect(homeless, "packaged roots that no sweep reads and no exclusion names").toEqual([]);
    // The renderings are not a literal that happens to agree with the manifest: the three shipped
    // ones ARE packaged roots, and the fourth is the mirror, which the package does not ship.
    expect(packagedRenderingRoots(), "the renderings the manifest ships").toEqual(["skills/claude", "skills/codex", "skills/etc"]);
    expect(
      RENDERINGS.filter((rendering) => !PACKAGED_ROOTS.includes(rendering)),
      "renderings the manifest does not ship"
    ).toEqual([".agents/skills"]);
  });

  it("FR-FLOW-154 AC-11: the two packaged exclusions are checked, not believed", () => {
    expect(
      PACKAGED_UNREAD.map((entry) => entry.root),
      "packaged roots deliberately left unread"
    ).toEqual(["bin", "dist"]);
    for (const entry of PACKAGED_UNREAD) {
      expect(entry.why.trim().length, `the ${entry.root} exclusion must say why`).toBeGreaterThan(0);
      expect(filesUnderRoot(entry.root).length, `the ${entry.root} exclusion excludes nothing`).toBeGreaterThan(0);
    }
    // `bin` is excluded because it carries no copy of this contract. That is a claim about bytes,
    // so the bytes are read: no axis word, no lifecycle value, in any file the root ships. The day
    // the launcher grows a usage string naming a status, this fails instead of staying quiet.
    for (const file of filesUnderRoot("bin")) {
      const text = readVariant(file);
      expect(text.trim().length, `${file}: the bin exclusion means nothing over an unreadable file`).toBeGreaterThan(0);
      expect(CONTRACT_AXIS_WORD.test(text), `${file} names an axis word — the bin exclusion no longer holds`).toBe(false);
      const named = text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .flatMap((line) => wordsOf(line))
        .filter((word) => LIFECYCLE_VALUES.includes(word.token))
        .map((word) => word.token);
      expect(named, `${file} names a lifecycle value — the bin exclusion no longer holds`).toEqual([]);
    }
    // `dist` is excluded because it is GENERATED. That is checkable too: the build output is
    // ignored by git, so a copy of this contract cannot be authored there and survive a rebuild.
    expect(readVariant(".gitignore"), "dist must be generated rather than authored").toMatch(/^dist\/\s*$/m);
  });
});

describe("FR-FLOW-154 AC-11 — the documents the manifest ships are read by the same readers", () => {
  it("FR-FLOW-154 AC-11: the shipped documents are enumerated, read, and not folded to nothing", () => {
    const files = shippedDocumentFiles();
    // Named, for the reason every floor in this file is named: a walk that stopped yielding these
    // would leave every assertion below sweeping an empty list and reporting clean.
    expect(files, "the documents the manifest ships beside the renderings").toEqual([
      "docs/.kiwi/hooks/pre-commit.mjs",
      "docs/.kiwi/hooks/trace.mjs",
      "docs/rule/SDS-MD-Rules-v2.5.0.md",
      "docs/rule/SRS-MD-Rules-v2.5.0.md"
    ]);
    const kinds = [...new Set(files.map((file) => file.slice(file.lastIndexOf("."))))].sort();
    expect(kinds.filter((kind) => !(CORPUS_KINDS as readonly string[]).includes(kind)), "shipped-document kinds with no reader").toEqual(
      []
    );
    const silent = files.filter((file) => readCorpus(file).trim().length === 0);
    expect(silent, "shipped documents the corpus reader turns into nothing").toEqual([]);
    // And the rules document still states the enum. It is the copy a consumer repository reads as
    // authoritative, so a rewrite that stopped naming lifecycle values would take the whole reason
    // for this sweep away while every assertion above went on passing.
    expect(
      lifecycleLines(["docs/rule/SRS-MD-Rules-v2.5.0.md"]).length,
      "lines of the rules document that name a lifecycle value"
    ).toBeGreaterThanOrEqual(PACKAGED_RULES_LINE_FLOOR);
  });

  it("FR-FLOW-154 AC-11: no shipped document names a value the code does not define", () => {
    const files = shippedDocumentFiles();
    expect(
      collectSlots(files, STATUS_SLOTS)
        .filter((found) => !(REQUIREMENT_STATUSES as readonly string[]).includes(found.token))
        .map(describeSlot),
      "a shipped document names a status the code does not define"
    ).toEqual([]);
    expect(
      collectSlots(files, STABILITY_SLOTS)
        .filter((found) => !(STABILITY_LEVELS as readonly string[]).includes(found.token))
        .map(describeSlot),
      "a shipped document names a stability the code does not define"
    ).toEqual([]);
    expect(
      toolAxisViolations(files).map((hit) => `${hit.file}:${hit.line} [${hit.tool}] -> ${hit.token}   ${hit.excerpt}`),
      "a shipped document names a value beside a lifecycle call"
    ).toEqual([]);
    expect(nearMissViolations(files).slice(0, 20), "a shipped document misspells a lifecycle value").toEqual([]);
    for (const file of files) {
      expect(
        forbiddenLifecycleHits(readCorpus(file)).map((hit) => `${file}:${hit.line}: ${hit.excerpt}`),
        "a shipped document names a lifecycle word neither enum defines"
      ).toEqual([]);
    }
  });

});

describe("FR-FLOW-154 AC-1 — every slot names a value the code defines", () => {
  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-1: ${rendering} names only members of REQUIREMENT_STATUSES in a requirement status slot`, () => {
      const files = corpusFiles(rendering);
      const rows = decisionRows(files);
      const violations = [
        ...collectSlots(files, STATUS_SLOTS),
        ...decisionColumnSlots(rows, "status"),
        ...decisionPredicateSlots(rows),
        ...axisBlockSlots(files, "status")
      ]
        .filter((found) => !(REQUIREMENT_STATUSES as readonly string[]).includes(found.token))
        .map(describeSlot);
      expect(violations).toEqual([]);
    });

    it(`FR-FLOW-154 AC-1: ${rendering} keeps each From/To transition table on one axis`, () => {
      const mixed = transitionTables(corpusFiles(rendering))
        .flatMap(({ slots }) => {
          const statuses = slots.filter((found) => (REQUIREMENT_STATUSES as readonly string[]).includes(found.token)).length;
          const levels = slots.filter((found) => (STABILITY_LEVELS as readonly string[]).includes(found.token)).length;
          const own = statuses >= levels ? (REQUIREMENT_STATUSES as readonly string[]) : (STABILITY_LEVELS as readonly string[]);
          return slots.filter((found) => !own.includes(found.token));
        })
        .map(describeSlot);
      expect(mixed, `${rendering}: transition-table cells naming another axis`).toEqual([]);
    });

    it(`FR-FLOW-154 AC-1: ${rendering} names only members of STABILITY_LEVELS in a requirement stability slot`, () => {
      const files = corpusFiles(rendering);
      // `keep` is admitted in the decision column and nowhere else: a table row may decide to make
      // no call, but no call may be sent a stability argument of `keep`.
      const allowed = new Set<string>([...STABILITY_LEVELS, ...NO_CHANGE_OUTCOME]);
      const violations = [
        ...collectSlots(files, STABILITY_SLOTS).filter((found) => !(STABILITY_LEVELS as readonly string[]).includes(found.token)),
        ...decisionColumnSlots(decisionRows(files), "stability").filter((found) => !allowed.has(found.token)),
        ...axisBlockSlots(files, "stability").filter((found) => !(STABILITY_LEVELS as readonly string[]).includes(found.token)),
        // The shipped `validator.mjs` runs its stability comparison rather than instructing it, so a
        // drifted literal there fails silently instead of being read and ignored.
        ...scriptStabilitySlots(rendering).filter((found) => !(STABILITY_LEVELS as readonly string[]).includes(found.token))
      ].map(describeSlot);
      expect(violations).toEqual([]);
    });

    it(`FR-FLOW-154 AC-1: ${rendering} carries no lifecycle word that neither enum defines`, () => {
      // Supplementary to the slot scan, not a substitute for it: a value written outside every slot
      // shape still tells an agent what to send. Identifier fragments (`proposed_rung`) and path
      // segments (`outputs/proposed-plan/`) are excluded by the boundaries.
      const stray = corpusFiles(rendering).flatMap((file) =>
        forbiddenLifecycleHits(readCorpus(file)).map((hit) => `${file}:${hit.line}  ${hit.excerpt}`)
      );
      expect(stray).toEqual([]);
    });
  }
});

describe("FR-FLOW-154 AC-1 · AC-2 — every lifecycle line is read, by exclusion rather than by shape", () => {
  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-1: ${rendering} names no misspelled lifecycle value on a line the sweep reads`, () => {
      // The complement of the dictionary. Every line that still names a value is read whole, and a
      // word on it that reads as an enum member spelled wrong is a violation — no sentence shape
      // has to recognise the line first. `in_progress` written `in-progress` is one edit away and
      // the runtime rejects it with `USAGE`.
      expect(nearMissViolations(corpusFiles(rendering)), `${rendering}: near-miss lifecycle words`).toEqual([]);
    });

    it(`FR-FLOW-154 AC-2: ${rendering} still names each enum member as often as it was measured to`, () => {
      const files = corpusFiles(rendering);
      const census = valueCensus(files);
      const floor = VALUE_FLOOR[rendering] as Record<string, number>;
      // The non-vacuity evidence, and the reader that catches a mutation the near-miss reader
      // cannot: replacing `verified` with a word from another vocabulary leaves nothing that reads
      // as a misspelling, but it does take `verified` out of the count.
      for (const value of LIFECYCLE_VALUES) {
        expect(
          census[value] as number,
          `${rendering}: \`${value}\` occurrences (floor ${floor[value]})\n  ${whereValueLives(files, value).join("\n  ")}`
        ).toBeGreaterThanOrEqual(floor[value] as number);
      }
    });
  }

  it("FR-FLOW-154 AC-1: the near-miss reader rejects a misspelling and leaves ordinary English alone", () => {
    // Every one of these is a value the runtime refuses with `USAGE`, written the way a hand slips.
    for (const probe of [
      "- 영향 REQ verifed 일괄 승급",
      '`update_status({ id, status: "in-progress" })`',
      "| Status = `implmented` | 재시도 |",
      "- REQ 의 stability 가 `evolvin` 이면 skip"
    ]) {
      expect(nearMissProbe(probe), `the near-miss reader must reject: ${probe}`).not.toEqual([]);
    }
    // And these are ordinary prose that a distance-2 reader over the whole corpus would otherwise
    // fail on. `table` is one edit from `stable`, and 표 is written `table` throughout this corpus;
    // it is left out of ALLOWED_NEAR_MISS on purpose, because putting it there would also hide
    // `stability: \`table\``. It is not read here because it stands nowhere a value stands.
    for (const clean of [
      "아래 table 은 `verified` 상태의 예시다.",
      "`frozen` 분모 table 은 §7 에 있다",
      "| `verdict` | `in-progress` / `pass` / `fail-residual` |"
    ]) {
      expect(nearMissProbe(clean), `the near-miss reader must pass: ${clean}`).toEqual([]);
    }
    // But the same word IS read where a value stands, so the narrowing did not amount to an
    // exemption for the word itself.
    expect(nearMissProbe("- REQ 의 stability 는 `table` 로 둔다"), "a value position is still read").toEqual(["table"]);

    // The TABLE-CELL edge, held as an executable statement rather than as a sentence in a comment.
    // The packaged rules document names a field on the left of a row and says where it comes from
    // on the right — `| \`status\` | metadata table |` — and an axis word in the neighbouring cell
    // does not make one word of that phrase a value. What the narrowing keeps is asserted beside
    // what it gives up, so neither can be claimed without the other.
    expect(nearMissProbe("| `status` | metadata table |"), "an unbound word in a phrase cell is not read").toEqual([]);
    expect(nearMissProbe("| REQ status | plannd |"), "a cell that holds only the value IS read").toEqual(["plannd"]);
    expect(nearMissProbe("| `status` | plannd 로 둔다 |"), "a value bound inside its own cell IS read").toEqual(["plannd"]);
    expect(nearMissProbe("| Status = `implmented` | 재시도 |"), "an axis word in the SAME cell still binds").toEqual([
      "implmented"
    ]);
  });

  it("FR-FLOW-154 AC-1: the forbidden-word layer rejects a lifecycle word neither enum defines", () => {
    // The layer's hit count on the shipped tree is zero and stays zero while the text is correct.
    // Zero rejections is what compliance looks like and also what a dead reader looks like; this is
    // what separates them. Two of the six words do occur in the corpus and are exempted by a named
    // rule, so the exemptions are asserted to still be the only thing standing between them and a
    // failure.
    for (const probe of [
      "REQ 의 Status 를 obsolete 로 둔다",
      "status: not_started",
      "| Status | in_review |",
      "`update_status` 를 wontfix 로 호출한다"
    ]) {
      expect(forbiddenLifecycleHits(probe).length, `the forbidden-word layer must reject: ${probe}`).toBeGreaterThan(0);
    }
    // `proposed change` and `APPROVED` are the two exemptions, and they are exemptions rather than
    // silence: drop the following word and the same line fails.
    expect(forbiddenLifecycleHits("per-REQ proposed change 표"), "the argued-for prose use passes").toEqual([]);
    expect(forbiddenLifecycleHits("per-REQ proposed 상태 표").length, "the same word without it does not").toBeGreaterThan(0);
    expect(forbiddenLifecycleHits("GitHub 리뷰 verdict 가 APPROVED 이면"), "the other machine's spelling passes").toEqual([]);
    expect(forbiddenLifecycleHits("REQ 를 approved 로 올린다").length, "the lifecycle spelling does not").toBeGreaterThan(0);
  });

  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-1: ${rendering} writes STATUS_ORDER in the order the code defines`, () => {
      // The slot reads the ladder as a SET: reversing the four entries leaves every token inside
      // the enum and every count unchanged, and turns kiwi-pm's forward-only rule into its
      // opposite. The order is read back out of REQUIREMENT_STATUSES, which already carries it.
      const ladders = statusOrderLadders(corpusFiles(rendering));
      // The slot floor counts VALUES, and one ladder carries four of them; this reader groups them
      // back into ladders, so both are stated — a ladder that vanished and a ladder that lost an
      // entry are different defects.
      expect(ladders.length, `${rendering}: STATUS_ORDER ladders`).toBeGreaterThanOrEqual(1);
      expect(
        ladders.reduce((sum, ladder) => sum + ladder.values.length, 0),
        `${rendering}: STATUS_ORDER entries`
      ).toBeGreaterThanOrEqual(STATUS_SLOT_FLOOR["status-order-ladder"] as number);
      const misordered = ladders
        .filter((ladder) => {
          const ranks = ladder.values.map((value) => (REQUIREMENT_STATUSES as readonly string[]).indexOf(value));
          return ranks.some((rank, index) => index > 0 && rank <= (ranks[index - 1] as number));
        })
        .map((ladder) => `${ladder.file}:${ladder.line} -> ${ladder.values.join(", ")}`);
      expect(misordered, `${rendering}: STATUS_ORDER ladders that do not ascend`).toEqual([]);
      // And a ladder of one value cannot be misordered, so it would report clean either way.
      expect(
        ladders.filter((ladder) => ladder.values.length < 2).map((ladder) => `${ladder.file}:${ladder.line}`),
        `${rendering}: ladders too short to carry an order`
      ).toEqual([]);
    });
  }

  it("FR-FLOW-154 AC-2: the homonym dictionary is frozen, and every entry still claims something", () => {
    // Named as a literal, the same argument the slot inventory carries one section up: the
    // dictionary decides what is NOT read, so an entry added quietly is a value silenced quietly.
    // The floors above make a widening fail on their own — every exclusion removes an occurrence
    // from a count — and this list makes the widening visible in the diff as well.
    expect(HOMONYM_DICTIONARY.map((entry) => entry.id), "the homonym dictionary").toEqual([
      "frozen-field-path",
      "cli-flag",
      "feasibility-label",
      "task-status",
      "journal-status",
      "review-round-blocked-warn",
      "planned-tasks-adjective",
      "verified-changes-adjective",
      "card-frozen-json-key",
      "card-frozen-block",
      "card-frozen-inside",
      "card-frozen-record",
      "frozen-denominator",
      "plan-freeze-path",
      "waves-event-name",
      "waves-event-particle",
      "wave-issues-field",
      "coder-task-status",
      "tdd-draft-phase",
      "pr-draft-flag-ko",
      "pr-draft-flag-en",
      "alias-deprecated-note",
      "plan-draft-artifact",
      "pm-task-status-literal",
      "pm-task-status-record",
      "pm-task-counter-key",
      "pm-pseudocode-init",
      "pm-pseudocode-append",
      "pm-pseudocode-ref",
      "predecessor-skill-note",
      "dependency-feasibility",
      "policy-rerun-diff",
      "qna-alias-deprecated"
    ]);

    // Every entry states which machine owns the word at that position. An entry without a reason
    // is a silencing nobody has to defend.
    expect(
      HOMONYM_DICTIONARY.filter((entry) => entry.why.trim().length === 0).map((entry) => entry.id),
      "entries with no stated reason"
    ).toEqual([]);

    // An entry that claims nothing is an exclusion left behind after the text it described was
    // rewritten: it silences whatever grows into its shape next, and it fails nothing while it
    // waits. Same argument as the floor-above-zero rule on the slot side.
    const hits = dictionaryHits();
    expect(
      Object.entries(hits)
        .filter(([, count]) => count === 0)
        .map(([id]) => id),
      "dictionary entries that no longer claim any occurrence"
    ).toEqual([]);

    // Named a second time, for the reason FILE_FLOOR is: a floor lowered by one in the same commit
    // restores the sweep and fails nothing. Stated twice, the lowering is a two-place edit that has
    // to be read as one.
    expect(VALUE_FLOOR, "the per-rendering value floor").toEqual({
      "skills/claude": {
        planned: 25,
        in_progress: 26,
        blocked: 10,
        implemented: 46,
        verified: 52,
        discarded: 24,
        draft: 87,
        evolving: 38,
        stable: 56,
        frozen: 81,
        deprecated: 43
      },
      "skills/codex": {
        planned: 26,
        in_progress: 27,
        blocked: 12,
        implemented: 48,
        verified: 42,
        discarded: 24,
        draft: 97,
        evolving: 37,
        stable: 57,
        frozen: 69,
        deprecated: 49
      },
      "skills/etc": {
        planned: 26,
        in_progress: 27,
        blocked: 12,
        implemented: 45,
        verified: 39,
        discarded: 24,
        draft: 93,
        evolving: 34,
        stable: 50,
        frozen: 64,
        deprecated: 45
      },
      ".agents/skills": {
        planned: 26,
        in_progress: 27,
        blocked: 12,
        implemented: 48,
        verified: 42,
        discarded: 24,
        draft: 91,
        evolving: 37,
        stable: 54,
        frozen: 69,
        deprecated: 48
      }
    });

    // The value floor is keyed off the imported enums, not off a list written beside it, so a
    // member cannot lose its floor without the code losing the member.
    for (const rendering of RENDERINGS) {
      expect(Object.keys(VALUE_FLOOR[rendering] as Record<string, number>), `${rendering}: floors cover the enums`).toEqual([
        ...LIFECYCLE_VALUES
      ]);
      for (const [value, floor] of Object.entries(VALUE_FLOOR[rendering] as Record<string, number>)) {
        expect(floor, `${rendering}: \`${value}\` must carry a floor above zero`).toBeGreaterThan(0);
      }
    }

    expect([...ALLOWED_NEAR_MISS], "the near-miss allow list").toEqual([
      "state",
      "planner",
      "unverified",
      "drift",
      "blockers",
      "unstable",
      "deprecate"
    ]);
    // And every entry still silences something. Nine of the sixteen this list shipped with were
    // measured at zero firings — `landed`, `plan_id`, `verifies`, `discard`, `drafts`, `implements`,
    // `implement`, `blocker`, `block` — and were removed. This list exempts a word that STANDS WHERE
    // A VALUE GOES from being read as a misspelling of an enum member, which makes a dead entry the
    // most expensive kind there is: it waits with a value position open for whatever grows into its
    // spelling. The dictionary and the tool-axis residue each carry this assertion; this list did
    // not, and `landed` sat in it as an exemption AC-9 had turned into a contract.
    const claimed = new Set<string>();
    for (const rendering of RENDERINGS) {
      for (const file of corpusFiles(rendering)) {
        for (const text of readCorpus(file).replace(/\r\n/g, "\n").split("\n")) {
          for (const word of wordsOf(text)) {
            const lower = word.token.toLowerCase();
            if (!isNearMiss(lower) || !(ALLOWED_NEAR_MISS as readonly string[]).includes(lower)) continue;
            if (homonymFor(text, word) !== undefined || !inValuePosition(text, word)) continue;
            claimed.add(lower);
          }
        }
      }
    }
    expect(
      ALLOWED_NEAR_MISS.filter((token) => !claimed.has(token)),
      "near-miss allow-list entries that no longer claim any occurrence"
    ).toEqual([]);
  });
});

describe("FR-FLOW-154 AC-1 — every value beside a lifecycle call names something the code defines", () => {
  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-1: ${rendering} sends a lifecycle call no value outside the two enums`, () => {
      const violations = toolAxisViolations(corpusFiles(rendering)).map(
        (hit) => `${hit.file}:${hit.line} [${hit.tool}] -> ${hit.token}   ${hit.excerpt}`
      );
      expect(violations, `${rendering}: values named beside a lifecycle call`).toEqual([]);
    });

    it(`FR-FLOW-154 AC-2: ${rendering} still puts values beside those calls for the axis to read`, () => {
      // The non-vacuity evidence for this axis. A rewrite that stops writing values beside the call
      // — or a tool rename — otherwise leaves the reader matching nothing and reporting clean.
      const hits = toolAxisHits(corpusFiles(rendering));
      // The floor stays where it was measured; what changed is what it SAYS when it fails. A bare
      // `expected 388 to be >= 396` sends the reader to a 3700-line file with a number and nothing
      // else, and the edit that trips it legitimately — splitting a sentence so the tool and the
      // value land in different clauses — is one a reviewer has to be able to recognise as such.
      expect(hits.length, `${rendering}: value positions beside a lifecycle call${lostSiteReport(rendering)}`).toBeGreaterThanOrEqual(
        TOOL_AXIS_FLOOR[rendering] as number
      );
      expect(
        [...new Set(hits.map((hit) => hit.tool))].sort(),
        `${rendering}: the lifecycle tools this rendering writes a value beside`
      ).toEqual([...(TOOL_AXIS_SURFACES_IN_USE[rendering] as readonly string[])]);
    });
  }

  it("FR-FLOW-154 AC-2: the tool axis is derived from the schema and its residue is frozen and live", () => {
    // Derived, not restated: a tool that gains a requirement-status argument is read the day the
    // schema says so. The assertion names what the derivation currently yields so that a schema
    // change which silently drops one of these out of the axis has to be read in the diff.
    expect([...AXIS_TOOLS], "the tools that carry a requirement lifecycle value").toEqual([
      "add_requirement",
      "list_requirements",
      "search_requirements",
      "update_stability",
      "update_status"
    ]);
    // And the three the second clause excludes are excluded for a stated reason, not by accident.
    for (const tool of ["update_step_state", "set_sds_status", "workflow_task_status_set"]) {
      expect(Object.keys(toolSchemas), `${tool} must still be a tool`).toContain(tool);
      expect(AXIS_TOOLS, `${tool} keys its status on a step or a Task, not on a requirement`).not.toContain(tool);
    }

    // The residue is frozen for the reason the homonym dictionary is: every entry is a word this
    // axis will not report, so one added quietly is a value silenced quietly.
    expect([...TOOL_AXIS_NON_VALUES], "the tool-axis residue").toEqual([
      "COMPACT_FIELDS",
      "Conflicts",
      "MUTATION_DENIED",
      "REQ-X",
      "TARGET",
      "USAGE",
      "addition_site",
      "apply_patch",
      "args",
      "args_hash",
      "compact",
      "conflict_reqs_deferred",
      "conflicts_with",
      "demote",
      "expected",
      "fence",
      "finding",
      "freeze-route",
      "green",
      "json",
      "lifecycle_override",
      "line",
      "lock",
      "mechanism",
      "mutation",
      "new-feature",
      "none",
      "out_of_scope",
      "p",
      "planner",
      "prefix",
      "reach",
      "read",
      "reference",
      "req_id",
      "reqs",
      "response_hash",
      "result",
      "result_id",
      "rung",
      "scope",
      "sha1",
      "skip",
      "speckiwi",
      "srs_authored",
      "state",
      "string",
      "t_final_dryrun_only",
      "target",
      "test",
      "traceLinks",
      "true",
      "unit",
      "v",
      "with",
      "workflow",
      "--close-reqs",
      "--inventory-file",
      "--skip-lifecycle-gate"
    ]);
    // An entry that claims nothing is an exemption left behind after the text it described was
    // rewritten, and it silences whatever grows into its shape next.
    // Over the WHOLE corpus the manifest ships, not the renderings alone: two of these entries are
    // paid for by the packaged rules document, and a liveness check that could not see it would
    // report them dead the moment they were added.
    const claimed = new Set(
      [...RENDERINGS.flatMap((rendering) => toolAxisHits(corpusFiles(rendering))), ...toolAxisHits(shippedDocumentFiles())].map(
        (hit) => hit.token
      )
    );
    expect(
      TOOL_AXIS_NON_VALUES.filter((token) => !claimed.has(token)),
      "tool-axis residue entries that no longer claim any occurrence"
    ).toEqual([]);
    // Soundness beside liveness, the pairing AC-10 asks of every exclusion: an entry that reads as a
    // misspelling of an enum member would silence the likeliest attack there is on a value position.
    // Two entries do read that way and are named rather than exempted: `planner` is two edits from
    // `planned` and is half of `kiwi-planner`, `state` is two edits from `stable` and is a field
    // name. Both are also in `ALLOWED_NEAR_MISS`, so the near-miss reader does not report them
    // either — which is the point of naming them here: a THIRD one has to be read and argued for.
    expect(
      TOOL_AXIS_NON_VALUES.filter((token) => isNearMiss(token.toLowerCase())),
      "tool-axis residue entries that are a misspelling of a lifecycle value"
    ).toEqual(["planner", "state"]);
    expect(TOOL_AXIS_FLOOR, "the tool-axis value-position floor").toEqual({
      "skills/claude": 394,
      "skills/codex": 301,
      "skills/etc": 297,
      ".agents/skills": 297
    });
    expect(TOOL_AXIS_SURFACES_IN_USE, "the lifecycle surfaces the shipped text writes a value beside").toEqual({
      "skills/claude": [
        "add_requirement",
        "list_requirements",
        "speckiwi add-requirement",
        "speckiwi list",
        "speckiwi update-stability",
        "speckiwi update-status",
        "update_stability",
        "update_status"
      ],
      "skills/codex": ["add_requirement", "list_requirements", "update_stability", "update_status"],
      "skills/etc": ["add_requirement", "list_requirements", "update_stability", "update_status"],
      ".agents/skills": ["add_requirement", "list_requirements", "update_stability", "update_status"]
    });
    // Derived, and derived to something: a CLI whose subcommand names stopped declaring a
    // requirement status would leave the CLI half of the axis anchored on nothing at all.
    expect([...AXIS_CLI_COMMANDS], "the CLI subcommands that carry a requirement lifecycle value").toEqual([
      "add-requirement",
      "list",
      "retarget",
      "search",
      "update-stability",
      "update-status"
    ]);
    for (const command of ["set-target-status", "task-status-set", "update-state", "sds-status"]) {
      expect([...CLI_COMMAND_NAMES], `${command} must still be a CLI subcommand`).toContain(command);
      expect(AXIS_CLI_COMMANDS, `${command} keys its status on a step, a Task or a target`).not.toContain(command);
    }
  });

  it("FR-FLOW-154 AC-1: the tool axis rejects a value the enums do not define", () => {
    // What this layer refuses is otherwise unobservable: the shipped corpus is clean, so a reader
    // that had stopped matching would report exactly what a working one does. These four are the
    // shapes the 2026-08-26 judgement planted and the value axis could not see — a footnote, a
    // frontmatter line, a Korean particle binding, and a flag name written into an argument.
    const probes = [
      "[^st]: `update_status` 에 보낼 값은 `landed` 다.",
      'description: "REQ 종료 시 `update_status` 에 landed 를 보낸다. 코드 리뷰 → 수정 → 재리뷰"',
      "3. `add_requirement` — 신규 REQ 의 status 는 `shipped` 로 둔다",
      '2. `update_status({ id: req_id, status: "--draft" })`'
    ];
    for (const probe of probes) {
      const hits = toolAxisProbe(probe);
      expect(hits, `the tool axis must reject: ${probe}`).not.toEqual([]);
    }
    // And it passes the shipped shapes it has to leave alone, so the rejection above is not simply
    // a reader that rejects everything.
    for (const clean of [
      '4. `update_stability { id: "REQ-X", stability: "draft", reason: "Conflicts with {NEW-ID}" }`',
      "- `update_status` 가 backward transition (이미 verified) → skip (forward-only)",
      "`list_requirements({status:\"in_progress\"})` 로 활성 REQ 후보 도출"
    ]) {
      expect(toolAxisProbe(clean), `the tool axis must pass: ${clean}`).toEqual([]);
    }
  });
});

describe("FR-FLOW-154 AC-1 · AC-2 — every value stays where it was recorded, not merely as often", () => {
  it("FR-FLOW-154 AC-2: the value-site golden is regenerated on demand", () => {
    // Held here rather than in a script so the regeneration and the check read the same tree with
    // the same dictionary. The golden is large because the corpus is; what makes it reviewable is
    // that a value which MOVED shows as a deleted line and an added line naming both places.
    if (process.env.UPDATE_VALUE_SITE_GOLDEN === "1") {
      writeFileSync(path.join(REPO_ROOT, VALUE_SITE_GOLDEN), renderValueSiteGolden(), "utf8");
    }
    expect(readVariant(VALUE_SITE_GOLDEN).trim().length, `${VALUE_SITE_GOLDEN} must carry the recorded sites`).toBeGreaterThan(0);
  });

  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-1: ${rendering} still names each value at the place it was recorded`, () => {
      const recorded = readValueSiteGolden()[rendering];
      expect(recorded, `${VALUE_SITE_GOLDEN} must carry a block for ${rendering}`).toBeDefined();
      // The count floor one section down catches a value that LEAVES the rendering. This catches
      // one that leaves a PLACE — including the case where the same word is written once more
      // somewhere else in the same file, which restores the count and changes what the text says.
      expect(
        missingValueSites(rendering, recorded as string[]).slice(0, 20),
        `${rendering}: recorded value sites the tree no longer carries`
      ).toEqual([]);
      // And the other direction. A line that names a lifecycle value and is not in the golden is a
      // place this commit newly put one, whatever it says about it — including a legitimate enum
      // word written onto the wrong axis, which no vocabulary check can call wrong and which the
      // containment form of this check let through in silence. Regenerating the golden is one
      // command; the diff it produces is the complete list of what to read.
      expect(
        unrecordedValueSites(rendering, recorded as string[]).slice(0, 20),
        `${rendering}: value sites the tree carries that the golden does not record` +
          ` — regenerate with UPDATE_VALUE_SITE_GOLDEN=1 and read the diff`
      ).toEqual([]);
      expect((recorded as string[]).length, `${rendering}: recorded sites`).toBeGreaterThanOrEqual(
        VALUE_SITE_FLOOR[rendering] as number
      );
    });
  }

  it("FR-FLOW-154 AC-11: every value a shipped document names stays where it was recorded", () => {
    // The manifest's own documents, held the way a rendering is. Placed in this describe rather
    // than beside the other AC-11 assertions because the block is written by the regeneration test
    // above, and a reader that ran before it would report a missing block rather than a moved value.
    const recorded = readValueSiteGolden()[PACKAGED_DOCUMENTS];
    expect(recorded, `${VALUE_SITE_GOLDEN} must carry a block for ${PACKAGED_DOCUMENTS}`).toBeDefined();
    const sites = packagedDocumentSites();
    expect(
      siteDifference(recorded as string[], sites).slice(0, 20),
      "recorded shipped-document value sites the tree no longer carries"
    ).toEqual([]);
    expect(
      siteDifference(sites, recorded as string[]).slice(0, 20),
      "shipped-document value sites the golden does not record — regenerate with UPDATE_VALUE_SITE_GOLDEN=1 and read the diff"
    ).toEqual([]);
    expect((recorded as string[]).length, "recorded shipped-document sites").toBeGreaterThanOrEqual(PACKAGED_DOCUMENT_SITE_FLOOR);
  });

  it("FR-FLOW-154 AC-2: the site golden covers every value and its size is frozen", () => {
    const golden = readValueSiteGolden();
    expect(Object.keys(golden), "the corpus units the golden records").toEqual([...RENDERINGS, PACKAGED_DOCUMENTS]);
    for (const rendering of RENDERINGS) {
      const recorded = golden[rendering] as string[];
      // A golden truncated to its first lines would still contain-check clean for whatever survived,
      // so the size is frozen the way FILE_FLOOR and VALUE_FLOOR are.
      const values = new Set(recorded.map((line) => line.split("\t")[0] as string));
      expect([...values].sort(), `${rendering}: values the golden records`).toEqual([...LIFECYCLE_VALUES].sort());
      // And every recorded line is well formed: a line missing its file or its context would
      // contain-check against nothing and pass.
      const malformed = recorded.filter((line) => line.split("\t").length !== 4 || line.split("\t").some((cell) => cell.trim() === ""));
      expect(malformed.slice(0, 5), `${rendering}: malformed golden lines`).toEqual([]);
    }
    expect(VALUE_SITE_FLOOR, "the per-rendering site floor").toEqual({
      "skills/claude": 595,
      "skills/codex": 593,
      "skills/etc": 560,
      ".agents/skills": 577
    });
  });

  it("FR-FLOW-154 AC-2: the golden's diff is read by a tool, not by attention", () => {
    // What the site axis buys is a complete, finite list of the places a commit newly wrote a
    // lifecycle value. It buys that only if someone reads the list. Measured last round: renaming
    // one file rewrites 46 recorded lines and re-adds 46, and three attack lines hidden among the
    // 49 additions are not distinguishable by eye — but they are mechanically, because the 46 pair
    // with the 46 deletions on everything except the file column and the three pair with nothing.
    //
    // The pairing is a script; this is the assertion that it works, so the defence does not rest on
    // a file nobody runs. The diff below is the exact shape the rename measurement produced.
    const rename = [
      "--- a/test/skills/status-enum-contract.value-sites.golden.md",
      "+++ b/test/skills/status-enum-contract.value-sites.golden.md",
      "-frozen\t-\tkiwi-srs/references/extended-workflow.md\t- REQ 의 Stability 는 frozen 이다",
      "-draft\t-\tkiwi-srs/references/extended-workflow.md\t- 신규 REQ 의 Stability 는 draft 다",
      "+frozen\t-\tkiwi-srs/references/workflow-extended.md\t- REQ 의 Stability 는 frozen 이다",
      "+draft\t-\tkiwi-srs/references/workflow-extended.md\t- 신규 REQ 의 Stability 는 draft 다",
      "+frozen\t-\tkiwi-srs/references/workflow-extended.md\t- 검토가 끝난 REQ 의 Status 칸에는 frozen 을 적는다"
    ].join("\n");
    const { written, gone } = unpairedSites(rename);
    expect(
      written.map((entry) => entry.line),
      "the rename must pair off and leave exactly the line the commit newly wrote"
    ).toEqual(["frozen\t-\tkiwi-srs/references/workflow-extended.md\t- 검토가 끝난 REQ 의 Status 칸에는 frozen 을 적는다"]);
    expect(gone, "and nothing was lost").toEqual([]);
    // The other direction: a site that left and did not come back is what a mutation on an existing
    // line produces, and it has to be reported too rather than absorbed by the pairing.
    const deletion = unpairedSites(
      ["-verified\t-\tkiwi-srs/SKILL.md\t- REQ 를 verified 로 올린다", "+verifed\t-\tkiwi-srs/SKILL.md\t- REQ 를 verifed 로 올린다"].join(
        "\n"
      )
    );
    expect(deletion.gone.length, "a recorded site that vanished is reported").toBe(1);
    expect(deletion.written.length, "and so is what replaced it").toBe(1);
    // And the tool names the golden this test measures, so the two cannot drift apart.
    expect(GOLDEN, "the script and the test must read the same file").toBe(VALUE_SITE_GOLDEN);
  });

  it("FR-FLOW-154 AC-1: the site axis rejects a value moved from one place to another", () => {
    // What this layer refuses is otherwise unobservable, the same argument the tool axis carries.
    // A recorded site whose text changed is missing even though the word is still in the file.
    const rendering = RENDERINGS[0] as string;
    const recorded = readValueSiteGolden()[rendering] as string[];
    const victim = recorded.find((line) => line.startsWith("verified\t")) as string;
    const moved = `${victim.slice(0, victim.lastIndexOf("verified"))}verified 로 옮겨진 자리`;
    expect(missingValueSites(rendering, [moved]), "a site the tree does not carry must be reported missing").toEqual([moved]);
    expect(missingValueSites(rendering, [victim]), "a site the tree does carry must not be reported").toEqual([]);
    // And multiplicity is held, not mere membership: two recordings of one site need two occurrences.
    expect(missingValueSites(rendering, [victim, victim, victim, victim]).length, "multiplicity is held").toBeGreaterThan(0);
    // The equality half, probed the same way: the golden with one line removed has to report that
    // line as unrecorded. Otherwise a golden that simply stopped being compared would read as clean.
    const withoutVictim = recorded.filter((line) => line !== victim);
    expect(unrecordedValueSites(rendering, withoutVictim), "a site the golden stopped recording must be reported").toContain(
      victim
    );
    expect(unrecordedValueSites(rendering, recorded), "the golden as it stands records every live site").toEqual([]);
  });
});

describe("FR-FLOW-154 AC-2 — every exclusion says what it silences, not merely that it silences something", () => {
  it("FR-FLOW-154 AC-2: no homonym entry speaks inside the requirement's own Status or Stability field", () => {
    // The soundness half of the dictionary contract. The liveness half — every entry still claims an
    // occurrence — has been asserted since the layer shipped, and it is not the same question: an
    // entry can be alive and still silence a place where a wrong value can stand. Seven of the eleven
    // values had one. `pr-draft-flag-ko` speaks for `draft 로 생성`, which is a GitHub PR flag
    // everywhere it occurs in this corpus and is also, word for word, the tail of
    // `Status 칸에는 draft 로 생성한다고 적는다` — a stability word written into the status field, silenced
    // by a rule that had nothing to do with it.
    //
    // Zero, measured. Every occurrence the dictionary claims in the shipped tree stands somewhere
    // other than the requirement's own field, so the scoping costs the dictionary nothing today and
    // stops it reaching the one place a wrong value is written.
    expect(scopedOutHomonyms(), "homonym entries the axis-field scoping had to refuse").toEqual([]);

    // And the scoping is not vacuous: these are the seven sentences the dictionary used to silence,
    // one per value that had a rule reaching the field. Each names a legitimate enum word on the
    // WRONG axis — which no vocabulary check can call wrong — and each is now unclaimed, so the site
    // golden records it and a commit that writes one has it in the diff.
    const wrongAxisWithATriggerWord: Array<[string, string]> = [
      ["- 신규 REQ 의 Status 칸에는 draft 로 생성한다고 적는다.", "draft"],
      ["- phase 진입 시 REQ 의 Stability 칸에는 in_progress 를 적는다.", "in_progress"],
      ["- REQ 의 Stability 칸에는 verified changes 라고 적는다.", "verified"],
      ["- done 인 REQ 의 Stability 칸엔 blocked 를 적는다.", "blocked"],
      ["- 남은 REQ 의 Stability 칸에는 planned tasks 기준을 적는다.", "planned"],
      ["- 종료된 REQ 의 Status 칸에는 deprecated 예정이라고 적는다.", "deprecated"],
      ["- 검토가 끝난 REQ 는 Status 칸 frozen 안에 기록한다.", "frozen"]
    ];
    for (const [sentence, value] of wrongAxisWithATriggerWord) {
      expect(siteProbe(sentence), `the dictionary must not speak for \`${value}\` in: ${sentence}`).toContainEqual([value, "-"]);
      // The same sentence with the trigger word taken out was always read; the point is that the two
      // are now read alike, so what a sentence is doing no longer depends on a word standing beside it.
      expect(rawHomonymFor(sentence, wordsOf(sentence).find((word) => word.token === value) as Word), `\`${value}\` had a claim`)
        .toBeDefined();
    }
  });

  it("FR-FLOW-154 AC-2: the site golden says which entry silenced each occurrence, and that vocabulary is closed", () => {
    // The other half of the same repair. The scoping above is a judgement about ONE shape — the
    // requirement's own field — and shapes this file has not thought of are exactly what six rounds
    // kept finding. So the golden no longer drops what the dictionary claims: it records every
    // occurrence and names the entry beside it. An entry added to silence a line then moves that
    // line from the `-` group into the entry's group, which is a diff, and a line naming any value
    // is an added line whatever the sentence says about it.
    const golden = readValueSiteGolden();
    const known = new Set<string>(["-", ...HOMONYM_DICTIONARY.map((entry) => entry.id)]);
    for (const rendering of RENDERINGS) {
      const claims = new Set((golden[rendering] as string[]).map((line) => line.split("\t")[1] as string));
      expect([...claims].filter((claim) => !known.has(claim)).sort(), `${rendering}: golden claims naming no dictionary entry`).toEqual(
        []
      );
      // And the unclaimed group is the bulk of it, so a golden whose every line carried a claim —
      // which is what a dictionary widened to cover the corpus would produce — is not this one.
      const unclaimed = (golden[rendering] as string[]).filter((line) => line.split("\t")[1] === "-").length;
      expect(unclaimed, `${rendering}: unclaimed recorded sites`).toBeGreaterThan((golden[rendering] as string[]).length * 0.7);
    }
    // Every dictionary entry appears in the golden of at least one rendering: the liveness assertion
    // one section up says the same thing about the tree, and this says it about the record, so a
    // dictionary entry cannot be alive in the sweep and invisible in the file a reviewer reads.
    const recordedClaims = new Set(RENDERINGS.flatMap((rendering) => (golden[rendering] as string[]).map((line) => line.split("\t")[1])));
    expect(
      HOMONYM_DICTIONARY.map((entry) => entry.id).filter((id) => !recordedClaims.has(id)),
      "dictionary entries the golden does not record"
    ).toEqual([]);
  });

  it("FR-FLOW-154 AC-1: the exemption beside a lifecycle call is the call's OWN vocabulary, not every tool's", () => {
    // The derived exemption used to be about 485 tokens wide — every MCP argument name, every CLI
    // subcommand and every long option — because SOME tool somewhere declares each of them. Deriving
    // the set stops it drifting from the schema; it says nothing about whether the set belongs where
    // it is applied. It carried `acknowledged`, `applied` and `resolution` (arguments of the
    // orchestrator's issue and replay tools) and `promote`, `freeze` and `close` (subcommands of
    // `read` and `orchestrate`) — six words with no relation to `update_status`, and the six a person
    // inventing a requirement status would reach for first. Each sat in the most explicit value
    // position this corpus has and passed.
    //
    // The narrowing is by CLASS, not by punctuation. An earlier attempt refused them only where the
    // sentence handed the value over with `:`, `=` or 로 — and `` `update_status` 의 status 는
    // `acknowledged` 를 쓴다 `` walked through, because a topic particle is not a directional. What a
    // word is doing cannot be decided from the particle beside it; what it BELONGS to can.
    for (const token of ["acknowledged", "applied", "resolution", "promote", "freeze", "close"]) {
      for (const shape of [
        `- 라운드가 끝나면 \`update_status\` 로 REQ 를 \`${token}\` 로 올린다.`,
        `- \`update_status\` 의 status 는 \`${token}\` 를 쓴다.`,
        `- \`update_status\` 호출 시 status 인자는 \`${token}\` 다.`,
        `- \`update_status({ id, status: "${token}" })\``
      ]) {
        expect(toolAxisProbe(shape), `another tool's vocabulary beside a lifecycle call must be read: ${shape}`).toContain(token);
      }
    }
    // And the call's own vocabulary still passes, which is what the derivation is for — this is a
    // narrowing, not a deletion. These are argument names `add_requirement`, `list_requirements`,
    // `update_status` and `update_stability` actually declare, read out of their own schema entries.
    for (const token of ["status", "stability", "reason", "target", "scope"]) {
      expect(AXIS_TOOL_ARGUMENTS.has(token), `${token} must be an axis tool's own argument`).toBe(true);
      expect(toolAxisProbe(`- \`update_status\` 의 \`${token}\` 를 확인한다.`), `the call's own argument name passes: ${token}`).toEqual(
        []
      );
    }
    // And a command line stays readable as a command line: inside a span that IS an invocation every
    // token is an argument by construction, so a subcommand and a flag belong there.
    expect(toolAxisProbe("- `speckiwi update-status <id> planned --json` 을 실행한다."), "an invocation is not prose").toEqual([]);
  });

  it("FR-FLOW-154 AC-1: the near-miss anchor binds from behind as well as in front", () => {
    // Korean puts the object first. The tool axis was made bidirectional for that reason last round
    // and this layer was not, so the same instruction passed or failed on word order alone.
    expect(nearMissProbe("- 라운드가 끝나면 plannd 를 REQ 의 Status 에 적는다."), "the axis named after the value binds it").toEqual([
      "plannd"
    ]);
    expect(nearMissProbe("- 라운드가 끝나면 REQ 의 Status 에 plannd 를 적는다."), "and the same sentence the other way round").toEqual([
      "plannd"
    ]);
    // The backward reach is sixteen because at twenty-four it reports ordinary English standing near
    // an axis word, and the only way out of that would be the near-miss allow list. These three are
    // the lines that decided it, written as probes so the reason is executable rather than recalled.
    for (const clean of [
      "task 가 하나라도 **landed 하지 않은 요구는 현재 status 에 그대로 두고** 그 wave 의 `issues.md` 에 기록",
      "| 사용자가 path:line 제시 → 검증 통과 | `addition_site` → `verifies` 로 trace 갱신 → status 승급 |",
      "Requirement Block status, Acceptance Criteria, Verification Evidence, and Change Notes remain the source of truth."
    ]) {
      expect(nearMissProbe(clean), `an English word near an axis word must still pass: ${clean}`).toEqual([]);
    }
  });
});

describe("FR-FLOW-154 AC-8 · AC-9 — the three anchors are derived from code, and their edge is stated", () => {
  it("FR-FLOW-154 AC-8: every anchor is read out of code rather than restated beside it", () => {
    // A list written beside the check drifts from what it speaks for and nothing notices, which is
    // the defect this whole requirement exists to close — one copy of a contract checking the other.
    // So each of the three anchors is derived, and this states what "derived" has to keep meaning.

    // Anchor 1, the value axis: the vocabulary IS the two enums, not a copy of them.
    expect(LIFECYCLE_VALUES, "the value axis reads the code enums").toEqual([...REQUIREMENT_STATUSES, ...STABILITY_LEVELS]);
    for (const rendering of RENDERINGS) {
      expect(
        Object.keys(VALUE_FLOOR[rendering] as Record<string, number>),
        `${rendering}: a floor cannot outlive the member it speaks for`
      ).toEqual([...LIFECYCLE_VALUES]);
    }

    // Anchor 2, the tool axis: the tool set and the argument names come out of the MCP schema.
    expect(AXIS_TOOLS.length, "the tool axis must derive a non-empty set").toBeGreaterThan(0);
    expect(
      AXIS_TOOLS.filter((tool) => !Object.prototype.hasOwnProperty.call(toolSchemas, tool)),
      "every axis tool is a tool the schema declares"
    ).toEqual([]);
    expect(
      AXIS_TOOLS.filter((tool) => {
        const shape = toolSchemas[tool] as Record<string, unknown>;
        return !("status" in shape) && !("stability" in shape);
      }),
      "every axis tool declares a status or a stability argument"
    ).toEqual([]);
    expect(MCP_ARGUMENT_NAMES.has("status") && MCP_ARGUMENT_NAMES.has("stability"), "argument names come from the schema").toBe(true);

    // Anchor 3, the site axis: the recorded set covers every member the enums define, in every
    // rendering, so a member cannot fall out of observation while the code still defines it.
    const golden = readValueSiteGolden();
    for (const rendering of RENDERINGS) {
      const recorded = new Set((golden[rendering] as string[]).map((line) => line.split("\t")[0] as string));
      expect(
        LIFECYCLE_VALUES.filter((value) => !recorded.has(value)),
        `${rendering}: enum members with no recorded site`
      ).toEqual([]);
    }
  });

  it("FR-FLOW-154 AC-9: the edge is recorded as what remains, and each qualifier is shown by a counterexample", () => {
    // The limit AC-9 states, held as an executable statement rather than as a sentence in a comment.
    //
    // Two rewrites got here. The first recorded `` REQ 를 `landed` 로 올린다 ``, which passed for a
    // reason that was not the design's — `landed` sat in the near-miss allow list with nothing to
    // claim, so the criterion had turned a dead exemption into a contract. The second removed that
    // dependence and then claimed too much in the other direction: it said a word reaches an agent
    // unread only when four qualifiers hold at once, and three sentences dropping exactly one of
    // them each were measured passing. Those three are now read, and they are the counterexamples
    // below rather than a comment saying they were fixed.
    //
    // What remains. A word reaches an agent unread only when ALL of these hold at once:
    //   - it is in neither enum, so no count falls and no site is recorded or disturbed;
    //   - it is more than two edits from every enum member, so it is not a misspelling of one;
    //   - it is none of the six words the blocklist names;
    //   - no axis surface — MCP tool or CLI subcommand — stands within `TOOL_AXIS_WINDOW` of it.
    // `shipped` is such a word, and inventing a status from nothing is a different defect from an
    // instruction drifting away from the code: there is no second copy of anything to compare it to.
    const outsideEveryLayer = "- 라운드가 끝나면 REQ 를 `shipped` 로 올린다.";
    expect(toolAxisProbe(outsideEveryLayer), "AC-9: no axis surface stands beside it").toEqual([]);
    expect(nearMissProbe(outsideEveryLayer), "AC-9: it is more than two edits from every enum member").toEqual([]);
    expect(forbiddenLifecycleHits(outsideEveryLayer), "AC-9: it is not one of the six named words").toEqual([]);
    expect(siteProbe(outsideEveryLayer), "AC-9: it names no enum member, so no count falls and no site is added").toEqual([]);

    // The counterexamples. Each drops ONE qualifier and is read, which is what makes the four a
    // boundary rather than a description of one sentence. Two of each, on different tokens: a twin
    // built from the same word the edge names proves the layer is alive FOR THAT WORD, and the
    // three escapes that survived the previous rewrite all had the layer alive and the token
    // outside its reach.
    expect(
      toolAxisProbe("- 라운드가 끝나면 `update_status` 로 REQ 를 `shipped` 로 올린다."),
      "qualifier 4 — an MCP anchor stands beside it — and the tool axis reads it"
    ).toEqual(["shipped"]);
    expect(
      toolAxisProbe("- 라운드가 끝나면 `speckiwi update-status <id> shipped` 를 실행한다."),
      "the CLI spelling of that anchor reads it too, bare token and all"
    ).toEqual(["shipped"]);
    expect(
      toolAxisProbe("- `update_status` 의 status 는 `acknowledged` 를 쓴다."),
      "and another tool's own argument name is read there too, which it was not before"
    ).toEqual(["acknowledged"]);

    expect(
      nearMissProbe("- 라운드가 끝나면 REQ 를 `plannd` 로 올린다."),
      "qualifier 2 — within two edits of an enum member — and the near-miss reader reads it"
    ).toEqual(["plannd"]);
    expect(
      nearMissProbe("- 라운드가 끝나면 plannd 를 REQ 의 Status 에 적는다."),
      "including when the axis word stands behind it, which is the natural Korean order"
    ).toEqual(["plannd"]);
    expect(
      nearMissProbe("- 라운드가 끝나면 REQ 를 `landed` 로 올린다."),
      "and `landed` is two edits from `planned`, so the sentence AC-9 first recorded is now read"
    ).toEqual(["landed"]);

    expect(
      forbiddenLifecycleHits("- 라운드가 끝나면 REQ 를 `obsolete` 로 올린다.").length,
      "qualifier 3 — one of the six named words — and the blocklist reads it"
    ).toBeGreaterThan(0);
    expect(
      forbiddenLifecycleHits("| Status 상한 = `Proposed` |").length,
      "whatever its case, because a value written that way instructs an agent the same"
    ).toBeGreaterThan(0);

    // Qualifier 1, and the one that took the longest to make true. A legitimate enum word on the
    // WRONG axis names an enum member, so no count falls — nothing about the sentence's shape can
    // say it is wrong. What the site axis does is record the place, so the sentence appears in the
    // golden diff; what the dictionary scoping does is stop a trigger word standing beside it from
    // removing it from that record. Both are asserted, on two different values, because for seven
    // of the eleven values there WAS a rule that reached the field.
    for (const [wrongAxis, value] of [
      ["- 검토가 끝난 REQ 는 Status 칸에 frozen 을 적는다.", "frozen"],
      ["- 신규 REQ 의 Status 칸에는 draft 로 생성한다고 적는다.", "draft"]
    ] as Array<[string, string]>) {
      expect(siteProbe(wrongAxis), `qualifier 1 — it names an enum member — so a site is recorded: ${wrongAxis}`).toEqual([
        [value, "-"]
      ]);
    }

    // What is NOT claimed here, recorded so the criterion does not read as a claim of completeness.
    //
    // First: a rule an acceptance criterion names can be repealed BY REFERENCE — a sentence saying
    // the rule no longer applies, carrying none of its words. That is not blocked and is not
    // recorded as blocked; it is made VISIBLE. Written against the conflict branch it fires the
    // golden equality in all four renderings, and updating the golden in the same commit leaves one
    // line of a thirteen-line diff. The five other sections the criteria name have their shape
    // frozen for the same reason, which is why a repeal paragraph under §0.G3, §9.4, §13, §9.2 or
    // the mutation list is a failure rather than a silence.
    expect(normalize(readVariant(CONFLICT_GOLDEN)).split("\n").length, "the conflict golden a repeal has to be read against").toBe(
      13
    );

    // Second: a rule stated in prose that NO acceptance criterion names. `- \`implementability ==
    // "blocked"\` → **Phase 4 진행 안 함** … \`add_requirement\` 호출 금지.` inverted to `호출한다`
    // reverses a safety gate, names no value, disturbs no site more than 32 characters away and is
    // read by nothing here. This requirement's Requirement clause is about the values the shipped
    // text names; a gate's polarity is a different contract and belongs to a different device. It is
    // named here so that "the edge" is not read as "everything else is caught".
    const gateInProse = "- `implementability == \"blocked\"` → **Phase 4 진행 안 함**. `add_requirement` 를 그대로 호출한다.";
    expect(toolAxisProbe(gateInProse), "AC-9: an inverted gate names no value beside a call").toEqual([]);
    expect(forbiddenLifecycleHits(gateInProse), "AC-9: and no forbidden word").toEqual([]);
  });
});

describe("FR-FLOW-154 AC-3 — the kiwi-srs conflict branch holds the requirement on the stability axis", () => {
  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-3: ${rendering} carries the conflict branch exactly as agreed`, () => {
      const body = bodyContaining(rendering, "kiwi-srs", /###\s*9\.2\s+분류별 MCP 시퀀스/);
      // The branch is held byte for byte; the section it sits in was not held at all, so
      // `### 9.2` … `위 분류별 시퀀스는 참고용이며 실제로는 어느 도구를 써도 된다.` … `#### conflict`
      // repealed it from one line above without touching a byte of the golden. The preamble is
      // EMPTY in every rendering — the heading and then straight into the branches — which is the
      // cheapest hold there is and exactly the shape a repeal has to break.
      const preamble = section(body, /^###\s*9\.2\s/).split("\n");
      const firstBranch = preamble.findIndex((line) => /^####\s/.test(line));
      expect(sectionShape(preamble.slice(0, firstBranch).join("\n")), `${rendering}: §9.2 preamble`).toBe("H");
      const conflict = normalize(section(body, /^####\s+conflict\s*$/));
      const golden = normalize(readVariant(CONFLICT_GOLDEN));
      expect(golden.length, `${CONFLICT_GOLDEN} must carry the agreed branch`).toBeGreaterThan(0);
      // Presence checks cannot separate a rule from its negation: appending "the old rule is
      // repealed, now change Status too" leaves every word the checks look for in place. Equality
      // can, and it makes any rewrite — of any of the four renderings — an explicit golden update.
      expect(conflict, `${rendering}: kiwi-srs §9.2 conflict branch`).toBe(golden);
    });

    it(`FR-FLOW-154 AC-3: ${rendering} states all five parts of the rule in the order that fixes their meaning`, () => {
      const body = bodyContaining(rendering, "kiwi-srs", /###\s*9\.2\s+분류별 MCP 시퀀스/);
      const conflict = section(body, /^####\s+conflict\s*$/);
      expect(conflict.length, `${rendering}: kiwi-srs §9.2 conflict branch`).toBeGreaterThan(0);

      // These bind value, tool, outcome and verb into one ordered expression, so a reversal cannot
      // satisfy them by carrying the same vocabulary. They also guard the golden itself: whoever
      // updates it has to keep the rule pointing the same way.

      // 1. the tool name — and the tool it replaces is no longer asked to carry a stability value.
      expect(conflict, `${rendering}: conflict branch must call update_stability`).toMatch(
        /update_stability\s*\{[^}]*stability:\s*"draft"/
      );
      expect(conflict, `${rendering}: conflict branch must not route draft through update_status`).not.toMatch(
        /update_status[^\n]{0,80}status:\s*"draft"/
      );
      // 2. Stability moves, Status does not.
      expect(conflict, `${rendering}: conflict branch must say Stability moves and Status is untouched`).toMatch(
        /`Stability`[^\n]{0,20}변경[^\n]{0,20}`Status`[^\n]{0,10}건드리지 않는다/
      );
      // 2b. And the branch names Status nowhere else. Check 2 reads one clause and stops there, so
      //     appending "그 옛 규칙은 폐지되었다. 이제 `Status` 도 함께 바꾼다." leaves it satisfied while
      //     reversing the rule in a clause of its own — and updating the golden in the same commit
      //     makes the equality check above agree too, which is what the golden is for. Holding both
      //     the number of mentions and the exact shape of each clause closes both routes: another
      //     clause raises the count, and continuing an existing one moves its ending.
      expect(conflict.match(/(?<![A-Za-z0-9_])Status\b/g) ?? [], `${rendering}: mentions of Status in the conflict branch`).toHaveLength(2);
      const statusClauses = conflict
        .split(/[.\n]/)
        .map((clause) => clause.trim())
        .filter((clause) => /(?<![A-Za-z0-9_])Status\b/.test(clause));
      expect(statusClauses[0], `${rendering}: the axis clause must end on 건드리지 않는다`).toMatch(
        /^`Stability`[^\n]{0,20}변경[^\n]{0,20}`Status`[^\n]{0,10}건드리지 않는다$/
      );
      expect(statusClauses[1], `${rendering}: the no-such-value clause must end on the USAGE refusal`).toMatch(
        /^보류를 뜻하는 Status 값은 존재하지 않으며[^\n]*`USAGE` 로 거부한다$/
      );
      // 2c. And nothing was appended beside the clauses above. Checks 1-5 read clauses that are
      //     there; none of them, and not the golden either — the same commit can update that —
      //     notices a clause ADDED next to them, which is how a rule gets repealed without any of
      //     its own words being touched: "이어서 REQ-X 의 status 도 `discarded` 로 함께 전이시킨다"
      //     names no `Status`, satisfies every shape above, and reverses step 4. So the branch's
      //     shape is frozen here, in the test, where repealing the rule costs an edit a reviewer
      //     reads. Inline code spans are collapsed first: they carry sentence-ending periods of
      //     their own ("…Pending user resolution.") that are not prose.
      const shaped = normalize(conflict);
      expect(
        shaped.split("\n").filter((line) => /^\d+\.\s/.test(line)).map((line) => (/^(\d+)\./.exec(line) as RegExpExecArray)[1]),
        `${rendering}: conflict branch steps`
      ).toEqual(["1", "2", "3", "4", "5", "6"]);
      const sentencesOf = (line: string): string[] =>
        line
          .replace(/`[^`]*`/g, "`")
          .replace(/^\s*(?:\d+\.|[-*])\s*/, "")
          .split(/\.\s+/)
          .filter((sentence) => sentence.trim().length > 0);
      // What replaced the sentence COUNT. Counting sentences did catch a clause appended beside the
      // rule — but it also failed the ordinary act of splitting one long sentence into two, and it
      // did not catch a bullet REPLACED by one carrying the opposite instruction, because that
      // leaves the count where it was. Both are fixed by counting the contract-bearing content
      // instead of the punctuation: which tools the branch names, in order, and which lifecycle
      // values it names, in order.
      //
      // A clause that repeals the rule has to name a tool or a value to say anything — "이제는
      // `update_status` 로도 함께 전이시킨다" adds a tool, "REQ-X 를 `discarded` 로 전이시킨다" adds a
      // value — so both sequences move. Splitting a sentence moves neither.
      const namedTools = [...shaped.matchAll(new RegExp(`\\b(?:${MCP_TOOL_NAMES.join("|")})\\b`, "g"))].map((match) => match[0]);
      expect(namedTools, `${rendering}: the tools the conflict branch names, in order`).toEqual([
        "get_requirement",
        "add_requirement",
        "add_trace_link",
        "add_trace_link",
        "update_stability",
        "update_status",
        "update_stability",
        "validate_spec"
      ]);
      const namedValues = [
        ...shaped.matchAll(new RegExp(`(?<![A-Za-z0-9_-])(?:${LIFECYCLE_VALUES.join("|")})(?![A-Za-z0-9_-])`, "g"))
      ].map((match) => match[0]);
      expect(namedValues, `${rendering}: the lifecycle values the conflict branch names, in order`).toEqual([
        "planned",
        "draft",
        "draft",
        "verified",
        "verified"
      ]);
      // And the bullets are frozen by NAME, per step. Replacing `- \`trace\`: 코드 증거` with
      // `- 그리고 REQ-X 를 \`discarded\` 로 함께 전이시킨다` keeps the line count, keeps every word the
      // presence checks read, and — with the golden updated in the same commit — kept all 85
      // assertions green while dropping a required bullet and reversing the axis rule. The bullet
      // list is what that edit changes and nothing else was reading it.
      const bulletsByStep: Record<string, string[]> = {};
      let currentStep: string | undefined;
      for (const line of shaped.split("\n")) {
        const numbered = /^(\d+)\.\s/.exec(line);
        if (numbered) {
          currentStep = numbered[1] as string;
          bulletsByStep[currentStep] = [];
          continue;
        }
        if (currentStep === undefined || !/^\s+[-*]\s/.test(line)) continue;
        const named = /^\s+[-*]\s*`([^`]+)`/.exec(line);
        (bulletsByStep[currentStep] as string[]).push(named ? (named[1] as string).split(/[:\s]/)[0] as string : line.trim());
      }
      expect(bulletsByStep, `${rendering}: the conflict branch bullets, by step`).toEqual({
        "1": [],
        "2": ["status", "tags", "rationale", "trace"],
        "3": ["re_stated_from"],
        "4": [],
        "5": [],
        "6": []
      });
      // Counting sentences says nothing about the one sentence none of the five parts reads: step 4
      // opens by stating why the call is made at all, and "자동 폐기 수행" is a whole reversal of it
      // that leaves the count at six. It is held as text.
      const stepFour = shaped.split("\n").find((line) => /^4\.\s/.test(line)) as string;
      expect((sentencesOf(stepFour)[0] as string).replace(/`/g, "").trim(), `${rendering}: step 4 states its purpose`).toBe(
        "— 자동 폐기 회피"
      );

      // 3. why the old instruction never worked: update_status refuses that value as USAGE.
      expect(conflict, `${rendering}: conflict branch must name the USAGE refusal of status draft`).toMatch(
        /`status:\s*"draft"`[^\n]{0,20}`update_status`[^\n]{0,20}`USAGE`[^\n]{0,4}로 거부한다/
      );
      // 4. reason writes the Change Notes row, so no separate entry is made — and reason has limits
      //    of its own, all three of which return USAGE.
      expect(conflict, `${rendering}: conflict branch must tie reason to Change Notes`).toMatch(
        /`reason`[^\n]{0,20}§7 Change Notes 행을 자동 생성하므로 별도 기재하지 않는다/
      );
      expect(conflict, `${rendering}: conflict branch must state the reason limits`).toMatch(
        /`reason`[^\n]{0,20}500 UTF-16 code unit[^\n]{0,120}`update_stability`[^\n]{0,20}`USAGE`[^\n]{0,4}로 거부한다/
      );
      for (const cause of ["제어문자", "heading", "fence"]) {
        expect(conflict, `${rendering}: conflict branch must name the reason refusal cause "${cause}"`).toContain(cause);
      }
      // 5. the verified branch: the demotion is refused, so it is not attempted, and the conflict
      //    is carried by the trace link instead.
      expect(conflict, `${rendering}: conflict branch must handle an already-verified REQ-X`).toMatch(
        /`verified`[^\n]{0,20}`MUTATION_DENIED`[^\n]{0,20}거부되므로[^\n]{0,30}demote 를 시도하지 않고[^\n]{0,30}`conflicts_with`/
      );
      // 5b. And the link step 4 falls back on is the one step 3 actually registers. Check 5 reads
      //     the fallback by name, so changing the relation in step 3 alone leaves step 4 pointing
      //     at a link the branch no longer creates — the verified case then carries nothing.
      expect(conflict, `${rendering}: step 3 must register the relation step 4 falls back on`).toMatch(
        /add_trace_link[^\n]{0,200}relation:\s*"conflicts_with"/
      );
    });

    it(`FR-FLOW-154 AC-3: ${rendering} §12.3 cannot report a demotion that step 4 did not attempt`, () => {
      // §12.3 accumulates every matching row, so an unconditional conflict row and the verified row
      // fire together and the report claims both that REQ-X was demoted and that the demotion was
      // refused. The two rows have to partition the conflict case, not overlap on it.
      const body = bodyContaining(rendering, "kiwi-srs", /###\s*12\.3\s/);
      const table = section(body, /^###\s*12\.3\s/);
      const conflictRows = table.split("\n").filter((line) => /^\|/.test(line) && /분류 = `conflict`/.test(line));
      expect(conflictRows.length, `${rendering}: §12.3 conflict rows`).toBe(2);
      expect(conflictRows.filter((row) => /status\s*≠\s*`verified`/.test(row)).length, `${rendering}: the non-verified row`).toBe(1);
      expect(conflictRows.filter((row) => /status\s*=\s*`verified`/.test(row)).length, `${rendering}: the verified row`).toBe(1);
      // And that row reports what happened: no call was made. `MUTATION_DENIED` may be named as the
      // reason the call would fail, but not as an outcome that was observed.
      const verifiedRow = conflictRows.find((row) => /status\s*=\s*`verified`/.test(row)) as string;
      expect(verifiedRow, `${rendering}: the verified row must not report a refusal that never happened`).toMatch(
        /demote 를 시도하지 않았음/
      );
    });
  }
});

describe("FR-FLOW-154 AC-4 — update_stability is listed where the skill looks for its tools", () => {
  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-4: ${rendering} lists update_stability in the kiwi-srs MCP/CLI table`, () => {
      const body = bodyContaining(rendering, "kiwi-srs", /^##\s*13\.\s/m);
      const table = section(body, /^##\s*13\.\s/);
      // The third of the three sections that get a shape. §13 is where an agent looks up which tool
      // moves which axis, so a paragraph saying the table is illustrative redirects every lookup in
      // the skill. Unlike §0.G3 and §9.4 the four renderings genuinely differ here — claude opens
      // straight onto the table, codex and the mirror carry a five-line preamble, etc carries two —
      // so the shape is held per rendering rather than folded into one literal that would have to be
      // loose enough to fit all four and would then hold none of them.
      expect(sectionShape(table), `${rendering}: the shape of §13`).toBe(SECTION_13_SHAPE[rendering] as string);
      const rows = table.split("\n").filter((line) => line.trim().startsWith("|") && line.includes("update_stability"));
      // A row that CONTAINS the tool name can also be a row telling the agent not to use it, and a
      // second row can contradict the first — both read as present to a `find`. So: exactly one
      // row, and it maps the Stability task to that tool in the MCP column. The third column is
      // rendering policy (claude ships a CLI fallback, codex and etc call the CLI diagnostic-only)
      // and is left to each rendering.
      expect(rows.length, `${rendering}: §13 rows naming update_stability`).toBe(1);
      const header = tableCells(table.split("\n").find((line) => line.trim().startsWith("|")) as string);
      expect(header[1], `${rendering}: §13 second column`).toBe("MCP");
      const row = tableCells(rows[0] as string);
      expect(row[0], `${rendering}: the §13 update_stability row's task`).toBe("Stability 변경");
      expect(row[1], `${rendering}: the §13 update_stability row's MCP tool`).toBe("`update_stability`");
    });

    it(`FR-FLOW-154 AC-4: ${rendering} lists update_stability among the single-line-patch guarantees`, () => {
      const body = bodyContaining(rendering, "kiwi-srs", /###\s*9\.4\s/);
      const guarantees = section(body, /^###\s*9\.4\s/);
      // Same hold as §0.G3, on the section whose repeal sends the agent back to a hand-written edit:
      // a heading, two prose lines, the six guarantee bullets, a lead-in, the three numbered
      // responsibilities and a closing paragraph. Identical in all four renderings — they differ in
      // which sub-agent the lead-in names, not in structure — so an added paragraph is a change to
      // the form of the rule, and the form is what a repeal has to change.
      expect(sectionShape(guarantees), `${rendering}: the shape of §9.4`).toBe("HPPBBBBBBPNNNP");
      // This list is what makes "one MCP mutation = one line patch, no extra Edit" true. A tool the
      // branch now calls but the list omits sends an agent back to a hand-written edit. State the
      // rule the list serves, then hold the list to it — a bullet that begins
      // "- `update_stability` → 단일 line-patch 보장이 적용되지 않으므로 … `Edit` …" opens with the
      // same six characters as the guarantee it negates, which is all a presence check reads.
      // Each rendering bans the hand-edit path of its own agent — claude `Edit`, codex
      // `apply_patch`, etc an unnamed "manual file edit" — so the rule is read out of the text and
      // the ban is then checked against whatever that rendering named.
      const rule = /speckiwi MCP mutation 호출 = Markdown line-patch 1회\. 추가 (?:`([^`]+)` )?[^\n]{0,20}사용 금지/.exec(guarantees);
      expect(rule, `${rendering}: §9.4 must state the one-mutation-one-patch rule`).not.toBeNull();
      const handEdit = (rule as RegExpExecArray)[1];
      const bullets = guarantees.split("\n").filter((line) => /^-\s*`[a-z_]+`/.test(line.trim()));
      expect(
        bullets.map((line) => (/^-\s*`([a-z_]+)`/.exec(line.trim()) as RegExpExecArray)[1]),
        `${rendering}: §9.4 guaranteed tools`
      ).toEqual(["add_requirement", "update_status", "update_stability", "add_trace_link", "add_completed_work"]);
      for (const bullet of bullets) {
        expect(bullet, `${rendering}: §9.4 guarantee must say what speckiwi writes`).toMatch(/^-\s*`[a-z_]+`\s*→\s*\S/);
        if (handEdit !== undefined) {
          expect(bullet, `${rendering}: a guarantee that sends the agent back to ${handEdit} is not a guarantee`).not.toContain(
            `\`${handEdit}\``
          );
        }
      }
      expect(guarantees, `${rendering}: §9.4 update_stability guarantee`).toMatch(
        /^-\s*`update_stability`\s*→\s*Stability metadata row 단일 `replaceLine`/m
      );
    });
  }
});

describe("FR-FLOW-154 AC-5 — the kiwi-srs-feasibility status branch is a status predicate and covers the enum", () => {
  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-5: ${rendering} §0.G3 accounts for every member of REQUIREMENT_STATUSES`, () => {
      const body = bodyContaining(rendering, "kiwi-srs-feasibility", /####\s*§0\.G3/);
      const gate = section(body, /^####\s*§0\.G3/);
      expect(gate.length, `${rendering}: §0.G3`).toBeGreaterThan(0);
      // The gate is a heading and a five-row table, and nothing else. Every reader below walks the
      // table; a paragraph under it — "위 표는 참고용이며, 실제 실행에서는 게이트를 건너뛴다" — reverses the
      // gate in one line of one file, names no tool and no value, and leaves the site golden byte
      // for byte where it was. This is the assertion that line has to get past. Of the six sections
      // the acceptance criteria name, this is the one whose repeal skips a stability gate outright.
      expect(sectionShape(gate), `${rendering}: the shape of §0.G3`).toBe("HT-TTTTT");
      const named = new Set<string>();
      for (const match of gate.matchAll(new RegExp(`\\bstatus\\s*(?:∈\\s*\\{([^}]*)\\}|[:=]\\s*\`?(${VALUE}))`, "g"))) {
        for (const token of (match[1] ?? match[2] ?? "").split(",").map((value) => value.replace(/[`\s]/g, ""))) {
          if (token) named.add(token);
        }
      }
      const uncovered = REQUIREMENT_STATUSES.filter((status) => !named.has(status));
      expect(uncovered, `${rendering}: §0.G3 leaves these statuses unaccounted for`).toEqual([]);

      // A set of named tokens cannot state a decision: inverting a THEN column leaves the set
      // exactly as it was, and AC-5 asks the gate to state what it DOES with the values it names.
      // So the two rows that name statuses are held to the conclusion each reaches, and the row
      // count is frozen so a contradicting row cannot simply be appended beneath them.
      const rows = gate.split("\n").filter((line) => /^\s*\|/.test(line) && !/^\s*\|[\s:|-]+\|?\s*$/.test(line));
      expect(rows.length - 1, `${rendering}: §0.G3 decision rows`).toBe(5);
      const thenOf = (predicate: RegExp): string => {
        const row = rows.find((line) => predicate.test(line));
        expect(row, `${rendering}: §0.G3 must carry a row matching ${predicate}`).toBeDefined();
        return tableCells(row as string).slice(1).join("|").trim();
      };
      expect(
        thenOf(/status ∈ \{in_progress, implemented, verified\}/),
        `${rendering}: the in-flight row must skip the mutation, not perform it`
      ).toMatch(/^stability mutation skip\b/);
      expect(
        thenOf(/status ∈ \{planned, blocked\}/),
        `${rendering}: the not-yet-started row must defer to the policy`
      ).toMatch(/^정책에 따라 stability → deprecated 또는 keep$/);
      // The other two rows, held for the same reason. Freezing the row COUNT stops a contradicting
      // row being appended and freezing three of five THENs stops those three being inverted — but
      // the remaining two are the policy rows, and `block` meaning "무시하고 계속 진행" is the same
      // repeal the shape assertion above refuses in paragraph form, written into a cell instead.
      // Every row of this gate now states the conclusion it reaches.
      expect(thenOf(/status_conflict_policy: warn/), `${rendering}: the warn policy must proceed with a warning`).toMatch(
        /^진행하되 경고 출력$/
      );
      expect(thenOf(/status_conflict_policy: block/), `${rendering}: the block policy must stop the run`).toMatch(
        /^전체 평가 중단 \+ 사용자 결정 대기$/
      );
    });

    it(`FR-FLOW-154 AC-5: ${rendering} §0.G3 does not blame a filter defect for a case the filter admits`, () => {
      // §3.3 gives an explicit `--req-filter` enumeration precedence over the status default
      // exclusion, so a named discarded REQ reaches this gate on the documented path. A row that
      // calls that a filter defect sends the agent to report a bug that is not there.
      const body = bodyContaining(rendering, "kiwi-srs-feasibility", /####\s*§0\.G3/);
      const gate = section(body, /^####\s*§0\.G3/);
      const discardedRow = gate.split("\n").find((line) => /^\|/.test(line) && /status = `discarded`/.test(line)) as string;
      expect(discardedRow, `${rendering}: §0.G3 must carry a discarded row`).toBeDefined();
      expect(discardedRow, `${rendering}: the discarded row must not attribute the case to a filter defect`).not.toMatch(
        /필터 결함/
      );
      expect(discardedRow, `${rendering}: the discarded row must name the path that does reach it`).toMatch(
        /--req-filter/
      );
      expect(discardedRow, `${rendering}: the discarded row must still skip the mutation`).toMatch(
        /stability mutation skip/
      );
    });

    it(`FR-FLOW-154 AC-5: ${rendering} keeps the stability value out of the status filter`, () => {
      const body = bodyContaining(rendering, "kiwi-srs-feasibility", /--include-stable` 미지정/);
      // Only a bullet that IS a status predicate, not every bullet that mentions a filter: the
      // neighbouring `--req-filter` prose legitimately talks about the stability exclusion.
      const filterLines = body.split("\n").filter((line) => /^\s*-\s*status\s*[∈=]/.test(line));
      expect(filterLines.length, `${rendering}: the snapshot filter must state a status exclusion`).toBeGreaterThan(0);
      for (const line of filterLines) {
        for (const stability of STABILITY_LEVELS) {
          if ((REQUIREMENT_STATUSES as readonly string[]).includes(stability)) continue;
          expect(line, `${rendering}: stability value "${stability}" sits in a status predicate`).not.toMatch(
            new RegExp(`\\b${stability}\\b`)
          );
        }
      }

      // And the same check with the axes swapped, on the line directly below. Closing one direction
      // and leaving its mirror standing in the next bullet is the defect AC-6 exists to prevent one
      // file over; the two filter bullets are neighbours, so they are checked together.
      const stabilityLines = body.split("\n").filter((line) => /^\s*-\s*stability\s*[∈=]/.test(line));
      expect(stabilityLines.length, `${rendering}: the snapshot filter must state a stability exclusion`).toBeGreaterThan(0);
      for (const line of stabilityLines) {
        for (const status of REQUIREMENT_STATUSES) {
          if ((STABILITY_LEVELS as readonly string[]).includes(status)) continue;
          expect(line, `${rendering}: status value "${status}" sits in a stability predicate`).not.toMatch(
            new RegExp(`\\b${status}\\b`)
          );
        }
      }
    });
  }
});

/** The ordered steps of `kiwi-srs-sync` §10.1, read off the list rather than restated beside it. */
function mutationListSteps(rendering: string): string[] {
  const body = bodyContaining(rendering, "kiwi-srs-sync", /^\d+\.\s*update_stability\s*—/m);
  const lines = body.split("\n");
  const at = lines.findIndex((entry) => /^\d+\.\s*update_stability\s*—/.test(entry.trim()));
  let from = at;
  while (from > 0 && /^\s*\d+\.\s/.test(lines[from - 1] as string)) from -= 1;
  let to = at;
  while (to + 1 < lines.length && /^\s*\d+\.\s/.test(lines[to + 1] as string)) to += 1;
  return lines.slice(from, to + 1).map((entry) => (/^\s*\d+\.\s*([a-z_]+)/.exec(entry) as RegExpExecArray)[1] as string);
}

describe("FR-FLOW-154 AC-6 — the kiwi-srs-sync mutation list names a stability transition on the stability axis", () => {
  for (const rendering of RENDERINGS) {
    it(`FR-FLOW-154 AC-6: ${rendering} update_stability line names only stability values`, () => {
      const body = bodyContaining(rendering, "kiwi-srs-sync", /^\d+\.\s*update_stability\s*—/m);
      const line = body.split("\n").find((entry) => /^\d+\.\s*update_stability\s*—/.test(entry.trim()));
      expect(line, `${rendering}: kiwi-srs-sync mutation list must carry the update_stability step`).toBeDefined();
      // The section that carries the list, held the way §0.G3 and §9.4 are. The list itself is
      // frozen just below, which stops a step being deleted, replaced or reordered — but not a
      // paragraph appearing after the fence and saying the list is illustrative. That paragraph
      // names no value and, if it names a tool, names one the axis reader is happy to see, so
      // nothing else here reads it.
      expect(sectionShape(section(body, /^###\s*10\.1\s/)), `${rendering}: the shape of the mutation-order section`).toBe(
        SECTION_10_1_SHAPE
      );
      // The list's own shape, held the way the conflict branch's tool sequence is. The checks below
      // read the step they are named after and stop there, so a step DELETED, a step REPLACED by one
      // naming a different tool, or the seven reordered leaves every one of them satisfied — and the
      // order is the contract here: this is the sequence an agent walks. Cheaper than a golden and
      // it is what a rewrite of the list has to get past.
      expect(mutationListSteps(rendering), `${rendering}: the mutation list's steps, in order`).toEqual([
        "add_requirement",
        "append_section_note",
        "add_trace_link",
        "add_verification_evidence",
        "update_status",
        "update_stability",
        "add_completed_work"
      ]);
      // matchAll, not exec: `exec` returns the first transition and stops, so a second one appended
      // to the same line — `draft→evolving 등 승급 시, 그리고 planned→verified 강등 시` — was never
      // read, and the defect this AC exists to close could be reintroduced on the line it guards.
      const transitions = [...(line as string).matchAll(/\b([a-z_]+)\s*(?:→|->)\s*([a-z_]+)/g)];
      expect(transitions.length, `${rendering}: that step must name a transition`).toBeGreaterThan(0);
      for (const transition of transitions) {
        for (const value of [transition[1] as string, transition[2] as string]) {
          expect(STABILITY_LEVELS as readonly string[], `${rendering}: "${value}" is not a stability value`).toContain(value);
        }
      }
    });

    it(`FR-FLOW-154 AC-6: ${rendering} the second copy of the mutation list is frozen too`, () => {
      // The skill states one permission twice: §10.1 as the ordered call sequence, §1.4 as an
      // output bullet. Freezing the ordered one left the other open, and a repeal paragraph placed
      // under it — `위 mutation 목록은 참고용이며, 실제 실행에서는 목록 밖 도구도 자유롭게 호출한다`
      // — passed the whole file. Same defect AC-6 exists to prevent, one section apart rather than
      // one line: a repair that leaves its mirror standing.
      const body = bodyContaining(rendering, "kiwi-srs-sync", /^-\s*\*\*MCP mutation\*\*/m);
      const outputs = section(body, /^###\s*1\.4\s/);
      expect(outputs.length, `${rendering}: kiwi-srs-sync must carry §1.4`).toBeGreaterThan(0);
      expect(sectionShape(outputs), `${rendering}: the shape of the outputs section`).toBe(SECTION_1_4_SHAPE);
      const line = outputs.split("\n").find((entry) => /^\s*-\s*\*\*MCP mutation\*\*/.test(entry));
      expect(line, `${rendering}: §1.4 must carry the MCP mutation bullet`).toBeDefined();
      const named = [...(line as string).matchAll(/`([a-z_]+)`/g)].map((match) => match[1] as string);
      // Derived from the OTHER copy rather than restated a third time here: the two lists are one
      // permission, so a tool added to or dropped from either has to move in both or this fails.
      expect([...named].sort(), `${rendering}: §1.4 names a different tool set from §10.1`).toEqual(
        [...mutationListSteps(rendering)].sort()
      );

      // And the THIRD copy, found while closing the second: §0.10 states the same permission as a
      // rules-table row. Its section preamble is held to its shape so an appended row cannot repeal
      // it, and the tools it names are read back against §10.1 the same way §1.4's are.
      const zero = section(body, /^##\s*0\.\s/).split("\n");
      const cut = zero.findIndex((entry, index) => index > 0 && /^###\s/.test(entry));
      expect(
        sectionShape(zero.slice(0, cut === -1 ? zero.length : cut).join("\n")),
        `${rendering}: the shape of the §0 rules table`
      ).toBe(SECTION_0_TABLE_SHAPE[rendering] as string);
      const permission = zero.find((entry) => /^\|\s*§0\.10\s*\|/.test(entry));
      expect(permission, `${rendering}: §0 must carry the mutation-permission row`).toBeDefined();
      const inTheRow = [...(permission as string).matchAll(/`([a-z_]+)`/g)].map((match) => match[1] as string);
      const steps = mutationListSteps(rendering);
      expect(
        inTheRow.filter((tool) => steps.includes(tool)).sort(),
        `${rendering}: §0.10 permits a different tool set from §10.1`
      ).toEqual([...steps].sort());
      // The row's other half — the three it names in order to refuse them — frozen so that moving
      // one across the boundary is a change to be read rather than a permission gained in silence.
      expect(
        inTheRow.filter((tool) => !steps.includes(tool)).sort(),
        `${rendering}: the tools §0.10 refuses`
      ).toEqual(["init_project", "set_active_target", "set_target_goal"]);
    });

    it(`FR-FLOW-154 AC-6: ${rendering} each mutation-list step names values of the axis its own tool moves`, () => {
      // The mirror of the check above, one line up. AC-6 reads `6. update_stability —` and stops
      // there, so `5. update_status — draft / frozen 전이` — the same axis swap, on the tool that
      // has enforced its enum since v1.0.0 — passed untouched. Each step is held to the axis of the
      // tool it names, in both directions, so neither repair can leave its mirror standing.
      const body = bodyContaining(rendering, "kiwi-srs-sync", /^\d+\.\s*update_stability\s*—/m);
      const axes: Array<[string, readonly string[], readonly string[]]> = [
        ["update_status", REQUIREMENT_STATUSES, STABILITY_LEVELS],
        ["update_stability", STABILITY_LEVELS, REQUIREMENT_STATUSES]
      ];
      for (const [tool, own, other] of axes) {
        const step = new RegExp(`^\\d+\\.\\s*${tool}\\s*—`);
        const line = body.split("\n").find((entry) => step.test(entry.trim()));
        expect(line, `${rendering}: the mutation list must carry the ${tool} step`).toBeDefined();
        const named = [...(line as string).trim().replace(step, "").matchAll(/[a-z_]+/g)].map((match) => match[0]);
        expect(
          named.filter((token) => other.includes(token) && !own.includes(token)),
          `${rendering}: the ${tool} step names a value of the other axis`
        ).toEqual([]);
        expect(
          named.filter((token) => own.includes(token)).length,
          `${rendering}: the ${tool} step must name at least one ${tool} value`
        ).toBeGreaterThan(0);
      }
    });
  }
});



