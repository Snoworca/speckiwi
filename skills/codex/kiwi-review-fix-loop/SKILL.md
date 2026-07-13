---
name: kiwi-review-fix-loop
description: "Run a Kiwi review, fix, and re-review loop for current working-tree changes or GitHub PR review comments. Use for kiwi review fix loop, self review, code review loop, PR comments apply, 리뷰 수정 루프, 셀프 리뷰, or 머지 전 품질 게이트. Enforces sub-agent review/fix separation, regression checks, CRITICAL/HIGH-zero exit, optional PR responses, and optional --close-reqs per-REQ verified transition through speckiwi MCP. Supports --pr, --files, --since, --commits, --base/--head, --auto, --model, --max, --dry-run, --no-respond, --close-reqs, and --resume."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

# kiwi-review-fix-loop

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

Run a code review, apply clear fixes, then re-review until the gate is clean.
Self mode reviews local changes. PR mode reads GitHub PR comments and applies
accepted fixes with optional response comments.

The main session orchestrates only. Code review and code modification must be
performed by separate delegated workers or clearly separated passes.

## Core Rules

| Key | Rule |
|---|---|
| §0.1 | Review and fix are separate roles. Do not let the fixer validate their own work. |
| §0.2 | Reviewer input must not include the fixer's rationale or preferred answer. |
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

## Inputs

| Signal | Argument | Default |
|---|---|---|
| PR mode | `--pr`, `-pr`, `--PR`, `-PR`, or `--pr=<url>` | off |
| file scope | `--files=a,b` | working tree |
| commit/range scope | `--commits=HEAD~3`, `--since=YYYY-MM-DD`, `--base=main --head=HEAD` | working tree |
| precision | `--max` | off |
| verification model | `--model <name>` | current session model |
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
3. Collect review inventory: local diff for self mode, PR comments/reviews for PR mode.
4. Classify findings into `immediate_fix`, `discussion_needed`, or `rejected`.
5. For immediate behavioral fixes, create a regression test and confirm red.
6. Delegate fixes to a fixer pass.
7. Run a fresh prickly re-review with isolated input.
8. Iterate until CRITICAL/HIGH findings are clear.
9. Run regression and affected tests.
10. In PR mode, write a response comment unless `--no-respond`.
11. If `--close-reqs`, register per-REQ test evidence and move eligible REQs from `implemented` to `verified`.
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
