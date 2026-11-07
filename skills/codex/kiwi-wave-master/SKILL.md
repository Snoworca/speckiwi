---
name: kiwi-wave-master
description: "PRD 로 제품 target 의 SRS 를 한 번 저작하고 그 요구 집합을 작업 그래프(wave 노드와 의존 간선)로 분해한 뒤, 공용 병렬 계약으로 wave 당 워커 하나를 워크트리에서 실행·병합·검증하는 멀티-웨이브 오케스트레이터 v0.1. 초안 그래프는 speckiwi orchestrate wave propose 가 쓰고, orchestrate wave check 를 통과해야 dispatch 한다. 의존이 없는 wave 는 병렬로 돌고 --serial 이면 모든 단계를 하나씩 돈다. ./kiwi/waves.jsonl 로 진행을 추적하여 재개 가능(첫 미완료 wave 부터). 트리거 — kiwi wave master, 웨이브 오케스트레이션, 멀티 웨이브, 대형 작업 분해, wave 별 병렬 실행, 에픽 실행, 여러 단계로 나눠서 진행. 옵션 — --auto (모든 wave 를 끝까지 자율 완주, 안전 게이트 유지), --max (모든 wave 의 하위 스킬로 전파), --serial (모든 단계를 하나씩), --drive (무인 완주 + 경계 있는 자가 복구, §7.5)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-wave-master v0.1

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

## 핵심 규칙 — 컴팩션 뒤에도 남는 PRD 규칙 (FR-FLOW-204)

입력 문서에 PRD 경로가 없으면 SRS 저작보다 먼저 `kiwi-prd` 를 불러 그 입력 문서를 `U-1` 의 원천으로 승인된 PRD 를 만든다. 요청이 이미 `docs/prd/` 의 PRD 를 가리키면 그 PRD 를 쓴다. 모든 `kiwi-srs` 호출 — run 앞의 처음 저작과 stage 마다의 증분 저작 — 에 그 PRD 경로를 `PRD_PATH` 로 넘긴다. wave 의 PRD 항목은 그 wave 요구들이 Rationale 에서 인용한 항목의 합집합이고 `speckiwi orchestrate wave show` 로 읽는다 — wave 마다 PRD 항목을 적는 발췌를 쓰지 않는다. 저작이 끝날 때마다 run 의 PRD 커버리지를 `speckiwi prd coverage` 로 확인한다(`wave-decomposition.md §5`). `--auto` 면 `kiwi-prd` 가 `Status` 행을 `unapproved` 로 둔 채 돌려준 PRD 를 쓰고 run 보고에 미승인임을 적는다. PRD 는 `kiwi-prd` 만 고친다.

요청에 관한 질문에 사용자가 답하면 그 답을 쓰기 전에 `kiwi-prd` 를 통해 PRD 의 다음 `U-<n>` 으로 원문 그대로 덧붙인다 — 답이 더한 범위는 그래야 PRD 에 근거를 갖는다.

---

하나의 크고 긴 작업(에픽·로드맵·대형 연구 산출물)을 **여러 개의 wave 로 나누어 완주**시키는 멀티-웨이브 오케스트레이터. 각 wave 는 작업 그래프의 노드 하나(`--sds` 면 wave SDS 도)이고, **wave 하나를 워커 하나가** 자기 워크트리에서 구현하며, 호스트가 판정·병합·재생·검증한다. 의존이 모두 끝난 wave 들은 **기본이 병렬**이고 `--serial` 이면 하나씩이다.

이 스킬은 *직접 요구사항을 저작하거나 코드를 구현하지 않는다* — 제품 target 의 SRS 를 `$kiwi-srs` 로 한 번 저작시키고, 그 요구 집합을 작업 그래프로 나누고, `_shared/kiwi/parallel-waves.md` 의 절차로 wave 를 워커에 맡기고 결과를 검증하는 상위 오케스트레이터다. wave 를 `$kiwi-pipeline` 에 위임하지 않는다.

---

## 핵심 규칙 — 컴팩션 뒤에도 남는 실행 규칙 (FR-FLOW-223)

이 블록은 본문과 `_shared/kiwi/` 계약에 이미 있는 규칙의 요약이다 — 정본은 줄마다 괄호 안에 적은 절이다.

- **순서** — PRD(위 블록) → 제품 target 의 SRS 저작 한 번 → 요구 분해(작업 그래프) → wave 워커 (`wave-decomposition.md §2`, `parallel-waves.md §5`).
- **단위** — 요구 하나는 한 노드에 통째로 든다. 범위의 살아 있는 AC 는 정확히 한 노드의 `acs` 에 들고, 한 요구의 AC 가 여러 노드로 나뉘면 `orchestrate wave check` 가 `ac-split` 을 낸다 (`wave-decomposition.md §3`).
- **의존** — 요구 사이 의존은 `depends_on` 링크이고, 그래프의 `edges` 와 stage 는 도구가 계산한다 — `orchestrate wave propose` · `orchestrate schedule waves` (`parallel-waves.md §2`).
- **쓰기 소유** — 워커는 SRS 를 쓰지 않고 `docs/spec/` · `docs/sds/` · `kiwi/pipeline.jsonl` · `kiwi/waves.jsonl` 에 쓰지 않는다. 빠졌거나 틀린 요구는 매니페스트의 `srs_deltas[]` 로 보고하고, 호스트가 stage 마다 한 번 증분 저작한다 (`parallel-waves.md` PW-1 · PW-6).
- **범위** — PRD 항목도 `fills:` 도 인용하지 않는 확장은 사용자가 정한다 — `prd-residual-user-decision` 으로 멈춘다 (`wave-srs-registration.md §2`).
- **불변** — dispatch 한 wave 의 순서 · 범위 · 의존은 바꾸지 않는다. 끝난 wave 의 `verified` 동작을 옮기는 길은 후속 요구와 AC 만료뿐이다 (§0.5).
- **검증** — 심각도를 매기지 않는다. 검증자가 쓴 테스트 가운데 호스트가 돌려 red 인 것만 kept finding 으로 남는다 (`verify-loop.md §4`).
- **승급** — 착지한 요구만 승급한다 (`parallel-waves.md` PW-16).
- **재개** — 진행 상황과 재개 상태(재개 커서의 dispatch base 는 노드 행의 `base_sha`)는 `speckiwi orchestrate wave status --json` 하나로 읽고, `kiwi/waves.jsonl` 과 그래프 파일을 손으로 읽지 않는다 (§6).
- **닫힌 중단** — 아래 정지는 `--drive` 로도 열리지 않고(§7.5.1 · §7.5.2), `--auto` 는 critical gate 를 열지 않는다(§7.1): `external-module-impact` · `existing-test-weakened-or-deleted` · `existing-public-contract-change` · `existing-file-deleted-or-moved` · `mock-detection` · `tdd-bypass-attempt` · `out-of-scope-user-consent` · `unsafe-option-refused` · `wave-append-cap-exhausted` · `prd-record-tampered` · `prd-unapproved-user-decision` · `prd-residual-user-decision` · `prd-cap-unpassed-user-decision` · `wave-verify-kept-finding` · `final-verify-kept-finding` · `wave-verify-fail-residual`.

---

## Workflow 도구 정책

워커 세션 기록 조회의 정상 경로는 공식 workflow 읽기 도구다 — 증거로 읽는 워커 `kiwi-pm` 세션의 `worklog.jsonl` 은 MCP `workflow_worklog_tail` 로, 그 세션의 `pm-state.json` 은 `workflow_session_status` 로 읽는다(수확한 사본이면 그 경로를 `path` 로 준다). 파일을 직접 읽는 것은 그 도구를 쓸 수 없을 때의 degraded 폴백이며, 그 실행은 도구 진단·산출물 경로·active target·후속 요구 또는 후보 ID 를 사용자 보고에 함께 남긴다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **이벤트 SSOT**: `../_shared/kiwi/waves-event.md` v2.0.0 가 `./kiwi/waves.jsonl` 의 schema·파일위치·mark-complete 규칙 SSOT. 본 문서는 wave 분해·오케스트레이션 로직만 담당. |
| §0.2 | **/snoworca-\* 호출 절대 금지**. kiwi-* 시리즈만 `Skill` 도구로 호출한다. |
| §0.3 | **CLAUDE.md §6 시그니처 금지** + **§7 변경 이력 금지**. 본 스킬 본문에 변경 이력 섹션 없음 — git history 가 SSOT. |
| §0.4 | **--auto 안전 게이트**: wave 마다 부르는 자식 — `$kiwi-srs` · `$kiwi-srs-feasibility` · `$kiwi-sds` · 워커의 `$kiwi-pm` — 과 §5.55 · 개선 위임이 **직접** 호출한 `$kiwi-review-fix-loop` 가운데 어느 것이 `NEEDS_USER` / `FAILED` 를 반환하거나 critical 게이트에 도달하면, `--auto` 라도 자동 진행을 중단하고 사용자 결정을 받는다. |
| §0.5 | **wave 경계 불변 원칙**: dispatch 한 wave 의 순서 · 범위 · 의존은 바꾸지 않는다 — 바뀌면 그 wave 를 딛고 선 wave 의 토대가 달라진다. 남은 wave 는 `wave-decomposition.md §6` 의 R1 ~ R5 로만 바뀐다 — 남은 wave 는 `orchestrate wave status` 의 행이 `dispatched: false` 이고 저널 줄이 없는(`ts` 가 null) wave 다 — `--sds` 의 SDS 줄처럼 저널에 이미 이름이 오른 wave 도 바꾸지 않는다. 새 wave 를 **추가**하는 것(R3 · R4, run 당 3 회 상한)은 dispatch 한 wave 를 바꾸지 않으므로 이 원칙의 **예외**로 허용된다. 끝난 wave 의 `verified` 동작을 옮기는 길은 후속 요구와 AC 만료뿐이다(`wave-srs-registration.md §2`). |
| §0.6 | **멱등 재개**: 이미 완료로 표시된 wave 는 재실행하지 않고 건너뛴다. 진행은 항상 첫 미완료 wave 부터 이어간다 — 그 wave 가 든 stage 의 준비 집합을 다시 계산한다. |
| §0.7 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §0.8 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. 본 스킬의 `critical_gates[]` 선언은 §0.G 참조 |
| §0.9 | **요구 분해 SSOT**. 본 스킬은 `../_shared/kiwi/wave-decomposition.md` v1.0.0 을 따른다 — SRS 한 번 뒤의 분해 순서, 그래프 `acs` 가 곧 배정, PRD 커버리지, 재분해 규칙 R1 ~ R5. `artifact_root` 로 `docs/analysis/kiwi-wave-master-{run_id}/` 를 전달한다(§3) |
| §0.10 | **wave 검증 엔진 SSOT**. 본 스킬은 `../_shared/kiwi/verify-loop.md` v1.0.0 을 따른다 — 기계 검사, 라운드마다 새 검증자, red 테스트만 남는 kept finding, 종료 조건(§5.5.4), 진동 감지, 개선 위임(§5.5.5), 교차 wave 이월(§5.5.7). 본 스킬 고유의 **검증 범위**는 §5.5.2 |
| §0.11 | **SRS 저작 계약 SSOT**. 본 스킬은 `../_shared/kiwi/wave-srs-registration.md` v1.0.0 을 따른다 — run 당 한 번의 처음 저작과 stage 당 한 번의 워커 델타 증분 저작, 두 호출뿐이다 |
| §0.12 | **워크트리 레인 SSOT**. 본 스킬은 `../_shared/kiwi/worktree-lane.md` v1.0.0 을 따른다 — run root 와 lane workspace 의 분리, 명시 checkout 의무, 레인이 하지 않는 세 가지, role 게이트, 호스트 판정, 재생 승인. 각 wave 의 워커는 그 계약 아래 자기 워크트리에서 돈다. 본 스킬(호스트)은 워크트리로 **옮겨 가지 않는다** — MCP root 가 세션을 따라가지 못하기 때문이다(§2.1). |
| §0.13 | **병렬 wave 실행 SSOT**. 본 스킬은 `../_shared/kiwi/parallel-waves.md` v1.0.0 을 따른다 — 역할과 쓰기 소유, 동시성과 `--serial`, wave 의존과 stage, 계약이 올리는 게이트, stage 한 번의 순서(PW-1 ~ PW-17), 재개. 본 스킬은 그 절차를 다시 적지 않고 자기 분모(§5.5)와 기록(§6)만 적는다. |
| §0.15 | **SDS 는 opt-in**. 사용자가 `--sds` 를 주거나 말로 요청할 때만 wave 마다 SDS 를 쓴다(`parallel-waves.md` PW-2) — opt-in 이 없으면 SDS 를 쓰지 않고 SDS 로 구현하지도 않는다. wave 는 작업 그래프 `waves/waves.json` 노드의 요구 집합으로 구현되고, `--sds` 는 `parallel-waves.md` 의 wave 마다의 호출로 그대로 넘긴다. `docs/sds/` 에 SDS 가 있다는 것만으로는 요청이 아니다 |
| §0.14 | **테스트 충분성 SSOT**. 본 스킬은 `../_shared/kiwi/test-sufficiency.md` 를 따른다 — wave 승급 직전(PW-14)과 run 창 종료 리뷰 뒤(§5.55)에 부르고, 절차를 다시 적지 않는다. |
| §7 참고 | `--mini`/`--loops N` 를 `kiwi-srs` · `kiwi-srs-feasibility` 와 `parallel-waves.md` 가 wave 마다 부르는 호출에 전파 (loop-option.md §6) |

---

## 0.G `critical_gates[]` (auto-option.md §5 인터페이스)

아래 게이트는 `--auto` 라도 자동 진행을 중단하고 사용자 결정을 받는다 — 결정 서브에이전트로 우회할 수 없다.

`run-root-preflight-mismatch` · `unsafe-option-refused` 는 §2.1 이 명령하는 중단을 SSOT 인터페이스로 **전사**한 것이다. `parallel-waves.md §4` 가 올리는 계약 게이트도 전부 이 표에 있다. 본 표의 **모든** 게이트를 함께 선언하는 이유는, 일부만 선언하면 **선언되지 않은** 나머지 중단이 위원회 판단 대상으로 떨어지기 때문이다.

| gate_id | reason | 발생 위치 |
|---|---|---|
| `run-root-preflight-mismatch` | MCP workspace root ↔ run git root 불일치 또는 조회 실패 | §2.1 |
| `child-pipeline-needs-user-or-failed` | 호스트가 wave 마다 부른 `$kiwi-sds`(`--sds`), 또는 개선 위임이 부른 `$kiwi-review-fix-loop` 가 `NEEDS_USER` / `FAILED` 반환, `--sds` 면 wave SDS 들의 `@req` 합집합이 노드의 요구 집합과 다름(`parallel-waves.md` PW-2), 또는 워커 매니페스트의 `review_outcome` 이 중단이거나 kept finding 이 남음 | §5 / §5.5.5 |
| `wave-verify-kept-finding` | 웨이브 종료 검증이 kept finding 을 남긴 채 끝남, 또는 cap 소진(`fail-cap`). `fail-residual` 은 이 행이 아니라 **별도 행** `wave-verify-fail-residual` 이다 | §5.5 |
| `wave-verify-cross-wave-fix-required` | 이전 wave 의 **요구사항**을 바꿔야 하고, carry-forward 경로가 양쪽 다 불가능함 — `complete` 는 취소 불가 (§0.5 / §5.5.7) | §5.5 |
| `wave-decomposition-coverage-gap` | PRD 항목을 제품 target 의 요구도 다른 어느 target 의 요구도 인용하지 않음 — 다음 dispatch 앞에서 멈춘다(`wave-decomposition.md §5`) | §3 · §4 |
| `final-verify-kept-finding` | 전체 wave 최종 검증이 kept finding 을 남긴 채 끝남, cap 소진(`fail-cap`), 또는 `fail-residual` — `--auto` 라도 중단 | §5.6 |
| `terminal-review-loop-missing` | §5.55 가 정한 조건이 충족되지 않은 채 통과 판정이 기록됨 | §5.55 / §5.6 |
| `child-review-fix-loop-needs-user-or-failed` | §5.55 가 **직접** 호출한 `$kiwi-review-fix-loop` 이 `NEEDS_USER` / `FAILED` 반환 — 워커가 아니라 본 스킬이 spawn 하므로 워커 게이트가 덮지 못한다 | §5.55 |
| `unsafe-option-refused` | `--skip-regression` / `--reviewer-off` 요청 — 회귀와 리뷰를 끄면 wave 누적 위에서 결함 피해가 복리로 커진다 | §2.1 |
| `child-srs-needs-user-or-failed` | 직접 호출한 `$kiwi-srs` 또는 `$kiwi-srs-feasibility` 가 `NEEDS_USER` / `FAILED` 를 반환하거나 자체 critical 게이트에 도달 — 처음 저작 · 증분 저작 · 검증이 이끈 재저작 모두 | §3 / §4 / §5.5.5 |
| `decomposition-input-missing` | 요청 · PRD · 입력 문서 · 에픽 이슈가 모두 부재 — 입력을 위원회가 창작할 수 없다 | §1.1 |
| `integration-test-user-consent` | 워커의 kiwi-coder 통합 테스트 동의 게이트 — `--auto-integration` 이나 `--drive` 가 **명시**되지 않으면 `--auto` 라도 여기서 멈춘다 | §7.1 / §7.4 / §7.5 |
| `cost-warning-large-task` | 워커의 kiwi-coder 비용 경고(실행 시간 ≥10분) — `--auto-cost-warning` 이나 `--drive` 가 **명시**되지 않으면 `--auto` 라도 여기서 멈춘다 | §7.1 / §7.4 / §7.5 |
| `wave-verify-fail-residual` | 웨이브 종료 검증이 상한 전에 kept finding 을 남기고 끝남(`verdict="fail-residual"`) — 그 wave 는 `complete` 를 append 할 수 없어 위원회에는 저널 규칙을 만족하는 선택지가 없다 | §5.5 |
| `out-of-scope-user-consent` | run 이 제품 target 의 요구 일부만 그래프 `scope.requirements` 에 남김 — 빠진 요구는 어느 분모에도 들지 않으므로 `--auto` 라도 run 당 한 번 사용자 동의를 받는다 | §3 |
| `wave-append-cap-exhausted` | run 당 wave 추가 상한 **3** 소진 — 무인 실행의 종료를 보장하는 유일한 경계 | §0.5 · §5.6 |
| `invalid-loop-option` | `--loops N` 이 정수 ≥1 이 아님 — `loop-option.md` §1 이 명령하는 HALT 를 게이트로 전사 | §0.7 / loop-option.md |
| `requirement-not-ready` | PW-4 의 feasibility 승급 뒤에도 `orchestrate schedule waves` 가 노드의 요구(없음 · `draft` · `deprecated` · `discarded`)로 거절 — 그 wave 는 dispatch 전에 멈춘다(`parallel-waves.md` PW-4) | §5 |
| `lane-worker-possibly-live` | 워커 워크트리가 `locked` 로 보고되어 그 워커가 살아 있을 수 있음 — 다시 dispatch 하지 않는다(FR-FLOW-118). `--auto` 가 결정하지 않는다 — `NEEDS_USER`(`parallel-waves.md` PW-5 · §6) | §5 / §6 |
| `schedule-cycle` | wave 의존 사이클 때문에 `orchestrate schedule waves` 가 stage 를 계산하지 못함 | §5 |
| `files-not-grounded` | 그래프 노드의 `files`(`--sds` 면 SDS 의 Files · Test Plan 경로도)가 기존 경로의 오타로 판정됨 | §5 |
| `lane-plan-drift` | 재개 때 stage 계획을 다시 계산한 결과가 `lanes.lock.json` 과 다름 — 선언 항목 digest, 또는 close-out 이 아직 손대지 않은 wave SDS 의 digest 가 달라짐 | §6 |
| `worker-touched-srs` | dispatch 전후 run root 의 `git status --porcelain docs/spec docs/sds` 가 다름 — 워커가 SRS 나 SDS 를 건드림 | §5 |
| `serial-unit-failed` | wave 의 `verification_cmd` 가 같은 단위로 1회 재시도한 뒤에도 비-0, 워커가 커밋도 `intentionally_empty` 사유도 남기지 않음, 또는 워커의 `$kiwi-pm` 이 `NEEDS_USER` / `FAILED` 반환 | §5 |
| `lane-design-refuted` | 워커가 설계 항목을 기술대로 구현할 수 없다고 매니페스트로 보고 | §5 |
| `srs-mutation-replay-failed` | `orchestrate replay apply` 가 워커의 유예 mutation 재생을 거절하거나 실패를 기록 | §5 |
| `post-merge-index-drift` | 재생 뒤 `sync_index` 를 돌린 뒤에도 `validate --fail-on-warning` 이 드리프트를 보고 | §5 |
| `cross-lane-duplication-unresolved` | stage 마감의 중복 감사가 낸 `duplicate` 판정이 그 wave 의 이슈로 해소되지 않음 (`parallel-waves.md` PW-12) | §5 |
| `test-sufficiency-gap` | 테스트 충분성 확인이 한 번 채운 뒤에도 인용 공백을 남김 — `test-sufficiency.md` | §5.5.8 / §5.55 |
| `validate-spec-error` | `validate_spec` 가 error 급 진단을 하나라도 돌려줌 — 오류를 안은 요구 위에 증거와 승급을 쌓으면 그 통과가 무엇을 근거로 기록되었는지 되읽을 수 없다 | §5.6 — 모든 wave 가 `complete` 된 뒤 |

**이 게이트를 관측하는 자리**: 위 표에서 이 행의 세 번째 칸이 가리키는 홉에서 MCP `validate_spec` 을 실행한다 — MCP 가 없으면 CLI `speckiwi validate --json` 이다. error 급 진단이 하나라도 남아 있으면 그 홉을 진행하지 않고 `validate-spec-error` 로 중단하며, `--auto` 도 이 중단을 덮지 못한다. 실행하지 않은 채 통과로 기록하지 않는다.

`wave-verify-kept-finding` 은 `--auto` 라도 wave 오케스트레이션 **전체를 중단**시킨다. wave 는 그것에 의존하는 wave 의 토대이고 앞선 `complete` 기록은 되돌릴 수 없으므로, 결함을 안고 진행하면 피해 범위가 남은 wave 수에 비례해 커진다.

> **`--auto` 활성 조건**: `auto-option.md` §5 상 `critical_gates[]` 미선언은 `--auto` **비활성**을 뜻한다. 본 표의 선언으로 이 스킬의 `--auto` 는 **활성**이며, 위 게이트들이 그 활성 상태의 HALT 지점이다.

`parallel-waves.md §4` 의 `partition-review-unrecorded` 는 `business-decision` 이므로 이 표에 없다.

---

## 1. 입력 / 출력

### 1.1 필수 입력

- 대형 작업을 기술하는 **요청 · 연구 문서 · 계획 문서 · 로드맵**(경로 또는 프롬프트 참조), 또는 승인된 **PRD**(`docs/prd/`), 또는
- **에픽 이슈**(GitHub epic issue 번호 — §8 진입 모드).

어느 것도 없으면 사용자에게 무엇을 할지 **묻는다**(§0.G `decomposition-input-missing`) — 입력은 위원회가 추론으로 만들어내는 대상이 아니다. 입력은 PRD `U-1` 의 원천이 되고, 분해하는 것은 그 PRD 로 저작한 요구 집합이다.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "자동", "auto", "끝까지 알아서", "묻지 말고" | `--auto` (모든 wave 자율 완주, SSOT: auto-option.md v1.0) | off |
| "max 모드", "고강도", "최대로" | `--max` (모든 wave 의 하위 스킬로 전파) | off |
| "SDS 로", "SDS 써서", "SDS 를 써", "use SDS", "with an SDS" | `--sds` (wave 마다 SDS 를 써서 구현 — `parallel-waves.md` PW-2. wave 마다의 호출로 그대로 넘긴다) | off (노드의 요구 ID 로 구현) |
| "직렬로", "하나씩", "순서대로", "serially", "one at a time" | `--serial` (모든 서브에이전트 분기 — 워커, SDS 작성(`--sds`), 조사자, 검증자 — 를 하나씩, `parallel-waves.md §2`) | off (병렬) |
| "N 번째 wave 부터", "이어서" | `--resume` (첫 미완료 wave 부터 재개) | 자동 감지 |
| "에픽 이슈", "이슈 #123 를 wave 로" | 에픽 이슈 번호 (§8 진입 모드) | (없음) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` (kiwi-srs 와 계약의 호출로 전파 §7.3) | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` (kiwi-srs 와 계약의 호출로 전파 §7.3) | off (스킬 기본 상한) |
| "이 run 이어서", "run id 지정" | `--run-id <id>` (재개할 run 명시 §6) | 자동 감지(가장 최근 미완료 run) |
| "통합 테스트 자동 동의" | `--auto-integration` (워커의 kiwi-coder 게이트까지 pass-through §7.4) | off |
| "비용 경고 자동 skip" | `--auto-cost-warning` (워커의 kiwi-coder 게이트까지 pass-through §7.4) | off |
| "무인 완주", "스스로 판단해서 진행", "drive" | `--drive` (무인 완주 + 경계 있는 자가 복구 §7.5) | off |
| "제약", "이건 지켜줘", "금지 사항" | `--constraint <text>` (반복 가능; 선언 제약을 `constraints_path` 아티팩트에 수집, §3) | (없음) |
| "락 강제 해제", "force" | `--force` (워커의 kiwi-pm stale `pm.lock` 해제까지 pass-through §7.4, **명시** 입력만) | off |
| "stage 당 워커 N 개" | `--lanes N` (stage 당 워커 상한, `orchestrate schedule waves --lanes N`) | 4 |
| "로드맵 항목 RM-n", "RM-n 을 실행" | `ROADMAP_ITEM=RM-<n>` (이 run 이 실행하는 로드맵 항목, §3.1) | (없음 — 로드맵 도구를 부르지 않는다) |

### 1.3 출력

- **대화 메시지**: wave 분해 결과(순서·범위·의존), 현재 stage 와 진행 상황, 다음 stage.
- **`./kiwi/waves.jsonl`**(의무): wave 별 상태 append-only 로그 (waves-event.md schema).
- `$kiwi-srs`·`$kiwi-sds`·워커 산출물은 각 스킬이 자체 기록하고, 워커 매니페스트는 `docs/analysis/kiwi-wave-master-{run_id}/waves/stage-{s}/{laneId}/` 로 수확된다.

---

## 2. Phase 흐름

```
Preflight : Run-root preflight 게이트 (§2.1) — MCP workspace root ↔ run git root 일치 검사
            + 격리 판정 (parallel-waves.md §2) — worktree-parallel 또는 worktree-serial
Phase 0 : 입력 해석 + waves.jsonl 경로 해석 (재개 감지)
Phase 1 : SRS 한 번 저작과 Wave 분해 (§3) — PRD → $kiwi-srs 처음 저작 → feasibility 한 번 → PRD 커버리지
          → 영향 분석 → orchestrate wave propose → 메타데이터 → orchestrate wave check → 2.0.0 그래프 커밋
stage 마다 — 의존한 wave 가 모두 complete 인 준비 집합 위에서:
  Phase 3 : stage 실행 (§5) — (--sds 면 SDS 작성) → draft 승급 → stage 계획 → 워커 병렬 → 판정 → 병합 → 재생 → 델타 증분 저작 (PW-2 ~ PW-12, PW-10 뒤 PW-1)
  Phase 3.5 : 웨이브 종료 검증 (§5.5) — 기계 검사 → 라운드마다 새 검증자의 red 테스트 — 엔진 SSOT verify-loop.md (PW-13)
  Phase 3.6 : wave 승급 (§5.5.8) — 테스트 충분성 → (--sds) SDS close-out → 승급 → (--sds) SDS 삭제 (PW-14 ~ PW-17)
  Phase 4 : waves.jsonl 갱신 (§6) — 통과한 wave 만 완료 표시
Phase 4.4 : run 창 종료 리뷰 (§5.55) → 테스트 충분성 확인
Phase 4.5 : 전체 wave 최종 검증 (§5.6) — run 의 모든 요구 대비 최종 패스, 통과해야 오케스트레이션 완료
Phase 5 : 자기 이벤트 emit (§9)
```

Phase 3~Phase 4 는 **stage 마다 반복**된다. SRS 는 Phase 1 에서 한 번 저작되었고, stage 는 워커 델타를 증분으로만 반영한다(§4).

재개 시 Phase 0 에서 `speckiwi orchestrate wave status --json` 으로 진행 상황을 읽어 첫 미완료 wave 로 곧바로 점프하고, 그 wave 가 든 stage 의 준비 집합을 다시 계산한다 — `kiwi/waves.jsonl` 과 그래프 파일을 손으로 읽지 않는다(§6).

---

## 2.1 Preflight — Run-root preflight 게이트 (FR-FLOW-042)

wave 분해에 들어가기 전에 본 스킬은 이 run 의 **run root** 를 확정하고, SpecKiwi MCP 가 보고하는 workspace root 와 일치하는지 검사한다.

1. `mcp_workspace_info` 를 호출해 `workspaceRoot` 를 읽는다.
2. `git rev-parse --show-toplevel` 로 이 run 의 git root 를 읽는다.
3. 두 값을 아래 규칙으로 **정규화한 뒤** 비교한다. 두 값의 생산자가 다르므로(예: MCP 는 `path.resolve` 결과, git 은 POSIX 스타일 경로) 문자열을 그대로 비교하면 같은 저장소에서도 항상 불일치한다.
   - (a) 경로 구분자를 `/` 로 통일한다(역슬래시 → 슬래시).
   - (b) 후행 구분자를 제거한다.
   - (c) Windows 에서는 드라이브 문자를 포함해 대소문자를 무시하고 비교한다.
   - (d) 가능하면 `realpath` 로 심볼릭 링크를 해소한 뒤 비교한다.

   예 — 정규화 전 `C:\Work\repo\` (MCP) vs `C:/Work/repo` (git) → 정규화 후 둘 다 `c:/work/repo` → 일치로 판정.

이 preflight 검사는 **wave 분해·target 등록·SRS mutation·워커 dispatch, 그리고 `waves.jsonl` 경로 해석 및 재개(resume) 읽기보다 먼저** 수행한다 — 불일치한 root 에서 저널을 먼저 읽어 root 를 pin 하는 순서를 막기 위해서다.

불일치이거나 조회에 실패하면 **즉시 critical 중단**한다. `--auto` 로도 이 중단을 우회할 수 없다. `mcp_workspace_info` 에서 `workspaceRoot` 를 얻지 못한 경우도 불일치와 동일하게 취급하며, `speckiwi` CLI 는 이 비교의 폴백이 아니다 — CLI 는 root 를 호출자의 cwd 에서 해석하므로 폴백으로 쓰면 검사 자체가 무의미해진다.

중단 시점에는 SRS mutation 0 건이어야 하고 자식 스킬을 하나도 spawn 하지 않은 상태여야 한다.

중단 출력에는 다음 네 가지를 모두 담는다.

- 복구 경로 1 — 워크트리를 쓰지 말고 단일 root 에서 `git switch` 로 브랜치를 전환해 사이클을 돌린다.
- 복구 경로 2 — 의도한 워크트리를 작업 디렉터리로 하는 새 agent 세션을 시작한다. 세션 도중의 워크트리 이동은 해법이 아니다 — 이미 떠 있는 MCP 서버는 재기동되지 않는다.
- 경고 1 — 분기된 워크트리를 root 로 하는 세션에서는 **신규 Requirement ID 를 할당하지 않는다**.
- 경고 2 — 워크트리를 root 로 하는 세션은 호스트 저장소의 `docs/spec/` 을 편집할 수 없다. 그 경로가 세션 작업 디렉터리 바깥이기 때문이다.

에픽 이슈 진입 모드도 동일한 게이트의 적용을 받는다.

**격리 판정**: 같은 preflight 에서 런타임이 워크트리 격리 워커를 띄울 수 있는지 판정해 `isolation.profile` 을 `worktree-parallel` 또는 `worktree-serial` 로, `isolation.reason` 에 근거를 적는다(`parallel-waves.md §2`). `--serial` 이나 자연어 "직렬로 / 하나씩 / 순서대로" 요청도 `worktree-serial` 이다. 워커의 워크트리는 호스트가 run 스코프로 만든다 — 사용자가 워크트리 위임을 요청해도 받아들이지 않고 이 절차로 대신한다.

**work-mode 판독**: 같은 preflight 에서 `get_work_mode`(MCP 우선, CLI `speckiwi mode` 폴백)로 지속된 work-mode 를 읽는다. wave 사이클은 **body-scope**(본문 스코프) 작업이므로, `tdd` 모드의 step-scoped 라우팅(`kiwi-tdd` 위임)은 wave 사이클에 **적용되지 않는다** — wave 는 body SRS target 을 단위로 돌고 step 디렉터리를 쓰지 않기 때문이다.

**위험 옵션 거부**: `--skip-regression` / `--reviewer-off` / `--no-review-loop` / `--skip-review-loop` 요청은 **거부한다** — 종료 hop 은 끌 수 없고 적용 여부는 커밋 창이 정하므로, 조용히 무시하지 않고 이름을 들어 거부한다 — 회귀 검증과 리뷰를 끄면 wave 가 그것에 의존하는 wave 의 토대라는 전제 위에서 결함이 복리로 누적된다(§0.G `unsafe-option-refused`).

**회귀 기준선 캡처**: preflight 에서 전체 회귀 스위트를 **1회** 실행해 실패 목록을 `baseline_failing_tests` 로 캡처하고, 그 값을 이 **run 전체에 pin** 한다 — wave 마다 다시 재면 앞 wave 가 만든 실패가 다음 wave 의 기준선으로 승격된다. 캡처는 kiwi-coder `state.regression_baseline` 과 같은 스위트·같은 명령을 쓰며, 두 값은 하나의 SSOT 를 공유한다. 캡처 자체가 실패하면 `baseline_failing_tests` 를 부재로 두고 그 사실을 보고한다.

---

## 3. Phase 1 — SRS 한 번과 요구 분해 (FR-FLOW-212)

`../_shared/kiwi/wave-decomposition.md` v1.0.0(§0.9) 의 §2 순서를 그대로 돈다 — PRD → 처음 저작(`wave-srs-registration.md §1`) → feasibility 한 번 → PRD 커버리지 → 영향 분석 → `speckiwi orchestrate wave propose` → 메타데이터 → `orchestrate wave check` 를 통과한 2.0.0 그래프 커밋. 본 스킬은 **사본을 만들지 않는다**. 그 모듈에 넘기는 `artifact_root` 는 `docs/analysis/kiwi-wave-master-{run_id}/` 이고, 그 모듈의 `orchestrate` 호출(`wave check` · `wave show` · `wave status`)에는 언제나 `--engine kiwi-wave-master` 를 더한다. 제품 target 은 이 run 의 요구를 모두 담는 target 이다.

그래프의 `edges` 가 §5 의 stage 를 정한다 — 간선이 없는 노드끼리는 쓰기 집합이 겹치지 않는 한 같은 stage 에 든다.

### 3.1 로드맵 항목 (FR-FLOW-226)

`ROADMAP_ITEM` 이 없으면 run 은 로드맵 도구를 하나도 부르지 않는다.

`ROADMAP_ITEM=RM-<n>` 이 있으면 Phase 0 에서 `get_roadmap_item` 으로 그 항목을 읽고, 그 `Planned End` 는 계획 보고(§1.3 의 wave 분해 결과)에만 쓴다. `add_roadmap_item` 은 부르지 않고, `update_roadmap_item` 은 아래 그래프 커밋 때의 한 번만 부르며, 다른 항목에는 `update_roadmap_item` 도 `sync_roadmap_actuals` 도 부르지 않는다. 자식 스킬 호출에는 `ROADMAP_ITEM` 을 넘기지 않는다.

**그래프 커밋 때 한 번.** §3 에서 그래프를 커밋하고 run 의 첫 graph 줄을 쓰는 그때 `get_roadmap_item` 으로 그 항목을 다시 읽어, 아래에서 해당하는 것을 모두 담은 `update_roadmap_item` 을 한 번 부른다. 사유(`reason`)는 `kiwi-wave-master run {run_id}` 다. 해당하는 것이 없으면 부르지 않고, 재분해로 그래프를 다시 커밋할 때도 부르지 않는다.

- 실제 시작이 비어 있으면(`schedule.actual.start` 가 null, 문서 값 `-`) `actualStart` 를 run 을 시작한 날짜로 쓴다.
- 항목 자신의 `targets` 와 `requirements` 가 둘 다 비어 있을 때만(문서 값 `-`) run 의 범위를 연결한다 — 커밋한 그래프의 `scope` 가 target 이면 제품 target 을 `targets` 로, 요구 목록이면 run 의 요구 ID 를 `requirements` 로 넣는다. 둘 중 하나라도 적힌 항목의 `Targets` · `Requirements` 는 바꾸지 않는다.

## 4. stage 안의 SRS 증분 저작 (FR-FLOW-218)

stage 는 SRS 를 처음부터 저작하지 않는다. 워커가 매니페스트의 `srs_deltas[]` 로 보고한 요구 변경을, 호스트가 PW-10 재생 뒤 · PW-13 검증 앞에서 `../_shared/kiwi/wave-srs-registration.md` v1.0.0(§0.11) §2 의 호출 하나로 반영한다(`parallel-waves.md` PW-1). 새 요구는 `wave-decomposition.md §6` 의 R1 ~ R5 로 남은 wave 에 넣고, 증분 저작 뒤에는 PRD 커버리지를 다시 돈다.

---

## 5. Phase 3 — stage 실행 (FR-FLOW-188)

본 스킬은 wave 를 `$kiwi-pipeline` 에 위임하지 않는다. stage 마다 `../_shared/kiwi/parallel-waves.md` §5 의 PW-3 ~ PW-12(`--sds` 면 PW-2 부터)와 PW-10 뒤의 PW-1 을 artifact root `docs/analysis/kiwi-wave-master-{run_id}/` 로 돈다 — (`--sds` 면) wave 마다 SDS 하나를 쓰고(`$kiwi-sds`, sds-id `{run_id}-wave-{n}`), stage 계획을 동결·공개하고, wave 하나를 워커 하나가 자기 워크트리에서 구현하고, 호스트가 판정·병합·재생한다. `--serial` 이면 모든 분기가 하나씩이다. 각 호출의 인자와 `[--auto] [--max] [--mini|--loops N]` 은 그 계약이 적는 자리에 있다. 그 계약의 `speckiwi orchestrate wave status` · `speckiwi orchestrate schedule waves` 호출에는 언제나 `--engine kiwi-wave-master` 를 더한다 — 두 도구의 기본 엔진은 `kiwi-orchestrator` 라, 빠뜨리면 이 스킬의 저널 줄을 읽지 못해 `complete` 인 wave 도 보지 못한다.

wave 는 자기가 의존한 wave 가 모두 §5.5 **웨이브 종료 검증**까지 통과해 `complete` 로 기록된 뒤에야 준비 집합에 든다 — 병합만으로는 부족하다. 검증 중인 wave 위에 의존한 wave 를 쌓으면 §0.G 의 halt 게이트가 무의미해진다.

`$kiwi-srs` 저작은 §3 에서 한 번 끝났다. SDS 작성과 워커는 그 저작을 다시 돌리지 않는다 — 다시 SRS 를 쓰는 것은 §4 의 델타 증분 저작, 개선 위임의 증분 `$kiwi-srs` 재진입과 SDS close-out 의 AC 명확화뿐이다.

target 은 인자로 제품 target 을 **명시 전달**한다 — (`--sds` 면) `$kiwi-sds` 에는 `TARGET=<제품 target>`, 워커 카드에는 `target` 으로. 활성 target 이 `$kiwi-srs` 의 `set_active_target` **부수효과**로만 정해지면, §3 을 건너뛰는 재개(§6)에서 그 호출 지점이 사라져 다음 단계가 다른 target 위에서 돈다.

그 wave 로 `carried_into` 된 residual 은 그 wave 의 요구 범위(`--sds` 면 SDS 범위)와 재진입 범위에도 포함한다 — 저작만으로는 코드 수준 이월이 어느 워커에도 배정되지 않는다.

---

## 5.5 Phase 3.5 — 웨이브 종료 검증 (FR-FLOW-220)

wave 의 워커가 병합되고 그 유예 SRS mutation 이 재생된 뒤(`parallel-waves.md` PW-9 · PW-10), **§6 의 `waves.jsonl` `complete` 기록 이전에** 본 루프를 돌린다 — 그 계약의 설계 적합 검증(PW-13)이 바로 이 단계다. 통과하지 못한 wave 는 `complete` 로 기록하지 않는다. 그 wave 의 증거 창에 워커의 `kiwi-review-fix-loop` 실행이 없는 wave 도 마찬가지로 `complete` 로 기록하지 않는다 — 부재를 사후 finding 으로 올리는 것과 기록 자체를 막는 것은 다르다.

`complete` 를 먼저 쓰고 사후 감사하는 배치는 쓸 수 없다 — `complete` 는 append-only 이고 전이도에 `complete → failed` 간선이 없으며 §0.6 재개가 완료 wave 를 영구히 건너뛰므로, 실패가 어떤 후속 동작도 바꾸지 못하는 장식이 된다.

**범위 밖**: hunk 단위 코드 리뷰는 본 계층의 범위 밖이며 `kiwi-review-fix-loop` 가 이미 소유한다 — 여기서 재수행하지 않는다. 본 계층이 값을 하는 조건은 diff 가 아니라 **wave 단위 증거**를 보는 것이다.

루프 **엔진**은 `../_shared/kiwi/verify-loop.md` v1.0.0(§0.10) 를 그대로 따른다 — 기계 검사(그 문서 §2), 라운드마다 새로 띄우는 검증자(§3), red 테스트만 남는 finding(§4), 종료 조건(§5), 진동 감지, 개선 위임(§7), 교차 wave 이월(§8) 이 전부 거기에 있고 본 스킬은 **사본을 만들지 않는다**. 본 절은 그 엔진에 **공급하는 것** — 검증자 입력과 호스트가 읽는 것(§5.5.1), 검증 범위(§5.5.2), 저널 기록(§5.5.6) — 만 규정한다. 검증이 병합된 결과가 SRS · SDS · 기록된 결정과 다르다고 판정하면 원래 워커가 아닌 독립 서브에이전트가 고치고 새 검증자가 다시 검증한다 — kept finding 을 고치는 경로는 엔진의 개선 위임이다.

### 5.5.1 검증자 입력과 호스트가 읽는 것

검증자에게 주는 것은 `verify-loop.md §3` 의 목록뿐이다 — 그 노드의 `orchestrate wave show --wave wave-{n}` 이 주는 PRD 항목(`prd_items`)과 요구 ID · AC(`acs`, AC 본문은 `get_requirement`), run 의 PRD 경로와 그 PRD 의 제외 항목, 그 wave 의 diff 창(`diff_window` 의 `base_sha` ~ `head_sha` — 대화 상태가 아니라 저널에서 읽는다: `base_sha` 는 그 wave 의 **첫** dispatch base — `speckiwi orchestrate wave show --wave wave-{n} --waves docs/analysis/kiwi-wave-master-{run_id}/waves/waves.json --run-id {run_id} --engine kiwi-wave-master --full --json` 의 저널 목록에서 `phase="worker"` 인 가장 이른 줄의 `isolation.base_sha` — 이고, 창이 아래 표대로 그 wave 의 모든 run 을 담으므로 재진입이 있어도 옮기지 않아 재진입 뒤에는 최신 dispatch 의 것인 재개 base(§6, `wave status` 노드 행의 `base_sha`)와 다르며, `head_sha` 는 §5.5.6 대로 wave-verify 라운드 진입 시점의 HEAD 다), 통합 항목, run 의 제약 파일(`constraints_path`).

아래 표는 호스트가 기계 검사(`verify-loop.md §2`)와 `complete` 판정에 읽는 증거이며, 검증자에게 넘기지 않는다.

| 증거 | 내용 |
|---|---|
| `kiwi/waves.jsonl` (해당 wave) | order · target · scope · `sds_id` · `in_progress` 타임스탬프 — `orchestrate wave status` 로 읽는다 |
| 그래프 노드 (`orchestrate wave show --wave wave-{n}`) | 그 노드의 `files` · 요구 집합 · `prd_items` |
| (있으면) wave SDS `docs/sds/{sds_id}.sds.md` | 그 wave 가 *하기로 한* 것 — §5.5.8 의 close-out 이 지우기 전에 읽는다 |
| 워커 매니페스트 `docs/analysis/kiwi-wave-master-{run_id}/waves/stage-{s}/{laneId}/manifest.json` | commits · `requirements` · `intentionally_empty` · `design_refuted` · `srs_deltas` · `out_of_lease_paths` · 테스트 충분성 결과 · 보고서 경로 |
| 워커의 세션 worklog | 매니페스트의 `reports[]` 가 가리키는, 단위 id(`sds_id`)로 키잉된 `kiwi-pm` 세션들의 `worklog.jsonl` — TDD 단계, skip / override 기록 |
| `{review_fix_loop_analysis_dir}/report.md` | 워커가 자기 창을 돈 리뷰의 kept · dropped finding · 라운드 · 회귀 결과 |
| speckiwi `list_requirements` / `summarize_target` (제품 target) | 그 노드의 `acs`(`orchestrate wave show`)가 가리키는 AC 와 그 status |
| 그 wave head 의 전체 **회귀 스위트** 실행 | `command` · `exit_code` · `failing_tests` · `baseline_failing_tests` (wave head 에서 실행, 기준선은 §2.1 이 run 시작에 pin 한 값) |
| 그 wave 의 **기존 모듈** 목록 | `existing-modules.json` 에 적힌 그 노드의 `existing_modules` — 교차 wave 이월 판정의 입력 |
| 그 wave 의 **모든 run** | 그 wave 의 `sds_id` 로 기록된 **전량** — 워커의 run, 재진입의 run, 개선 서브에이전트의 run 이 모두 창 안에 든다 |

증거 창은 그 wave 의 `sds_id` 로 기록된 **모든** run 과 `in_progress` 타임스탬프로 경계 짓는다 — 가장 최근 run 하나로 창을 열면 재진입 이후의 수정이 창 밖에 남아, **수정 전 증거**로 재검증하거나 **낡은** 통과 증거로 통과한다. 워커는 pipeline 이벤트를 쓰지 않으므로 `pipeline.jsonl` 창을 열지 않는다.

`docs/analysis/` 는 스킬마다 **자체 run-id** 로 자기 디렉터리를 쓴다. 리뷰 보고서는 워커 매니페스트의 `reports[]` 가 실어 보낸 그 리뷰의 **자신의** 분석 디렉터리에서 해석한다. 위 표의 `{review_fix_loop_analysis_dir}` 가 바로 그 값이다. `*` 글롭으로 대신하면 창을 고정한 의미가 사라진다(다른 wave 의 보고서까지 걸린다). 그 wave 의 매니페스트에 워커 리뷰 보고서가 아예 없으면 글롭으로 대체하지 말고 **그 사실을 kept finding 으로 올린다** — 빈 `reports[]` 가 그 명령 출력이고, 워커가 자기 창을 리뷰하지 않았다는 뜻이다.

### 5.5.2 검증 범위

검증 범위는 그 노드의 `acs` 와 `prd_items`, 그리고 `verify-loop.md §3` 의 통합 항목이며 **검증자가 스스로 정하지 않는다**. 보존은 분모가 아니라 기계 검사다 — `orchestrate preservation check` 가 삭제·이동된 기존 파일, 바뀐 기존 export, 지운 테스트 · 케이스 · 단언을 보고하고, 도구가 보지 않는 단언 약화(바뀐 기대값, 느슨해진 술어)는 검증자가 판정한다(`verify-loop.md §2`). 그 판정 기준은 `kiwi-coder §0.20.3` 의 closed list 와 같다.

### 5.5.6 기록 (waves-event 2.0.0)

**라운드마다** — 루프가 끝난 뒤 한 번이 아니라 — 그리고 언제나 `complete` 를 쓰기 **전에** `waves.jsonl` 에 `status=in_progress` · `phase="wave-verify"` 인 이벤트를 1줄 append 하고, 거기에 그 시점까지의 `verification` 객체(`rounds` · `cap` · `verdict` · `findings` · `red_tests` · `residual` · `report_path`)를 싣는다 — 라운드 줄은 `orchestrate round record` 가 짓는다. 루프 종료 후 한 번만 쓰면 루프 도중 죽었을 때 `rounds` 가 하나도 남지 않아 재개가 0 부터 다시 세고, waves-event §4 가 약속한 카운터 누적이 거짓이 된다 — 불안정한 wave 가 `fail-cap` HALT 에 영영 닿지 못한다.

`verification` 에는 `frozen_denominator` 와 회귀 실행 `regression`(`command` · `exit_code` · `failing_tests` · `baseline_failing_tests`)도 함께 싣는다. 이것들이 없으면 라운드가 끝난 뒤 회귀 판정을 재구성할 수 없다.

마지막 라운드의 그 줄이 waves-event §3 이 요구하는 **선행 통과 기록**이며, 이것이 없으면 뒤따르는 `complete` 는 무효다.

(`--sds` 면) SDS 작성에 들어갈 때 `phase="sds"`, 워커를 dispatch 할 때 `phase="worker"` 인 `in_progress` 를 1줄씩 append 한다 — 워커 줄에는 `lane`(laneId) · `stage` · `isolation.base_sha`(그 wave 의 dispatch base) · `sds_id`(단위 id) 를 싣는다. 카드가 없는 본 스킬의 재개는 이 줄들을 `speckiwi orchestrate wave status --json` 으로 읽는다 — 노드 행이 그 노드의 최신 워커 줄의 `isolation.base_sha` 를 낸다(`parallel-waves.md §6`) — 그래야 그 enum 멤버가 실제 이벤트로 생산된다.

| verdict | 후속 |
|---|---|
| `in-progress` | 루프가 아직 도는 중인 **비종료** 라운드. 종료 verdict 를 앞당겨 쓰지 않는다 — `pass` 를 미리 쓰면 waves-event §3 게이트가 그 시점에 무너지고, `fail-residual` 을 쓰면 재개가 도는 루프를 실패로 읽는다 |
| `pass` | §5.5.8 의 승급을 거친 뒤 `complete` 를 append 한다. 같은 `verification` 을 복제해 실어, 감사자가 그 한 줄만 보고도 판정을 재구성할 수 있게 한다 |
| `fail-cap` | 상한 소진. `complete` 를 append 하지 않는다 |
| `fail-residual` | 상한에 닿지 **않았는데도** 미해소 finding 을 남긴 채 루프를 끝낸 경우 — §5.5.5 의 cross-wave HALT, 사용자 중단, 코드로 닫을 수 없는 SRS 수준 잔여가 여기 해당한다. `complete` 를 append 하지 않는다. **단 통과한 라운드가 이월·재진입으로 넘긴 항목은 여기 해당하지 않는다** — 그쪽은 `pass` + `residual` 이다 |

`fail-*` 로 끝난 wave 는 미완료로 남고 §0.6 재개가 그 wave 로 되돌아온다.
비종료 라운드는 `verdict="in-progress"` 로 쓰고, 종료 verdict(`pass` / `fail-cap` / `fail-residual`)는 루프를 실제로 끝낸 **마지막** 줄에만 쓴다. append-only 파일에서 "마지막 줄"은 그 wave 의 wave-verify 이벤트 중 최신 1줄로 결정되며, waves-event §3 의 게이트도 그 최신 줄의 verdict 를 본다.

`base_sha` 는 **wave 진입** 시점의 HEAD — 그 wave 의 입력 커밋, 곧 dispatch base — 를 캡처해 그 wave 의 이벤트에 싣는다 — 재개 세션에는 분해 대화가 없으므로, 캡처 시점을 규정하지 않으면 보존 검사의 창이 통째로 사라진다.

`head_sha` 는 **wave-verify** 라운드 진입 시점의 HEAD 를 캡처하고, 두 값을 그 이벤트의 `diff_window` 에 싣는다.

워커·재진입·개선 서브에이전트를 **dispatch 할 때마다** 그 run 을 그 wave 의 `sds_id` 를 실은 줄로 **append** 한다 — 재진입이 만든 run 이 빠지면 증거 창이 수정 전에서 멈춘다.

### 5.5.8 통과한 wave 의 승급 (Phase 3.6)

§5.5 가 `pass` 로 끝난 wave 는 호스트가 **wave 하나씩** `parallel-waves.md` PW-14 ~ PW-17 을 돈다 — 테스트 충분성 확인(`../_shared/kiwi/test-sufficiency.md`, 범위는 그 노드의 요구 집합이고, SDS 파일이 있는 wave 면 그 wave 의 SDS 파일마다 `--sds <그 파일>` 을 준다 — 조각으로 나뉘었으면 조각마다다, `parallel-waves.md §3`) → (`--sds` 만) `kiwi-sds --close` 로 해석 결정을 SRS 로 옮김 → 승급(집합·전이·증거는 그 계약의 PW-16) → (`--sds` 만) 같은 `kiwi-sds --close` 로 SDS 삭제. 두 `kiwi-sds --close` 는 그 wave 의 sds-id 마다 — 기본 id 와 재진입 id `{run_id}-wave-{n}-r{m}` 각각 — 부른다(PW-15 · PW-17). 재진입 SDS 파일도 그 wave 의 SDS 파일이므로 테스트 충분성 확인도 그 파일마다 돈다. 공백이 남으면 `test-sufficiency-gap` 으로 멈추고 그 wave 의 요구를 `verified` 로 쓰지 않는다. 그 뒤 §6 의 `complete` 를 append 한다.

---


## 5.55 Phase 4.4 — run 창 종료 리뷰 (FR-FLOW-134)

**마지막 wave 의 `complete` 뒤, §5.6 최종 검증 앞에** run 전체의 커밋 창을 1회 리뷰한다. 이 순서여야 hop 의 보고가 최종 검증의 증거 안에 든다.

```
Skill({ skill: "kiwi-review-fix-loop", args: "--base {run_diff_window.base_sha} --head {run_diff_window.head_sha} --no-pipeline-emit --regression-baseline {§2.1 이 pin 한 값} [--auto] [--max] [--mini|--loops N] [--skip-clean-code | --keep-clean-code]" })
```

**각 워커가 자기 창을 도는 리뷰가 이것을 대신하지 않는다.** wave 별 리뷰의 분모는 그 wave 의 `diff_window` 하나이고, 여기의 분모는 run 전체다 — §5.6 이 자기 존재 이유로 드는 논거("wave 별 검증은 각 wave 의 scope 안만 보므로 어느 wave 의 scope 에도 속하지 않은 항목은 끝까지 검증되지 않는다")가 리뷰에도 그대로 성립한다. run 창은 모든 wave 창의 **상위집합**이므로 두 분모는 당연히 겹친다 — 중복이 아닌 이유는 서로소여서가 아니라 **심판 단위**가 다르기 때문이다: wave 별 리뷰는 각 wave 안만 보므로 wave 를 **가로지르는** 상호작용, 즉 §5.6 이 최종 패스 분모에 더하는 통합 항목(wave 경계를 가로지르는 항목)이 걸리는 자리는 어느 wave 리뷰의 시야에도 들어오지 않는다. 개별 커밋이 두 번 읽히는 비용은 치르고, 그 대신 아무도 보지 않던 교차면을 얻는다.

`--close-reqs` 는 **주지 않는다** — run 스코프에서 그것을 주면 run 의 모든 요구 status 를 한 호출로 뒤집는 bulk-finalize 가 된다. 요구 종결은 wave 별로 이미 끝났다.

리뷰가 고친 것은 §5.6 앞에서 **커밋한다** — 커밋하지 않으면 §5.6 의 보존 검사가 읽는 창(커밋된 run 창) 밖에 남아 그 편집이 보이지 않는다.

커밋한 **뒤** run 의 모든 노드 요구 집합을 범위로 테스트 충분성 확인을 한 번 돈다(`../_shared/kiwi/test-sufficiency.md`) — 공백이 남으면 `test-sufficiency-gap` 으로 멈추고, 최종 보고에 테스트 충분성 확인 결과를 적는다.

반환이 `NEEDS_USER` · `FAILED` 이면 §0.G 의 `child-review-fix-loop-needs-user-or-failed` 로 중단한다.

기록은 §6 의 run 종료 줄에 `terminal_review {skill, base, head, verdict}` 로 남긴다(FR-NODE-188). 창이 비면 `not-applicable-empty-window`, 커밋 착지 뒤 중단이면 `skipped-run-halted` 이고 그 run 은 완료로 보고하지 않는다.

---

## 5.6 Phase 4.5 — 전체 wave 최종 검증 (FR-FLOW-049)

**마지막 wave** 의 `complete` 이벤트가 기록된 **뒤**, 오케스트레이션 완료를 보고하기 전에 최종 검증 패스를 1회 돌린다. 이 패스는 마지막 wave 의 **재검사가 아니다** — wave 별 검증은 각 wave 의 scope 안만 보므로, 어느 wave 의 scope 에도 속하지 않은 항목은 마지막까지 한 번도 검증되지 않는다.

최종 검증은 마지막 노드 뒤에 같은 기계 검사와 같은 검증자 모델을 run 의 모든 AC 와 모든 통합 항목의 합집합에 돈다 — 설계 기준선 분모는 없다. 범위는 **모든 노드** 의 `acs` 와 `prd_items` 합집합에, wave 경계를 가로지르는 **통합 항목** — 서로 다른 노드의 요구 사이 `Requirement` / `depends_on` 링크와 그래프 간선 — 을 더한 것이며, **검증자가 스스로 산정하지 않는다**.

여기에 그래프 `scope.requirements` 가 뺀 요구 **전량**(§3 의 범위 좁힘)을 별도 계층으로 함께 싣고, 검증자가 "이 run 에서 구현되지 않음이 의도됨"을 항목마다 확인한다 — 배제는 run 전체에서 한 번도 검증되지 않는 유일한 경로이므로 최종 패스가 그 유일한 재검사 지점이다.

루프 자체는 §5.5 를 그대로 재사용한다(엔진 SSOT: `../_shared/kiwi/verify-loop.md`): 기계 검사가 먼저이고, 라운드마다 검증자를 새로 띄우며(`--max` 면 둘), red 테스트만 kept finding 으로 남고, 통과 라운드는 **그 라운드에서 수정이 적용되지 않았을 것**을 요구한다. 라운드 상한과 `--mini` / `--loops N` 도 §5.5.4 를 따르고, finding 의 수정 라우팅은 §5.5.5 를, wave 로 귀속되는 finding 의 이월은 §5.5.7 을 그대로 쓴다 — 재사용 목록에서 이 둘이 빠지면 최종 패스의 finding 은 전부 HALT 로만 끝난다.

기록은 하나의 wave 가 아니라 run 전체에 붙는다 — `wave="all"` · `order=0` · `phase="final-verify"` 를 실은 이벤트를 `waves.jsonl` 에 append 하고, 자체 `verification` 객체와 함께 `run_diff_window` 및 §5.55 가 남긴 `terminal_review` 를 **반드시** 싣는다 — 이 둘이 빠진 종료 줄은 검증기가 거부한다. wave 별 최신 상태를 계산할 때 이 이벤트는 제외한다 — 포함하면 존재하지 않는 wave 하나가 영원히 미완료로 읽힌다.

§5.5.4 의 "wave head 회귀"는 최종 패스에서 **run head** 회귀로 읽는다.

같은 방식으로 §5.5.2 의 **보존** 검사도 최종 패스에서는 **run 창** — `run_diff_window` 의 `base_sha` ~ run head — 으로 돈다. 최종 이벤트는 `wave="all"` 이라 wave 단위 `diff_window` 가 원리적으로 없기 때문이다.

**마지막 wave** 의 창을 대신 고르지 않는다 — 그러면 run 전체의 파손 판정이 마지막 wave 의 재검사가 된다.

최종 패스도 보존 검사가 승인되지 않은 행을 하나도 남기지 않을 것을 통과 조건으로 요구한다.

run-scope finding — 어느 wave 의 scope 에도 속하지 않아 wave 로 귀속할 수 없는 것 — 은 HALT 가 아니라 §0.5 **예외**에 따라 wave-N+1 을 추가해 처리한다. 추가한 wave 는 §5~§5.5 를 정상 실행하고, 그 wave 가 `complete` 로 기록된 뒤 **§5.55 와 §5.6 을 순서대로 재실행**한다 — 추가된 wave 의 커밋은 run 스코프 리뷰가 새로 닿을 수 있는 유일한 커밋이고, §5.55 를 건너뛰면 `run_diff_window.head_sha` 만 전진해 종료 줄의 `terminal_review` 창이 낡는다.

wave 추가는 run 당 **3** 회를 상한으로 한다 — 상한에 닿으면 §0.G `wave-append-cap-exhausted` 로 중단하고 잔여를 전량 보고한다. 상한이 없으면 최종 패스가 wave 를 추가하고 그 wave 가 다시 최종 패스를 부르는 루프에 종료 보장이 없다.

최종 패스를 재실행할 때 **라운드 카운터**는 재실행을 가로질러 **누적**된다 — waves-event §4 의 재개 누적과 같은 규칙이며, 재실행마다 1 부터 다시 세면 cap 자체가 도달 불가능해진다.

이 재진입은 별도 장치가 아니다 — `waves-event.md` §4 의 재개 술어가 최종 검증이 통과하지 않은 run 을 이미 최종 검증으로 되돌린다.

최종 검증이 통과하지 못하면 그 이벤트의 `status` 는 `failed` 다 — `complete` 는 통과한 최종 검증에만 쓴다.

최종 검증이 pass 로 기록되기 전에는 오케스트레이션을 완료로 보고하지 않는다. kept finding 이 남은 종료와 cap 소진(`fail-cap`)은 `--auto` 라도 중단이며(§0.G `final-verify-kept-finding`), 그 잔여 finding 을 **전량** 보고한다.

최종 패스가 통과하지 않은 run 은 완료가 아니다 — 재개는 첫 미완료 wave 가 아니라 최종 검증으로 들어간다.

---

## 6. Phase 4 — 진행 추적 waves.jsonl (AC-3)

전체 진행 상태는 `./kiwi/waves.jsonl` 에 append-only 로 기록한다(schema: `../_shared/kiwi/waves-event.md`). 각 wave 는 자기 워커가 병합·재생되고 §5.5 를 통과하고 §5.5.8 의 승급이 **성공적으로 끝난**(only after it finishes successfully) 뒤에만 `./kiwi/waves.jsonl` 에 **완료로 표시(mark complete)** 한다 — 실행 중이거나 실패한 wave 는 완료로 기록하지 않는다.

진행 상황과 재개 상태는 `speckiwi orchestrate wave status --json` 으로 읽고, `kiwi/waves.jsonl` 과 그래프 파일을 손으로 읽지 않는다. wave 의 재개 base — `parallel-waves.md §6` 재개 커서가 쓰는 `<base_sha>` — 는 같은 출력의 노드 행 `base_sha`(그 노드의 최신 dispatch 줄의 `isolation.base_sha`)다. §5.5.1 의 `diff_window.base_sha` 는 이 값이 아니다 — 재진입 뒤에는 둘이 다르다(§5.5.1). 세션이 초기화되어 **다시 시작**(resume)해도, 그 출력으로 **첫 번째 미완료(first incomplete) wave** 부터 **재개**한다. 이미 완료로 표시된 앞 wave 들은 건너뛰고, 첫 미완료 wave 가 든 stage 의 준비 집합을 다시 계산해 이어서 진행한다. 이 덕분에 장시간 멀티-웨이브 작업이 중단되어도 안전하게 이어갈 수 있다.

`complete` 이벤트와 `phase=wave-verify` 이벤트에는 SDS 유무와 관계없이 그 wave 의 단위 id 를 `sds_id` 로 반드시 기록한다 — 그 wave 의 워커 세션과 증거 창(있으면 SDS)을 여는 키다. 스킬별 **분석 산출물**은 각 스킬 자신의 분석 디렉터리에서 해석한다(§5.5.1). `complete` 기록은 §5.5 웨이브 종료 검증을 통과한 뒤에만 append 하며, 통과 기록이 없는 `complete` 는 무효다.

wave 안의 **재개 단위**는 **2단계**다 — 워커 실행(`--sds` 면 SDS 작성 포함) / wave 검증. 완료된 단계는 다시 돌지 않는다. SRS 저작은 wave 의 단계가 아니다 — run 앞에서 한 번 끝났고, 커밋된 그래프가 그 증거다(`wave-srs-registration.md §1`).

**워커 단계 재개**는 `parallel-waves.md §6` 을 따른다 — wave 상태는 `speckiwi orchestrate wave status` 로 읽고, SRS 저작도 SDS 작성도 다시 돌리지 않으며, 기록된 단위 id(`sds_id`)로 그 wave 의 워커(와 있으면 SDS)를 찾아 이어간다. §5.5.5 재진입은 `--req-filter` 와 kiwi-pm `--run-id {run_id}-wave-{n}-r{m}` 을 **반드시 함께** 쓰고, `--sds-id` 는 이미 `--sds` 로 opt-in 한 run 에서만 더한다 — 범위 없이 재진입하면 stability mutation 이 재적용되고 끝난 작업이 중복 실행된다.

그 값은 `sds_id` 필드로 `waves.jsonl` 에 기록한다 — 재개 세션에는 대화가 없으므로 저널에서 해소하지 못하면 위 두 인자를 만들 수 없다.

§3 을 건너뛰는 재개에서는 활성 target 을 `set_active_target` 으로 제품 target 에 **명시 고정**한 뒤 다음 단계에 진입한다 — 그 경로에는 `$kiwi-srs` 호출이 없어 target 을 세우던 부수효과가 사라진다.

재개 스캔은 **현재 run 의 `run_id` 와 일치하는 이벤트만**을 읽는다 — `waves.jsonl` 은 저장소당 1개 append-only 파일이고 `wave-{n}` 은 run 간 고유하지 않다.

**재개 대상 run** 은 `complete` 로 끝나지 않은 **가장 최근 미완료** run 이며, `--run-id` 로 명시하면 그것이 우선한다.

**다른 run** 의 `complete` 는 이 run 의 완료로 읽지 않는다 — 앞선 에픽을 완주한 저장소에서 새 에픽의 `wave-1` 이 앞 에픽의 완료를 자기 것으로 읽으면 구현 0 건으로 전체 완료를 보고한다.

---

## 7. --auto / --max 전파 (AC-5)

### 7.1 --auto — 전 wave 자율 완주

`--auto` 활성 시 **모든 wave**(every wave)를 사용자 개입 없이 **끝까지(to the end)** 자율적으로(autonomously) 실행한다. wave 사이의 게이트를 자동 결정하여 wave-1 부터 wave-N 까지 완주한다.

단, `--auto` 라도 각 wave 에서 부르는 자식의 **안전 게이트(safety gate)** 는 **여전히 적용**된다 — `$kiwi-srs` · `$kiwi-sds` · 워커의 `$kiwi-pm` 이 `NEEDS_USER` / `FAILED` 를 반환하거나 critical 게이트에 도달하면 `--auto` 여도 자동 진행을 멈추고 사용자 결정을 받는다(§0.4). 즉 `--auto` 는 정상 흐름만 자율화하고, per-wave 안전 게이트는 그대로 유효하다.

웨이브 종료 검증(§5.5)이 kept finding 을 남긴 종료 · `fail-cap` 도 마찬가지로 `--auto` 라도 자동 진행을 중단한다(§0.G). 전체 wave 최종 검증(§5.6)의 같은 조건도 동일하게 중단한다.

**`--auto` 단독**으로는 워커 kiwi-coder 의 `--auto-integration`(통합 테스트 동의)·`--auto-cost-warning`(비용 경고) 두 게이트를 통과하지 못한다 — 두 게이트는 해당 옵션이 **명시**될 때만 우회되며(kiwi-coder §0.18), 그 옵션이 워커까지 닿는 경로는 §7.4 pass-through 표가 정한다. 그 전까지 `--auto` 는 첫 코딩 wave 에서 멈춘다(§0.G).

자식 스킬로의 `--auto` 자동 전파는 `../_shared/kiwi/auto-option.md` 의 공유 옵션 계약을 따른다 — 스킬마다 전파 규칙을 다시 쓰면 계약이 갈라진다.

### 7.2 --max — 하위 스킬 전파

`--max` 활성 시 **모든 wave** 에서 `parallel-waves.md` 가 부르는 **하위 스킬(sub-skill)** — `kiwi-srs-feasibility` · (`--sds` 면) `kiwi-sds` · 워커의 `kiwi-pm` 과 `kiwi-review-fix-loop` — 에 `--max` 를 그대로 **전파(propagate)** 한다. 각 호출의 `[--max]` 는 그 계약이 그 호출을 적는 자리에 있다. 하위 스킬의 `--max` 의미는 각자의 SSOT 를 따른다.

`--max` 는 **본 스킬이 직접 부르는** `kiwi-srs` 의 두 호출(§3 의 처음 저작과 §4 의 증분 저작)과 `kiwi-srs-feasibility` 에도 전파한다 — `wave-srs-registration.md` 와 `wave-decomposition.md` 의 호출 형태가 `[--max]` 를 싣는다.

`--max` 는 개선 위임(§5.5.5 — 엔진 `verify-loop.md` §7, §5.5 와 §5.6 이 함께 쓴다)이 **본 스킬이 직접 호출하는** 세 호출에도 전파한다 — `kiwi-review-fix-loop` 위임, 제품 target 의 `kiwi-srs` 증분 재진입, `--req-filter` 를 준 `kiwi-srs-feasibility` 재실행. 셋 다 계약의 wave 단계가 아니라 본 스킬이 spawn 하므로 위 첫 문단의 목록으로 덮이지 않는다. 같은 위임의 wave 재진입은 첫 문단이 덮고, §5.55 의 run 창 hop 은 호출 형태에 `[--max]` 를 이미 싣는다.

`--auto` 와 `--max` 는 함께 쓸 수 있으며(`--auto --max`), 이 경우 모든 wave 를 고강도로 자율 완주하되 per-wave 안전 게이트는 유지한다.

### 7.3 `--mini` / `--loops N` — 하위 스킬 전파

`--mini` 또는 `--loops N` 활성 시 (`../_shared/kiwi/loop-option.md` v1.0 SSOT), `kiwi-srs` · `kiwi-srs-feasibility` 호출과 `parallel-waves.md` 가 wave 마다 부르는 호출에 해당 플래그를 그대로 **전파(propagate)** 한다. 하위 스킬의 라운드 상한 시맨틱은 각자의 `loop-option.md` 참조를 따른다.

본 전파는 §5.5 **웨이브 종료 검증** 루프의 라운드 상한에도 동일하게 적용된다 — 결선하지 않으면 `--mini` 가 하위 스킬만 줄이고 본 루프는 기본 상한 5 로 남는다.

### 7.4 pass-through 옵션 (자식 게이트 도달)

아래 옵션은 본 스킬이 소비하지 않고 워커 체인으로 그대로 흘려보낸다 — 중간이 하나라도 떨어뜨리면 무인 실행이 마지막 홉에서 멈춘다. 워커 입력 카드(`parallel-waves.md` PW-5)와 워커의 `kiwi-pm` 호출(PW-6)이 이 옵션들을 싣는다. `--auto-cost-warning` · `--auto-integration` · `--force` 세 옵션은 사용자가 **명시**한 입력일 때만 흐른다. `--regression-baseline` 은 §2.1 이 pin 한 값이므로 예외이고, `--drive` 는 본 스킬이 소비하면서 **동시에** 흘려보낸다는 점에서 예외다 (§7.5).

자식이 `pm.lock` 으로 막혀 실패해도 본 스킬은 `--force` 를 **자동으로 부여하지 않는다** — 다른 PM 인스턴스가 살아 있는 경우와 구분되지 않으므로 §0.G `serial-unit-failed` 로 중단하고 사용자 결정을 받는다.

| 옵션 | 도달 대상 | 전파 경로 |
|---|---|---|
| `--drive` | 무인 완주 모드 전체 — 워커 게이트 3종을 함께 연다 | kiwi-wave-master → 워커의 kiwi-pm → kiwi-coder |
| `--auto-cost-warning` | kiwi-coder 비용 확인 게이트 | kiwi-wave-master → 워커의 kiwi-pm → kiwi-coder |
| `--auto-integration` | kiwi-coder 통합 테스트 동의 게이트 | kiwi-wave-master → 워커의 kiwi-pm → kiwi-coder |
| `--force` | kiwi-pm 의 stale `pm.lock` 해제 | kiwi-wave-master → 워커의 kiwi-pm (**명시** 입력만) |
| `--regression-baseline` | kiwi-coder / kiwi-review-fix-loop 의 회귀 델타 판정 | kiwi-wave-master → 워커의 kiwi-pm → kiwi-coder (§2.1 이 pin 한 값) |

---

### 7.5 `--drive` — 무인 완주와 경계 있는 자가 복구 (FR-FLOW-119)

`--drive` 는 `--auto` · `--auto-integration` · `--auto-cost-warning` 셋을 함께 켠다 — 세 플래그를 따로 적을 필요가 없다. 그 위에 **자가 복구 권한**을 더한다: 진행을 막는 결함을 사용자 승인 없이 고치고 재시도한다.

자가 복구는 아래 네 조건을 **모두** 만족할 때만 승인된다. 하나라도 어긋나면 고치지 않고 **중단**한다 — 넷은 선언이 아니라 연언이다.

1. **되돌릴 수 있을 것 (reversible)** — git 이 추적하는 변경이고 되돌리기가 가능하다.
2. **run root 안일 것** — §2.1 이 pin 한 실행 루트 바깥은 손대지 않는다.
3. **기존 공개 계약과 기존 테스트를 바꾸지 않을 것** — 기존 시그니처·기존 테스트·기존 단언은 그대로 둔다.
4. **진단이 독립적으로 재현됐을 것 (independent)** — 원인이 본 실행과 무관한 별도 검사로 재현되어야 한다. 추정으로 고치지 않는다.

#### 7.5.1 `--drive` 가 열지 않는 게이트 (닫힌 목록)

아래 게이트는 `--drive` 로도 열리지 않는다. 위원회가 어떤 confidence 를 보고하든 마찬가지다.

| 게이트 | 열면 무슨 일이 생기나 |
|---|---|
| `external-module-impact` | 실행 루트 바깥을 바꾼다 — 되돌릴 책임이 이 run 밖에 있다 |
| `existing-test-weakened-or-deleted` | 테스트를 약화시켜 green 을 만드는 길이 열린다 |
| `existing-public-contract-change` | 기존 소비자를 조용히 깨뜨린다 |
| `existing-file-deleted-or-moved` | 삭제는 자가 복구가 아니다 |
| `mock-detection` | 구현 대신 mock 으로 통과한다 |
| `tdd-bypass-attempt` | 테스트 선행을 건너뛴다 |
| `out-of-scope-user-consent` | 요구가 run 범위와 모든 분모에서 빠진다 — 범위가 조용히 줄어든다 |
| `unsafe-option-refused` | 회귀와 리뷰가 꺼진 채 wave 가 누적된다 |
| `wave-append-cap-exhausted` | 무인 실행의 종료를 보장하는 유일한 경계가 사라진다 |
| `prd-record-tampered` | 바뀐 사용자 원문 기록을 다시 해시해 맞추면 사용자가 하지 않은 요청으로 저작이 이어진다 |
| `prd-unapproved-user-decision` | 사용자가 승인하지 않은 PRD 로 저작한다 — 범위를 사용자 대신 정한다 |
| `prd-residual-user-decision` | residual 요구를 남기거나 지운다 — 범위가 사용자의 말 없이 늘거나 준다 |
| `prd-cap-unpassed-user-decision` | 라운드 상한까지 통과하지 못한 SRS 를 완료로 넘긴다 — 사용자 요청을 받아들이지 못한 채 다음 wave 가 쌓인다 |

네 PRD 정지는 `/kiwi-srs`·`/kiwi-tdd` 가 `child-srs-needs-user-or-failed` 나 자식 정지로 올려도 이 목록에 든다. 자가 복구는 그 정지가 지키는 PRD 기록·승인 여부·residual·아직 fail 인 PRD 항목을 남기거나 지우거나 다시 쓰지 않는다.

이 목록을 여는 것은 목표를 향해 가는 것이 아니라 **목표를 낮추는 것**이다. 테스트를 약화시키거나 설계 항목을 배제하면 실행은 끝까지 가고 게이트는 통과하지만 실제로 한 일은 줄어든다. 무인 실행에서 가장 위험한 실패는 실패가 아니라 성공처럼 보이는 축소이며, 그것은 아무도 보지 않는 시간에 일어난다.

#### 7.5.2 잔여 검증 게이트도 닫힌 채로 둔다

`wave-verify-kept-finding` · `final-verify-kept-finding` · `wave-verify-fail-residual` 은 `--drive` 에서도 중단이다. 이 셋에 닿았다는 것은 자동 수정 루프가 **이미 실패했다**는 뜻이고, 그 상태로 다음 wave 를 쌓으면 결함이 남은 wave 수에 비례해 커진다.

#### 7.5.3 결정과 중단은 저널에서 읽을 수 있어야 한다

`--drive` 로 중단할 때는 그 게이트의 id 를 `waves.jsonl` 의 `abort_gate` 필드에 **지명**한다. 단 `abort_gate` 의 값 공간은 오케스트레이터 게이트 어휘(`GateId`)이므로, 자식 스킬이 소유한 게이트 — `existing-test-weakened-or-deleted` · `existing-public-contract-change` · `existing-file-deleted-or-moved` · `mock-detection` · `tdd-bypass-attempt` — 는 자기 이름으로 적지 않고 `serial-unit-failed` 로 버블업해 적는다 — 그 게이트들은 워커의 kiwi-coder 가 소유하고, 워커 실패는 그 게이트로 온다. §7.5.1 의 네 PRD 정지 — `prd-record-tampered` · `prd-unapproved-user-decision` · `prd-residual-user-decision` · `prd-cap-unpassed-user-decision` — 도 `GateId` 가 아니므로 `abort_gate: child-srs-needs-user-or-failed` 로 적는다(`orchestrate run abort --reason child-srs-needs-user-or-failed`). `--reason` 은 `abort_gate` 값 그 자체라 원래 정지 이름을 담지 못한다. 원래 정지 이름은 §9 의 종료 emit 이 `pipeline.jsonl` 에 남기는 `FAILED` 이벤트의 `notes` 에 적는다. 자식 게이트 이름을 그대로 쓰면 `abort-gate-outside-vocabulary` 오류가 난다.

자동으로 해소한 게이트는 그 게이트를 지명하는 `decision` 객체를 1건 기록한다 (`{ question, options, decision, rule, committee_size, confidence, origin }`).

산문으로만 "critical 게이트에서 중단했다"고 적으면 다음 세션이 어떤 게이트였는지 알 수 없다. 무인으로 밤새 돌린 뒤 아침에 읽을 수 없는 기록은 없는 기록과 같다.

### 7.6 클린 코드 건너뛰기 — 리뷰 hop 전달 (FR-FLOW-206)

사용자 요청이나 호출 인자가 빠른 처리를 요구하거나 클린 코드 원칙을 지키지 않아도 된다고 하면(`kiwi-review-fix-loop` 클린 코드 라운드 블록의 신호) Phase 0 에서 클린 코드 검사를 건너뛸지 한 번만 묻는다 — `--auto` 면 묻지 않고 건너뛴다. 그 답은 이 run 이 `waves.jsonl` 에 쓰는 첫 줄에 `decision` 객체(`question` 은 `clean-code-skip`, `decision` 은 `skip` 또는 `keep`, `origin` 은 `user` 또는 `auto`)로 기록하고, 재개는 다시 묻지 않고 그 기록을 따른다 — 그 줄보다 앞서 도는 리뷰 hop 은 없다. `skip` 이면 `--skip-clean-code` 를, `keep` 이면 `--keep-clean-code` 를 이 run 이 부르는 모든 리뷰 hop — 워커의 자기 창 리뷰(dispatch 카드, `parallel-waves.md` PW-6), 호스트 hop(PW-12), 개선 위임(§5.5.5), run 창 종료 리뷰(§5.55) — 의 args 에 더한다.

---

## 8. 에픽 이슈 진입 모드 (FR-FLOW-214)

에픽 이슈 번호가 진입 인자이면 에픽을 `gh issue view {N} --json title,body,comments` 로 읽고, `kiwi-prd` 를 불러 에픽의 제목과 본문을 `U-1` 로 기록한다. 에픽의 하위 이슈는 PRD 항목의 힌트로만 넘긴다 — 하위 이슈를 세는 방법은 `kiwi-orchestrator` 의 라우팅 신호 S8 을 따른다. 그 뒤는 문서 입력과 같다: `wave-decomposition.md §2` 의 순서로 그 PRD 의 요구 집합을 분해한다. 에픽의 본문 구조 · 태스크 리스트 · 하위 이슈에서 wave 를 뽑지 않는다 — 그렇게 뽑은 wave 는 분할 검사가 지키는 요구 집합을 우회한다.

---

## 9. Pipeline emit (의무)

`../_shared/kiwi/pipeline-event.md` v1.0.0 를 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 1줄 append(멱등: run_id 기준). wave 별 진행은 별도로 `./kiwi/waves.jsonl`(§6, waves-event.md) 에 기록한다. 워커는 pipeline 이벤트를 쓰지 않는다. emit 실패는 best-effort — 본 작업 실패로 이어지지 않는다.

**로드맵 항목 (FR-FLOW-226)**: `ROADMAP_ITEM=RM-<n>` 을 받은 run 은 emit 직전에 `sync_roadmap_actuals` 를 `apply` true, `item` 을 그 항목으로 한 번 부른다 — 남은 실제 날짜는 도구가 계산한 상태로만 채운다. 다른 항목에는 부르지 않는다.

**Preflight halt 시 저널 처리 (FR-FLOW-043)**: §2.1 게이트가 중단한 run 은 wave 를 시작하지 않았으므로 저널 root 를 pin 하지 않고 `waves.jsonl` 에 아무것도 기록하지 않는다. 다만 종료 시 1회 emit 의무는 그대로 유지된다 — `pipeline.jsonl` 에 `status=FAILED`, `next_hint=null` 인 이벤트를 정확히 1줄 append 한다.

이때 저널 경로는 `pipeline-event.md` §1 의 해석 순서(git root `git rev-parse --show-toplevel` → cwd 의 `kiwi/` → 홈 폴백)를 **run 자신의 cwd 기준으로 1회 평가**해서 정한다. 폴백 체인과 `.pipeline-path` 마커 파일 규칙을 그대로 상속하므로 git 조회가 실패한 환경에서도 기록 경로가 정의된다. MCP 가 보고한 root 는 이 해석에 쓰지 않는다.

**재개**된 실행은 `{run_id}#r{n}` 를 emit 키로 쓴다(`pipeline-event.md` §5.4) — 멱등 skip 은 **같은 키**에만 적용된다. 중단 시 `FAILED` 를 남긴 run 이 재개로 완주하면, bare `run_id` 로는 최종 `TASK_DONE` 이 영구히 기록되지 않아 `kiwi-pipeline` 의 직전-이벤트 게이트가 계속 발동한다.

## 11 워크트리 절차 — 만들고, 그 안에서 일하고, 되돌려준다

**적용 대상: 이 run 이 `../_shared/kiwi/parallel-waves.md` 아래 격리 워커에 dispatch 하는 각 wave.** `--serial` 이어도 같다 — 동시성만 1 이다. 워크트리는 wave 스코프이고 호스트가 만든다.

사유와 경계와 해서는 안 되는 것은 `../_shared/kiwi/worktree-lane.md` 가 소유한다. 여기에 다시 적지 않는다. 수확과 재생 사이의 join · 판정 · 병합은 `parallel-waves.md` PW-7 ~ PW-9 가 소유한다. 아래는 순서뿐이다.

1. **만든다** — 레인 브랜치 준비는 `worktree-lane.md` §2 를 따른다. 그 절의 조상 판정이 붙일지 `<base_sha>` 에서 다시 만들지 정하고, 다시 만들 때는 base 를 같은 명령의 인자로 준다(호스트가 만들면 `git worktree add -B`, 런타임이 건넨 워크트리면 `switch -C` — 둘 다 `<base_sha>` 가 마지막 인자다). base 를 따로 체크아웃하지 않는다. `<base_sha>` 는 그 wave 의 입력 커밋 sha 다.

2. **배치를 승인받는다** — 가정하지 않고 게이트에 묻는다.

   ```
   speckiwi orchestrate preflight --json --mcp-root <path> --git-root <path> --role <id> --lane-id <id> --lane-plan <path>
   ```

   `--mcp-root` 는 MCP `mcp_workspace_info` 의 `workspaceRoot`, `--git-root` 는 레인 워크트리, `--lane-id` 는 `lane-{waveId}`, `--lane-plan` 은 `docs/analysis/kiwi-wave-master-{run_id}/waves/stage-{s}/lanes.lock.json` 이다 — lock 은 dispatch base 뒤에 커밋되어 워크트리에 없으므로 호스트 run root 를 앞에 붙인 **전체 경로(absolute path)**로 준다. `--role` 은 `host` 또는 `lane` 이고, 레인 배치를 승인받을 때는 **`--role lane`** 이다. exit 0 이 아니면 그 배치에서 아무것도 하지 않는다 — 거부 사유가 무엇을 고쳐야 하는지 말한다.

   같은 판정을 MCP 에서도 받는다 — `orchestrate_preflight` 바인딩이 `role`·`laneId`·`lanePlan` 을 그대로 노출한다. 이 인자들이 없으면 MCP 호출은 언제나 기본 `role=host` 로 판정되고, 호스트 루트와 레인 루트가 다르면 등가 검사가 `roots-differ` 로 거부하므로 워크트리 세션이 실제로 쓰는 표면에서 게이트에 닿을 수 없다. `orchestrate_preflight` 는 `workspaceRoot` 를 받지 않는다 — 판정 대상인 두 root 를 이미 필수 인자로 받기 때문이다.

   그 밖의 `orchestrate_*` 도구와 `workflow_*` 계열 전부는 선택적 인자 `workspaceRoot` (absolute path) 를 받는다. 호스트에 고정된 MCP 서버로도 레인 워크트리의 세션 상태·파이프라인·워크로그를 그 root 기준으로 다룰 수 있다는 뜻이다. `orchestrate_replay_apply` 는 거부한다 — 유예된 SRS mutation 은 호스트 root 에서만 재생되며, 그것이 유예가 존재하는 이유다. 어느 체크아웃의 SRS 를 읽되 아무것도 쓰지 않는 조회 계열도 같은 인자를 받아 그 체크아웃의 SRS 로 답하므로, 레인의 요구 상태를 호스트 세션에서 그대로 물을 수 있다. 그 계열은 지명된 체크아웃에 `docs/spec/00.index.md` 가 없으면 거부하며, 거부는 수리 명령이 아니라 검사한 체크아웃을 이름으로 밝힌다. `docs/spec` 아래에 쓰거나 Requirement ID 를 발급하는 도구는 전부 거부하고, 자기가 어느 root 에 결속되었는지 답하는 도구도 거부한다 — 그 답을 인자로 받으면 P.1 대조의 두 변이 한 출처에서 나온다. 수용된 root 라도 `docs/spec` 아래로 떨어지는 경로 인자는 거부된다. 다만 호출자가 넘기는 경로 인자를 아예 받지 않는다고 선언한 도구는 예외이고, SRS 조회가 `docs/spec` 참조로 필터링할 수 있는 것이 그 선언 덕분이다. 계열마다 어느 도구가 인자를 받는지는 README 의 per-call `workspaceRoot` 표가 이름으로 싣는다. **`workspaceRoot` 를 빠뜨린 SRS 쓰기는 거부되지 않고 호스트 root 에 조용히 떨어진다** — `worker-touched-srs` 비교가 그 경로를 잡는다.

   **target 범위의 조회·mutation 전에 응답의 `mcpWorkspace.workspaceRoot` 와 `mcpWorkspace.rootSource` 로 워크스페이스 정체를 확인한다** — `rootSource` 가 `per-call-workspace-root` 인 호출만 넘긴 root 에서 답한 것이고, `server-cwd-discovery` 면 기동 root 가 답한 것이다. 기동 때 `docs/spec/00.index.md` 를 찾지 못한 서버는 미결속 상태로 남아 모든 호출을 `MCP_WORKSPACE_UNBOUND`(SRS-E077) 로 거절하고 아무것도 쓰지 않는다.

   `MCP_WORKSPACE_UNBOUND` 을 받으면 멈추고, 사용자에게 프로젝트 안에서 세션을 다시 시작하라고 알린다 — 그 프로젝트에 SRS 가 없으면 먼저 그곳에서 `speckiwi init` 을 실행한 뒤 다시 시작한다. 다른 도구로 재시도하지 않는다.

3. **부트스트랩** — 레인에서 1회.

   ```
   npm ci --include=dev --ignore-scripts
   ```

4. **코드 작업** — 레인 안에서, 워커가 `parallel-waves.md` PW-6 의 체인으로. SRS mutation 은 `--defer-srs-mutation <queue>` 로 큐에만 적는다.

5. **수확(harvest)** — 큐와 매니페스트, 그리고 워크트리에만 있는 세션 worklog · `pm-state.json` · `docs/analysis/kiwi-pm-…` 번들 · 리뷰 분석 디렉터리를 호스트 run 디렉터리 `docs/analysis/kiwi-wave-master-{run_id}/waves/stage-{s}/{laneId}/` 로 가져온다(`parallel-waves.md` PW-7). 그 뒤 join · 판정 · 병합은 `parallel-waves.md` PW-7 ~ PW-9 를 따른다.

6. **재생** — 호스트 root 에서.

   ```
   speckiwi orchestrate replay apply --json --plan <path> --applied <path> --frozen-target <id>
   ```

   `--applied` 는 `kiwi/orchestrator/{run_id}/replay-applied.jsonl`, `--frozen-target` 은 제품 target 이다.

7. **반납(release)** — **수확이 끝난 뒤에만.** 워크트리를 먼저 제거하면 그 안의 ignored 산출물이 함께 증발한다.
