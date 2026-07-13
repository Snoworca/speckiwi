# `--auto` shared option for Codex Kiwi skills

This reference is the Codex-local SSOT for `--auto` user-gate handling across
`kiwi-*` skills. Load it only when a skill declares `--auto` support and reaches
a user-decision gate.

## Definition

When `--auto` is active, a recoverable user-decision gate can be decided by an
isolated Codex sub-agent using only task-local evidence, explicit options, and
the skill's safety rules. The main agent must not pass its preferred answer or
private rationale to the decision worker.

Every skill that uses this reference must declare `critical_gates[]`. A matching
critical gate halts for user input even when `--auto` is active.

## Activation

Check channels in order:

| Channel | Activation rule |
|---|---|
| Explicit skill request | Invocation text or delegated prompt contains `--auto` as a token. |
| User prompt | User message contains an exact `--auto` token. |
| Natural language | "자동", "묻지 말고", "확인 없이", "auto", "바로 진행", or "질문 없이"; confirm once before enabling if the phrase is ambiguous. |
| Parent propagation | A parent Kiwi skill that is already in `--auto` mode delegates to this skill and includes `--auto`. |

Silent skip cases:

- The skill does not reference this file.
- The skill references this file but does not declare `critical_gates[]`.
- `kiwi-srs-research --mode=subagent`, where mutation and user-gate handling are intentionally disabled.

Record active flags in the skill's preflight or analysis log, for example
`mode_flags: ["--auto", "--max"]`.

## Decision Committee

When `--auto` is active, convene a research-performing decision committee of 3 members that
investigates the gate context (research) and votes for the most reasonable option to adopt
(select), instead of a single rubber-stamp worker. Under `--auto --max` the decision
committee is raised to 5 members. Committee members are isolated sub-agents spawned in a
single message (3 for `--auto`, 5 for `--auto --max`, 7 after a `--max` escalation) and
inherit the current session model unless `--model <name>` overrides the committee model (no
dual-model evaluator panel). Member #1 is the lead committee member and the deterministic
tie-breaker (see the committee merge ladder). Use current Codex delegation tools; if
delegation is unavailable, halt instead of guessing for high-risk gates.

Each committee member receives the same worker input and returns the same JSON vote.

Worker input:

- `gate_id`
- `gate_context`
- `options[]`, when the original gate has explicit options
- `severity`: `clarification`, `business-decision`, or `rollback-confirmation`
- `safety_rules[]` copied from the active skill
- `available_evidence`, such as test output, MCP response, git status, or diff

Never pass:

- the main agent's tentative answer
- another worker's result before a merge step
- hidden preference from the caller
- unrelated conversation history

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

## Committee Merge Ladder (unanimous -> escalate -> plurality -> tie-break)

Collect each member's vote and decide with this ladder. Escalation keeps the existing votes
and adds two new members, then re-decides.

1. `--auto` (3-member committee): each of the 3 members researches the gate and votes.
   - If the 3-member committee is unanimous, apply that decision and record all rationales.
   - If the 3-member committee is not unanimous, escalate to a 5-member committee and
     re-decide.
2. 5-member committee: after adding two members, re-decide.
   - If unanimous, apply it.
   - If not unanimous, the 5-member committee decides by plurality (most votes); unanimity is
     not required at 5 members.
   - Under `--max`, if the 5-member committee is not unanimous, escalate to a 7-member
     committee instead of stopping at plurality.
3. 7-member committee (`--max` only): after adding two members, the 7-member committee
   decides by plurality (most votes) without requiring unanimity.
4. Tie-break (all sizes): any committee tie is broken deterministically by the lead committee
   member (#1) ranking; member #1 is the fixed tie-breaker. The 7-member committee also breaks
   any tie by the lead member (#1) ranking.
5. Critical gates and business decisions listed in `critical_gates[]` still halt for the user
   under `--auto`; the committee never overrides a critical halt.

Normalize `decision` by trimming whitespace and comparing lowercased exact option IDs; do not
use substring matching. A member that returns free text instead of an option ID is treated as
a failed member.

Failure handling:

| Failure | Action |
|---|---|
| Member timeout, empty response, invalid JSON, or missing `decision` | Retry that member once; if still invalid, drop it and proceed only if a majority quorum remains, otherwise halt. |
| A majority of members fail | Halt for user input. |
| Lead member (#1) fails so a tie cannot be broken | Retry member #1 once; if it still fails, halt (never break a tie arbitrarily). |

## Severity Policy

| Severity | `--auto` behavior |
|---|---|
| `clarification` | Worker decision may proceed with adjusted confidence >= 0.5. |
| `business-decision` | Worker decision may proceed with adjusted confidence >= 0.7 unless the gate is in `critical_gates[]`. |
| `rollback-confirmation` | Worker may approve only narrow rollback actions described by the original gate; destructive broad resets still halt. |
| `critical` | Halt for user input. |

If a gate has no explicit severity, classify it as `critical` when it matches
`critical_gates[]`; otherwise classify it as `business-decision`.

Adjust confidence before applying:

| Condition | Adjustment |
|---|---|
| Fewer than 3 rationale items | multiply by 0.7 |
| Average rationale item shorter than 20 characters | multiply by 0.8 |
| `risk_assessment=high` and confidence > 0.7 | multiply by 0.6 |
| Mutation, push, PR, or status gate with empty `side_effects[]` | multiply by 0.7 |

Committee confidence cross-check: if the spread between the highest and lowest member
confidence is >= 0.3, the vote is unreliable. If the committee is below its terminal size
(`--auto` 3 members, or `--max` 5 members), escalate one rung on the merge ladder (3->5, 5->7)
and re-vote once even when unanimous (the non-max ladder terminates at 5 members because 7
members is `--max` only). If the committee is already at its terminal size (non-max 5 members,
or `--max` 7 members), do not re-vote; escalate the low-confidence agreement to critical and
halt for the user (same safety policy as the confidence adjustments above), never proceeding
arbitrarily.

When `--auto --model <name>` overrides the committee model, increase the confidence thresholds
by 0.1 only when the named model is a lower tier than the current session model. Model tier
SSOT (highest to lowest): `opus` > `sonnet` > `haiku`; compare the named and session models
deterministically by this ranking (equal or higher tier -> no change, e.g. session `sonnet` +
`--model opus`). Safe default: if the named model is not in the ranking or the session model is
unknown so the comparison is impossible, always apply +0.1 (treat the unknown model as
lower-capability).

## `critical_gates[]`

Declare critical gates in the active skill near the common rules or the relevant
gate table.

Minimum table columns:

| gate_id | reason | location |
|---|---|---|
| `external-module-impact` | cwd 외부 path 영향 | §0.G2 |

Recommended catalog:

- `external-module-impact`
- `protected-branch-direct-push`
- `fork-repo-pr-create`
- `stability-stable-promotion`
- `stability-frozen-violation`
- `lifecycle-gate-draft`
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

## Read-Time Interpretation

For a skill that references this file:

- "Codex clarification gate" means `critical_gates[]` match halts; otherwise
  `--auto` may use the decision committee (see Decision Committee and Committee
  Merge Ladder).
- `NEEDS_USER` payloads are decision gates. In child mode, return the payload to
  the parent only when the gate is critical or delegation is unavailable.
- `default_if_auto` may be applied directly for low-risk clarification gates
  with confidence 1.0.
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

Append or write `docs/analysis/{skill-run-id}/auto_decisions.json`:

```json
{
  "run_id": "run",
  "skill": "kiwi-pm",
  "mode_flags": ["--auto"],
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
      "merge_method": {"rule": "unanimous", "committee_size": 3},
      "applied_at": "ISO-8601"
    }
  ],
  "critical_halts": []
}
```

## Compatibility Notes

- `kiwi-pm`: `business-decision` is no longer an automatic hard halt. It can be
  decided by `--auto` unless the gate is listed in `critical_gates[]`.
- `kiwi-srs`: QnA suppression remains its local `--auto` behavior; external and
  scope-boundary gates must be listed as critical.
- `kiwi-srs-sync`: `--auto-apply` and `--yes-all` still skip the dry-run approval
  gate only when the user explicitly supplied them; parent `--auto` must not
  create those flags. `--auto` uses decision workers for gates and may choose
  apply-all, apply-selected, dry-run-only, or abandon.
- `kiwi-review-fix-loop`: finding severity classification is separate from
  `--auto` gate decisions.
