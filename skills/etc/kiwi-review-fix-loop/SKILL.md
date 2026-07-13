---
name: kiwi-review-fix-loop
description: "OpenCode/Hermes local-LLM variant for running a Kiwi review, fix, and re-review loop over local changes or GitHub PR comments. Enforces role separation, regression checks, CRITICAL/HIGH-zero exit, optional PR responses, and guarded --close-reqs per-REQ verified transition through speckiwi mcp. Defaults to --max with one evaluator/worker and three clean evaluations. Triggers: kiwi review fix loop, self review, code review loop, PR comments apply, 리뷰 수정 루프."
---

# kiwi-review-fix-loop

> etc local-LLM profile: read `../_shared/kiwi/local-llm-profile.md` before executing. It requires working `speckiwi mcp`, treats `--max` as the default, disables multi-worker fanout, uses one delegated worker/evaluator at a time, and advances only after three consecutive no-improvement evaluations.

**etc override:** If any legacy section appears to allow CLI mutation fallback or
direct normal SRS Markdown mutation, the shared etc local-LLM profile wins:
normal SRS operations require `speckiwi mcp`; CLI is diagnostic/remediation only.

Run a code review, apply clear fixes, then re-review until the gate is clean.
Self mode reviews local changes. PR mode reads GitHub PR comments and applies
accepted fixes with optional response comments.

The main session orchestrates only. Code review and code modification must be
performed by separate delegated workers or clearly separated passes, but never
as multi-worker fanout.

## Core Rules

| Key | Rule |
|---|---|
| §0.1 | Review and fix are separate roles. Do not let the fixer validate their own work. |
| §0.2 | Reviewer input must not include the fixer rationale or preferred answer. |
| §0.3 | Behavioral, bug, regression, security, or performance findings need a regression test before the fix unless the finding is explicitly non-behavioral. |
| §0.4 | Mock shortcuts, cwd-external edits, and signature text are critical violations. |
| §0.5 | Normal mode does not mutate SRS. `--close-reqs` is the only opt-in SRS mutation path and it is self-mode only. |
| §0.6 | `--close-reqs` may only move high-confidence impacted requirements from `implemented` to `verified` after evidence is registered per requirement. No bulk finalize, archive, or target-emptying behavior is allowed. |
| §0.7 | `--auto` follows `../_shared/kiwi/auto-option.md`. Finding classification remains local policy; `--auto` only governs user-decision gates. |
| §0.8 | Emit pipeline events through `../_shared/kiwi/pipeline-event.md`. |
| §0.9 | **`--mini` / `--loops N` option SSOT**. This skill follows `../_shared/kiwi/loop-option.md` v1.0. `--mini` = verify/improve loop round cap 3; `--loops N` = round cap N (integer ≥1). If both are given, **`--loops` wins (warn)**. Orthogonal to `--max` (compose). On reaching the cap, report residual findings (no safety-gate bypass) |

### `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `classifier-fix-hypothesis-fail-fallback` | classifier cannot produce a safe fix hypothesis | classification |
| `close-reqs-with-pr-mode` | PR mode cannot close requirements directly | close gate |
| `close-reqs-with-regression-fail` | verified transition requires passing regression evidence | close gate |
| `close-reqs-critical-or-high-residual` | unresolved CRITICAL/HIGH findings block verified transition | close gate |
| `external-module-impact` | cwd-external edits need explicit approval | fix gate |
| `improvement-loop-divergence-4opt` | repeated loop failure needs user decision | review loop |
| `mock-detection` | mock shortcut is a critical violation | fix scan |
| `pr-mode-gh-unavailable` | PR mode requires authenticated GitHub CLI | preflight |
| `mcp-unavailable` | `--close-reqs` requires `speckiwi mcp`; CLI diagnostics cannot replace evidence/status mutations | close gate |
| `bulk-close-or-finalize` | requirement closure must be per-REQ with evidence; bulk finalize/archive is forbidden | close gate |

## Inputs

| Signal | Argument | Default |
|---|---|---|
| PR mode | `--pr`, `-pr`, `--PR`, `-PR`, or `--pr=<url>` | off |
| file scope | `--files=a,b` | working tree |
| commit/range scope | `--commits=HEAD~3`, `--since=YYYY-MM-DD`, `--base=main --head=HEAD` | working tree |
| precision | `--max` | default on |
| auto gates | `--auto` | off |
| dry run | `--dry-run` | off |
| skip PR response | `--no-respond` | off |
| close implemented REQs | `--close-reqs` | off |
| resume | `--resume` | off |
| mini mode | `--mini` | off (skill default cap) |
| loop round cap | `--loops N` | off (skill default cap) |

## Workflow

1. Preflight git; for PR mode, verify `gh --version` and authentication.
2. Decide mode and review scope.
3. Collect review inventory: local diff for self mode, PR comments/reviews for
   PR mode.
4. Classify findings into `immediate_fix`, `discussion_needed`, or `rejected`.
5. For immediate behavioral fixes, create a regression test and confirm red.
6. Run a fixer pass.
7. Run a fresh prickly re-review with isolated input.
8. Iterate until CRITICAL/HIGH findings are clear, regression passes, and the
   evaluator reports three consecutive clean evaluations.
9. Run regression and affected tests.
10. In PR mode, write a response comment unless `--no-respond`.
11. If `--close-reqs`, register per-REQ test evidence and move eligible REQs
    from `implemented` to `verified`.
12. Write report and emit pipeline event.

## `--close-reqs` Gate

Skip or halt when:

| Condition | Action |
|---|---|
| `--close-reqs` absent | no SRS mutation |
| PR mode | halt; close after merge or in self mode |
| regression failed or skipped without evidence | halt |
| CRITICAL/HIGH finding remains | halt |
| no high-confidence impacted REQ | skip and report |
| impacted REQ stability is `draft` or `deprecated` | skip that REQ |
| impacted REQ status is not `implemented` | skip that REQ |

For each eligible REQ:

1. Add verification evidence with `type="test"` and a concrete test/report path.
2. Then call `update_status` to `verified`.
3. Log each call and result.

## Extended References

- Read `references/extended-workflow.md` when executing PR comment collection,
  finding schemas, regression handling, close-reqs MCP mutation, PR responses,
  or pipeline event fields.
