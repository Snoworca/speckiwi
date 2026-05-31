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

## Decision Worker

Use one isolated decision worker for `--auto`. For `--auto --max`, use two
independent workers with the same prompt and merge their decisions. Use current
Codex delegation tools available in the session; if delegation is unavailable,
halt instead of guessing for high-risk gates.

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

## Merge For `--auto --max`

1. Run two workers independently.
2. Normalize `decision` by trimming whitespace and comparing lowercased exact
   option IDs. Do not use substring matching.
3. If both decisions match, apply it and record both rationales.
4. If decisions differ, run one merge worker with the original gate input plus
   both worker results. The merge worker must choose worker 1, worker 2, or halt.
5. If the merge worker proposes a third unrelated answer, halt for user input.

Failure handling:

| Failure | Action |
|---|---|
| Empty response, timeout, invalid JSON, or missing `decision` | Retry once; if still invalid, halt. |
| `--auto --max` one worker fails and the other succeeds | Retry the failed worker once; if it still fails, use the successful worker with a LOW warning. |
| Both initial workers fail | Halt. |
| Merge worker fails | Halt. |

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

For `--mini`, increase thresholds by 0.1.

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
  `--auto` may use the decision worker.
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
| `--auto --mini` | `--auto --mini` |
| `--auto --max --mini` | `--auto --max --mini` |

Special propagation:

| Parent | Child | Added flags |
|---|---|---|
| `kiwi-hot-fix --auto` | `kiwi-srs-sync` | `--auto` only; never add `--auto-apply` or `--yes-all` unless the user explicitly supplied those flags |
| `kiwi-pm --auto` | `kiwi-coder` | `--auto`; add `--mini` or `--max` only when the parent explicitly has those flags |
| `kiwi-coder --auto` standalone close handoff | `kiwi-review-fix-loop` | `--close-reqs --auto`, plus inherited `--mini` or `--max` |

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
      "worker_results": [],
      "merged_decision": "a",
      "merge_method": "single|unanimous|merge-worker",
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
