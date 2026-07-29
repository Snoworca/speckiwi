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

## 0. Core Rules (SSOT)

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
| §0.17 | **기존 구조 불가침** (kiwi-coder §0.20 정합). fix 로 green 을 만들기 위한 **기존 테스트 파일 삭제**, **기존 테스트 케이스 제거**, **기존 단언 약화**, **기존 public 심볼의 삭제·시그니처 변경**, **비-테스트 기존 파일의 삭제·이동**을 모두 **금지**한다 — 본 스킬은 kiwi-coder 를 거치지 않는 코드 변경 경로이므로, 여기서 보존 규약이 빠지면 그 우회로가 그대로 열린다. 판정 기준은 kiwi-coder §0.20.1~§0.20.3 를 그대로 따른다. 탐지·차단 = fixer pass 의 diff 스캔 + `existing-test-weakened-or-deleted` / `existing-public-contract-change` / `existing-file-deleted-or-moved` 게이트 |

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
| `mcp-cli-both-unavailable` | `--close-reqs` requires `speckiwi mcp`; CLI diagnostics cannot replace evidence/status mutations | close gate |
| `bulk-close-or-finalize` | requirement closure must be per-REQ with evidence; bulk finalize/archive is forbidden | close gate |
| `existing-test-weakened-or-deleted` | fix diff 에서 기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화 검출 (§0.17) | fix scan |
| `existing-public-contract-change` | fix diff 에서 기존 public 심볼의 삭제 또는 시그니처 변경 검출 — **경로와 무관**하게 critical (§0.17) | fix scan |
| `existing-file-deleted-or-moved` | fix diff 에서 비-테스트 기존 파일의 삭제·이동 검출 (§0.17) | fix scan |

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
| 부모 기준선 | `--regression-baseline <path>` | off (자기 시점 캡처) |

## Workflow

1. Preflight git; for PR mode, verify `gh --version` and authentication; capture
   the regression baseline before any code change (regression baseline section).
2. Decide mode and review scope.
3. Collect review inventory: local diff for self mode, PR comments/reviews for
   PR mode.
4. Classify findings into `immediate_fix`, `discussion_needed`, or `rejected`.
5. For immediate behavioral fixes, create a regression test and confirm red.
6. Run a fixer pass.
7. Run the preservation scan over the fixer diff (보존 스캔 section)
   before the re-review.
8. Run a fresh prickly re-review with isolated input.
9. Iterate until CRITICAL/HIGH findings are clear, regression passes, and the
   evaluator reports three consecutive clean evaluations.
10. Run regression and affected tests.
11. In PR mode, write a response comment unless `--no-respond`.
12. If `--close-reqs`, register per-REQ test evidence and move eligible REQs
    from `implemented` to `verified`.
13. Write report and emit pipeline event.

### 보존 스캔 (fixer diff, §0.17)

fixer pass 가 적용한 **diff** 를 스캔한다 — **기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화**, **기존 public 심볼의 삭제·시그니처 변경**, **비-테스트 기존 파일의 삭제·이동** 중 하나라도 검출되면 **CRITICAL** 로 올리고 `--auto` critical_gates[] 의 대응 게이트(`existing-test-weakened-or-deleted` / `existing-public-contract-change` / `existing-file-deleted-or-moved`)로 중단한다. 판정 기준은 `kiwi-coder §0.20.1~§0.20.3`.

스캔은 까칠 리뷰어 **재검증(re-review)보다 먼저** 수행한다 — 뒤에 두면 약화된 테스트가 먼저 clean 판정을 받는다.

### 회귀 테스트 기준선 캡처 (델타 판정 SSOT)

본 스킬은 kiwi-coder 를 거치지 않는 코드 변경 경로이므로, 회귀 판정도 kiwi-coder §6.1.0 / §6.1.3 과 같은 형태를 쓴다 — 같은 파이프라인 안의 두 수정 주체가 다른 판정을 하면, 한쪽에서 관용되는 사전 실패가 다른 쪽에서 발산 게이트로 올라간다.

- **기준선 캡처**: **코드를 바꾸기 전에** 전체 회귀 스위트를 1회 실행해 기준선 결과를 저장한다. 캡처 시점은 회귀 테스트 작성 이전 (preflight) 이며, 결과는 `state.regression_baseline` 에 고정한다
- **델타 판정**: 회귀 여부는 기준선 대비 **델타로 판정**한다 — 기준선에서 pass 였는데 이번 실행에서 fail 한 test 만 이 fix 가 만든 **신규 실패**다
- **기존 실패 귀속 금지**: 기준선에 이미 있던 **기존 실패**는 그대로 **보고하고** 현재 fix 의 것으로 **귀속하지 않는다** — 남의 실패를 좇는 동안 이 스킬의 개선 루프가 발산한다
- **캡처 실패 격하**: 캡처 자체가 실패하면 (스위트 명령 미검출 등) `state.regression_baseline = null` 로 두고, 이 run 의 회귀 판정은 델타 없이 실패 전량 보고로 격하하며 그 사실을 보고서에 명시한다
- **부모 기준선 우선**: `--regression-baseline` 으로 상위 오케스트레이터가 pin 한 기준선을 받으면 그 값이 자기 시점 캡처보다 **우선한다** — 값이 주어지면 자체 캡처를 수행하지 않고 전달된 기준선을 `state.regression_baseline` 에 그대로 고정한다. 방금 만들어진 실패를 "기존 실패"로 분류해 `TASK_DONE` 을 반환하는 것이 wave 게이트와 정면으로 어긋나기 때문이다.

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
