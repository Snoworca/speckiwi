---
name: kiwi-coder
description: "kiwi-planner 산출물(plan_contract=1.2.0 + sidecar TDD)을 입력 SSOT 로 받아 Task 단위로 TDD 선행 → standard×4 병렬 TDD 검증 → high-reasoning 시니어 구현 → 정형 검사 → 까칠 리뷰 → 개선 루프 → 테스트 실행 → 회귀 검증 → speckiwi MCP mutation → .kiwi/ 상태 갱신을 자동화하는 코딩 스킬 v0.1. 재개 가능. 트리거: 계획대로 구현, kiwi 코딩, tdd 코딩, plan 구현, kiwi planner 산출물 구현. --auto 는 공용 auto-option 정책으로 메인 게이트와 후속 kiwi-review-fix-loop --close-reqs handoff를 자동화하되 --yes-all/--auto-integration/--auto-cost-warning은 자동 활성하지 않음. 검증(정형 검사·까칠 리뷰) 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 그 모델을 override 한다(TDD 검증 standard×4 불변)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-coder v0.1.9

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

## Official Workflow Tool Policy

For covered workflow artifact flows, use official SpecKiwi workflow tools before raw file reads or manual appends:

1. Resolve the next task and resume state through MCP `get_next_work_order`, `workflow_plan_task`, `workflow_next_plan_task`, `workflow_session_status`, `workflow_resume_hint`, `workflow_worklog_tail`, `workflow_doctor`, and `workflow_schema_check` before reading `docs/plans`, sidecars, `.kiwi/sessions`, worklogs, or pipeline JSONL directly.
2. Use guarded workflow mutations (`workflow_task_status_set` when PM state is in scope, `workflow_worklog_emit`, `workflow_pipeline_emit`, and `workflow_repair_record`) before shell JSONL append snippets for covered workflow journals.
3. Local coder state files remain runtime state, but any covered workflow projection or journal update must prefer the official reader/mutation envelope so diagnostics, hashes, stale guards, and owner metadata are preserved.
4. Raw file fallback is degraded mode. It is allowed only after capturing tool diagnostics, affected artifact paths, active target, and a follow-up requirement or candidate ID in `state.json`, the task report, or worklog.

`kiwi-planner` 가 만든 plan.md + sidecar.json (plan_contract=1.2.0, schema_version=1.1.0, tdd_policy∈{strict, relaxed}) 을 입력 SSOT 로 삼아, Task 단위로 TDD 를 먼저 작성·검증한 뒤 본 구현을 진행하는 코딩 자동화 스킬. snoworca-coder 의 Phase 루프 로직만 차용하되 plan-contract-v1 의존을 제거하고 speckiwi MCP / kiwi-planner sidecar 를 1급 시민으로 사용한다. **모든 작업 상태는 `cwd/.kiwi/` 에 영속화하여 새 세션에서 재개 가능**.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 강제**. 모든 코딩 Task 는 (1) 테스트 작성 → (2) standard×4 병렬 검증 → (3) red 실패 확인 → (4) 구현 → (5) green 확인 순서. 우회 금지 |
| §0.2 | **planner sidecar 의무 SSOT**. 입력 plan 의 `plan_contract` ∈ {"1.2.0"} 필수 (kiwi-planner §0.15 의 dual-accept `["1.1.0", "1.2.0"]` 중 본 스킬은 `1.2.0` 만 수용 — `1.1.0` 은 TDD 필드 부재로 §0.1 강제와 충돌). `schema_version` ∈ {"1.1.0"} 필수. `tdd_policy=disabled` 인 plan 은 즉시 거부. 거부 시 안내: "kiwi-planner --tdd-policy=relaxed\|strict 로 재실행하여 plan_contract=1.2.0 + schema_version=1.1.0 산출물을 생성하십시오" |
| §0.3 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부. `_shared/snoworca/` 모듈 로드도 금지 |
| §0.4 | **검증자는 별도 서브에이전트**. 인라인 자가검증 금지 (project verification rule) |
| §0.5 | **검증자 입력 격리**. 시니어 코더의 결론·정당화 전달 금지. 원본 plan + sidecar + 작성된 코드 + 테스트만 |
| §0.6 | **Mock 금지** (regex 자동 탐지). CRITICAL severity |
| §0.7 | **ZERO TOLERANCE 계획-코드 일치 게이트**. sidecar.tasks[].files[], action, dod 와 실제 변경이 불일치하면 CRITICAL |
| §0.8 | **사용자 확인 의무**. 외부 모듈 영향, plan 외 파일 변경, 통합 테스트 실행, MCP mutation 회수 ≥10건 batch 시 모두 Codex clarification gate |
| §0.9 | **외부 모듈 수정 금지**. cwd 외부 path 가 sidecar files[] 또는 실제 변경에 진입 시 즉시 중단 + Codex clarification gate (§0.G2) |
| §0.10 | **시그니처 금지** (project signature-ban instruction). 커밋 메시지·코드 주석·산출물 어디에도 AI 식별 정보 금지. `Co-Authored-By` 등 자동 추가 차단 |
| §0.11 | **`.kiwi/` 상태 영속**. 모든 단계 종료마다 `cwd/.kiwi/sessions/{run-id}/state.json` 갱신. Task 종료마다 `tasks/{task-id}.json` + `worklog.jsonl` append. checkpoint 의무 (§7) |
| §0.12 | **MCP mutation 4종 SSOT**. 허용 = `add_trace_link` (Code anchor) / `add_verification_evidence` (type=test) / `update_status` / `add_completed_work` 4종. mutation 호출 1건 = state.json `mcp_call_log[]` 1건 (멱등 dedupe: args_hash) |
| §0.13 | **회귀 테스트 의무**. Task 종료마다 (1) 영향받는 test 파일 실행 + (2) 전체 회귀 스위트 실행. `--skip-regression` 플래그 명시 시에만 (2) skip, (1) 은 항상 실행 |
| §0.14 | **id 정규식 SSOT** (kiwi-planner §0.14 와 동일). `run_id` = `[a-z0-9.-]{4,40}` (dot 허용 — planner run-id `{YYYY-MM-DD}.{project-slug}.{target-slug}` 호환), `phase_id` = `^PH-\d{3}$`, `task_id` = `^T-PH\d{3}-\d{2}$`. 입력 sidecar 가 위반하면 §0.G3 차단 |
| §0.15 | **plan-step ↔ task 1:1**. sidecar.tasks[] 가 곧 작업 단위. 메인이 임의로 task 분할/병합 금지 — 필요 시 `$kiwi-planner` 재호출 권고 |
| §0.16 | **검증 서브에이전트 모델 정책 SSOT**. 정형 검사·까칠 리뷰 등 검증 서브에이전트(verification subagent)는 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 검증 서브에이전트의 모델을 override 한다 (시니어 코더는 영향 없음). **TDD 검증 standard×4 (Phase 1.2) 는 모든 모드 공통 유지 (§0.1)** — 모델 불변. 심각도 게이트·회귀 테스트 의무는 불변 |
| §0.17 | **`@req` 태그 부착 (참고용 SSOT)**. 본 §0.17 은 글로벌 project editing guidance (Simplicity / Surgical Changes) 의 코멘트 보수성 가이드보다 본 skill 내부에서 **우선**한다. 세부 규약은 §0.17.1~§0.17.7. **본 태그는 순수 참고용** — speckiwi `add_trace_link` 가 SSOT, 태그는 rg/search 보조. REQ rename/deprecate 시 자동 갱신 의무 없음 (부패 허용). **운영 순서 SSOT** (시니어 코더 단계별): (1) §0.17.1 의무 범위 + §0.17.2 면제 enum 판정 → (2) 면제 시 worklog `req_tag_exempted` append + skip / 의무 시 다음 → (3) §0.17.5 lenient 정규식으로 기존 토큰 set 추출 + 새 토큰 dedupe 검사 → (4) 일치 시 skip / 미일치 시 §0.17.4 위치 결정 → (5) 위치 모호 시 worklog `req_tag_position_ambiguous` + 보류 / 결정 시 §0.17.3 wrapper-tolerant 정규식 형식으로 신규 라인 작성 |
| §0.17.1 | **의무 범위**. 코딩 Task (type ∈ {code, perf_test, infra}) 의 **구현 단계 (Phase 2.c) 에서 새로 정의되는 클래스/메서드/함수** 에 한해 부착 의무 (가시성 제한 없음 — public/private 무관). 함수 정의 = 명명 함수 (named function/method) + lambda/closure/arrow function (단, §0.17.2 enum (5) 의 private 1라인 lambda 는 면제). 부착 위치 = 정의 직전 라인 또는 docstring 첫 줄. **테스트 파일은 부착 의무 대상에서 제외** — 식별 SSOT: (a) sidecar.tdd.test_cases[].test_file 에 명시된 모든 파일, (b) 경로 정규식 `(^|/)(tests?|__tests__|spec|e2e|integration)(/|$)` 매칭 디렉토리 내 파일, (c) 파일명 정규식 `\.(test|spec)\.[a-zA-Z]+$` 매칭 파일. 통합 테스트 (§8.2 산출물) 도 본 면제에 포함. 테스트의 REQ 매핑은 `test_case.ac_refs` 가 SSOT. 비코딩 Task (type ∈ {doc, file_op, issue, pr, review}) 도 면제 |
| §0.17.2 | **면제 enum (closed-list, 시니어 재량 없음)**. 아래 8종만 면제: (1) 1라인 getter (`return this.x`), (2) 1라인 setter (`this.x = v`), (3) 언어 자동 생성 메서드 명시 (Java toString/hashCode/equals, JS Object.prototype.*, Python `__repr__`/`__eq__`/`__hash__`/`__init__` 자동 생성, Rust `#[derive(...)]` / procedural attribute macro `#[...]` (예: `#[tokio::main]`, `#[async_trait]`) / function-like macro `macro!(...)` (예: `lazy_static!{}`, `bitflags!{}`) 가 생성한 메서드, Go receiver method 자동 생성), (4) IDE 자동 생성 boilerplate constructor (필드 대입 (다중 가능) + `super(...)` 호출 + null-coalescing default 까지 허용. 비즈니스 로직·검증·side effect 가 1줄이라도 포함되면 부착 의무), (5) private 1라인 lambda/helper (가시성 무관 의무 §0.17.1 에 따라 lambda 도 의무 — 본 enum 항목으로만 면제), (6) 인터페이스/추상메서드 (구현 없음), (7) override 시 부모에 이미 `@req` 가 있고 **부모가 cwd 내부일 때만** (부모가 외부 라이브러리면 enum 7 미적용 = 부착 의무), (8) IDE/언어/매크로가 인간 작성 없이 자동 생성한 메서드 일반 (worklog 사유에 `reason_enum_id=8` + `raw_reason` 부가 **의무**). **결정 알고리즘**: enum (1)~(7) 매칭 패턴이 있으면 우선 분류 (raw_reason 불필요), enum (1)~(7) 어디에도 매칭 안 되는 자동 생성 메서드만 enum (8) 사용 — Rust derive 같이 enum (3) 명시 항목이 있는 경우는 항상 (3). **면제 적용 시 worklog `req_tag_exempted { task_id, member_path, reason_enum_id, raw_reason? (enum=8 필수, 그 외 생략) }` append 의무** (§7.3 enum 19). enum 외 사유로 면제 불가 |
| §0.17.3 | **형식·정규식 SSOT**. REQ-ID 토큰 형식 정규식: `[A-Z][A-Z0-9-]*[A-Z0-9]` (trailing hyphen 차단, 2자 이상). **단일 라인/wrapper-tolerant 정규식** (신규 부착 검증용 + §0.17.6 운영 면책용 공용, line-anchored, 부가 표기 흡수, **1라인 1 REQ-ID**): `^\s*([/*#]+\s*)?@req\s+[A-Z][A-Z0-9-]*[A-Z0-9](\s*\(.+?\))?\s*\*?/?\s*$`. 라인 시작 anchor `^` 강제 — 코드+태그 섞임 라인 (예: `let x=1; // @req X`) 매칭 차단. trailing 부가 표기 흡수 — `\s*\(.+?\)` non-greedy 라 공백 유무 무관 (`@req X (legacy)` / `@req X(legacy)` 둘 다 매칭). 다중 REQ → 라인 분리. 언어별 주석 스타일: TS/JS/Java/Go/Rust/C/C++ = `// @req X`, Python/Ruby/Shell = `# @req X`, JSDoc/JavaDoc multi-line = `* @req X` (단일 라인 `/** @req X @param y */` **금지**). **REQ-ID 토큰의 실재성 (speckiwi 조회) 은 본 skill 어디서도 검증하지 않음** (§0.17.6 면책). 형식적 무결성도 검증 안 함 — REQ-ID 형식은 speckiwi/kiwi-srs 가 보장하는 외부 책임. 형식 위반 토큰 (1자, trailing hyphen 등) 은 라인 정규식 매칭 실패로 자연 차단됨. dedupe 비교는 §0.17.5 의 lenient 정규식 사용 (별도 용도) |
| §0.17.4 | **append 위치 SSOT + docstring 정의**. docstring 정의 (언어별): Python `"""..."""` 또는 `'''...'''` triple-quoted / JSDoc·JavaDoc `/** ... */` block / Rust `///` line-doc + `/** */` block-doc / TS·C#·PHP `/** */`. **docstring 개념이 없는 언어 (Go·Bash 등) 는 항상 (b) 외부 분기 적용**. append 규칙: (a) 기존 `@req` 라인이 docstring 내부면 마지막 `@req` 라인 직하 (동일 docstring block 내부) 에 새 라인 추가. (b) 외부 (정의 직전 주석 블록) 면 외부의 마지막 `@req` 라인 직하. 기존 라인 사이 삽입·재배치·삭제 금지. 위치 모호 시 시니어는 추가 보류 + worklog `req_tag_position_ambiguous { task_id, member_path }` 기록 (§7.3 enum 20). 보류된 멤버는 §0.17.7 의 부착 누락 상태로 간주 — `req_tag_missing_observed` 도 함께 append 가능 (별도 정리 Task). **mixed-location 케이스** (한 멤버에 docstring 내부 + 외부 양쪽에 기존 `@req` 가 모두 존재) 는 docstring 내부를 우선 — Python·JSDoc 자연스러운 문서 통합 위치. 단 모호 시 보류로 fallback |
| §0.17.5 | **dedupe SSOT**. 기존 라인에서 REQ-ID 토큰을 추출할 때는 **lenient 정규식 (dedupe 전용)** `@req\s+([A-Z][A-Z0-9-]*[A-Z0-9])` (§0.17.3 와 동일 REQ-ID 형식, line-anchored 제거) 으로 lenient 검색. 부가 표기 (예: `@req FR-X-001 (legacy)` 의 `(legacy)`, 단일 라인 다중 태그 `/** @req X @param y */`) 가 붙은 비정상 라인에서도 토큰 추출. 추출된 모든 REQ-ID 토큰의 set 을 기존 부착 토큰 set 으로 간주. 새 토큰이 set 에 case-sensitive 일치 시 dedupe (추가 금지). **§0.17.3 wrapper-tolerant 정규식 (line-anchored, 부착 검증 + §0.17.6 면책 공용) 과 본 §0.17.5 lenient 정규식 (line-anchored 미적용, dedupe 전용) 은 별개 SSOT** — 두 정규식의 분리 사용으로 dedupe 의 부가 표기 흡수 (§0.17.5) 와 면책의 코드+태그 섞임 차단 (§0.17.3/§0.17.6) 동시 보장 |
| §0.17.6 | **포괄 면책 (검증 leak 차단) + 운영 알고리즘**. `@req` 태그는 본 skill 의 다음 모든 단계에서 점검·비교·검증·존재 여부 확인 대상이 **아니다**: §0.G1~§0.G5 게이트, §4.2 standard×4 TDD 검증, §5.1.(b) Mock 금지 regex 스캔, §5.1.(d) ZERO TOLERANCE 계획-코드 일치 게이트, §5.1.(e) 정형 검사, §5.1.(f) 까칠 리뷰, §5.1.(j) DoD 검증, §6.1 회귀 테스트, §6.2 MCP mutation, §8.2 통합 테스트 정형/까칠 리뷰. **§0.7 의 ZERO TOLERANCE 평가 알고리즘 SSOT**: diff hunk 의 added-only 라인 중 **§0.17.3 wrapper-tolerant 정규식** (line-anchored, 부가 표기 흡수) 매칭 라인만 변경 set 에서 제거 후 sidecar.action 외 변경 판정. 부가 표기 라인 (예: `@req FR-X-001 (legacy)`) 은 wrapper-tolerant 가 직접 흡수. **코드+태그 섞임 라인** (예: `let x=1; // @req X`, `const msg="@req X"`) 은 라인 시작 anchor `^` 와 주석 prefix 강제로 자동 차단 → 변경 set 에 포함 (false-negative 방지). §0.17.5 lenient 정규식은 본 면책에 사용하지 않음 — dedupe 전용. 어느 검증자도 `@req` 관련 finding 발행 금지 |
| §0.17.7 | **부착 누락의 처리**. 누락은 본 skill 의 어떤 게이트도 차단하지 않는다. 사후 보완은 별도 정리 Task 로 처리 (본 스킬 책임 외). 누락 발견 시 시니어 코더가 자기 점검으로 worklog `req_tag_missing_observed { task_id, member_path }` 정보성 append 가능 (severity 없음, §7.3 enum 21). 검증자는 본 이벤트 append 도 금지 (§0.17.6) |
| §0.18 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. `--auto` 는 메인 게이트 결정과 §8.4 후속 `$kiwi-review-fix-loop --close-reqs --auto` handoff 에만 적용한다. `--yes-all`, `--auto-integration`, `--auto-cost-warning` 은 사용자가 명시했을 때만 활성화된다. |
| §0.19 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §8.4 참고 | `--mini`/`--loops N` 는 kiwi-review-fix-loop follow-up 에 전파 (loop-option.md §6) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — TDD 우회 차단

| IF | THEN |
|---|---|
| 코딩 Task (type=code/perf_test/infra) 에 sidecar `tdd.applicable=false` + `exempt_reason` 부재 | 차단 + 사용자 보고 ("planner 가 면제 사유 없이 TDD 비적용으로 표시. kiwi-planner 재실행 필요") |
| 코딩 Task (type=code/perf_test/infra) 에 `tdd.applicable=false` + `exempt_reason` (≥20자, kiwi-planner C22 통과) | TDD skip 허용, `state.tdd_exempted_task_ids[]` 에 등재, worklog `tdd_exempted { reason }` |
| 비코딩 Task (type ∈ {doc, file_op, issue, pr, review}) 에 `tdd.applicable=false` (kiwi-planner C22 auto-exempt — `exempt_reason` 부재 허용) | TDD skip 허용, `state.tdd_exempted_task_ids[]` 에 등재, worklog `tdd_exempted { reason: "auto-exempt by type" }`, Phase 2 직행 |
| `tdd.applicable=true` + `test_cases[]` 빈 배열 | 차단 + 사용자 보고 |
| 시니어 코더가 테스트 작성 단계 skip 시도 | 차단 + Phase 1 재진입 강제 |
| standard×4 검증에서 1개라도 CRITICAL finding 잔존 | Phase 2 (구현) 진입 차단, Phase 1.3 개선 루프 |
| green 확인 실패 (구현 후에도 test 가 fail) | Phase 2.h 개선 루프 편입 (HIGH 카운터 소모) |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| sidecar task.files[] 에 cwd 외부 path | 즉시 중단 + Codex clarification gate 3옵션: (1) 진행 승인 / (2) 외부 path 제외 / (3) 작업장 이동 후 재실행 |
| 시니어 코더가 cwd 외부 파일 편집 시도 | 즉시 차단 + CRITICAL |
| 회귀 테스트가 cwd 외부 모듈 실패 | WARN 만, 차단 안 함 (외부 책임) |

#### §0.G3 — 입력 plan/sidecar 무결성

| IF | THEN |
|---|---|
| `plan_contract ≠ "1.2.0"` 또는 `schema_version ≠ "1.1.0"` | 거부 + kiwi-planner 재실행 권고 |
| `tdd_policy = "disabled"` | 거부 + 권고 |
| sidecar JSON parse 실패 | 거부 + validator 재실행 권고 (`node ../kiwi-planner/scripts/validator.mjs ...`) |
| sidecar.tasks[].id 또는 phases[].id 정규식 위반 | 거부 |
| plan.md.frontmatter.sidecar_path 와 실제 sidecar 경로 불일치 | WARN + 사이드카 경로 사용 |
| `validator.json` 존재 + `exit_code != 0` | WARN + 사용자에게 표시 후 진행 동의 |

#### §0.G4 — 개선 루프 발산

| IF | THEN |
|---|---|
| 시니어 코더 재호출 3회 누적 (단일 Task) | Codex clarification gate 4옵션 (§7.4) |
| standard TDD 검증자 재호출 3회 누적 + 동일 finding 잔존 | Codex clarification gate 4옵션 |
| 까칠 리뷰어 재호출 2회 누적 + 동일 finding 잔존 | Codex clarification gate 4옵션 |
| 회귀 테스트 2회 연속 동일 파일 fail | 즉시 사용자 에스컬레이션 + state.json `failed_task_ids[]` 등재 |

4옵션: `(1) draft-keep` / `(2) partial-commit` / `(3) force-proceed (사용자 책임)` / `(4) abandon-task` (Task 만 skip, plan 진행).

#### §0.G5 — MCP mutation 가드

| IF | THEN |
|---|---|
| `update_status` 호출이 REQ status 를 backward (verified → implemented 등) 전이 | 차단 + WARN |
| `add_completed_work` 호출 `summary` 가 일치 task 의 dod 와 불일치 | 차단 + 시니어에게 dod 재확인 요구 (summary 텍스트에 dod 항목 인코딩 필수, §6.2) |
| MCP 도구 미가용 (preflight 실패) | 정상 SRS reads/mutations 중단. CLI 는 설치/버전/설정 진단과 MCP 복구 안내에만 사용하고, mutation 대체 실행 금지. state.json `pending_mutations[]` 적재 + 사용자 보고 |
| 단일 Task 완료 시 mutation > 4건 시도 (4종 외 호출 또는 중복) | 차단 + 시니어 로직 재검토 |

#### §0.G6 — `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `external-module-impact` | cwd 외부 path 또는 plan 외 파일 변경 | §0.G2 |
| `tdd-bypass-attempt` | TDD 강제 원칙 우회 시도 | §0.G1 |
| `mcp-unavailable` | SpecKiwi MCP 부재. CLI 진단 가능 여부와 무관하게 정상 SRS mutation 대체 금지 | §0.G5 |
| `lifecycle-gate-draft` | draft REQ 구현은 명시적 사용자 override 필요; `--auto` 중단 | Phase 0 |
| `lifecycle-gate-deprecated-or-frozen` | deprecated/frozen REQ 구현은 정책상 중단 | Phase 0 |
| `integration-test-user-consent` | `--auto-integration` 없이 통합 테스트 실행 동의 필요 | §8.2 |
| `cost-warning-large-task` | 장시간/고비용 실행에 대한 별도 동의 필요 | §3.3 / §6.2 |
| `followup-review-fix-loop-close-unsafe` | 실패 task 또는 회귀 실패가 남아 `--close-reqs`가 부적합 | §8.4 |

---

## 1. 입력 / 출력

### 1.1 필수 입력

`PLAN_PATH` — kiwi-planner 산출물 plan.md 경로. 또는 `SIDECAR_PATH` 단독 (이 경우 plan.md 는 frontmatter.sidecar_path 의 inverse 로 추론).

부재 시 `docs/plans/*.plan.md` 의 가장 최신 generated_at 자동 채택. 후보 ≥2 시 Codex clarification gate.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "plan X로", "X 계획" | `PLAN_PATH` | 자동 |
| "TASK Y만" | `TASK_FILTER` (콤마, T-PH001-01,T-PH001-02) | 전체 |
| "Phase N부터" | `PHASE_FROM`, `PHASE_TO` | 전체 |
| "재개" | `--resume` | off (신규 run 또는 자동 감지) |
| "max 모드" | `--max` | off (Normal) |
| "리뷰어 off" | `--reviewer-off` | off (까칠 리뷰어 유지) |
| "회귀 skip" | `--skip-regression` | off (회귀 의무) |
| "자동 진행" | `--yes-all` | off |
| "통합 테스트 skip" | `--skip-integration` | off |
| "통합 테스트 자동 동의" | `--auto-integration` | off (사용자 동의 게이트 유지) |
| "비용 경고 자동 skip" | `--auto-cost-warning` | off |
| "자동", "auto", "묻지 말고" | `--auto` | off (`../_shared/kiwi/auto-option.md`; 기존 세부 자동 옵션은 자동 활성하지 않음) |
| "--model <name>", "검증 모델 지정", "다른 모델로 검증" | `--model <name>` | 현재 세션 모델 (정형 검사·까칠 리뷰 검증 서브에이전트에 적용) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |
| "dry-run" | `--dry-run` | off (MCP mutation 미실행) |

### 1.3 모드 매트릭스

| 모드 | 시니어 코더 | TDD 검증 (standard) | 정형 검사 (현재 세션 모델) | 까칠 리뷰어 (현재 세션 모델) | 비용 배수 |
|---|---|---|---|---|---|
| Normal (기본) | high-reasoning × 1 | × 4 (병렬) | × 1 | × 1 | 2.0~2.5× (snoworca-coder Normal 대비) |
| `--max` | high-reasoning × 3 | × 4 | × 1 | × 2 | 12~15× |
| `--reviewer-off` | high-reasoning × 1 | × 4 | × 1 | × 0 | 1.6× |

`--model <name>` 지정 시 정형 검사·까칠 리뷰 검증 서브에이전트의 모델을 override (기본은 현재 세션 모델; 시니어 코더·TDD 검증은 영향 없음).

TDD 검증 (standard×4) 는 **모든 모드 공통**. TDD 강제 원칙 (§0.1) 의 핵심 검증 채널이므로 모드 변경 영향 없음.

### 1.4 출력 (산출물)

- **코드 변경**: sidecar.tasks[].files[] 에 명시된 파일에 직접 작성. git commit 은 사용자 결정.
- **`.kiwi/` 상태 트리** (§7):
  ```
  cwd/.kiwi/
  ├── config/
  │   └── enabled                          # opt-out 마커 없으면 항상 활성
  ├── sessions/
  │   └── {run-id}/
  │       ├── state.json                   # 전체 진행 상태 SSOT
  │       ├── worklog.jsonl                # 이벤트 시계열
  │       ├── tasks/
  │       │   └── {task-id}.json           # task별 TDD/구현/검증 상세
  │       └── reports/
  │           └── coder-{run-id}.md        # 최종 완료 보고서
  └── logs/
      └── append-errors.log
  ```
- **분석 로그**: `docs/analysis/kiwi-coder-{run-id}/`
  - `tdd_review_iter{N}.json` (standard×4 결과 통합)
  - `formal_review_iter{N}.json` (현재 세션 모델 정형)
  - `prickly_review_iter{N}.json` (현재 세션 모델 까칠)
  - `mcp_call_log.jsonl`
  - `regression_run.jsonl`
  - `rejected_findings.log`

**Run-id**: kiwi-planner 의 run-id 와 동일하게 채택 (재실행 가능). 신규 시 `{plan.run_id}.coder-{ISO-date-short}` (예: `2026-05-19.skf.v01.coder-0519`).

### 1.5 `--dry-run`

- MCP mutation 실행 안 함. state.json `mcp_call_log[]` 에 `dry_run: true` entry.
- 코드 변경 / 테스트 실행은 정상 수행 (회귀 검증 가능).
- 보고서에 `mode: "dry-run"` 명시.

---

## 2. Phase 흐름

```
Phase 0 : Bootstrap (preflight, plan/sidecar 로드, .kiwi init/resume, target 확인)
Phase 1 : Task 진입 + TDD 작성·검증
  1.1 : 시니어 코더가 sidecar.tdd.test_cases[] 기반으로 테스트 파일 작성
  1.2 : standard×4 병렬 검증 (4축, §4.2)
  1.3 : 개선 루프 (CRITICAL/HIGH 잔존 시 1.1 재진입)
  1.4 : red 확인 (테스트 실행 → 의도된 fail + expected_failure_signature 정합)
  1.5 : sidecar.tdd.red_evidence 채움
Phase 2 : 구현 (snoworca-coder 차용)
  2.a : 선행 의존 task 완료 확인 (depends_on_task[])
  2.b : Mock 금지 regex 스캔
  2.c : 시니어 코더 구현
  2.d : 계획-코드 일치 게이트 (sidecar.files[], action, dod 정합)
  2.e : 정형 검사 (현재 세션 모델×1, 4축)
  2.f : 까칠 리뷰 (현재 세션 모델×1/2, 7축)
  2.g : 개선 루프 (심각도 카운터)
  2.h : 테스트 실행 + green 확인
  2.i : sidecar.tdd.green_evidence 채움 + DoD 검증
Phase 3 : Task 종료 처리
  3.1 : 회귀 테스트 (영향받는 + 전체 스위트)
  3.2 : MCP mutation 4종 batch
  3.3 : .kiwi state.json + tasks/{task-id}.json + worklog 갱신
Phase 4 : 모든 Task 완료 후 (선택) 통합 테스트 + 최종 보고서
```

---

## 3. Phase 0 — Bootstrap

### 3.0 preflight

판정 순서:
1. MCP `get_active_target` 성공 → PASS
2. MCP 실패 → HALT. CLI `speckiwi --version` 은 설치/버전 진단과 MCP 복구 안내에만 사용하고 PASS 대체 조건으로 삼지 않는다.

`.kiwi/sessions/{run-id}/preflight.json` 기록: `{mcp, cli, halted, node_version, git_repo}`.

### 3.0.1 lifecycle gate

sidecar 의 모든 `traces[].req_id` 를 수집한 뒤 MCP `list_requirements` 로 Stability 를 확인한다.

- `evolving` / `stable`: 진행 가능.
- `draft`: 중단하고 사용자에게 명시적 override 를 요청한다. `--auto` 에서는 항상 HALT.
- `deprecated` / `frozen`: 즉시 HALT.
- MCP 미가용: 정상 SRS read 가 불가능하므로 HALT. CLI 는 진단/복구 안내에만 사용한다.

### 3.1 plan/sidecar 로드

1. `PLAN_PATH` 인자 우선. 부재 시 `docs/plans/*.plan.md` 의 최신 `generated_at` 자동 채택.
2. plan.md frontmatter 파싱: `run_id`, `target`, `plan_contract`, `schema_version`, `sidecar_path`, `tool_versions`, `stability_summary`, `md_sha256`.
3. sidecar JSON 파싱: `phases[]`, `tasks[]`, `coverage[]`, `mcp_call_log[]` (planner 가 남긴), `tdd_policy`, `tdd_exemptions[]`.
4. 무결성 게이트 (§0.G3):
   - plan_contract ∈ {"1.2.0"} → 위반 시 거부
   - schema_version ∈ {"1.1.0"} → 위반 시 거부
   - tdd_policy ∈ {"strict", "relaxed"} → "disabled" 거부
   - md_sha256 재계산 일치 → 불일치 시 WARN
   - validator.json 존재 시 `exit_code` 확인, ≠0 이면 사용자 동의 게이트
5. `target` 으로 speckiwi `get_active_target` 결과와 비교. 불일치 시 Codex clarification gate ("plan 의 target {plan.target} 이 활성 target 과 다릅니다. set_active_target 후 진행하시겠습니까?")

### 3.2 .kiwi init / resume

```
.kiwi/sessions/{run-id}/state.json 존재?
  YES → --resume 플래그 또는 자동 감지:
        1. state.json 의 `frozen_at` 있으면 read-only 안내만
        2. `current_task_id` 가 있고 status="in_progress" → 해당 task 의 마지막 next_resume_hint 단계부터 재개
        3. 완료된 task_ids 는 skip
  NO  → 신규 init: state.json 작성 (§7.1 스키마)
```

### 3.3 Task 실행 큐 구축

1. sidecar.phases[] 를 `depends_on[]` 위상 정렬
2. 각 phase 내 task 를 `depends_on_task[]` 위상 정렬
3. `TASK_FILTER` / `PHASE_FROM` / `PHASE_TO` 적용 후 큐 생성
4. 완료된 task (state.completed_task_ids[]) 제외
5. 빈 큐 → "모든 task 가 이미 완료되었습니다. Phase 4 (통합 테스트) 로 진행할까요?" Codex clarification gate

### 3.4 사용자 비용 안내

- Normal: 1회 안내 (`--auto-cost-warning`/`--yes-all` skip 가능)
- `--max`: 2단계 경고 + 추정 토큰
- 거부 시 .kiwi state 보존 후 종료

---

## 4. Phase 1 — TDD 작성·검증

### 4.1 Task 진입 + 테스트 작성

**4.1.1 task 선택**: queue 의 head pop → state.current_task_id 갱신 + worklog append `task_start`.

**4.1.2 TDD 적용성 확인**:
- sidecar.tasks[t].tdd.applicable 확인
- `false` + `exempt_reason` 있음 + task.type ∈ {doc, file_op, issue, pr, review} → TDD skip, Phase 2 로 직행 + worklog `tdd_exempted`
- `false` + `exempt_reason` 부재 + task.type ∈ {code, perf_test, infra} → §0.G1 차단
- `true` + `test_cases[]` 비어있음 → §0.G1 차단
- `true` + `test_cases[]` ≥1 → 4.1.3 진행

**4.1.3 시니어 코더 (high-reasoning×1) 테스트 작성**:

입력:
- sidecar.tasks[t] 전체 (id, title, type, req_ids, files, action, acceptance_tests, dod, rollback, tdd)
- 관련 REQ 본문 (MCP `get_requirement` 결과, AC 포함)
- 기존 code 컨텍스트 (sidecar.tasks[t].files[].path 의 현재 파일 내용)
- 프로젝트 테스트 컨벤션 (cwd 의 test 디렉토리 구조 + 기존 테스트 1~2개 샘플)

산출:
- 각 `tdd.test_cases[].test_file` 에 테스트 코드 작성
- `tdd.test_cases[].test_symbol` 이 정의되어 있으면 그 심볼로 정확히 작성
- `expected_failure_signature` 가 있으면 그 에러 메시지를 출력할 assertion 작성

분석 로그: `docs/analysis/kiwi-coder-{run-id}/tdd_draft_T-PHnnn-mm.txt`

### 4.2 standard×4 병렬 TDD 검증 (4축)

**모든 모드 공통**. standard 4 인스턴스를 사용 가능한 서브에이전트 위임 도구로 병렬 실행한다. 각 검증자는 시니어의 rationale 미수신 (§0.5).

**`@req` 태그 검증 금지 (§0.17.6 포괄 면책)**: S1~S4 어느 검증자도 코드 주석의 `@req` 라인 존재 여부·정확성·REQ-ID 실재성을 검증/비교하지 않는다. 태그는 참고용이며 검증 축에 포함되지 않는다.

| 검증자 | 모델 | 검증 축 | 출력 finding 형식 |
|---|---|---|---|
| **S1** intent-alignment | standard | 계획 의도/AC ↔ test 의미 일치 (test 가 정말 해당 AC 를 검증하는가, mock/회피 없는가, ac_refs 가 정확한가) | `{ severity, axis: "intent-alignment", evidence: {file, line}, suggestion }` |
| **S2** technical-quality | standard | TDD 코드 기술 품질 (네이밍, 결정성, flaky 위험, assertion 적절성, isolation, fixture) | `{ severity, axis: "tech-quality", ... }` |
| **S3** req-mapping | standard | test_case.req_id / ac_refs 와 실제 코드의 매핑 정확성 (req_id ∈ task.req_ids, ac_refs ⊆ REQ.ac_total, test_case.id 정규식 SSOT 준수) | `{ severity, axis: "req-mapping", ... }` |
| **S4** red-verification | standard | 작성된 테스트를 실제 실행 → fail 발생 여부 + expected_failure_signature 정합. **테스트 실행은 검증자가 직접 수행** (verification_cmd 또는 추론된 명령) | `{ severity, axis: "red-verification", expected_signature, actual_signature, exit_code, suggestion }` |

**severity 정의**:
- **CRITICAL**: 의도 위배 (S1), Mock 사용 (S2), req_id 위반 (S3), red 미발생 (S4)
- **HIGH**: 모호한 assertion (S2), ac_refs 누락 (S3), expected_failure_signature 불일치 (S4)
- **MEDIUM**: 네이밍 / fixture 개선 (S2)
- **LOW**: 스타일 (S2)

### 4.3 개선 루프 (CRITICAL=0 + HIGH=0 까지)

```
Round 1 결과 분석
  ├─ CRITICAL=0 + HIGH=0 → §4.4 진행
  ├─ CRITICAL≥1 or HIGH≥1 → 시니어 코더 재호출 (findings 전달, 단 검증자의 결론·근거 raw text 그대로 전달)
  └─ standard 재호출 3회 누적 → §0.G4 발동
```

루프 상한:
- 시니어 코더 재호출 **3회**
- standard 재호출 **3회**
- 초과 시 §0.G4 4옵션 Codex clarification gate

### 4.4 red 확정 + sidecar.tdd.red_evidence 채움

`tdd.red_evidence` 슬롯 채움 (planner §10 `RedEvidence` 인터페이스 SSOT 준수: `command` / `exit_code` / `captured_failure` / `timestamp` 4필드만 사용):
```json
{
  "command": "npm test -- --testPathPattern=src/__tests__/x.test.ts",
  "exit_code": 1,
  "captured_failure": "FAIL src/__tests__/x.test.ts > should reject invalid input\n  Expected: throw 'InvalidInputError'\n  Received: nothing was thrown",
  "timestamp": "2026-05-19T03:54:41Z"
}
```

planner 스키마 외 부가 정보 (matched_signatures, test_case_ids[], stderr 별도 분리 등) 는 sidecar 가 아니라 `.kiwi/sessions/{run-id}/tasks/{task-id}.json` 의 `phase1.red_evidence_meta` 필드에 별도 저장 (sidecar 스키마 오염 방지).

sidecar 파일을 직접 `apply_patch` manual edit. mcp_call_log 와 무관 (sidecar 의 tdd 필드는 speckiwi 도구로 mutate 하지 않음 — planner 황금률 §0.G1 의 mutation 대상 아님).

worklog append `tdd_red_confirmed { task_id, exit_code, test_case_ids[] }`.

state.json `tdd_pending_task_ids` 에서 제거, `current_task_id` 는 유지 (Phase 2 진입).

---

## 5. Phase 2 — 구현 루프 (snoworca-coder 차용)

### 5.1 단계 흐름

```
Phase 2 진입 (current_task_id 유지)
  ├─ (a) 선행 의존 확인
  │       ├─ sidecar.tasks[t].depends_on_task[] 모두 state.completed_task_ids[] 에 포함?
  │       └─ 미충족 시 차단 + 사용자 알림 (큐 정렬 버그 가능성)
  ├─ (b) Mock 금지 regex 스캔 (사전 — 시니어 호출 전 코드베이스 현황 파악)
  ├─ (c) 시니어 코더 구현 (high-reasoning×1 or ×3)
  │       └─ 입력: sidecar.tasks[t], 작성된 test 파일, plan.md task 섹션, 관련 REQ
  │       └─ 산출: sidecar.tasks[t].files[] 에 명시된 path 만 편집
  │       └─ **@req 태그 부착** (§0.17 SSOT 7-clause): §0.17.1 의무 범위 (테스트 파일·비코딩 Task 제외) / §0.17.2 면제 enum (closed-list, 현재 8종) + worklog 기록 / §0.17.3 1라인 1 REQ-ID 형식 + line-anchored 정규식 / §0.17.4 append 위치 결정성 / §0.17.5 dedupe 알고리즘 (lenient 정규식으로 토큰 추출 비교) / §0.17.6 포괄 면책 (모든 게이트 점검 제외) / §0.17.7 누락 무차단 — 시니어 코더는 본 7-clause 를 그대로 따른다. **검증/리뷰/회귀 단계 어디에서도 비교 금지** (§0.17.6)
  ├─ (d) 계획-코드 일치 게이트 (ZERO TOLERANCE)
  │       ├─ 실제 변경된 파일 set ⊆ sidecar.tasks[t].files[] (cwd 한정)
  │       ├─ action 명세에 기술된 시그니처 / 함수가 실제 존재
  │       ├─ dod 의 각 항목이 점검 가능한 형태로 코드에 반영
  │       ├─ **`@req` 주석 추가는 본 게이트 평가에서 제외** (§0.17.6) — 태그 추가/append 라인은 sidecar.action 외 변경 판정 시 변경 set 에서 제거 후 비교
  │       └─ 위반 시 CRITICAL + (c) 재호출
  ├─ (e) 정형 검사 (현재 세션 모델×1; --model 로 override)
  │       └─ 검증 축 4개: Mock regex, 타입/빌드, 계획-코드 매핑 재확인, 테스트 커버리지
  │       └─ CRITICAL 발견 시 (g) 직행 (까칠 skip)
  ├─ (f) 까칠 리뷰 (현재 세션 모델×1, --max 시 ×2, --reviewer-off 시 skip; --model 로 override)
  │       └─ 검증 축 7개 (§5.2)
  ├─ (g) 개선 루프 (심각도별 독립 카운터)
  │       ├─ CRITICAL ≤ 3
  │       ├─ HIGH ≤ 3
  │       ├─ MEDIUM ≤ 2
  │       ├─ LOW ≤ 1 (정보만)
  │       └─ 초과 시 §0.G4 발동
  ├─ (h) 테스트 실행 (green 확인)
  │       ├─ Phase 1.4 의 red cmd 동일하게 실행
  │       ├─ exit_code=0 + 작성한 test_case 들이 모두 pass → green
  │       ├─ 미통과 시 (g) HIGH 카운터 +1, (c) 재호출
  │       └─ acceptance_tests[] (sidecar) 도 함께 실행
  ├─ (i) sidecar.tdd.green_evidence 채움 (planner §10 `GreenEvidence` 인터페이스 SSOT: `command` / `exit_code` / `timestamp` 3필드만)
  │       └─ sidecar: { command: "npm test ...", exit_code: 0, timestamp: "ISO-8601" }
  │       └─ 부가 정보 (passed_test_case_ids[], stdout_excerpt) 는 `.kiwi/.../tasks/{task-id}.json` 의 `phase2.green_evidence_meta` 에 별도 저장
  └─ (j) DoD 검증 (sidecar.tasks[t].dod 의 각 항목을 코드/테스트로 자가증명. **`@req` 태그 부착 여부는 본 DoD 검증 대상이 아님** — §0.17.6)
```

### 5.2 까칠 리뷰 7축 (snoworca-coder §6.2 동일 — 입증된 SSOT)

| # | 축 | 확인 항목 |
|---|---|---|
| 1 | 의도 보존 | sidecar.task.action / dod / 관련 REQ AC 대비 구현 일치 |
| 2 | 보안 위험 | OWASP Top 10, 입력 검증, 인증/권한, 비밀 노출 |
| 3 | 엣지 케이스 | null/empty, 경계값, 동시 접근, 순서 의존 |
| 4 | 동시성 | race condition, deadlock, 비원자 연산 |
| 5 | 리팩토링 여지 | 중복, 과도 추상화, 네이밍, 함수 크기 |
| 6 | 에러 처리 | 예외 전파, 사용자 피드백, 로깅 충분성 |
| 7 | 테스트 품질 | 작성된 test 의 의미성, flaky 위험 (Phase 1 검증과 별개로 구현 후 재확인) |

**`@req` 태그 검증 금지 (§0.17.6 포괄 면책)**: 정형 검사 (현재 세션 모델×1) 와 까칠 리뷰 (현재 세션 모델×1/2) 모두 코드 주석의 `@req` 라인에 대해 다음 행위를 금지한다 — (a) 존재 여부 점검, (b) task.req_ids 와 비교, (c) REQ-ID 실재성 검증 (speckiwi 조회), (d) 라인 누락을 finding 으로 발행. 본 태그는 정보용 breadcrumb 이며 어떤 게이트에도 영향 주지 않는다.

### 5.3 심각도 정의 (구현 단계)

- **CRITICAL**: Mock 사용, 계획-코드 매핑 누락, 빌드/타입 실패, 보안 중대, green 미달성
- **HIGH**: 테스트 fail, DoD 미충족, 의도 이탈, acceptance_tests fail
- **MEDIUM**: 경계 조건 누락, 리팩토링 미흡, 에러 처리 불충분
- **LOW**: 스타일, 주석

Phase 2 통과 조건: **CRITICAL=0 + HIGH=0 + green 확정**.

### 5.4 시니어 코더 입력 (재호출 시 포함)

- 1차 호출: sidecar.tasks[t], 작성된 test 파일, plan.md 섹션, 관련 REQ
- 재호출: 위 + 이전 findings (검증자 raw output) + 누적 시도 횟수

검증자의 결론은 raw 로 전달하되, 시니어 자신의 이전 시도 내용은 **재호출 시 제거** (편향 차단). 시니어는 매번 처음 보는 것처럼 접근.

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
task finalization, MCP mutation batch, .kiwi state schemas, integration testing, examples, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
