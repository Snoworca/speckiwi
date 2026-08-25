---
name: kiwi-review-fix-loop
description: "Run a Kiwi review, fix, and re-review loop for current working-tree changes or GitHub PR review comments. Code only: prose such as SKILL.md, README, SRS documents and research notes is neither reviewed nor edited. Use for kiwi review fix loop, self review, code review loop, PR comments apply, 리뷰 수정 루프, 셀프 리뷰, or 머지 전 품질 게이트. Enforces sub-agent review/fix separation, regression checks, CRITICAL/HIGH-zero exit, optional PR responses, and optional --close-reqs per-REQ verified transition through speckiwi MCP. Supports --pr, --files, --since, --commits, --base/--head, --auto, --model, --max, --dry-run, --no-respond, --close-reqs, and --resume."
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

## 0. Core Rules (SSOT)

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
| `empty-code-scope` | no code target survives the class filter (파일 부류 경계) | 파일 부류 경계 |
| `existing-file-deleted-or-moved` | fix diff 에서 비-테스트 기존 파일의 삭제·이동 검출 (§0.17) | fix scan |

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
| 부모 기준선 | `--regression-baseline <path>` | off (자기 시점 캡처) |
| suppress pipeline event | `--no-pipeline-emit` (takes no argument — suppresses the `kiwi/pipeline.jsonl` append) | off (emit as usual) |

## Workflow

1. Preflight git; for PR mode, verify `gh --version` and authentication; capture
   the regression baseline before any code change (regression baseline section).
2. Decide mode and review scope.
3. Collect review inventory: local diff for self mode, PR comments/reviews for PR mode.
4. Classify findings into `immediate_fix`, `discussion_needed`, or `rejected`.
5. For immediate behavioral fixes, create a regression test and confirm red.
6. Delegate fixes to a fixer pass.
7. Run the preservation scan over the fixer diff (보존 스캔 section)
   before the re-review.
8. Run a fresh prickly re-review with isolated input. Prose never enters that input
   (파일 부류 경계 section); the prose delta protocol belongs to
   `../_shared/kiwi/verify-loop.md` §10 and is not this skill's to run.
9. Iterate until CRITICAL/HIGH findings are clear.
10. Run regression and affected tests.
11. In PR mode, write a response comment unless `--no-respond`.
12. If `--close-reqs`, register per-REQ test evidence and move eligible REQs from `implemented` to `verified`.
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
| a target requirement rests on **prose** as verification **evidence** | this skill does not close it; report the omission instead — it reviews only code (파일 부류 경계), so it cannot run the full-document audit `FR-FLOW-136` AC-6 gates the close with, and an obligation a skill cannot discharge is not a gate. **No pipeline path closes such a requirement automatically** — a person audits and closes it. Say so in the report, so an unclosed requirement does not read as a failure |
| no high-confidence impacted REQ | skip and report |
| impacted REQ stability is `draft` or `deprecated` | skip that REQ |
| impacted REQ status is not `implemented` | skip that REQ |

For each eligible REQ:

1. Add verification evidence with `type="test"` and a concrete test/report path.
2. Then call `update_status` to `verified`.
3. Log each call and result.


### Orchestration delegation — `--no-pipeline-emit`

- **`--no-pipeline-emit`** takes no argument. When present, this skill does not append its
  `kiwi/pipeline.jsonl` emit. Without the flag the existing emit behaviour is unchanged.
- The orchestrator's executor passes `--no-pipeline-emit` on **every unit** run. Omitting it makes
  the unit write a **false pipeline record**: the journal would show one `kiwi-review-fix-loop` run
  completing where in fact one unit of one stage of one wave completed, and a parent may not record
  on a child's behalf to correct it.
- `kiwi-pipeline` does not gain `--no-pipeline-emit` — no orchestrated unit invokes it.

## 11. 파일 부류 경계 — 이 스킬이 무엇을 보는가

본 스킬은 **코드를 리뷰한다.** 그런데 "코드" 는 형용사이고 형용사는 우기는 대상이 되므로, 대상은 아래 **닫힌 목록**으로 정한다. 목록에 없는 부류는 대상이 아니다.

| 부류 | 대상 | 사유 |
|---|---|---|
| 소스 코드 파일 | ○ | 본 스킬의 존재 이유 |
| 테스트 파일 | ○ | **테스트 파일은 코드다.** 범위에서 빼면 §0.17 의 `existing-test-weakened-or-deleted` 게이트가 지킬 대상을 잃는다 |
| 설정 파일 — `package.json` · `tsconfig.json` · CI yaml 등 **파일명으로 지명한 것** | ○ | **설정 파일은 코드다.** 실행 동작을 바꾸고 결함이 빌드·테스트로 재현된다 |
| 코드 파일 안의 주석 | ○ | **주석은 코드다.** 다만 강도는 종전대로다 — `@req` 실존은 기계 검사, 안전 게이트에 붙은 why-주석은 작성 시점 1회, 코드를 재서술하는 주석은 리뷰가 아니라 삭제다 |
| `SKILL.md` 등 에이전트 지시문 | ✗ | 산문이며 계약 등급이다. 이 루프가 자기를 구속하는 규칙을 고치는 경로는 열지 않는다 |
| `README.md` | ✗ | 산문이다 |
| `docs/spec/**` 의 SRS 문서 | ✗ | 산문이며, 그 전에 Core Rules 가 이미 SRS mutation 을 금지한다. SRS 변경이 걸린 finding 은 `/kiwi-srs-sync` 에 위임을 권고한다 |

**판정 순서** — 아래 순서로 평가하며 앞선 행이 뒤의 행을 이긴다. 순서를 적지 않으면 두 규칙이 모두 참인 채로 같은 파일을 반대로 판정한다.

1. **가장 먼저, 아래 목록을 거부한다.** `*.jsonl` 저널 · `*.lock` · `*.lock.json` · `resume-card.json` · run contract · `routing/probe.json` · `design/constraints.json` 을 **수정·삭제·되돌리지 않는다.** 이 목록의 구성 원리는 **run 이 동결로 선언한 것**이며, 새 동결 산출물이 생기면 그 원리에 따라 **목록에 추가한다.** 원리를 기준 자체로 삼지 않는 이유는 이 스킬이 그 선언에 닿을 인자를 갖고 있지 않기 때문이다 — 읽을 수 없는 기준은 "확인할 수 없으니 동결된 것이 없다"로 처리되어 fail-open 이 되고, 그러면 `.lock.json` 이 아닌 동결 산출물이 위 표의 "설정 파일은 코드다" 행에 그대로 삼켜진다. 닫힌 목록은 그 방향이 반대다. 되돌린 lock 한 줄은 오류를 내지 않고 다음 재개에서야 터진다. 자기 run 이 소유한 아티팩트에 **append 하는 것은 허용**한다.
2. 위 표의 부류 판정.
3. 앞의 세 처분(포함 · `excluded_prose` · `refused_artifacts`) 어디에도 들지 않는 것(바이너리·에셋 등)은 `unclassified_files[]` 에 싣는다. 버킷을 늘리는 것이 항등식을 포기하는 것보다 낫다 — 분류되지 않은 파일이 조용히 사라지면 항등식이 그것을 숨긴다.
4. 남은 것이 리뷰 대상이다.

**범위 결정과의 관계** — 본 절은 Inputs 절의 범위 결정이 산출한 후보 목록에 붙는 **후처리**이며 그 범위 결정을 대체하지 않는다. 부류 필터는 후보 목록이 만들어진 **직후**, 까칠 리뷰어를 spawn 하기 **전**에 적용한다. 뒤에 두면 고칠 수 없는 finding 이 심각도 게이트의 `CRITICAL=0 + HIGH=0` 카운터에 들어가, 루프가 영원히 통과하지 못하거나 게이트를 맞추려고 결국 그 문서를 고치게 된다.

**커밋 창은 사람의 지목이 아니다** — `--base`/`--head` · `--commits` · `--since` 는 부류 필터를 **면제하지 않는다.** `kiwi-orchestrator` 는 §15 일정에 따라 `docs/research/{work}/` 아래 run 아티팩트를 커밋한 **다음** 그 커밋 범위를 이 스킬에 창으로 넘긴다. 연구·설계 산문이 실제로 리뷰에 들어온 경로가 이것이며, 창을 지목으로 인정하면 주 경로가 그대로 필터를 면제받는다. **`--files` 만** 사람이 파일을 지목한 것으로 인정하고, 그 목록에 든 산문은 제외 사실과 사유를 **보고**한 뒤 코드만 진행한다. 지목이 전부 산문이면 진행하지 않는다.

**제외는 전수 열거한다** — 제외한 산문을 `mode_decision.json.self_scope.excluded_prose[]` 에 **빠짐없이** 싣고 보고서에도 그대로 낸다. 개수나 표본으로 줄이지 않는다. 판정 순서 1 이 거부한 저널·lock 은 `refused_artifacts[]` 에 따로 싣는다 — 코드도 산문도 아니므로 어느 쪽 버킷에 넣어도 이름을 속이게 된다. 그리고 **항등식**이 성립해야 한다: 포함한 파일 수와 `excluded_prose[]` 와 `refused_artifacts[]` 와 `unclassified_files[]` 의 수를 더한 값이 후보 수와 같아야 한다. 항등식이 없으면 규칙을 지킨 run 과 규칙을 잊은 run 이 똑같은 산출물을 남긴다.

**빈 범위는 통과가 아니다** — 필터 후 코드 대상이 **0건**이면 PASS 를 보고하지 않고 `empty-code-scope` 로 **중단**한다. 아무것도 보지 않은 실행이 품질 게이트 통과로 기록되면, 빈 기준선이 깨끗한 기준선과 구별되지 않는다.

**알려진 한계**: 후보가 처음부터 전부 산문이면 이 중단이 오케스트레이터의 종료 hop 과 충돌한다. 그 hop 은 통과 판정을 기록하는 모든 경계가 이 스킬을 정확히 한 번 거치도록 요구하는데, 준비된 면제 분기의 술어는 **커밋 창의 공백**이라 산문 커밋이 든 창에는 걸리지 않는다. 요구나 설계 문서만 산출한 wave 가 여기 해당한다. 해소하려면 `FR-FLOW-131` 이 소유한 그 술어를 넓히거나 별도 verdict 을 도입해야 하며, 둘 다 요구 수준의 결정이라 이 절이 정하지 않는다. **`FR-FLOW-152` 의 후속으로 남긴다.**

**산문 finding 은 어디로 가는가** — 부류 밖 문서에서 눈에 띈 문제는 SRS finding 에 쓰는 것과 같은 채널로 흘린다: 고치지 않고 보고하며, 담당 스킬을 지목해 위임을 권고한다.

---

## Extended References

- Read `references/extended-workflow.md` when executing PR comment collection,
  finding schemas, regression handling, close-reqs MCP mutation, PR responses,
  or pipeline event fields.
