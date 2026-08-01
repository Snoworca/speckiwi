# `--auto` shared option for etc Kiwi skills

This reference is the etc-local SSOT for `--auto` user-gate handling across
OpenCode/Hermes/local-LLM `kiwi-*` skills. It must be interpreted together with
`local-llm-profile.md`: multi-worker fanout is disabled, so committee members and
evaluators run sequentially (one delegated worker at a time). Committee size still
follows the shared model (`--auto` = 3 members, `--auto --max` = 5), identical to
the claude/codex variants — `--max` raises the committee and is not a no-op.

## Definition

When `--auto` is active, a recoverable user-decision gate may be resolved by one
isolated decision worker using only task-local evidence, explicit options, and
the active skill safety rules. The main agent must not pass its preferred answer
or private rationale to the worker.

Every skill that uses this reference must declare `critical_gates[]`. A matching
critical gate halts for user input even when `--auto` is active.

## Activation

Check channels in order:

| Channel | Activation rule |
|---|---|
| Explicit skill request | Invocation text or delegated prompt contains `--auto` as a token. |
| User prompt | User message contains an exact `--auto` token. |
| Natural language | "자동", "묻지 말고", "확인 없이", "auto", "바로 진행", or "질문 없이"; confirm once before enabling if ambiguous. |
| Parent propagation | A parent Kiwi skill already in `--auto` mode delegates to this skill and includes `--auto`. |

Silent skip cases:

- The skill does not reference this file.
- The skill references this file but does not declare `critical_gates[]`.
- `kiwi-srs-research --mode=delegated-worker`, where mutation and direct
  user-gate handling are intentionally disabled.

Record active flags in the skill preflight or analysis log, for example
`mode_flags: ["--auto", "--max"]`.

## Decision Committee

When a gate option carries the structured marker `recommended: true`, no committee is convened at
all — see the decision rule below. Otherwise, when `--auto` is active, convene a research-performing
decision committee of 3 members that investigates the gate context (research) and votes for the most
reasonable option to adopt (select), instead of a single rubber-stamp worker. Because etc runs the
local-LLM profile with multi-worker fanout disabled, the 3 committee members are evaluated
sequentially (one delegated worker at a time), not in parallel. Under `--auto --max` the decision
committee is raised to 5 members. The committee decides by **simple majority** — the option holding
strictly more than half of the votes cast — and adopts that option immediately; unanimity is not
required. Committee members run on the current session model unless `--model <name>` overrides the
committee model (no dual-model evaluator panel). Members are numbered for identification only; no
member's vote outweighs another's. If delegation is unavailable, apply only explicit low-risk
`default_if_auto` values; otherwise halt instead of guessing.

Each committee member receives the same worker input and returns the same JSON vote.

Worker input:

- `gate_id`
- `gate_context`
- `options[]`, when the original gate has explicit options
- `severity`: `clarification`, `business-decision`, or `rollback-confirmation`
- `safety_rules[]` copied from the active skill
- `available_evidence`, such as test output, MCP response, git status, or diff

Never pass:

- the main agent tentative answer
- hidden preference from the caller
- unrelated conversation history
- another worker answer as if it were independent evidence

Required worker output is raw JSON:

```json
{
  "decision": "option-id-or-enum-value",
  "rationale": ["reason 1", "reason 2", "reason 3"],
  "risk_assessment": "low|medium|high",
  "side_effects": ["effect"],
  "fallback_if_decision_fails": "next step",
  "confidence": 0.0
}
```

Failure handling (committee/member/quorum semantics, matching the claude/codex variants):

| Failure | Action |
|---|---|
| Member timeout, empty response, invalid JSON, or missing `decision` | Retry that member once; if it still fails, the quorum is degraded: escalate to `critical` and halt, unconditionally. Do not drop the member and continue. |
| A majority of members fail | Halt for user input. |
| A member returns free text instead of an option ID | Treat as a failed member (retry once, then the degraded-quorum rule above applies). |
| Decision contradicts a `critical_gates[]` match | Halt. |

With 3 members and one dropped, the remaining two have no majority in a 1-1, and continuing from
there is single-agent decision-making. A degraded quorum therefore gets the same treatment as the
no-majority result in the decision rule below.

## Decision Rule (recommended fast path -> default_if_auto -> simple majority)

Because etc disables multi-worker fanout, evaluate the committee members sequentially (one
delegated worker at a time) and then apply this rule. Resolve a `--auto` gate in this order. The two
bypasses rank `recommended` > `default_if_auto` > committee: an option carrying **both** markers
resolves through the `recommended` branch, and a gate whose options carry **neither** marker reaches
the committee.

0. **`recommended` fast path (zero votes).** If a gate option carries the structured marker
   `recommended: true`, `--auto` adopts that option immediately. No committee is convened and no
   committee member is spawned. No votes are counted, so no confidence comparison is made.
   - The marker is a structured boolean field declared on `kiwi-pm`'s `NEEDS_USER` option schema
     beside `key`, `label` and `consequence`. It is opt-in: an option without the field is not
     recommended.
   - A prose `(권장)` label in skill text carries **no machine meaning** and is **never parsed** as a
     recommendation. Two of the three such labels in `kiwi-pm` annotate a HALT option, so a prose
     scan would auto-adopt a recommended HALT.
   - This contract does not judge **why an option is recommended** — it declares no field describing
     the motive and no criterion for weighing it.
1. **`default_if_auto` fast path (zero votes).** With no `recommended` option, a gate that declares
   `default_if_auto` adopts that default. No committee is convened.
2. **Committee simple majority.** With neither bypass present, convene the committee at its declared
   size (3 for `--auto`, 5 for `--auto --max`) and adopt the option holding strictly more than half
   of the votes cast, immediately. Unanimity is not required — a 2-1 among 3 members decides on the
   spot. The committee size is fixed by the sizing rule above and does not change during the
   decision; the vote is taken once.
3. **No majority -> `critical` and halt.** If no option holds more than half of the votes — a 1-1-1
   among 3 members under `--auto`, or a tie among 5 members under `--auto --max` — escalate the gate
   to `critical` and halt for the user. A tie is one form of no majority and is handled the same
   way. The committee size stays as it is, the vote is not taken again, and no single member settles
   the outcome alone.
4. Critical gates and business decisions listed in `critical_gates[]` still halt for the user under
   `--auto`; neither the committee nor a fast path ever overrides a critical halt.
5. Record the decision in `docs/analysis/{run-id}/auto_decisions.json` (see Logging). The
   `merge_method.rule` vocabulary is exactly `majority`, `recommended-fastpath` and
   `default-if-auto`; `unanimous` is recorded as a vote outcome, never as a rule.

**Prohibited**: adopting a decision that is neither a committee simple majority nor a declared
`recommended: true` / `default_if_auto` bypass — halt immediately. A zero-vote fast-path adoption is
a declared bypass and is not caught by this prohibition.

## Severity Policy

| Severity | `--auto` behavior |
|---|---|
| `clarification` | Worker decision may proceed with adjusted confidence >= 0.5. |
| `business-decision` | Worker decision may proceed with adjusted confidence >= 0.7 unless the gate is in `critical_gates[]`. |
| `rollback-confirmation` | Worker may approve only narrow rollback actions described by the original gate; destructive resets still halt. |
| `critical` | Halt for user input. |

If a gate has no explicit severity, classify it as `critical` when it matches
`critical_gates[]`; otherwise classify it as `business-decision`.

Adjust confidence before applying:

| Condition | Adjustment |
|---|---|
| Fewer than 3 rationale items | multiply by 0.7 |
| Average rationale item shorter than 20 characters | multiply by 0.8 |
| `risk_assessment=high` and confidence > 0.7 | multiply by 0.6 |
| Mutation, push, PR, status, or stability gate with empty `side_effects[]` | multiply by 0.7 |

These adjustments apply to **each member's** confidence individually.

**Governing confidence.** After the per-member adjustments are applied, take the **minimum** among
the members who voted for the adopted option — the winning bloc. When the vote is unanimous the
winning bloc is the whole committee. Under a split vote (2-1 and so on) this value is not the mean
of the winning bloc, not the minimum or mean across all members, and not the lead member's
confidence: a dissenting member's confidence, whatever its value, does not enter the comparison.
Only this one value is compared against the threshold in force (`clarification` 0.5,
`business-decision` 0.7, each raised by the +0.1 lower-tier model adjustment below when it applies),
and only a result under that threshold escalates the gate to `critical`.

Worked cases for a `business-decision` gate at the 0.7 threshold:

| Vote | Adjusted confidence in the winning bloc | Governing | Outcome |
|---|---|---|---|
| 2-1 | 0.9, 0.6 | 0.6 | under 0.7 -> escalate to `critical` and halt |
| 2-1 | 0.9, 0.75 | 0.75 | at or above 0.7 -> adopt (the dissenter's value is excluded) |

Committee confidence cross-check, folded into the threshold mechanism above: a spread of 0.3 or more
between the highest and lowest member confidence is **recorded** in the decision audit row as
`confidence_spread` and **drives nothing** on its own. The spread affects neither the vote nor the
committee's composition, and it **supplies no confidence adjustment of its own** — no de-rating
factor is defined for it beyond the four per-member factors above. What residual effect a wide
spread has is carried by those per-member adjustments and by the governing-confidence rule, and
`critical` escalation comes from that single threshold comparison. A unanimous committee reporting a
spread of 0.3 or more therefore adopts its decision and does not halt, as long as its governing
confidence stays at or above the threshold.

When `--auto --model <name>` overrides the committee model, increase the confidence thresholds
by 0.1 only when the named model is a lower tier than the current session model. Model tier
SSOT (highest to lowest): `opus` > `sonnet` > `haiku`; compare the named and session models
deterministically by this ranking (equal or higher tier -> no change, e.g. session `sonnet` +
`--model opus`). Safe default: if the named model is not in the ranking or the session model is
unknown so the comparison is impossible, always apply +0.1 (treat the unknown model as
lower-capability).

## `critical_gates[]`

Declare critical gates in the active skill near the common rules or relevant
gate table.

Minimum table columns:

| gate_id | reason | location |
|---|---|---|
| `mcp-unavailable` | normal SRS operations require `speckiwi mcp` | preflight |

Recommended catalog:

- `external-module-impact`
- `protected-branch-direct-push`
- `fork-repo-pr-create`
- `stability-stable-promotion`
- `stability-frozen-violation`
- `lifecycle-gate-deprecated-or-frozen`
- `sha-mismatch-on-resume`
- `depends-on-violation`
- `t-final-backward-transition`
- `push-conflict-rebase-merge-choice`
- `mcp-unavailable`
- `transition-guard-bypass`
- `mock-detection`
- `plan-code-divergence-critical`
- `self-recursive-spawn`
- `pipeline-event-needs-user-or-failed`
- `bulk-close-or-finalize`

`lifecycle-gate-draft` is **retired** — draft blocking was replaced by per-REQ skip (FR-FLOW-053) and the id was dropped from the canonical gate set of every pipeline skill, starting with `kiwi-pm`. New skills must not adopt it.

## Read-Time Interpretation

For a skill that references this file:

- "User clarification gate" means `critical_gates[]` matches halt; otherwise
  `--auto` may use the decision committee (see Decision Committee and Decision
  Rule).
- `NEEDS_USER` payloads are decision gates. In child mode, return the payload to
  the parent only when the gate is critical or delegation is unavailable.
- An option marked `recommended: true` is adopted immediately with no committee — the top-ranked
  fast path (Decision Rule step 0). A prose `(권장)` label is not this marker.
- `default_if_auto` may be applied directly only for low-risk clarification
  gates with confidence 1.0. A `recommended` option outranks it.
- Normal SRS reads, mutations, status/stability changes, evidence, trace links,
  and completed-work logging still require `speckiwi mcp`; CLI may only help
  diagnose or remediate MCP setup.

## Propagation

When a parent Kiwi skill delegates to a child Kiwi skill:

| Parent flags | Child flags |
|---|---|
| `--auto` | `--auto` |
| `--auto --max` | `--auto --max` |
| `--auto --model <name>` | `--auto --model <name>` |
| `--auto --max --model <name>` | `--auto --max --model <name>` |

> **Loop round-cap propagation (FR-FLOW-035)**: the child-propagation SSOT for `--mini` / `--loops N` (verify/improve loop round cap) is `_shared/kiwi/loop-option.md` §6. They propagate parent→child exactly like `--auto`, additive to the table above — e.g. `kiwi-pm --loops 5` → `kiwi-coder --loops 5`, `kiwi-pipeline --mini` → every sub-skill `--mini`.

Special propagation:

| Parent | Child | Added flags |
|---|---|---|
| `kiwi-hot-fix --auto` | `kiwi-srs-sync` | `--auto` only; never add `--auto-apply` or `--yes-all` unless the user explicitly supplied those flags |
| `kiwi-pm --auto` | `kiwi-coder` | `--auto`; add `--model <name>` or `--max` only when the parent explicitly has those flags |
| `kiwi-coder --auto` standalone close handoff | `kiwi-review-fix-loop` | `--close-reqs --auto`, plus inherited `--model <name>` or `--max` |

## Logging

Append or write `docs/analysis/{skill-run-id}/auto_decisions.json`, recording **every adoption**,
including the two zero-vote bypasses — otherwise the decisions that received no deliberation would
be the ones leaving no evidence.

The `merge_method.rule` vocabulary is exactly `majority`, `recommended-fastpath` and
`default-if-auto`; no other value is written. `unanimous` is recorded as a `vote_outcome`, never as
a rule. A gate escalated to `critical` is not an adoption and belongs in `critical_halts[]`.

A zero-vote bypass carries `committee_size: 0` and `marked_by` (the gate declaration site), with
`committee_votes` as an **empty array** — an empty array is a claim that there were no members, an
absent field is silence.

```json
{
  "run_id": "run",
  "skill": "kiwi-pm",
  "mode_flags": ["--auto", "--max"],
  "decisions": [
    {
      "gate_id": "gate",
      "severity": "business-decision",
      "options": ["a", "b"],
      "committee_votes": [
        {"member": "#1", "decision": "a", "rationale": ["reason 1", "reason 2", "reason 3"], "confidence": 0.82},
        {"member": "#2", "decision": "a", "rationale": ["reason 1", "reason 2", "reason 3"], "confidence": 0.79},
        {"member": "#3", "decision": "a", "rationale": ["reason 1", "reason 2", "reason 3"], "confidence": 0.80}
      ],
      "merged_decision": "a",
      "vote_outcome": "unanimous",
      "confidence_spread": 0.03,
      "governing_confidence": 0.79,
      "merge_method": {"rule": "majority", "committee_size": 3},
      "applied_at": "ISO-8601"
    },
    {
      "gate_id": "srs-sync-apply-selected",
      "severity": "business-decision",
      "options": ["apply-all", "apply-selected", "dry-run-only", "abandon"],
      "committee_votes": [
        {"member": "#1", "decision": "apply-selected", "rationale": ["reason 1", "reason 2", "reason 3"], "confidence": 0.90},
        {"member": "#2", "decision": "apply-selected", "rationale": ["reason 1", "reason 2", "reason 3"], "confidence": 0.88},
        {"member": "#3", "decision": "apply-selected", "rationale": ["reason 1", "reason 2", "reason 3"], "confidence": 0.75},
        {"member": "#4", "decision": "dry-run-only", "rationale": ["reason 1", "reason 2", "reason 3"], "confidence": 0.62},
        {"member": "#5", "decision": "apply-selected", "rationale": ["reason 1", "reason 2", "reason 3"], "confidence": 0.81}
      ],
      "merged_decision": "apply-selected",
      "vote_outcome": "split",
      "confidence_spread": 0.28,
      "governing_confidence": 0.75,
      "merge_method": {"rule": "majority", "committee_size": 5},
      "applied_at": "ISO-8601"
    },
    {
      "gate_id": "route-proposal",
      "severity": "business-decision",
      "options": ["stay-and-orchestrate", "hand-off"],
      "committee_votes": [],
      "merged_decision": "stay-and-orchestrate",
      "merge_method": {"rule": "recommended-fastpath", "committee_size": 0, "marked_by": "kiwi-orchestrator route-proposal gate"},
      "applied_at": "ISO-8601"
    },
    {
      "gate_id": "frozen-note-skip",
      "severity": "clarification",
      "options": ["skip", "attach"],
      "committee_votes": [],
      "merged_decision": "skip",
      "merge_method": {"rule": "default-if-auto", "committee_size": 0, "marked_by": "kiwi-srs-sync frozen-note gate"},
      "applied_at": "ISO-8601"
    }
  ],
  "critical_halts": [
    {"gate_id": "plan-scope-choice", "halted_at": "ISO-8601", "reason": "no majority (1-1-1)"}
  ]
}
```

## Compatibility Notes

- `kiwi-pm`: `business-decision` can be decided by `--auto` only when it is not
  listed in `critical_gates[]`.
- `kiwi-srs`: QnA suppression remains local `--auto` behavior; external and
  scope-boundary gates remain critical.
- `kiwi-srs-sync`: `--auto-apply` and `--yes-all` skip the dry-run approval gate
  only when the user explicitly supplied them. Parent `--auto` must not create
  those flags.
- `kiwi-review-fix-loop`: finding severity classification is separate from
  `--auto` gate decisions.
