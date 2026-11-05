---
name: kiwi-review-fix-loop
description: "Run a Kiwi review, fix, and re-review loop for current working-tree changes or GitHub PR review comments. Code only: prose such as SKILL.md, README, SRS documents and research notes is neither reviewed nor edited. Use for kiwi review fix loop, self review, code review loop, PR comments apply, 리뷰 수정 루프, 셀프 리뷰, or 머지 전 품질 게이트. Enforces sub-agent review/fix separation, regression checks, blocking-kept-finding-zero exit (keep/drop termination; record findings are listed as declared limits and never block), optional PR responses, and optional --close-reqs per-REQ verified transition through speckiwi MCP. Supports --pr, --files, --since, --commits, --base/--head, --auto, --model, --max, --dry-run, --no-respond, --close-reqs, and --resume."
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

## 클린 코드 라운드 — 컴팩션 뒤에도 남는 규칙 (FR-FLOW-206)

이 블록은 아래 본문보다 앞선다. 본문의 어느 절도 이 블록의 규칙을 건너뛰게 하지 않는다.

**분류.** 리뷰어는 중복·과도 추상화·명명·함수나 클래스 크기·책임 혼재·죽은 코드 지적을 keep/drop 판정과 따로 `clean-code` 분류로 보고하고, 지적마다 어긴 원칙과 코드 위치(파일·줄)를 적는다. `clean-code` 지적은 kept finding 수에 들어가지 않고 keep/drop 종료 게이트(kept finding 0)를 막지 않으며, `dismissed` 나 `unresolved` 가 남아도 실행의 종료 상태를 바꾸지 않는다.

**라운드.** fixer 는 `clean-code` 지적을 한 실행에서 클린 코드 라운드 **최대 3회** 안에서 고친다 — 라운드 하나는 리뷰어의 `clean-code` 지적, 분류기의 `dismissed` 표시, fixer 의 수정, 보존 스캔, 회귀 테스트 확인을 이 순서로 한 번씩 거친다. 클린 코드 라운드는 기능 결함 루프가 끝난 뒤에 돌고, 라운드를 시작하는 리뷰가 `clean-code` 지적을 하나도 내지 않으면 그 라운드에서 바로 끝난다. 리뷰어에게는 앞선 라운드에서 `dismissed` 된 지적 목록을 함께 넘기고, 이미 `dismissed` 된 지적과 같은 원칙·같은 위치를 다시 낸 지적은 그 라운드의 지적으로 세지 않는다 — 그런 지적만 나온 라운드도 그 라운드에서 바로 끝난다. 클린 코드 라운드 번호와 `dismissed` 지적은 실행 상태 `state.json` 의 `clean_code_round` 와 `clean_code_dismissed` 에 기록하고, 재개된 실행은 기록된 번호에서 이어 세며 기록된 `dismissed` 지적을 계속 세지 않는다.

**표시.** 분류기는 어긴 원칙이나 위치를 적지 않은 지적, 프로젝트의 기존 관례와 충돌하는 지적, 타당하지 않다고 판단한 지적을 `dismissed` 로 표시하고 사유를 적으며, fixer 는 그 지적을 고치지 않는다. 세 번째 클린 코드 라운드가 끝나도 고쳐지지 않은 지적은 `unresolved` 로 표시해 보고하고 더 고치지 않는다 — `dismissed` 지적은 보고서에서 계속 `dismissed` 이고 `unresolved` 가 되지 않는다.

**테스트.** 모든 클린 코드 수정은 그 실행의 회귀 테스트 명령을 통과해야 유지한다 — 통과는 회귀 기준선 대비 신규 실패 0 이다. 수정이 회귀 테스트 명령을 통과하지 못하면 그 수정을 되돌리고, 그 지적을 실패 출력과 함께 `unresolved` 로 표시한다. 보존 스캔(보존 스캔 절, §0.17)과 그 밖에 fixer diff 를 검사하는 게이트도 모든 클린 코드 수정을 검사한다 — 클린 코드 수정이 기존 public 심볼을 지우거나 시그니처를 바꾸거나, 기존 테스트 케이스를 지우거나 약화하거나, 비-테스트 기존 파일을 지우거나 옮기거나(`existing-public-contract-change` · `existing-test-weakened-or-deleted` · `existing-file-deleted-or-moved`), Mock 탐지(`mock-detection`)나 cwd 외부 path 검사(`external-module-impact`)에 걸리면 그 수정을 되돌리고, 그 지적을 걸린 게이트와 스캔 사유와 함께 `unresolved` 로 표시하며, 그 게이트를 올리지 않고 실행을 멈추지 않는다. 되돌린 클린 코드 수정은 kept finding 이 아니므로 개선 루프 발산 게이트(`improvement-loop-divergence-4opt`)의 횟수에 세지 않는다. 회귀 테스트를 돌리지 않는 실행(`--skip-regression`)이나 회귀 기준선을 잡지 못한 실행(`regression_baseline = null`)은 클린 코드 수정을 유지할 수 없으므로 클린 코드 라운드를 돌지 않고 그 사실을 보고한다.

**빠른 처리.** 호출 인자나 사용자 요청이 클린 코드 원칙을 지키지 않아도 된다고 하거나 빠른 처리를 요구하면(예: `ASAP`, `아삽`, `최대한 빨리`), 시작할 때 클린 코드 검사를 건너뛸지 한 번만 묻고 사용자가 확인하면 클린 코드 라운드를 모두 건너뛴다. `--auto` 이면 같은 신호가 있을 때 묻지 않고 건너뛴다. 건너뛰었으면 보고서에 클린 코드 검사를 건너뛴 사실과 그 이유(신호가 된 인자나 요청 문구)를 적는다. `--mini`, `--loops` 같은 라운드 상한 옵션은 빠른 처리 신호가 아니다. 사용자의 답이나 `--auto` 의 건너뛰기는 답을 받은 즉시, 다음 phase 가 돌기 전에 실행 상태 `state.json` 의 `clean_code_skip` 에 기록하고, 재개된 실행은 다시 묻지 않고 기록된 답을 따른다 — 건너뛰기로 기록됐으면 클린 코드 라운드를 돌지 않는다. `--skip-clean-code` 는 이 스킬을 부른 스킬이 이미 확인한 건너뛰기다 — 이 인자를 받으면 다시 묻지 않고 클린 코드 라운드를 모두 건너뛰며, Phase 0 에서 `clean_code_skip` 에 `true` 로 기록하고 보고서의 이유에 그 인자를 적는다. `--keep-clean-code` 는 이 스킬을 부른 스킬이 이미 받은 유지 답이다 — 이 인자를 받으면 다시 묻지 않고 클린 코드 라운드를 돌며, Phase 0 에서 `clean_code_skip` 에 `false` 로 기록한다. `--skip-clean-code` 나 `--keep-clean-code` 가 `--auto` 와 함께 오면 그 인자가 `--auto` 의 건너뛰기보다 우선한다. `--skip-clean-code` 와 `--keep-clean-code` 를 함께 받으면 어느 답인지 알 수 없으므로 시작하지 않고 거부한다. 이 스킬을 리뷰 hop 으로 부르는 스킬은 같은 신호를 받으면 자기 시작 시점에 한 번만 묻고(`--auto` 면 묻지 않고 건너뛴다) 그 답을 자기 실행 상태에 기록하며, 자기가 부르는 모든 리뷰 hop 에 사용자가 확인했으면 `--skip-clean-code` 를, 거절했으면 `--keep-clean-code` 를 넘긴다 — 사용자 요청을 보지 못하는 wave 워커의 리뷰 hop 에는 dispatch 카드로 넘긴다. 사용자가 `--auto` 로 돌리지 않은 리뷰 hop 에 `--auto` 를 붙이는 스킬(예: 단독 실행 끝의 kiwi-coder)도 그런 호출자로서 먼저 묻는다. 리뷰 hop 을 부르는 스킬이 부모에게서 `--skip-clean-code` 나 `--keep-clean-code` 를 받으면 묻지 않고 그 답을 자기 실행 상태에 기록하며, 자기가 부르는 모든 리뷰 hop 과 리뷰 hop 에 이르는 자식에 그 인자를 그대로 넘긴다 — 스킬 본문의 호출 예시에 적힌 `[--skip-clean-code | --keep-clean-code]` 자리가 그 답이다.

## 차단·기록과 회차 판정 — 컴팩션 뒤에도 남는 규칙 (FR-FLOW-229)

이 블록은 본문 규칙의 요약이며 규칙을 더하지 않는다 — 줄마다 본문에 같은 문장이 있다.

- **보장 범위** — 실행을 시작할 때 리뷰 대상 코드의 보장 범위를 실행 상태 `state.json` 의 `guarantee_scope` 에 기록한다.
- **판정 주체** — kept finding 을 차단(`block`)과 기록(`record`)으로 가르는 것은 리뷰어가 아니라 리드(분류기)다.
- **차단** — AC 를 어기거나, 실제 호출 경로에서 재현되거나, 데이터를 잃거나, 비밀을 노출하거나, 인증·권한을 우회하는 kept finding 은 차단이다 — 보안 finding 은 입력이 드물어도 차단이고, 선언된 계약을 깨는 값의 조용한 손실과 평범한 올바른 입력의 거부는 입력을 어떻게 만들었든 차단이다.
- **기록** — 실패하는 테스트로 입증됐지만 실제 호출 경로가 없거나 보장 범위 밖인 kept finding 은 drop 하지 않고 기록(`declared_limit`)으로 분류해 고치지 않으며, 증거와 함께 선언된 한계 목록 `declared_limits[]` 에 올리고, 사용자는 그것을 차단으로 올릴 수 있다 — 차단 조건에 드는 finding 은 실제 호출 경로가 없거나 입력을 만들어 냈어도 기록으로 분류하지 않는다.
- **2회차 범위** — 2회차부터 리뷰 범위의 기본값은 `check_review_round` 가 정하는 회차 범위(FR-NODE-274 AC-2)이며, 전체 범위로 넓히는 것은 사유를 `scope_widen_reason` 에 기록하는 명시적 결정이다.
- **계열 재발** — 같은 계열(`family`)의 kept finding 이 앞선 두 회차 이상에서 나온 뒤 다시 나오면, 리드는 표준 도구 쓰기(`standard-tool`)·한 규칙으로 통합(`single-rule`)·한계 선언(`declare-limit`) 중 정확히 하나를 골라 `family_action` 으로 기록하고, fixer 는 그 구성원 하나만 덧대지 않고 그 선택을 적용한다.
- **회차 검사** — 회차가 끝날 때마다 읽기 전용 검사 `check_review_round`(CLI `speckiwi review-round check`)를 부르고, 범위·앞 회차 수정의 과반·통과·상한이나 예산 멈춤에 대해 그 검사가 돌려준 판정(`PASS` · `NEEDS_USER` · `CONTINUE`)을 따른다.
- **통과** — 차단 kept finding 이 0 이고 리뷰 커버리지 대조(FR-FLOW-171)가 통과하고 residual 이 남지 않았을 때(FR-FLOW-203 AC-11) 실행이 통과하며, 기록 finding 은 통과를 막지 않는다.
- **남은 차단** — 앞 회차에서 해소되지 않은 차단 kept finding 도 그 회차 `findings[]` 에 다시 싣고 `id` · `family` · `introduced_by_round` 는 처음 기록한 값을 그대로 두므로, 최근 회차만 읽는 `check_review_round` 가 남은 차단을 모두 센다.
- **상한·예산 멈춤** — 차단 kept finding 이 남은 채 최근 회차 번호가 `limits.round_cap` 에 닿거나, `limits.token_budget` 이 null 이 아니고 회차별 `tokens_used` 합이 그것을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈추고 통과로 기록하지 않는다 — `limits.token_budget` 이 null 이면 예산 멈춤은 없다.
- **과반 멈춤** — 한 회차의 차단 kept finding 중 앞 회차 수정이 만든 것(`introduced_by_round` 가 그 회차보다 앞선 것)이 그 회차 차단의 절반을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈춘다.
- **--auto** — 이 두 멈춤은 `--auto` 의 결정 서브에이전트가 풀지 못한다(critical gate `round-cap-or-budget-needs-user` · `fix-induced-defects-majority`).

## Official Workflow Tool Policy

For covered workflow artifact flows, use official SpecKiwi workflow tools before raw file reads:

1. Read the resume state through MCP `workflow_resolve_artifact` with the run's `runId`, `kind` `coder-state` and `includeBody` `true` (the `.kiwi/sessions/{run-id}/state.json` this skill resumes from), and `workflow_worklog_tail`, before reading `.kiwi/sessions`, worklogs, or pipeline JSONL directly.
2. Raw file fallback is degraded mode. It is allowed only after capturing tool diagnostics, affected artifact paths, active target, and a follow-up requirement or candidate ID in `state.json`, the run report, or worklog.

## 0. Core Rules (SSOT)

| Key | Rule |
|---|---|
| §0.1 | Review and fix are separate roles. Do not let the fixer validate their own work. |
| §0.2 | Reviewer input must not include the fixer's rationale or preferred answer. |
| §0.3 | Behavioral, bug, regression, security, or performance findings need a regression test before the fix unless the finding is explicitly non-behavioral. |
| §0.4 | Mock shortcuts, cwd-external edits, and signature text are critical violations. |
| §0.5 | Normal mode does not mutate SRS. `--close-reqs` is the only opt-in SRS mutation path and it is self-mode only. |
| §0.6 | `--close-reqs` allows exactly three mutations and only in self mode: `add_verification_evidence` (type=test), `check_acceptance_criteria` (per criterion, after the test that passed it is named), and `update_status` (`implemented` to `verified`, forward-only). It may only move high-confidence impacted requirements. No bulk finalize, archive, or target-emptying behavior is allowed. |
| §0.7 | `--auto` follows `../_shared/kiwi/auto-option.md`. Finding classification remains local policy (blocking kept→auto-fix / record kept→auto-report as a declared limit, never fixed / dropped→auto-report / residual→user decision); `--auto` only governs user-decision gates. |
| §0.8 | Emit pipeline events through `../_shared/kiwi/pipeline-event.md`. |
| §0.9 | **`--mini` / `--loops N` option SSOT**. This skill follows `../_shared/kiwi/loop-option.md` v1.0. `--mini` = verify/improve loop round cap 3; `--loops N` = round cap N (integer ≥1). If both are given, **`--loops` wins (warn)**. Orthogonal to `--max` (compose). On reaching the cap while a blocking kept finding remains, stop `NEEDS_USER` with the blocking and record lists instead of a residual report (no safety-gate bypass) |
| §0.10 | **Test sufficiency.** Whenever a requirement scope is known (`--close-reqs`, `--req-filter`, `--sds`), the last verification step runs the check of `../_shared/kiwi/test-sufficiency.md` (Test Sufficiency section). |
| §0.17 | **기존 구조 불가침** (kiwi-coder §0.20 정합). fix 로 green 을 만들기 위한 **기존 테스트 파일 삭제**, **기존 테스트 케이스 제거**, **기존 단언 약화**, **기존 public 심볼의 삭제·시그니처 변경**, **비-테스트 기존 파일의 삭제·이동**을 모두 **금지**한다 — 본 스킬은 kiwi-coder 를 거치지 않는 코드 변경 경로이므로, 여기서 보존 규약이 빠지면 그 우회로가 그대로 열린다. 판정 기준은 kiwi-coder §0.20.1~§0.20.3 를 그대로 따른다. 탐지·차단 = fixer pass 의 diff 스캔 + `existing-test-weakened-or-deleted` / `existing-public-contract-change` / `existing-file-deleted-or-moved` 게이트 |

### `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `classifier-fix-hypothesis-fail-fallback` | classifier cannot produce a safe fix hypothesis | classification |
| `residual-finding-user-decision` | a residual finding (an unproven functional-defect claim) stays for user decision; the `--auto` decision subagent cannot resolve it (FR-FLOW-203) | classification |
| `round-cap-or-budget-needs-user` | the round cap is reached or the token budget is exceeded while a blocking kept finding remains — the run stops `NEEDS_USER` with the blocking and record lists, and the `--auto` decision subagent cannot resolve it (FR-FLOW-229 AC-4) | round check |
| `fix-induced-defects-majority` | blocking kept findings introduced by an earlier round's fix outnumber half of a round's blocking findings — the run stops `NEEDS_USER` with the blocking and record lists, and the `--auto` decision subagent cannot resolve it (FR-FLOW-229 AC-6) | round check |
| `close-reqs-with-pr-mode` | PR mode cannot close requirements directly | close gate |
| `close-reqs-with-regression-fail` | verified transition requires passing regression evidence | close gate |
| `close-reqs-critical-or-high-residual` | unresolved blocking kept or residual findings block verified transition; record findings do not (gate id kept for compatibility) | close gate |
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
| `test-sufficiency-gap` | citation gaps remain after the one fill attempt of the test-sufficiency check — a requirement whose gaps remain is not written as `verified` (`../_shared/kiwi/test-sufficiency.md`) | Test Sufficiency section |
| `validate-spec-error` | `validate_spec` returns at least one error-severity diagnostic — evidence and promotion stacked on a requirement that carries an error cannot be read back to what admitted them | before the `--close-reqs` promotion |

**Where this gate is observed**: at the hop this row's third cell names, run MCP `validate_spec` — the CLI fallback is `speckiwi validate --json`. While any error-severity diagnostic remains, do not proceed with that hop: halt at `validate-spec-error`, which `--auto` does not lift. Never record a pass without having run it.

**클린 코드 수정은 이 표의 게이트를 올리지 않는다**: 클린 코드 수정이 `existing-public-contract-change` · `existing-test-weakened-or-deleted` · `existing-file-deleted-or-moved` · `mock-detection` · `external-module-impact` · `improvement-loop-divergence-4opt` 에 걸리면 클린 코드 라운드 블록의 **테스트.** 규칙대로 되돌리고 `unresolved` 로 표시하며 실행을 멈추지 않는다. 기능 결함 수정과 채우기 서브에이전트의 diff 에는 이 표가 그대로 적용된다.

## Inputs

| Signal | Argument | Default |
|---|---|---|
| PR mode | `--pr`, `-pr`, `--PR`, `-PR`, or `--pr=<url>` | off |
| file scope | `--files=a,b` | working tree |
| commit/range scope | `--commits=HEAD~3`, `--since=YYYY-MM-DD`, `--base=main --head=HEAD` | working tree |
| verification intensity (one reviewer in every mode) | `--max` | off |
| verification model | `--model <name>` | current session model |
| auto gates | `--auto` | off |
| dry run | `--dry-run` | off |
| skip regression (turned on automatically, and reported, when no test command is detected) | `--skip-regression` | off |
| skip PR response | `--no-respond` | off |
| close implemented REQs | `--close-reqs` | off |
| requirement scope of the test-sufficiency check | `--req-filter <id,...>` | off |
| lite SDS (`docs/sds/*.sds.md`) passed to the test-sufficiency check | `--sds <path>` | off |
| resume | `--resume` | off |
| mini mode | `--mini` | off (skill default cap) |
| loop round cap | `--loops N` | off (skill default cap) |
| 부모 기준선 | `--regression-baseline <path>` | off (자기 시점 캡처) |
| suppress pipeline event | `--no-pipeline-emit` (takes no argument — suppresses the `kiwi/pipeline.jsonl` append) | off (emit as usual) |
| clean-code skip already confirmed by the calling skill | `--skip-clean-code` (takes no argument — skips the clean-code rounds without asking; 클린 코드 라운드 block) | off (a speed signal asks once in Phase 0) |
| clean-code check kept by the user when the calling skill asked | `--keep-clean-code` (takes no argument — runs the clean-code rounds without asking; 클린 코드 라운드 block) | off (a speed signal asks once in Phase 0) |

## Workflow

1. Preflight git; for PR mode, verify `gh --version` and authentication; capture
   the regression baseline before any code change (regression baseline section).
2. Decide mode and review scope. On a speed signal, ask once whether to skip the clean-code check and write the answer to `state.json` `clean_code_skip` as soon as it is given (클린 코드 라운드 block). Record the guarantee scope of the code under review in `state.json` `guarantee_scope` (Keep/Drop 종료 판정 section).
3. Fix the review denominator before spawning the reviewer: carry the included
   bucket into `review_denominator[]` and count each file's `hunks_total`
   yourself (리뷰 커버리지 분모 section).
4. Collect review inventory: local diff for self mode, PR comments/reviews for PR mode.
5. Classify findings into `immediate_fix`, `declared_limit`, `discussion_needed`, or `rejected`; the lead (classifier), not the reviewer, sets each kept finding's tier (`block` or `record`).
6. For immediate behavioral fixes, create a regression test and confirm red.
7. Delegate fixes to a fixer pass; for a recurring family it applies the lead's `family_action`.
8. Run the preservation scan over the fixer diff (보존 스캔 section)
   before the re-review.
9. Run a fresh prickly re-review with isolated input; from round 2 its scope is the round-N scope `check_review_round` defines (FR-NODE-274 AC-2), and a widening to the full scope is recorded with `scope_widen_reason`. Prose never enters that input
   (파일 부류 경계 section); the prose delta protocol belongs to
   `../_shared/kiwi/verify-loop.md` §10 and is not this skill's to run.
10. Iterate until no blocking kept finding remains (Keep/Drop 종료 판정 section); at every round end call `check_review_round` and follow its verdict.
    **커버리지 대조를 통과한 라운드만 PASS 가 된다** — finding 개수만으로는 PASS 가 나오지 않는다. 대조 결과는 리뷰 커버리지 분모 section 이 정하며, 무효 라운드는 어느 행에도 해당하지 않는다.
    Then run the clean-code rounds (at most 3; 클린 코드 라운드 block).
11. Run regression and affected tests.
12. In PR mode, write a response comment unless `--no-respond`.
13. Test sufficiency, the last verification step: when a requirement scope is known (`--close-reqs`, `--req-filter`, `--sds`), run the check of `../_shared/kiwi/test-sufficiency.md` (Test Sufficiency section).
14. If `--close-reqs`, register per-REQ test evidence and move eligible REQs from `implemented` to `verified`.
15. Write report and emit pipeline event.

### Keep/Drop 종료 판정 (심각도 라벨 대체)

심각도 라벨(CRITICAL·HIGH·MEDIUM·LOW)로 종료를 판정하지 않고, 실행 증거로 finding 을 가른다.

- finding 은 **실행이 입증할 때만 keep** 한다 — 실패하는 테스트·재현 절차·반례가 그 실패를 보이고 그 실패가 의도를 깨뜨릴 때다.
- 실행으로 입증하지 못한 것과 스타일·명명·순서·주석류는 **drop** 하며, 심각도 라벨(CRITICAL·HIGH·MEDIUM·LOW)은 종료 판정에 쓰지 않는다.
- 이 drop 은 기능 결함 finding 의 keep/drop 판정에 대한 것이다 — 중복·과도 추상화·명명 같은 클린 코드 지적은 이 판정에 넣지 않고 `clean-code` 분류로 따로 모아 클린 코드 라운드(클린 코드 라운드 블록)가 다룬다.
- 기능 결함이라 **주장**했으나 실행으로 입증하지 못한 finding 은 drop 하지 않고 **residual 로 사용자 결정**에 올린다.
- 기록 finding 은 실행으로 입증된 것이므로 residual 로 올리지 않는다.
- kept finding 을 차단(`block`)과 기록(`record`)으로 가르는 것은 리뷰어가 아니라 리드(분류기)다.
- AC 를 어기거나, 실제 호출 경로에서 재현되거나, 데이터를 잃거나, 비밀을 노출하거나, 인증·권한을 우회하는 kept finding 은 차단이다 — 보안 finding 은 입력이 드물어도 차단이고, 선언된 계약을 깨는 값의 조용한 손실과 평범한 올바른 입력의 거부는 입력을 어떻게 만들었든 차단이다.
- 실패하는 테스트로 입증됐지만 실제 호출 경로가 없거나 보장 범위 밖인 kept finding 은 drop 하지 않고 기록(`declared_limit`)으로 분류해 고치지 않으며, 증거와 함께 선언된 한계 목록 `declared_limits[]` 에 올리고, 사용자는 그것을 차단으로 올릴 수 있다 — 차단 조건에 드는 finding 은 실제 호출 경로가 없거나 입력을 만들어 냈어도 기록으로 분류하지 않는다.
- residual finding 이 하나라도 남으면 이 실행은 `TASK_DONE` 이 아니라 `NEEDS_USER` 로 끝난다 — 상위 오케스트레이터는 그 residual 을 사용자가 결정하기 전까지 step 승급·lane 병합으로 넘어가지 않는다.
- 라운드 상한에 닿거나 토큰 예산을 넘거나, 차단 kept finding 이 남은 채 수렴 가드로 끝나거나, 앞 회차 수정이 만든 차단이 과반이어서 멈춘 실행도 `TASK_DONE` 이 아니라 `NEEDS_USER` 로 끝난다.
- keep/drop 판정과 4분류는 고정 매핑이다: 차단 kept→`immediate_fix`, 기록 kept→`declared_limit`, residual→`discussion_needed`(`rejected` 로 보낼 수 없다), dropped→`rejected`.
- keep 의 증거로 제출한 테스트는 현재 코드에서 **red 임을 실행으로 확인**한 뒤에만 인정하고, 그 테스트가 회귀 테스트가 되어 fix 후 green·뮤테이션으로 확인한다.
- 까칠 리뷰어는 **전 모드에서 1개**이며, `--max` 는 리뷰어 수가 아니라 검증 강도(뮤테이션·적대적 실행)만 올린다.
- 종료 게이트는 **차단 kept finding 이 0** 일 때만 통과하고 기록(`declared_limit`) finding 은 통과를 막지 않는다 — 이것이 기존 `CRITICAL=0 + HIGH=0` 게이트를 대체한다.
- 차단 kept finding 이 하나라도 남아 있으면 루프는 라운드 상한·토큰 예산·수렴 가드 안에서 계속 돈다.
- 종료는 리뷰 커버리지 대조(FR-FLOW-171)가 차단 kept 0 게이트와 **함께** 통과할 때만 허용한다.
- 기본 라운드 상한은 **Normal 5 / `--max` 8 / `--mini` 3** 이며, 차단 kept finding 이 남은 채 상한에 닿거나 토큰 예산을 넘으면 통과가 아니라 차단·기록 목록과 함께 `NEEDS_USER` 로 끝난다. `--loops N` 이 주어지면 상한은 N 이다.
- 수렴 가드는 finding-hash 일치가 아니라 **새로 해소된 차단 kept 가 0 인 라운드가 2회 연속**이면 종료하며, 차단 kept finding 이 남은 채 수렴 가드로 끝난 실행은 통과가 아니라 `NEEDS_USER` 로 끝난다.
- 앞 회차 수정이 만든 차단의 과반 멈춤(FR-FLOW-229 AC-6)은 연속 횟수와 별개로 매 회차 검사하며, 먼저 걸린 쪽이 실행을 끝낸다.
- drop 한 finding 은 **사유와 함께** 보고하고 residual 은 **목록으로** 보고한다 — silent truncation 은 하지 않는다.
- 기록 finding 은 선언된 한계(`declared_limits[]`)로 **증거와 함께** 목록으로 보고한다.
- `--auto` 에서는 **차단 kept→자동 수정 / 기록 kept→선언된 한계로 자동 보고(고치지 않음) / dropped→자동 보고 / residual→사용자 결정**으로 가르며, `--auto` 는 기록 finding 을 차단으로 올리지 않는다.
- 실행을 시작할 때 리뷰 대상 코드의 보장 범위를 실행 상태 `state.json` 의 `guarantee_scope` 에 기록한다.
- 2회차부터 리뷰 범위의 기본값은 `check_review_round` 가 정하는 회차 범위(FR-NODE-274 AC-2)이며, 전체 범위로 넓히는 것은 사유를 `scope_widen_reason` 에 기록하는 명시적 결정이다.
- 같은 계열(`family`)의 kept finding 이 앞선 두 회차 이상에서 나온 뒤 다시 나오면, 리드는 표준 도구 쓰기(`standard-tool`)·한 규칙으로 통합(`single-rule`)·한계 선언(`declare-limit`) 중 정확히 하나를 골라 `family_action` 으로 기록하고, fixer 는 그 구성원 하나만 덧대지 않고 그 선택을 적용한다.
- 회차가 끝날 때마다 읽기 전용 검사 `check_review_round`(CLI `speckiwi review-round check`)를 부르고, 범위·앞 회차 수정의 과반·통과·상한이나 예산 멈춤에 대해 그 검사가 돌려준 판정(`PASS` · `NEEDS_USER` · `CONTINUE`)을 따른다.
- 앞 회차에서 해소되지 않은 차단 kept finding 도 그 회차 `findings[]` 에 다시 싣고 `id` · `family` · `introduced_by_round` 는 처음 기록한 값을 그대로 두므로, 최근 회차만 읽는 `check_review_round` 가 남은 차단을 모두 센다.
- 차단 kept finding 이 0 이고 리뷰 커버리지 대조(FR-FLOW-171)가 통과하고 residual 이 남지 않았을 때(FR-FLOW-203 AC-11) 실행이 통과하며, 기록 finding 은 통과를 막지 않는다.
- 차단 kept finding 이 남은 채 최근 회차 번호가 `limits.round_cap` 에 닿거나, `limits.token_budget` 이 null 이 아니고 회차별 `tokens_used` 합이 그것을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈추고 통과로 기록하지 않는다 — `limits.token_budget` 이 null 이면 예산 멈춤은 없다.
- 한 회차의 차단 kept finding 중 앞 회차 수정이 만든 것(`introduced_by_round` 가 그 회차보다 앞선 것)이 그 회차 차단의 절반을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈춘다.
- 이 두 멈춤은 `--auto` 의 결정 서브에이전트가 풀지 못한다(critical gate `round-cap-or-budget-needs-user` · `fix-induced-defects-majority`).

### 보존 스캔 (fixer diff, §0.17)

fixer pass 가 적용한 **diff** 를 스캔한다 — **기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화**, **기존 public 심볼의 삭제·시그니처 변경**, **비-테스트 기존 파일의 삭제·이동** 중 하나라도 검출되면 **CRITICAL** 로 올리고 `--auto` critical_gates[] 의 대응 게이트(`existing-test-weakened-or-deleted` / `existing-public-contract-change` / `existing-file-deleted-or-moved`)로 중단한다. 판정 기준은 `kiwi-coder §0.20.1~§0.20.3`.

클린 코드 수정에서 검출된 경우만 예외다 — 게이트로 중단하지 않고 클린 코드 라운드 블록의 **테스트.** 규칙대로 그 수정을 되돌리고 `unresolved` 로 표시한다. 기능 결함 수정과 채우기 서브에이전트의 diff 에는 위 중단이 그대로 적용된다.

스캔은 까칠 리뷰어 **재검증(re-review)보다 먼저** 수행한다 — 뒤에 두면 약화된 테스트가 먼저 clean 판정을 받는다.

### 회귀 테스트 기준선 캡처 (델타 판정 SSOT)

본 스킬은 kiwi-coder 를 거치지 않는 코드 변경 경로이므로, 회귀 판정도 kiwi-coder §6.1.0 / §6.1.3 과 같은 형태를 쓴다 — 같은 파이프라인 안의 두 수정 주체가 다른 판정을 하면, 한쪽에서 관용되는 사전 실패가 다른 쪽에서 발산 게이트로 올라간다.

- **기준선 캡처**: **코드를 바꾸기 전에** 전체 회귀 스위트를 1회 실행해 기준선 결과를 저장한다. 캡처 시점은 회귀 테스트 작성 이전 (preflight) 이며, 결과는 `state.regression_baseline` 에 고정한다
- **델타 판정**: 회귀 여부는 기준선 대비 **델타로 판정**한다 — 기준선에서 pass 였는데 이번 실행에서 fail 한 test 만 이 fix 가 만든 **신규 실패**다
- **기존 실패 귀속 금지**: 기준선에 이미 있던 **기존 실패**는 그대로 **보고하고** 현재 fix 의 것으로 **귀속하지 않는다** — 남의 실패를 좇는 동안 이 스킬의 개선 루프가 발산한다
- **캡처 실패 격하**: 테스트 명령은 있는데 캡처 자체가 실패하면 `state.regression_baseline = null` 로 두고, 이 run 의 회귀 판정은 델타 없이 실패 전량 보고로 격하하며, 클린 코드 라운드는 돌지 않는다(클린 코드 라운드 블록). 두 사실을 보고서에 명시한다. 테스트 명령이 없으면 이 격하가 아니라 `--skip-regression` 자동 활성이 적용된다
- **부모 기준선 우선**: `--regression-baseline` 으로 상위 오케스트레이터가 pin 한 기준선을 받으면 그 값이 자기 시점 캡처보다 **우선한다** — 값이 주어지면 자체 캡처를 수행하지 않고 전달된 기준선을 `state.regression_baseline` 에 그대로 고정한다. 방금 만들어진 실패를 "기존 실패"로 분류해 `TASK_DONE` 을 반환하는 것이 wave 게이트와 정면으로 어긋나기 때문이다.

## Test Sufficiency (last verification step)

When a requirement scope is known, run the check of `../_shared/kiwi/test-sufficiency.md` after regression. It is this skill's last verification; only the `--close-reqs` promotion and the report follow it.

| Scope input | Scope passed |
|---|---|
| `--close-reqs` | the `eligible` set (Close Requirements in `references/extended-workflow.md`), built at this step — the denominator and the intersection are reads, outside the section-zero mutation prohibition |
| `--req-filter <id,...>` | those IDs |
| `--sds <path>` | without the two inputs above, the IDs the lite SDS names with `@req` (the requirement IDs in the summary of MCP `check_sds` / `speckiwi sds check`); the SDS itself is passed as `--sds` in every case |
| none of the three | the check does not run — the result is `no-scope`, never recorded as a pass |

When several inputs are given, the earlier row sets the IDs. With `--close-reqs`, the check's scope is always the whole `eligible` set the promotion will write — `--req-filter` and `--sds` shape `scoped` (Close Requirements in `references/extended-workflow.md`) and never narrow the check below it, because every requirement the promotion writes must pass through the check.

When the run is in a linked worktree, such as a worker's, the check reads that worktree — pass `workspaceRoot` = that worktree's absolute path to MCP `check_test_sufficiency`, or run the CLI with that worktree as cwd (`../_shared/kiwi/test-sufficiency.md` §3 step 1). The fill subagent writes in the same worktree.

With `--close-reqs`, this step ends by running the test files of the citations the promotion will use as evidence, as `../_shared/kiwi/test-sufficiency.md` §4 requires, and hands only the citations of tests that passed in that run to the promotion — a citation whose test failed, was skipped or did not run leaves its AC a gap, and a remaining gap raises `test-sufficiency-gap`. The tool reads citations and never runs a test, so without this run a citation in an unchanged file or on a skipped test would become evidence.

The fill subagent (contract §3) is a second code writer beside the fixer pass, and it writes new tests only. Run the preservation scan (보존 스캔 section) over its diff. Under `--dry-run` there is no fill and no rerun; the first result is reported (contract §3).

Record the result as `test_sufficiency.json` (contract §5). When `test-sufficiency-gap` is raised the run waits for the user: it does not end `TASK_DONE` and does not enter the `--close-reqs` promotion.

## `--close-reqs` Gate

Skip or halt when:

| Condition | Action |
|---|---|
| `--close-reqs` absent | no SRS mutation |
| PR mode | halt; close after merge or in self mode |
| regression failed or skipped without evidence | halt |
| blocking kept or residual finding remains | halt; a record (`declared_limit`) finding does not block |
| the test-sufficiency step raised `test-sufficiency-gap` | halt; a requirement whose gaps remain is not written as `verified` (Test Sufficiency section) |
| a target requirement rests on **prose** as verification **evidence** | this skill does not close it; report the omission instead — it reviews only code (파일 부류 경계), so it cannot run the full-document audit `FR-FLOW-136` AC-6 gates the close with, and an obligation a skill cannot discharge is not a gate. **No pipeline path closes such a requirement automatically** — a person audits and closes it. Say so in the report, so an unclosed requirement does not read as a failure |
| `scoped` is empty | skip, and report the denominator's size and why the intersection came out zero |
| `eligible` is at least one and `transitioned` is zero | NOT `TASK_DONE`; end `FAILED` and report |
| `transitioned + excluded` does not equal `scoped` | the run is invalid; end `FAILED` and enumerate the requirements that received no disposition |
| impacted REQ stability is `draft` or `deprecated` | skip that REQ |
| impacted REQ status is not `implemented` | skip that REQ. It is outside the denominator, so it enters neither `scoped` nor the accounting identity |

For each eligible REQ:

1. Call `add_verification_evidence` with `type="test"`, `reference` = the test file the test-sufficiency
   step cited for an acceptance criterion and `covers` = that criterion, once per cited criterion
   (`../_shared/kiwi/test-sufficiency.md` §4).
2. Call `check_acceptance_criteria` for those criteria. **For each acceptance criterion, the test
   identifier that passed it is the citation the test-sufficiency step returned for it** — a file path
   and test line; the agent does not name one itself, and step 1 registered that citation as the
   `reference` under `covers` for that same criterion. **Do not check a criterion for which no such
   identifier is named** — one the tool returned no citation for: leave it out of `acIds` and record
   the requirement as skipped. Checking is a mutation, so a
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

**범위 결정과의 관계** — 본 절은 Inputs 절의 범위 결정이 산출한 후보 목록에 붙는 **후처리**이며 그 범위 결정을 대체하지 않는다. 부류 필터는 후보 목록이 만들어진 **직후**, 까칠 리뷰어를 spawn 하기 **전**에 적용한다. 뒤에 두면 고칠 수 없는 finding 이 kept 카운터에 들어가, 루프가 영원히 통과하지 못하거나 게이트를 맞추려고 결국 그 문서를 고치게 된다.

**커밋 창은 사람의 지목이 아니다** — `--base`/`--head` · `--commits` · `--since` 는 부류 필터를 **면제하지 않는다.** `kiwi-orchestrator` 는 §15 일정에 따라 `docs/research/{work}/` 아래 run 아티팩트를 커밋한 **다음** 그 커밋 범위를 이 스킬에 창으로 넘긴다. 연구·설계 산문이 실제로 리뷰에 들어온 경로가 이것이며, 창을 지목으로 인정하면 주 경로가 그대로 필터를 면제받는다. **`--files` 만** 사람이 파일을 지목한 것으로 인정하고, 그 목록에 든 산문은 제외 사실과 사유를 **보고**한 뒤 코드만 진행한다. 지목이 전부 산문이면 진행하지 않는다.

**제외는 전수 열거한다** — 제외한 산문을 `mode_decision.json.self_scope.excluded_prose[]` 에 **빠짐없이** 싣고 보고서에도 그대로 낸다. 개수나 표본으로 줄이지 않는다. 판정 순서 1 이 거부한 저널·lock 은 `refused_artifacts[]` 에 따로 싣는다 — 코드도 산문도 아니므로 어느 쪽 버킷에 넣어도 이름을 속이게 된다. 그리고 **항등식**이 성립해야 한다: 포함한 파일 수와 `excluded_prose[]` 와 `refused_artifacts[]` 와 `unclassified_files[]` 의 수를 더한 값이 후보 수와 같아야 한다. 항등식이 없으면 규칙을 지킨 run 과 규칙을 잊은 run 이 똑같은 산출물을 남긴다.

**빈 범위는 통과가 아니다** — 필터 후 코드 대상이 **0건**이면 PASS 를 보고하지 않고 `empty-code-scope` 로 **중단**한다. 아무것도 보지 않은 실행이 품질 게이트 통과로 기록되면, 빈 기준선이 깨끗한 기준선과 구별되지 않는다.

**알려진 한계**: 후보가 처음부터 전부 산문이면 이 중단이 오케스트레이터의 종료 hop 과 충돌한다. 그 hop 은 통과 판정을 기록하는 모든 경계가 이 스킬을 정확히 한 번 거치도록 요구하는데, 준비된 면제 분기의 술어는 **커밋 창의 공백**이라 산문 커밋이 든 창에는 걸리지 않는다. 요구나 설계 문서만 산출한 wave 가 여기 해당한다. 해소하려면 `FR-FLOW-131` 이 소유한 그 술어를 넓히거나 별도 verdict 을 도입해야 하며, 둘 다 요구 수준의 결정이라 이 절이 정하지 않는다. **`FR-FLOW-152` 의 후속으로 남긴다.** 단 `_shared/kiwi/parallel-waves.md` PW-12 의 stage 마감 호스트 hop 은 부르기 전에 창의 파일을 이 절의 부류 표로 걸러, 코드 파일이 없으면 이 스킬을 부르지 않고 `no-host-code-commits` 를 기록한다 — 그 경계에서는 이 충돌이 생기지 않는다.

**산문 finding 은 어디로 가는가** — 부류 밖 문서에서 눈에 띈 문제는 SRS finding 에 쓰는 것과 같은 채널로 흘린다: 고치지 않고 보고하며, 담당 스킬을 지목해 위임을 권고한다.

---

## 12. 리뷰 커버리지 분모 — 리뷰어가 무엇을 열었는가

§11 의 항등식과 본 절은 대상이 다르다. 항등식은 후보 파일이 **어느 버킷에 들어갔는지**를 세고, 본 절은 포함 버킷의 **각 hunk 를 리뷰어가 실제로 처리했는지**를 대조한다. 그러므로 항등식이 성립한다는 사실이 본 절을 대신하지 못한다 — 범위를 고르는 단계에는 분모가 있는데 그 범위를 읽는 단계에는 없었다는 것이 이 절이 생긴 이유다.

**분모는 루프가 고정한다.** 까칠 리뷰어를 spawn 하기 전에, 범위 결정이 산출한 `self_scope.files[]`(§11 의 포함 버킷)를 그대로 `review_denominator[]` 로 옮겨 리뷰어 프롬프트에 싣는다. 리뷰어가 스스로 정하지 않는다. 산문은 애초에 이 집합에 들어오지 않으므로(§11) 분모에도 넣지 않는다.

**2회차부터 분모는 회차 범위다.** 1회차의 분모는 위 `self_scope.files[]` 이고, 2회차부터는 `check_review_round` 가 정하는 회차 범위(FR-NODE-274 AC-2) — 직전 회차 리뷰가 읽은 스냅숏 `tree_sha` 와 이번 회차 리뷰가 읽는 스냅숏 `tree_sha` 사이에서 달라진 파일을 §11 부류 필터로 거르고 `.kiwi/` 아래 경로를 뺀 것과 그 변경이 닿는 파일 — 를 분모로 옮긴다. 전체 범위로 넓힌 회차(`scope` 가 `full`, 사유는 `scope_widen_reason`)만 다시 `self_scope.files[]` 를 분모로 쓴다.

**`hunks_total` 은 루프가 센다 — 리뷰어가 세지 않는다.** 분모의 파일마다 아래 명령으로 세어 `review_denominator[]` 의 각 항목에 `hunks_total` 로 함께 싣는다.

```
git diff -U0 <범위> -- <path> | grep -c '^@@'
```

`<범위>` 는 `self_scope.source` 가 정한 그 범위다. `-U0` 을 쓰는 이유는 컨텍스트 줄이 인접 hunk 를 병합해 개수를 줄이기 때문이다. **분모를 만든 범위, `hunks_total` 을 센 범위, 앵커를 대조하는 범위는 셋 다 같아야 한다** — 다르면 리뷰어가 아무 잘못 없이 무효 라운드를 받는다. 2회차부터 `<범위>` 는 `<직전 회차 tree_sha> <이번 회차 tree_sha>` 이고, 전체 범위로 넓힌 회차는 1회차의 범위로 되돌린다 — 그 변경이 닿는 파일 가운데 그 범위에서 바뀌지 않은 파일은 `hunks_total` 0 의 행으로 남는다.

**리뷰어 출력에 `coverage_rows[]` 가 추가된다.** `review_denominator[]` 의 **모든** 파일이 한 행씩 갖고, 각 행은 그 파일의 앵커 목록과 finding 이 붙었는지를 밝힌다. finding 0건인 파일도 행으로 남는다. 표본·발췌·상위 N 은 분모가 아니다.

**리뷰어는 hunk 마다 앵커 하나를 돌려준다.** 앵커는 그 hunk 안에서 **추가되거나 삭제된 줄**(`git diff -U0` 출력에서 `+` 또는 `-` 로 시작하되 `+++`·`---` 파일 헤더가 아닌 줄) 하나를 그대로 옮긴 인용이거나, 그 줄에서 추가·삭제된 심볼 이름이다. **`@@` 헤더 줄과 파일 경로는 앵커가 될 수 없다** — 그 둘은 루프가 이미 넘긴 값에서 그대로 만들어 낼 수 있으므로 그 hunk 를 열었다는 증거가 되지 못한다.

**루프가 앵커를 기계 대조한다.** 검사는 셋이다.

1. 각 앵커 문자열이 `git diff -U0` 출력의 **해당 hunk 본문 안**에 실제로 있다. **"있다"는 위 정의를 만족한다는 뜻이다** — 그 hunk 의 추가·삭제된 줄 하나와 **통째로 같거나**(앞뒤 공백만 다른 것은 같은 것으로 본다), 그 줄에 **토큰 경계로 실재하는 심볼 이름**이어야 한다 — **심볼 이름은 코드 토큰을 말하며, 산문의 낱말은 심볼 이름이 아니다.** **줄의 임의의 부분문자열은 앵커가 아니다.** 정의를 적어 두는 것과 검사가 그 정의를 강제하는 것은 다르고, 강제하지 않으면 정의는 아무것도 막지 못한다 — 부분문자열을 인정하면 diff 를 한 줄도 열지 않고 고른 흔한 한 글자 N 개가 서로 다른 hunk 에 하나씩 대응해 한 행을 통째로 채운다.
2. 한 파일 안에서 앵커 개수가 `hunks_total` 과 같고, 서로 다른 hunk 에 하나씩 대응한다. 개수만 맞추면 한 hunk 에서 뽑은 앵커 N 개가 통과한다.
3. **한 행 안에서 같은 앵커 문자열을 두 번 쓰지 않는다.** 막지 않으면 diff 전체에서 흔한 한 줄을 골라 그 행을 통째로 채우는 출력이 통과한다. 반대로 **서로 다른 행이 같은 문자열을 앵커로 갖는 것은 막지 않는다** — 여러 파일에 같은 줄이 추가되는 변경(공통 import 가 대표적)에서는 정직한 리뷰어의 앵커도 행 사이에서 겹치므로, 행 사이까지 금지하면 잘못 없는 라운드가 무효가 된다. 겹친 문자열도 검사 1 이 파일마다 따로 확인하니 근거 없이 겹칠 수는 없다.

**하나라도 어긋나면 그 라운드는 무효다.** cap 은 소비하되 PASS 로 기록하지 않으며, 무효 판정 로그에 어긋난 앵커 문자열을 그대로 남긴다 — 재사용은 개수만 세면 보이지 않고 문자열을 나란히 놓아야 눈에 띈다. **무효 라운드가 2회 연속이면 `review-coverage-mismatch` 로 중단하고 `--auto` 가 이 중단을 덮지 못한다** (게이트 선언은 `critical_gates[]` 표에 있다). 파일이 많으면 리뷰어가 행 열거를 중간에서 잘라 돌려주고 모든 라운드가 무효가 되어 cap 만 소비하는데, 그것이 이 설계에서 아무 일도 일어나지 않는 것처럼 보이는 유일한 실패 형태이기 때문이다. 그때는 분모를 쪼개 리뷰어를 여럿으로 나누고 각자에게 자기 몫의 분모를 고정해 준다. **분모 단위를 파일보다 굵게 올리거나 앵커를 파일당 하나로 줄이지 않는다.**

**이 대조가 보장하지 않는 것** — 앵커 대조는 리뷰어가 그 hunk 를 **이해했다는 것을 보장하지 않으며, 리뷰 품질을 재지 않는다.** 보장하는 것은 **분모의 모든 파일이 행으로 열거되고, 적힌 앵커 하나하나가 그 hunk 에 실재한다**는 데까지다 — **리뷰어가 diff 를 열었다는 것까지는 보장하지 않는다.** 앵커를 못 채우면 그 hunk 를 건드리지 않았다는 사실이 산출물에 남고, 틀린 앵커를 채우면 대조가 그것을 잡는다. 개수 대조에는 이 두 성질이 모두 없다 — `hunks_total` 은 루프가 넘긴 값이라 리뷰어가 같은 수를 되적는 것으로 끝나므로, 열두 파일 중 셋만 읽은 리뷰어도 열두 행 모두에서 개수를 맞춘다. 그러니 이 대조를 리뷰 판정의 자리로 쓰지 않는다. 2회차부터 분모가 회차 범위로 좁아지므로, 그 회차의 깨끗한 대조는 회차 범위 밖 파일에 대해 아무것도 말하지 않는다.

**좁힌 정의로도 남는 것** — 조건은 **hunk 가 적다는 것이 아니라 hunk 마다 흔한 토큰이 하나씩 있다**는 것이다. 확장자만 보고 고른 흔한 코드 토큰이 그 파일의 hunk 를 하나씩 차지하면, hunk 가 여럿인 평범한 소스 편집도 diff 를 한 줄도 열지 않고 채워진다 — 이 저장소의 최근 40 커밋 470 파일을 그렇게 재면 **코드 파일의 80% 남짓**이 채워지고(서로 다른 보수적 풀 두 벌로 81% 와 85%), 그 안에는 6·7·11·13 hunk 짜리가 들어 있다. 최대 반례는 손으로 고친 11-hunk 소스 파일이다. 앵커 규칙으로 닫을 구멍이 아니다 — 900 줄짜리 새 파일을 읽었다는 것은 앵커 하나로 애초에 증명되지 않는다. 그러므로 **이 대조의 통과를 그 파일을 읽었다는 근거로 읽지 않는다.** 대조가 실제로 잡는 것은 분모를 표본으로 줄인 출력, 개수만 되적은 출력, 날조하거나 도배한 앵커다. 읽었는지가 걸린 변경에서는 분모를 쪼개 리뷰어를 여럿으로 나눈다.

---

## Extended References

- Read `references/extended-workflow.md` when executing PR comment collection,
  finding schemas, regression handling, close-reqs MCP mutation, PR responses,
  or pipeline event fields.
