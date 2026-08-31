---
name: kiwi-review-fix-loop
description: "OpenCode/Hermes local-LLM variant for running a Kiwi review, fix, and re-review loop over local changes or GitHub PR comments. Code only: prose such as SKILL.md, README, SRS documents and research notes is neither reviewed nor edited. Enforces role separation, regression checks, CRITICAL/HIGH-zero exit, optional PR responses, and guarded --close-reqs per-REQ verified transition through speckiwi mcp. Defaults to --max with one evaluator/worker and three clean evaluations. Triggers: kiwi review fix loop, self review, code review loop, PR comments apply, 리뷰 수정 루프."
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
| §0.6 | `--close-reqs` allows exactly three mutations and only in self mode: `add_verification_evidence` (type=test), `check_acceptance_criteria` (per criterion, after the test that passed it is named), and `update_status` (`implemented` to `verified`, forward-only). It may only move high-confidence impacted requirements. No bulk finalize, archive, or target-emptying behavior is allowed. |
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
| `review-coverage-mismatch` | 리뷰 커버리지 대조 실패가 2회 연속 — 무효 라운드만 쌓이며 cap 을 소진한다 (리뷰 커버리지 분모) | 리뷰 커버리지 분모 |
| `existing-file-deleted-or-moved` | fix diff 에서 비-테스트 기존 파일의 삭제·이동 검출 (§0.17) | fix scan |
| `validate-spec-error` | `validate_spec` returns at least one error-severity diagnostic — evidence and promotion stacked on a requirement that carries an error cannot be read back to what admitted them | before the `--close-reqs` promotion |

**Where this gate is observed**: at the hop this row's third cell names, run MCP `validate_spec` — the CLI fallback is `speckiwi validate --json`. While any error-severity diagnostic remains, do not proceed with that hop: halt at `validate-spec-error`, which `--auto` does not lift. Never record a pass without having run it.

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
| suppress pipeline event | `--no-pipeline-emit` (takes no argument — suppresses the `kiwi/pipeline.jsonl` append) | off (emit as usual) |

## Workflow

1. Preflight git; for PR mode, verify `gh --version` and authentication; capture
   the regression baseline before any code change (regression baseline section).
2. Decide mode and review scope.
3. Fix the review denominator before spawning the reviewer: carry the included
   bucket into `review_denominator[]` and count each file's `hunks_total`
   yourself (리뷰 커버리지 분모 section).
4. Collect review inventory: local diff for self mode, PR comments/reviews for
   PR mode.
5. Classify findings into `immediate_fix`, `discussion_needed`, or `rejected`.
6. For immediate behavioral fixes, create a regression test and confirm red.
7. Run a fixer pass.
8. Run the preservation scan over the fixer diff (보존 스캔 section)
   before the re-review.
9. Run a fresh prickly re-review with isolated input. Prose never enters that input
   (파일 부류 경계 section); the prose delta protocol belongs to
   `../_shared/kiwi/verify-loop.md` §10 and is not this skill's to run.
10. Iterate until CRITICAL/HIGH findings are clear, regression passes, and the
   evaluator reports three consecutive clean evaluations.
    **커버리지 대조를 통과한 라운드만 PASS 가 된다** — finding 개수만으로는 PASS 가 나오지 않는다. 대조 결과는 리뷰 커버리지 분모 section 이 정하며, 무효 라운드는 어느 행에도 해당하지 않는다.
11. Run regression and affected tests.
12. In PR mode, write a response comment unless `--no-respond`.
13. If `--close-reqs`, register per-REQ test evidence and move eligible REQs
    from `implemented` to `verified`.
14. Write report and emit pipeline event.

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
| `scoped` is empty | skip, and report the denominator's size and why the intersection came out zero |
| `eligible` is at least one and `transitioned` is zero | NOT `TASK_DONE`; end `FAILED` and report |
| `transitioned + excluded` does not equal `scoped` | the run is invalid; end `FAILED` and enumerate the requirements that received no disposition |
| impacted REQ stability is `draft` or `deprecated` | skip that REQ |
| impacted REQ status is not `implemented` | skip that REQ. It is outside the denominator, so it enters neither `scoped` nor the accounting identity |

For each eligible REQ:

1. Call `add_verification_evidence` with `type="test"` and a concrete test/report path, once for each
   acceptance criterion the change touched, naming that criterion in `covers`.
2. Call `check_acceptance_criteria` for those criteria. **For each acceptance criterion, name the test
   identifier that passed it first** — a file path and test name, or the `reference` step 1 registered
   under `covers` for that same criterion. **Do not check a criterion for which no such identifier is
   named**: leave it out of `acIds` and record the requirement as skipped. Checking is a mutation, so a
   criterion ticked without a named test satisfies the gate in form only.
3. Then call `update_status` to `verified`. `update-status.ts` requires every criterion checked AND
   evidence present, so a transition attempted without step 2 returns `MUTATION_DENIED`.
4. Log each call and result.


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

## 12. 리뷰 커버리지 분모 — 리뷰어가 무엇을 열었는가

§11 의 항등식과 본 절은 대상이 다르다. 항등식은 후보 파일이 **어느 버킷에 들어갔는지**를 세고, 본 절은 포함 버킷의 **각 hunk 를 리뷰어가 실제로 처리했는지**를 대조한다. 그러므로 항등식이 성립한다는 사실이 본 절을 대신하지 못한다 — 범위를 고르는 단계에는 분모가 있는데 그 범위를 읽는 단계에는 없었다는 것이 이 절이 생긴 이유다.

**분모는 루프가 고정한다.** 까칠 리뷰어를 spawn 하기 전에, 범위 결정이 산출한 `self_scope.files[]`(§11 의 포함 버킷)를 그대로 `review_denominator[]` 로 옮겨 리뷰어 프롬프트에 싣는다. 리뷰어가 스스로 정하지 않는다. 산문은 애초에 이 집합에 들어오지 않으므로(§11) 분모에도 넣지 않는다.

**`hunks_total` 은 루프가 센다 — 리뷰어가 세지 않는다.** 분모의 파일마다 아래 명령으로 세어 `review_denominator[]` 의 각 항목에 `hunks_total` 로 함께 싣는다.

```
git diff -U0 <범위> -- <path> | grep -c '^@@'
```

`<범위>` 는 `self_scope.source` 가 정한 그 범위다. `-U0` 을 쓰는 이유는 컨텍스트 줄이 인접 hunk 를 병합해 개수를 줄이기 때문이다. **분모를 만든 범위, `hunks_total` 을 센 범위, 앵커를 대조하는 범위는 셋 다 같아야 한다** — 다르면 리뷰어가 아무 잘못 없이 무효 라운드를 받는다.

**리뷰어 출력에 `coverage_rows[]` 가 추가된다.** `review_denominator[]` 의 **모든** 파일이 한 행씩 갖고, 각 행은 그 파일의 앵커 목록과 finding 이 붙었는지를 밝힌다. finding 0건인 파일도 행으로 남는다. 표본·발췌·상위 N 은 분모가 아니다.

**리뷰어는 hunk 마다 앵커 하나를 돌려준다.** 앵커는 그 hunk 안에서 **추가되거나 삭제된 줄**(`git diff -U0` 출력에서 `+` 또는 `-` 로 시작하되 `+++`·`---` 파일 헤더가 아닌 줄) 하나를 그대로 옮긴 인용이거나, 그 줄에서 추가·삭제된 심볼 이름이다. **`@@` 헤더 줄과 파일 경로는 앵커가 될 수 없다** — 그 둘은 루프가 이미 넘긴 값에서 그대로 만들어 낼 수 있으므로 그 hunk 를 열었다는 증거가 되지 못한다.

**루프가 앵커를 기계 대조한다.** 검사는 셋이다.

1. 각 앵커 문자열이 `git diff -U0` 출력의 **해당 hunk 본문 안**에 실제로 있다. **"있다"는 위 정의를 만족한다는 뜻이다** — 그 hunk 의 추가·삭제된 줄 하나와 **통째로 같거나**(앞뒤 공백만 다른 것은 같은 것으로 본다), 그 줄에 **토큰 경계로 실재하는 심볼 이름**이어야 한다 — **심볼 이름은 코드 토큰을 말하며, 산문의 낱말은 심볼 이름이 아니다.** **줄의 임의의 부분문자열은 앵커가 아니다.** 정의를 적어 두는 것과 검사가 그 정의를 강제하는 것은 다르고, 강제하지 않으면 정의는 아무것도 막지 못한다 — 부분문자열을 인정하면 diff 를 한 줄도 열지 않고 고른 흔한 한 글자 N 개가 서로 다른 hunk 에 하나씩 대응해 한 행을 통째로 채운다.
2. 한 파일 안에서 앵커 개수가 `hunks_total` 과 같고, 서로 다른 hunk 에 하나씩 대응한다. 개수만 맞추면 한 hunk 에서 뽑은 앵커 N 개가 통과한다.
3. **한 행 안에서 같은 앵커 문자열을 두 번 쓰지 않는다.** 막지 않으면 diff 전체에서 흔한 한 줄을 골라 그 행을 통째로 채우는 출력이 통과한다. 반대로 **서로 다른 행이 같은 문자열을 앵커로 갖는 것은 막지 않는다** — 여러 파일에 같은 줄이 추가되는 변경(공통 import 가 대표적)에서는 정직한 리뷰어의 앵커도 행 사이에서 겹치므로, 행 사이까지 금지하면 잘못 없는 라운드가 무효가 된다. 겹친 문자열도 검사 1 이 파일마다 따로 확인하니 근거 없이 겹칠 수는 없다.

**하나라도 어긋나면 그 라운드는 무효다.** cap 은 소비하되 PASS 로 기록하지 않으며, 무효 판정 로그에 어긋난 앵커 문자열을 그대로 남긴다 — 재사용은 개수만 세면 보이지 않고 문자열을 나란히 놓아야 눈에 띈다. **무효 라운드가 2회 연속이면 `review-coverage-mismatch` 로 중단하고 `--auto` 가 이 중단을 덮지 못한다** (게이트 선언은 `critical_gates[]` 표에 있다). 파일이 많으면 리뷰어가 행 열거를 중간에서 잘라 돌려주고 모든 라운드가 무효가 되어 cap 만 소비하는데, 그것이 이 설계에서 아무 일도 일어나지 않는 것처럼 보이는 유일한 실패 형태이기 때문이다. 그때는 분모를 쪼개 리뷰어를 여럿으로 나누고 각자에게 자기 몫의 분모를 고정해 준다. **분모 단위를 파일보다 굵게 올리거나 앵커를 파일당 하나로 줄이지 않는다.**

**이 대조가 보장하지 않는 것** — 앵커 대조는 리뷰어가 그 hunk 를 **이해했다는 것을 보장하지 않으며, 리뷰 품질을 재지 않는다.** 보장하는 것은 **분모의 모든 파일이 행으로 열거되고, 적힌 앵커 하나하나가 그 hunk 에 실재한다**는 데까지다 — **리뷰어가 diff 를 열었다는 것까지는 보장하지 않는다.** 앵커를 못 채우면 그 hunk 를 건드리지 않았다는 사실이 산출물에 남고, 틀린 앵커를 채우면 대조가 그것을 잡는다. 개수 대조에는 이 두 성질이 모두 없다 — `hunks_total` 은 루프가 넘긴 값이라 리뷰어가 같은 수를 되적는 것으로 끝나므로, 열두 파일 중 셋만 읽은 리뷰어도 열두 행 모두에서 개수를 맞춘다. 그러니 이 대조를 리뷰 판정의 자리로 쓰지 않는다.

**좁힌 정의로도 남는 것** — 조건은 **hunk 가 적다는 것이 아니라 hunk 마다 흔한 토큰이 하나씩 있다**는 것이다. 확장자만 보고 고른 흔한 코드 토큰이 그 파일의 hunk 를 하나씩 차지하면, hunk 가 여럿인 평범한 소스 편집도 diff 를 한 줄도 열지 않고 채워진다 — 이 저장소의 최근 40 커밋 470 파일을 그렇게 재면 **코드 파일의 80% 남짓**이 채워지고(서로 다른 보수적 풀 두 벌로 81% 와 85%), 그 안에는 6·7·11·13 hunk 짜리가 들어 있다. 최대 반례는 손으로 고친 11-hunk 소스 파일이다. 앵커 규칙으로 닫을 구멍이 아니다 — 900 줄짜리 새 파일을 읽었다는 것은 앵커 하나로 애초에 증명되지 않는다. 그러므로 **이 대조의 통과를 그 파일을 읽었다는 근거로 읽지 않는다.** 대조가 실제로 잡는 것은 분모를 표본으로 줄인 출력, 개수만 되적은 출력, 날조하거나 도배한 앵커다. 읽었는지가 걸린 변경에서는 분모를 쪼개 리뷰어를 여럿으로 나눈다.

---

## Extended References

- Read `references/extended-workflow.md` when executing PR comment collection,
  finding schemas, regression handling, close-reqs MCP mutation, PR responses,
  or pipeline event fields.
