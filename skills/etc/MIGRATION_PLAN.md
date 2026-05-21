# Kiwi etc Skills Migration Plan

Requirement ID: `MIG-FLOW-002`

## Target

`skills/etc` is the repository-local canonical source tree for OpenCode and Hermes local-LLM Kiwi skills. It is not itself assumed to be every agent's runtime discovery directory; installation into `.opencode/skills`, user OpenCode config paths, `~/.hermes/skills`, or external shared directories is owned by the future installer requirements `IR-CLI-027` and `FR-NODE-016`.

All migrated etc skills must follow these runtime rules:

- `speckiwi mcp` is required for normal SRS reads, mutations, validation, status/stability changes, AC/evidence/trace updates, and completed-work logging.
- If SpecKiwi MCP is unavailable, the skill halts or provides remediation guidance. CLI diagnostics/remediation is only for diagnostics, bootstrap assistance, or MCP remediation.
- `--max` is the default execution profile.
- Multi-subagent fanout is disabled. At most one delegated worker/evaluator is used at a time when delegation is available.
- Evaluation/improvement loops proceed until the single evaluator role reports no improvements for three consecutive evaluations.

## Baseline

Use `skills/codex` as the practical baseline because it already contains normalized Open Agent Skills anatomy:

- required uppercase `SKILL.md`;
- two-field `name` and `description` frontmatter;
- long workflow detail split into `references/`;
- reusable scripts under `scripts/`;
- shared Kiwi references under `_shared/kiwi/`.

Do not edit `skills/codex` or `skills/claude` during this migration.

## Inventory

| Source baseline | Destination | Disposition |
|---|---|---|
| `skills/codex/kiwi-srs` | `skills/etc/kiwi-srs` | Copy and rewrite for OpenCode/Hermes local-LLM profile |
| `skills/codex/kiwi-pm` | `skills/etc/kiwi-pm` | Copy and rewrite for single-worker local-LLM orchestration |
| `skills/codex/kiwi-srs-sync` | `skills/etc/kiwi-srs-sync` | Copy and rewrite for MCP-required SRS sync |
| `skills/codex/kiwi-srs-research` | `skills/etc/kiwi-srs-research` | Copy and collapse multi-researcher topology to single-worker sequence |
| `skills/codex/kiwi-planner` | `skills/etc/kiwi-planner` | Copy, keep `scripts/validator.mjs`, rewrite evaluator topology |
| `skills/codex/kiwi-coder` | `skills/etc/kiwi-coder` | Copy and rewrite TDD/review topology for single evaluator |
| `skills/codex/kiwi-commit-auto-push` | `skills/etc/kiwi-commit-auto-push` | Copy and rewrite commit evaluator topology |
| `skills/codex/kiwi-pipeline` | `skills/etc/kiwi-pipeline` | Copy and rewrite invocation/clarification wording |
| `skills/codex/kiwi-srs-from-code` | `skills/etc/kiwi-srs-from-code` | Copy and rewrite scope/evaluator fanout policy |
| `skills/codex/kiwi-srs-feasibility` | `skills/etc/kiwi-srs-feasibility` | Copy and rewrite feasibility/research fanout policy |
| `skills/codex/_shared/kiwi/pipeline-event.md` | `skills/etc/_shared/kiwi/pipeline-event.md` | Copy and rewrite as etc-local shared reference |
| `skills/codex/_shared/kiwi/pipeline-v1.md` | `skills/etc/_shared/kiwi/pipeline-v1.md` | Copy and rewrite as etc-local shared reference |
| `skills/codex/_shared/kiwi/feasibility-policy-schema-v1.md` | `skills/etc/_shared/kiwi/feasibility-policy-schema-v1.md` | Copy and rewrite as etc-local shared reference |
| new | `skills/etc/_shared/kiwi/local-llm-profile.md` | Add shared SSOT for MCP-required, default-max, single-worker execution |

Excluded from etc:

- `skills/codex/MIGRATION_PLAN.md` because this file is the etc migration plan.
- `skills/codex/**/agents/openai.yaml` because OpenAI UI metadata is Codex-specific and not required for OpenCode/Hermes.
- `skills/codex/_shared/kiwi/mini-option.md` because local-LLM etc skills default to max mode rather than a mini/standard override.

## Rewrite Rules

| Codex baseline pattern | etc migration rule |
|---|---|
| `Codex clarification gate` | Replace with `User clarification gate` |
| `request_user_input` | Remove or isolate; ask the user directly in the host agent |
| `Codex sub-agent`, `Codex 서브에이전트` | Replace with host-agent delegated worker wording |
| `Codex skill invocation prose` | Replace with Open Agent Skills invocation wording |
| `agents/openai.yaml` | Do not copy |
| `--mini`, `--squirrel` | Remove as active etc-mode controls; local-LLM profile defaults to `--max` |
| `standard×N`, `high-reasoning×N`, parallel evaluator/researcher fanout | Collapse to single delegated worker/evaluator used sequentially |
| raw Markdown SRS mutation guidance | Replace with MCP-required guidance; CLI diagnostics/remediation is only diagnostic/remediation |
| `skills/codex` shared paths | Rewrite to `skills/etc` or etc-relative paths |

## Validation

Run from repository root.

```powershell
rg --files skills/etc
```

```powershell
Get-ChildItem -Recurse -File skills\etc -Filter SKILL.md |
  ForEach-Object {
    python C:\Users\beom\.codex\skills\.system\skill-creator\scripts\quick_validate.py $_.DirectoryName
  }
```

```powershell
rg -n -g "*.md" -g "SKILL.md" -g "!MIGRATION_PLAN.md" "Codex|Claude|OpenAI|openai|request_user_input|~/.claude|~/.codex|\.codex|/kiwi-|--mini|--squirrel|standard×[2-9]|high-reasoning×[2-9]|parallel|병렬|multi-subagent|5-서브에이전트|standard×4" skills/etc
```

```powershell
rg -n -g "*.md" -g "SKILL.md" "speckiwi mcp|MCP|local-LLM|single evaluator|three consecutive|3회 연속|--max" skills/etc
```

## Done Criteria

- `skills/etc` contains the selected Kiwi skills and shared resources.
- `skills/codex` and `skills/claude` are not modified by this migration.
- No `skills/llm` tree is created.
- Every etc skill exposes uppercase `SKILL.md` with matching `name`.
- Every etc skill states `speckiwi mcp` is required for normal operation.
- Every etc skill states local-LLM mode defaults to `--max`, disables multi-subagent fanout, and uses one delegated worker/evaluator at a time.
- Validation includes deterministic commands and one evaluator subagent loop that reaches three consecutive no-improvement evaluations.
