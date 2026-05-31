# `--auto` shared option for etc Kiwi skills

This reference is the etc-local SSOT for `--auto` user-gate handling across
OpenCode/Hermes/local-LLM `kiwi-*` skills. It must be interpreted together with
`local-llm-profile.md`: `--max` is already the default, multi-worker fanout is
disabled, and only one delegated decision worker or evaluator may run at a time.

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

## Decision Worker

Use one isolated decision worker for `--auto`. `--auto --max` does not create an
extra merge topology because etc skills already run with the default local-LLM
max profile. If delegation is unavailable, apply only explicit low-risk
`default_if_auto` values; otherwise halt instead of guessing.

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

Failure handling:

| Failure | Action |
|---|---|
| Empty response, timeout, invalid JSON, or missing `decision` | Retry once; if still invalid, halt. |
| Decision is not one of the explicit options | Halt. |
| Decision contradicts a `critical_gates[]` match | Halt. |
| Worker reports high risk below threshold | Halt. |

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
- `lifecycle-gate-draft`
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

## Read-Time Interpretation

For a skill that references this file:

- "User clarification gate" means `critical_gates[]` matches halt; otherwise
  `--auto` may use the single decision worker.
- `NEEDS_USER` payloads are decision gates. In child mode, return the payload to
  the parent only when the gate is critical or delegation is unavailable.
- `default_if_auto` may be applied directly only for low-risk clarification
  gates with confidence 1.0.
- Normal SRS reads, mutations, status/stability changes, evidence, trace links,
  and completed-work logging still require `speckiwi mcp`; CLI may only help
  diagnose or remediate MCP setup.

## Propagation

When a parent Kiwi skill delegates to a child Kiwi skill:

| Parent flags | Child flags |
|---|---|
| `--auto` | `--auto` |
| `--auto --max` | `--auto` (`--max` is already default) |

Special propagation:

| Parent | Child | Added flags |
|---|---|---|
| `kiwi-hot-fix --auto` | `kiwi-srs-sync` | `--auto` only; never add `--auto-apply` or `--yes-all` unless the user explicitly supplied those flags |
| `kiwi-pm --auto` | `kiwi-coder` | `--auto` |
| `kiwi-coder --auto` standalone close handoff | `kiwi-review-fix-loop` | `--close-reqs --auto` only after regression and task completion gates are clean |

## Logging

Append or write `docs/analysis/{skill-run-id}/auto_decisions.json`:

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
      "worker_results": [],
      "applied_decision": "a",
      "merge_method": "single",
      "applied_at": "ISO-8601"
    }
  ],
  "critical_halts": []
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
