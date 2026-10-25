---
name: kiwi-hot-fix
description: "Urgent Kiwi hot-fix workflow for production bugs, GitHub issues, or reported regressions when the full SRS to pm to coder pipeline is too slow. Delegates root-cause analysis and reproduction to kiwi-bug-repro, whose reproduction test becomes the regression test (no fix when it cannot reproduce, finds the behaviour is not a bug, or reproduces it without an automated test; a working-tree change is reproduced in a temporary git worktree), and keeps SpecKiwi governance through prickly review, regression checks, and post-fix SRS sync through kiwi-srs-sync. Use for kiwi hot fix, hotfix, urgent fix, 긴급 수정, production issue, 이 이슈 고쳐줘, or 빠르게 고쳐줘. Supports --auto, --model, --max, --dry-run, --no-sync, --skip-regression, --resume."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

# kiwi-hot-fix

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

Handle an urgent bug fix without pretending the spec-first workflow disappeared:
reproduce it through `$kiwi-bug-repro`, take its reproduction test as the regression
test, make the smallest fix, run a strict review, then delegate SRS catch-up to
`$kiwi-srs-sync`.

This skill does not bypass repository stability blockers. If an affected REQ is
`draft` or `deprecated`, halt unless the user explicitly overrides the project
workflow. If `--no-sync` is used, run the stability gate before any behavior
change and report that SRS synchronization was intentionally skipped.

## Official Workflow Tool Policy

For covered workflow artifact flows, use official SpecKiwi workflow tools before raw file reads:

1. Read the resume state through MCP `workflow_resolve_artifact` with the run's `runId`, `kind` `coder-state` and `includeBody` `true` (the `.kiwi/sessions/{run-id}/state.json` this skill resumes from), and `workflow_worklog_tail`, before reading `.kiwi/sessions`, worklogs, or pipeline JSONL directly.
2. Raw file fallback is degraded mode. It is allowed only after capturing tool diagnostics, affected artifact paths, active target, and a follow-up requirement or candidate ID in `state.json`, the run report, or worklog.

## Core Rules

| Key | Rule |
|---|---|
| §0.1 | TDD is required: the reproduction test `$kiwi-bug-repro` returns is the regression test — red before the fix, and the same test green after it — unless `TDD_EXEMPT_REASON` is explicit and defensible. This skill keeps no root-cause analysis or reproduction procedure of its own. |
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
| `fix-complexity-large` | large work should enter the full SRS/SDS pipeline | scope check after the reproduction |
| `bug-not-reproduced` | `$kiwi-bug-repro` used all three stages without reproducing the symptom, or reproduced it without an automated test and no `TDD_EXEMPT_REASON` was given; its question or outcome goes to the user and no fix is applied | after the reproduction |
| `bug-not-a-bug` | `$kiwi-bug-repro` found the reproduced behaviour is what the SRS or a documented contract specifies; no fix is applied and a requirement change goes to `$kiwi-srs` | after the reproduction |
| `bug-input-insufficient` | `$kiwi-bug-repro` could not read the issue or found neither the expected nor the actual behaviour; only the user holds what is missing | after the reproduction |
| `repro-base-moved` | on `--resume`, HEAD differs from the reproduction worktree's base commit (`repro_base`); copying now could undo a commit the user made while the run waited | after the reproduction |
| `repro-dirty-tree` | an issue or symptom input arrived on a working tree with uncommitted changes, which would mix with the fix; only the user decides whether to commit them, set them aside or call them the fix | before the reproduction or before an existing report is used |
| `bug-repro-question` | `$kiwi-bug-repro` stopped with a question (`repro-restore-conflict`, say) instead of an outcome; only the user holds the answer | after the reproduction |
| `repro-worktree-unprepared` | the HEAD worktree of a git-status input cannot get its dependencies from the lockfile; only the user knows how to install them | before the reproduction |
| `repro-path-occupied` | a path the reproduction test or report would be copied to already holds a file in the user's tree; copying would overwrite their uncommitted edits | after the reproduction |
| `zero-tolerance-hypothesis-fix-mismatch` | fix does not match the accepted root-cause hypothesis | fix review |
| `mock-detection` | mock shortcut detected in a bug fix | test/fix scan |
| `mcp-unavailable` | SRS sync requires `speckiwi mcp`; CLI diagnostics cannot replace sync mutations | preflight |
| `improvement-loop-divergence-4opt` | repeated fix/review/regression failure needs user decision | improvement loop |
| `test-sufficiency-gap` | citation gaps remain after the one fill attempt of the test-sufficiency check run before the sync delegation (`../_shared/kiwi/test-sufficiency.md`) | before the sync delegation |

## Inputs

| Signal | Argument | Default |
|---|---|---|
| GitHub issue URL | `ISSUE_URL=...` | auto-detect from prompt |
| natural language symptom | prompt text | required if no issue/status source |
| file scope | `SCOPE_FILES=a,b` | infer from git status and code search |
| TDD exception | `TDD_EXEMPT_REASON="..."` | none |
| existing kiwi-bug-repro report | `BUG_REPRO_REPORT=docs/analysis/kiwi-bug-repro-{run-id}/` | none (looked up in the previous pipeline event) |
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
2. Detect input from issue URL, natural-language symptom, or existing working tree changes; for working tree changes, also ask which symptom the change fixes.
3. Before any call: with `TDD_EXEMPT_REASON`, skip only the reproduction test — call `$kiwi-bug-repro --analysis-only` for the ordered causes, record the reason and make the reviewer evaluate the exemption. With `BUG_REPRO_REPORT`, or when the previous pipeline event is a `kiwi-bug-repro` run on the same input, use that report instead of reproducing again.
4. Otherwise invoke `$kiwi-bug-repro` with the detected input and `--no-pipeline-emit` (Root Cause And Reproduction in `references/extended-workflow.md`). A working-tree input is reproduced in a temporary `git worktree` of HEAD; this skill never stashes, resets or checks out the user's change. The worktree's dependencies are prepared first, and the reproduction test is copied into the user's working tree only to paths where no file exists and only when `$kiwi-bug-repro` created it (an edited file only when the user's copy equals the worktree's base commit); otherwise the run stops and asks the user. Also: the worktree's base commit is recorded, an abandoned run rolls nothing back, and an issue input on a dirty tree stops first.
5. When it cannot reproduce, reports not a bug or insufficient input, or reproduces without an automated test and no `TDD_EXEMPT_REASON` was given, stop with that outcome and apply no fix, also under `--auto`.
6. Check the scope from its result; if complexity is large, stop at `fix-complexity-large` and recommend the full `$kiwi-srs` -> `$kiwi-pm` flow.
7. Take the returned reproduction test as the regression test and confirm it is red before the fix (in the temporary worktree for a working-tree input).
8. Apply the smallest fix within cwd, aimed at the returned most likely cause; for a working-tree input, complete the user's change instead of adding a second fix.
9. Run formal checks and prickly review. Iterate until CRITICAL/HIGH findings are clear.
10. Run the same reproduction test (green) and the affected test suite unless explicitly skipped.
11. Unless the delegation is skipped, run the test-sufficiency check of `../_shared/kiwi/test-sufficiency.md` over the high-confidence candidate REQ IDs (Sync Delegation in `references/extended-workflow.md`).
12. Delegate to `$kiwi-srs-sync` unless `--no-sync`, dry-run-only, or an unresolved gate blocks it.
13. Write a report and emit a pipeline event. When the run completes, ends at `bug-not-a-bug` or is abandoned, remove the temporary worktree if there is one; keep it while the run waits for the user's answer.

## Boundaries

Use another skill when:

| Scenario | Skill |
|---|---|
| New feature or non-urgent change | `$kiwi-srs` -> `$kiwi-pm` (`$kiwi-sds` in between under `--sds`) |
| Code-first SRS catch-up only | `$kiwi-srs-sync` |
| Confirm and reproduce a bug without fixing it | `$kiwi-bug-repro` |
| Review/fix without urgent bug context | `$kiwi-review-fix-loop` |
| Commit or PR after fix | `$kiwi-commit-auto-push` or `$kiwi-commit-auto-pr` |

## Extended References

- Read `references/extended-workflow.md` when executing the kiwi-bug-repro
  delegation, regression evidence, review loop counters, sync delegation, or pipeline event
  fields.
