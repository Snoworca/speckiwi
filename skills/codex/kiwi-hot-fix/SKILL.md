---
name: kiwi-hot-fix
description: "Urgent Kiwi hot-fix workflow for production bugs, GitHub issues, or reported regressions when the full SRS to planner to coder pipeline is too slow. Keeps SpecKiwi governance by requiring TDD/repro evidence, prickly review, regression checks, and post-fix SRS sync through kiwi-srs-sync. Use for kiwi hot fix, hotfix, urgent fix, 긴급 수정, production issue, 이 이슈 고쳐줘, or 빠르게 고쳐줘. Supports --auto, --model, --max, --dry-run, --no-sync, --skip-regression, --resume."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

# kiwi-hot-fix

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

Handle an urgent bug fix without pretending the spec-first workflow disappeared:
write or confirm a regression test, make the smallest fix, run a strict review,
then delegate SRS catch-up to `$kiwi-srs-sync`.

This skill does not bypass repository stability blockers. If an affected REQ is
`draft` or `deprecated`, halt unless the user explicitly overrides the project
workflow. If `--no-sync` is used, run the stability gate before any behavior
change and report that SRS synchronization was intentionally skipped.

## Core Rules

| Key | Rule |
|---|---|
| §0.1 | TDD is required: reproduce the bug with a failing regression test before the fix unless `TDD_EXEMPT_REASON` is explicit and defensible. |
| §0.2 | Code changes require a separate reviewer pass equivalent to `$kiwi-coder` prickly review. |
| §0.3 | Reviewer and fixer inputs stay isolated; do not pass the fixer's rationale to the reviewer. |
| §0.4 | Mock shortcuts are CRITICAL unless the project already uses a specific test double pattern and the bug requires it. |
| §0.5 | cwd-external file edits are critical gates. |
| §0.6 | This skill does not directly mutate SRS. SRS updates happen by delegating to `$kiwi-srs-sync` after fix + regression success. |
| §0.7 | `--auto` follows `../_shared/kiwi/auto-option.md`. For sync delegation, propagate only `--auto`; do not add `--auto-apply` or `--yes-all` unless the user explicitly supplied those flags. |
| §0.8 | Use `.kiwi/sessions/{run-id}/` and `docs/analysis/kiwi-hot-fix-{run-id}/` for resumable state and evidence. |
| §0.9 | **`--mini` / `--loops N` option SSOT**. This skill follows `../_shared/kiwi/loop-option.md` v1.0. `--mini` = verify/improve loop round cap 3; `--loops N` = round cap N (integer ≥1). If both are given, **`--loops` wins (warn)**. Orthogonal to `--max` (compose). On reaching the cap, report residual findings (no safety-gate bypass) |
| §0.10 note | `--mini`/`--loops N` propagate to the `$kiwi-srs-sync` delegation (see Sync Delegation in `references/extended-workflow.md`; loop-option.md §6) |

### `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `lifecycle-gate-draft` | draft/deprecated impacted REQ cannot be implemented automatically | preflight |
| `no-sync-with-stability-gate` | `--no-sync` removes the normal SRS catch-up path | preflight |
| `external-module-impact` | cwd-external edit or external module ownership issue | scope gate |
| `fix-complexity-large` | large work should enter the full SRS/planner pipeline | root-cause analysis |
| `zero-tolerance-hypothesis-fix-mismatch` | fix does not match the accepted root-cause hypothesis | fix review |
| `mock-detection` | mock shortcut detected in a bug fix | test/fix scan |
| `mcp-unavailable` | SRS sync requires `speckiwi mcp`; CLI diagnostics cannot replace sync mutations | preflight |
| `improvement-loop-divergence-4opt` | repeated fix/review/regression failure needs user decision | improvement loop |

## Inputs

| Signal | Argument | Default |
|---|---|---|
| GitHub issue URL | `ISSUE_URL=...` | auto-detect from prompt |
| natural language symptom | prompt text | required if no issue/status source |
| file scope | `SCOPE_FILES=a,b` | infer from git status and code search |
| TDD exception | `TDD_EXEMPT_REASON="..."` | none |
| skip SRS sync | `--no-sync` | off |
| precision | `--max` | off |
| verification model | `--model <name>` | current session model |
| mini mode, quick mode, 3 rounds | `--mini` | off (skill default cap) |
| loop N times, N rounds | `--loops N` | off (skill default cap) |
| auto gates | `--auto` | off |
| dry run | `--dry-run` | off |
| skip broader regression | `--skip-regression` | off |
| resume | `--resume` | off |

## Workflow

1. Preflight: verify git, test tooling, SpecKiwi MCP availability, active target, and `gh` if a GitHub issue is supplied.
2. Detect input from issue URL, natural-language symptom, or existing working tree changes.
3. Run two isolated root-cause passes: symptom/reproduction and scope/REQ impact.
4. If complexity is large, halt or ask whether to move into the full `$kiwi-srs` -> `$kiwi-planner` flow.
5. Write a regression test and confirm red. If exempted, record the reason and make the reviewer evaluate the exemption.
6. Apply the smallest fix within cwd.
7. Run formal checks and prickly review. Iterate until CRITICAL/HIGH findings are clear.
8. Run the regression test and affected test suite unless explicitly skipped.
9. Delegate to `$kiwi-srs-sync` unless `--no-sync`, dry-run-only, or an unresolved gate blocks it.
10. Write a report and emit a pipeline event.

## Boundaries

Use another skill when:

| Scenario | Skill |
|---|---|
| New feature or non-urgent change | `$kiwi-srs` -> `$kiwi-planner` -> `$kiwi-pm` |
| Code-first SRS catch-up only | `$kiwi-srs-sync` |
| Review/fix without urgent bug context | `$kiwi-review-fix-loop` |
| Commit or PR after fix | `$kiwi-commit-auto-push` or `$kiwi-commit-auto-pr` |

## Extended References

- Read `references/extended-workflow.md` when executing root-cause artifacts,
  regression evidence, review loop counters, sync delegation, or pipeline event
  fields.
