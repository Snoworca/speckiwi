---
name: kiwi-wave-master
description: "여러 wave 로 나뉘는 대형 작업(에픽·멀티-스텝 로드맵·장기 연구 결과)을 순서 있는 wave 로 분해하고, wave 마다 전용 target 을 $kiwi-srs 로 등록한 뒤 wave 별 $kiwi-pipeline 을 순차 실행하는 멀티-웨이브 오케스트레이터 v0.1. ./kiwi/waves.jsonl 로 진행을 추적하여 재개 가능(첫 미완료 wave 부터). 트리거 — kiwi wave master, 웨이브 오케스트레이션, 멀티 웨이브, 대형 작업 분해, wave 별 파이프라인, 에픽 실행, 여러 단계로 나눠서 진행. 옵션 — --auto (모든 wave 를 끝까지 자율 완주, 안전 게이트 유지), --max (모든 wave 의 하위 스킬로 전파), --drive (무인 완주 + 경계 있는 자가 복구, §7.5)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-wave-master v0.1

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

하나의 크고 긴 작업(에픽·로드맵·대형 연구 산출물)을 **여러 개의 wave 로 나누어 순차적으로 완주**시키는 멀티-웨이브 오케스트레이터. 각 wave 는 독립된 SRS target + 자체 `$kiwi-pipeline` 사이클로 처리되며, 전체 진행은 `./kiwi/waves.jsonl` 에 영속되어 세션이 초기화돼도 재개할 수 있다.

이 스킬은 *직접 요구사항을 저작하거나 코드를 구현하지 않는다* — wave 경계를 정하고, 각 wave 의 target 을 `$kiwi-srs` 로 등록하고, wave 별 `$kiwi-pipeline` 을 순서대로 spawn 하는 상위 오케스트레이터다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **이벤트 SSOT**: `../_shared/kiwi/waves-event.md` v1.4.0 가 `./kiwi/waves.jsonl` 의 schema·파일위치·mark-complete 규칙 SSOT. 본 문서는 wave 분해·오케스트레이션 로직만 담당. |
| §0.2 | **/snoworca-\* 호출 절대 금지**. kiwi-* 시리즈만 `Skill` 도구로 호출한다. |
| §0.3 | **CLAUDE.md §6 시그니처 금지** + **§7 변경 이력 금지**. 본 스킬 본문에 변경 이력 섹션 없음 — git history 가 SSOT. |
| §0.4 | **--auto 안전 게이트**: 어떤 wave 의 `$kiwi-srs` 또는 `$kiwi-pipeline` 이 `NEEDS_USER` / `FAILED` 를 반환하거나 critical 게이트에 도달하면, `--auto` 라도 자동 진행을 중단하고 사용자 결정을 받는다. |
| §0.5 | **wave 경계 불변 원칙**: 일단 `waves.jsonl` 에 확정된 wave 순서·범위는 실행 도중 임의로 재분할하지 않는다. 재분해가 필요하면 처음부터 다시 분해한다. **예외** — 발견된 설계 **커버리지 갭**을 닫기 위해 새 wave 를 **추가**하는 것은 본 원칙의 명시적 예외이며 **재분해가 아니다**. 이때 **이미 등록된 wave 의 순서는 바뀌지 않는다** — 순서가 바뀌면 앞 wave 가 뒤 wave 의 토대라는 전제 자체가 깨진다. |
| §0.6 | **멱등 재개**: 이미 완료로 표시된 wave 는 재실행하지 않고 건너뛴다. 진행은 항상 첫 미완료 wave 부터 이어간다. |
| §0.7 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §0.8 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. 본 스킬의 `critical_gates[]` 선언은 §0.G 참조 |
| §0.9 | **wave 분해 SSOT**. 본 스킬은 `../_shared/kiwi/wave-decomposition.md` v1.0.0 을 따른다 — 두 갈래 split 휴리스틱, 설계 기준선 물질화, 분해 커버리지 게이트. `artifact_root` 인자로 `docs/analysis/kiwi-wave-master-{run_id}/` 를 전달한다(§3) |
| §0.10 | **상호검증 엔진 SSOT**. 본 스킬은 `../_shared/kiwi/verify-loop.md` v1.0.0 을 따른다 — 증거 번들 규칙, 두 stance, 라운드 구조(§5.5.3), 종료 조건(§5.5.4), 진동 감지, 개선 위임(§5.5.5), 교차 wave 이월(§5.5.7). 본 스킬 고유의 **분모 표**는 §5.5.2 |
| §0.11 | **wave target 등록 계약 SSOT**. 본 스킬은 `../_shared/kiwi/wave-srs-registration.md` v1.0.0 을 따른다 — `--research-doc` / `--constraints-doc` / `existing_modules` 저작 입력과 `srs_authored` 멱등 표식 |
| §7 참고 | `--mini`/`--loops N` 를 per-wave kiwi-srs + kiwi-pipeline 에 전파 (loop-option.md §6) |

---

## 0.G `critical_gates[]` (auto-option.md §5 인터페이스)

아래 게이트는 `--auto` 라도 자동 진행을 중단하고 사용자 결정을 받는다 — 결정 서브에이전트로 우회할 수 없다.

`run-root-preflight-mismatch` · `wt-delegation-refused` · `unsafe-option-refused` 는 §2.1 이 명령하는 중단을 SSOT 인터페이스로 **전사**한 것이다. 본 표의 **모든** 게이트를 함께 선언하는 이유는, 일부만 선언하면 **선언되지 않은** 나머지 중단이 위원회 판단 대상으로 떨어지기 때문이다.

| gate_id | reason | 발생 위치 |
|---|---|---|
| `run-root-preflight-mismatch` | MCP workspace root ↔ run git root 불일치 또는 조회 실패 | §2.1 |
| `wt-delegation-refused` | `--wt` 위임 요청 — per-wave worktree 생성이 wave 누적을 깨뜨린다 | §2.1 |
| `child-pipeline-needs-user-or-failed` | 하위 $kiwi-pipeline 이 `NEEDS_USER` / `FAILED` 반환 | §0.4 |
| `wave-verify-residual-critical` | 웨이브 종료 상호검증 종료 시 잔여 CRITICAL/HIGH, 검증자 1 의 `GAPS`, 또는 cap 소진(`fail-cap`). `fail-residual` 은 이 행이 아니라 **별도 행** `wave-verify-fail-residual` 이다 | §5.5 |
| `wave-verify-cross-wave-fix-required` | 이전 wave 의 **요구사항**을 바꿔야 하고, carry-forward 경로가 양쪽 다 불가능함 — `complete` 는 취소 불가 (§0.5 / §5.5.7) | §5.5 |
| `wave-decomposition-coverage-gap` | 입력의 최상위 섹션이 어느 wave 에도 배정되지 않았고 out-of-scope 사유도 기록되지 않음 — target 등록 진입 불가 | §3.2 |
| `final-verify-residual-critical` | 전체 wave 최종 검증 종료 시 잔여 CRITICAL/HIGH, 검증자 1 의 `GAPS`, cap 소진(`fail-cap`), 또는 `fail-residual` — `--auto` 라도 중단 | §5.6 |
| `unsafe-option-refused` | `--skip-regression` / `--reviewer-off` 요청 — 회귀와 리뷰를 끄면 wave 누적 위에서 결함 피해가 복리로 커진다 | §2.1 |
| `child-srs-needs-user-or-failed` | 직접 호출한 `$kiwi-srs` 가 `NEEDS_USER` / `FAILED` 를 반환하거나 자체 critical 게이트에 도달 — 사이클은 kiwi-srs 를 spawn 하지 않으므로 pipeline 게이트가 덮지 못한다 | §4 / §5.5.5 |
| `decomposition-input-missing` | 분해할 대상 문서·설계 문서·에픽 이슈가 모두 부재 — 입력을 위원회가 창작할 수 없다 | §1.1 |
| `integration-test-user-consent` | 자식 kiwi-coder 통합 테스트 동의 게이트 — `--auto-integration` 이나 `--drive` 가 **명시**되지 않으면 `--auto` 라도 여기서 멈춘다 | §7.1 / §7.4 / §7.5 |
| `cost-warning-large-task` | 자식 kiwi-coder 비용 경고(실행 시간 ≥10분) — `--auto-cost-warning` 이나 `--drive` 가 **명시**되지 않으면 `--auto` 라도 여기서 멈춘다 | §7.1 / §7.4 / §7.5 |
| `wave-verify-fail-residual` | 웨이브 종료 상호검증이 상한 전에 미해소 finding 을 남기고 끝남(`verdict="fail-residual"`) — 그 wave 는 `complete` 를 append 할 수 없어 위원회에는 저널 규칙을 만족하는 선택지가 없다 | §5.5 |
| `out-of-scope-user-consent` | 설계 항목을 `out_of_scope` 로 배제 — 배제된 항목은 모든 계층의 분모에서 빠지므로 `--auto` 라도 사용자 확인을 받는다 | §3.2 |
| `wave-append-cap-exhausted` | run 당 wave 추가 상한 **3** 소진 — 무인 실행의 종료를 보장하는 유일한 경계 | §5.6 |
| `invalid-loop-option` | `--loops N` 이 정수 ≥1 이 아님 — `loop-option.md` §1 이 명령하는 HALT 를 게이트로 전사 | §0.7 / loop-option.md |

`wave-verify-residual-critical` 은 `--auto` 라도 wave 오케스트레이션 **전체를 중단**시킨다. wave 는 뒤 wave 의 토대이고 앞선 `complete` 기록은 되돌릴 수 없으므로, 결함을 안고 진행하면 피해 범위가 남은 wave 수에 비례해 커진다.

> **`--auto` 활성 조건**: `auto-option.md` §5 상 `critical_gates[]` 미선언은 `--auto` **비활성**을 뜻한다. 본 표의 선언으로 이 스킬의 `--auto` 는 **활성**이며, 위 게이트들이 그 활성 상태의 HALT 지점이다.

---

## 1. 입력 / 출력

### 1.1 필수 입력

- 대형 작업을 기술하는 **연구 문서 / 계획 문서 / 로드맵**(경로 또는 프롬프트 참조), 또는
- 그 작업의 **아키텍처 설계 문서 / SDS**(경로 또는 프롬프트 참조), 또는
- **에픽 이슈**(GitHub epic issue 번호 — §8 진입 모드).

어느 것도 없으면 사용자에게 분해할 대상 문서를 **묻는다**(§0.G `decomposition-input-missing`) — 입력 문서는 위원회가 추론으로 만들어내는 대상이 아니다. 설계 문서는 §3.1 설계 기준선의 원본이 된다 — 그것이 없으면 §5.5 검증의 설계 계층 분모가 아예 존재하지 않는다.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "자동", "auto", "끝까지 알아서", "묻지 말고" | `--auto` (모든 wave 자율 완주, SSOT: auto-option.md v1.0) | off |
| "max 모드", "고강도", "최대로" | `--max` (모든 wave 의 하위 스킬로 전파) | off |
| "N 번째 wave 부터", "이어서" | `--resume` (첫 미완료 wave 부터 재개) | 자동 감지 |
| "에픽 이슈", "이슈 #123 를 wave 로" | 에픽 이슈 번호 (§8 진입 모드) | (없음) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` (per-wave kiwi-srs/kiwi-pipeline 로 전파 §7.3) | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` (per-wave kiwi-srs/kiwi-pipeline 로 전파 §7.3) | off (스킬 기본 상한) |
| "이 run 이어서", "run id 지정" | `--run-id <id>` (재개할 run 명시 §6) | 자동 감지(가장 최근 미완료 run) |
| "통합 테스트 자동 동의" | `--auto-integration` (자식 kiwi-coder 게이트까지 pass-through §7.4) | off |
| "비용 경고 자동 skip" | `--auto-cost-warning` (자식 kiwi-coder 게이트까지 pass-through §7.4) | off |
| "무인 완주", "스스로 판단해서 진행", "drive" | `--drive` (무인 완주 + 경계 있는 자가 복구 §7.5) | off |
| "제약", "이건 지켜줘", "금지 사항" | `--constraint <text>` (반복 가능; 선언 제약을 §3.1 아티팩트에 수집) | (없음) |
| "락 강제 해제", "force" | `--force` (kiwi-pm stale `pm.lock` 해제까지 pass-through §7.4, **명시** 입력만) | off |

### 1.3 출력

- **대화 메시지**: wave 분해 결과(순서·범위), 현재 진행 상황, 다음 wave.
- **`./kiwi/waves.jsonl`**(의무): wave 별 상태 append-only 로그 (waves-event.md schema).
- 각 wave 의 `$kiwi-srs`·`$kiwi-pipeline` 산출물은 각 스킬이 자체 기록.

---

## 2. Phase 흐름

```
Preflight : Run-root preflight 게이트 (§2.1) — MCP workspace root ↔ run git root 일치 검사
Phase 0 : 입력 문서 해석 + waves.jsonl 경로 해석 (재개 감지)
Phase 1 : Wave 분해 (§3) — 순서 있는 wave 목록 확정 + 설계 기준선 물질화(§3.1) · 분해 커버리지 게이트(§3.2)
Phase 2 : Wave 별 target 등록 (§4) — $kiwi-srs 로 wave-{n} target 저작
Phase 3 : Wave 별 kiwi-pipeline 실행 (§5) — 등록 순서대로 순차 진행
Phase 3.5 : 웨이브 종료 상호검증 (§5.5) — 검증자 2 기 교차반박 루프 — 엔진 SSOT verify-loop.md, 통과해야 complete
Phase 4 : waves.jsonl 갱신 (§6) — 성공한 wave 만 완료 표시
Phase 4.5 : 전체 wave 최종 검증 (§5.6) — 설계 기준선 전체 대비 최종 패스, 통과해야 오케스트레이션 완료
Phase 5 : 자기 이벤트 emit (§9)
```

Phase 2~Phase 3.5 는 **wave 마다 반복**된다 — 모든 wave 의 target 을 앞에서 **일괄 등록하지 않는다**. §4 가 wave 진입 시점의 `carried_into` 를 수집하고 §6 이 3단계 재개 단위를 쓰는 것이 일괄 등록과 양립하지 않기 때문이다.

재개 시 Phase 0 에서 `waves.jsonl` 을 읽어 첫 미완료 wave 로 곧바로 점프한다.

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

이 preflight 검사는 **wave 분해·target 등록·SRS mutation·자식 pipeline spawn, 그리고 `waves.jsonl` 경로 해석 및 재개(resume) 읽기보다 먼저** 수행한다 — 불일치한 root 에서 저널을 먼저 읽어 root 를 pin 하는 순서를 막기 위해서다.

불일치이거나 조회에 실패하면 **즉시 critical 중단**한다. `--auto` 로도 이 중단을 우회할 수 없다. `mcp_workspace_info` 에서 `workspaceRoot` 를 얻지 못한 경우도 불일치와 동일하게 취급하며, `speckiwi` CLI 는 이 비교의 폴백이 아니다 — CLI 는 root 를 호출자의 cwd 에서 해석하므로 폴백으로 쓰면 검사 자체가 무의미해진다.

중단 시점에는 SRS mutation 0 건이어야 하고 자식 스킬을 하나도 spawn 하지 않은 상태여야 한다.

중단 출력에는 다음 네 가지를 모두 담는다.

- 복구 경로 1 — 워크트리를 쓰지 말고 단일 root 에서 `git switch` 로 브랜치를 전환해 사이클을 돌린다.
- 복구 경로 2 — 의도한 워크트리를 작업 디렉터리로 하는 새 agent 세션을 시작한다. 세션 도중의 워크트리 이동은 해법이 아니다 — 이미 떠 있는 MCP 서버는 재기동되지 않는다.
- 경고 1 — 분기된 워크트리를 root 로 하는 세션에서는 **신규 Requirement ID 를 할당하지 않는다**.
- 경고 2 — 워크트리를 root 로 하는 세션은 호스트 저장소의 `docs/spec/` 을 편집할 수 없다. 그 경로가 세션 작업 디렉터리 바깥이기 때문이다.

에픽 이슈 진입 모드도 동일한 게이트의 적용을 받는다.

**`--wt` 위임 금지**: 본 스킬은 워크트리 격리를 `kiwi-pipeline --wt` 로 위임하지 않는다. `--wt` 요청이 들어오면 명시적으로 거부한다 — per-wave worktree 생성은 앞 wave 가 뒤 wave 의 토대가 되는 wave 누적을 깨뜨리기 때문이다 — 그리고 위의 두 복구 경로(단일 root `git switch` / 의도한 워크트리를 root 로 하는 새 agent 세션)를 대신 제시한다.

**work-mode 판독**: 같은 preflight 에서 `get_work_mode`(MCP 우선, CLI `speckiwi mode` 폴백)로 지속된 work-mode 를 읽는다. wave 사이클은 **body-scope**(본문 스코프) 작업이므로, `tdd` 모드의 step-scoped 라우팅(`kiwi-tdd` 위임)은 wave 사이클에 **적용되지 않는다** — wave 는 body SRS target 을 단위로 돌고 step 디렉터리를 쓰지 않기 때문이다.

**위험 옵션 거부**: `--skip-regression` / `--reviewer-off` 요청은 `--wt` 와 동일하게 **거부한다** — 회귀 검증과 리뷰를 끄면 wave 가 뒤 wave 의 토대라는 전제 위에서 결함이 복리로 누적된다(§0.G `unsafe-option-refused`).

**회귀 기준선 캡처**: preflight 에서 전체 회귀 스위트를 **1회** 실행해 실패 목록을 `baseline_failing_tests` 로 캡처하고, 그 값을 이 **run 전체에 pin** 한다 — wave 마다 다시 재면 앞 wave 가 만든 실패가 다음 wave 의 기준선으로 승격된다. 캡처는 kiwi-coder `state.regression_baseline` 과 같은 스위트·같은 명령을 쓰며, 두 값은 하나의 SSOT 를 공유한다. 캡처 자체가 실패하면 `baseline_failing_tests` 를 부재로 두고 그 사실을 보고한다.

---

## 3. Phase 1 — Wave 분해 (AC-1)

wave 분해(두 갈래 split 휴리스틱) · 설계 기준선(design baseline) 물질화 · 분해 커버리지 게이트는 `../_shared/kiwi/wave-decomposition.md` v1.0.0(§0.9) 를 그대로 따른다 — 본 스킬은 **사본을 만들지 않는다**.

본 스킬이 그 모듈에 전달하는 `artifact_root` 인자는 `docs/analysis/kiwi-wave-master-{run_id}/` 다 — 모듈이 이 경로를 하드코딩하지 않으므로 여기서 넘긴다. 그 모듈 본문의 `§0.G` · `§0.5` · `§4` · `§5.5` · `§5.6` 는 본 스킬의 같은 번호 절을 가리킨다.

분해 결과의 순서가 이후 §4 target 등록·§5 pipeline 실행 순서를 결정한다.

## 4. Phase 2 — Wave 별 target 등록 (AC-2)

각 wave 마다 `$kiwi-srs` 를 호출하여 전용 `wave-{n}` **target(타깃)** 을 등록하되, 그 wave 의 **작업 범위(work scope)** 를 명시적으로 지정한다. 즉 wave-1 → target `wave-1`, wave-2 → target `wave-2` … 로 각 wave 가 독립된 SRS target 을 갖는다.

이때 지정한 **범위(scope)** 는 **해당 wave 로 한정(bounded)** 되어야 한다 — 뒤따르는 feasibility·planning·review 단계가 그 wave 의 범위를 **넘어서지(beyond)** 않고 국한(제한)되도록 한다. 한 wave 의 사이클은 오직 그 wave 의 scope 안에서만 요구사항을 다루고, 다른 wave 의 작업은 넘어 보지 않는다.

`$kiwi-srs` 는 이 문서 절(§3 에서 확정된 wave 경계)의 내용을 입력으로 받아 해당 wave-{n} target 의 SRS 를 저작한다.

미등록 wave target 을 생성 옵션과 함께 등록하는 것은 이 단계의 **정상 경로**이며 예외가 아니다 — wave target 은 본 스킬이 방금 만든 이름이라 Target Map 에 없는 것이 기본 상태다.

---

이 호출의 **저작 입력 계약**(발췌 문서 · 제약 아티팩트 · `existing_modules` · 이월 residual 전량 수집 · 멱등 표식)은 `../_shared/kiwi/wave-srs-registration.md` v1.0.0(§0.11) 을 그대로 따른다. 본 스킬은 **사본을 만들지 않는다**.

## 5. Phase 3 — Wave 별 kiwi-pipeline 실행 (AC-4)

각 wave 에 대해 **등록 순서대로(in order)** `$kiwi-pipeline` 을 호출한다 — wave 별(per-wave) 파이프라인 실행. 앞 wave 의 pipeline 이 완주(`TASK_DONE`)한 뒤에야 다음 wave 의 pipeline 을 시작한다.

정확히는 `TASK_DONE` 만으로는 부족하다 — 앞 wave 가 §5.5 **웨이브 종료 상호검증**까지 통과해 `complete` 로 기록된 뒤에야 다음 wave 의 pipeline 을 시작한다. wave 는 뒤 wave 의 토대이므로, 검증 중인 wave 위에 다음 wave 를 쌓으면 §0.G 의 halt 게이트가 무의미해진다.

이때 wave 별 `$kiwi-pipeline` 은 SRS **재저작을 생략하고(skip-authoring)** 진입한다 — §4 의 앞단계 `$kiwi-srs` 가 이미 그 wave 의 SRS 를 저작해 두었으므로, pipeline 을 `--cycle --from=feasibility --run` 으로 호출하여 **feasibility/planning** 단계부터 구현까지 실행한다(재저작 없이). 즉 wave-master 는 각 wave 의 `$kiwi-srs` 를 앞에서 이미 끝냈기 때문에, wave 별 pipeline 은 저작을 다시 하지 않고 타당성/계획 단계로 곧장 들어간다.

이 진입점(skip-authoring / resume-from-stage, `--from=`)은 `kiwi-pipeline`(FR-FLOW-026 / T-PH003-04)이 제공하며, 본 스킬(FR-FLOW-029)이 wave 별 사이클에서 이를 소비한다(R-005 크로스-스킬 통합). provider(kiwi-pipeline) 와 consumer(kiwi-wave-master) 양쪽 모두 이 skip-authoring 진입을 명시한다.

target 을 wave-{n} 으로 지정하여 호출하면 pipeline 은 그 wave 의 활성 target 범위 안에서만 동작한다.

target 은 `--target` 인자로 `wave-{n}` 을 **명시 전달**한다 — 활성 target 이 `$kiwi-srs` 의 `set_active_target` **부수효과**로만 정해지면, §4 를 건너뛰는 재개(§6)에서 그 호출 지점이 사라져 pipeline 이 이전 wave 의 target 위에서 돈다.

그 wave 로 `carried_into` 된 residual 은 pipeline 재진입 범위에도 포함한다 — 저작만으로는 코드 수준 이월이 어느 Task 에도 배정되지 않는다.

---

## 5.5 Phase 3.5 — 웨이브 종료 상호검증 (FR-FLOW-044 / FR-FLOW-045)

wave 의 $kiwi-pipeline 이 `TASK_DONE` 을 반환한 뒤, **§6 의 `waves.jsonl` `complete` 기록 이전에** 본 루프를 돌린다. 통과하지 못한 wave 는 `complete` 로 기록하지 않는다.

`complete` 를 먼저 쓰고 사후 감사하는 배치는 쓸 수 없다 — `complete` 는 append-only 이고 전이도에 `complete → failed` 간선이 없으며 §0.6 재개가 완료 wave 를 영구히 건너뛰므로, 실패가 어떤 후속 동작도 바꾸지 못하는 장식이 된다.

**범위 밖**: hunk 단위 코드 리뷰는 본 계층의 범위 밖이며 `kiwi-review-fix-loop` 가 이미 소유한다 — 여기서 재수행하지 않는다. 본 계층이 값을 하는 조건은 diff 가 아니라 **wave 단위 증거**를 보는 것이다.

루프 **엔진**은 `../_shared/kiwi/verify-loop.md` v1.0.0(§0.10) 를 그대로 따른다 — 증거 번들 규칙, 두 stance, 라운드 구조(§5.5.3), 종료 조건(§5.5.4), 진동 감지, 개선 위임(§5.5.5), 교차 wave 이월(§5.5.7) 이 전부 거기에 있고 본 스킬은 **사본을 만들지 않는다**. 본 절은 그 엔진에 **공급하는 것** — 증거 번들의 행(§5.5.1), 네 계층의 고정 분모(§5.5.2), 저널 기록(§5.5.6) — 만 규정한다.

### 5.5.1 증거 번들 (양 검증자 공통)

아래 표가 본 스킬이 verify-loop.md §2 에 공급하는 증거 행이며, 번들 자체의 규칙(2기 동일 번들 · 분할 금지)은 그 절이 SSOT 다.

| 증거 | 내용 |
|---|---|
| `kiwi/pipeline.jsonl` (해당 wave 창) | 사이클 각 단계의 status / summary / next_hint |
| `kiwi/waves.jsonl` (해당 wave) | order · target · scope · `in_progress` 타임스탬프 |
| `.kiwi/sessions/{plan_run_id}/worklog.jsonl` | Task 별 TDD 단계, skip / override 기록 |
| `docs/plans/{plan_run_id}.plan.md` + `.sidecar.json` | 그 wave 가 *하기로 한* 것 |
| `{review_fix_loop_analysis_dir}/report.md` | finding · severity · 라운드 · 회귀 결과 |
| speckiwi `list_requirements` / `summarize_target` (wave target) | 외부에서 고정된 AC **분모** |
| wave 창의 git diff | 최종 결과물 |
| 그 wave 의 **설계 기준선** 범위 | `design_baseline` 이 가리키는 `source_file` · `heading_path` · `line_start`~`line_end` 구간 |
| 선언된 **사용자 제약** | `constraints_path` 아티팩트 — 대화 상태가 아니라 `waves.jsonl` 에서 해소한다 |
| 그 wave head 의 전체 **회귀 스위트** 실행 | `command` · `exit_code` · `failing_tests` · `baseline_failing_tests` (wave head 에서 실행, 기준선은 §2.1 이 run 시작에 pin 한 값) |
| 그 wave 의 **diff 창** | `diff_window` 의 `base_sha` ~ `head_sha` — 대화 상태가 아니라 `waves.jsonl` 에서 해소한다 |
| 그 wave 의 **기존 모듈** 목록 | `design_baseline` 의 `existing_modules` — 교차 wave 회귀 판정의 입력 |
| 그 wave 의 **모든 pipeline run** | `pipeline_run_ids` **전량** — 재진입이 만든 run 도 창 안에 든다 |

설계 기준선과 사용자 제약 두 행은 **필수**이며 생략할 수 없다 — 번들에 없는 증거는 어느 stance 에서도 보이지 않으므로, 검증이 코드가 스스로 선언한 범위 안에서만 돌게 된다. 회귀 스위트 행도 같다: 그 실행 결과가 §5.5.4 Normal 통과 조건의 일부다.

증거 창은 `pipeline_run_ids` 의 **모든** run 과 `in_progress` 타임스탬프로 경계 짓는다 — 단일 `pipeline_run_id` 로 창을 열면 재진입 이후의 수정이 창 밖에 남아, **수정 전 증거**로 재검증하거나 **낡은** clean 증거로 통과한다. `pipeline.jsonl` 은 모든 wave 가 공유하는 append-only 파일이므로, 창을 고정하지 않으면 다른 wave 의 이벤트를 이 wave 의 것으로 읽는다.

`.kiwi/sessions/` 와 `docs/plans/` 는 **plan run-id** 로 키잉된다 — kiwi-planner 가 SSOT 이고 kiwi-pm 이 그 값을 그대로 재사용하므로 `pipeline_run_id` 와 **다른 값**이다. plan run-id 는 위 `pipeline.jsonl` 창의 kiwi-planner · kiwi-pm 이벤트에서 `artifacts.plan_file` · `artifacts.analysis_dir` 를 읽어 해석한다.

`docs/analysis/` 는 다르다 — 스킬마다 **자체 run-id** 로 자기 디렉터리를 쓴다. review-fix-loop 보고서는 plan run-id 가 아니라 같은 창 안의 `kiwi-review-fix-loop` 이벤트가 실어 보낸 **자신의** `artifacts.analysis_dir` 에서 해석한다. 위 표의 `{review_fix_loop_analysis_dir}` 가 바로 그 값이며, 그 스킬 이벤트의 `artifacts.analysis_dir` 로 치환한다. `*` 글롭으로 대신하면 창을 고정한 의미가 사라진다(다른 wave 의 보고서까지 걸린다). 그 wave 의 창에 `kiwi-review-fix-loop` 이벤트가 아예 없으면 글롭으로 대체하지 말고 **그 사실 자체를 검증자 2 의 finding 으로 올린다** — 사이클이 리뷰 단계를 돌지 않았다는 뜻이므로, 번들 항목을 조용히 빼는 것은 허용되지 않는다. `pipeline_run_id` 는 창 경계를 정하는 데에만 쓴다.

### 5.5.2 두 검증자 (stance 분리)

verify-loop.md §3 이 요구하는 **외부 고정 분모**를 본 스킬은 아래 네 계층 — REQ/AC · 설계 · 제약 · 보존 — 으로 공급한다. 어느 계층도 검증자가 스스로 산정하지 않는다.

검증자 1 의 **분모**는 speckiwi `list_requirements` 가 반환한 그 wave target 의 REQ/AC 집합이며, **검증자가 스스로 정하지 않는다**. **모든** REQ/AC 를 행으로 열거하고 `checked == expected` 를 대조한다. 표본·발췌·상위 N 은 분모가 아니다. `list_requirements` 는 기본이 compact projection 이라 AC 를 싣지 않으므로, AC 를 포함하는 투영을 명시적으로 요청하거나 REQ 별로 `get_requirement` 를 호출해 **AC 단위** 분모를 만든다 — REQ 개수만 세면 이 계층이 존재하는 이유인 AC 단위 정독이 사라진다. 실현으로 표시한 행에는 **해소 가능한** 증거 포인터(존재하는 `file:line` 또는 존재하는 test id)를 붙인다. 개수 불일치 또는 미해소 포인터가 있으면 그 라운드는 **무효**이며, cap 은 소비하되 연속 clean 스트릭은 0 으로 되돌린다.

검증자 1 은 REQ/AC 계층 위에 **설계 계층**을 하나 더 든다 — 그 wave 의 설계 기준선 범위 안 **모든** 설계 항목을 행으로 열거하고, 행마다 대응하는 REQ id 를 적거나 `unmapped` 로 표시한다.

미매핑 설계 항목이 **1건이라도** 있으면 그 라운드는 `ALL_MATCH` 로 롤업할 수 없다 — REQ·AC 계층이 완결하더라도 마찬가지다. 설계가 요구사항으로 번역되지 않은 것이 이 계층이 잡으려는 결함이므로, REQ 분모의 완결로 그것을 대신하면 계층을 하나 더 든 의미가 사라진다.

`design_layer.expected` 는 그 wave 의 `design_items` 길이이며 **검증자가 스스로 산정하지 않는다** — 라운드마다 분모가 갈리면 무효 판정 자체가 성립하지 않는다.

검증자 1 은 선언된 사용자 제약을 세 번째 계층으로 든다 — `constraint_layer` 에 `expected` · `checked` · `violations` 를 싣고, 위반이 `violations` 에 **1건이라도** 있으면 `axis_a.roll_up` 을 `ALL_MATCH` 로 기록하지 않는다. 제약 위반은 요구 실현 여부와 별개의 실패이므로 REQ·AC·설계 계층이 모두 완결해도 롤업을 열어주지 않는다.

`constraint_layer.expected` 는 최신 `constraints_path` 아티팩트의 항목 수이며 **검증자가 스스로 산정하지 않는다** — 네 계층 중 이것만 외부 고정이 없으면 분모를 스스로 0 으로 만드는 경로가 남는다.

검증자 2 의 **분모**는 그 wave 의 diff 에서 **기계적으로 도출한다** — 검증자가 고르지 않는다. **네 부류**가 그 분모다: 삭제·이동된 기존 파일, 삭제·변경된 기존 public 심볼, 삭제·수정된 기존 테스트 파일, 그리고 기존 테스트의 **단언 약화**(판정 기준은 `kiwi-coder §0.20.3` 의 closed list 를 그대로 따른다).

이 판정은 실행 계층과 **같은 규칙**이다 — `kiwi-coder §0.20.4` 가 같은 두 값 enum 과 같은 근거 요건을 쓴다. 두 계층이 서로 다른 규칙을 쓰면 계획으로 승인된 리팩터가 검증에서는 통과하고 실행에서는 HALT 한다.

검증자 2 는 `existing_modules` 를 **교차 wave** 회귀 위험 판정의 입력으로 쓴다 — 기록만 되고 읽히지 않는 필드는 어떤 verdict 도 바꾸지 못한다.

분모는 라운드 진입 시 freeze 하고 그 개수를 `frozen_denominator` 의 `round` · `req_ac` · `design_items` · `preservation` · `constraints` 에 기록한다.


### 5.5.6 기록 (waves-event 1.4.0)

**라운드마다** — 루프가 끝난 뒤 한 번이 아니라 — 그리고 언제나 `complete` 를 쓰기 **전에** `waves.jsonl` 에 `status=in_progress` · `phase="wave-verify"` 인 이벤트를 1줄 append 하고, 거기에 그 시점까지의 `verification` 객체(`rounds` · `cap` · `verdict` · `axis_a` · `axis_b` · `residual` · `report_path`)를 싣는다. 루프 종료 후 한 번만 쓰면 루프 도중 죽었을 때 `rounds` 가 하나도 남지 않아 재개가 0 부터 다시 세고, waves-event §4 가 약속한 카운터 누적이 거짓이 된다 — 불안정한 wave 가 `fail-cap` HALT 에 영영 닿지 못한다.

`verification` 에는 §5.5.2 의 분모 결과와 회귀 실행도 함께 싣는다 — `design_layer`(`expected` · `mapped` · `unmapped`) · `preservation_layer`(`expected` · `checked` · `rows`) · `constraint_layer`(`expected` · `checked` · `violations`) · `frozen_denominator` · `regression`(`command` · `exit_code` · `failing_tests` · `baseline_failing_tests`). 이것들이 없으면 설계 계층·제약 계층·보존 계층·회귀 판정은 라운드가 끝난 뒤 재구성할 수 없다.

마지막 라운드의 그 줄이 waves-event §3 이 요구하는 **선행 통과 기록**이며, 이것이 없으면 뒤따르는 `complete` 는 무효다.

wave 시작 시의 첫 `in_progress` 에는 `phase="srs-authoring"` 을 싣는다 — §4 저작이 §5 pipeline 보다 앞서므로 `pipeline` 라벨은 실제 단계와 어긋나고, `phase` 가 부재하는 줄을 소비자가 추측으로 해석하게 둘 수도 없다.

pipeline 사이클 진입 시 `phase="pipeline"` 인 `in_progress` 를 1줄 append 한다 — 그래야 그 enum 멤버가 실제 이벤트로 생산된다.

| verdict | 후속 |
|---|---|
| `in-progress` | 루프가 아직 도는 중인 **비종료** 라운드. 종료 verdict 를 앞당겨 쓰지 않는다 — `pass` 를 미리 쓰면 waves-event §3 게이트가 그 시점에 무너지고, `fail-residual` 을 쓰면 재개가 도는 루프를 실패로 읽는다 |
| `pass` | 이어서 `complete` 를 append 한다. 같은 `verification` 을 복제해 실어, 감사자가 그 한 줄만 보고도 판정을 재구성할 수 있게 한다 |
| `fail-cap` | 상한 소진. `complete` 를 append 하지 않는다 |
| `fail-residual` | 상한에 닿지 **않았는데도** 미해소 finding 을 남긴 채 루프를 끝낸 경우 — §5.5.5 의 cross-wave HALT, 사용자 중단, 코드로 닫을 수 없는 SRS 수준 잔여가 여기 해당한다. `complete` 를 append 하지 않는다. **단 Normal 게이트를 만족해 조기 종료한 경우의 MEDIUM/LOW 잔여는 여기 해당하지 않는다** — 그쪽은 `pass` + `residual` 이다 |

`fail-*` 로 끝난 wave 는 미완료로 남고 §0.6 재개가 그 wave 로 되돌아온다.
비종료 라운드는 `verdict="in-progress"` 로 쓰고, 종료 verdict(`pass` / `fail-cap` / `fail-residual`)는 루프를 실제로 끝낸 **마지막** 줄에만 쓴다. append-only 파일에서 "마지막 줄"은 그 wave 의 wave-verify 이벤트 중 최신 1줄로 결정되며, waves-event §3 의 게이트도 그 최신 줄의 verdict 를 본다.

`base_sha` 는 **wave 진입** 시점의 HEAD 를 캡처해 그 wave 의 이벤트에 싣는다 — 재개 세션에는 분해 대화가 없으므로, 캡처 시점을 규정하지 않으면 보존 계층의 분모가 통째로 사라진다.

`head_sha` 는 **wave-verify** 라운드 진입 시점의 HEAD 를 캡처하고, 두 값을 그 이벤트의 `diff_window` 에 싣는다.

pipeline 을 **spawn 할 때마다** 그 run_id 를 `pipeline_run_ids` 에 **append** 한다 — 재진입이 만든 run 이 빠지면 증거 창이 수정 전에서 멈춘다.

---


## 5.6 Phase 4.5 — 전체 wave 최종 검증 (FR-FLOW-049)

**마지막 wave** 의 `complete` 이벤트가 기록된 **뒤**, 오케스트레이션 완료를 보고하기 전에 최종 검증 패스를 1회 돌린다. 이 패스는 마지막 wave 의 **재검사가 아니다** — wave 별 검증은 각 wave 의 scope 안만 보므로, 어느 wave 의 scope 에도 속하지 않은 항목은 마지막까지 한 번도 검증되지 않는다.

최종 패스의 **분모**는 설계 기준선 **전체** — **모든 wave** 의 `design_items` 합집합 — 에 §3.1 이 고정한 `integration_items`(wave 경계를 가로지르는 통합 항목) 를 더한 것이며, **검증자가 스스로 산정하지 않는다**. 이것을 모든 wave 요구사항의 합집합에 대조한다.

여기에 `out_of_scope` **전량**을 별도 계층으로 함께 싣고, 검증자 2 기가 "이 run 에서 구현되지 않음이 의도됨"을 항목마다 확인한다 — 배제는 run 전체에서 한 번도 검증되지 않는 유일한 경로이므로 최종 패스가 그 유일한 재검사 지점이다.

루프 자체는 §5.5 를 그대로 재사용한다(엔진 SSOT: `../_shared/kiwi/verify-loop.md`): **정확히 2기**의 검증자를 stance 로 분리하고, 교차반박은 `add-only` 이며, clean 라운드는 **그 라운드에서 수정이 적용되지 않았을 것**을 요구한다. 라운드 상한과 `--mini` / `--loops N` 도 §5.5.4 를 따르고, finding 의 수정 라우팅은 §5.5.5 를, wave 로 귀속되는 finding 의 이월은 §5.5.7 을 그대로 쓴다 — 재사용 목록에서 이 둘이 빠지면 최종 패스의 finding 은 전부 HALT 로만 끝난다.

기록은 하나의 wave 가 아니라 run 전체에 붙는다 — `wave="all"` · `order=0` · `phase="final-verify"` 를 실은 이벤트를 `waves.jsonl` 에 append 하고, 자체 `verification` 객체를 싣는다. wave 별 최신 상태를 계산할 때 이 이벤트는 제외한다 — 포함하면 존재하지 않는 wave 하나가 영원히 미완료로 읽힌다.

§5.5.4 의 "wave head 회귀"는 최종 패스에서 **run head** 회귀로 읽는다.

같은 방식으로 §5.5.2 의 **보존** 분모도 최종 패스에서는 **run 창** — `run_diff_window` 의 `base_sha` ~ run head — 으로 읽는다. 최종 이벤트는 `wave="all"` 이라 wave 단위 `diff_window` 가 원리적으로 없기 때문이다.

**마지막 wave** 의 창을 대신 고르지 않는다 — 그러면 run 전체의 파손 판정이 마지막 wave 의 재검사가 된다.

최종 패스도 `unapproved-damage` **0 건**을 통과 조건으로 요구한다.

run-scope finding — 어느 wave 의 scope 에도 속하지 않아 wave 로 귀속할 수 없는 것 — 은 HALT 가 아니라 §0.5 **예외**에 따라 wave-N+1 을 추가해 처리한다. 추가한 wave 는 §4~§5.5 를 정상 실행하고, 그 wave 가 `complete` 로 기록된 뒤 §5.6 을 **재실행**한다.

wave 추가는 run 당 **3** 회를 상한으로 한다 — 상한에 닿으면 §0.G `wave-append-cap-exhausted` 로 중단하고 잔여를 전량 보고한다. 상한이 없으면 최종 패스가 wave 를 추가하고 그 wave 가 다시 최종 패스를 부르는 루프에 종료 보장이 없다.

최종 패스를 재실행할 때 **라운드 카운터**는 재실행을 가로질러 **누적**된다 — waves-event §4 의 재개 누적과 같은 규칙이며, 재실행마다 1 부터 다시 세면 cap 자체가 도달 불가능해진다.

이 재진입은 별도 장치가 아니다 — `waves-event.md` §4 의 재개 술어가 최종 검증이 통과하지 않은 run 을 이미 최종 검증으로 되돌린다.

최종 검증이 통과하지 못하면 그 이벤트의 `status` 는 `failed` 다 — `complete` 는 통과한 최종 검증에만 쓴다.

최종 검증이 pass 로 기록되기 전에는 오케스트레이션을 완료로 보고하지 않는다. 잔여 CRITICAL/HIGH, 검증자 1 의 `GAPS`, cap 소진(`fail-cap`)은 `--auto` 라도 중단이며(§0.G `final-verify-residual-critical`), 잔여 finding 을 **전량** 보고한다.

최종 패스가 통과하지 않은 run 은 완료가 아니다 — 재개는 첫 미완료 wave 가 아니라 최종 검증으로 들어간다.

---

## 6. Phase 4 — 진행 추적 waves.jsonl (AC-3)

전체 진행 상태는 `./kiwi/waves.jsonl` 에 append-only 로 기록한다(schema: `../_shared/kiwi/waves-event.md`). 각 wave 는 자신의 `$kiwi-pipeline` 실행이 **성공적으로 완료된**(only after it finishes successfully) 뒤에만 `./kiwi/waves.jsonl` 에 **완료로 표시(mark complete)** 한다 — 실행 중이거나 실패한 wave 는 완료로 기록하지 않는다.

세션이 초기화되어 **다시 시작**(resume)해도, `./kiwi/waves.jsonl` 을 읽어 **첫 번째 미완료(first incomplete) wave** 부터 **재개**한다. 이미 완료로 표시된 앞 wave 들은 건너뛰고, 첫 미완료 wave 지점에서 이어서 진행한다. 이 덕분에 장시간 멀티-웨이브 작업이 중단되어도 안전하게 이어갈 수 있다.

`complete` 이벤트와 `phase=wave-verify` 이벤트에는 `pipeline_run_id` 를 반드시 기록한다 — 그 wave 의 `pipeline.jsonl` 창을 여는 키이고, 거기서 plan run-id 를 거쳐 worklog · plan 에 도달한다. 스킬별 **분석 산출물**은 plan run-id 가 아니라 각 스킬 이벤트의 `artifacts.analysis_dir` 에서 해석한다(§5.5.1). wave 시작 시의 첫 `in_progress` **에서는 그 필드를** 생략한다 — 그 시점에는 pipeline 사이클이 시작되지 않아 run_id 가 아직 존재하지 않는다. 생략되는 것은 필드이지 이벤트가 아니다: 그 줄은 `phase="srs-authoring"` 을 달고 반드시 append 된다(§5.5.6). `complete` 기록은 §5.5 상호검증을 통과한 뒤에만 append 하며, 통과 기록이 없는 `complete` 는 무효다.

wave 안의 **재개 단위**는 **3단계**다 — target 등록 / pipeline / wave 검증. 완료된 단계는 다시 돌지 않는다 — wave 전체를 한 덩어리로만 되돌리면 이미 저작된 SRS 를 다시 저작하고, `srs_authored` 표식(§4)이 존재할 이유가 사라진다.

**pipeline 단계 재개**는 §5.5.5 재진입과 동일하게 `--plan-run-id` 와 `--req-filter` 를 **반드시 함께** 전달하고, `kiwi-pm` 은 `--resume` 으로 진입한다 — 범위 없이 재개하면 feasibility 부터 통째로 다시 돌아 stability mutation 이 재적용되고 완료된 Task 가 중복 실행된다.

그 값은 `plan_run_id` 필드로 `waves.jsonl` 에 기록한다 — 재개 세션에는 대화가 없으므로 저널에서 해소하지 못하면 위 두 인자를 만들 수 없다.

§4 를 건너뛰는 재개에서는 활성 target 을 `set_active_target` 으로 **명시 고정**한 뒤 pipeline 에 진입한다 — 그 경로에는 `$kiwi-srs` 호출이 없어 target 을 세우던 부수효과가 사라진다.

재개 스캔은 **현재 run 의 `run_id` 와 일치하는 이벤트만**을 읽는다 — `waves.jsonl` 은 저장소당 1개 append-only 파일이고 `wave-{n}` 은 run 간 고유하지 않다.

**재개 대상 run** 은 `complete` 로 끝나지 않은 **가장 최근 미완료** run 이며, `--run-id` 로 명시하면 그것이 우선한다.

**다른 run** 의 `complete` 는 이 run 의 완료로 읽지 않는다 — 앞선 에픽을 완주한 저장소에서 새 에픽의 `wave-1` 이 앞 에픽의 완료를 자기 것으로 읽으면 구현 0 건으로 전체 완료를 보고한다.

---

## 7. --auto / --max 전파 (AC-5)

### 7.1 --auto — 전 wave 자율 완주

`--auto` 활성 시 **모든 wave**(every wave)를 사용자 개입 없이 **끝까지(to the end)** 자율적으로(autonomously) 실행한다. wave 사이의 게이트를 자동 결정하여 wave-1 부터 wave-N 까지 완주한다.

단, `--auto` 라도 각 wave 의 `$kiwi-pipeline` **안전 게이트(safety gate)** 는 **여전히 적용**된다 — 하위 pipeline 이 `NEEDS_USER` / `FAILED` 를 반환하거나 critical 게이트에 도달하면 `--auto` 여도 자동 진행을 멈추고 사용자 결정을 받는다(§0.4). 즉 `--auto` 는 정상 흐름만 자율화하고, per-wave 안전 게이트는 그대로 유효하다.

웨이브 종료 상호검증(§5.5)의 잔여 CRITICAL/HIGH · 검증자 1 의 `GAPS` · `fail-cap` 도 마찬가지로 `--auto` 라도 자동 진행을 중단한다(§0.G). 전체 wave 최종 검증(§5.6)의 같은 세 조건도 동일하게 중단한다.

**`--auto` 단독**으로는 자식 kiwi-coder 의 `--auto-integration`(통합 테스트 동의)·`--auto-cost-warning`(비용 경고) 두 게이트를 통과하지 못한다 — 두 게이트는 해당 옵션이 **명시**될 때만 우회되며(kiwi-coder §0.18), 그 옵션이 자식까지 닿는 경로는 §7.4 pass-through 표가 정한다. 그 전까지 `--auto` 는 첫 코딩 wave 에서 멈춘다(§0.G).

per-wave 자식 스킬로의 `--auto` 자동 전파는 `../_shared/kiwi/auto-option.md` 의 공유 옵션 계약을 따른다 — 스킬마다 전파 규칙을 다시 쓰면 계약이 갈라진다.

### 7.2 --max — 하위 스킬 전파

`--max` 활성 시 **모든 wave** 의 `$kiwi-pipeline` 과 그 **하위 스킬(sub-skill)** — 각 wave 사이클이 spawn 하는 `kiwi-srs` · `kiwi-srs-feasibility` · `kiwi-planner` · `kiwi-pm` · `kiwi-review-fix-loop` — 에 `--max` 를 그대로 **전파(propagate)** 한다. 하위 스킬의 `--max` 의미는 각자의 SSOT 를 따른다.

`--max` 는 **§4 가 직접 호출하는** per-wave `kiwi-srs` 에도 전파한다 — 사이클은 `--from=feasibility` 로 진입해 `kiwi-srs` 를 spawn 하지 않으므로, "사이클이 spawn 하는 하위 스킬" 목록만으로는 §4 가 빠진다.

`--auto` 와 `--max` 는 함께 쓸 수 있으며(`--auto --max`), 이 경우 모든 wave 를 고강도로 자율 완주하되 per-wave 안전 게이트는 유지한다.

### 7.3 `--mini` / `--loops N` — 하위 스킬 전파

`--mini` 또는 `--loops N` 활성 시 (`../_shared/kiwi/loop-option.md` v1.0 SSOT), **모든 wave** 가 spawn 하는 per-wave `kiwi-srs` 와 `kiwi-pipeline` 에 해당 플래그를 그대로 **전파(propagate)** 한다. 하위 스킬의 라운드 상한 시맨틱은 각자의 `loop-option.md` 참조를 따른다.

본 전파는 §5.5 **웨이브 종료 상호검증** 루프의 라운드 상한에도 동일하게 적용된다 — 결선하지 않으면 `--mini` 가 per-wave 하위 스킬만 줄이고 본 루프는 기본 상한 5 로 남는다.

### 7.4 pass-through 옵션 (자식 게이트 도달)

아래 옵션은 본 스킬이 소비하지 않고 자식 체인으로 그대로 흘려보낸다 — 중간 스킬이 하나라도 떨어뜨리면 무인 실행이 마지막 홉에서 멈춘다. `--auto-cost-warning` · `--auto-integration` · `--force` 세 옵션은 사용자가 **명시**한 입력일 때만 흐른다. `--regression-baseline` 은 §2.1 이 pin 한 값이므로 예외이고, `--drive` 는 본 스킬이 소비하면서 **동시에** 흘려보낸다는 점에서 예외다 (§7.5).

자식이 `pm.lock` 으로 막혀 실패해도 본 스킬은 `--force` 를 **자동으로 부여하지 않는다** — 다른 PM 인스턴스가 살아 있는 경우와 구분되지 않으므로 §0.G `child-pipeline-needs-user-or-failed` 로 중단하고 사용자 결정을 받는다.

| 옵션 | 도달 대상 | 전파 경로 |
|---|---|---|
| `--drive` | 무인 완주 모드 전체 — 자식 게이트 3종을 함께 연다 | kiwi-wave-master → kiwi-pipeline → kiwi-pm → kiwi-coder |
| `--auto-cost-warning` | kiwi-coder 비용 확인 게이트 | kiwi-wave-master → kiwi-pipeline → kiwi-pm → kiwi-coder |
| `--auto-integration` | kiwi-coder 통합 테스트 동의 게이트 | kiwi-wave-master → kiwi-pipeline → kiwi-pm → kiwi-coder |
| `--force` | kiwi-pm 의 stale `pm.lock` 해제 | kiwi-wave-master → kiwi-pipeline → kiwi-pm (**명시** 입력만) |
| `--regression-baseline` | kiwi-coder / kiwi-review-fix-loop 의 회귀 델타 판정 | kiwi-wave-master → kiwi-pipeline → kiwi-pm → kiwi-coder (§2.1 이 pin 한 값) |

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
| `out-of-scope-user-consent` | 설계 항목이 모든 계층의 분모에서 빠진다 — 범위가 조용히 줄어든다 |
| `unsafe-option-refused` | 회귀와 리뷰가 꺼진 채 wave 가 누적된다 |
| `wave-append-cap-exhausted` | 무인 실행의 종료를 보장하는 유일한 경계가 사라진다 |

이 목록을 여는 것은 목표를 향해 가는 것이 아니라 **목표를 낮추는 것**이다. 테스트를 약화시키거나 설계 항목을 배제하면 실행은 끝까지 가고 게이트는 통과하지만 실제로 한 일은 줄어든다. 무인 실행에서 가장 위험한 실패는 실패가 아니라 성공처럼 보이는 축소이며, 그것은 아무도 보지 않는 시간에 일어난다.

#### 7.5.2 잔여 검증 게이트도 닫힌 채로 둔다

`wave-verify-residual-critical` · `final-verify-residual-critical` · `wave-verify-fail-residual` 은 `--drive` 에서도 중단이다. 이 셋에 닿았다는 것은 자동 수정 루프가 **이미 실패했다**는 뜻이고, 그 상태로 다음 wave 를 쌓으면 결함이 남은 wave 수에 비례해 커진다.

#### 7.5.3 결정과 중단은 저널에서 읽을 수 있어야 한다

`--drive` 로 중단할 때는 그 게이트의 id 를 `waves.jsonl` 의 `abort_gate` 필드에 **지명**한다. 단 `abort_gate` 의 값 공간은 오케스트레이터 게이트 어휘(`GateId`)이므로, 자식 스킬이 소유한 게이트 — `existing-test-weakened-or-deleted` · `existing-public-contract-change` · `existing-file-deleted-or-moved` · `mock-detection` · `tdd-bypass-attempt` — 는 자기 이름으로 적지 않고 `child-pipeline-needs-user-or-failed` 로 버블업해 적는다. 자식 게이트 이름을 그대로 쓰면 `abort-gate-outside-vocabulary` 오류가 난다.

자동으로 해소한 게이트는 그 게이트를 지명하는 `decision` 객체를 1건 기록한다 (`{ question, options, decision, rule, committee_size, confidence, origin }`).

산문으로만 "critical 게이트에서 중단했다"고 적으면 다음 세션이 어떤 게이트였는지 알 수 없다. 무인으로 밤새 돌린 뒤 아침에 읽을 수 없는 기록은 없는 기록과 같다.

---

## 8. 에픽 이슈 진입 모드 (FR-FLOW-030)

에픽 이슈(epic issue) 번호가 진입 인자로 제공되면, wave 의 출처만 달라질 뿐 wave 를 추출한 뒤의 흐름은 §3~§7 문서 분해 진입과 동일하다.

### 8.1 에픽에서 순서 있는 wave 추출 (AC-1)

에픽 이슈가 진입점이면, 연구·계획 문서(research·plan document)를 **분석(analyze)** 하여 wave 를 나누는 §3 방식이 **아니라(instead of)**, **에픽 이슈(epic issue)** 자체에서 **순서(order)가 있는** wave 집합을 **추출(extract/도출)** 한다.

에픽에서 wave 를 도출하는 세 갈래 출처는 함께 고려한다 — 에픽 **본문 구조(structure)**, 에픽의 **태스크 리스트(task list, 작업 목록·체크리스트)**, 그리고 에픽에 **연결된 하위 이슈(linked sub-issue)**. 이 구조·태스크 리스트·연결된 하위 이슈의 나열 순서가 곧 wave 순서가 된다.

즉 wave 는 별도의 연구·계획 문서를 **분석**해서 만드는 것이 **아니라**, 에픽 이슈의 구조에서 직접 추출된다.

### 8.2 추출 후 FR-FLOW-029 와 동일 진행 (AC-2)

wave 를 추출한 뒤부터는 **FR-FLOW-029 와 동일(identical)** 하게 진행한다 — §4 의 scoped `wave-{n}` **target(타깃)** 등록, §6 의 `./kiwi/waves.jsonl` 진행 추적, §5 의 wave 별(per-wave) `$kiwi-pipeline` 을 등록 **순서대로(in order)** 실행하는 기계(machinery)를 그대로 재사용한다.

- 각 wave 는 §4 처럼 `$kiwi-srs` 로 전용 `wave-{n}` target 을 그 wave 의 **범위(scope)** 로 한정해 등록한다.
- 진행은 §6 처럼 `./kiwi/waves.jsonl` 에 기록하고, 성공한 wave 만 완료로 표시하며, 첫 미완료 wave 부터 재개한다.
- 실행은 §5 처럼 `$kiwi-pipeline` 을 **등록 순서대로** wave 별로 호출한다.

### 8.3 스킵되는 것은 사전 wave-split 연구뿐 + 구조 가드 (AC-3)

에픽 진입에서 **생략(skip)** 되는 것은 오직 §3 의 **사전(up-front)** **wave 분할 연구(wave-split research)** 분석 한 단계뿐이다 — 에픽이 이미 wave 경계를 구조로 제공하므로, 앞단에서 문서 흐름을 다시 연구(research)할 필요가 없다.

그러나 각 wave 의 `$kiwi-pipeline` 은 **자체 연구(own research)** 를 그대로 수행한다 — wave 마다 자기 자신의 per-wave 리서치를 pipeline 안에서 돌린다. 생략되는 것은 상위의 사전 wave-split 연구 한 단계뿐이고, wave 별 pipeline 의 자체 연구는 유지된다.

**구조 가드** — 사전 연구 생략은 에픽이 **추출 가능한 구조(extractable structure)** 를 가질 때만 확정된다:

- **(a) 구조화된 에픽 (research-skip)**: 에픽에 **태스크 리스트 그룹(task-list group)** 이나 **2개 이상(>=2)** 의 **연결된 하위 이슈(linked sub-issue)** 처럼 **추출 가능한 구조가 있으면**, 사전 wave-split 연구를 **생략(skip)** 하고 그 구조에서 직접 wave 를 **분할(decompose/분해)** 한다.
- **(b) 비구조화 에픽 (fallback)**: 에픽이 자유 형식(free-form) 산문(prose)이거나 연결된 하위 이슈가 2개 미만(<2)이라 나눌 수 없어 **추출 가능한 구조가 없으면(no extractable structure)**, 사전 연구 생략을 적용하지 않고 **FR-FLOW-029 의 wave-split 서브에이전트** 흐름으로 **폴백(fallback)** 한다(새 컴포넌트 없음). 이 경우 §3 의 그 서브에이전트가 에픽 본문 흐름을 **분석**해 wave 를 나눈다.

---

## 9. Pipeline emit (의무)

`../_shared/kiwi/pipeline-event.md` v1.0.0 를 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 1줄 append(멱등: run_id 기준). wave 별 진행은 별도로 `./kiwi/waves.jsonl`(§6, waves-event.md) 에 기록한다. emit 실패는 best-effort — 본 작업 실패로 이어지지 않는다.

**Preflight halt 시 저널 처리 (FR-FLOW-043)**: §2.1 게이트가 중단한 run 은 wave 를 시작하지 않았으므로 저널 root 를 pin 하지 않고 `waves.jsonl` 에 아무것도 기록하지 않는다. 다만 종료 시 1회 emit 의무는 그대로 유지된다 — `pipeline.jsonl` 에 `status=FAILED`, `next_hint=null` 인 이벤트를 정확히 1줄 append 한다.

이때 저널 경로는 `pipeline-event.md` §1 의 해석 순서(git root `git rev-parse --show-toplevel` → cwd 의 `kiwi/` → 홈 폴백)를 **run 자신의 cwd 기준으로 1회 평가**해서 정한다. 폴백 체인과 `.pipeline-path` 마커 파일 규칙을 그대로 상속하므로 git 조회가 실패한 환경에서도 기록 경로가 정의된다. MCP 가 보고한 root 는 이 해석에 쓰지 않는다.

**재개**된 실행은 `{run_id}#r{n}` 를 emit 키로 쓴다(`pipeline-event.md` §5.4) — 멱등 skip 은 **같은 키**에만 적용된다. 중단 시 `FAILED` 를 남긴 run 이 재개로 완주하면, bare `run_id` 로는 최종 `TASK_DONE` 이 영구히 기록되지 않아 `kiwi-pipeline` 의 직전-이벤트 게이트가 계속 발동한다.
