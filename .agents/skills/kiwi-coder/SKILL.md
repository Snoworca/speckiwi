---
name: kiwi-coder
description: "kiwi-sds 가 합의(agreed)한 lite SDS 한 파일(docs/sds/<sds-id>.sds.md)을 입력으로 받아 그 SDS 를 한 번의 실행으로 구현하는 코딩 스킬 v0.1 — SDS 의 Interfaces · Acceptance Contracts · Test Plan 과 @req 요구의 SRS AC 를 읽고 TDD 선행(테스트 줄에 `<REQ-ID> AC-<n>` / `SDS-AC-<n>` 인용) → TDD 검증(기본 서브에이전트 1, --max 2 병렬) → high-reasoning 시니어 구현 → SDS-코드 일치 게이트 → 정형 검사 → 까칠 리뷰 → 개선 루프 → 테스트 실행 → 회귀 검증 → speckiwi MCP mutation → .kiwi/ 상태 갱신을 자동화한다. 재개 가능. 트리거: SDS 대로 구현, kiwi 코딩, tdd 코딩, SDS 구현, kiwi sds 구현. --auto 는 공용 auto-option 정책으로 메인 게이트와 후속 kiwi-review-fix-loop --close-reqs handoff를 자동화하되 --yes-all/--auto-integration/--auto-cost-warning은 자동 활성하지 않음. 검증(정형 검사·까칠 리뷰) 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 그 모델을 override 한다."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-coder v0.1.9

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

## Official Workflow Tool Policy

For covered workflow artifact flows, use official SpecKiwi workflow tools before raw file reads or manual appends:

1. Read the SDS and resume state through MCP `check_sds`, `get_next_work_order`, `workflow_resolve_artifact` with `kind` `coder-state` and `includeBody` `true` (the coder's `state.json`), and `workflow_worklog_tail` before reading `docs/sds`, `.kiwi/sessions`, worklogs, or pipeline JSONL directly.
2. Use guarded workflow mutations (`workflow_worklog_emit`, `workflow_pipeline_emit`, and `workflow_repair_record`) before shell JSONL append snippets for covered workflow journals.
3. Local coder state files remain runtime state, but any covered workflow projection or journal update must prefer the official reader/mutation envelope so diagnostics, hashes, stale guards, and owner metadata are preserved.
4. Raw file fallback is degraded mode. It is allowed only after capturing tool diagnostics, affected artifact paths, active target, and a follow-up requirement or candidate ID in `state.json`, the run report, or worklog.

`$kiwi-sds` 가 합의(`agreed`)한 lite SDS 한 파일을 입력으로 삼아, 그 SDS 의 테스트를 먼저 작성·검증한 뒤 본 구현을 진행하는 코딩 자동화 스킬. SDS 하나를 한 번의 실행으로 구현하며, SDS 의 문법과 검사는 `docs/rule/SDS-MD-Rules-v2.6.0.md` §9 가 정본이다 — 본 스킬은 그 문법을 다시 적지 않는다. snoworca-coder 의 구현 루프 로직만 차용하고 speckiwi MCP 를 1급 시민으로 사용한다. **모든 작업 상태는 `cwd/.kiwi/` 에 영속화하여 새 세션에서 재개 가능**.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 강제**. 모든 SDS 실행은 (1) 테스트 작성 → (2) TDD 검증 → (3) red 실패 확인 → (4) 구현 → (5) green 확인 순서. 우회 금지. TDD 면제 경로는 없다 |
| §0.2 | **SDS 입력 SSOT**. 입력은 `$kiwi-sds` 가 합의한 lite SDS 한 파일이다 — `docs/sds/<sds-id>.sds.md`, `Profile = lite`, Status `agreed`, `speckiwi sds check` error 0. 거부 시 안내: "`$kiwi-sds` 로 SDS 를 작성·합의하십시오". 본 스킬은 SDS 를 고치지 않는다 — 설계가 틀렸으면 §0.22 대로 보고한다 |
| §0.3 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부. `_shared/snoworca/` 모듈 로드도 금지 |
| §0.4 | **검증자는 별도 서브에이전트**. 인라인 자가검증 금지 (project verification rule) |
| §0.5 | **검증자 입력 격리**. 시니어 코더의 결론·정당화 전달 금지. 원본 SDS + 관련 SRS AC + 작성된 코드 + 테스트만 |
| §0.6 | **Mock 금지** (regex 자동 탐지). CRITICAL severity |
| §0.7 | **ZERO TOLERANCE SDS-코드 일치 게이트**. SDS Interfaces 의 Files · 심볼 선언과 `← caller` 연결이 실제 코드와 어긋나면 CRITICAL (§5.1.(d)) |
| §0.8 | **사용자 확인 의무**. 외부 모듈 영향, SDS Files 밖 파일 변경, 통합 테스트 실행, MCP mutation 회수 ≥10건 batch 시 모두 Codex clarification gate |
| §0.9 | **외부 모듈 수정 금지**. cwd 외부 path 가 SDS Files 또는 실제 변경에 진입 시 즉시 중단 + Codex clarification gate (§0.G2) |
| §0.10 | **시그니처 금지** (project signature-ban instruction). 커밋 메시지·코드 주석·산출물 어디에도 AI 식별 정보 금지. `Co-Authored-By` 등 자동 추가 차단 |
| §0.11 | **`.kiwi/` 상태 영속**. 모든 단계 종료마다 `cwd/.kiwi/sessions/{run-id}/state.json` 갱신 + `worklog.jsonl` append. checkpoint 의무 (§7) |
| §0.12 | **MCP mutation 4종 SSOT**. 허용 = `add_trace_link` (Code anchor) / `add_verification_evidence` (type=test) / `update_status` / `add_completed_work` 4종. mutation 호출 1건 = state.json `mcp_call_log[]` 1건 (멱등 dedupe: args_hash) |
| §0.13 | **회귀 테스트 의무**. 실행 종료 시 (1) 영향받는 test 파일 실행 + (2) 전체 회귀 스위트 실행. `--skip-regression` 플래그 명시 시에만 (2) skip, (1) 은 항상 실행 |
| §0.14 | **run-id SSOT**. 부모 `kiwi-pm` 이 넘긴 `RUN_ID` 를 그대로 쓴다 (`.kiwi/sessions/{RUN_ID}/`). 단독 실행이면 SDS 파일 이름에서 `.sds.md` 를 뺀 `sds_id` 를 쓴다. `run_id` = `[a-z0-9.-]{4,128}` — 벗어나면 §0.G3 차단 |
| §0.15 | **SDS 1 : 실행 1**. SDS 하나가 곧 작업 단위다. 메인이 임의로 SDS 를 나누거나 합치지 않는다 — 한 실행에 너무 크면 `$kiwi-sds` 가 여러 SDS 로 나눈다 |
| §0.16 | **검증 서브에이전트 모델 정책 SSOT**. 까칠 리뷰 등 검증 서브에이전트는 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 검증 서브에이전트의 모델을 override 한다 (시니어 코더는 영향 없음). **TDD 검증 (Phase 1.2) 은 기본 서브에이전트 1 개, `--max` 에서 2 개 병렬**이다 (§4.2). 심각도 게이트·회귀 테스트 의무는 불변 |
| §0.17 | **`@req` 태그 부착 (참고용 SSOT)**. 본 §0.17 은 글로벌 project editing guidance (Simplicity / Surgical Changes) 의 코멘트 보수성 가이드보다 본 skill 내부에서 **우선**한다. 세부 규약은 §0.17.1~§0.17.7. **본 태그는 순수 참고용** — speckiwi `add_trace_link` 가 SSOT, 태그는 rg/search 보조. REQ rename/deprecate 시 자동 갱신 의무 없음 (부패 허용). **운영 순서 SSOT** (시니어 코더 단계별): (1) §0.17.1 의무 범위 + §0.17.2 면제 enum 판정 → (2) 면제 시 worklog `req_tag_exempted` append + skip / 의무 시 다음 → (3) §0.17.5 lenient 정규식으로 기존 토큰 set 추출 + 새 토큰 dedupe 검사 → (4) 일치 시 skip / 미일치 시 §0.17.4 위치 결정 → (5) 위치 모호 시 worklog `req_tag_position_ambiguous` + 보류 / 결정 시 §0.17.3 wrapper-tolerant 정규식 형식으로 신규 라인 작성 |
| §0.17.1 | **의무 범위**. **구현 단계 (Phase 2.c) 에서 새로 정의되는 클래스/메서드/함수** 에 한해 부착 의무 (가시성 제한 없음 — public/private 무관). 붙일 REQ-ID 는 그 정의가 놓인 SDS Files 항목과 심볼 줄이 `@req` 로 지명한 것이다. 함수 정의 = 명명 함수 (named function/method) + lambda/closure/arrow function (단, §0.17.2 enum (5) 의 private 1라인 lambda 는 면제). 부착 위치 = 정의 직전 라인 또는 docstring 첫 줄. **테스트 파일은 부착 의무 대상에서 제외** — 식별 SSOT: (a) SDS Test Plan 이 지명한 모든 테스트 파일, (b) 경로 정규식 `(^|/)(tests?|__tests__|spec|e2e|integration)(/|$)` 매칭 디렉토리 내 파일, (c) 파일명 정규식 `\.(test|spec)\.[a-zA-Z]+$` 매칭 파일. 통합 테스트 (§8.2 산출물) 도 본 면제에 포함. 테스트의 요구 매핑은 테스트 줄의 `<REQ-ID> AC-<n>` / `SDS-AC-<n>` 인용이 SSOT (§4.1.3) |
| §0.17.2 | **면제 enum (closed-list, 시니어 재량 없음)**. 아래 8종만 면제: (1) 1라인 getter (`return this.x`), (2) 1라인 setter (`this.x = v`), (3) 언어 자동 생성 메서드 명시 (Java toString/hashCode/equals, JS Object.prototype.*, Python `__repr__`/`__eq__`/`__hash__`/`__init__` 자동 생성, Rust `#[derive(...)]` / procedural attribute macro `#[...]` (예: `#[tokio::main]`, `#[async_trait]`) / function-like macro `macro!(...)` (예: `lazy_static!{}`, `bitflags!{}`) 가 생성한 메서드, Go receiver method 자동 생성), (4) IDE 자동 생성 boilerplate constructor (필드 대입 (다중 가능) + `super(...)` 호출 + null-coalescing default 까지 허용. 비즈니스 로직·검증·side effect 가 1줄이라도 포함되면 부착 의무), (5) private 1라인 lambda/helper (가시성 무관 의무 §0.17.1 에 따라 lambda 도 의무 — 본 enum 항목으로만 면제), (6) 인터페이스/추상메서드 (구현 없음), (7) override 시 부모에 이미 `@req` 가 있고 **부모가 cwd 내부일 때만** (부모가 외부 라이브러리면 enum 7 미적용 = 부착 의무), (8) IDE/언어/매크로가 인간 작성 없이 자동 생성한 메서드 일반 (worklog 사유에 `reason_enum_id=8` + `raw_reason` 부가 **의무**). **결정 알고리즘**: enum (1)~(7) 매칭 패턴이 있으면 우선 분류 (raw_reason 불필요), enum (1)~(7) 어디에도 매칭 안 되는 자동 생성 메서드만 enum (8) 사용 — Rust derive 같이 enum (3) 명시 항목이 있는 경우는 항상 (3). **면제 적용 시 worklog `req_tag_exempted { sds_id, member_path, reason_enum_id, raw_reason? (enum=8 필수, 그 외 생략) }` append 의무** (§7.2). enum 외 사유로 면제 불가 |
| §0.17.3 | **형식·정규식 SSOT**. REQ-ID 토큰 형식 정규식: `[A-Z][A-Z0-9-]*[A-Z0-9]` (trailing hyphen 차단, 2자 이상). **단일 라인/wrapper-tolerant 정규식** (신규 부착 검증용 + §0.17.6 운영 면책용 공용, line-anchored, 부가 표기 흡수, **1라인 1 REQ-ID**): `^\s*([/*#]+\s*)?@req\s+[A-Z][A-Z0-9-]*[A-Z0-9](\s*\(.+?\))?\s*\*?/?\s*$`. 라인 시작 anchor `^` 강제 — 코드+태그 섞임 라인 (예: `let x=1; // @req X`) 매칭 차단. trailing 부가 표기 흡수 — `\s*\(.+?\)` non-greedy 라 공백 유무 무관 (`@req X (legacy)` / `@req X(legacy)` 둘 다 매칭). 다중 REQ → 라인 분리. 언어별 주석 스타일: TS/JS/Java/Go/Rust/C/C++ = `// @req X`, Python/Ruby/Shell = `# @req X`, JSDoc/JavaDoc multi-line = `* @req X` (단일 라인 `/** @req X @param y */` **금지**). **REQ-ID 토큰의 실재성 (speckiwi 조회) 은 본 skill 어디서도 검증하지 않음** (§0.17.6 면책). 형식적 무결성도 검증 안 함 — REQ-ID 형식은 speckiwi/kiwi-srs 가 보장하는 외부 책임. 형식 위반 토큰 (1자, trailing hyphen 등) 은 라인 정규식 매칭 실패로 자연 차단됨. dedupe 비교는 §0.17.5 의 lenient 정규식 사용 (별도 용도) |
| §0.17.4 | **append 위치 SSOT + docstring 정의**. docstring 정의 (언어별): Python `"""..."""` 또는 `'''...'''` triple-quoted / JSDoc·JavaDoc `/** ... */` block / Rust `///` line-doc + `/** */` block-doc / TS·C#·PHP `/** */`. **docstring 개념이 없는 언어 (Go·Bash 등) 는 항상 (b) 외부 분기 적용**. append 규칙: (a) 기존 `@req` 라인이 docstring 내부면 마지막 `@req` 라인 직하 (동일 docstring block 내부) 에 새 라인 추가. (b) 외부 (정의 직전 주석 블록) 면 외부의 마지막 `@req` 라인 직하. 기존 라인 사이 삽입·재배치·삭제 금지. 위치 모호 시 시니어는 추가 보류 + worklog `req_tag_position_ambiguous { sds_id, member_path }` 기록 (§7.2). 보류된 멤버는 §0.17.7 의 부착 누락 상태로 간주 — `req_tag_missing_observed` 도 함께 append 가능. **mixed-location 케이스** (한 멤버에 docstring 내부 + 외부 양쪽에 기존 `@req` 가 모두 존재) 는 docstring 내부를 우선 — Python·JSDoc 자연스러운 문서 통합 위치. 단 모호 시 보류로 fallback |
| §0.17.5 | **dedupe SSOT**. 기존 라인에서 REQ-ID 토큰을 추출할 때는 **lenient 정규식 (dedupe 전용)** `@req\s+([A-Z][A-Z0-9-]*[A-Z0-9])` (§0.17.3 와 동일 REQ-ID 형식, line-anchored 제거) 으로 lenient 검색. 부가 표기 (예: `@req FR-X-001 (legacy)` 의 `(legacy)`, 단일 라인 다중 태그 `/** @req X @param y */`) 가 붙은 비정상 라인에서도 토큰 추출. 추출된 모든 REQ-ID 토큰의 set 을 기존 부착 토큰 set 으로 간주. 새 토큰이 set 에 case-sensitive 일치 시 dedupe (추가 금지). **§0.17.3 wrapper-tolerant 정규식 (line-anchored, 부착 검증 + §0.17.6 면책 공용) 과 본 §0.17.5 lenient 정규식 (line-anchored 미적용, dedupe 전용) 은 별개 SSOT** — 두 정규식의 분리 사용으로 dedupe 의 부가 표기 흡수 (§0.17.5) 와 면책의 코드+태그 섞임 차단 (§0.17.3/§0.17.6) 동시 보장 |
| §0.17.6 | **포괄 면책 (검증 leak 차단) + 운영 알고리즘**. `@req` 태그는 본 skill 의 다음 모든 단계에서 점검·비교·검증·존재 여부 확인 대상이 **아니다**: §0.G1~§0.G5 게이트, §4.2 TDD 검증, §5.1.(b) Mock 금지 regex 스캔, §5.1.(d) ZERO TOLERANCE SDS-코드 일치 게이트, §5.1.(e) 정형 검사, §5.1.(f) 까칠 리뷰, §5.1.(j) SDS-AC 검증, §6.1 회귀 테스트, §6.2 MCP mutation, §8.2 통합 테스트 정형/까칠 리뷰. **§0.7 의 ZERO TOLERANCE 평가 알고리즘 SSOT**: diff hunk 의 added-only 라인 중 **§0.17.3 wrapper-tolerant 정규식** (line-anchored, 부가 표기 흡수) 매칭 라인만 변경 set 에서 제거 후 SDS Files 밖 변경 판정. 부가 표기 라인 (예: `@req FR-X-001 (legacy)`) 은 wrapper-tolerant 가 직접 흡수. **코드+태그 섞임 라인** (예: `let x=1; // @req X`, `const msg="@req X"`) 은 라인 시작 anchor `^` 와 주석 prefix 강제로 자동 차단 → 변경 set 에 포함 (false-negative 방지). §0.17.5 lenient 정규식은 본 면책에 사용하지 않음 — dedupe 전용. 어느 검증자도 `@req` 관련 finding 발행 금지 |
| §0.17.7 | **부착 누락의 처리**. 누락은 본 skill 의 어떤 게이트도 차단하지 않는다. 사후 보완은 별도 정리 작업으로 처리 (본 스킬 책임 외). 누락 발견 시 시니어 코더가 자기 점검으로 worklog `req_tag_missing_observed { sds_id, member_path }` 정보성 append 가능 (severity 없음, §7.2). 검증자는 본 이벤트 append 도 금지 (§0.17.6) |
| §0.18 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. `--auto` 는 메인 게이트 결정과 §8.4 후속 `$kiwi-review-fix-loop --close-reqs --auto` handoff 에만 적용한다. `--yes-all`, `--auto-integration`, `--auto-cost-warning` 은 사용자가 명시했을 때만 활성화된다. |
| §0.19 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 대체 대상 카운터는 §0.G4 의 셋 — 시니어 코더 재호출, TDD 검증자 재호출, 까칠 리뷰어 재호출 — 이며 그 외 게이트 카운터는 불변. 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §0.20 | **기존 테스트 불가침**. green 을 만들기 위한 **기존 테스트 파일 삭제**, **기존 테스트 케이스 제거**, **기존 단언 약화**를 모두 **금지**한다 — 통과하지 않는 테스트는 구현을 고쳐서 닫는다. 테스트를 지우면 그 시점에 회귀 안전망이 사라지고, 이후 라운드는 사라진 계약을 검증하지 못한다. 계약 자체가 바뀌어야 하면 SDS/SRS 를 먼저 고쳐 §0.7 을 다시 통과한다. 탐지·차단 = §5.1.(d) + §0.G6 `existing-test-weakened-or-deleted` |
| §0.20.1 | **기존** 의 판정. 그 실행의 **기준선 커밋** (`state.regression_baseline.head_sha`) 시점에 이미 존재하던 파일 · 테스트 케이스 · 단언 · 심볼만 "기존"이다 — 같은 실행 안에서 새로 만든 것은 §0.20 의 대상이 아니다. `regression_baseline` 이 null (§3.5 캡처 실패) 이면 그 실행의 첫 편집 직전 HEAD 를 기준선 커밋으로 쓴다. 시점을 고정하지 않으면 방금 쓴 red 테스트를 고치는 일까지 같은 금지에 걸린다 |
| §0.20.2 | **public 심볼** 의 판정. 기준선 커밋 시점에 그 모듈의 **export 표면** (언어별 `export` 선언 / `public` 선언 / 패키지 공개 API 목록) 에 있던 이름만 public 이다 — 경로 토큰 휴리스틱 (`api/` · `public/` 등) 으로 대신하지 않는다. 계약 파손은 경로가 아니라 심볼에서 일어난다 (§0.G6 `existing-public-contract-change`) |
| §0.20.3 | **약화** 의 판정 (closed list — 넷이 전부이며, 넷 중 하나라도 diff 에 있으면 약화다). (1) **단언 삭제**, (2) 단언 술어를 더 느슨한 것으로 교체 (동등 비교 → 존재 확인 등), (3) 케이스의 `skip` / `only` / 주석 처리, (4) **기대값**을 관측값으로 교체. 판정에 시니어 재량 없음 — 목록 밖의 사유로 약화를 면제하지 않는다 |
| §0.20.4 | **증거 기반 해소**. 기존 파일의 삭제·이동(§0.G6 `existing-file-deleted-or-moved`, 검출 지점 §5.1.(d)) 과 기존 public 심볼의 삭제·시그니처 변경(동 `existing-public-contract-change`) 은, 근거가 **둘 중 하나**면 `intended-improvement` 로 기록하고 진행한다 — 그 변경을 요구하는 **REQ-ID** 가 SDS `@req` 집합에 있거나, 합의된 SDS 의 SDS-AC 줄이 그 이동·삭제·시그니처 변경을 **명시**하는 것. 근거는 판정 기록에 REQ-ID 또는 SDS-AC id 로 적는다. 근거를 대지 못한 변경은 `unapproved-damage` 이며 critical 이다 — SDS Files 등재는 편집 허가일 뿐 제거 허가가 아니다. **단 §0.20.3 의 약화와 기존 테스트 삭제는 같은 근거로 해소되지 않는다** — 기준을 낮추는 것은 어떤 설계도 승인할 수 없다. 본 판정은 `kiwi-wave-master §5.5.2` 의 보존 계층과 **같은 두 값 enum · 같은 근거 요건**을 쓴다 |
| §0.21 | **주석은 저 혼자 움직이는 것을 가리키지 않는다**. 코드 주석에 **줄번호 인용 금지** (`file.md:412` · `helper.ts:40-52` 형태) — 인용 대상 파일이 편집되면 조용히 틀려지고, 틀린 줄번호를 다시 찾아주는 일이 곧 검증 비용이다. 대신 **함께 움직이는 이름**으로 가리킨다: 코드 **심볼**명 · 문서 **헤딩** 제목 · `@req <REQ-ID> AC-N`. 불가피하면 그 줄에 `@cite-lint: ignore` 를 붙인다 (줄 단위 범위 — 파일 단위 면제는 없다). 같은 이유로 열거된 집합의 **개수를 옮겨 적지 않는다** — 집합 이름으로 부르거나, 단언에서 그 집합으로부터 세어 쓴다 |
| §0.22 | **요구는 틀릴 수 있다 — 우회하지 말고 보고한다**. 구현 중 요구와 코드가 어긋나면 요구를 억지로 만족시키는 우회 구현을 하지 않고 그 자리에서 보고한다. 충돌로 보는 것 셋: (1) 요구가 단언한 사실을 코드가 반증한다, (2) 기준을 적힌 대로는 만족시킬 수 없다, (3) 같은 요구의 두 부분이 서로 다른 답을 낸다. 해소는 **요구를 고치거나**(그 수정은 해당 요구의 Change Notes 에 남는다) **그대로 두는 이유를 기록**하는 것이다 — 저자가 알아보지 못할 방식으로 기준의 문면만 맞추는 것은 해소가 아니다 |
| §8.4 참고 | `--mini`/`--loops N` 는 kiwi-review-fix-loop follow-up 에 전파 (loop-option.md §6) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — TDD 우회 차단

| IF | THEN |
|---|---|
| SDS 의 SDS-AC 에 Test Plan 행이 없음 (`speckiwi sds check` 가 이미 SDS-E064 로 거부) | 차단 + 사용자 보고 ("`$kiwi-sds` 로 Test Plan 을 채우십시오") |
| 시니어 코더가 테스트 작성 단계 skip 시도 | 차단 + Phase 1 재진입 강제 |
| Phase 1 검증(검증 서브에이전트 + 스크립트 판정 2종)에서 1개라도 CRITICAL finding 잔존 | Phase 2 (구현) 진입 차단, Phase 1.3 개선 루프 |
| green 확인 실패 (구현 후에도 test 가 fail) | Phase 2.g 개선 루프 편입 (HIGH 카운터 소모) |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| SDS Files 또는 실제 변경에 cwd 외부 path | 즉시 중단 + Codex clarification gate 3옵션: (1) 진행 승인 / (2) 외부 path 제외 / (3) 작업장 이동 후 재실행 |
| 시니어 코더가 cwd 외부 파일 편집 시도 | 즉시 차단 + CRITICAL |
| 회귀 테스트가 cwd 외부 모듈 실패 | WARN 만, 차단 안 함 (외부 책임) |

#### §0.G3 — 입력 SDS 무결성

| IF | THEN |
|---|---|
| `SDS_PATH` 없음 | 거부 + `$kiwi-sds` 로 SDS 를 먼저 작성·합의하라고 안내 |
| `Profile ≠ lite` 또는 경로가 `docs/sds/*.sds.md` 가 아님 | 거부 — tdd step `design.md` 는 `$kiwi-tdd` 몫 |
| Status ≠ `agreed` | 거부 + `$kiwi-sds` 로 합의 안내 |
| `check_sds` (MCP) 가 error 급 진단을 돌려줌 | 거부 + 진단 코드 목록 |
| `run_id` 정규식 위반 (§0.14) | 거부 |

#### §0.G4 — 개선 루프 발산

| IF | THEN |
|---|---|
| 시니어 코더 재호출 3회 누적 | Codex clarification gate 4옵션 (§7.3) |
| TDD 검증자 재호출 3회 누적 + 동일 finding 잔존 | Codex clarification gate 4옵션 |
| 까칠 리뷰어 재호출 2회 누적 + 동일 finding 잔존 | Codex clarification gate 4옵션 |
| 회귀 테스트 2회 연속 동일 파일 fail | 즉시 사용자 에스컬레이션 + state.json `failed = true` |

4옵션: `(1) draft-keep` / `(2) partial-commit` / `(3) force-proceed (사용자 책임)` / `(4) abandon-run` (이번 SDS 실행 중단).

#### §0.G5 — MCP mutation 가드

| IF | THEN |
|---|---|
| `update_status` 호출이 REQ status 를 backward (verified → implemented 등) 전이 | 차단 + WARN |
| `add_completed_work` 호출 `summary` 가 SDS-AC 결과와 불일치 | 차단 + 시니어에게 SDS-AC 결과 재확인 요구 (summary 텍스트에 SDS-AC 결과 인코딩 필수, §6.2) |
| MCP 도구 미가용 (preflight 실패) | 정상 SRS reads/mutations 중단. CLI 는 설치/버전/설정 진단과 MCP 복구 안내에만 사용하고, mutation 대체 실행 금지. state.json `pending_mutations[]` 적재 + 사용자 보고 |
| 4종 외 호출 시도 | 차단 + 시니어 로직 재검토 |

#### §0.G6 — `--auto` critical_gates[]

`--auto` 활성 시에도 아래 게이트는 사용자 강제 HALT 이며 결정 서브에이전트로 우회 금지 — 자동 결정이 대신 닫으면 게이트가 없는 것과 같다.

| gate_id | reason | location |
|---|---|---|
| `external-module-impact` | SDS Files 또는 실제 변경이 cwd 외부 path 진입 (§0.9 / §0.G2) | §0.G2 |
| `zero-tolerance-sds-code-mismatch` | SDS Interfaces 의 Files · 심볼 선언 · `← caller` 연결 ↔ 실제 코드 불일치 (§0.7) | §0.7 / §5.1.(d) |
| `mock-detection` | Mock regex 자동 탐지 CRITICAL (§0.6) | §0.6 / §5.1.(b) |
| `tdd-bypass-attempt` | TDD 우회 시도 (§0.G1 — 시니어가 테스트 작성 단계 skip 시도 / SDS-AC 에 Test Plan 행 부재) | §0.G1 |
| `improvement-loop-divergence-4opt` | §0.G4 4옵션 게이트 발동 (시니어/TDD 검증자/까칠 누적 + 회귀 2회 연속 fail) | §0.G4 / §7.3 |
| `mcp-mutation-backward-status` | `update_status` backward 전이 시도 (§0.G5 Rule 1) | §0.G5 |
| `mcp-mutation-batch-large` | MCP mutation ≥10건 batch (§0.8) | §0.8 |
| `integration-test-user-consent` | 통합 테스트 실행 사용자 동의 (§8.2) — `--auto-integration` 부재 시 사용자 결정 필요 (본 게이트는 `--auto-integration` 명시로 우회 가능 — `--auto` 자동 활성 안 함 §0.18) | §8.2 |
| `cost-warning-large-task` | 비용 경고 (실행 시간 ≥10분) — `--auto-cost-warning` 부재 시 사용자 결정 (본 게이트도 `--auto-cost-warning` 명시로만 우회 — §0.18) | §3.4 / §6.1 |
| `followup-review-fix-loop-close-unsafe` | §8.4 후속 review-fix-loop 자동 시작 시 `state.failed` 이거나 회귀 fail 잔존 — verified 닫기 부적합 (§8.4) | §8.4 |
| `existing-test-weakened-or-deleted` | diff 에서 기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화 검출 (§0.20 / §5.1.(d)) | §5.1.(d) |
| `existing-public-contract-change` | diff 에서 기존 public 심볼의 삭제 또는 시그니처 변경 검출 — **경로와 무관**하게 critical (path 토큰 휴리스틱이 아니다) — 해소 경로는 §0.20.4 | §5.1.(d) |
| `existing-file-deleted-or-moved` | diff 에서 비-테스트 기존 파일의 삭제·이동 검출 — SDS Files 에 등재되어 있다는 사실만으로는 해소되지 않는다 (§0.20 / §5.1.(d)) — 해소 경로는 §0.20.4 | §5.1.(d) |
| `mcp-cli-both-unavailable` | MCP 도구와 CLI fallback 이 **모두** 실패 (§0.G5) — mutation skip + `pending_mutations[]` 적재는 자동 결정으로 닫지 않는다 | §0.G5 |
| `lifecycle-gate-deprecated-or-frozen` | deprecated / frozen REQ 구현은 정책상 중단 | Phase 0 |
| `validate-spec-error` | `validate_spec` 가 error 급 진단을 하나라도 돌려줌 — 오류를 안은 요구 위에 증거와 승급을 쌓으면 그 통과가 무엇을 근거로 기록되었는지 되읽을 수 없다 | §0.12 MCP mutation — `add_verification_evidence` 직전 |

**`review-hop-start-residual-branches`**: 위 `followup-review-fix-loop-close-unsafe` 행이 덮는 것은 §8.4 3지선다의 **비가역 갈래 하나**뿐이다 — unsafe 한 상태에서 (1) 을 자동 채택해 `--close-reqs` 로 요구를 `verified` 로 닫으러 가는 경우. 나머지 두 갈래인 (2) 나중에 수동과 (3) skip 은 요구를 `implemented` 에 남기므로 나중에 그대로 다시 돌릴 수 있고, (1) 자체도 여기서 `verified` 를 쓰지 않는다 — 그 쓰기는 `kiwi-review-fix-loop` §0.G8 의 `close-reqs-with-regression-fail` · `close-reqs-critical-or-high-residual` · `bulk-close-or-finalize` 가 `--auto` 와 무관하게 항상 막는다. 그래서 3지선다 전체를 본 표에 올리지 않는다 — 올리면 모든 무인 실행이 마지막 홉에서 죽는 정지점이 되며, 이는 `kiwi-tdd` §0.AG 가 `sds-architecture-decision-approval` 을 critical 로 올리지 않은 것과 같은 이유다. 판정을 비워 두지 않기 위해 이 문단을 남긴다.

**이 게이트를 관측하는 자리**: 위 표에서 이 행의 세 번째 칸이 가리키는 홉에서 MCP `validate_spec` 을 실행한다 — MCP 가 없으면 CLI `speckiwi validate --json` 이다. error 급 진단이 하나라도 남아 있으면 그 홉을 진행하지 않고 `validate-spec-error` 로 중단하며, `--auto` 도 이 중단을 덮지 못한다. 실행하지 않은 채 통과로 기록하지 않는다.

---

## 1. 입력 / 출력

### 1.1 필수 입력

`SDS_PATH` — `$kiwi-sds` 가 합의(`agreed`)한 lite SDS 한 파일, `docs/sds/<sds-id>.sds.md`. 없으면 거부하고 `$kiwi-sds` 로 SDS 를 먼저 작성·합의하라고 안내한다 (§0.G3). 부모 `kiwi-pm` 이 spawn 하면 그 프롬프트의 `SDS_PATH` 를 쓴다.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "SDS X 로", "X 구현" | `SDS_PATH` | 없음 — 없으면 거부 (§1.1) |
| "재개" | `--resume` | off (신규 run 또는 자동 감지) |
| "max 모드" | `--max` | off (Normal) |
| "리뷰어 off" | `--reviewer-off` | off (까칠 리뷰어 유지) |
| "회귀 skip" | `--skip-regression` | off (회귀 의무) |
| "기준선 받아서", "부모 기준선" | `--regression-baseline <path>` | off (자기 시점 캡처) |
| "자동 진행" | `--yes-all` | off |
| "통합 테스트 skip" | `--skip-integration` | off |
| "통합 테스트 자동 동의" | `--auto-integration` | off (사용자 동의 게이트 유지) |
| "비용 경고 자동 skip" | `--auto-cost-warning` | off |
| "자동", "auto", "묻지 말고" | `--auto` | off (`../_shared/kiwi/auto-option.md`; 기존 세부 자동 옵션은 자동 활성하지 않음) |
| "--model <name>", "검증 모델 지정", "다른 모델로 검증" | `--model <name>` | 현재 세션 모델 (까칠 리뷰 검증 서브에이전트에 적용) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |
| "dry-run" | `--dry-run` | off (MCP mutation 미실행) |
| "mutation 이연", "큐에만 기록" (오케스트레이터 전달) | `--defer-srs-mutation <path>` | off (§6.2 mutation 즉시 호출) |

**`--drive` (FR-FLOW-119)**: 부모 `kiwi-wave-master` 가 `--drive` 로 시작한 무인 실행에서는 `--drive` 가 `--auto-integration` 과 `--auto-cost-warning` 을 함께 켠 것으로 본다 — `integration-test-user-consent` 와 `cost-warning-large-task` 두 게이트는 열린다. 그 밖의 어떤 게이트도 `--drive` 로 열리지 않으며, 특히 `existing-test-weakened-or-deleted` · `existing-public-contract-change` · `existing-file-deleted-or-moved` · `mock-detection` · `tdd-bypass-attempt` 는 `--drive` 에서도 사용자 결정이다.

**부모 체인 pass-through**: `--auto-integration` (§8.1 통합 테스트 동의 게이트) 와 `--auto-cost-warning` (§3.4 / §6.1 비용 경고 게이트) 는 사용자 직접 호출뿐 아니라 `kiwi-pipeline → kiwi-pm → kiwi-coder` 체인과 `kiwi-wave-master`/`kiwi-orchestrator` → 워커(`_shared/kiwi/parallel-waves.md` PW-6) → `kiwi-pm` → `kiwi-coder` 체인으로 그대로 전달되어 도달한다 — 중간 스킬은 값을 새로 만들지 않고 받은 것을 넘기기만 한다. 무인 실행에서 이 두 게이트가 사용자를 기다리다 멈추는 것을 막는 유일한 경로가 이 전달이다. 명시 전달이 없으면 두 옵션은 off 이며, `--auto` 는 이 두 옵션과 `--yes-all` 을 자동 활성하지 않는다 (`../_shared/kiwi/auto-option.md` 공유 계약).

### 1.3 모드 매트릭스

| 모드 | 시니어 코더 | TDD 검증 (standard) | 정형 검사 (스크립트) | 까칠 리뷰어 (현재 세션 모델) | 비용 배수 |
|---|---|---|---|---|---|
| Normal (기본) | high-reasoning × 1 | × 1 | × 1 | × 1 | 1.6~2.0× (snoworca-coder Normal 대비) |
| `--max` | high-reasoning × 3 | × 2 (병렬) | × 1 | × 2 | 12~15× |
| `--reviewer-off` | high-reasoning × 1 | × 1 | × 1 | × 0 | 1.3× |

`--model <name>` 지정 시 까칠 리뷰 검증 서브에이전트의 모델을 override (정형 검사는 스크립트라 대상 아님) (기본은 현재 세션 모델; 시니어 코더·TDD 검증은 영향 없음).

TDD 검증은 기본 서브에이전트 1 개가 두 축을 함께 보고, `--max` 에서만 축마다 1 개씩 2 개를 병렬로 돌린다 (§4.2). TDD 강제 원칙 (§0.1) 의 핵심 검증 채널이므로 어느 모드에서도 생략하지 않는다.

### 1.4 출력 (산출물)

- **코드 변경**: SDS Files 에 명시된 파일과 Test Plan 의 테스트 파일에 직접 작성. git commit 은 사용자 결정 (부모 `kiwi-pm --commit-lane-work` 가 있으면 PM 이 commit).
- **`.kiwi/` 상태 트리** (§7):
  ```
  cwd/.kiwi/
  ├── config/
  │   └── enabled                          # opt-out 마커 없으면 항상 활성
  ├── sessions/
  │   └── {run-id}/
  │       ├── state.json                   # 전체 진행 상태 SSOT
  │       ├── worklog.jsonl                # 이벤트 시계열
  │       └── reports/
  │           └── coder-{run-id}.md        # 최종 완료 보고서
  └── logs/
      └── append-errors.log
  ```
- **분석 로그**: `docs/analysis/kiwi-coder-{run-id}/`
  - `tdd_review_iter{N}.json` (TDD 검증 결과)
  - `formal_review_iter{N}.json` (정형 검사 스크립트 결과)
  - `prickly_review_iter{N}.json` (현재 세션 모델 까칠)
  - `mcp_call_log.jsonl`
  - `regression_run.jsonl`
  - `rejected_findings.log`

**Run-id**: §0.14 — 부모가 넘긴 `RUN_ID`, 단독 실행이면 `sds_id`.

### 1.5 `--dry-run`

- MCP mutation 실행 안 함. state.json `mcp_call_log[]` 에 `dry_run: true` entry.
- 코드 변경 / 테스트 실행은 정상 수행 (회귀 검증 가능).
- 보고서에 `mode: "dry-run"` 명시.

---

## 2. Phase 흐름

```
Phase 0 : Bootstrap (preflight, SDS 로드·검사, .kiwi init/resume, 요구 AC 로드, 회귀 기준선 캡처)
Phase 1 : TDD 작성·검증
  1.1 : 시니어 코더가 SDS Test Plan 과 요구 AC 로 테스트 파일 작성
  1.2 : TDD 검증 (기본 서브에이전트 1, --max 2 병렬, 2축, §4.2) + 스크립트 판정 2종
  1.3 : 개선 루프 (CRITICAL/HIGH 잔존 시 1.1 재진입)
  1.4 : red 확인 (테스트 실행 → 의도된 fail)
  1.5 : red_evidence 기록 (state.json)
Phase 2 : 구현 (snoworca-coder 차용)
  2.a : SDS 재검사 (sha256 대조 — 실행 중 SDS 가 바뀌지 않았는가)
  2.b : Mock 금지 regex 스캔
  2.c : 시니어 코더 구현
  2.d : SDS-코드 일치 게이트 (Files · 심볼 · ← caller 연결)
  2.e : 정형 검사 (스크립트, 4축)
  2.f : 까칠 리뷰 (현재 세션 모델×1/2, 8축)
  2.g : 개선 루프 (심각도 카운터)
  2.h : 테스트 실행 + green 확인
  2.i : green_evidence 기록 + SDS-AC 검증
Phase 3 : 실행 종료 처리
  3.1 : 회귀 테스트 (영향받는 + 전체 스위트)
  3.2 : MCP mutation 4종 batch
  3.3 : .kiwi state.json + worklog 갱신
Phase 4 : (선택) 통합 테스트 + 최종 보고서
```

---

## 3. Phase 0 — Bootstrap

### 3.0 preflight

판정 순서:
1. MCP `get_active_target` 성공 → PASS
2. MCP 실패 → HALT. CLI `speckiwi --version` 은 설치/버전 진단과 MCP 복구 안내에만 사용하고 PASS 대체 조건으로 삼지 않는다.

입력 인자에 `SPAWN_CONTEXT` 가 있으면 `state.spawn_context = "pm-child"` 로 저장. 부재 시 `state.spawn_context = "standalone"` 기본. (§8.4 자동 시작 게이트 분기에 사용)

### 3.1 SDS 로드·검사

1. `SDS_PATH` 인자를 읽는다. 없으면 §0.G3 거부.
2. MCP `check_sds` 를 **이 자리에서 직접 실행**한다 (MCP 가 없으면 HALT — CLI `speckiwi sds check <SDS_PATH> --json` 은 진단에만 쓴다) — 상류 `$kiwi-sds` 가 이미 돌렸다고 가정하지 않는다. error 급 진단이 있으면 §0.G3 거부.
3. 요약에서 Files 경로·심볼·`← caller`·SDS-AC·Test Plan 행·`@req` 집합·쓰기 집합(Files ∪ Test Plan 테스트 파일)·`Target` 을 state.json 에 옮기고, SDS 파일의 sha256 을 `state.sds_sha256` 에 고정한다.
4. SDS `Target` 을 speckiwi `get_active_target` 결과와 비교. 불일치 시 Codex clarification gate ("SDS 의 target {sds.target} 이 활성 target 과 다릅니다. set_active_target 후 진행하시겠습니까?")

### 3.2 .kiwi init / resume

```
.kiwi/sessions/{run-id}/state.json 존재?
  YES → --resume 플래그 또는 자동 감지:
        1. state.json 의 `frozen_at` 있으면 read-only 안내만
        2. `next_resume_hint` 가 있으면 그 단계부터 재개 (§7.3)
        3. `sds_sha256` 이 지금 SDS 와 다르면 Codex clarification gate — SDS 가 바뀐 채로 이어가지 않는다
  NO  → 신규 init: state.json 작성 (§7.1 스키마)
```

### 3.3 요구 AC 로드

SDS `@req` 집합의 각 REQ 를 MCP `get_requirement` 로 읽어 AC 본문을 `state.req_acs` 에 둔다. 이 AC 와 SDS 의 Acceptance Contracts 가 Phase 1 테스트의 분모다. 같은 읽기에서 Stability 를 확인한다:

- `evolving` / `stable`: 진행 가능.
- `draft`: 단독 실행이면 이 SDS 를 구현하지 않고 draft REQ 목록을 보고한 뒤 `NEEDS_USER`(severity `business-decision`)로 끝낸다 — 요구 단위 부분 진행은 SDS 범위에서 한다 (`$kiwi-sds` 요구 필터로 그 REQ 를 뺀 SDS). `SPAWN_CONTEXT=pm-child` 면 멈추지 않는다 — 부모 `kiwi-pm` 이 spawn 전에 lifecycle gate 를 적용했고, draft REQ 가 여기까지 왔다면 사용자가 override(kiwi-pm §4.2 (B) 또는 `--skip-lifecycle-gate`)로 넘긴 것이다. worklog 에 `lifecycle_override_inherited` 를 남기고 진행한다.
- `deprecated` / `frozen`: §0.G6 `lifecycle-gate-deprecated-or-frozen` 으로 중단.

### 3.4 사용자 비용 안내

- Normal: 1회 안내 (`--auto-cost-warning`/`--yes-all` skip 가능)
- `--max`: 2단계 경고 + 추정 토큰
- 거부 시 .kiwi state 보존 후 종료

### 3.5 회귀 기준선 캡처

구현에 들어가기 전에 전체 회귀 스위트를 1회 실행하고 그 결과를 `state.regression_baseline` 에 고정한다. 이 값이 이후 모든 회귀 판정 (§6.1.3) 의 분모다 — 기준선이 없으면 "이 실행이 깼다"와 "원래 깨져 있었다"를 구분할 방법이 없다.

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

### 4.1 테스트 작성

**4.1.1 실행 시작**: worklog append `run_start`.

**4.1.2 테스트 분모 확인**: SDS 의 SDS-AC 마다 Test Plan 행이 하나 이상 있어야 한다 (`speckiwi sds check` 가 SDS-E064 로 보장). 행이 없는 SDS-AC 가 남아 있으면 §0.G1 차단.

**4.1.3 시니어 코더 (high-reasoning×1) 테스트 작성**:

입력:
- SDS 의 Interfaces (Files · 심볼 · `← caller`), Acceptance Contracts, Test Plan — 문법은 `docs/rule/SDS-MD-Rules-v2.6.0.md` §9
- SDS `@req` 집합 요구의 SRS AC 본문 (§3.3, MCP `get_requirement` 결과)
- 기존 code 컨텍스트 (SDS Files 경로의 현재 파일 내용)
- 프로젝트 테스트 컨벤션 (cwd 의 test 디렉토리 구조 + 기존 테스트 1~2개 샘플)

산출:
- Test Plan 행이 지명한 테스트 파일에 그 SDS-AC 를 검증하는 테스트를 작성한다. `@req` 집합 요구의 AC 가운데 SDS-AC 가 해석하지 않은 AC 도 테스트를 받는다.
- 모든 테스트는 테스트 줄(테스트 이름)에 그 테스트가 검증하는 `<REQ-ID> AC-<n>` 또는 `SDS-AC-<n>` 을 인용한다 — 이 인용이 `speckiwi coverage --tests` 와 테스트 충분성 확인이 읽는 테스트 ↔ AC 대응이다.
- 기대 실패가 분명하면 (예외 이름 · 오류 문구) 그 신호를 내는 단언으로 쓰고, 테스트마다 그 신호를 `state.json` 의 `red_evidence_meta.expected_failures` (테스트 이름 → 신호) 에 적는다 — red 확인 (§4.2 red-verification, §4.4) 이 이 값과 동등비교한다. 적은 신호가 없는 테스트는 0 이 아닌 `exit_code` 와 그 테스트의 실패 보고로 red 를 본다.

분석 로그: `docs/analysis/kiwi-coder-{run-id}/tdd_draft.txt`

**검증 패스 산출물 영속 의무**: 각 검증 패스(TDD 검증·정형 검사·까칠 리뷰)는 결과를 `docs/analysis/kiwi-coder-{run-id}/` 아래에 기록한다. **finding 0 건이어도 기록한다** — 기록이 없으면 "아무것도 못 잡은 패스"와 "돌지 않은 패스"와 "버려진 산출물"을 구별할 수 없고, 그 구별 불가가 검사의 가치를 판단 불가로 만든다. 각 기록은 패스 이름·대상 SDS·severity 별 finding 을 담는다.

### 4.2 TDD 검증 (2축)

기본 검증 서브에이전트 1 개가 아래 두 축을 함께 판정한다. `--max` 에서는 검증 서브에이전트 2 개를 병렬로 — 사용 가능한 서브에이전트 위임 도구로 — 돌려 축마다 1 개가 맡는다 (FR-FLOW-180 과 같은 규칙). 검증자는 시니어의 rationale 을 받지 않는다 (§0.5). 나머지 2축(req-mapping·red-verification)은 아래 표대로 **스크립트가 판정한다**.

**`@req` 태그 검증 금지 (§0.17.6 포괄 면책)**: S1~S2 어느 검증자도 코드 주석의 `@req` 라인 존재 여부·정확성·REQ-ID 실재성을 검증/비교하지 않는다. 태그는 참고용이며 검증 축에 포함되지 않는다.

| 검증자 | 모델 | 검증 축 | 출력 finding 형식 |
|---|---|---|---|
| **S1** intent-alignment | standard | SDS-AC / 요구 AC ↔ test 의미 일치 — test 가 정말 해당 AC 를 검증하는가 | `{ severity, axis: "intent-alignment", evidence: {file, line}, suggestion }` |
| **S2** technical-quality | standard | TDD 코드 기술 품질 (네이밍, 결정성, flaky 위험, assertion 적절성, isolation, fixture) | `{ severity, axis: "tech-quality", ... }` |

**req-mapping · red-verification 은 서브에이전트가 아니라 스크립트가 판정한다.** 두 축의 통과 규칙이 각각 집합 소속·정규식과 exit_code·시그니처 동등비교로 이미 결정적으로 진술돼 있어, 판단자가 실행할 이유가 없다.

| 판정 | 실행 주체 | 규칙 | 결과 |
|---|---|---|---|
| req-mapping | `speckiwi sds check` 와 `speckiwi coverage --tests --ids <@req 집합> --sds <SDS_PATH>` 를 그대로 재사용 | `@req` 와 `(<REQ-ID> AC-m)` 이 SRS 에 실재하고 SDS-AC 마다 Test Plan 행이 있는가 (sds check), Test Plan 이 지명한 테스트 파일이 실재하고 그 SDS-AC 를 인용하는가 (coverage --tests) — 두 도구가 이미 내리는 판정이며 **재구현하지 않는다**. 요구 AC 별 인용 공백은 테스트 충분성 확인(`../_shared/kiwi/test-sufficiency.md`)의 몫이며 이 축을 가르지 않는다 | 위반 시 CRITICAL, Phase 2 진입 차단 |
| red-verification | 테스트 러너 직접 실행 (Test Plan 파일에 대한 프로젝트 테스트 명령) | `exit_code` 와 `captured_failure` 를 `red_evidence_meta.expected_failures` 의 기대 실패 신호와 테스트마다 **동등비교** (신호를 적지 않은 테스트는 0 이 아닌 `exit_code` 와 그 테스트의 실패 보고, §4.1.3). 근사 일치는 실패로 본다 — 판단자보다 엄격하다 | red 미발생·신호 불일치 시 CRITICAL |

**두 도구는 이 자리에서 직접 실행하며, 입력도 이 자리에서 정한다** — `sds check` 는 `SDS_PATH` 를, `coverage --tests` 는 `SDS_PATH` 와 SDS `@req` 집합을 받는다. 입력은 둘 다 이 실행이 받은 SDS 에서 나온다. 상위 `$kiwi-sds` 가 이미 `sds check` 를 돌렸다고 가정하지 않는다. 본 스킬은 다른 곳에서 작성된 SDS 로도 진입할 수 있고, 선행 단계가 일어났음을 전제한 보증은 보증이 아니다.

**severity 정의**:
- **CRITICAL**: 의도 위배 (S1), Mock 사용 (S2), `@req`·`(REQ AC)` 해석 실패 (sds check), red 미발생 (러너)
- **HIGH**: 모호한 assertion (S2), SDS-AC 인용 누락 (coverage --tests), 기대 실패 신호 불일치 (러너)
- **MEDIUM**: 네이밍 / fixture 개선 (S2)
- **LOW**: 스타일 (S2)

**축 소관 경계**: 각 축은 자기 주제만 판정한다. Mock 사용은 S2 가, 인용·참조 해석은 두 도구가 단독 소관이며 S1 은 이를 중복 판정하지 않는다 — 한 결함이 두 축에서 서로 다른 설명으로 두 번 보고되면 시니어가 같은 원인을 두 번 해석해야 하고, 스크립트가 내린 판정을 축이 다시 이름 부르면 판단을 없애려고 옮긴 것을 산문으로 되불러온다.

### 4.3 개선 루프 (CRITICAL=0 + HIGH=0 까지)

```
Round 1 결과 분석
  ├─ CRITICAL=0 + HIGH=0 → §4.4 진행
  ├─ CRITICAL≥1 or HIGH≥1 → 시니어 코더 재호출 (findings 전달, 단 검증자의 결론·근거 raw text 그대로 전달)
  └─ TDD 검증자 재호출 3회 누적 → §0.G4 발동
```

루프 상한:
- 시니어 코더 재호출 **3회**
- TDD 검증자 재호출 **3회**
- 초과 시 §0.G4 4옵션 Codex clarification gate

### 4.4 red 확정 + red_evidence 기록

red 증거를 `state.json` 의 `red_evidence` 에 기록한다 (`command` / `exit_code` / `captured_failure` / `timestamp` 4필드):
```json
{
  "command": "npm test -- --testPathPattern=src/__tests__/x.test.ts",
  "exit_code": 1,
  "captured_failure": "FAIL src/__tests__/x.test.ts > FR-X-001 AC-1 rejects invalid input\n  Expected: throw 'InvalidInputError'\n  Received: nothing was thrown",
  "timestamp": "2026-05-19T03:54:41Z"
}
```

부가 정보 (matched_signatures, 테스트 이름 목록, stderr 별도 분리 등) 는 `state.json` 의 `red_evidence_meta` 에 따로 둔다. SDS 파일에는 쓰지 않는다 — SDS 는 입력이다.

worklog append `tdd_red_confirmed { sds_id, exit_code, test_names[] }`.

---

## 5. Phase 2 — 구현 루프 (snoworca-coder 차용)

### 5.1 단계 흐름

```
Phase 2 진입
  ├─ (a) SDS 재검사
  │       └─ SDS 파일의 sha256 이 state.sds_sha256 과 같은가 — 다르면 중단 + NEEDS_USER (실행 중 설계가 바뀌었다)
  ├─ (b) Mock 금지 regex 스캔 (사전 — 시니어 호출 전 코드베이스 현황 파악)
  ├─ (c) 시니어 코더 구현 (high-reasoning×1 or ×3)
  │       └─ 입력: SDS Interfaces · Acceptance Contracts · Test Plan, 작성된 test 파일, 관련 REQ AC
  │       └─ 산출: SDS Files 에 명시된 path 만 편집
  │       └─ **@req 태그 부착** (§0.17 SSOT 7-clause): §0.17.1 의무 범위 (테스트 파일 제외) / §0.17.2 면제 enum (closed-list, 현재 8종) + worklog 기록 / §0.17.3 1라인 1 REQ-ID 형식 + line-anchored 정규식 / §0.17.4 append 위치 결정성 / §0.17.5 dedupe 알고리즘 (lenient 정규식으로 토큰 추출 비교) / §0.17.6 포괄 면책 (모든 게이트 점검 제외) / §0.17.7 누락 무차단 — 시니어 코더는 본 7-clause 를 그대로 따른다. **검증/리뷰/회귀 단계 어디에서도 비교 금지** (§0.17.6)
  ├─ (d) SDS-코드 일치 게이트 (ZERO TOLERANCE)
  │       ├─ 실제 변경된 파일 set ⊆ SDS Files ∪ Test Plan 테스트 파일 (cwd 한정)
  │       ├─ SDS Files 의 파일이 모두 존재하고, 각 심볼 줄이 선언한 이름이 그 파일에 정의되어 있다
  │       ├─ `← caller` 가 붙은 심볼은 그 caller 쪽에서 참조된다 — 정의 지점과 import 줄 밖의 참조를 센다. import 만 되고 쓰이지 않는 심볼은 연결이 아니다
  │       ├─ SDS-AC 의 `→` 대상 심볼이 모두 존재한다
  │       ├─ **`@req` 주석 추가는 본 게이트 평가에서 제외** (§0.17.6) — 태그 추가/append 라인은 SDS Files 밖 변경 판정 시 변경 set 에서 제거 후 비교
  │       ├─ diff 에서 기존 테스트 파일 삭제 / 기존 테스트 케이스 제거 / 기존 단언 약화 검출 (§0.20)
  │       │       └─ 검출 시 CRITICAL + (c) 재호출로 재구현 강제 — 지운 테스트를 복원하고 구현으로 green 을 만든다
  │       ├─ diff 에서 기존 public 심볼 삭제 / 시그니처 변경 검출 (§0.G6 `existing-public-contract-change`)
  │       │       └─ 검출 시 CRITICAL + (c) 재호출. 파일 경로와 무관하게 판정 — 계약 파손은 경로가 아니라 심볼에서 일어난다
  │       ├─ diff 에서 비-테스트 **기존 파일의 삭제·이동** 검출 (§0.G6 `existing-file-deleted-or-moved`)
  │       │       └─ 검출 시 CRITICAL + (c) 재호출로 재구현 강제 — SDS Files 에 등재되어 있다는 사실만으로는 해소되지 않는다. 등재는 그 파일을 편집한다는 허가이지 제거한다는 허가가 아니다
  │       ├─ **동일 항목 2회째 검출** 시 (c) 재호출로 자기 치유하지 않고 §0.G6 의 대응 gate_id 로 부모에 **버블업**한다 — 1차 검출은 재구현으로 닫되, 같은 항목이 두 번 나오면 치유가 수렴하지 않는 것이므로 사용자 결정으로 올린다
  │       └─ 위반 시 CRITICAL + (c) 재호출
  ├─ (e) 정형 검사 (**스크립트**, 서브에이전트 아님)
  │       └─ 4축 전부 결정적 판정 — 판단자가 실행할 이유가 없다
  │       ├─ Mock 사용: §0.6 의 regex 를 **그대로 재사용** (재구현 금지)
  │       ├─ 타입/빌드: 빌드를 실행하고 exit_code 로 판정
  │       ├─ SDS-코드 매핑: 앞선 (d) ZERO TOLERANCE 게이트(§0.7)가 이미 계산한 결과를 **재사용** — 같은 규칙을 두 번 구현하면 두 곳에서 어긋난다
  │       └─ 테스트 커버리지: SDS Test Plan 행마다 **실제로 실행된 테스트**가 대응하는가. 전역 커버리지 %가 아니라 그 SDS 가 약속한 Test Plan 행을 본다
  │               └─ **이 축은 종전에 기준이 없었다** — 스킬에도 확장 레퍼런스에도 판정 규칙이 정의된 적 없이 축 이름만 있었다. 여기서 처음 정의한다 (옮겨온 것이 아니다)
  │       └─ 위반 시 CRITICAL + (c) 재호출
  │       └─ 검증 축 4개: Mock regex, 타입/빌드, SDS-코드 매핑 재확인, 테스트 커버리지
  │       └─ CRITICAL 발견 시 (g) 직행 (까칠 skip)
  ├─ (f) 까칠 리뷰 (현재 세션 모델×1, --max 시 ×2, --reviewer-off 시 skip; --model 로 override)
  │       └─ 검증 축 8개 (§5.2)
  ├─ (g) 개선 루프 (심각도별 독립 카운터)
  │       ├─ CRITICAL ≤ 3
  │       ├─ HIGH ≤ 3
  │       ├─ MEDIUM ≤ 2
  │       ├─ LOW ≤ 1 (정보만) — 주석 표현·서식 LOW 는 재작업 라운드 0, 보고만 하고 넘어간다
  │       └─ 초과 시 §0.G4 발동
  ├─ (h) 테스트 실행 (green 확인)
  │       ├─ Phase 1.4 의 red cmd 동일하게 실행
  │       ├─ exit_code=0 + 작성한 테스트가 모두 pass → green
  │       └─ 미통과 시 (g) HIGH 카운터 +1, (c) 재호출
  ├─ (i) green_evidence 기록 (state.json: command / exit_code / timestamp 3필드)
  │       └─ 부가 정보 (통과한 테스트 이름 목록, stdout_excerpt) 는 `green_evidence_meta` 에 별도 저장
  └─ (j) SDS-AC 검증 (`speckiwi coverage --tests --ids <@req 집합> --sds <SDS_PATH>` 로 SDS-AC 마다 인용한 테스트가 실재하고 green 인지 확인. **`@req` 태그 부착 여부는 본 SDS-AC 검증 대상이 아님** — §0.17.6)
```

### 5.2 까칠 리뷰 8축 (snoworca-coder §6.2 동일 — 입증된 SSOT)

| # | 축 | 확인 항목 |
|---|---|---|
| 1 | 의도 보존 | SDS Interfaces · SDS-AC / 관련 REQ AC 대비 구현 일치 |
| 2 | 보안 위험 | OWASP Top 10, 입력 검증, 인증/권한, 비밀 노출 |
| 3 | 엣지 케이스 | null/empty, 경계값, 동시 접근, 순서 의존 |
| 4 | 동시성 | race condition, deadlock, 비원자 연산 |
| 5 | 리팩토링 여지 | 중복, 과도 추상화, 네이밍, 함수 크기 |
| 6 | 에러 처리 | 예외 전파, 사용자 피드백, 로깅 충분성 |
| 7 | 테스트 품질 | 작성된 test 의 의미성, flaky 위험 (Phase 1 검증과 별개로 구현 후 재확인) |
| 8 | 주석 주장 | 주석이 코드에 대해 단언하는 것이 참인가 — 닫힌 4종만: 파일·디렉터리 경로, 코드 심볼명, 개수, 부재 주장 (`호출자 없음` · `not wired`) |

**축 8 의 경계**: 닫힌 4종 밖의 주석 주장은 finding 이 아니다 — 의도·설계 의견을 다투지 않는다. 4종은 `existsSync` · `grep -c` 로 판정되므로 축 8 은 라운드당 비용이 사실상 0 이며, 임의 주석을 코드와 대조하는 비용(요구 1건당 약 27초 수준의 추론)을 지지 않는다.

**`@req` 태그 검증 금지 (§0.17.6 포괄 면책)**: 정형 검사 (스크립트) 와 까칠 리뷰 (현재 세션 모델×1/2) 모두 코드 주석의 `@req` 라인에 대해 다음 행위를 금지한다 — (a) 존재 여부 점검, (b) SDS `@req` 집합과 비교, (c) REQ-ID 실재성 검증 (speckiwi 조회), (d) 라인 누락을 finding 으로 발행. 본 태그는 정보용 breadcrumb 이며 어떤 게이트에도 영향 주지 않는다.

### 5.3 심각도 정의 (구현 단계)

- **CRITICAL**: Mock 사용, SDS-코드 매핑 누락, 빌드/타입 실패, 보안 중대, green 미달성
- **HIGH**: 테스트 fail, SDS-AC 미충족, 의도 이탈, 축 8 닫힌 4종의 주석 주장이 거짓으로 측정됨
- **MEDIUM**: 경계 조건 누락, 리팩토링 미흡, 에러 처리 불충분
- **LOW**: 스타일, 주석 표현·서식 — 정보 보고 전용이며 개선 루프 재작업 라운드 0

Phase 2 통과 조건: **CRITICAL=0 + HIGH=0 + green 확정**.

### 5.4 시니어 코더 입력 (재호출 시 포함)

- 1차 호출: SDS Interfaces · Acceptance Contracts · Test Plan, 작성된 test 파일, 관련 REQ AC
- 재호출: 위 + 이전 findings (검증자 raw output) + 누적 시도 횟수

검증자의 결론은 raw 로 전달하되, 시니어 자신의 이전 시도 내용은 **재호출 시 제거** (편향 차단). 시니어는 매번 처음 보는 것처럼 접근.

---

---

## 6. Phase 3 — 실행 종료 처리 (판정 상주분)

§6.2~§6.3 과 §7 전체는 `references/extended-workflow.md` 가 SSOT. 아래 §6.1 은 실행마다 게이트 판정에 쓰이므로 SKILL.md 에 상주하며, **회귀 판정에 관해서는 extended reference 의 §6.1 을 대체한다**.

### 6.1 회귀 테스트 (§0.13 의무)

**6.1.0 기준선(baseline) 캡처**: 실행이 **코드를 바꾸기 전에** 전체 회귀 스위트를 1회 실행해 기준선 결과를 저장한다. run 단위 기준선은 §3.5 에서 `state.regression_baseline` 에 이미 고정되어 있으므로, 그것이 존재하고 `head_sha` 가 현재 HEAD 와 같으면 그 값을 그대로 쓴다. 없거나 HEAD 가 다르면 첫 편집 전에 캡처한다.

**6.1.1 실행 범위**: (1) 영향받는 test 파일은 항상 실행, (2) 전체 회귀 스위트는 `--skip-regression` 부재 시 실행. 대상 추론과 실행 로그 적재 규약은 extended reference §6.1 참조. 실행 시간 추정 ≥10분 시 비용 경고 게이트 (`--auto-cost-warning` 로 우회, §1.2 pass-through).

**6.1.3 회귀 발견 시 처리** — 회귀 여부는 기준선 대비 **델타로 판정**한다:
- 기준선에서 pass 였는데 이번 실행에서 fail 한 test = **신규 실패**. 이 실행이 만든 회귀이므로 CRITICAL + (Phase 2.c) 재진입
- 기준선에 이미 있던 **기존 실패**는 그대로 보고하고, 현재 실행의 것으로 **귀속하지 않는다** — 남의 실패를 좇는 동안 이 실행의 루프가 발산한다
- 기준선에서 fail 이었는데 이번에 pass 한 test 는 회귀가 아니다 (보고만)
- `state.regression_baseline` 이 null (§3.5 캡처 실패) 이면 델타를 계산하지 않고 실패 전량을 보고하며, 판정이 격하되었음을 함께 적는다
- 2회 연속 동일 파일 신규 실패 → §0.G4 발동 + `state.failed = true`
- 외부 모듈 (cwd 외부) 실패 → WARN 만, 차단 안 함

---

## 8. 통합 테스트 (Phase 4, 선택) — 진입 게이트

§8.2~§8.4 는 `references/extended-workflow.md` 가 SSOT. 아래 §8.1 은 동의 게이트 판정이라 SKILL.md 에 상주한다.

### 8.1 조건

- Phase 3 이 끝났다 (`state.phase = "done"`)
- `--skip-integration` 부재
- 사용자 동의 (`--auto-integration`/`--yes-all` skip)

`state.spawn_context == "pm-child"` (§3.0) 인 경우 본 동의 게이트를 발동하지 않는다 — 자식이 동의를 요구하면 부모의 무인 진행이 멈춘다. 자식 컨텍스트에서 통합 테스트 실행 여부는 실행 전체를 본 부모 `kiwi-pm` 가 결정한다.

skip 시(`--skip-integration` 명시 또는 사용자 거부)에도 **최종 보고서는 항상 생성**하며, 통합 테스트 섹션은 "skipped: {reason}" 으로 채운다.

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
run finalization, MCP mutation batch, .kiwi state schemas, integration testing, examples, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
