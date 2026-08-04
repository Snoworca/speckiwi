---
name: kiwi-coder
description: "OpenCode/Hermes local-LLM variant for executing kiwi-planner tasks with TDD and SpecKiwi traceability. Requires speckiwi mcp for normal SRS updates. Defaults to --max with one delegated worker/evaluator at a time and three clean evaluations before moving on. Triggers: kiwi coder, plan implementation, TDD coding."
---

# kiwi-coder v0.1.9

> etc local-LLM profile: read ../_shared/kiwi/local-llm-profile.md before executing. It requires working speckiwi mcp, treats --max as the default, disables multi-worker fanout, uses one delegated worker/evaluator at a time, and advances only after three consecutive no-improvement evaluations.

**etc override:** If any legacy section below appears to allow CLI mutation fallback or direct normal SRS Markdown mutation, the shared etc local-LLM profile wins: normal SRS operations require `speckiwi mcp`; CLI is diagnostic/remediation only.

> User clarification gate means: ask the user directly in Default mode; use `direct user prompt` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `local-LLM max-profile`, `local evaluator`, and `local evaluator` map to the current host agent model and effort options available in the session.
> `--auto` policy: read `../_shared/kiwi/auto-option.md` when `--auto` is active. The `critical_gates[]` below always halt for user input.

`kiwi-planner` 가 만든 plan.md + sidecar.json (plan_contract=1.2.0, schema_version=1.1.0, tdd_policy∈{strict, relaxed}) 을 입력 SSOT 로 삼아, Task 단위로 TDD 를 먼저 작성·검증한 뒤 본 구현을 진행하는 코딩 자동화 스킬. snoworca-coder 의 Phase 루프 로직만 차용하되 plan-contract-v1 의존을 제거하고 speckiwi MCP / kiwi-planner sidecar 를 1급 시민으로 사용한다. **모든 작업 상태는 `cwd/.kiwi/` 에 영속화하여 새 세션에서 재개 가능**.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 강제**. 모든 코딩 Task 는 (1) 테스트 작성 → (2) local evaluator×1 순차 단일 검증 → (3) red 실패 확인 → (4) 구현 → (5) green 확인 순서. 우회 금지 |
| §0.2 | **planner sidecar 의무 SSOT**. 입력 plan 의 `plan_contract` ∈ {"1.2.0"} 필수 (kiwi-planner §0.15 의 dual-accept `["1.1.0", "1.2.0"]` 중 본 스킬은 `1.2.0` 만 수용 — `1.1.0` 은 TDD 필드 부재로 §0.1 강제와 충돌). `schema_version` ∈ {"1.1.0"} 필수. `tdd_policy=disabled` 인 plan 은 즉시 거부. 거부 시 안내: "kiwi-planner --tdd-policy=relaxed\|strict 로 재실행하여 plan_contract=1.2.0 + schema_version=1.1.0 산출물을 생성하십시오" |
| §0.3 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부. `_shared/snoworca/` 모듈 로드도 금지 |
| §0.4 | **검증자는 별도 위임 worker**. 인라인 자가검증 금지 (project verification rule) |
| §0.5 | **검증자 입력 격리**. 시니어 코더의 결론·정당화 전달 금지. 원본 plan + sidecar + 작성된 코드 + 테스트만 |
| §0.6 | **Mock 금지** (regex 자동 탐지). CRITICAL severity |
| §0.7 | **ZERO TOLERANCE 계획-코드 일치 게이트**. sidecar.tasks[].files[], action, dod 와 실제 변경이 불일치하면 CRITICAL |
| §0.8 | **사용자 확인 의무**. 외부 모듈 영향, plan 외 파일 변경, 통합 테스트 실행, MCP mutation 회수 ≥10건 batch 시 모두 User clarification gate |
| §0.9 | **외부 모듈 수정 금지**. cwd 외부 path 가 sidecar files[] 또는 실제 변경에 진입 시 즉시 중단 + User clarification gate (§0.G2) |
| §0.10 | **시그니처 금지** (project signature-ban instruction). 커밋 메시지·코드 주석·산출물 어디에도 AI 식별 정보 금지. `Co-Authored-By` 등 자동 추가 차단 |
| §0.11 | **`.kiwi/` 상태 영속**. 모든 단계 종료마다 `cwd/.kiwi/sessions/{run-id}/state.json` 갱신. Task 종료마다 `tasks/{task-id}.json` + `worklog.jsonl` append. checkpoint 의무 (§7) |
| §0.12 | **MCP mutation 4종 SSOT**. 허용 = `add_trace_link` (Code anchor) / `add_verification_evidence` (type=test) / `update_status` / `add_completed_work` 4종. mutation 호출 1건 = state.json `mcp_call_log[]` 1건 (멱등 dedupe: args_hash) |
| §0.13 | **회귀 테스트 의무**. Task 종료마다 (1) 영향받는 test 파일 실행 + (2) 전체 회귀 스위트 실행. `--skip-regression` 플래그 명시 시에만 (2) skip, (1) 은 항상 실행 |
| §0.14 | **id 정규식 SSOT** (kiwi-planner §0.14 와 동일). `run_id` = `[a-z0-9.-]{4,40}` (dot 허용 — planner run-id `{YYYY-MM-DD}.{project-slug}.{target-slug}` 호환), `phase_id` = `^PH-\d{3}$`, `task_id` = `^T-PH\d{3}-\d{2}$`. 입력 sidecar 가 위반하면 §0.G3 차단 |
| §0.15 | **plan-step ↔ task 1:1**. sidecar.tasks[] 가 곧 작업 단위. 메인이 임의로 task 분할/병합 금지 — 필요 시 `$kiwi-planner` 재호출 권고 |
| §0.17 | **`@req` 태그 부착 (참고용 SSOT)**. 본 §0.17 은 글로벌 project editing guidance (Simplicity / Surgical Changes) 의 코멘트 보수성 가이드보다 본 skill 내부에서 **우선**한다. 세부 규약은 §0.17.1~§0.17.7. **본 태그는 순수 참고용** — speckiwi `add_trace_link` 가 SSOT, 태그는 rg/search 보조. REQ rename/deprecate 시 자동 갱신 의무 없음 (부패 허용). **운영 순서 SSOT** (시니어 코더 단계별): (1) §0.17.1 의무 범위 + §0.17.2 면제 enum 판정 → (2) 면제 시 worklog `req_tag_exempted` append + skip / 의무 시 다음 → (3) §0.17.5 lenient 정규식으로 기존 토큰 set 추출 + 새 토큰 dedupe 검사 → (4) 일치 시 skip / 미일치 시 §0.17.4 위치 결정 → (5) 위치 모호 시 worklog `req_tag_position_ambiguous` + 보류 / 결정 시 §0.17.3 wrapper-tolerant 정규식 형식으로 신규 라인 작성 |
| §0.17.1 | **의무 범위**. 코딩 Task (type ∈ {code, perf_test, infra}) 의 **구현 단계 (Phase 2.c) 에서 새로 정의되는 클래스/메서드/함수** 에 한해 부착 의무 (가시성 제한 없음 — public/private 무관). 함수 정의 = 명명 함수 (named function/method) + lambda/closure/arrow function (단, §0.17.2 enum (5) 의 private 1라인 lambda 는 면제). 부착 위치 = 정의 직전 라인 또는 docstring 첫 줄. **테스트 파일은 부착 의무 대상에서 제외** — 식별 SSOT: (a) sidecar.tdd.test_cases[].test_file 에 명시된 모든 파일, (b) 경로 정규식 `(^|/)(tests?|__tests__|spec|e2e|integration)(/|$)` 매칭 디렉토리 내 파일, (c) 파일명 정규식 `\.(test|spec)\.[a-zA-Z]+$` 매칭 파일. 통합 테스트 (§8.2 산출물) 도 본 면제에 포함. 테스트의 REQ 매핑은 `test_case.ac_refs` 가 SSOT. 비코딩 Task (type ∈ {doc, file_op, issue, pr, review}) 도 면제 |
| §0.17.2 | **면제 enum (closed-list, 시니어 재량 없음)**. 아래 8종만 면제: (1) 1라인 getter (`return this.x`), (2) 1라인 setter (`this.x = v`), (3) 언어 자동 생성 메서드 명시 (Java toString/hashCode/equals, JS Object.prototype.*, Python `__repr__`/`__eq__`/`__hash__`/`__init__` 자동 생성, Rust `#[derive(...)]` / procedural attribute macro `#[...]` (예: `#[tokio::main]`, `#[async_trait]`) / function-like macro `macro!(...)` (예: `lazy_static!{}`, `bitflags!{}`) 가 생성한 메서드, Go receiver method 자동 생성), (4) IDE 자동 생성 boilerplate constructor (필드 대입 (다중 가능) + `super(...)` 호출 + null-coalescing default 까지 허용. 비즈니스 로직·검증·side effect 가 1줄이라도 포함되면 부착 의무), (5) private 1라인 lambda/helper (가시성 무관 의무 §0.17.1 에 따라 lambda 도 의무 — 본 enum 항목으로만 면제), (6) 인터페이스/추상메서드 (구현 없음), (7) override 시 부모에 이미 `@req` 가 있고 **부모가 cwd 내부일 때만** (부모가 외부 라이브러리면 enum 7 미적용 = 부착 의무), (8) IDE/언어/매크로가 인간 작성 없이 자동 생성한 메서드 일반 (worklog 사유에 `reason_enum_id=8` + `raw_reason` 부가 **의무**). **결정 알고리즘**: enum (1)~(7) 매칭 패턴이 있으면 우선 분류 (raw_reason 불필요), enum (1)~(7) 어디에도 매칭 안 되는 자동 생성 메서드만 enum (8) 사용 — Rust derive 같이 enum (3) 명시 항목이 있는 경우는 항상 (3). **면제 적용 시 worklog `req_tag_exempted { task_id, member_path, reason_enum_id, raw_reason? (enum=8 필수, 그 외 생략) }` append 의무** (§7.3 enum 19). enum 외 사유로 면제 불가 |
| §0.17.3 | **형식·정규식 SSOT**. REQ-ID 토큰 형식 정규식: `[A-Z][A-Z0-9-]*[A-Z0-9]` (trailing hyphen 차단, 2자 이상). **단일 라인/wrapper-tolerant 정규식** (신규 부착 검증용 + §0.17.6 운영 면책용 공용, line-anchored, 부가 표기 흡수, **1라인 1 REQ-ID**): `^\s*([/*#]+\s*)?@req\s+[A-Z][A-Z0-9-]*[A-Z0-9](\s*\(.+?\))?\s*\*?/?\s*$`. 라인 시작 anchor `^` 강제 — 코드+태그 섞임 라인 (예: `let x=1; // @req X`) 매칭 차단. trailing 부가 표기 흡수 — `\s*\(.+?\)` non-greedy 라 공백 유무 무관 (`@req X (legacy)` / `@req X(legacy)` 둘 다 매칭). 다중 REQ → 라인 분리. 언어별 주석 스타일: TS/JS/Java/Go/Rust/C/C++ = `// @req X`, Python/Ruby/Shell = `# @req X`, JSDoc/JavaDoc multi-line = `* @req X` (단일 라인 `/** @req X @param y */` **금지**). **REQ-ID 토큰의 실재성 (speckiwi 조회) 은 본 skill 어디서도 검증하지 않음** (§0.17.6 면책). 형식적 무결성도 검증 안 함 — REQ-ID 형식은 speckiwi/kiwi-srs 가 보장하는 외부 책임. 형식 위반 토큰 (1자, trailing hyphen 등) 은 라인 정규식 매칭 실패로 자연 차단됨. dedupe 비교는 §0.17.5 의 lenient 정규식 사용 (별도 용도) |
| §0.17.4 | **append 위치 SSOT + docstring 정의**. docstring 정의 (언어별): Python `"""..."""` 또는 `'''...'''` triple-quoted / JSDoc·JavaDoc `/** ... */` block / Rust `///` line-doc + `/** */` block-doc / TS·C#·PHP `/** */`. **docstring 개념이 없는 언어 (Go·Bash 등) 는 항상 (b) 외부 분기 적용**. append 규칙: (a) 기존 `@req` 라인이 docstring 내부면 마지막 `@req` 라인 직하 (동일 docstring block 내부) 에 새 라인 추가. (b) 외부 (정의 직전 주석 블록) 면 외부의 마지막 `@req` 라인 직하. 기존 라인 사이 삽입·재배치·삭제 금지. 위치 모호 시 시니어는 추가 보류 + worklog `req_tag_position_ambiguous { task_id, member_path }` 기록 (§7.3 enum 20). 보류된 멤버는 §0.17.7 의 부착 누락 상태로 간주 — `req_tag_missing_observed` 도 함께 append 가능 (별도 정리 Task). **mixed-location 케이스** (한 멤버에 docstring 내부 + 외부 양쪽에 기존 `@req` 가 모두 존재) 는 docstring 내부를 우선 — Python·JSDoc 자연스러운 문서 통합 위치. 단 모호 시 보류로 fallback |
| §0.17.5 | **dedupe SSOT**. 기존 라인에서 REQ-ID 토큰을 추출할 때는 **lenient 정규식 (dedupe 전용)** `@req\s+([A-Z][A-Z0-9-]*[A-Z0-9])` (§0.17.3 와 동일 REQ-ID 형식, line-anchored 제거) 으로 lenient 검색. 부가 표기 (예: `@req FR-X-001 (legacy)` 의 `(legacy)`, 단일 라인 다중 태그 `/** @req X @param y */`) 가 붙은 비정상 라인에서도 토큰 추출. 추출된 모든 REQ-ID 토큰의 set 을 기존 부착 토큰 set 으로 간주. 새 토큰이 set 에 case-sensitive 일치 시 dedupe (추가 금지). **§0.17.3 wrapper-tolerant 정규식 (line-anchored, 부착 검증 + §0.17.6 면책 공용) 과 본 §0.17.5 lenient 정규식 (line-anchored 미적용, dedupe 전용) 은 별개 SSOT** — 두 정규식의 분리 사용으로 dedupe 의 부가 표기 흡수 (§0.17.5) 와 면책의 코드+태그 섞임 차단 (§0.17.3/§0.17.6) 동시 보장 |
| §0.17.6 | **포괄 면책 (검증 leak 차단) + 운영 알고리즘**. `@req` 태그는 본 skill 의 다음 모든 단계에서 점검·비교·검증·존재 여부 확인 대상이 **아니다**: §0.G1~§0.G5 게이트, §4.2 local evaluator×1 TDD 검증, §5.1.(b) Mock 금지 regex 스캔, §5.1.(d) ZERO TOLERANCE 계획-코드 일치 게이트, §5.1.(e) 정형 검사, §5.1.(f) 까칠 리뷰, §5.1.(j) DoD 검증, §6.1 회귀 테스트, §6.2 MCP mutation, §8.2 통합 테스트 정형/까칠 리뷰. **§0.7 의 ZERO TOLERANCE 평가 알고리즘 SSOT**: diff hunk 의 added-only 라인 중 **§0.17.3 wrapper-tolerant 정규식** (line-anchored, 부가 표기 흡수) 매칭 라인만 변경 set 에서 제거 후 sidecar.action 외 변경 판정. 부가 표기 라인 (예: `@req FR-X-001 (legacy)`) 은 wrapper-tolerant 가 직접 흡수. **코드+태그 섞임 라인** (예: `let x=1; // @req X`, `const msg="@req X"`) 은 라인 시작 anchor `^` 와 주석 prefix 강제로 자동 차단 → 변경 set 에 포함 (false-negative 방지). §0.17.5 lenient 정규식은 본 면책에 사용하지 않음 — dedupe 전용. 어느 검증자도 `@req` 관련 finding 발행 금지 |
| §0.17.7 | **부착 누락의 처리**. 누락은 본 skill 의 어떤 게이트도 차단하지 않는다. 사후 보완은 별도 정리 Task 로 처리 (본 스킬 책임 외). 누락 발견 시 시니어 코더가 자기 점검으로 worklog `req_tag_missing_observed { task_id, member_path }` 정보성 append 가능 (severity 없음, §7.3 enum 21). 검증자는 본 이벤트 append 도 금지 (§0.17.6) |
| §0.18 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §0.20 | **기존 테스트 불가침**. green 을 만들기 위한 **기존 테스트 파일 삭제**, **기존 테스트 케이스 제거**, **기존 단언 약화**를 모두 **금지**한다 — 통과하지 않는 테스트는 구현을 고쳐서 닫는다. 테스트를 지우면 그 시점에 회귀 안전망이 사라지고, 이후 라운드는 사라진 계약을 검증하지 못한다. 계약 자체가 바뀌어야 하면 plan/SRS 를 먼저 고쳐 §0.7 을 다시 통과한다. 탐지·차단 = §5.1.(d) + §0.G6 `existing-test-weakened-or-deleted` |
| §0.20.1 | **기존** 의 판정. 그 Task 의 **기준선 커밋** (`state.regression_baseline.head_sha`) 시점에 이미 존재하던 파일 · 테스트 케이스 · 단언 · 심볼만 "기존"이다 — 같은 Task 안에서 새로 만든 것은 §0.20 의 대상이 아니다. `regression_baseline` 이 null (§3.5 캡처 실패) 이면 그 Task 의 첫 편집 직전 HEAD 를 기준선 커밋으로 쓴다. 시점을 고정하지 않으면 방금 쓴 red 테스트를 고치는 일까지 같은 금지에 걸린다 |
| §0.20.2 | **public 심볼** 의 판정. 기준선 커밋 시점에 그 모듈의 **export 표면** (언어별 `export` 선언 / `public` 선언 / 패키지 공개 API 목록) 에 있던 이름만 public 이다 — 경로 토큰 휴리스틱 (`api/` · `public/` 등) 으로 대신하지 않는다. 계약 파손은 경로가 아니라 심볼에서 일어난다 (§0.G6 `existing-public-contract-change`) |
| §0.20.3 | **약화** 의 판정 (closed list — 넷이 전부이며, 넷 중 하나라도 diff 에 있으면 약화다). (1) **단언 삭제**, (2) 단언 술어를 더 느슨한 것으로 교체 (동등 비교 → 존재 확인 등), (3) 케이스의 `skip` / `only` / 주석 처리, (4) **기대값**을 관측값으로 교체. 판정에 시니어 재량 없음 — 목록 밖의 사유로 약화를 면제하지 않는다 |
| §0.20.4 | **증거 기반 해소**. 기존 파일의 삭제·이동(§0.G6 `existing-file-deleted-or-moved`, 검출 지점 §5.1.(d)) 과 기존 public 심볼의 삭제·시그니처 변경(동 `existing-public-contract-change`) 은, 그 변경을 요구하는 **REQ-ID** 또는 **Task-ID** 가 `sidecar` 에 있고 그 Task 의 `action` 이 이동·삭제·시그니처 변경을 **명시**할 때 `intended-improvement` 로 기록하고 진행한다. 근거를 대지 못한 변경은 `unapproved-damage` 이며 critical 이다 — `sidecar.files[]` 등재는 편집 허가일 뿐 제거 허가가 아니다. **단 §0.20.3 의 약화와 기존 테스트 삭제는 같은 근거로 해소되지 않는다** — 기준을 낮추는 것은 어떤 계획도 승인할 수 없다. 본 판정은 `kiwi-wave-master §5.5.2` 의 보존 계층과 **같은 두 값 enum · 같은 근거 요건**을 쓴다 |
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
| local evaluator×1 검증에서 1개라도 CRITICAL finding 잔존 | Phase 2 (구현) 진입 차단, Phase 1.3 개선 루프 |
| green 확인 실패 (구현 후에도 test 가 fail) | Phase 2.h 개선 루프 편입 (HIGH 카운터 소모) |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| sidecar task.files[] 에 cwd 외부 path | 즉시 중단 + User clarification gate 3옵션: (1) 진행 승인 / (2) 외부 path 제외 / (3) 작업장 이동 후 재실행 |
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
| 시니어 코더 재호출 3회 누적 (단일 Task) | User clarification gate 4옵션 (§7.4) |
| local evaluator TDD 검증자 재호출 3회 누적 + 동일 finding 잔존 | User clarification gate 4옵션 |
| 까칠 리뷰어 재호출 2회 누적 + 동일 finding 잔존 | User clarification gate 4옵션 |
| 회귀 테스트 2회 연속 동일 파일 fail | 즉시 사용자 에스컬레이션 + state.json `failed_task_ids[]` 등재 |

4옵션: `(1) draft-keep` / `(2) partial-commit` / `(3) force-proceed (사용자 책임)` / `(4) abandon-task` (Task 만 skip, plan 진행).

#### §0.G5 — MCP mutation 가드

| IF | THEN |
|---|---|
| `update_status` 호출이 REQ status 를 backward (verified → implemented 등) 전이 | 차단 + WARN |
| `add_completed_work` 호출 `summary` 가 일치 task 의 dod 와 불일치 | 차단 + 시니어에게 dod 재확인 요구 (summary 텍스트에 dod 항목 인코딩 필수, §6.2) |
| MCP 도구 미가용 (preflight 실패) | CLI diagnostics only; normal mutation HALT + MCP remediation guidance |
| 단일 Task 완료 시 mutation > 4건 시도 (4종 외 호출 또는 중복) | 차단 + 시니어 로직 재검토 |

#### §0.G6 — `--auto` critical_gates[]

`--auto` 활성 시에도 아래 게이트는 사용자 강제 HALT 이며 결정 서브에이전트로 우회 금지 — 자동 결정이 대신 닫으면 게이트가 없는 것과 같다.

| gate_id | reason | location |
|---|---|---|
| `external-module-impact` | cwd 외부 path 또는 plan 외 파일 변경 | §0.G2 |
| `tdd-bypass-attempt` | TDD 강제 원칙 우회 시도 | §0.G1 |
| `mcp-cli-both-unavailable` | normal SRS mutation requires `speckiwi mcp`; CLI diagnostics cannot replace it | §0.G5 |
| `lifecycle-gate-deprecated-or-frozen` | deprecated/frozen REQ 구현은 정책상 중단 | Phase 0 |
| `integration-test-user-consent` | 통합 테스트 실행 동의 필요 | §8.2 |
| `cost-warning-large-task` | 장시간/고비용 실행에 대한 별도 동의 필요 | §3.3 / §6.2 |
| `followup-review-fix-loop-close-unsafe` | 실패 task 또는 회귀 실패가 남아 `--close-reqs`가 부적합 | §8.4 |
| `existing-test-weakened-or-deleted` | diff 에서 기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화 검출 (§0.20 / §5.1.(d)) | §5.1.(d) |
| `existing-public-contract-change` | diff 에서 기존 public 심볼의 삭제 또는 시그니처 변경 검출 — **경로와 무관**하게 critical (path 토큰 휴리스틱이 아니다) — 해소 경로는 §0.20.4 | §5.1.(d) |
| `zero-tolerance-plan-code-mismatch` | sidecar.tasks[].files[]/action/dod ↔ 실제 변경 불일치 (§0.7) | §0.7 / §5.1.(d) |
| `mock-detection` | Mock regex 자동 탐지 CRITICAL (§0.6) | §0.6 / §5.1.(b) |
| `improvement-loop-divergence-4opt` | §0.G4 4옵션 게이트 발동 (시니어 / TDD 검증자 / 까칠 리뷰어 누적 + 회귀 2회 연속 fail) | §0.G4 / §7.4 |
| `mcp-mutation-backward-status` | `update_status` backward 전이 시도 (§0.G5 Rule 1) | §0.G5 |
| `mcp-mutation-batch-large` | MCP mutation ≥10건 batch (§0.8) | §0.8 |
| `existing-file-deleted-or-moved` | diff 에서 비-테스트 기존 파일의 삭제·이동 검출 — `sidecar.files[]` 에 등재되어 있다는 사실만으로는 해소되지 않는다 (§0.20 / §5.1.(d)) — 해소 경로는 §0.20.4 | §5.1.(d) |

---

## 1. 입력 / 출력

### 1.1 필수 입력

`PLAN_PATH` — kiwi-planner 산출물 plan.md 경로. 또는 `SIDECAR_PATH` 단독 (이 경우 plan.md 는 frontmatter.sidecar_path 의 inverse 로 추론).

부재 시 `docs/plans/*.plan.md` 의 가장 최신 generated_at 자동 채택. 후보 ≥2 시 User clarification gate.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "plan X로", "X 계획" | `PLAN_PATH` | 자동 |
| "TASK Y만" | `TASK_FILTER` (콤마, T-PH001-01,T-PH001-02) | 전체 |
| "Phase N부터" | `PHASE_FROM`, `PHASE_TO` | 전체 |
| "재개" | `--resume` | off (신규 run 또는 자동 감지) |
| "max 모드" | `--max` | default on |
| "회귀 skip" | `--skip-regression` | off (회귀 의무) |
| "기준선 받아서", "부모 기준선" | `--regression-baseline <path>` | off (자기 시점 캡처) |
| "자동 진행" | `--yes-all` | off |
| "통합 테스트 skip" | `--skip-integration` | off |
| "통합 테스트 자동 동의" | `--auto-integration` | off (사용자 동의 게이트 유지) |
| "비용 경고 자동 skip" | `--auto-cost-warning` | off |
| "local-LLM max profile", "local-LLM max profile", "local-LLM 안정성 우선", "local evaluator 으로", "local-LLM max profile" | `local-LLM max profile` | off (정규명, 모든 local-LLM max-profile → local evaluator. `../_shared/kiwi/local-llm-profile.md` v1.0) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드" | `--loops N` | off (스킬 기본 상한) |
| "dry-run" | `--dry-run` | off (MCP mutation 미실행) |

**`--drive` (FR-FLOW-119)**: 부모 `kiwi-wave-master` 가 `--drive` 로 시작한 무인 실행에서는 `--drive` 가 `--auto-integration` 과 `--auto-cost-warning` 을 함께 켠 것으로 본다 — `integration-test-user-consent` 와 `cost-warning-large-task` 두 게이트는 열린다. 그 밖의 어떤 게이트도 `--drive` 로 열리지 않으며, 특히 `existing-test-weakened-or-deleted` · `existing-public-contract-change` · `existing-file-deleted-or-moved` · `mock-detection` · `tdd-bypass-attempt` 는 `--drive` 에서도 사용자 결정이다.

**부모 체인 pass-through**: `--auto-integration` (§8.1 통합 테스트 동의 게이트) 와 `--auto-cost-warning` (§3.4 / §6.1 비용 경고 게이트) 는 사용자 직접 호출뿐 아니라 `kiwi-wave-master → kiwi-pipeline → kiwi-pm → kiwi-coder` 체인으로 그대로 전달되어 도달한다 — 중간 스킬은 값을 새로 만들지 않고 받은 것을 넘기기만 한다. 무인 실행에서 이 두 게이트가 사용자를 기다리다 멈추는 것을 막는 유일한 경로가 이 전달이다. 명시 전달이 없으면 두 옵션은 off 이며, `--auto` 는 이 두 옵션과 `--yes-all` 을 자동 활성하지 않는다 (`../_shared/kiwi/auto-option.md` 공유 계약).

### 1.3 모드 매트릭스

| 모드 | 시니어 코더 | TDD 검증 (local evaluator) | 정형 검사 (local evaluator) | 까칠 리뷰어 (local-LLM max-profile) | 비용 배수 |
|---|---|---|---|---|---|
| Normal (기본) | local-LLM max-profile × 1 | × 1 | × 1 | × 1 | 2.0~2.5× (snoworca-coder Normal 대비) |
| default `--max` | local-LLM max-profile × 1 | × 1 | × 1 | × 1 | bounded single-worker |
| `local-LLM max profile` | local evaluator × 1 | × 1 | × 1 | local evaluator × 1 | 0.7× |

TDD 검증 (local evaluator×1) 는 **모든 모드 공통**. TDD 강제 원칙 (§0.1) 의 핵심 검증 채널이므로 모드 변경 영향 없음.

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
  - `tdd_review_iter{N}.json` (local evaluator×1 결과 통합)
  - `formal_review_iter{N}.json` (local evaluator 정형)
  - `prickly_review_iter{N}.json` (local-LLM max-profile 까칠)
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
Phase 0 : Bootstrap (preflight, plan/sidecar 로드, .kiwi init/resume, target 확인, 회귀 기준선 캡처)
Phase 1 : Task 진입 + TDD 작성·검증
  1.1 : 시니어 코더가 sidecar.tdd.test_cases[] 기반으로 테스트 파일 작성
  1.2 : local evaluator×1 순차 단일 검증 (4축, §4.2)
  1.3 : 개선 루프 (CRITICAL/HIGH 잔존 시 1.1 재진입)
  1.4 : red 확인 (테스트 실행 → 의도된 fail + expected_failure_signature 정합)
  1.5 : sidecar.tdd.red_evidence 채움
Phase 2 : 구현 (snoworca-coder 차용)
  2.a : 선행 의존 task 완료 확인 (depends_on_task[])
  2.b : Mock 금지 regex 스캔
  2.c : 시니어 코더 구현
  2.d : 계획-코드 일치 게이트 (sidecar.files[], action, dod 정합)
  2.e : 정형 검사 (local evaluator×1, 4축)
  2.f : 까칠 리뷰 (single delegated reviewer, 8축)
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
2. CLI `speckiwi --version` exit 0 → 진단 로그만 기록 (`mode: "cli-diagnostic"`), PASS 아님
3. MCP 실패 → HALT + 설치/연결 가이드 출력

`.kiwi/sessions/{run-id}/preflight.json` 기록: `{mcp, cli, halted, node_version, git_repo}`.

입력 인자에 `SPAWN_CONTEXT` 가 있으면 `state.spawn_context = "pm-child"` 로 저장. 부재 시 `state.spawn_context = "standalone"` 기본. (§8.1 통합 테스트 동의 게이트 분기에 사용)

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
5. `target` 으로 speckiwi `get_active_target` 결과와 비교. 불일치 시 User clarification gate ("plan 의 target {plan.target} 이 활성 target 과 다릅니다. set_active_target 후 진행하시겠습니까?")

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
5. 빈 큐 → "모든 task 가 이미 완료되었습니다. Phase 4 (통합 테스트) 로 진행할까요?" User clarification gate

### 3.4 사용자 비용 안내

- Normal: 1회 안내 (`--auto-cost-warning`/`--yes-all` skip 가능)
- `--max`: 2단계 경고 + 추정 토큰
- 거부 시 .kiwi state 보존 후 종료

### 3.5 회귀 기준선 캡처

첫 Task 에 진입하기 전에 전체 회귀 스위트를 1회 실행하고 그 결과를 `state.regression_baseline` 에 고정한다. 이 값이 이후 모든 회귀 판정 (§6.1.3) 의 분모다 — 기준선이 없으면 "이 Task 가 깼다"와 "원래 깨져 있었다"를 구분할 방법이 없다.

```json
"regression_baseline": {
  "command": "npm test",
  "exit_code": 1,
  "passed": 140, "failed": 2,
  "failed_test_ids": ["src/a.test.ts > x", "src/b.test.ts > y"],
  "head_sha": "abc1234",
  "captured_at": "ISO-8601"
}
```

- 재개 시 `regression_baseline` 이 이미 있고 `head_sha` 가 현재 HEAD 와 같으면 재실행하지 않는다 (멱등).
- 캡처 자체가 실패하면 (스위트 명령 미검출 등) `state.regression_baseline = null` 로 두고 진행한다. 이 run 의 회귀 판정은 델타 없이 실패 전량 보고로 격하되며, 그 사실을 최종 보고서에 명시한다.
- 기준선 캡처의 `exit_code ≠ 0` 자체는 차단 사유가 아니다 — 사전 실패의 존재를 기록하는 것이 본 절의 목적이다.
- `--regression-baseline` 으로 부모가 pin 한 기준선을 받으면 그 값이 자기 시점 캡처보다 **우선한다** — 같은 run 의 두 수정 주체가 다른 기준선을 쓰면 앞 wave 가 만든 실패가 다음 계층에서 "원래 있던 실패"로 승격된다.

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

**4.1.3 시니어 코더 (local-LLM max-profile×1) 테스트 작성**:

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

### 4.2 local evaluator×1 순차 단일 TDD 검증 (4축)

**모든 모드 공통**. 단일 local evaluator 를 사용 가능한 위임 worker 위임 도구로 실행하고, 아래 4축을 한 응답에서 검토한다. evaluator 는 시니어의 rationale 미수신 (§0.5).

**`@req` 태그 검증 금지 (§0.17.6 포괄 면책)**: S1~S4 어느 검증자도 코드 주석의 `@req` 라인 존재 여부·정확성·REQ-ID 실재성을 검증/비교하지 않는다. 태그는 참고용이며 검증 축에 포함되지 않는다.

| 검증자 | 모델 | 검증 축 | 출력 finding 형식 |
|---|---|---|---|
| **S1** intent-alignment | local evaluator | 계획 의도/AC ↔ test 의미 일치 (test 가 정말 해당 AC 를 검증하는가, mock/회피 없는가, ac_refs 가 정확한가) | `{ severity, axis: "intent-alignment", evidence: {file, line}, suggestion }` |
| **S2** technical-quality | local evaluator | TDD 코드 기술 품질 (네이밍, 결정성, flaky 위험, assertion 적절성, isolation, fixture) | `{ severity, axis: "tech-quality", ... }` |
| **S3** req-mapping | local evaluator | test_case.req_id / ac_refs 와 실제 코드의 매핑 정확성 (req_id ∈ task.req_ids, ac_refs ⊆ REQ.ac_total, test_case.id 정규식 SSOT 준수) | `{ severity, axis: "req-mapping", ... }` |
| **S4** red-verification | local evaluator | 작성된 테스트를 실제 실행 → fail 발생 여부 + expected_failure_signature 정합. **테스트 실행은 검증자가 직접 수행** (verification_cmd 또는 추론된 명령) | `{ severity, axis: "red-verification", expected_signature, actual_signature, exit_code, suggestion }` |

**severity 정의**:
- **CRITICAL**: 의도 위배 (S1), Mock 사용 (S2), req_id 위반 (S3), red 미발생 (S4)
- **HIGH**: 모호한 assertion (S2), ac_refs 누락 (S3), expected_failure_signature 불일치 (S4)
- **MEDIUM**: 네이밍 / fixture 개선 (S2)
- **LOW**: 스타일 (S2)

### 4.3 개선 루프 (3회 연속 no-improvement 까지)

```
clean_count = 0
WHILE clean_count < 3:
  ├─ local evaluator 실행
  ├─ no actionable improvement → clean_count += 1
  ├─ CRITICAL/HIGH/MEDIUM 또는 actionable LOW → 시니어 코더 재호출, clean_count = 0
  └─ 동일 blocker 3회 반복 + 안전한 수정 경로 없음 → §0.G4 발동
```

루프 상한:
- 시니어 코더 재호출 **3회**
- local evaluator 재호출 **3회**
- 초과 시 §0.G4 4옵션 User clarification gate

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

sidecar 파일을 직접 manual file edit. mcp_call_log 와 무관 (sidecar 의 tdd 필드는 speckiwi 도구로 mutate 하지 않음 — planner 황금률 §0.G1 의 mutation 대상 아님).

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
  ├─ (c) 시니어 코더 구현 (local-LLM max-profile×1 or ×1, local-LLM max profile 시 local evaluator)
  │       └─ 입력: sidecar.tasks[t], 작성된 test 파일, plan.md task 섹션, 관련 REQ
  │       └─ 산출: sidecar.tasks[t].files[] 에 명시된 path 만 편집
  │       └─ **@req 태그 부착** (§0.17 SSOT 7-clause): §0.17.1 의무 범위 (테스트 파일·비코딩 Task 제외) / §0.17.2 면제 enum (closed-list, 현재 8종) + worklog 기록 / §0.17.3 1라인 1 REQ-ID 형식 + line-anchored 정규식 / §0.17.4 append 위치 결정성 / §0.17.5 dedupe 알고리즘 (lenient 정규식으로 토큰 추출 비교) / §0.17.6 포괄 면책 (모든 게이트 점검 제외) / §0.17.7 누락 무차단 — 시니어 코더는 본 7-clause 를 그대로 따른다. **검증/리뷰/회귀 단계 어디에서도 비교 금지** (§0.17.6)
  ├─ (d) 계획-코드 일치 게이트 (ZERO TOLERANCE)
  │       ├─ 실제 변경된 파일 set ⊆ sidecar.tasks[t].files[] (cwd 한정)
  │       ├─ action 명세에 기술된 시그니처 / 함수가 실제 존재
  │       ├─ dod 의 각 항목이 점검 가능한 형태로 코드에 반영
  │       ├─ **`@req` 주석 추가는 본 게이트 평가에서 제외** (§0.17.6) — 태그 추가/append 라인은 sidecar.action 외 변경 판정 시 변경 set 에서 제거 후 비교
  │       ├─ diff 에서 기존 테스트 파일 삭제 / 기존 테스트 케이스 제거 / 기존 단언 약화 검출 (§0.20)
  │       │       └─ 검출 시 CRITICAL + (c) 재호출로 재구현 강제 — 지운 테스트를 복원하고 구현으로 green 을 만든다
  │       ├─ diff 에서 기존 public 심볼 삭제 / 시그니처 변경 검출 (§0.G6 `existing-public-contract-change`)
  │       │       └─ 검출 시 CRITICAL + (c) 재호출. 파일 경로와 무관하게 판정 — 계약 파손은 경로가 아니라 심볼에서 일어난다
  │       ├─ diff 에서 비-테스트 **기존 파일의 삭제·이동** 검출 (§0.G6 `existing-file-deleted-or-moved`)
  │       │       └─ 검출 시 CRITICAL + (c) 재호출로 재구현 강제 — `sidecar.files[]` 에 등재되어 있다는 사실만으로는 해소되지 않는다. 등재는 그 파일을 편집한다는 허가이지 제거한다는 허가가 아니다
  │       ├─ **동일 항목 2회째 검출** 시 (c) 재호출로 자기 치유하지 않고 §0.G6 의 대응 gate_id 로 부모에 **버블업**한다 — 1차 검출은 재구현으로 닫되, 같은 항목이 두 번 나오면 치유가 수렴하지 않는 것이므로 사용자 결정으로 올린다
  │       └─ 위반 시 CRITICAL + (c) 재호출
  ├─ (e) 정형 검사 (local evaluator×1)
  │       └─ 검증 축 4개: Mock regex, 타입/빌드, 계획-코드 매핑 재확인, 테스트 커버리지
  │       └─ CRITICAL 발견 시 (g) 직행 (까칠 skip)
  │       └─ 검증 축 8개 (§5.2)
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

### 5.2 까칠 리뷰 8축 (snoworca-coder §6.2 동일 — 입증된 SSOT)

| # | 축 | 확인 항목 |
|---|---|---|
| 1 | 의도 보존 | sidecar.task.action / dod / 관련 REQ AC 대비 구현 일치 |
| 2 | 보안 위험 | OWASP Top 10, 입력 검증, 인증/권한, 비밀 노출 |
| 3 | 엣지 케이스 | null/empty, 경계값, 동시 접근, 순서 의존 |
| 4 | 동시성 | race condition, deadlock, 비원자 연산 |
| 5 | 리팩토링 여지 | 중복, 과도 추상화, 네이밍, 함수 크기 |
| 6 | 에러 처리 | 예외 전파, 사용자 피드백, 로깅 충분성 |
| 7 | 테스트 품질 | 작성된 test 의 의미성, flaky 위험 (Phase 1 검증과 별개로 구현 후 재확인) |
| 8 | 주석 주장 | 주석이 코드에 대해 단언하는 것이 참인가 — 닫힌 4종만: 파일·디렉터리 경로, 코드 심볼명, 개수, 부재 주장 (`호출자 없음` · `not wired`) |

**축 8 의 경계**: 닫힌 4종 밖의 주석 주장은 finding 이 아니다 — 의도·설계 의견을 다투지 않는다. 4종은 `existsSync` · `grep -c` 로 판정되므로 축 8 은 라운드당 비용이 사실상 0 이며, 임의 주석을 코드와 대조하는 비용(요구 1건당 약 27초 수준의 추론)을 지지 않는다.

**`@req` 태그 검증 금지 (§0.17.6 포괄 면책)**: 정형 검사 (local evaluator×1) 와 까칠 리뷰 (single delegated reviewer) 모두 코드 주석의 `@req` 라인에 대해 다음 행위를 금지한다 — (a) 존재 여부 점검, (b) task.req_ids 와 비교, (c) REQ-ID 실재성 검증 (speckiwi 조회), (d) 라인 누락을 finding 으로 발행. 본 태그는 정보용 breadcrumb 이며 어떤 게이트에도 영향 주지 않는다.

### 5.3 심각도 정의 (구현 단계)

- **CRITICAL**: Mock 사용, 계획-코드 매핑 누락, 빌드/타입 실패, 보안 중대, green 미달성
- **HIGH**: 테스트 fail, DoD 미충족, 의도 이탈, acceptance_tests fail, 축 8 닫힌 4종의 주석 주장이 거짓으로 측정됨
- **MEDIUM**: 경계 조건 누락, 리팩토링 미흡, 에러 처리 불충분
- **LOW**: 스타일, 주석 표현·서식

Phase 2 통과 조건: **green 확정 + 단일 evaluator 3회 연속 no actionable improvement**.

### 5.4 시니어 코더 입력 (재호출 시 포함)

- 1차 호출: sidecar.tasks[t], 작성된 test 파일, plan.md 섹션, 관련 REQ
- 재호출: 위 + 이전 findings (검증자 raw output) + 누적 시도 횟수

검증자의 결론은 raw 로 전달하되, 시니어 자신의 이전 시도 내용은 **재호출 시 제거** (편향 차단). 시니어는 매번 처음 보는 것처럼 접근.

---

## 6. Phase 3 — Task 종료 처리 (판정 상주분)

§6.2~§6.4 와 §7 전체는 `references/extended-workflow.md` 가 SSOT. 아래 §6.1 은 매 Task 마다 게이트 판정에 쓰이므로 SKILL.md 에 상주하며, **회귀 판정에 관해서는 extended reference 의 §6.1 을 대체한다**.

### 6.1 회귀 테스트 (§0.13 의무)

**6.1.0 기준선(baseline) 캡처**: Task 가 **코드를 바꾸기 전에** 전체 회귀 스위트를 1회 실행해 기준선 결과를 저장한다. run 단위 기준선은 §3.5 에서 `state.regression_baseline` 에 이미 고정되어 있으므로, 그것이 존재하고 `head_sha` 가 현재 HEAD 와 같으면 그 값을 그대로 쓴다. 없거나 HEAD 가 다르면 이 Task 의 첫 편집 전에 캡처한다.

**6.1.1 실행 범위**: (1) 영향받는 test 파일은 항상 실행, (2) 전체 회귀 스위트는 `--skip-regression` 부재 시 실행. 대상 추론과 실행 로그 적재 규약은 extended reference §6.1 참조. 실행 시간 추정 ≥10분 시 비용 경고 게이트 (`--auto-cost-warning` 로 우회, §1.2 pass-through).

**6.1.3 회귀 발견 시 처리** — 회귀 여부는 기준선 대비 **델타로 판정**한다:
- 기준선에서 pass 였는데 이번 실행에서 fail 한 test = **신규 실패**. 이 Task 가 만든 회귀이므로 CRITICAL + (Phase 2.c) 재진입
- 기준선에 이미 있던 **기존 실패**는 그대로 보고하고, 현재 Task 의 것으로 **귀속하지 않는다** — 남의 실패를 좇는 동안 이 Task 의 루프가 발산한다
- 기준선에서 fail 이었는데 이번에 pass 한 test 는 회귀가 아니다 (보고만)
- `state.regression_baseline` 이 null (§3.5 캡처 실패) 이면 델타를 계산하지 않고 실패 전량을 보고하며, 판정이 격하되었음을 함께 적는다
- 2회 연속 동일 파일 신규 실패 → §0.G4 발동 + state.failed_task_ids[] 등재
- 외부 모듈 (cwd 외부) 실패 → WARN 만, 차단 안 함

---

## 8. 통합 테스트 (Phase 4, 선택) — 진입 게이트

§8.2~§8.4 는 `references/extended-workflow.md` 가 SSOT. 아래 §8.1 은 동의 게이트 판정이라 SKILL.md 에 상주한다.

### 8.1 조건

- 모든 task 가 completed_task_ids[] 에 진입
- `--skip-integration` 부재
- 사용자 동의 (`--auto-integration`/`--yes-all` skip)

`state.spawn_context == "pm-child"` (§3.0) 인 경우 본 동의 게이트를 발동하지 않는다 — 단일 Task 자식이 Task 마다 동의를 요구하면 부모의 무인 진행이 Task 수만큼 멈춘다. 자식 컨텍스트에서 통합 테스트 실행 여부는 모든 Task 를 본 부모 `kiwi-pm` 가 결정한다.

skip 시(`--skip-integration` 명시 또는 사용자 거부)에도 **최종 보고서는 항상 생성**하며, 통합 테스트 섹션은 "skipped: {reason}" 으로 채운다.

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
task finalization, MCP mutation batch, .kiwi state schemas, integration testing, examples, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
