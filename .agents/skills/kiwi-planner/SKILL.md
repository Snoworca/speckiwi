---
name: kiwi-planner
description: "target 활성 REQ 전수(deprecated 제외)에 대해 Phase-Task 구조의 구현 계획을 수립. 코딩뿐 아니라 문서 수정, 파일 이동, 이슈/PR, 성능 테스트, 인프라 변경, 리뷰 등 비-코딩 Task도 포함. plan.md + 사이드카 JSON 양면 SSOT. speckiwi MCP add_trace_link / add_verification_evidence 로 plan-step ↔ REQ 그래프 영속화. 3 standard 사전조사 병렬 + high-reasoning 시니어 작성자 + 현재 세션 모델을 상속하는 단일 SRS 만족도 검증 서브에이전트 + validator.mjs 무결성 검증 + 개선-검증 루프. 트리거 — kiwi planner, 계획 수립, 구현 계획, plan 작성, kiwi plan, 계획 작성, 작업 분해, 작업 계획, task 분해, 구현 절차, REQ 구현 계획, target 구현 계획, srs 구현 계획, 계획 검증, plan validate, plan 사이드카, requirement to plan, implement plan. --auto 는 공용 auto-option 정책으로 비critical 사용자 게이트를 결정한다. 평가·검증은 현재 세션 모델을 상속하는 단일 검증 서브에이전트로 수행하며 `--model <name>` 로 override 한다(게이트·validator.mjs·TDD 강제 불변)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-planner v0.6

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

## Official Workflow Tool Policy

For covered workflow artifact flows, use official SpecKiwi workflow tools before raw file reads or manual appends:

1. Read workspace and artifact state through MCP `workflow_workspace_info`, `workflow_artifacts_list`, `workflow_plan_status`, `workflow_next_plan_task`, `workflow_doctor`, `workflow_schema_check`, and `get_next_work_order` before scanning `docs/plans`, `.kiwi`, `.snoworca`, or `kiwi/pipeline.jsonl` directly.
2. Use guarded workflow mutations (`workflow_pipeline_emit`, `workflow_worklog_emit`, `workflow_repair_record`, and plan-task/checklist mutations when applicable) before shell JSONL append snippets or direct plan checkbox edits.
3. Use CLI `speckiwi workflow ... --json` only as diagnostic/remediation fallback when MCP workflow tools are unavailable; CLI is not a normal replacement for MCP SRS mutations.
4. Raw file fallback is degraded mode. It is allowed only after capturing tool diagnostics, affected artifact paths, active target, and a follow-up requirement or candidate ID in the report/worklog.

Target-9 planner-document workflow tools, grouped by SRS operation category. This mapping is a SUPERSET that KEEPS every tool listed above and get_next_work_order, and ADDS the five previously missing target tools (`workflow_plan_task`, `workflow_diff`, `workflow_task_check`, `workflow_task_uncheck`, `workflow_checklist_set`):

- Reading (읽기/조회) plan state: `workflow_plan_status`, `workflow_plan_task`, `workflow_next_plan_task`.
- Validating (검증/진단) plan integrity: `workflow_doctor`, `workflow_schema_check`, `workflow_diff`.
- Mutating (변경/체크박스) plan checkboxes and checklists: `workflow_task_check`, `workflow_task_uncheck`, `workflow_checklist_set`.

Raw docs/plans file access stays a degraded fallback only, on the same conditions as item 4. §8 validator.mjs is superseded-but-coverage-preserved (all C01–C25 plan-contract checks retained; count not decreased).

target 활성 REQ 전수를 Phase>Task 구조로 분해해 **plan.md + 사이드카 JSON** 두 산출물 SSOT 로 영속화하는 계획 수립 스킬. 코딩·문서·파일 이동·이슈/PR·성능 테스트·인프라·리뷰 등 비-코딩 Task 도 1급으로 다룬다.

**규칙 진술 원칙**: 본 문서의 모든 규칙은 현재 적용되는 동작만 declarative 하게 기술한다. 연혁/정정은 git history 로 추적한다 (본문에 변경 이력 섹션 없음).

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 별도 서브에이전트**. 인라인 자가검증 금지 |
| §0.2 | **검증자 입력 격리**. Phase 2 작성자의 결론·정당화 전달 금지. 원본 REQ + plan.md + 사이드카 JSON + 필터링된 컨텍스트만 |
| §0.3 | **코드 증거 우선**. Task 의 `files[]` 는 실재 파일·라인 범위 (Phase 1 code-context 결과 기반). 추정 시 `[INFERRED:level]` 라벨 |
| §0.4 | **할루시네이션 금지**. 존재하지 않는 함수·파일·CVE·테스트 항목 추가 금지. 사실 위조 거절 + `rejected_findings.log` |
| §0.5 | **speckiwi MCP 우선 + 황금률**. mutation 도구 (`add_trace_link` / `add_verification_evidence`) 호출 1회 = 사이드카 `mcp_call_log[]` 1회 = Markdown 자동 line-patch 1회. mutation 후 동일 SRS 파일 `apply_patch` manual edit 금지 (§0.G1) |
| §0.6 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.7 | **사용자 확인 의무**. scope 모호, draft REQ 포함 여부, frozen AC 누락, 외부 모듈 영향 — 모두 Codex clarification gate 단일 호출 분해 |
| §0.8 | **외부 모듈 수정 금지**. cwd 외부 path 가 Task `files[]` 에 진입 시 즉시 중단 + Codex clarification gate (§0.G2) |
| §0.9 | **dual-mode 미채택**. standalone 단일 모드. 미래 호출자 시나리오 발생 시 §0.G6 신설 후 도입 |
| §0.10 | **AC 단위 커버리지**. plan 의 Task 합집합이 target 전체 REQ 의 AC 합집합을 cover. 미커버 AC 가 frozen/stable REQ 에 잔존 시 차단 |
| §0.11 | **plan-step ↔ REQ 양방향 trace + 호출 순서 SSOT** (실 MCP 호출 = flat, sidecar mcp_call_log = nested — §9.5 (가)/(나) SSOT). (1) Phase 5 단계 1: 모든 Task 에 대해 실 MCP `add_trace_link` 호출 = flat args `{id: REQ-ID, type: "Task", reference: "T-PHnnn-mm", relation: "depends_on"}` → (2) 단계 2: coverage 의 각 REQ 에 대해 실 MCP `add_verification_evidence({id: REQ-ID, type: "plan", reference: "{plan_path}#T-PHnnn-mm"})` 일괄 호출. **각 호출은 사이드카 `mcp_call_log[]` 에 §9.5 (가) nested schema 로 기록** (`add_trace_link` 은 `{source:{type,id}, target:{type,reference}, relation}` nested, `add_verification_evidence` 는 `{id, type, reference}` flat — validator C15 검증 기반). 즉 실 MCP 호출 args 와 sidecar mcp_call_log args 는 추상 계층이 다르며 (전자=flat, add_trace_link 의 후자=nested), kiwi-coder §6.2 가 mutation 시점에 평탄화 책임을 가진다. `args_hash = sha1(call \| canonicalJson(args))` 는 멱등성 dedupe 보조 필드. 동일 `args_hash` 재호출 시 mcp_call_log 추가 entry 금지. 단계 1 중 부분 실패 → 단계 2 진입 차단 + 사용자 보고. |
| §0.12 | **`Stability` 진입 가드**. `Stability=deprecated` REQ 는 자동 제외. `Stability=draft` REQ 는 Codex clarification gate 후에만 진입 (§0.G3 4옵션) |
| §0.13 | **Status·Stability·target_goal 무수정 원칙**. planner 는 `update_status` / `update_stability` / `set_target_goal` / `append_section_note` 모두 호출하지 않는다. 허용 mutation = `add_trace_link` / `add_verification_evidence` 두 종만. Research 축 mutation 도 금지 (read-only `get_requirement` / `list_requirements` / `summarize_target` / `get_active_target` 만 허용) |
| §0.14 | **id 정규식 + max 제약 SSOT**. `phase.id` = `^PH-\d{3}$` (최대 999), `task.id` = `^T-PH\d{3}-\d{2}$` (Phase당 최대 99). `run_id` = `[a-z0-9.-]{4,40}` (dot 허용 — §1.3 형식 `{YYYY-MM-DD}.{project-slug}.{target-slug}` 호환). **초과 시 hard ERROR** — Phase당 Task 99 초과 시 Phase 분할 의무, Phase 999 초과 시 본 스킬 차단 + 사용자에게 target 분할 권고 |
| §0.15 | **plan_contract enum SSOT**. plan.md frontmatter 와 사이드카 `plan_contract` 의 허용 값 = `["1.1.0", "1.2.0"]` (dual-accept). 신규 plan 은 `1.2.0` 권장 (TDD 필드 포함). validator 가 enum 외 값은 ERROR. v0.7 에서 `1.1.0` deprecate 예정 |
| §0.16 | **plan.md heading level SSOT**. `§N` 헤딩 = `## §N ...` (h2). `§3.<phase_id>` = `### §3.<phase_id> ...` (h3). `§3.<phase_id>.<task_id>` = `#### §3.<phase_id>.<task_id> ...` (h4). h5 이하 금지. validator 는 h4 정확 매칭으로 task 카운트 |
| §0.17 | **TDD 원칙 SSOT**. 전역 AGENTS.md TDD 의무를 plan-time 에 강제. `type=code` Task 는 (a) `tdd.applicable=true` + `tdd.phase∈{red,green,refactor}` + `tdd.test_cases≥1` 이거나 (b) `tdd.applicable=false` + `tdd.phase="n/a"` + `tdd.exempt_reason` (≥20자) 둘 중 하나. `tdd.phase="n/a"` 는 `applicable=false` 일 때만 허용. AC 단위 페어 분해 권장 — 동일 `covers_ac` 의 red Task 와 green Task 는 **분리된 별개 Task** 여야 한다 (단일 Task 에서 red+green 동시 수행 금지 — TDD 의 시간적 분리 강제). 동일 AC 페어의 순서는 Task-level `depends_on_task[]` 로 명시. `red_evidence`/`green_evidence` 는 planner 가 `null` slot 만 예약 — 실제 채움은 $kiwi-coder 책임 (§0.13 mutation 권한과 충돌 없음). `--tdd-policy` 가 `disabled` 면 본 §0.17 게이트·평가축·validator 검사 전부 skip. `tdd_policy ≠ disabled` 시 `type=code` Task 의 `tdd` 필드는 **필수** (누락 시 validator C21 ERROR) |
| §0.18 | **검증 서브에이전트 모델 정책 SSOT**. SRS 만족도 평가·검증은 **단일(single) 검증 서브에이전트(verification subagent)**로 수행하며 기본적으로 **현재 세션 모델(current session model)**을 상속한다 (기존 high-reasoning×1+standard×1 이중 모델 평가자 패널을 대체). `--model <name>` (또는 사용자가 지명한 모델) 로 이 검증 서브에이전트의 모델을 override 한다. 검증 서브에이전트 구성 외 심각도 게이트·라운드 상한·validator.mjs 검사·TDD 강제(§0.17)는 불변 |
| §0.19 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. scope ambiguity, deferred coverage, force-proceed, strict TDD block, and external path gates are governed by §0.G9 critical_gates[]. |
| §0.20 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — 황금률 (mutation ↔ manual edit via apply_patch)

| IF | THEN | 위반 severity |
|---|---|---|
| `add_trace_link` / `add_verification_evidence` 호출 | 사이드카 `mcp_call_log[]` 자동 entry 1건 + speckiwi 내부 Markdown line-patch | — |
| mutation 호출 후 동일 `docs/spec/*.srs.md` 에 `apply_patch` manual edit 사용 | 차단 + 작성자 재spawn | **CRITICAL** (axis A1) |
| plan.md 자체 갱신 (`apply_patch` manual edit 또는 `UTF-8 file write`) | 허용 (plan.md 는 speckiwi mutation 대상이 아님) | — |
| 사이드카 JSON 수동 `apply_patch` manual edit (mcp_call_log 외 필드) | 허용 단, validator 재실행 필수 | — |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| Task `files[]` 에 cwd 외부 path 진입 | 즉시 중단 + Codex clarification gate 3옵션 |
| Phase 1 code-context analyst 가 외부 경로 보고 | 즉시 중단 + Codex clarification gate |
| REQ `trace[].reference` 가 외부 path 만 가리킴 | 해당 REQ 를 `unreferenced_reqs` 로 분리 + Codex clarification gate |

3옵션: `(1) 진행 승인` / `(2) 외부 path 제외 후 cwd 한정` / `(3) 작업 중단 후 외부 작업장 재실행`. 사이드카 `external_module_impact` 에 기록.

#### §0.G3 — draft REQ 진입

| IF | THEN |
|---|---|
| target REQ 중 `Stability=draft` 가 존재 + `--draft-policy=prompt` (기본) | Codex clarification gate 단일 호출 4옵션 |
| `--draft-policy=include-all` | 게이트 skip, draft 포함, plan 진행 |
| `--draft-policy=exclude-draft` | 게이트 skip, draft 제외, `excluded_reqs[]` 기록 |
| `--draft-policy=feasibility-first` | 게이트 skip, 차단 + `$kiwi-srs-feasibility` 선행 권고 후 종료 |
| `--draft-policy=block-all` | 게이트 skip, 즉시 작업 중단 |
| Codex clarification gate 응답 `include-all` | draft 포함, 전체 plan 작성 |
| Codex clarification gate 응답 `exclude-draft` | draft 제외 후 plan 작성, 사이드카 `excluded_reqs[]` 기록 |
| Codex clarification gate 응답 `feasibility-first` | 차단 + `$kiwi-srs-feasibility` 선행 권고 후 종료 |
| Codex clarification gate 응답 `block-all` | 작업 중단 |

`--draft-policy` enum SSOT: `prompt|include-all|exclude-draft|feasibility-first|block-all` 5종. `prompt` 외에는 게이트 자체를 우회.

#### §0.G4 — frozen/stable AC 미커버

| IF | THEN |
|---|---|
| coverage 결과 `Stability∈{frozen, stable}` REQ 에 `missing_ac_ids` ≥ 1 | Codex clarification gate 3옵션 |
| `add-tasks` | Phase 2 재spawn → 누락 AC 대응 Task 추가 |
| `accept-as-deferred` | 사이드카 `deferred_ac[]` 기록 + plan §5.2 Open Questions 등재 |
| `block` | mutation 호출 0건; 사용자 결정 대기 |

#### §0.G5 — 개선 루프 발산 감지

| IF | THEN |
|---|---|
| 작성자 재호출 3회 누적 | Codex clarification gate 4옵션 (아래) |
| 평가자 재호출 2회 누적 + 동일 finding 잔존 | Codex clarification gate 4옵션 + 잔존 finding 사용자 보고 |
| validator C15 (mcp_call_log mismatch) 가 2라운드 연속 잔존 | 즉시 사용자 알림 + plan freeze (아래 정의) |

Codex clarification gate 4옵션:
- `(1) draft-keep` — plan.md / 사이드카 draft 만 보존, mutation 0건 실행, 보고에 "발산" 표기
- `(2) partial-commit` — 통과 finding 까지의 plan 부분 commit + 잔존 finding 을 사이드카 `deferred_ac[]` / `open_questions[]` 에 기록 후 mutation 실행
- `(3) force-proceed` — 사용자가 책임 표명. 전체 plan commit + mutation 전수 실행. 보고에 `forced: true`
- `(4) abandon` — plan.md / 사이드카 삭제 또는 outputs/abandoned/ 로 이동, mutation 0건

**plan freeze** 정의: plan.md + 사이드카 + validator.json 을 `outputs/frozen/{run-id}/` 로 이동, frontmatter 에 `frozen_at: ISO-8601` 마커 부착. 이후 동일 run-id 호출 시 read-only 안내만 출력.

#### §0.G6 — Scope boundary (task.req_ids ⊄ target)

| IF | THEN |
|---|---|
| 평가자 또는 validator 가 `task.req_ids` 중 target REQ 외 ID 검출 | Codex clarification gate 3옵션 |
| `(1) expand-scope` | 사용자가 해당 REQ 를 target 에 포함 결정. planner 재실행 (TARGET 갱신 후) |
| `(2) drop-task-link` | Task 의 해당 req_id 만 제거 + `unreferenced_reqs` 에 기록 |
| `(3) block` | mutation 0건; 사용자 결정 대기 |

#### §0.G7 — TDD 면제 결정 (--tdd-policy ≠ disabled 시 활성)

**트리거**: `task.type === "code"` 이고 (`task.tdd.applicable === false` OR `task.tdd.test_cases.length === 0` OR `task.tdd` 미정의).

| IF (--tdd-policy=strict) | THEN |
|---|---|
| 위 트리거 발동 | Codex clarification gate 2옵션 (`accept-as-exempt` 비활성) |
| `(1) add-test-task` | Phase 2 재spawn — 해당 code task 앞단에 T-test (`tdd.phase=red`) Task 추가 + `depends_on_task` 연결 |
| `(2) block` | mutation 0건; 사용자 결정 대기 |

| IF (--tdd-policy=relaxed, 기본) | THEN |
|---|---|
| 위 트리거 발동 | Codex clarification gate 3옵션 |
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

#### §0.G9 — `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `external-module-impact` | cwd 외부 path 가 Task files[] 또는 trace 에 진입 | §0.G2 |
| `deferred-coverage-frozen-stable` | frozen/stable AC 미커버를 자동 defer 할 수 없음 | §0.G4 |
| `force-proceed-after-divergence` | 발산 후 force-proceed 는 사용자 책임 | §0.G5 |
| `scope-expansion-target-boundary` | target 외 REQ 포함/확장은 범위 변경 | §0.G6 |
| `strict-tdd-block` | strict TDD 정책 위반은 자동 면제 불가 | §0.G7 |

---

## 1. 입력 / 출력

### 1.1 필수 입력

- (없음) `get_active_target` 으로 자동 추출. 활성 target 부재 시 Codex clarification gate.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "target v0.X", "릴리즈 X" | `TARGET` | `get_active_target` |
| "REQ FR-X, FR-Y만" | `REQ_FILTER` (콤마 분리) | 전체 |
| "draft 포함", "draft만 제외" | `--draft-policy=prompt\|include-all\|exclude-draft\|feasibility-first\|block-all` | `prompt` (§0.G3) |
| "코드 경로 X" | `CODE_PATH` | cwd |
| "--max", "정밀 평가" | `--max` | off |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (단일 검증 서브에이전트) |
| "--auto", "자동", "묻지 말고" | `--auto` | off (`../_shared/kiwi/auto-option.md`) |
| "--dry-run", "테스트 실행" | `--dry-run` | off |
| "--report-channel telegram\|google-chat\|doculight" | `--report-channel` | `doculight` |
| "--sync-retry-delay-ms N" | `--sync-retry-delay-ms` | 200 |
| "TDD 엄격", "면제 불허", "TDD 완화", "TDD off" | `--tdd-policy=strict\|relaxed\|disabled` | `relaxed` (§0.17, §0.G7) |
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

---

## 2. Phase 흐름

```
Phase 0  : Bootstrap (preflight, TARGET 확인, list_requirements, Stability 분류)
Phase 1  : Pre-investigation (standard × 3 병렬: intent / code-context / srs-mapping)
Phase 2  : Plan drafting (high-reasoning 시니어 — Phase>Task 분해, plan.md + 사이드카 동시 작성)
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
2. MCP 실패 → **HALT** + 설치 가이드 출력 (kiwi-srs §3.0 메시지와 동일 양식). CLI `speckiwi --version` 은 진단/복구 안내에만 사용하고 PASS 대체 조건으로 삼지 않는다.

기록: `preflight.json: { mcp, cli, halted }`.

### 3.1 TARGET 확정

1. `TARGET` 인자 → 최우선
2. `get_active_target` → 활성 채택
3. MCP 로 target 을 확인할 수 없으면 Codex clarification gate 로 명시 target 재실행을 요청하거나 MCP 복구 후 재시도한다. CLI target 조회는 진단 출력에만 사용한다.

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
| `target_total = 0` | HALT + "target 에 REQ 가 없습니다. $kiwi-srs 로 먼저 작성하십시오." |
| `filtered = 0` (target_total > 0) | HALT + "필터 결과 0건. REQ_FILTER 또는 --draft-policy 확인 권장." |
| `filtered ≥ 1` | Phase 1 진행 |

---

## 4. Phase 1 — Pre-investigation (standard × 3, 병렬, 격리)

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

## 5. Phase 2 — Plan drafting (high-reasoning 시니어)

### 5.1 시니어 입력

- target goal · `intent.json` · `code_context.json` · `srs_mapping.json`
- 작성 규약: §0 전체 + §9 plan.md 스키마 + §10 사이드카 스키마
- 시니어는 **plan.md 와 사이드카 JSON 을 동시에 생성** (Phase>Task 구조 일관성 보장)

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

- `docs/plans/{run-id}.plan.md` (UTF-8 file write)
- `docs/plans/{run-id}.sidecar.json` (UTF-8 file write, `mcp_call_log` 는 빈 배열로 초기화)
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
| A1 | golden_rule | §0.G1 황금률 — mutation 후 manual edit via apply_patch 흔적 |
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
| `business-decision` | 즉시 Codex clarification gate. 답변 없으면 plan 진행 차단 |
| `rollback-confirmation` | 사용자 알림 (`--auto` 모드에서는 자동 승인). 답변 후 진행 |

`blocks_task: true` 인 entry 가 1건이라도 미해결이면 해당 Task 는 사이드카 `open_questions[]` 로 이동 + plan §5.2 등재.

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
validator execution, plan.md schema, sidecar schema, reporting, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
