---
name: kiwi-coder
description: "kiwi-planner 산출물(plan_contract=1.2.0 + sidecar TDD)을 입력 SSOT 로 받아 Task 단위로 TDD 선행 → Sonnet×4 병렬 TDD 검증 → Opus 시니어 구현 → 정형 검사 → 까칠 리뷰 → 개선 루프 → 테스트 실행 → 회귀 검증 → speckiwi MCP mutation → .kiwi/ 상태 갱신을 자동화하는 코딩 스킬 v0.1. 재개 가능. 트리거: 계획대로 구현, kiwi 코딩, tdd 코딩, plan 구현, kiwi planner 산출물 구현. 검증(정형 검사·까칠 리뷰) 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 그 모델을 override 한다(TDD 검증 Sonnet×4 불변)."
---

> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

# kiwi-coder v0.1.9

`kiwi-planner` 가 만든 plan.md + sidecar.json (plan_contract=1.2.0, schema_version=1.1.0, tdd_policy∈{strict, relaxed}) 을 입력 SSOT 로 삼아, Task 단위로 TDD 를 먼저 작성·검증한 뒤 본 구현을 진행하는 코딩 자동화 스킬. snoworca-coder 의 Phase 루프 로직만 차용하되 plan-contract-v1 의존을 제거하고 speckiwi MCP / kiwi-planner sidecar 를 1급 시민으로 사용한다. **모든 작업 상태는 `cwd/.kiwi/` 에 영속화하여 새 세션에서 재개 가능**.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 강제**. 모든 코딩 Task 는 (1) 테스트 작성 → (2) Sonnet×4 병렬 검증 → (3) red 실패 확인 → (4) 구현 → (5) green 확인 순서. 우회 금지 |
| §0.2 | **planner sidecar 의무 SSOT**. 입력 plan 의 `plan_contract` ∈ {"1.2.0"} 필수 (kiwi-planner §0.15 의 dual-accept `["1.1.0", "1.2.0"]` 중 본 스킬은 `1.2.0` 만 수용 — `1.1.0` 은 TDD 필드 부재로 §0.1 강제와 충돌). `schema_version` ∈ {"1.1.0"} 필수. `tdd_policy=disabled` 인 plan 은 즉시 거부. 거부 시 안내: "kiwi-planner --tdd-policy=relaxed\|strict 로 재실행하여 plan_contract=1.2.0 + schema_version=1.1.0 산출물을 생성하십시오" |
| §0.3 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부. `_shared/snoworca/` 모듈 로드도 금지 |
| §0.4 | **검증자는 별도 서브에이전트**. 인라인 자가검증 금지 (CLAUDE.md §5) |
| §0.5 | **검증자 입력 격리**. 시니어 코더의 결론·정당화 전달 금지. 원본 plan + sidecar + 작성된 코드 + 테스트만 |
| §0.6 | **Mock 금지** (regex 자동 탐지). CRITICAL severity |
| §0.7 | **ZERO TOLERANCE 계획-코드 일치 게이트**. sidecar.tasks[].files[], action, dod 와 실제 변경이 불일치하면 CRITICAL |
| §0.8 | **사용자 확인 의무**. 외부 모듈 영향, plan 외 파일 변경, 통합 테스트 실행, MCP mutation 회수 ≥10건 batch 시 모두 AskUserQuestion |
| §0.9 | **외부 모듈 수정 금지**. cwd 외부 path 가 sidecar files[] 또는 실제 변경에 진입 시 즉시 중단 + AskUserQuestion (§0.G2) |
| §0.10 | **시그니처 금지** (CLAUDE.md §6). 커밋 메시지·코드 주석·산출물 어디에도 AI 식별 정보 금지. `Co-Authored-By` 등 자동 추가 차단 |
| §0.11 | **`.kiwi/` 상태 영속**. 모든 단계 종료마다 `cwd/.kiwi/sessions/{run-id}/state.json` 갱신. Task 종료마다 `tasks/{task-id}.json` + `worklog.jsonl` append. checkpoint 의무 (§7) |
| §0.12 | **MCP mutation 4종 SSOT**. 허용 = `add_trace_link` (Code anchor) / `add_verification_evidence` (type=test) / `update_status` / `add_completed_work` 4종. mutation 호출 1건 = state.json `mcp_call_log[]` 1건 (멱등 dedupe: args_hash) |
| §0.13 | **회귀 테스트 의무**. Task 종료마다 (1) 영향받는 test 파일 실행 + (2) 전체 회귀 스위트 실행. `--skip-regression` 플래그 명시 시에만 (2) skip, (1) 은 항상 실행 |
| §0.14 | **id 정규식 SSOT** (kiwi-planner §0.14 와 동일). `run_id` = `[a-z0-9.-]{4,40}` (dot 허용 — planner run-id `{YYYY-MM-DD}.{project-slug}.{target-slug}` 호환), `phase_id` = `^PH-\d{3}$`, `task_id` = `^T-PH\d{3}-\d{2}$`. 입력 sidecar 가 위반하면 §0.G3 차단 |
| §0.15 | **plan-step ↔ task 1:1**. sidecar.tasks[] 가 곧 작업 단위. 메인이 임의로 task 분할/병합 금지 — 필요 시 `/kiwi-planner` 재호출 권고 |
| §0.16 | **검증 서브에이전트 모델 정책 SSOT**. 정형 검사·까칠 리뷰 등 검증 서브에이전트는 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 검증 서브에이전트의 모델을 override 한다 (시니어 코더는 영향 없음). **TDD 검증 Sonnet×4 (Phase 1.2) 는 모든 모드 공통 유지 (§0.1)** — 모델 불변. 심각도 게이트·회귀 테스트 의무는 불변 |
| §0.17 | **`@req` 태그 부착 (참고용 SSOT)**. 본 §0.17 은 글로벌 CLAUDE.md §2/§3 (Simplicity / Surgical Changes) 의 코멘트 보수성 가이드보다 본 skill 내부에서 **우선**한다. 세부 규약은 §0.17.1~§0.17.7. **본 태그는 순수 참고용** — speckiwi `add_trace_link` 가 SSOT, 태그는 grep 보조. REQ rename/deprecate 시 자동 갱신 의무 없음 (부패 허용). **운영 순서 SSOT** (시니어 코더 단계별): (1) §0.17.1 의무 범위 + §0.17.2 면제 enum 판정 → (2) 면제 시 worklog `req_tag_exempted` append + skip / 의무 시 다음 → (3) §0.17.5 lenient 정규식으로 기존 토큰 set 추출 + 새 토큰 dedupe 검사 → (4) 일치 시 skip / 미일치 시 §0.17.4 위치 결정 → (5) 위치 모호 시 worklog `req_tag_position_ambiguous` + 보류 / 결정 시 §0.17.3 wrapper-tolerant 정규식 형식으로 신규 라인 작성 |
| §0.17.1 | **의무 범위**. 코딩 Task (type ∈ {code, perf_test, infra}) 의 **구현 단계 (Phase 2.c) 에서 새로 정의되는 클래스/메서드/함수** 에 한해 부착 의무 (가시성 제한 없음 — public/private 무관). 함수 정의 = 명명 함수 (named function/method) + lambda/closure/arrow function (단, §0.17.2 enum (5) 의 private 1라인 lambda 는 면제). 부착 위치 = 정의 직전 라인 또는 docstring 첫 줄. **테스트 파일은 부착 의무 대상에서 제외** — 식별 SSOT: (a) sidecar.tdd.test_cases[].test_file 에 명시된 모든 파일, (b) 경로 정규식 `(^|/)(tests?|__tests__|spec|e2e|integration)(/|$)` 매칭 디렉토리 내 파일, (c) 파일명 정규식 `\.(test|spec)\.[a-zA-Z]+$` 매칭 파일. 통합 테스트 (§8.2 산출물) 도 본 면제에 포함. 테스트의 REQ 매핑은 `test_case.ac_refs` 가 SSOT. 비코딩 Task (type ∈ {doc, file_op, issue, pr, review}) 도 면제 |
| §0.17.2 | **면제 enum (closed-list, 시니어 재량 없음)**. 아래 8종만 면제: (1) 1라인 getter (`return this.x`), (2) 1라인 setter (`this.x = v`), (3) 언어 자동 생성 메서드 명시 (Java toString/hashCode/equals, JS Object.prototype.*, Python `__repr__`/`__eq__`/`__hash__`/`__init__` 자동 생성, Rust `#[derive(...)]` / procedural attribute macro `#[...]` (예: `#[tokio::main]`, `#[async_trait]`) / function-like macro `macro!(...)` (예: `lazy_static!{}`, `bitflags!{}`) 가 생성한 메서드, Go receiver method 자동 생성), (4) IDE 자동 생성 boilerplate constructor (필드 대입 (다중 가능) + `super(...)` 호출 + null-coalescing default 까지 허용. 비즈니스 로직·검증·side effect 가 1줄이라도 포함되면 부착 의무), (5) private 1라인 lambda/helper (가시성 무관 의무 §0.17.1 에 따라 lambda 도 의무 — 본 enum 항목으로만 면제), (6) 인터페이스/추상메서드 (구현 없음), (7) override 시 부모에 이미 `@req` 가 있고 **부모가 cwd 내부일 때만** (부모가 외부 라이브러리면 enum 7 미적용 = 부착 의무), (8) IDE/언어/매크로가 인간 작성 없이 자동 생성한 메서드 일반 (worklog 사유에 `reason_enum_id=8` + `raw_reason` 부가 **의무**). **결정 알고리즘**: enum (1)~(7) 매칭 패턴이 있으면 우선 분류 (raw_reason 불필요), enum (1)~(7) 어디에도 매칭 안 되는 자동 생성 메서드만 enum (8) 사용 — Rust derive 같이 enum (3) 명시 항목이 있는 경우는 항상 (3). **면제 적용 시 worklog `req_tag_exempted { task_id, member_path, reason_enum_id, raw_reason? (enum=8 필수, 그 외 생략) }` append 의무** (§7.3 enum 19). enum 외 사유로 면제 불가 |
| §0.17.3 | **형식·정규식 SSOT**. REQ-ID 토큰 형식 정규식: `[A-Z][A-Z0-9-]*[A-Z0-9]` (trailing hyphen 차단, 2자 이상). **단일 라인/wrapper-tolerant 정규식** (신규 부착 검증용 + §0.17.6 운영 면책용 공용, line-anchored, 부가 표기 흡수, **1라인 1 REQ-ID**): `^\s*([/*#]+\s*)?@req\s+[A-Z][A-Z0-9-]*[A-Z0-9](\s*\(.+?\))?\s*\*?/?\s*$`. 라인 시작 anchor `^` 강제 — 코드+태그 섞임 라인 (예: `let x=1; // @req X`) 매칭 차단. trailing 부가 표기 흡수 — `\s*\(.+?\)` non-greedy 라 공백 유무 무관 (`@req X (legacy)` / `@req X(legacy)` 둘 다 매칭). 다중 REQ → 라인 분리. 언어별 주석 스타일: TS/JS/Java/Go/Rust/C/C++ = `// @req X`, Python/Ruby/Shell = `# @req X`, JSDoc/JavaDoc multi-line = `* @req X` (단일 라인 `/** @req X @param y */` **금지**). **REQ-ID 토큰의 실재성 (speckiwi 조회) 은 본 skill 어디서도 검증하지 않음** (§0.17.6 면책). 형식적 무결성도 검증 안 함 — REQ-ID 형식은 speckiwi/kiwi-srs 가 보장하는 외부 책임. 형식 위반 토큰 (1자, trailing hyphen 등) 은 라인 정규식 매칭 실패로 자연 차단됨. dedupe 비교는 §0.17.5 의 lenient 정규식 사용 (별도 용도) |
| §0.17.4 | **append 위치 SSOT + docstring 정의**. docstring 정의 (언어별): Python `"""..."""` 또는 `'''...'''` triple-quoted / JSDoc·JavaDoc `/** ... */` block / Rust `///` line-doc + `/** */` block-doc / TS·C#·PHP `/** */`. **docstring 개념이 없는 언어 (Go·Bash 등) 는 항상 (b) 외부 분기 적용**. append 규칙: (a) 기존 `@req` 라인이 docstring 내부면 마지막 `@req` 라인 직하 (동일 docstring block 내부) 에 새 라인 추가. (b) 외부 (정의 직전 주석 블록) 면 외부의 마지막 `@req` 라인 직하. 기존 라인 사이 삽입·재배치·삭제 금지. 위치 모호 시 시니어는 추가 보류 + worklog `req_tag_position_ambiguous { task_id, member_path }` 기록 (§7.3 enum 20). 보류된 멤버는 §0.17.7 의 부착 누락 상태로 간주 — `req_tag_missing_observed` 도 함께 append 가능 (별도 정리 Task). **mixed-location 케이스** (한 멤버에 docstring 내부 + 외부 양쪽에 기존 `@req` 가 모두 존재) 는 docstring 내부를 우선 — Python·JSDoc 자연스러운 문서 통합 위치. 단 모호 시 보류로 fallback |
| §0.17.5 | **dedupe SSOT**. 기존 라인에서 REQ-ID 토큰을 추출할 때는 **lenient 정규식 (dedupe 전용)** `@req\s+([A-Z][A-Z0-9-]*[A-Z0-9])` (§0.17.3 와 동일 REQ-ID 형식, line-anchored 제거) 으로 lenient 검색. 부가 표기 (예: `@req FR-X-001 (legacy)` 의 `(legacy)`, 단일 라인 다중 태그 `/** @req X @param y */`) 가 붙은 비정상 라인에서도 토큰 추출. 추출된 모든 REQ-ID 토큰의 set 을 기존 부착 토큰 set 으로 간주. 새 토큰이 set 에 case-sensitive 일치 시 dedupe (추가 금지). **§0.17.3 wrapper-tolerant 정규식 (line-anchored, 부착 검증 + §0.17.6 면책 공용) 과 본 §0.17.5 lenient 정규식 (line-anchored 미적용, dedupe 전용) 은 별개 SSOT** — 두 정규식의 분리 사용으로 dedupe 의 부가 표기 흡수 (§0.17.5) 와 면책의 코드+태그 섞임 차단 (§0.17.3/§0.17.6) 동시 보장 |
| §0.17.6 | **포괄 면책 (검증 leak 차단) + 운영 알고리즘**. `@req` 태그는 본 skill 의 다음 모든 단계에서 점검·비교·검증·존재 여부 확인 대상이 **아니다**: §0.G1~§0.G5 게이트, §4.2 Sonnet×4 TDD 검증, §5.1.(b) Mock 금지 regex 스캔, §5.1.(d) ZERO TOLERANCE 계획-코드 일치 게이트, §5.1.(e) 정형 검사, §5.1.(f) 까칠 리뷰, §5.1.(j) DoD 검증, §6.1 회귀 테스트, §6.2 MCP mutation, §8.2 통합 테스트 정형/까칠 리뷰. **§0.7 의 ZERO TOLERANCE 평가 알고리즘 SSOT**: diff hunk 의 added-only 라인 중 **§0.17.3 wrapper-tolerant 정규식** (line-anchored, 부가 표기 흡수) 매칭 라인만 변경 set 에서 제거 후 sidecar.action 외 변경 판정. 부가 표기 라인 (예: `@req FR-X-001 (legacy)`) 은 wrapper-tolerant 가 직접 흡수. **코드+태그 섞임 라인** (예: `let x=1; // @req X`, `const msg="@req X"`) 은 라인 시작 anchor `^` 와 주석 prefix 강제로 자동 차단 → 변경 set 에 포함 (false-negative 방지). §0.17.5 lenient 정규식은 본 면책에 사용하지 않음 — dedupe 전용. 어느 검증자도 `@req` 관련 finding 발행 금지 |
| §0.17.7 | **부착 누락의 처리**. 누락은 본 skill 의 어떤 게이트도 차단하지 않는다. 사후 보완은 별도 정리 Task 로 처리 (본 스킬 책임 외). 누락 발견 시 시니어 코더가 자기 점검으로 worklog `req_tag_missing_observed { task_id, member_path }` 정보성 append 가능 (severity 없음, §7.3 enum 21). 검증자는 본 이벤트 append 도 금지 (§0.17.6) |
| §0.18 | **`--auto` 옵션 SSOT (신설)**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. 본 스킬의 신규 `--auto` 는 **§8.4 후속 review-fix-loop 자동 시작 게이트 + 메인 게이트 결정** 에만 적용된다 — `--auto` 활성이 기존 분리 옵션 (`--yes-all` / `--auto-integration` / `--auto-cost-warning`) 을 자동 활성하지 않으며, 3종 옵션은 fine-grained 자유도 보존을 위해 그대로 유지 (§1.2). 본 스킬의 `critical_gates[]` 는 §0.G6 (아래) 참조 |
| §0.19 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
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
| Sonnet×4 검증에서 1개라도 CRITICAL finding 잔존 | Phase 2 (구현) 진입 차단, Phase 1.3 개선 루프 |
| green 확인 실패 (구현 후에도 test 가 fail) | Phase 2.h 개선 루프 편입 (HIGH 카운터 소모) |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| sidecar task.files[] 에 cwd 외부 path | 즉시 중단 + AskUserQuestion 3옵션: (1) 진행 승인 / (2) 외부 path 제외 / (3) 작업장 이동 후 재실행 |
| 시니어 코더가 cwd 외부 파일 편집 시도 | 즉시 차단 + CRITICAL |
| 회귀 테스트가 cwd 외부 모듈 실패 | WARN 만, 차단 안 함 (외부 책임) |

#### §0.G3 — 입력 plan/sidecar 무결성

| IF | THEN |
|---|---|
| `plan_contract ≠ "1.2.0"` 또는 `schema_version ≠ "1.1.0"` | 거부 + kiwi-planner 재실행 권고 |
| `tdd_policy = "disabled"` | 거부 + 권고 |
| sidecar JSON parse 실패 | 거부 + validator 재실행 권고 (`node ~/.claude/skills/kiwi-planner/validator.mjs ...`) |
| sidecar.tasks[].id 또는 phases[].id 정규식 위반 | 거부 |
| plan.md.frontmatter.sidecar_path 와 실제 sidecar 경로 불일치 | WARN + 사이드카 경로 사용 |
| `validator.json` 존재 + `exit_code != 0` | WARN + 사용자에게 표시 후 진행 동의 |

#### §0.G4 — 개선 루프 발산

| IF | THEN |
|---|---|
| 시니어 코더 재호출 3회 누적 (단일 Task) | AskUserQuestion 4옵션 (§7.4) |
| Sonnet TDD 검증자 재호출 3회 누적 + 동일 finding 잔존 | AskUserQuestion 4옵션 |
| 까칠 리뷰어 재호출 2회 누적 + 동일 finding 잔존 | AskUserQuestion 4옵션 |
| 회귀 테스트 2회 연속 동일 파일 fail | 즉시 사용자 에스컬레이션 + state.json `failed_task_ids[]` 등재 |

4옵션: `(1) draft-keep` / `(2) partial-commit` / `(3) force-proceed (사용자 책임)` / `(4) abandon-task` (Task 만 skip, plan 진행).

#### §0.G5 — MCP mutation 가드

| IF | THEN |
|---|---|
| `update_status` 호출이 REQ status 를 backward (verified → implemented 등) 전이 | 차단 + WARN |
| `add_completed_work` 호출 `summary` 가 일치 task 의 dod 와 불일치 | 차단 + 시니어에게 dod 재확인 요구 (summary 텍스트에 dod 항목 인코딩 필수, §6.2) |
| MCP 도구 미가용 (preflight 실패) | CLI fallback (`speckiwi` 명령) 시도, 둘 다 실패 시 mutation skip + state.json `pending_mutations[]` 적재 + 사용자 보고 |
| 단일 Task 완료 시 mutation > 4건 시도 (4종 외 호출 또는 중복) | 차단 + 시니어 로직 재검토 |

#### §0.G6 — `--auto` critical_gates[] 선언

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트 (SSOT `_shared/kiwi/auto-option.md` §5 인터페이스 준수). `--auto` 는 본 스킬에서 §8.4 후속 review-fix-loop 게이트 + 메인 게이트 결정 채널에 적용되며 (§0.18), 다음 게이트는 결정 서브에이전트로 우회 금지:

| gate_id | reason | 발생 위치 |
|---|---|---|
| `external-module-impact` | sidecar files[] 또는 실제 변경이 cwd 외부 path 진입 (§0.9 / §0.G2) | §0.G2 |
| `zero-tolerance-plan-code-mismatch` | sidecar.tasks[].files[]/action/dod ↔ 실제 변경 불일치 (§0.7) | §0.7 / §5.1.(d) |
| `mock-detection` | Mock regex 자동 탐지 CRITICAL (§0.6) | §0.6 / §5.1.(b) |
| `tdd-bypass-attempt` | TDD 우회 시도 (§0.G1 — 시니어가 테스트 작성 단계 skip 시도 / `tdd.applicable=false` + exempt 부재) | §0.G1 |
| `improvement-loop-divergence-4opt` | §0.G4 4옵션 게이트 발동 (시니어/Sonnet×4/까칠 누적 + 회귀 2회 연속 fail) | §0.G4 / §7.4 |
| `mcp-mutation-backward-status` | `update_status` backward 전이 시도 (§0.G5 Rule 1) | §0.G5 |
| `mcp-mutation-batch-large` | MCP mutation ≥10건 batch (§0.8) | §0.8 |
| `integration-test-user-consent` | 통합 테스트 실행 사용자 동의 (§8.2) — `--auto-integration` 부재 시 사용자 결정 필요 (본 게이트는 `--auto-integration` 명시로 우회 가능 — `--auto` 자동 활성 안 함 §0.18) | §8.2 |
| `cost-warning-large-task` | 비용 경고 (실행 시간 ≥10분) — `--auto-cost-warning` 부재 시 사용자 결정 (본 게이트도 `--auto-cost-warning` 명시로만 우회 — §0.18) | §3.3 / §6.2 |
| `followup-review-fix-loop-close-unsafe` | §8.4 후속 review-fix-loop 자동 시작 시 `state.failed_task_ids[]` 비어있지 않거나 회귀 fail 잔존 — verified 닫기 부적합 (§8.4) | §8.4 |

**기존 분리 옵션 보존 (§0.18 정합)**: `--yes-all` / `--auto-integration` / `--auto-cost-warning` 의 의미는 본 §0.G6 와 독립. 본 SSOT `--auto` 가 활성되어도 3종은 명시 입력 시에만 활성된다 (자동 활성 금지). `--auto` 활성 시 §8.4 후속 review-fix-loop spawn 의 args 에 `--close-reqs --auto` 전파는 §8.4 본문이 SSOT.

---

## 1. 입력 / 출력

### 1.1 필수 입력

`PLAN_PATH` — kiwi-planner 산출물 plan.md 경로. 또는 `SIDECAR_PATH` 단독 (이 경우 plan.md 는 frontmatter.sidecar_path 의 inverse 로 추론).

부재 시 `docs/plans/*.plan.md` 의 가장 최신 generated_at 자동 채택. 후보 ≥2 시 AskUserQuestion.

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
| "자동", "auto", "묻지 말고" (메인 게이트 + §8.4 후속) | `--auto` (SSOT: auto-option.md v1.0; 기존 `--yes-all`/`--auto-integration`/`--auto-cost-warning` 3종 자동 활성 안 함 — §0.18) | off |
| "--model <name>", "검증 모델 지정", "다른 모델로 검증" | `--model <name>` | 현재 세션 모델 (정형 검사·까칠 리뷰 검증 서브에이전트에 적용) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |
| "dry-run" | `--dry-run` | off (MCP mutation 미실행) |

### 1.3 모드 매트릭스

| 모드 | 시니어 코더 | TDD 검증 (Sonnet) | 정형 검사 (현재 세션 모델) | 까칠 리뷰어 (현재 세션 모델) | 비용 배수 |
|---|---|---|---|---|---|
| Normal (기본) | Opus × 1 | × 4 (병렬) | × 1 | × 1 | 2.0~2.5× (snoworca-coder Normal 대비) |
| `--max` | Opus × 3 | × 4 | × 1 | × 2 | 12~15× |
| `--reviewer-off` | Opus × 1 | × 4 | × 1 | × 0 | 1.6× |

`--model <name>` 지정 시 정형 검사·까칠 리뷰 검증 서브에이전트의 모델을 override (기본은 현재 세션 모델; 시니어 코더·TDD 검증은 영향 없음).

TDD 검증 (Sonnet×4) 는 **모든 모드 공통**. TDD 강제 원칙 (§0.1) 의 핵심 검증 채널이므로 모드 변경 영향 없음.

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
  - `tdd_review_iter{N}.json` (Sonnet×4 결과 통합)
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
  1.2 : Sonnet×4 병렬 검증 (4축, §4.2)
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
2. CLI `speckiwi --version` exit 0 → PASS (`mode: "cli-fallback"`)
3. 둘 다 실패 → HALT + 설치 가이드 출력

`.kiwi/sessions/{run-id}/preflight.json` 기록: `{mcp, cli, halted, node_version, git_repo}`.

입력 인자에 `SPAWN_CONTEXT` 가 있으면 `state.spawn_context = "pm-child"` 로 저장. 부재 시 `state.spawn_context = "standalone"` 기본. (§8.4 자동 시작 게이트 분기에 사용)

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
5. `target` 으로 speckiwi `get_active_target` 결과와 비교. 불일치 시 AskUserQuestion ("plan 의 target {plan.target} 이 활성 target 과 다릅니다. set_active_target 후 진행하시겠습니까?")

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
5. 빈 큐 → "모든 task 가 이미 완료되었습니다. Phase 4 (통합 테스트) 로 진행할까요?" AskUserQuestion

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

**4.1.3 시니어 코더 (Opus×1) 테스트 작성**:

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

### 4.2 Sonnet×4 병렬 TDD 검증 (4축)

**모든 모드 공통**. Sonnet 4 인스턴스를 단일 메시지의 4개 Agent 호출로 병렬 spawn. 각 검증자는 시니어의 rationale 미수신 (§0.5).

**`@req` 태그 검증 금지 (§0.17.6 포괄 면책)**: S1~S4 어느 검증자도 코드 주석의 `@req` 라인 존재 여부·정확성·REQ-ID 실재성을 검증/비교하지 않는다. 태그는 참고용이며 검증 축에 포함되지 않는다.

| 검증자 | 모델 | 검증 축 | 출력 finding 형식 |
|---|---|---|---|
| **S1** intent-alignment | Sonnet | 계획 의도/AC ↔ test 의미 일치 (test 가 정말 해당 AC 를 검증하는가, mock/회피 없는가, ac_refs 가 정확한가) | `{ severity, axis: "intent-alignment", evidence: {file, line}, suggestion }` |
| **S2** technical-quality | Sonnet | TDD 코드 기술 품질 (네이밍, 결정성, flaky 위험, assertion 적절성, isolation, fixture) | `{ severity, axis: "tech-quality", ... }` |
| **S3** req-mapping | Sonnet | test_case.req_id / ac_refs 와 실제 코드의 매핑 정확성 (req_id ∈ task.req_ids, ac_refs ⊆ REQ.ac_total, test_case.id 정규식 SSOT 준수) | `{ severity, axis: "req-mapping", ... }` |
| **S4** red-verification | Sonnet | 작성된 테스트를 실제 실행 → fail 발생 여부 + expected_failure_signature 정합. **테스트 실행은 검증자가 직접 수행** (verification_cmd 또는 추론된 명령) | `{ severity, axis: "red-verification", expected_signature, actual_signature, exit_code, suggestion }` |

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
  └─ Sonnet 재호출 3회 누적 → §0.G4 발동
```

루프 상한:
- 시니어 코더 재호출 **3회**
- Sonnet 재호출 **3회**
- 초과 시 §0.G4 4옵션 AskUserQuestion

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

sidecar 파일을 직접 Edit. mcp_call_log 와 무관 (sidecar 의 tdd 필드는 speckiwi 도구로 mutate 하지 않음 — planner 황금률 §0.G1 의 mutation 대상 아님).

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
  ├─ (c) 시니어 코더 구현 (Opus×1 or ×3)
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

## 6. Phase 3 — Task 종료 처리

### 6.1 회귀 테스트 (§0.13 의무)

**6.1.1 영향받는 테스트 (항상 실행)**:
- sidecar.tasks[t].files[] 의 각 파일이 의존되는 test 파일을 정적 추론 (import graph / require / package 동일성)
- 추론 어려운 경우 fallback: 최근 1주일 내 수정된 모든 test 파일

**6.1.2 전체 회귀 스위트 (--skip-regression 부재 시)**:
- 프로젝트 표준 명령 (`npm test`, `pytest`, `cargo test`, `go test ./...` 등) 자동 감지
- 실행 시간 추정 ≥10분 시 사용자 동의 게이트 (`--yes-all`/`--auto-cost-warning` skip)
- 결과를 `docs/analysis/kiwi-coder-{run-id}/regression_run.jsonl` 에 append

**6.1.3 회귀 발견 시 처리**:
- 해당 task 가 만든 변경이 기존 test 를 깬 경우 → CRITICAL + (Phase 2.c) 재진입
- 2회 연속 동일 파일 회귀 → §0.G4 발동 + state.failed_task_ids[] 등재
- 외부 모듈 (cwd 외부) 실패 → WARN 만, 차단 안 함

### 6.2 MCP mutation 4종 batch

**평탄화 의무 — sidecar nested → MCP flat 변환은 coder 책임**:

sidecar `tasks[].trace_links[]` 는 nested schema (`{source:{type,id}, target:{type,reference}, relation}`) 로 작성되어 있다. 동일하게 sidecar `mcp_call_log[].args` (planner 가 dry-run 시뮬레이션으로 적재한 entry) 도 nested 표현. 그러나 speckiwi MCP 실 호출 schema 는 **flat** 이므로, 본 §6.2 mutation 호출 직전에 반드시 평탄화해야 한다. nested 표현 그대로 호출 시 speckiwi MCP 가 임의 필드로 거부 → mutation 실패. 변환 매핑 SSOT 는 kiwi-planner §9.5 line 604-613 "sidecar nested ↔ 실 MCP flat 변환 매핑" 표 참조.

평탄화 예 (add_trace_link):
```
sidecar.tasks[].trace_links[i]            →  MCP add_trace_link args (flat)
  source: {type: "Task", id: "T-PH001-02"}    id: <REQ id from target.reference>
  target: {type: "Requirement", reference:    type: <task type 매핑 또는 "Code">
           "FR-X-001"}                         reference: <task.files[].path:line_range 또는
  relation: "implements"                                   source.id (task id)>
                                              relation: "implements"
```

**시그니처 SSOT — speckiwi MCP 실제 schema 기준** (호출 인자는 flat 객체. 임의 필드 추가 금지 — 메타 정보는 summary 텍스트 또는 reportPaths 에 인코딩):

```
1. add_trace_link (Code anchor — 선택)
   args: { id: "FR-X-001",                         # REQ id
           type: "Code",                            # target type
           reference: "src/x.ts:45-67",             # target reference (path:line_range)
           relation: "implements",                  # 관계
           [notes: "..."] }                         # 선택
   조건: sidecar.task.files[].line_range 가 모든 변경 파일에 존재할 때만 호출.
         REQ 1개당 변경 파일별 1건 (REQ id × file 개수).

2. add_verification_evidence (type=test)
   args (각 PASS 한 test_case 별 1건):
   { id: "FR-X-001",                                # REQ id
     type: "test",
     reference: "tests/x.test.ts#TC-REQ-FR-X-001-AC1-01",
     [covers: "AC-1", notes: "..."] }               # 선택 — covers 는 AC id 명시 권장

3. update_status
   args: { id: "FR-X-001", status: <전이값> }       # dryRun 인자 없음 (호출 시점 적용)
   전이 규칙:
   - Task 시작 시 → "in_progress" (kiwi-coder 권한)
   - 해당 REQ 의 모든 ac 가 green_evidence 보유 + acceptance_tests 통과 → "verified"
   - 일부 ac 만 pass → "implemented"
   - 회귀 발생 → "blocked"
   - 기존 status 보다 backward 면 §0.G5 자체 차단 (호출 안 함)

4. add_completed_work — Task 종료 시 1건 (Task 단위 요약)
   args: { date: "YYYY-MM-DD",                      # 필수 (today)
           summary: "<Task title + green 결과 + DoD 요약>",  # 필수, task_id / files / dod 정보 인코딩
           [requirementIds: ["FR-X-001", ...],      # task.req_ids
            target: "<active target slug>",
            scope: "<scope id>",
            reportPaths: ["<repo-relative POSIX path>"],   # 선택 — 보고서/test log
            allowIncomplete: false,
            dryRun: <--dry-run 플래그 전파>] }

   summary 인코딩 예:
     "[task] T-PH001-02 — login 에러 메시지 개선. green=PASS (5/5 TC).
      files: src/auth/login.ts, tests/auth/login.test.ts.
      dod: ['에러 메시지 정확', '로그 마스킹']"

   ⚠️ speckiwi schema 에 task_id / req_ids / files_changed / dod_checklist / completed_at 같은
      임의 필드 직접 전달 불가. summary 텍스트에 인코딩하거나 reportPaths 로 detail md 첨부.
```

각 호출은 state.json `mcp_call_log[]` 에 `{tool, args, args_hash: sha1(canonicalJson(args)), ok, response_hash, dry_run, called_at}` append. 동일 args_hash 중복 호출 skip (멱등).

`--dry-run` 시 mutation 4종 모두 호출 skip + `mcp_call_log[]` 에 `dry_run: true` 만 기록. `add_completed_work` 는 schema 가 `dryRun` 옵션을 직접 지원하므로 호출 자체는 시도하고 `dryRun:true` 인자 전달 (실 적용 없음). 다른 3종 (`add_trace_link` / `add_verification_evidence` / `update_status`) 은 dryRun 옵션이 없으므로 호출 자체를 skip.

### 6.3 .kiwi 상태 갱신

```
state.json:
  - completed_task_ids[] += [t]
  - current_task_id = null (다음 task 진입 직전 갱신)
  - mcp_call_log[] += (위 호출들)
  - updated_at = ISO-8601
  - next_resume_hint = null

tasks/{task-id}.json: 전체 task 실행 기록 (TDD draft → review → impl → green → mutation 까지 모두)

worklog.jsonl 이벤트:
  - task_done { task_id, phase_id, green: true, regression: "pass"|"partial"|"skip", duration_ms }
```

state.json 쓰기는 atomic (tmp → rename). 쓰기 실패 시 `.kiwi/logs/append-errors.log` 에 기록 + 사용자 알림 (다음 task 진입 차단).

### 6.4 다음 task 진입

큐가 비어있지 않으면 Phase 1.1 로 복귀. 비어있으면 Phase 4.

---

## 7. .kiwi/ 상태 스키마 SSOT

### 7.1 state.json 스키마

```json
{
  "schema_version": "1.0.0",
  "run_id": "2026-05-19.skf.v01.coder-0519",
  "plan_run_id": "2026-05-19.skf.v01",
  "plan_path": "docs/plans/2026-05-19.skf.v01.plan.md",
  "sidecar_path": "docs/plans/2026-05-19.skf.v01.sidecar.json",
  "target": "skf-v0.1",
  "mode": "normal|max|reviewer-off|model|dry-run",
  "flags": ["--max"],
  "spawn_context": "standalone",   // "standalone" | "pm-child" — §3.0 에서 입력 SPAWN_CONTEXT 기반 결정. §8.4 자동 시작 게이트 분기에 사용
  "started_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "frozen_at": null,

  "current_phase_id": "PH-001",
  "current_task_id": "T-PH001-02",
  "next_resume_hint": "phase-2.c (impl)|phase-1.2 (tdd-review)|phase-3.1 (regression)|...",

  "task_queue": ["T-PH001-02", "T-PH001-03", "T-PH002-01"],
  "completed_task_ids": ["T-PH001-01"],
  "skipped_task_ids": [],
  "failed_task_ids": [],
  "tdd_exempted_task_ids": [],
  "tdd_pending_task_ids": [],

  "severity_counters": {
    "T-PH001-02": {
      "phase1": {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 0, "LOW": 0, "rounds": 1},
      "phase2": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 1, "LOW": 0, "rounds": 0}
    }
  },

  "regression_summary": {
    "last_run_at": "ISO-8601",
    "scope": "full|impacted-only|skipped",
    "passed": 142, "failed": 0,
    "regressed_files": []
  },

  "mcp_call_log": [
    {
      "called_at": "ISO-8601",
      "tool": "add_verification_evidence",
      "args": { "...": "원본" },
      "args_hash": "sha1...",
      "ok": true,
      "response_hash": "sha1...",
      "dry_run": false,
      "task_id": "T-PH001-01"
    }
  ],

  "pending_mutations": [],

  "tool_versions": {
    "kiwi_planner": "0.6.0",
    "kiwi_coder": "0.1.0",
    "speckiwi": "2.2.3"
  }
}
```

### 7.2 tasks/{task-id}.json 스키마

```json
{
  "task_id": "T-PH001-02",
  "started_at": "...",
  "completed_at": null,
  "phase1": {
    "tdd_draft_iters": [{"iter": 1, "file_paths": [...]}],
    "sonnet4_reviews": [
      {"iter": 1, "intent_alignment": {...}, "tech_quality": {...}, "req_mapping": {...}, "red_verification": {...}}
    ],
    "red_evidence": { "...": "Phase 1.5 결과" }
  },
  "phase2": {
    "impl_iters": [{"iter": 1, "files_changed": [...], "loc_added": N, "loc_removed": M}],
    "formal_reviews": [{"iter": 1, "findings": [...]}],
    "prickly_reviews": [{"iter": 1, "findings": [...]}],
    "green_evidence": { "...": "Phase 2.i 결과" },
    "dod_check": [{"item": "...", "satisfied": true}]
  },
  "phase3": {
    "regression": {"scope": "full", "passed": 142, "failed": 0},
    "mcp_calls": [...]
  }
}
```

### 7.3 worklog.jsonl 이벤트 enum (21종) 및 호출 사이트

각 이벤트는 본문 명시 단계 종료 직후 append 의무.

| event | append 위치 | payload |
|---|---|---|
| `phase_start` | §3.2 .kiwi init 완료 직후 | { run_id, plan_path, target, mode, flags } |
| `task_start` | §4.1.1 task pop 직후 | { task_id, phase_id } |
| `tdd_exempted` | §4.1.2 TDD 면제 결정 시 | { task_id, reason } |
| `tdd_draft_done` | §4.1.3 테스트 작성 완료 후 | { task_id, iter, file_paths[] } |
| `tdd_review_done` | §4.2 Sonnet×4 결과 통합 후 | { task_id, iter, severity_summary } |
| `tdd_red_confirmed` | §4.4 red 확정 후 | { task_id, exit_code, test_case_ids[] } |
| `impl_done` | §5.1.(c) 시니어 구현 완료 후 | { task_id, iter, files_changed[] } |
| `formal_review_done` | §5.1.(e) 정형 검사 완료 후 | { task_id, iter, severity_summary } |
| `prickly_review_done` | §5.1.(f) 까칠 리뷰 완료 후 | { task_id, iter, severity_summary } |
| `test_green` | §5.1.(h) green 확정 후 | { task_id, exit_code } |
| `test_fail` | §5.1.(h) fail 시 ((g) 루프 직전) | { task_id, exit_code, failed_test_case_ids[] } |
| `regression_done` | §6.1.2 회귀 스위트 종료 후 | { task_id, scope, passed, failed } |
| `mcp_call` | §6.2 각 mutation 호출 직후 | { task_id, tool, ok } |
| `task_done` | §6.3 task 종료 처리 후 | { task_id, duration_ms } |
| `task_failed` | §0.G4 4옵션 abandon 또는 §6.1.3 회귀 2연속 시 | { task_id, cause, severity } |
| `need_user` | AskUserQuestion 호출 직후 | { task_id, reason, options[] } |
| `checkpoint` | `/clear` 사전 또는 사용자 요청 시 강제 1회 | { task_id, resume_hint } |
| `phase_end` | §8 통합 테스트 완료 (skip 포함) 후 | { run_id, summary } |
| `req_tag_exempted` | §0.17.2 면제 적용 시 (Phase 2.c) | { task_id, member_path, reason_enum_id, raw_reason? } |
| `req_tag_position_ambiguous` | §0.17.4 append 위치 모호 시 (Phase 2.c) | { task_id, member_path } |
| `req_tag_missing_observed` | §0.17.7 시니어 코더 자기 점검 (Phase 2.c, 정보성, 선택) | { task_id, member_path } |

### 7.4 재개 (`--resume`) 로직

**resume_hint enum SSOT** (13종, 위반 시 차단):
`phase-1.1` (tdd-draft) / `phase-1.2` (tdd-review) / `phase-1.3` (tdd-improve) / `phase-1.4` (red-confirm) / `phase-2.a` (depends-check) / `phase-2.b` (mock-scan) / `phase-2.c` (impl) / `phase-2.d` (plan-code-match) / `phase-2.e` (formal-review) / `phase-2.f` (prickly-review) / `phase-2.h` (test-green) / `phase-3.1` (regression) / `phase-3.2` (mcp-mutation).

1. state.json 의 `current_task_id` 와 `next_resume_hint` 읽음
2. resume_hint 가 가리키는 단계로 직접 점프 (예: `phase-2.c` → 시니어 구현 재시작)
3. 이전 단계 산출물 (test 파일, 변경된 코드) 은 그대로 유지 — 멱등성:
   - `phase-1.1`: test 파일 SHA256 비교, 변경 없으면 skip
   - `phase-2.c`: 시니어 코더에게 "이전 시도 코드는 디스크에 있음, 검토 후 다음 라운드 작성" 지시
   - `phase-3.1`: 회귀 결과가 24시간 이내면 재사용 (사용자 동의)
4. resume_hint 가 enum 외 값이면 차단 + 사용자에게 state.json 수동 수정 권고

---

## 8. 통합 테스트 (Phase 4, 선택)

### 8.1 조건

- 모든 task 가 completed_task_ids[] 에 진입
- `--skip-integration` 부재
- 사용자 동의 (`--auto-integration`/`--yes-all` skip)

skip 시(`--skip-integration` 명시 또는 사용자 거부)에도 **§8.3 최종 보고서는 항상 생성**. 보고서 §8 (통합 테스트 보고서) 섹션은 "skipped: {reason}" 으로 채움.

### 8.2 플로우 (snoworca-coder §5 차용)

1. 의도 추출 (target goal + REQ 전체 AC 합집합)
2. 통합 테스트 작성 (Opus 시니어, Phase 간 연계 / end-to-end / 경계)
3. 정형 + 까칠 리뷰 (Phase 2.e/f 동일)
4. 개선 루프 (심각도 카운터, 통합 시도 단위)
5. 실행 → 실패 시 관련 Phase 역순 재진입 (최대 3회)
6. 4회차 진입 직전 4지선다: 중단 / 추가 1회 / REWORK 모드 (delta 생성 후 kiwi-planner 재호출 권고) / kiwi-srs-research 호출

### 8.3 최종 보고서

`cwd/.kiwi/sessions/{run-id}/reports/coder-{run-id}.md`:

frontmatter:
```yaml
---
run_id: ...
plan_run_id: ...
target: ...
last_phase: phase-N | done
last_task: T-PHnnn-mm | null
next_skill: kiwi-coder (잔존 task 있음) | kiwi-srs-research (검증 필요) | null
state_ref: ./state.json
---
```

본문 9개 섹션 (snoworca-coder §8.2 와 동일 구조):
1. 사용된 플래그 + 비용 배수
2. Phase별 Task 완료 상태 + TDD 적용/면제 통계
3. 계획-코드 매핑 결과
4. Sonnet×4 TDD 검증 통계 (round별)
5. 까칠 리뷰 findings 통계 (severity별)
6. 테스트 결과 (task별 + 통합)
7. 회귀 결과 (passed/failed/regressed 파일)
8. MCP mutation 요약 (4종별 호출 수)
9. 메타 (mode, 실측 토큰 추정, 총 소요 시간)

### 8.4 kiwi-review-fix-loop 후속 권고 + 자동 시작 게이트 (단독 실행 시)

본 스킬이 `kiwi-pm` 자식이 아닌 **단독 실행** (사용자가 `/kiwi-coder` 직접 호출) 으로 종료 시에만 발동. PM 자식 spawn 인 경우 부모 `kiwi-pm` §6.4 가 후속 처리하므로 본 §8.4 skip (`state.spawn_context == "pm-child"` 판정).

(가드: `state.spawn_context == "pm-child"` 인 경우 본 §8.4 전체 skip — Skill 호출 자체 시도 금지. PM 컨텍스트 격리 정책 준수)

단독 실행 시: §8.3 최종 보고서 작성 직후, 사용자에게 다음 안내:

> "본 plan 의 REQ status 가 `implemented` 로 승급되었습니다. 회귀 검증 + 까칠 리뷰를 거쳐 `verified` 로 닫으려면 `/kiwi-review-fix-loop --close-reqs` 를 호출하십시오."

`AskUserQuestion` 3지선다:
- `(1) 지금 자동 시작` — 메인 세션에서 `Skill(skill="kiwi-review-fix-loop", args="--close-reqs --auto")` 호출 (본 스킬의 `--model` / `--max` / `--mini` / `--loops N` 활성 시 args 에 전파 — loop-option.md §6)
- `(2) 나중에 수동`
- `(3) skip` — verified 닫지 않음

`--auto` 모드 시: (1) 자동 채택 + severity 가드레일 — `state.failed_task_ids[]` 비어있지 않거나 회귀 fail 잔존 시 (3) 자동 채택 (verified 닫기 부적합).

자동 시작 시 후속 review-fix-loop 의 종료 상태 (`closed_reqs.json`) 는 본 coder 보고서 §10 "후속 close 결과" 신규 섹션에 첨부 (best-effort, review-fix-loop 종료 직후 갱신).

본 §8.4 의 mutation (verified 전이) 은 review-fix-loop §6.6 에 위임 — kiwi-coder 의 mutation 4종 (§0.12) 외 신규 호출 없음.

---

## 9. 호출 예시

```
/kiwi-coder
/kiwi-coder PLAN_PATH=docs/plans/2026-05-19.skf.v01.plan.md
/kiwi-coder PLAN_PATH=... TASK_FILTER=T-PH001-01,T-PH001-02
/kiwi-coder PLAN_PATH=... PHASE_FROM=2 PHASE_TO=3
/kiwi-coder PLAN_PATH=... --max
/kiwi-coder PLAN_PATH=... --reviewer-off --skip-regression
/kiwi-coder PLAN_PATH=... --model claude-sonnet-4-6
/kiwi-coder PLAN_PATH=... --resume
/kiwi-coder PLAN_PATH=... --dry-run
```

---

## 10. Out of Scope

| 범위 밖 | 담당 스킬 |
|---|---|
| 계획 생성 | `kiwi-planner` |
| SRS/요구사항 작성 | `kiwi-srs` |
| 구현 후 간극 검토 | (예정) `kiwi-reviewer` |
| 실현가능성 사전 판단 | `kiwi-srs-feasibility` |
| 외부 도구 비교 / 학습 | `kiwi-srs-research` |
| PR/이슈 생성 | 본 스킬은 코드 변경만; PR 은 사용자 결정 |
| git commit / push | 사용자 결정 (시그니처 금지 §0.10) |

---

## 11. v0.x → v1.0 마일스톤 (예고)

- v0.2: `--pm-child` 헤드리스 자식 모드 (kiwi-pm 등장 시)
- v0.3: 통합 테스트 단계 자동 회귀 분배 강화
- v0.4: `--imt` (계획 없이 즉시 코딩) 재도입 검토 (TDD 강제 유지)
- v1.0: snoworca-coder 의 모든 호환 채널 제거 확정

---

## 12. Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

**호출 컨텍스트별 정책**:
- **단독 호출 (사용자 직접)**: 본 스킬이 emit. `skill: "kiwi-coder"`, `next_hint`: 통상 `"kiwi-review-fix-loop"` (`--close-reqs` 검증 권고). commit 은 review-fix-loop 통과 후 `kiwi-review-fix-loop` 의 `next_hint` 로 진행.
- **kiwi-pm 자식으로 spawn**: 본 스킬은 emit 하지 않는다 — 부모(`kiwi-pm`) 의 Task 종료 시 부모가 일괄 emit. 자식의 결과는 부모의 보고에 인용.

- `req_ids`: 본 Task 가 영향을 미친 REQ-ID 배열
- `artifacts.analysis_dir`: `docs/analysis/kiwi-coder-{run-id}/` 또는 `.kiwi/sessions/{run-id}/`
- `status`: TDD green + 회귀 PASS = `TASK_DONE`; business-decision = `NEEDS_USER`; 회귀 실패 = `FAILED`

emit 실패는 best-effort.
