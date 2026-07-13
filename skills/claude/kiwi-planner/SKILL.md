---
name: kiwi-planner
description: "target 활성 REQ 전수(deprecated 제외)에 대해 Phase와 Task 구조의 구현 계획을 수립. 코딩뿐 아니라 문서 수정, 파일 이동, 이슈/PR, 성능 테스트, 인프라 변경, 리뷰 등 비-코딩 Task도 포함. plan.md + 사이드카 JSON 양면 SSOT. speckiwi MCP add_trace_link / add_verification_evidence 로 plan-step ↔ REQ 그래프 영속화. 3 Sonnet 사전조사 병렬 + Opus 시니어 작성자 + 현재 세션 모델을 상속하는 단일 SRS 만족도 검증 서브에이전트 + validator.mjs 무결성 검증 + 개선-검증 루프. 트리거 — kiwi planner, 계획 수립, 구현 계획, plan 작성, kiwi plan, 계획 작성, 작업 분해, 작업 계획, task 분해, 구현 절차, REQ 구현 계획, target 구현 계획, srs 구현 계획, 계획 검증, plan validate, plan 사이드카, requirement to plan, implement plan. 평가·검증은 현재 세션 모델을 상속하는 단일 검증 서브에이전트로 수행하며 `--model <name>` 로 그 모델을 override 한다(게이트·validator.mjs·TDD 강제 불변)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-planner v0.6

target 활성 REQ 전수를 Phase와 Task 구조로 분해해 **plan.md + 사이드카 JSON** 두 산출물 SSOT 로 영속화하는 계획 수립 스킬. 코딩·문서·파일 이동·이슈/PR·성능 테스트·인프라·리뷰 등 비-코딩 Task 도 1급으로 다룬다.

**규칙 진술 원칙**: 본 문서의 모든 규칙은 현재 적용되는 동작만 declarative 하게 기술한다. 연혁/정정은 git history 로 추적한다 (본문에 변경 이력 섹션 없음).

---

## Official Workflow Tool Policy

계획 문서(plan.md + 사이드카)의 조회·검증·체크박스 변경 등 **커버되는 흐름**은 원본 파일 직접 접근 전에 공식 SpecKiwi workflow_* MCP 도구를 우선 사용한다. target-9 workflow_* 도구를 SRS 연산 범주별로 라우팅한다:

- 읽기(reading/조회): `workflow_plan_status`, `workflow_plan_task`, `workflow_next_plan_task` 로 계획 상태를 판독한다.
- 검증(validating/진단): `workflow_doctor`, `workflow_schema_check`, `workflow_diff` 로 계획 무결성을 검증한다.
- 변경(mutating/체크박스): `workflow_task_check`, `workflow_task_uncheck`, `workflow_checklist_set` 로 계획 체크박스·체크리스트를 뮤테이션한다(체크박스 변경은 kiwi-coder/kiwi-pm 실행 시점 연산이며, planner 자신의 SRS mutation 은 `add_trace_link`/`add_verification_evidence` 로 한정된다).

plan.md·사이드카 최초 작성(authoring)은 `Write`/`Edit` 가 정상 경로이며 degraded 가 아니다. 위 커버 흐름에 한해, 원본 `docs/plans` 파일 직접 접근은 degraded 폴백(degraded mode)으로만 허용하며, 도구 진단·영향 산출물 경로·활성 target·후속 요구/후보 ID 를 기록한 뒤에만 사용한다. §8 validator.mjs 는 superseded 이지만 coverage 는 보존한다(C01–C25 plan-contract 검사 전수 유지, 개수 감소 없음).

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 별도 서브에이전트**. 인라인 자가검증 금지 |
| §0.2 | **검증자 입력 격리**. Phase 2 작성자의 결론·정당화 전달 금지. 원본 REQ + plan.md + 사이드카 JSON + 필터링된 컨텍스트만 |
| §0.3 | **코드 증거 우선**. Task 의 `files[]` 는 실재 파일·라인 범위 (Phase 1 code-context 결과 기반). 추정 시 `[INFERRED:level]` 라벨 |
| §0.4 | **할루시네이션 금지**. 존재하지 않는 함수·파일·CVE·테스트 항목 추가 금지. 사실 위조 거절 + `rejected_findings.log` |
| §0.5 | **speckiwi MCP 우선 + 황금률**. mutation 도구 (`add_trace_link` / `add_verification_evidence`) 호출 1회 = 사이드카 `mcp_call_log[]` 1회 = Markdown 자동 line-patch 1회. mutation 후 동일 SRS 파일 `Edit` 금지 (§0.G1) |
| §0.6 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.7 | **사용자 확인 의무**. scope 모호, draft REQ 포함 여부, frozen AC 누락, 외부 모듈 영향 — 모두 AskUserQuestion 단일 호출 분해 |
| §0.8 | **외부 모듈 수정 금지**. cwd 외부 path 가 Task `files[]` 에 진입 시 즉시 중단 + AskUserQuestion (§0.G2) |
| §0.9 | **dual-mode 미채택**. standalone 단일 모드. 미래 호출자 시나리오 발생 시 §0.G6 신설 후 도입 |
| §0.10 | **AC 단위 커버리지**. plan 의 Task 합집합이 target 전체 REQ 의 AC 합집합을 cover. 미커버 AC 가 frozen/stable REQ 에 잔존 시 차단 |
| §0.11 | **plan-step ↔ REQ 양방향 trace + 호출 순서 SSOT** (실 MCP 호출 = flat, sidecar mcp_call_log = nested — §9.5 (가)/(나) SSOT). (1) Phase 5 단계 1: 모든 Task 에 대해 실 MCP `add_trace_link` 호출 = flat args `{id: REQ-ID, type: "Task", reference: "T-PHnnn-mm", relation: "depends_on"}` → (2) 단계 2: coverage 의 각 REQ 에 대해 실 MCP `add_verification_evidence({id: REQ-ID, type: "plan", reference: "{plan_path}#T-PHnnn-mm"})` 일괄 호출. **각 호출은 사이드카 `mcp_call_log[]` 에 §9.5 (가) nested schema 로 기록** (`add_trace_link` 은 `{source:{type,id}, target:{type,reference}, relation}` nested, `add_verification_evidence` 는 `{id, type, reference}` flat — validator C15 검증 기반). 즉 실 MCP 호출 args 와 sidecar mcp_call_log args 는 추상 계층이 다르며 (전자=flat, add_trace_link 의 후자=nested), kiwi-coder §6.2 가 mutation 시점에 평탄화 책임을 가진다. `args_hash = sha1(call \| canonicalJson(args))` 는 멱등성 dedupe 보조 필드. 동일 `args_hash` 재호출 시 mcp_call_log 추가 entry 금지. 단계 1 중 부분 실패 → 단계 2 진입 차단 + 사용자 보고. |
| §0.12 | **`Stability` 진입 가드**. `Stability=deprecated` REQ 는 자동 제외. `Stability=draft` REQ 는 AskUserQuestion 후에만 진입 (§0.G3 4옵션) |
| §0.13 | **Status·Stability·target_goal 무수정 원칙**. planner 는 `update_status` / `update_stability` / `set_target_goal` / `append_section_note` 모두 호출하지 않는다. 허용 mutation = `add_trace_link` / `add_verification_evidence` 두 종만. Research 축 mutation 도 금지 (read-only `get_requirement` / `list_requirements` / `summarize_target` / `get_active_target` 만 허용) |
| §0.14 | **id 정규식 + max 제약 SSOT**. `phase.id` = `^PH-\d{3}$` (최대 999), `task.id` = `^T-PH\d{3}-\d{2}$` (Phase당 최대 99). `run_id` = `[a-z0-9.-]{4,40}` (dot 허용 — §1.3 형식 `{YYYY-MM-DD}.{project-slug}.{target-slug}` 호환). **초과 시 hard ERROR** — Phase당 Task 99 초과 시 Phase 분할 의무, Phase 999 초과 시 본 스킬 차단 + 사용자에게 target 분할 권고 |
| §0.15 | **plan_contract enum SSOT**. plan.md frontmatter 와 사이드카 `plan_contract` 의 허용 값 = `["1.1.0", "1.2.0"]` (dual-accept). 신규 plan 은 `1.2.0` 권장 (TDD 필드 포함). validator 가 enum 외 값은 ERROR. v0.7 에서 `1.1.0` deprecate 예정 |
| §0.16 | **plan.md heading level SSOT**. `§N` 헤딩 = `## §N ...` (h2). `§3.<phase_id>` = `### §3.<phase_id> ...` (h3). `§3.<phase_id>.<task_id>` = `#### §3.<phase_id>.<task_id> ...` (h4). h5 이하 금지. validator 는 h4 정확 매칭으로 task 카운트 |
| §0.17 | **TDD 원칙 SSOT**. 전역 CLAUDE.md TDD 의무를 plan-time 에 강제. `type=code` Task 는 (a) `tdd.applicable=true` + `tdd.phase∈{red,green,refactor}` + `tdd.test_cases≥1` 이거나 (b) `tdd.applicable=false` + `tdd.phase="n/a"` + `tdd.exempt_reason` (≥20자) 둘 중 하나. `tdd.phase="n/a"` 는 `applicable=false` 일 때만 허용. AC 단위 페어 분해 권장 — 동일 `covers_ac` 의 red Task 와 green Task 는 **분리된 별개 Task** 여야 한다 (단일 Task 에서 red+green 동시 수행 금지 — TDD 의 시간적 분리 강제). 동일 AC 페어의 순서는 Task-level `depends_on_task[]` 로 명시. `red_evidence`/`green_evidence` 는 planner 가 `null` slot 만 예약 — 실제 채움은 /kiwi-coder 책임 (§0.13 mutation 권한과 충돌 없음). `--tdd-policy` 가 `disabled` 면 본 §0.17 게이트·평가축·validator 검사 전부 skip. `tdd_policy ≠ disabled` 시 `type=code` Task 의 `tdd` 필드는 **필수** (누락 시 validator C21 ERROR) |
| §0.18 | **검증 서브에이전트 모델 정책 SSOT**. SRS 만족도 평가·검증은 **단일(single) 검증 서브에이전트**로 수행하며 기본적으로 **현재 세션 모델(current session model)**을 상속한다 (기존 Opus×1+Sonnet×1 이중 모델 평가자 패널을 대체). `--model <name>` (또는 사용자가 지명한 모델) 로 이 검증 서브에이전트의 모델을 override 한다. 검증 서브에이전트 구성 외 심각도 게이트·라운드 상한·validator.mjs 검사·TDD 강제(§0.17)는 불변 |
| §0.19 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. 본 스킬의 `critical_gates[]` 는 §1.5 (아래) 참조 |
| §0.20 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — 황금률 (mutation ↔ Edit)

| IF | THEN | 위반 severity |
|---|---|---|
| `add_trace_link` / `add_verification_evidence` 호출 | 사이드카 `mcp_call_log[]` 자동 entry 1건 + speckiwi 내부 Markdown line-patch | — |
| mutation 호출 후 동일 `docs/spec/*.srs.md` 에 `Edit` 도구 사용 | 차단 + 작성자 재spawn | **CRITICAL** (axis A1) |
| plan.md 자체 갱신 (`Edit` 또는 `Write`) | 허용 (plan.md 는 speckiwi mutation 대상이 아님) | — |
| 사이드카 JSON 수동 `Edit` (mcp_call_log 외 필드) | 허용 단, validator 재실행 필수 | — |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| Task `files[]` 에 cwd 외부 path 진입 | 즉시 중단 + AskUserQuestion 3옵션 |
| Phase 1 code-context analyst 가 외부 경로 보고 | 즉시 중단 + AskUserQuestion |
| REQ `trace[].reference` 가 외부 path 만 가리킴 | 해당 REQ 를 `unreferenced_reqs` 로 분리 + AskUserQuestion |

3옵션: `(1) 진행 승인` / `(2) 외부 path 제외 후 cwd 한정` / `(3) 작업 중단 후 외부 작업장 재실행`. 사이드카 `external_module_impact` 에 기록.

#### §0.G3 — draft REQ 진입

| IF | THEN |
|---|---|
| target REQ 중 `Stability=draft` 가 존재 + `--draft-policy=prompt` (기본) | AskUserQuestion 단일 호출 4옵션 |
| `--draft-policy=include-all` | 게이트 skip, draft 포함, plan 진행 |
| `--draft-policy=exclude-draft` | 게이트 skip, draft 제외, `excluded_reqs[]` 기록 |
| `--draft-policy=feasibility-first` | 게이트 skip, 차단 + `/kiwi-srs-feasibility` 선행 권고 후 종료 |
| `--draft-policy=block-all` | 게이트 skip, 즉시 작업 중단 |
| AskUserQuestion 응답 `include-all` | draft 포함, 전체 plan 작성 |
| AskUserQuestion 응답 `exclude-draft` | draft 제외 후 plan 작성, 사이드카 `excluded_reqs[]` 기록 |
| AskUserQuestion 응답 `feasibility-first` | 차단 + `/kiwi-srs-feasibility` 선행 권고 후 종료 |
| AskUserQuestion 응답 `block-all` | 작업 중단 |

`--draft-policy` enum SSOT: `prompt|include-all|exclude-draft|feasibility-first|block-all` 5종. `prompt` 외에는 게이트 자체를 우회.

#### §0.G4 — frozen/stable AC 미커버

| IF | THEN |
|---|---|
| coverage 결과 `Stability∈{frozen, stable}` REQ 에 `missing_ac_ids` ≥ 1 | AskUserQuestion 3옵션 |
| `add-tasks` | Phase 2 재spawn → 누락 AC 대응 Task 추가 |
| `accept-as-deferred` | 사이드카 `deferred_ac[]` 기록 + plan §5.2 Open Questions 등재 |
| `block` | mutation 호출 0건; 사용자 결정 대기 |

#### §0.G5 — 개선 루프 발산 감지

| IF | THEN |
|---|---|
| 작성자 재호출 3회 누적 | AskUserQuestion 4옵션 (아래) |
| 평가자 재호출 2회 누적 + 동일 finding 잔존 | AskUserQuestion 4옵션 + 잔존 finding 사용자 보고 |
| validator C15 (mcp_call_log mismatch) 가 2라운드 연속 잔존 | 즉시 사용자 알림 + plan freeze (아래 정의) |

AskUserQuestion 4옵션:
- `(1) draft-keep` — plan.md / 사이드카 draft 만 보존, mutation 0건 실행, 보고에 "발산" 표기
- `(2) partial-commit` — 통과 finding 까지의 plan 부분 commit + 잔존 finding 을 사이드카 `deferred_ac[]` / `open_questions[]` 에 기록 후 mutation 실행
- `(3) force-proceed` — 사용자가 책임 표명. 전체 plan commit + mutation 전수 실행. 보고에 `forced: true`
- `(4) abandon` — plan.md / 사이드카 삭제 또는 outputs/abandoned/ 로 이동, mutation 0건

**plan freeze** 정의: plan.md + 사이드카 + validator.json 을 `outputs/frozen/{run-id}/` 로 이동, frontmatter 에 `frozen_at: ISO-8601` 마커 부착. 이후 동일 run-id 호출 시 read-only 안내만 출력.

#### §0.G6 — Scope boundary (task.req_ids ⊄ target)

| IF | THEN |
|---|---|
| 평가자 또는 validator 가 `task.req_ids` 중 target REQ 외 ID 검출 | AskUserQuestion 3옵션 |
| `(1) expand-scope` | 사용자가 해당 REQ 를 target 에 포함 결정. planner 재실행 (TARGET 갱신 후) |
| `(2) drop-task-link` | Task 의 해당 req_id 만 제거 + `unreferenced_reqs` 에 기록 |
| `(3) block` | mutation 0건; 사용자 결정 대기 |

#### §0.G7 — TDD 면제 결정 (--tdd-policy ≠ disabled 시 활성)

**트리거**: `task.type === "code"` 이고 (`task.tdd.applicable === false` OR `task.tdd.test_cases.length === 0` OR `task.tdd` 미정의).

| IF (--tdd-policy=strict) | THEN |
|---|---|
| 위 트리거 발동 | AskUserQuestion 2옵션 (`accept-as-exempt` 비활성) |
| `(1) add-test-task` | Phase 2 재spawn — 해당 code task 앞단에 T-test (`tdd.phase=red`) Task 추가 + `depends_on_task` 연결 |
| `(2) block` | mutation 0건; 사용자 결정 대기 |

| IF (--tdd-policy=relaxed, 기본) | THEN |
|---|---|
| 위 트리거 발동 | AskUserQuestion 3옵션 |
| `(1) add-test-task` | 동일 (Phase 2 재spawn) |
| `(2) accept-as-exempt` | 면제 승인. `tdd.applicable=false` + `tdd.exempt_reason` (≥20자) 필수. 사이드카 `tdd_decisions[]` 에 `{task_id, decision, reason, user_decision_id, decided_at}` 기록 |
| `(3) block` | mutation 0건 |

`--tdd-policy=disabled`: 본 게이트 전체 skip (v0.5 호환 모드).

#### §0.G8 — test_first 순서 강제 (--tdd-policy ≠ disabled 시 활성)

**원칙**: 동일 `covers_ac` 페어 또는 동일 `req_ids` + 동일 phase 내 Task 군에서 `tdd.phase=red` 인 Task 가 `tdd.phase=green` 인 Task 보다 선행해야 한다. 선후 관계는 **`depends_on_task: string[]`** (Task ID 배열) 으로 명시. task_id seq (`-01`, `-02`) 는 *시각 힌트일 뿐* 의미 없음 (§0.14 정규식 변경 없음).

| IF | THEN | severity |
|---|---|---|
| green Task 의 `depends_on_task` 에 동일 AC red Task ID 누락 | Phase 3.5 작성자 재spawn | HIGH (axis A11) |
| Task-level `depends_on_task` 그래프 순환 | 작성자 재spawn | ERROR (validator C24) |
| refactor Task 가 동일 AC green Task 에 depends 미명시 | 작성자 재spawn | MEDIUM |

---

## 1. 입력 / 출력

### 1.1 필수 입력

- (없음) `get_active_target` 으로 자동 추출. 활성 target 부재 시 AskUserQuestion.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "target v0.X", "릴리즈 X" | `TARGET` | `get_active_target` |
| "REQ FR-X, FR-Y만" | `REQ_FILTER` (콤마 분리) | 전체 |
| "draft 포함", "draft만 제외" | `--draft-policy=prompt\|include-all\|exclude-draft\|feasibility-first\|block-all` | `prompt` (§0.G3) |
| "코드 경로 X" | `CODE_PATH` | cwd |
| "--max", "정밀 평가" | `--max` | off |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (단일 검증 서브에이전트) |
| "--dry-run", "테스트 실행" | `--dry-run` | off |
| "--report-channel telegram\|google-chat\|doculight" | `--report-channel` | `doculight` |
| "--sync-retry-delay-ms N" | `--sync-retry-delay-ms` | 200 |
| "TDD 엄격", "면제 불허", "TDD 완화", "TDD off" | `--tdd-policy=strict\|relaxed\|disabled` | `relaxed` (§0.17, §0.G7) |
| "자동", "묻지 말고", "확인 없이", "auto" | `--auto` (SSOT: auto-option.md v1.0) | off (사용자 결정 활성이 기본) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |

### 1.3 출력

- **계획 문서**: `docs/plans/{run-id}.plan.md`
- **사이드카 JSON**: `docs/plans/{run-id}.sidecar.json`
- **검증 보고**: `docs/plans/{run-id}.validator.json`
- **분석 로그**: `docs/analysis/kiwi-planner-{run-id}/`
  - `intent.json` / `code_context.json` / `srs_mapping.json`
  - `phase2_plan_draft_iter{N}.json`
  - `eval_iter{N}.json` (검증 서브에이전트 결과)
  - `improvement_iter{N}.json`
  - `mcp_call_log.jsonl`
  - `rejected_findings.log` / `preflight.json`

**Run-id**: `{YYYY-MM-DD}.{project-slug}.{target-slug}`. ASCII kebab, ≤40자.

### 1.4 dry-run

`--dry-run` 또는 `KIWI_DRY_RUN=1`:
- MCP mutation 미실행. 사이드카 `mcp_call_log[]` 에 가상 entry 작성 (`ok: null`, `response_hash: null`, `dry_run: true`).
- 산출물 `outputs/proposed-plan/{run-id}.plan.md`, `outputs/proposed-plan/{run-id}.sidecar.json`
- **validator 는 `--dry-run` 인자와 함께 호출**. validator 는 다음 동작:
  - C15 (mcp_call_log count) 는 `dry_run: true` 인 entry 까지 합산 → mutation 시뮬레이션 무결성 검증
  - 별도 추가 검사 C19 (dry-run 모드): 모든 mcp_call_log entry 가 `dry_run: true` (실수로 real mutation 섞임 차단)
- 보고 `mode: "dry-run"` 명시
- `outputs/proposed-plan/` 외 디렉토리 mutation 금지

### 1.5 `--auto` critical_gates[] 선언

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트:

| gate_id | reason | 발생 위치 |
|---|---|---|
| `frozen-stable-ac-uncovered` | frozen/stable REQ AC 미커버 시 `accept-as-deferred` 가 frozen REQ AC 유실 위험을 만든다 — 비가역 거버넌스 결정 | §0.G4 |
| `improvement-loop-force-proceed` | 개선 루프 발산 시 `force-proceed` 는 mutation 전수 실행 + 사용자 책임 표명 필요 | §0.G5 |
| `scope-boundary-expand-scope` | `task.req_ids` 가 target 외 ID 검출 시 `expand-scope` 는 planner 재실행 + TARGET 변경 — 거버넌스 결정 | §0.G6 |
| `tdd-policy-strict-block` | `--tdd-policy=strict` 일 때 `block` 결정은 정책 위반 강제 차단이며 사용자 결정 의무 | §0.G7 |
| `external-module-impact` | cwd 외부 path Task `files[]` 진입 — 외부 시스템 비가역 변경 | §0.G2 |

---

## 2. Phase 흐름

```
Phase 0  : Bootstrap (preflight, TARGET 확인, list_requirements, Stability 분류)
Phase 1  : Pre-investigation (Sonnet × 3 병렬: intent / code-context / srs-mapping)
Phase 2  : Plan drafting (Opus 시니어 — Phase와 Task 분해, plan.md + 사이드카 동시 작성)
Phase 3  : SRS-satisfaction verification (단일 현재 세션 모델 검증 서브에이전트; Max: + 독립 2차 검증 패스)
Phase 3.5: Improvement loop → Phase 2 또는 Phase 4
Phase 4  : Integrity validation (validator.mjs 실행)
Phase 4.5: Validator-driven improvement → Phase 2 또는 Phase 5
Phase 5  : Mutation + report (add_trace_link / add_verification_evidence, doculight + fallback)
```

---

## 3. Phase 0 — Bootstrap

### 3.0 speckiwi 가용성 사전 점검

판정 순서:
1. MCP `get_active_target` 성공 → **PASS**
2. CLI `speckiwi --version` exit 0 → **PASS** (`mode: "cli-fallback"`)
3. 둘 다 실패 → **HALT** + 설치 가이드 출력 (kiwi-srs §3.0 메시지와 동일 양식)

기록: `preflight.json: { mcp, cli, halted }`.

### 3.1 TARGET 확정

1. `TARGET` 인자 → 최우선
2. `get_active_target` → 활성 채택
3. CLI `speckiwi targets --json` 단일 등록 → 자동 채택 + 안내
4. AskUserQuestion → "어느 target 의 계획을 수립하시겠습니까?"

### 3.2 REQ 로드 + Stability 분류

- `list_requirements { target: TARGET }`
- `summarize_target { target: TARGET }`
- REQ 를 Stability 별로 분류:
  - `deprecated` → 자동 제외, `excluded_reqs[]` 기록 (reason: "deprecated")
  - `draft` → §0.G3 게이트 발동
  - `evolving|stable|frozen` → plan 대상 진입
- `REQ_FILTER` 인자 적용 시 교집합

### 3.3 N=0 분기

| 조건 | 동작 |
|---|---|
| `target_total = 0` | HALT + "target 에 REQ 가 없습니다. /kiwi-srs 로 먼저 작성하십시오." |
| `filtered = 0` (target_total > 0) | HALT + "필터 결과 0건. REQ_FILTER 또는 --draft-policy 확인 권장." |
| `filtered ≥ 1` | Phase 1 진행 |

---

## 4. Phase 1 — Pre-investigation (Sonnet × 3, 병렬, 격리)

### 4.1 Intent analyst

입력: target goal (`set_target_goal` 결과 또는 README 발췌) + REQ 본문 요약
출력: `intent.json`
```json
{
  "target_intent": "한 줄 요약",
  "user_priorities": [],
  "ambiguities": [],
  "non_coding_signals": ["문서 갱신 필요", "성능 테스트 필요", ...]
}
```

### 4.2 Code context analyst

입력: `CODE_PATH` + REQ 각각의 `trace[code].reference`
출력: `code_context.json`
```json
{
  "req_anchors": [
    { "req_id": "FR-...", "files": [{ "path": "src/x.ts", "line_range": "45-67", "signature": "..." }] }
  ],
  "missing_anchors": [],
  "external_paths_detected": [],
  "addition_sites": []
}
```

`external_paths_detected` 비어있지 않으면 §0.G2 발동.

### 4.3 SRS mapping analyst

입력: `list_requirements` 결과 + Stability 분류
출력: `srs_mapping.json`
```json
{
  "req_inventory": [
    {
      "req_id": "FR-TODO-001",
      "stability": "evolving",
      "status": "proposed",
      "ac_total": 3,
      "ac_ids": ["AC-1","AC-2","AC-3"],
      "files_from_trace": ["src/api.ts:45-67"],
      "depends_on": ["FR-AUTH-002"],
      "feasibility_hint": "high|medium|low|unknown"
    }
  ],
  "dependency_graph": [{"from":"FR-TODO-001","to":"FR-AUTH-002"}]
}
```

### 4.4 격리

세 analyst 서로 격리. Phase 1 종료 후 메인이 통합.

---

## 5. Phase 2 — Plan drafting (Opus 시니어)

### 5.1 시니어 입력

- target goal · `intent.json` · `code_context.json` · `srs_mapping.json`
- 작성 규약: §0 전체 + §9 plan.md 스키마 + §10 사이드카 스키마
- 시니어는 **plan.md 와 사이드카 JSON 을 동시에 생성** (Phase와 Task 구조 일관성 보장)

### 5.2 Phase 분해 원칙

| 원칙 | 설명 |
|---|---|
| Phase 단위 | 의존성으로 묶이는 1개 이상의 Task 집합. 외부 산출물 인계 가능 단위 |
| Task 단위 | 단일 실행 가능한 atomic 작업 — 1 파일 또는 1 PR 또는 1 이슈 단위 권장 |
| Phase 의존성 | `depends_on: phase_id[]` 명시. 순환 금지 |
| Task 의존성 | `depends_on_task: task_id[]` 명시 (선택, TDD 페어/refactor 순서 표현 용). 순환 금지 (validator C24) |
| REQ 분배 | 1 Task 가 다루는 REQ 는 명시. 1 REQ 가 여러 Task 에 분산되어도 OK (coverage 로 추적) |
| 비-코딩 Task | type ∈ `doc|file_op|issue|pr|perf_test|infra|review` 명시. acceptance_tests 는 type 별 적합 형식 (§9.3 표) |
| **TDD 분해 (옵션 C 권장)** | `type=code` Task 는 REQ 의 각 AC 마다 **T-test (tdd.phase=red) + T-impl (tdd.phase=green)** 페어로 분해. refactor 는 조건부 (큰 구조 변경 시만). 두 Task 는 동일 Phase 에 속하고 green 이 red 를 `depends_on_task` 로 참조. `covers_ac` 필드에 페어 대상 AC 명시 |
| **TDD 면제 Task** | doc / file_op / issue / pr / review = `tdd.applicable=false` 자동. infra 는 헬스체크만이면 false + reason, 코드 변경 동반 시 true. perf_test 는 `tdd.applicable=true` + `tdd.phase=green` (벤치마크 baseline 이 red 역할) 권장 |

### 5.3 Task 작성 의무 필드

§9 / §10 의 schema 와 동일. 누락 시 Phase 4 validator 가 거절.

### 5.4 산출물

- `docs/plans/{run-id}.plan.md` (Write)
- `docs/plans/{run-id}.sidecar.json` (Write, `mcp_call_log` 는 빈 배열로 초기화)
- `phase2_plan_draft_iter{N}.json` (분석 로그)

---

## 6. Phase 3 — SRS-satisfaction verification (단일 현재 세션 모델 검증 서브에이전트)

### 6.1 검증 서브에이전트 구성

- Normal: 단일 검증 서브에이전트 (현재 세션 모델 상속)
- Max: 단일 검증 서브에이전트 + 독립 2차 검증 패스 (현재 세션 모델; 2 연속 MEDIUM=0 종료)
- `--model <name>` 지정 시 검증 서브에이전트 모델을 override (기본은 현재 세션 모델)

### 6.2 평가자 입력 (§0.2 격리)

- 원본 REQ 본문 (speckiwi `get_requirement` 결과)
- 생성된 plan.md + 사이드카 JSON
- target goal
- **금지**: 시니어 작성자의 rationale / 정당화 / 작성 과정 로그

### 6.3 평가 축 (axis enum)

| axis ID | 이름 | 책임 |
|---|---|---|
| A1 | golden_rule | §0.G1 황금률 — mutation 후 Edit 흔적 |
| A2 | external_module | §0.G2 외부 path 진입 |
| A3 | req_coverage | 모든 비-deprecated REQ 가 ≥1 Task 에 매핑 |
| A4 | ac_coverage | Stability∈{frozen,stable} REQ 의 AC 누락 0건 |
| A5 | orphan_task | REQ 미참조 Task 존재 여부 |
| A6 | type_fit | Task type 과 acceptance_tests 형식 정합 |
| A7 | depends_on_cycle | Phase 의존성 순환 |
| A8 | files_grounding | Task `files[]` 가 실재 + line_range 유효 |
| A9 | non_coding_completeness | 문서/PR/이슈/perf 등 비-코딩 누락 |
| A10 | dod_specificity | dod 가 검증 가능한 명제로 작성 |
| A11 | test_first_ordering | §0.G8 — 동일 AC 페어 내 red Task 가 green Task 보다 `depends_on_task` 로 선행 |
| A12 | test_ac_coverage | frozen/stable AC ⊆ ⋃ test_case.ac_refs (test_case-level 커버리지) |
| A13 | tdd_exemption_justification | `tdd.applicable=false` 의 `exempt_reason` 합리성 (≥20자, 구체적 사유) |

A4 와 A12 의 책임 분리: **A4** = task-level (AC 가 어떤 Task 에라도 매핑되는가) / **A12** = test_case-level (AC 가 실행 가능한 test_case 에 ref 되는가). 둘 다 CRITICAL 이며 finding 은 중복 보고하지 않는다.

### 6.4 평가 severity

`CRITICAL` (A1·A2·A4·**A12**) / `HIGH` (A3·A5·A7·**A11**) / `MEDIUM` (A6·A8·A10·**A13**) / `LOW` (A9)

`--tdd-policy=disabled` 시 A11·A12·A13 skip.

### 6.5 종료 조건

- Normal: CRITICAL=0 + HIGH=0 → PASS
- Max: 2 라운드 연속 MEDIUM=0 → PASS
- 위 불만족 시 Phase 3.5 개선 루프

### 6.6 finding_hash

`sha1(utf8("{req_id_or_'_'}|{task_id_or_'_'}|{axis}|{evidence_path_or_'_'}|{severity}"))`. 동일 finding 중복 방지.

### 6.7 산출물

`eval_iter{N}.json`: { findings[], summary, pass }

### 6.8 커버리지 검증 루프 (plan ↔ SRS coverage verification loop, FR-FLOW-032)

본 절은 §6.1~6.5 의 SRS-satisfaction finding 평가(FR-FLOW-022)와 **별개의** 검증으로, plan 이 target SRS 를 **요구사항 단위로** 빠짐없이 커버하는지 확정하는 커버리지 루프(FR-FLOW-032)다. 두 절의 검증 패스 수는 측정 대상이 달라 서로 다르다 — §6.1 은 plan 전체를 axis(A1~A13)로 평가하는 finding 패스(Normal 1 / Max 2)이고, 본 절은 요구사항마다 커버리지 완료를 확인하는 순차 검증 패스(Normal 2 / Max +독립 3차 반박)다. 각 단계는 현재 세션 모델(FR-FLOW-022, `--model <name>` 로 override 가능) 검증 서브에이전트가 수행한다.

1. **개수 대조 (reconcile)** — 루프는 target SRS 요구사항 개수를 plan coverage 항목 수와 대조(reconcile)하는 것으로 시작한다. 두 수가 어긋나면 즉시 누락 후보로 기록한다.
2. **요구사항 id 일대일 교차 검증** — 그다음 각 요구사항 id 를 plan 과 하나씩(one-by-one) 교차 검증(cross-check)한다. 집계 퍼센트가 아니라 요구사항마다 개별 대응 Task 존재를 하나하나 확인한다.
3. **2회 순차 검증 + 검증 완료 마킹 (verification-complete)** — 각 요구사항의 커버리지는 현재 세션 모델(FR-FLOW-022)에서 2회의 순차적(2 sequential) 검증으로 확인한다. 첫 번째(first) 검증이 통과한 후에야 독립적인(independent) 두 번째(second) 검증이 재확인(re-confirm)하며, 두 검증이 모두 확인해야 해당 요구사항을 **검증 완료(verification-complete)** 로 마킹한다. 이 검증 완료 마킹은 영속적(persistent)이어서, 한 번 마킹된 요구사항은 이후 반복에서 다시 검증하지 않고 고정 유지된다.
4. **--max 강화 (독립 3차 반박 + AC 단위)** — `--max` 에서는 독립적인 세 번째(independent third) 검증이 완전 커버리지를 반박(refute)하는 데 실패해야 요구사항을 마킹한다. 또한 `--max` 에서는 커버리지를 AC 단위(acceptance-criterion granularity)로 검사한다.
5. **누락 수리 루프 (omission-repair)** — 누락(omission)이 감지되면 kiwi-planner 는 계획을 개선(improve the plan)한다. 누락은 미커버(uncovered) 요구사항/AC 뿐 아니라 SRS 범위 밖(outside the SRS scope)의 plan task 도 포함한다. 개선 후에는 아직 마킹되지 않은(not-yet-marked) 항목만 재검증(re-verify)하며, 모든 요구사항이 검증 완료로 마킹될 때까지 반복(iterate)한다. 이 루프는 §0.G5 의 발산 가드(divergence guard)로 상한이 걸린다.
6. **--max 종료 조건** — `--max` 에서는 새 누락 0건(zero new omissions)인 라운드가 2 라운드 연속(two consecutive)일 때만 루프를 종료(terminate)한다.

---

## 7. Phase 3.5 — Improvement loop (SRS-satisfaction)

분기표 (§12 와 통합):

| finding axis | 분기 | 처리 |
|---|---|---|
| A1·A2·A4·**A12** (CRITICAL) | 작성자 재spawn | Phase 2 재실행, severity 강제 표시 |
| A3·A5·A7·**A11** (HIGH) | 작성자 재spawn | 동일 |
| A6·A8·A10·**A13** (MEDIUM) | 작성자 재spawn 또는 사용자 confirm | 작성자 1회 시도 후 잔존 시 사용자 |
| A9 (LOW) | 사이드카에 기록 후 진행 가능 | 사용자 보고 시 LOW 잔존 목록 표시 |

루프 상한: 작성자 재호출 **3회**, 평가자 재호출 **2회**. 초과 시 §0.G5 발동.

### 7.1 `needs_clarification` 처리

Task 의 `needs_clarification[]` entry 는 `auto_severity` 기준으로 분기:

| auto_severity | 분기 |
|---|---|
| `clarification` | 평가자 노트로 기록, 작성자 다음 라운드에 자체 해결 시도 (사용자 호출 없음) |
| `business-decision` | 즉시 AskUserQuestion. 답변 없으면 plan 진행 차단 |
| `rollback-confirmation` | 사용자 알림 (`--auto` 모드에서는 자동 승인). 답변 후 진행 |

`blocks_task: true` 인 entry 가 1건이라도 미해결이면 해당 Task 는 사이드카 `open_questions[]` 로 이동 + plan §5.2 등재.

---

## 8. Phase 4 — Integrity validation (validator.mjs)

### 8.1 실행

```
node ~/.claude/skills/kiwi-planner/validator.mjs \
  docs/plans/{run-id}.plan.md \
  docs/plans/{run-id}.sidecar.json \
  --target {TARGET} \
  --inventory-file docs/analysis/kiwi-planner-{run-id}/inventory.json \
  --out docs/plans/{run-id}.validator.json \
  [--check-files] \
  [--dry-run]
```

**inventory-file 필수**. 부모(메인 세션)가 Phase 0.2 에서 `list_requirements` 결과를 `inventory.json` 으로 dump 한다. 형식:

```json
[
  { "id": "FR-TODO-001", "stability": "evolving", "ac_total": 3, "ac_ids": ["AC-1","AC-2","AC-3"] },
  ...
]
```

### 8.2 검증 항목 (25개 + R 시리즈 4종, --tdd-policy=disabled 시 C21~C25 + R04 skip)

| # | 항목 | severity |
|---|---|---|
| C01 | 사이드카 JSON parse | ERROR |
| C02 | plan.md frontmatter 필수 필드 (run_id, target, plan_version, plan_contract, generated_at, tool_versions, sidecar_path) | ERROR |
| C03 | phase.id 유일성 + task.id 유일성 + trace_link.link_id 유일성 (사이드카 전역) | ERROR |
| C04 | task.phase_id ∈ phases[].id **양방향** — phase.task_ids 와 task 집합 multiset 동등 | ERROR |
| C05 | task.req_ids ⊆ inventory(target) (deprecated 제외). **inventory 미제공 시 ERROR** (skipped 아님) | ERROR |
| C06 | plan.md §2 phase 수 == sidecar.phases.length (table 첫 번째 표 본문 행만 카운트) | ERROR |
| C07 | plan.md §3 task 수 == sidecar.tasks.length (h4 정확 매칭) | ERROR |
| C08 | plan.md 각 task 표현 == sidecar 필드 — **canonical form 정규화 후** hash 비교 (title trim, type 소문자, req_ids sort, files sort by path:line_range) | ERROR |
| C09 | coverage[]: ac_covered + missing_ac_ids.length == ac_total, 모든 필드 비음수 + 정수 | ERROR |
| C10 | orphans: 0=OK / 1-2=WARN / ≥3=ERROR | WARN/ERROR |
| C11 | unreferenced_reqs (deprecated 제외) ≥1 = ERROR | ERROR |
| C12 | acceptance_tests.kind ↔ task.type 정합 (§9.3 표) | ERROR |
| C13 | verification_cmd: `null` 또는 `{posix: non-empty, windows: non-empty}` 둘 중 하나. 빈 문자열·한쪽만 정의 금지 | ERROR |
| C14 | trace_links[].target.reference ⊆ task.req_ids (target.type=Requirement 만, Code 타입 제외) | ERROR |
| C15 | mcp_call_log multiset 정합 (§9.5 (가) SSOT): `add_trace_link` entry 의 nested key `(source.id, target.type, target.reference)` multiset == Σ tasks[].trace_links 의 `(source.id, target.type, target.reference)` multiset. + `add_verification_evidence` entry 의 `args.id` multiset == coverage 의 req_id 집합 (flat) | ERROR |
| C16 | phase.depends_on DAG (순환 금지) | ERROR |
| C17 | (선택, `--check-files` 시) task.files[].path 실재 존재 + line_range 유효 (파일 라인 수 이하) | ERROR |
| C18 | plan_contract enum: `["1.1.0", "1.2.0"]` 외 값 거부 (dual-accept) | ERROR |
| C19 | (`--dry-run` 시) mcp_call_log 모든 entry 에 `dry_run: true` | ERROR |
| C20 | plan.fm.sidecar_path 가 실제 입력 sidecar 경로와 일치 (canonical path 비교) | WARN |
| C21 | (`--tdd-policy ≠ disabled`) `type=code` Task 는 `tdd` 필드 필수. `tdd.applicable=true` 면 `tdd.test_cases.length ≥ 1` AND `tdd.phase ∈ {red,green,refactor}`. `applicable=false` 면 `tdd.phase = "n/a"` 강제 | ERROR |
| C22 | (`--tdd-policy ≠ disabled`) `type ∈ {code, perf_test, infra}` Task 가 `tdd.applicable=false` 이면 `tdd.exempt_reason` 길이 ≥ 20자. 자동 면제 type (doc/file_op/issue/pr/review) 은 reason 강제 X | ERROR |
| C23 | (`--tdd-policy ≠ disabled`) 각 `tdd.test_cases[]` 에 대해 `req_id ∈ task.req_ids` AND `ac_refs[] ⊆ inventory(test_case.req_id).ac_ids` (test_case 단위 명시적 매칭, ambiguity 제거) | ERROR |
| C24 | (`--tdd-policy ≠ disabled`) Task-level `depends_on_task` 그래프 DAG (순환 금지, 정규화된 cycle 중복 제거) + 참조 무결성 (모두 sidecar.tasks[].id) | ERROR |
| C25 | (`--tdd-policy ≠ disabled`) `green_evidence ≠ null` 이면 `red_evidence ≠ null` 그리고 `red_evidence.exit_code ≠ 0` (red 는 실제로 실패해야 함). `--tdd-policy=strict` 시 ERROR, `relaxed` 시 WARN | WARN/ERROR |

추가 정규식 (ERROR, R 시리즈):
- R01 run_id ∈ `[a-z0-9.-]{4,40}`
- R02 phase.id ∈ `^PH-\d{3}$`, max 999개
- R03 task.id ∈ `^T-PH\d{3}-\d{2}$`, Phase당 max 99개
- R04 test_case.id ∈ `^TC-REQ-[A-Z][A-Z0-9-]*-AC\d+-\d{2}$` — `--tdd-policy ≠ disabled` 시 ERROR. 예: `TC-REQ-KP-TEST-001-AC2-01`

### 8.3 출력 + exit code

JSON 보고서 `validator.json`. exit code: `0`=pass / `1`=warn-only / `2`=error.

---

## 9. plan.md 스키마

### 9.1 frontmatter

```yaml
---
run_id: 2026-05-18.skf.v01
target: skf-v0.1
plan_version: 0.1.0
plan_contract: "1.2.0"
generated_at: 2026-05-18T03:54:41Z
tool_versions:
  speckiwi: 2.2.3
  kiwi_planner: 0.6.0
  validator: 0.6.0
stability_summary:
  frozen: 0
  stable: 3
  evolving: 7
  draft: 0
tdd_policy: relaxed
sidecar_path: ./2026-05-18.skf.v01.sidecar.json
md_sha256: <자동 계산>
---
```

### 9.2 본문 구조 (heading level SSOT — §0.16)

```
## §1 개요                                  (h2)
### 1.1 목표                                (h3)
### 1.2 범위 (in_scope[])                   (h3)
### 1.3 제외사항 (out_of_scope[], excluded_reqs 포함)
### 1.4 전제조건 / 가정

## §2 Phase 목록                            (h2)
  표 (단일 표만 허용. 첫 두 행 = 헤더 + separator, 본문 행만 카운트):
  | phase_id | title | goal | depends_on | task_count |

## §3 Task 상세                             (h2)
### §3.<phase_id>                           (h3, 각 Phase 별 하위 섹션)
#### §3.<phase_id>.<task_id>                (h4, validator 가 정확 매칭)
    필드 형식 — 각 필드 1줄, key: value (canonical form):
    - id: T-PH001-01
    - phase_id: PH-001
    - title: <한 줄>
    - type: code|doc|file_op|issue|pr|perf_test|infra|review
    - req_ids: [FR-A, FR-B]            (정렬된 콤마+공백 구분 리스트)
    - files: [src/x.ts:45-67, docs/y.md]   (path:line_range, 정렬)
    - action: <자연어 + 코드 변경 시 시그니처>
    - acceptance_tests: <상세 하위 블록 또는 JSON inline>
    - verification_cmd: {posix: ..., windows: ...} 또는 null
    - dod: <체크리스트>
    - rollback: <한두 줄>
    - estimated_effort: S|M|L
    - depends_on_task: [T-PH001-01]    (선택, TDD 페어/순서 표현)
    - covers_ac: [AC-1, AC-2]          (선택, TDD 분해 시 페어 대상 AC)
    - tdd: {applicable, phase, test_cases_count, exempt_reason?}  (inline 요약 — 상세는 사이드카)

## §4 REQ ↔ Task 역색인                     (h2)

§4 REQ ↔ Task 역색인 표
  | req_id | stability | task_ids[] | ac_covered/ac_total |

§5 위험 · 미해결
  5.1 위험 (risk_id, severity, mitigation, affected_task_ids)
  5.2 Open Questions (id, question, blocks_task_ids)
  5.3 unreferenced_reqs (deprecated 외 미커버 REQ)
  5.4 deferred_ac (§0.G4 accept-as-deferred 결정 기록)
  5.5 TDD 결정 (§0.G7 accept-as-exempt 또는 add-test-task 결정 요약; user_decision_id + sidecar.tdd_decisions[] 참조)

§6 부록
  6.1 사이드카 JSON 경로 / md_sha256
  6.2 검증 스크립트 실행 방법
  6.3 mcp_call_log 요약 (호출 수 / mutation 수)
```

### 9.3 acceptance_tests 형식 매트릭스 (확장)

| task.type | 허용 kind (≥1 필수) |
|---|---|
| code | `shell`, `http`, `perf`, `checklist` (단순 주석/문서 코멘트만 변경 시) |
| doc | `checklist`, `file_state` |
| file_op | `file_state`, `shell` |
| issue | `checklist` (issue URL 포함 권장) |
| pr | `checklist` (PR URL + CI 통과 항목), `file_state` |
| perf_test | `perf`, `shell` |
| infra | `shell`, `file_state`, `http` (헬스체크) |
| review | `checklist` |

acceptance_tests 가 빈 배열이면 ERROR. 각 entry 는 `kind` 필드 필수.

### 9.4 canonical form (C08 hash 입력 SSOT)

Task md ↔ sidecar 비교 시 사용되는 직렬화 규칙:
- **입력 허용 형식 (md)**: `req_ids` 와 `files` 는 `[a, b, c]` (공백 포함 콤마 구분) 또는 `[a,b,c]` 둘 다 허용. md 작성자는 가독성을 위해 공백을 자유롭게 사용 가능.
- **canonical 정규화** (양쪽 동일 적용):
  - `title` = `trim()`
  - `type` = `toLowerCase()`
  - `req_ids` = `[...new Set(entries.map(s => s.trim()))]` → 알파벳 정렬 → `,` (공백 없음) join
  - `files` = 각 entry `{path}:{line_range}` 단일 문자열로 평탄화 (line_range 부재 시 path만), `[...new Set(...).map(trim)]` → 알파벳 정렬 → `,` join
  - **files 표기 SSOT**: sidecar 의 `{path, line_range}` 객체는 평탄화 시 `path:line_range` (line_range 부재 시 path 단독) 단일 형식
- **hash 입력** = `{task_id}|{title}|{type}|{req_ids_joined}|{files_joined}`
- **algorithm** = sha1 hex digest (소문자 40자)

md 와 sidecar 양쪽 모두 위 정규화로 동일 입력 생성 후 hash 비교. **공백·중복·순서 차이는 모두 같은 hash 생성**.

### 9.5 mcp_call_log `args` 직렬화 SSOT — sidecar plan 표현과 실 MCP 호출 schema 분리

**중요 — 두 가지 다른 표현이 존재한다**:

(가) **sidecar `mcp_call_log[].args`** — plan 단계 sidecar 내부 표현. `sidecar.tasks[].trace_links[]` 와 **동일한 nested schema** 사용 (validator C15 multiset 비교를 위한 의도된 dual representation). 호출 인자 원본이 아님.

(나) **실 MCP 호출 args** — kiwi-coder §6.2 가 mutation 시점에 speckiwi MCP 로 전달하는 인자. speckiwi MCP 실 schema 는 **flat** (`{id, type, reference, relation}`).

planner 본 스킬은 (가) 만 다룬다. (나) 평탄화는 kiwi-coder §6.2 의 책임.

**(가) sidecar mcp_call_log nested schema (validator C15 SSOT)**:

| call | nested args 필수 필드 | C15 multiset key |
|---|---|---|
| `add_trace_link` | `{ source: {type, id}, target: {type, reference}, relation }` | `{source.id}|{target.type}|{target.reference}` |
| `add_verification_evidence` | `{ id, type, reference }` (flat — verification_evidence 는 nested 가 아님) | `{id}` |

- `add_trace_link.source.id` = Task ID (sidecar.tasks[].id 와 동일). `target.type` ∈ {"Requirement", "Code", "Task", "Doc"}. `target.reference` = REQ id 또는 path:line_range.
- `add_verification_evidence` 는 verification 1건이 REQ 1개와 1:1 매핑되므로 sidecar 단에서도 flat 으로 충분.
- `add_trace_link` entry 는 `sidecar.tasks[].trace_links[]` 와 multiset (count 동일) 일치 필수 (C15).
- `add_verification_evidence` entry 의 `args.id` 집합 = `sidecar.coverage[].req_id` 집합 (uniq 후 동일) (C15).
- `args_hash` 는 멱등 dedupe 전용 보조 필드.

**(나) 실 MCP 호출 flat schema (kiwi-coder §6.2 가 평탄화 후 호출)**:

| call | flat args (speckiwi MCP 실 schema) |
|---|---|
| `add_trace_link` | `{ id, type, reference, relation }` (`notes` 선택) — `id` = REQ id, `type` = target type, `reference` = target reference |
| `add_verification_evidence` | `{ id, type, reference }` (`covers, notes` 선택) |
| `update_status` | `{ id, status }` |
| `add_completed_work` | `{ date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun] }` |

**sidecar nested ↔ 실 MCP flat 변환 매핑** (kiwi-coder §6.2 가 mutation 호출 시 적용):

| sidecar `mcp_call_log[].args` 또는 `tasks[].trace_links[i]` (nested) | 실 MCP `add_trace_link` args (flat) |
|---|---|
| `source: {type: "Task", id: "T-PHnnn-mm"}` | (메타. flat args 에는 직접 매핑되지 않음 — Task 단계 traceability 는 별도 add_trace_link 호출로 처리 가능) |
| `target: {type: "Requirement", reference: "REQ-X-001"}` | `id: "REQ-X-001"`, `type: <task type 또는 "Code">`, `reference: <task.files[].path:line_range 또는 source.id>` |
| `target: {type: "Code", reference: "src/x.ts:45-67"}` | `id: <task.req_ids 의 한 REQ>`, `type: "Code"`, `reference: "src/x.ts:45-67"` |
| `relation` | `relation` |

즉 sidecar 의 nested 표현은 plan 작성 / validator 검증 / 사람 가독성을 위한 SSOT 표현이고, 실 MCP 호출은 kiwi-coder 가 (나) flat schema 로 평탄화해 호출한다.

### 9.6 test_case id 정규식 SSOT (TDD)

`tasks[].tdd.test_cases[].id` 는 다음 패턴 (validator R04):

```
^TC-REQ-([A-Z][A-Z0-9-]*)-AC(\d+)-(\d{2})$
```

- prefix `TC-REQ-` 고정 (literal)
- **capture (1)** = REQ id 부분. task.req_ids 의 entry 와 정확히 일치해야 함 (C23 매칭 기준). 예: req_ids 가 `FR-KP-TEST-001` 이면 capture(1) = `FR-KP-TEST-001` → id 전체는 `TC-REQ-FR-KP-TEST-001-AC2-01`
- **capture (2)** = AC 번호 (1자리 이상)
- **capture (3)** = seq 2자리 zero-pad (정렬 안정성)

예: req_ids=[`FR-KP-TEST-001`] 일 때 → `TC-REQ-FR-KP-TEST-001-AC2-01`. cross-cutting (여러 AC 검증) 시 primary AC 를 id 에 박고 나머지는 `ac_refs[]` 에 추가 등재.

`test_case.id` 는 사이드카 전역에서 유일 (validator R04 + C25 보조).

---

## 10. 사이드카 JSON 스키마

```ts
interface PlanSidecar {
  schema_version: "1.0.0" | "1.1.0";    // 1.1.0 = TDD 필드 포함 (v0.6+). 매핑: 1.0.0 ⇔ plan_contract 1.1.0, 1.1.0 ⇔ plan_contract 1.2.0
  plan_contract: "1.1.0" | "1.2.0";     // 1.2.0 = TDD 필드 포함. dual-accept (§0.15)
  run_id: string;
  target: string;
  plan_version: string;
  generated_at: string;          // ISO-8601 UTC
  tool_versions: { speckiwi: string; kiwi_planner: string; validator: string; };
  tdd_policy?: "strict" | "relaxed" | "disabled";  // plan_contract=1.2.0 시 필수, 1.1.0 시 optional (default 'disabled')
  md_path: string;
  md_sha256: string;

  phases: Phase[];
  tasks: Task[];
  coverage: Coverage[];
  orphans: Orphan[];
  unreferenced_reqs: UnreferencedReq[];
  excluded_reqs: ExcludedReq[];   // deprecated / §0.G3 exclude-draft 기록
  deferred_ac: DeferredAc[];      // §0.G4 accept-as-deferred 기록
  risks: Risk[];
  open_questions: OpenQuestion[];
  external_module_impact: ExternalImpact[];  // §0.G2 기록
  tdd_decisions: TddDecision[];   // §0.G7 결정 기록 (v0.6+)
  coder_handoff_readiness: CoderHandoffReadiness[];  // /kiwi-coder 인계 신호 (v0.6+)
  mcp_call_log: McpCall[];
}

interface Phase { id: string; title: string; goal: string; depends_on: string[]; task_ids: string[]; }

type TaskType = "code"|"doc"|"file_op"|"issue"|"pr"|"perf_test"|"infra"|"review";

interface Task {
  id: string; phase_id: string; title: string; type: TaskType;
  req_ids: string[];
  files: Array<{ path: string; line_range?: string }>;
  action: string;
  acceptance_tests: AcTest[];
  verification_cmd: { posix: string; windows: string; cwd?: string } | null;
  dod: string[];
  rollback: string;
  trace_links: TraceLink[];
  estimated_effort?: "S"|"M"|"L";
  needs_clarification?: Array<{ slug: string; question: string; blocks_task: boolean;
                                auto_severity: "clarification"|"business-decision"|"rollback-confirmation" }>;
  // === v0.6+ TDD 필드 (additive) ===
  tdd?: TaskTdd;                  // tdd_policy=disabled 시 모든 type 에서 optional. tdd_policy ≠ disabled 시 type=code 는 필수 (C21 ERROR)
  test_files?: Array<{ path: string; line_range?: string }>;  // 테스트 파일 (impl files[] 와 분리)
  depends_on_task?: string[];     // Task ID 배열. 동일 phase 내 선후. §0.G8 / validator C24
  covers_ac?: string[];           // 이 Task 가 다루는 AC ID (TDD 페어 분해 시)
}

interface TaskTdd {
  applicable: boolean;            // false 이면 exempt_reason 필수 (validator C22)
  exempt_reason?: string;         // 자유 텍스트 ≥20자 (C22)
  phase: "red"|"green"|"refactor"|"n/a";
  test_cases: TestCase[];         // applicable=true 면 ≥1 (C21). 면제 시 []
  red_evidence?:   RedEvidence | null;   // planner 는 null slot 만 예약, /kiwi-coder 가 채움
  green_evidence?: GreenEvidence | null;
}

interface TestCase {
  id: string;                     // §9.6 정규식 SSOT: ^TC-REQ-...-AC\d+-\d{2}$
  req_id: string;                 // 이 case 의 primary REQ. task.req_ids 에 포함되어야 함 (C23 매칭 기준)
  ac_refs: string[];              // 이 case 가 검증하는 AC id (cross-cutting 허용 — 모두 req_id 의 ac_ids 에 속해야 함)
  test_file: string;              // path (test_files[] 와 일관)
  test_symbol?: string;           // function / describe 이름
  kind: "unit"|"integration"|"e2e"|"contract"|"property";
  expected_failure_signature?: string;  // red 단계 기대 실패 메시지 regex
}
interface RedEvidence   { command: string; exit_code: number; captured_failure: string; timestamp: string; }
interface GreenEvidence { command: string; exit_code: number; timestamp: string; }

interface TddDecision {
  task_id: string;
  decision: "add-test-task"|"accept-as-exempt"|"block";
  reason?: string;                // accept-as-exempt 시 ≥20자
  user_decision_id: string;       // AskUserQuestion 응답 식별자
  decided_at: string;             // ISO-8601
  spawned_test_task_id?: string;  // add-test-task 결정 시 생성된 T-test Task ID
}

interface CoderHandoffReadiness {
  phase_id: string;
  ready: boolean;                 // false 면 blockers[] 가 비어있지 않음
  blockers: string[];             // e.g. ["tdd_decision_pending:T-PH001-02", "tdd_test_cases_missing:T-PH001-03"]
}

type AcTest =
  | { kind: "shell";    cmd: string; expected_exit: number; stdout_regex?: string }
  | { kind: "checklist"; items: string[] }
  | { kind: "file_state"; path: string; exists: boolean; sha256?: string }
  | { kind: "http";      method: string; url: string; expected_status: number }
  | { kind: "perf";      metric: string; threshold: string; tool: string };

interface Coverage {
  req_id: string;            // unique key — coverage 배열에서 req_id 중복 금지
  stability: string;
  ac_total: number;
  ac_covered: number;
  missing_ac_ids: string[];
  covered_tasks: string[];
  // === v0.6+ ===
  ac_test_map?: Array<{      // AC ↔ test_case 매핑 (test_case-level 커버리지 SSOT, A12 검증 기반)
    ac_id: string;
    test_case_ids: string[]; // tasks[].tdd.test_cases[].id 참조. 0 개면 missing_ac_ids 에 포함되어야 함
  }>;
}

interface Orphan { task_id: string; reason: string; }
interface UnreferencedReq { req_id: string; stability: string; reason: string; }
interface ExcludedReq { req_id: string; stability: string; reason: string; }
interface DeferredAc { req_id: string; ac_id: string; reason: string; user_decision_id: string; }
interface Risk { id: string; severity: "low"|"med"|"high"|"critical";
                 description: string; mitigation: string; affected_task_ids: string[]; }
interface OpenQuestion { id: string; question: string; blocks_task_ids: string[]; }
interface ExternalImpact { path: string; source: "files"|"trace"|"code_context"; user_decision: string; }

interface TraceLink {
  link_id: string;           // required, unique across sidecar. validator C03 에서 누락·중복 모두 ERROR
  source: { type: "Task"; id: string };
  target: { type: "Requirement"|"Code"; reference: string };
  relation: string;
  trace_intent?: "verifies"|"addition_site"|"negative";
}

interface McpCall {
  seq: number;
  call: string;             // "add_trace_link"|"add_verification_evidence"|...
  args: object;             // sidecar 내부 nested schema (§9.5 (가)) — add_trace_link: {source:{type,id}, target:{type,reference}, relation, [notes]}, add_verification_evidence: {id, type, reference, [covers, notes]}. 실 MCP 호출 인자는 §9.5 (나) flat — kiwi-coder §6.2 가 평탄화.
  args_hash: string;        // sha1(call|canonicalJson(args)). 멱등 dedupe 용
  response_hash: string | null;
  timestamp: string;        // ISO-8601
  ok: boolean | null;       // dry-run 일 때 null
  dry_run?: boolean;        // dry-run 모드 entry 표시
}
```

---

## 11. 검증 항목 — §8.2 참조

(중복 회피, §8 에서 정의)

---

## 12. 개선 루프 분기 (통합표)

| 실패 분류 | 분기 | 비고 |
|---|---|---|
| 평가자 CRITICAL/HIGH (A1·A2·A3·A4·A5·A7) | 작성자 재호출 | 상한 3회 |
| 평가자 MEDIUM (A6·A8·A10) | 작성자 재호출 1회 후 사용자 confirm | |
| 평가자 LOW (A9) | 사이드카 기록 후 진행 | 보고에 잔존 표시 |
| validator C01-04, C06-09, C12-15 | 작성자 재호출 | 형식·동기화 오류 |
| validator C15 (mcp_call_log mismatch) | 작성자 재호출 + replay | 2회 잔존 시 §0.G5 발동 |
| validator C05 (req 미존재) | 평가자 재호출 | 사실 검증 필요 |
| validator C10 (orphan ≥3) | 평가자 재호출 | "정당성 있는가" 판단 |
| validator C11 (unreferenced ≥1, non-deprecated) | 평가자 재호출 | "의도적 제외인가" 판단 |
| **validator C21·C22·C23·C24 (TDD ERROR)** | 작성자 재호출 | A11·A12·A13 와 짝. 형식·schema 오류 |
| **validator R04 (test_case.id 형식)** | 작성자 재호출 | 정규식 위반 |
| **validator C25 (red→green 논리)** | strict=작성자 재호출 / relaxed=사이드카 기록 후 진행 | /kiwi-coder 단계에서 채워지므로 plan-time 에는 WARN |
| 동일 finding 2 라운드 연속 잔존 | 사용자 알림 (AskUserQuestion) | §0.G5 |

---

## 13. 다음 단계 결정표 (§12.3 패턴)

Phase 5 보고 시 plan 의 상태에 따라 도출. 자동 chain 호출 금지 — 사용자에게 권고만 표시. 권고 ≤6개, 우선순위 A 항목은 ⚠️ 마커.

| 우선 | 조건 | 권고 |
|---|---|---|
| A ⚠️ | CRITICAL/HIGH 잔존 | "계획 재검토 필요 — 결정적 결함 잔존" |
| A ⚠️ | validator exit=2 | "validator FAIL — 사이드카 정합성 회복 후 재실행" |
| A ⚠️ | unreferenced_reqs (non-deprecated) ≥1 | "REQ 누락 — 사용자 결정 또는 Phase 2 재spawn" |
| A ⚠️ | external_module_impact 미해결 | "외부 모듈 결정 대기" |
| A ⚠️ | A12 (test_ac_coverage) CRITICAL 잔존 | "test_case 가 frozen/stable AC 미커버 — Phase 2 재spawn 필수" |
| A ⚠️ | §0.G7 `block` 결정 잔존 (tdd_decisions) | "TDD 면제 결정 대기 — 사용자 응답 필요" |
| B | draft REQ 가 plan 에 포함됨 | "/kiwi-srs-feasibility 로 Stability 확정 권장 (해당 스킬이 `update_stability` 호출, 본 스킬은 권한 없음)" |
| B | feasibility_hint 가 `low|unknown` 인 REQ 존재 | "/kiwi-srs-feasibility --req-id ... 로 평가 권장. 모호 부분은 `/kiwi-srs-research --req-id ...` 선행 가능" |
| B | tdd_decisions[].decision == accept-as-exempt ≥1 | "면제 Task 존재 — /kiwi-coder 가 대체 검증증거(integration test / manual checklist) 작성 필요" |
| C | Stability=evolving REQ 의 plan 통과 | "/kiwi-coder 로 구현 진행 가능 (해당 스킬이 `update_status` 호출, red→green 증명도 coder 책임)" |
| C | Stability=stable + feasibility=high REQ | "/kiwi-coder 우선 대상" |
| C | open_questions ≥1 | "사용자 답변 후 Phase 2 재spawn" |
| C | deferred_ac ≥1 | "추후 라운드에서 미커버 AC 재검토" |
| C | A13 (tdd_exemption_justification) MEDIUM 잔존 | "면제 사유 약함 — /kiwi-coder 진입 전 보강 권장" |
| D | 위 모두 미해당 + LOW 잔존 | "계획 확정 — 구현 진행 가능. LOW 잔존은 보고 참조" |

---

## 14. axis enum — §6.3 참조

(중복 회피, §6 에서 정의)

---

## 15. 옵션 매핑 — §1.2 참조

(중복 회피, §1.2 에서 정의)

---

## 16. 보고 채널

### 16.1 1차: doculight

- `mcp__doculight__open_markdown` 으로 plan.md viewer 오픈
- 사용자 메시지에 viewer URL + 검증 요약 (3-5 라인)

### 16.2 fallback 순차

doculight MCP 부재 시:

| 우선 | 채널 | 동작 |
|---|---|---|
| 1 | doculight `update_markdown` (이미 열린 viewer 갱신) | 재오픈 대신 갱신 |
| 2 | telegram MCP (`send_telegram_markdown`) | plan.md 요약 + 경로 |
| 3 | google-chat (`send_google_chat_markdown`) | 동일 |
| 4 | path-only | 사용자 메시지에 plan.md 절대경로 + 검증 보고 경로 |

`--report-channel` 인자로 1차 채널 강제 가능.

### 16.3 보고 본문 항목

- run_id / target / plan_version
- phase 수 / task 수 / coverage% / orphan 수 / unreferenced 수
- validator exit code + 주요 findings 3건
- §13 다음 단계 권고 ≤6개

---

## 17. Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-planner"`
- `status`: plan 확정 + mutation 완료 = `TASK_DONE`; plan freeze (G5 발산) = `NEEDS_USER`; 실패 = `FAILED`; dry-run = `DRY_RUN`
- `next_hint`: 통상 `"kiwi-pm"` (plan 자동 실행 권장). plan 이 단일 Task 인 경우 `"kiwi-coder"` 직행 가능
- `req_ids`: plan 의 coverage[].req_id 합집합
- `artifacts.plan_file`: `docs/plans/{run-id}.plan.md`
- `artifacts.sidecar_file`: `docs/plans/{run-id}.sidecar.json`
- `artifacts.analysis_dir`: `docs/analysis/kiwi-planner-{run-id}/`
- `notes`: phase 수 / task 수 / coverage% / validator exit code 권장

emit 실패는 best-effort.
