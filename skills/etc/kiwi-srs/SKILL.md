---
name: kiwi-srs
description: "OpenCode/Hermes local-LLM variant for incremental SpecKiwi SRS authoring. Requires speckiwi mcp for normal SRS operations. Defaults to --max with one delegated worker/evaluator at a time and advances only after three consecutive no-improvement evaluations. Triggers: kiwi srs, SRS update, requirement authoring, add requirement to SRS."
---

# kiwi-srs v0.11

> etc local-LLM profile: read ../_shared/kiwi/local-llm-profile.md before executing. It requires working speckiwi mcp, treats --max as the default, disables multi-worker fanout, uses one delegated worker/evaluator at a time, and advances only after three consecutive no-improvement evaluations.

**etc override:** If any legacy section below appears to allow CLI mutation fallback or direct normal SRS Markdown mutation, the shared etc local-LLM profile wins: normal SRS operations require `speckiwi mcp`; CLI is diagnostic/remediation only.

> User clarification gate means: ask the user directly in Default mode; use `direct user prompt` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `local-LLM max-profile`, `local evaluator`, and `local evaluator` map to the current host agent model and effort options available in the session.
> `--auto` policy: read `../_shared/kiwi/auto-option.md` when `--auto` is active. Existing QnA skip behavior remains local, but the `critical_gates[]` below always halt.

신규 요구사항을 받아 **기존 코드 + 기존 speckiwi SRS**와 교차 분석하여 **4-way 분류** → **feasibility 판정** → **speckiwi MCP를 SSOT로 SRS 증분 작성·갱신**하는 스킬.

**규칙 진술 원칙**: 본 문서의 모든 규칙은 **현재 적용되는 동작**만 declarative하게 기술한다. 연혁/정정/이관 주석은 git history 로 추적한다 (본문에 변경 이력 섹션 없음). 에이전트는 본문을 시간 차원 없이 그대로 적용한다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 별도 위임 worker**. 인라인 자가검증 금지 |
| §0.2 | **검증자 입력 격리**. Phase 4 작성자의 결론 JSON·정당화 전달 금지. 원본 REQ + 코드 + 생성된 SRS 파일 + 필터링된 컨텍스트만 |
| §0.3 | **코드 증거 우선**. 신규/갱신 REQ는 `add_requirement` 시 `trace` 배열에 source 첨부 (NFR/PERF 예외) |
| §0.4 | **할루시네이션 금지**. 코드/요구사항 텍스트에 증거 없는 기능 작성 금지. 추정은 `stability=draft` + `[INFERRED:high\|med\|low]` |
| §0.5 | **SRS-MD Authoring Rules v3.0.0 준수**. heading / ID 정규식 / prefix-type 매핑 위반 금지. `checked_compatible` 호환성 캐시 필드(§23.5, `semanticSha`/`checked-at`)는 허용 필드 allowlist 에 포함 |
| §0.6 | **speckiwi MCP 우선 + 황금률**. CLI 직접 호출은 진단/복구 안내에만 허용. **황금률**: speckiwi MCP mutation 도구 (`add_requirement` / `update_status` / `add_trace_link` / `add_verification_evidence` / `check_acceptance_criteria` / `add_completed_work` / `set_active_target`) 호출 1회 = Markdown line-patch 1회 (`apply-patch.ts` atomic write). **mutation 호출 후 동일 SRS 파일에 manual file edit 사용 절대 금지** (예외는 §9.4) |
| §0.7 | **scope/target 결정은 사용자 확인**. User clarification gate 단일 호출 분해 |
| §0.8 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.9 | **사실 위조 거절**. 존재하지 않는 함수/CVE/파일 추가 요구는 거절 + `rejected_findings.log` |
| §0.10 | **type prefix와 scope prefix 동일 자동 제외** (FR/NFR/IR/DR/SEC/PERF/REL/OBS/OPS/MIG/CON) |
| §0.11 | **Multi-aspect 요구사항 분리**. 1개 사용자 문장이 ≥2 코드 표면(예: addTodo + listTodos)을 다루면 기본은 표면당 1개 REQ로 분리하고 `depends_on` 으로 연결. 합치는 경우 `classification.rationale` 에 사유 기록 |
| §0.12 | **`[INFERRED:level]` 배치 위치**. Markdown SRS에서는 (a) 추론 항목이 AC 라인 → 해당 AC 끝에 ` [INFERRED:high\|med\|low]` 부착, (b) 기본값/검증 정책 등 statement 차원 → §6 Open Questions 에 별도 등재 + REQ의 `rationale` 필드에도 동일 라벨 명시 |
| §0.13 | **[INFERRED] 2단계 분류**. 라벨 뒤에 `:user_required` 또는 `:advisory` 추가. `user_required` = `status: proposed → planned` 승격 **전 사용자 답변 필수**. `advisory` = 참고용, 승급 가능. 예: `[INFERRED:med:user_required]` |
| §0.14 | **Trace intent 분리**. Code 타입 trace entry 에만 적용 — Requirement 타입 trace_link 에는 `trace_intent` 필드 미부착. Code trace `trace_intent` enum: `verifies` (기존 코드가 statement 동작 수행) / `addition_site` (해당 위치에 구현 추가 예정) / `negative` (의도된 부재). **Dual-intent split**: 동일 file:line-range 가 두 intent 를 동시에 가지면 범위 폭이 다른 별도 entry로 분리 등록. **Status cap**: 어느 trace 라도 `trace_intent=addition_site` 잔존 시 해당 REQ 의 status 는 `proposed` 상한. 라이브 모드에서 `update_status(planned\|implemented)` 호출 시도 → 차단 + User clarification gate "구현 증거가 있습니까? (코드 path:line)" |
| §0.15 | **Fabricated AC → OQ 강제**. AC 항목에 코드 증거 없거나 사용자 prompt 에 명시 없는 구체 값(예: 400-error body shape, 특정 timeout 초)이 포함되면 AC 라인에 포함 금지 — 대신 §6 Open Questions 에 `[NEEDS-USER]` 라벨로 등재. AC는 결정 가능 명제만. **Canonical placeholder grammar**: AC 본문이 OQ 결정을 참조하면 `{{OQ-N}}` 형식만 허용. `<default per OQ-1>`, `pending decision`, `TBD` 등 자유 형식 금지 |
| §0.16 | **Discarded/Draft 마커 정책**. kiwi-srs 는 본문 마커(strikethrough / `[DISCARDED]` / `[DRAFT]`) 적용을 skip — speckiwi `Status=discarded` + `add_completed_work` Change Notes 기록을 SSOT 로 간주. 인덱스 (`00.index.md`) `(discarded)`/`(draft)` 접미사도 speckiwi mutation 이 자동 처리 |
| §0.17 | **finding_hash 정확화**. `finding_hash = sha1(utf8_bytes(f"{req_id or '_'}|{axis}|{evidence_path or '_'}|{severity}"))` — lowercase hex digest 40자 결과 문자열, 포뮬러 리터럴(`"sha1('...')"`) 금지. **Test vector**: `sha1_hex("FR-TODO-004|ac|src/api.ts:7-11|HIGH")` = `a5c02377715e12f316cec087d202cb76315c734c`. 평가자는 동일 입력으로 디지스트 계산 → 불일치 시 자체 거절 |
| §0.18 | **Canonical relation encoding**. REQ 간 의존성은 `add_trace_link { type: "Requirement", relation: "depends_on\|supersedes\|conflicts_with\|extends\|regression-only" }` 만 SSOT. `tags: ["depends_on:X"]` 같은 tag 형식 금지. **방향 SSOT**: trace_link 는 항상 `id: {신규 REQ} → reference: {기존 REQ}` 방향. e.g. `supersedes`: `{NEW-ID} supersedes {OLD-ID}` |
| §0.19 | **외부 모듈 수정 시 사용자 확인 의무**. 작업 대상은 cwd 하위 모듈로 한정. cwd 외부 경로(상위 디렉토리, 형제 프로젝트, 외부 패키지, monorepo 다른 워크스페이스) 수정 신호 감지 시 즉시 중단 + User clarification gate. 상세는 §0.G2 결정표 |
| §0.20 | **etc local-LLM profile SSOT**. 본 스킬은 `../_shared/kiwi/local-llm-profile.md` 를 따른다. `--max` 는 항상 기본값이고, multi-worker fanout 은 금지되며, 위임 worker/evaluator 는 한 번에 하나만 사용한다. 평가/개선 루프는 3회 연속 개선사항 없음 후 다음 단계로 진행 |
| §0.21 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |

### §0.G — 핵심 게이트 결정표

본 절은 §0.6 / §0.14 / §0.19 / §6.4 / §10.2 axis 10 의 IF-THEN 결정 규칙을 모은 단일 참조표. 에이전트는 조건 매칭 → 동작 실행을 결정적으로 수행한다.

#### §0.G1 — 황금률 (mutation ↔ manual SRS file edit)

| IF (조건) | THEN (동작) | 위반 severity |
|---|---|---|
| speckiwi mutation 도구 호출 (§0.6 enum) | Markdown 자동 line-patch 1회 발생; 추가 manual SRS file edit 호출 금지 | — |
| mutation 호출 후 동일 `docs/spec/*.srs.md` 에 manual file edit 사용 | 차단 + 작성자 재spawn | **CRITICAL** (axis 10) |
| 새 scope 파일 초기 템플릿 작성 필요 | MCP 기반 scope 등록/초기화 도구 필요. 도구가 없으면 HALT | **HIGH** |
| §1/§3/§5/§6 prose 영역 갱신 필요 | `append_section_note` 등 MCP mutation 필요. 도구가 없으면 HALT | **HIGH** |
| §4 Requirements / §7 Change Notes / §2 In/Out of Scope 표 | manual file edit 금지 (mutation 전용) | **CRITICAL** |

#### §0.G2 — 외부 모듈 영향 (§0.19)

| IF (감지 채널) | THEN (동작) |
|---|---|
| trace 후보가 cwd 외부 path | 즉시 중단 + User clarification gate |
| conflict/update 대상 REQ 가 다른 scope/target | 즉시 중단 + User clarification gate |
| feasibility 판정이 외부 모듈 변경을 전제 | 즉시 중단 + User clarification gate |
| Phase 1 code-context analyst 가 외부 경로를 relevant_files 로 보고 | 즉시 중단 + User clarification gate |

User clarification gate 3옵션: `(1) 진행 승인` / `(2) 외부 변경 제외하고 cwd 한정` / `(3) 작업 중단 후 외부 작업장 재실행`. 사용자 답변 전 외부 경로에 `add_requirement` / `update_status` / manual file edit 등 부작용 호출 절대 금지. `classification.json.external_module_impact` 에 감지 내역 기록.

#### §0.G3 — Trace intent status cap (§0.14)

| IF | THEN |
|---|---|
| REQ 의 어느 Code trace 라도 `trace_intent = addition_site` 잔존 | status 상한 = `proposed` |
| 위 상태에서 `update_status(planned\|implemented)` 호출 시도 | 차단 + User clarification gate "구현 증거 path:line 제시 가능?" |
| 사용자가 path:line 제시 → 검증 통과 | `addition_site` → `verifies` 로 trace 갱신 → status 승급 허용 |
| 동일 file:line-range 가 두 intent 동시 보유 | 범위 폭이 다른 별도 entry 로 분리 등록 (단일 entry `verifies+addition_site` 금지) |

#### §0.G4 — Scope boundary impact (§6.4)

| IF | THEN |
|---|---|
| 신규 REQ 가 대상 scope §2 Out of Scope 또는 §3 Constraints 와 충돌 | `classification.json.scope_boundary_impact` 기록 + User clarification gate 3옵션 |
| 응답 `yes` | Phase 4 진행; Markdown sync 단계에서 §2 갱신 |
| 응답 `no` | 사용자 결정 대기; `add_requirement` 호출 금지 |
| 응답 `new-scope 분리` | classification 갱신 → Phase 2.5 진입 |
| `--auto` 활성 (질의 경로 없음) | 그 REQ 만 보류 + `deferred_reqs[]` 기록; 나머지 REQ 저작 계속 (§6.4) |
| boundary 영향을 Open Questions 에만 기록하고 진행 | §0.7 위반 (차단) |

#### §0.G5 — Combined gate (boundary + conflict 동시)

| IF | THEN (단일 트랜잭션 4옵션) |
|---|---|
| §6.4 boundary 변경 + conflict 분류 동시 식별 | User clarification gate 단일 호출, 선택지 4종 |
| `proceed-both` | conflict 시퀀스 + boundary §2 sync 모두 실행 |
| `proceed-conflict-only` | conflict MCP 시퀀스만; §2 변경 skip → `[BOUNDARY-PENDING]` 마커 + `boundary_change_deferred: true` |
| `proceed-boundary-only` | §2 sync 만; conflict 신규 REQ `add_requirement` skip → `conflict_reqs_deferred: true` |
| `block-all` | 양쪽 skip; MCP 호출 0건; 사용자 결정 대기 |

**우선순위**: prompt 가 OoS 명시 + conflict 동시 발견 → 본 G5 우선. prompt 가 OoS 명시만 (conflict 없음) → §0.G4 Rule 1 (yes 등가).

#### §0.G6 — `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `external-module-impact` | cwd 외부 path 또는 다른 target/scope 영향 | §0.G2 |
| `scope-boundary-impact` | scope out-of-scope/constraints 변경 — 차단 단위는 **그 REQ**. `--auto` 에서는 그 REQ 만 보류·기록하고 나머지 저작은 계속하며, 전체 중단은 사용자가 명시적으로 거부한 경우만 (§6.4) | §0.G4 |
| `combined-boundary-conflict` | boundary 변경과 conflict 분류 동시 발생 | §0.G5 |
| `auto-qna-mutual-exclusion` | `--auto` + `--qna` 동시 명시 ERROR (§1.2 옵션 의미) | §1.2 |
| `implementability-blocked` | Phase 3 feasibility 결과 `implementability=blocked` — Phase 4 진행 불가, 사용자 결정 필요 | §8.2 |
| `mcp-cli-both-unavailable` | SpecKiwi MCP 부재. CLI diagnostics cannot replace normal SRS read/mutation | §3.0 |
| `fact-fabrication-risk` | 존재하지 않는 함수/CVE/파일 추가 요구 거절 (§0.9) + 코드/요구사항 텍스트에 증거 없는 기능·AC 작성 (§0.4 / §0.15) — 사실 위조 | §0.9 / §0.4 / §0.15 |

---

## 1. 입력 / 출력

### 1.1 필수 입력 (택1)

- `REQ_TEXT` — 자연어 인라인 (positional)
- `REQ_PATH` — 요구사항 파일 경로

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "scope X", "{slug}에 추가" | `SCOPE` | omit → Phase 2 분류 |
| "target v0.X", "릴리즈 X" | `TARGET` | `get_active_target`; 없으면 사용자 질의 |
| "코드 경로 X" | `CODE_PATH` | cwd |
| "--auto", "자동", "묻지 말고", "질문 없이" | `--auto` | off (질문 활성이 기본) |
| "--max", "정밀 검증" | `--max` | default on |
| "local-LLM max profile", "local-LLM max profile", "local-LLM 안정성 우선", "local evaluator 으로" | `local-LLM max profile` | off (모든 local-LLM max-profile → local evaluator, `../_shared/kiwi/local-llm-profile.md` v1.0) |
| "제약 문서 X", "--constraints-doc <path>", "선언된 제약 반영" | `--constraints-doc <path>` (선언된 사용자 제약 아티팩트; §9.1 저작 입력에 포함) | omit |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드" | `--loops N` | off (스킬 기본 상한) |

**옵션 의미 (v0.11 이후 SSOT)**:
- `--auto` 와 `--qna` 동시 명시 → ERROR ("두 옵션은 상호 배타. --auto 만 사용하십시오.").
- `--auto` 부재 (기본) → Phase 1.5 QnA loop 활성 (단, Phase 1 `intent.json.ambiguities` 가 빈 배열이면 자동 skip).
- `--auto` 명시 → Phase 1.5 QnA loop skip + 외부/scope-boundary 게이트 (§0.G2/§0.G4/§0.G5) 도 *User clarification gate 발동 대신 차단* 으로 동작 (사용자 결정 보류, 자동 우회 아님). scope-boundary 게이트 (§0.G4) 의 차단 단위는 **그 REQ** 이며, 나머지 요구사항의 저작은 계속한다 (§6.4).
- `--qna` 명시 → `--auto` 의 역으로 동작 (기본과 등가). stderr 에 DEPRECATED 경고 1줄.
- **`--qna-force` (강제) ≠ `--qna` (deprecated alias)**: `--qna-force` 는 모호성이 없어 보여도 무제한 qna 루프를 **강제 진입**시키는 플래그(§5.2)이고, `--qna` 는 v0.11 까지의 deprecated alias(기본 동작 + stderr DEPRECATED 경고)다. `--qna-force` 는 `--qna` 를 **접두 부분문자열**로 포함하므로 파싱을 **fail-closed 앵커 규칙**으로 고정한다: `--qna-force`(강제)는 정확히 `--qna-force` 토큰일 때만 매칭 — 정규식 `(?<![-\w])--qna-force\b`. `--qna`(deprecated)는 뒤에 `-force` 가 붙지 않은 정확한 `--qna` 토큰일 때만 매칭 — 정규식 `(?<![-\w])--qna(?![-\w])` (즉 `--qna-force` 를 `--qna` 로 오탐하지 않는다). **substring/prefix 매칭 금지.** **fail-closed 규약**: 위 두 정규식 중 어느 것과도 정확히 일치하지 않는 토큰 — 미인식 플래그, 단일 대시 변형(`-qna`·`-qna-force` 등), 오탈자 — 은 silent no-op 도 silent 반대 동작도 아닌 **hard-error 로 거부**하고 사용자에게 오류를 보고한 뒤 중단한다(관례 역전으로 인한 무성 오동작 원천 차단). (플래그 이름은 SRS FR-FLOW-024 가 고정하므로 변경하지 않는다.)

### 1.3 출력

- **SRS Markdown**: 기존 `docs/spec/{NN}.{slug}.srs.md` 또는 MCP 로 등록된 신규 scope
- **인덱스**: `docs/spec/00.index.md` 는 MCP/SpecKiwi 도구가 관리한다. 본 스킬은 manual edit 하지 않는다
- **분석 로그**: `docs/analysis/kiwi-srs-{run-id}/`
  - `intent.json` / `code_context.json` / `existing_srs_context.json`
  - `classification.json` / `feasibility.json`
  - `srs_delta.json` (MCP 호출 로그 + before/after)
  - `eval_iter{N}.json` / `improvement_iter{N}.json`
  - `qna_log.json` (--qna 시) / `rejected_findings.log`
  - `preflight.json` (§3.0)

**Run-id**: `{YYYY-MM-DD}.{project-slug}.{req-slug}`
- `req-slug` = 새 요구사항의 최대 3-token kebab 요약 (메인 세션이 `intent.json.summary` 에서 결정적 생성)
- ASCII kebab 권장 (한글은 음차 또는 영문 키워드 추출). 최대 40자.

### 1.4 Dry-run 모드 (테스트·CI 전용)

`--dry-run` 플래그 또는 `KIWI_DRY_RUN=1` 환경변수 활성 시:

- **MCP 호출 미실행**. 모든 mutation 도구 호출은 `srs_delta.json.mcp_calls[]` 에 로그만 작성.
- **fixture 미수정**. 갱신된 Markdown은 `outputs/proposed-spec/{NN}.{slug}.srs.md` 에 별도 저장.
- **Phase 1 / Phase 5 위임 worker inline 허용** (dry-run 컨텍스트가 단일 격리 세션이므로). 프로덕션 실행은 반드시 별도 위임 worker (§0.1).
- 보고에 `mode: "dry-run"` 명시.

**dry-run User clarification gate 시뮬레이션 결정 알고리즘** (§6.4 / §0.G4 / §0.G5 게이트):

| 조건 | simulated_response | dry_run_status |
|---|---|---|
| prompt 가 OoS 항목을 명시적으로 참조 (§0.G4 Rule 1) | `yes` | `logged_ready` |
| prompt 가 boundary 변경에 침묵 | `pending_gate` | `logged_pending_gate` |
| prompt 가 boundary 변경을 명시적 거부 | `no` | `logged_blocked` |
| conflict + boundary 동시 발동 (§0.G5) | `proceed-both` / `proceed-conflict-only` / `proceed-boundary-only` / `block-all` | 4옵션 별도 기록 |

**의미적 동치**: prompt 단어와 OoS 항목 단어가 표면적으로 다르나 의미 동일한 경우 (e.g. "dueDate" prompt + "마감일" OoS) → Phase 1 intent-analyst 책임. `intent.json.semantic_equivalences: [{ prompt_term, oos_term, confidence }]` 기록. 동치 확정 시 Rule 1 (명시 참조) 등가 처리.

**기록 형식**:
```json
{
  "gate": "scope_boundary_impact|conflict_resolution|combined",
  "simulated_response": "yes|no|new-scope|pending_gate|proceed-both|...",
  "dry_run_status": "logged_ready|logged_pending_gate|logged_blocked",
  "rationale": "..."
}
```

**출력 디렉토리 컨벤션** (dry-run):
- `{output-dir}/analysis/*.json` — intent / code_context / existing_srs_context / classification / feasibility / srs_delta / eval_iter_N
- `{output-dir}/proposed-spec/{NN}.{slug}.srs.md` — 갱신된 SRS Markdown
- 루트 산출물 금지

---

## 2. Phase 흐름

```
Phase 0   : Bootstrap (preflight, TARGET 확인, summarize_target 로드)
Phase 1   : Pre-investigation (local evaluator × 1 순차 단일: intent / code / existing-SRS)
Phase 1.5 : QnA loop (기본 활성, --auto 시 skip, local evaluator, reviewer dropout)
Phase 2   : Classification (local evaluator, SCOPE 제공 + 모호성 없으면 skip)
Phase 2.5 : Scope gate (new-scope 시 User clarification gate)
Phase 3   : Feasibility (local evaluator)
Phase 4   : SRS write/update (local-LLM max-profile × 1, 분류별 §9 MCP 시퀀스)
Phase 5   : Verification (single delegated evaluator, 3 consecutive clean evaluations)
Phase 6   : Severity gate + loop → Phase 4 또는 Phase 7
Phase 7   : Finalize (validate_spec + summarize_target + 사용자 보고)
```

---

## 3. Phase 0 — Bootstrap

### 3.0 speckiwi 가용성 사전 점검

MCP 가 부재하면 스킬을 즉시 차단하고 설치/연결 가이드를 출력한다. CLI 는 진단 확인에만 사용하며 PASS 조건이 아니다.

판정 순서:
1. speckiwi MCP 도구 가용 (`get_active_target` 호출 성공) → **PASS**, Phase 0.1 진행
2. MCP 불가 → CLI 체크는 진단 로그에만 기록 (`mode: "cli-diagnostic"`). Phase 0.1 진행 금지
3. MCP 실패 → **HALT**. 사용자에게 다음 메시지 출력 후 종료. 어떤 부작용 호출도 금지:

```
⛔ kiwi-srs 차단: speckiwi 가 설치되어 있지 않거나 MCP 가 비활성 상태입니다.

다음 중 하나로 복구하십시오:

  1. CLI 설치 (필수):
     npm install -g speckiwi@latest

  2. MCP 활성화 (권장):
     Configure the SpecKiwi MCP server for host agent according to the local MCP setup, or use `npx speckiwi mcp` as the server command.

  3. 확인:
     speckiwi --version

설치 후 동일 명령으로 kiwi-srs 를 다시 실행하십시오.
```

기록: `docs/analysis/kiwi-srs-{run-id}/preflight.json`: `{ mcp: false, cli: false, halted: true }`.

dry-run 모드(`--dry-run`)에서도 동일 점검 적용.

### 3.1 TARGET 확인 (우선순위 순)

1. **사용자 지정 `TARGET` 인자** — 최우선. 다른 모든 단계 skip.
2. **MCP `get_active_target`** — 활성 target 채택.
3. **CLI `speckiwi targets --json`** — 활성 없으면 등록 목록 확인. 단일 target만 있으면 자동 채택 + 사용자에게 안내 (질의 없음).
4. **User clarification gate (single)** — 위 모두 실패 시 "어느 target에 등록하시겠습니까?".
5. 최종 선택한 TARGET이 활성과 다르면 `set_active_target` 호출. `classification.json.target` 에 기록.
6. **미등록 target 등록** — 선택한 TARGET 이 Target Map 에 없으면 `set_active_target` 을 **생성**(`create`) 옵션과 함께 호출해 등록한 뒤 진행한다. 미등록은 그 자체로 중단 사유가 아니다 — 새 wave·새 릴리스의 첫 저작은 언제나 미등록 target 에서 시작한다.

중단은 **등록 자체가 실패한 경우에만** 한다. 이때 도구가 반환한 오류를 그대로 보고한다 — 등록되지 않은 target 으로 `add_requirement` 를 진행하면 그 REQ 는 어느 Target Map 행에도 걸리지 않는다.

### 3.2 SRS 컨텍스트 로드

- `summarize_target { target: TARGET }` — 기존 REQ 총수/scope 분포
- `list_requirements { target: TARGET }` — Phase 1 SRS reader에 전달
- `docs/spec/00.index.md` file read — Scope Map 추출

---

## 4. Phase 1 — Pre-investigation (local evaluator × 1, 격리, 순차 단일)

### 4.1 Intent analyst

입력: `REQ_TEXT` 또는 `REQ_PATH` 내용
출력: `intent.json`
```json
{
  "summary": "한 줄 요약",
  "intent_type_hint": "new-feature|update|conflict|new-scope (preliminary)",
  "key_entities": [],
  "ambiguities": [],
  "implied_requirements": [],
  "semantic_equivalences": []
}
```

### 4.2 Code context analyst

입력: `CODE_PATH` + 의도 요약
출력: `code_context.json`
```json
{
  "relevant_files": [{ "path": "src/x.ts", "line_range": "45-67", "signature": "...", "relevance": "..." }],
  "related_modules": [],
  "missing_evidence": [],
  "external_paths_detected": []
}
```

`external_paths_detected` 가 비어있지 않으면 §0.G2 게이트 발동.

### 4.3 Existing SRS analyst

입력: Phase 0의 `list_requirements` 결과 + 의도 요약
출력: `existing_srs_context.json`
```json
{
  "candidate_matches": [
    { "id": "FR-TODO-001", "scope": "TODO", "title": "...", "relation_hint": "potential-conflict|potential-update|unrelated", "similarity_score": 0.0 }
  ],
  "relevant_scopes": [],
  "no_match_reason": null
}
```

### 4.4 격리

3 분석가 서로 격리. Phase 1 종료 후 메인이 결과 통합.

---

## 5. Phase 1.5 — QnA loop (기본 활성; --auto 시 skip)

reviewer dropout 패턴 (snoworca-srs-qna 로직 차용, 직접 구현 — §0.8).

**활성화 조건**:
- `--auto` 부재 (기본) → 본 Phase 진입
- `--auto` 명시 → 본 Phase 전체 skip
- `--qna` 명시 → 본 Phase 진입 + stderr DEPRECATED 경고

**자동 skip 조건** (활성 모드에서도 적용):
- Phase 1 `intent.json.ambiguities` 가 빈 배열 → "질문할 모호성 0건. QnA skip." 안내 후 Phase 2 로 진행
- Phase 1 `intent.json.semantic_equivalences` 가 모든 ambiguity 를 해소했다고 표시 → skip

본 QnA 루프는 유한 라운드가 아니라 **무제한 qna 루프**로 운영된다(§5.2). 각 라운드:
1. local evaluator QnA agent가 Phase 1 출력의 `ambiguities` + 충돌/누락 후보를 질문으로 나열
2. 사용자 답변 → agent 재평가
3. `satisfied=true` 면 종료
4. 동일 질문 2회 → 사용자에게 "잔존 모호성 기록 후 진행할까?" 확인

산출물: `qna_log.json`.

### 5.1 리서치 문서 부재 시 모호성 처리 (FR-FLOW-024 AC-1)

리서치 문서가 **없을** 때(§9.6 A/B 루프의 `--research-doc` 인자·프롬프트 참조 경로가 **미 제공**된 경우), 본 Phase 는 요구사항의 **모호성**(ambiguity)을 자체 탐지한다. 이때 kiwi-srs 는 **합리적인 기본값**이 존재하는 통상적 선택지는 스스로 결정하고, **합리적 기본값이 없는** 진정한 **비표준 모호성**(genuinely non-standard ambiguity)에 대해서**만** 사용자에게 질문한다 — 표준 관행으로 해소되는 사항까지 물어 사용자를 피로하게 만들지 않는다.

사용자가 내린 **결정**(답변·선택) 자체도 새로운 모호성을 낳을 수 있으므로, kiwi-srs 는 그 결정을 다시 **재검사**하여 남은 비표준 모호성이 있으면 **재질문**한다(결정 → 재검사 → 재질문 순환).

### 5.2 무제한 qna 루프 + 막연한 요청 자동 트리거 (FR-FLOW-024 AC-2)

기존의 유한 3/7 라운드 QnA 를 **무제한 qna 루프**(unbounded qna loop)로 대체한다 — 미해결 모호성이 남아 있는 한 라운드 상한 없이 계속 질문한다.

- **막연한 요청 자동 트리거**: 요청이 충분히 **막연**(vague)하여 요구사항을 특정할 수 없으면 — 예컨대 "**게임**(game)을 하나 만들어줘"처럼 범위가 지나치게 넓은 few-shot 예시 — 별도 플래그 없이도 무제한 qna 루프를 **자동 활성**한다.
- **`--qna-force` 강제**: `--qna-force` 플래그는 모호성이 없어 보여도 무제한 qna 루프를 **강제** 진입시킨다. v0.11 까지의 deprecated `--qna` 별칭과는 별개인 강제 플래그다(판별 앵커 규칙은 §1.2 — 정확히 `--qna-force` 토큰만 매칭하고 `--qna` 접두 부분문자열로 오탐하지 않으며, 미인식·단일 대시 변형은 fail-closed hard-error).
- **`--auto` 억제 → 위원회 위임**: `--auto` 명시 시 대화형 qna 루프와 `--qna-force` 강제 진입을 모두 **억제**(suppress)하고, 잔여 모호성 판단을 **FR-FLOW-025** `--auto` 결정 위원회로 **위임**한다(사용자 질문 없이 위원회가 조사 후 결정).
- **진동/반복 감지 가드**: 무제한 루프라도 동일 미해결 모호성이 반복(§5 각 라운드 step 4 의 "동일 질문 2회")되면 자동 진행하지 않고 사용자에게 "잔존 모호성 기록 후 진행할까?"를 확인한다 — 무제한이되 진동 시 사용자 호출로 보호한다(구 Max 모드의 "진동 감지 시 사용자 호출" 안전장치를 무제한 루프에 유지). 이 가드는 **대화형 루프 전용**이며 `--auto`/`--qna-force` 위원회 위임 경로(FR-FLOW-025)에는 적용하지 않는다(§5.3 사용자 종료 신호와 함께 대화형 루프의 이중 안전장치).

### 5.3 비-auto 루프 종료 시 자동 결정 (FR-FLOW-024 AC-3)

이 경로는 §5.2 의 `--auto`/`--qna-force` 위원회 위임과 **구별된다**. `--auto` 가 **없는** 대화형 무제한 qna 루프가 도는 도중, 사용자가 명시적으로 **종료 신호**(end-signal — 예: "이제 그만", "여기서 종료")를 보내 루프를 끝내면, kiwi-srs 는 더 이상 질문하지 않고 **남은 미해결 모호성**(remaining unresolved ambiguities)을 스스로 **자동 결정**(자동으로 결정)한다 — 각 잔여 모호성에 합리적 기본값을 적용해 결정하고 근거를 `qna_log.json` 에 기록한다. (`--auto` 초기 지정 시의 FR-FLOW-025 위원회 위임과 달리, 여기서는 대화 도중 사용자의 종료 신호가 트리거다.)

### 5.4 요구사항 수집 리서치 서브에이전트 (FR-FLOW-024 AC-4)

리서치 문서도 없고 요청도 막연해 자체 모호성 해소만으로 요구사항을 확정하기 어려우면, kiwi-srs 는 **요구사항 수집**(requirement-gathering) 리서치 **서브에이전트 3개**를 **순차로**(sequential, 한 번에 하나씩) 투입한다. 이 세 서브에이전트는 대상 도메인의 **아키텍처**·**알고리즘**·**구현 방안**(implementation plan)을 각각 조사하고, 각자의 조사 결과를 `docs/research/` 아래에 리서치 문서로 **저장**한다. 저장된 리서치 문서를 확보한 뒤 kiwi-srs 는 그대로 **FR-FLOW-023** 검증/개선(A/B) 루프(§9.6)로 진행하여, 수집된 리서치 문서를 프로세스 A 입력으로 삼는다.

---

## 6. Phase 2 — Classification (local evaluator)

### 6.1 분류

입력: Phase 1 + (Phase 1.5)
출력: `classification.json`

```json
{
  "target": "v0.1",
  "classification": "conflict|update|new-feature|new-scope",
  "rationale": "...",
  "evidence_paths": ["src/...:L45-67"],
  "affected_existing_reqs": [
    { "id": "FR-TODO-001", "relation": "conflicts_with|supersedes|depends_on", "diff_summary": "..." }
  ],
  "proposed_scope": "TODO (existing) | NEW: parser-validation",
  "proposed_prefix": "TODO | PARSE",
  "proposed_type": "functional|non_functional|interface|data|security|performance|reliability|observability|operational|migration|constraint",
  "confidence": "high|medium|low",
  "scope_boundary_impact": null,
  "external_module_impact": null
}
```

### 6.2 분류 규칙

| 라벨 | 신호 |
|---|---|
| **conflict** | 신규 REQ statement가 기존 REQ-X와 동시 만족 불가 |
| **update** | 신규 REQ가 기존 REQ-X를 확장/정제 (모순 없음) |
| **new-feature** | 기존 REQ와 직접 관계 없음, 기존 scope에 자연 귀속 |
| **new-scope** | 적합 scope 없음 (existing_srs_context의 `no_match_reason` 활용) |

### 6.3 SCOPE 사용자 지정 시

- `SCOPE` 제공 + 매칭 REQ 미발견 → `new-feature` 자동 (분류 skip)
- `SCOPE` 제공 + 매칭 REQ 존재 → conflict / update만 분류 (new-scope 후보 제외)

### 6.4 Scope-boundary impact gate

§0.G4 / §0.G5 적용. 모든 분류에서 신규 REQ가 대상 scope의 `## 2. Scope Boundaries` 또는 `## 3. Assumptions and Constraints` 와 충돌하면 게이트 발동. 변경 후보는 `classification.json.scope_boundary_impact` 에 기록:

```json
{ "section": "§2 Out of Scope", "removed_items": ["우선순위"], "added_items": [], "rationale": "..." }
```

scope-boundary 변경을 Open Questions 에만 기록하고 진행 = §0.7 위반 (차단).

`--auto` 에서는 경계와 충돌하는 그 REQ 만 **보류하고 기록한다** — 나머지 요구사항의 저작은 그대로 **계속**한다. 한 REQ 의 경계 충돌로 저작 전체를 버리면 충돌과 무관한 요구까지 같이 밀리고, 다음 실행은 같은 지점에서 다시 막힌다.

전체 중단은 사용자가 명시적으로 **거부**한 경우로 한정한다.

보류한 REQ 는 `classification.json.scope_boundary_impact.deferred_reqs[]` 에 `{ req_ref, section, rationale, reason_class: "scope-boundary-deferred" }` 로 남기고 완료 보고에 그대로 싣는다 — 기록되지 않은 보류는 조용한 누락과 구분되지 않는다.

### 6.5 Multi-aspect 요구사항 분리

§0.11 적용. 1 사용자 문장이 ≥2 코드 표면을 다루면:
- 기본: 표면당 1 REQ 분리 + `depends_on` cross-link
- 합치는 경우: `classification.rationale` 에 "merged because: ..." 기록
- 분리한 경우 각 REQ는 동일 classification 라벨 공유

---

## 7. Phase 2.5 — Scope gate (new-scope only)

`classification == "new-scope"` 일 때:

1. User clarification gate 분해 (단일 호출):
   - Q1: "새 scope 이름은? (제안: {proposed_scope})"
   - Q2: "prefix는? (제안: {proposed_prefix})"
   - Q3: "ordering NN? (인덱스 분석 후 제안)"
   - Q4 (§0.10 위반 시): type prefix 충돌 → 대안 선택
2. 신규 scope 가 필요하면 MCP 기반 scope 등록/초기화 기능을 사용한다. 도구가 없으면 HALT 하고 복구 안내
3. `set_active_target(TARGET)` — 활성이 다를 때
4. `validate_spec` — 구조 검증

---

## 8. Phase 3 — Feasibility

### 8.1 판정 (local evaluator, 도메인 복잡 시 local-LLM max-profile)

입력: Phase 1 + Phase 2
출력: `feasibility.json`

```json
{
  "implementability": "high|medium|low|blocked",
  "product_fit": "core|nice-to-have|out-of-scope",
  "rationale": "...",
  "code_evidence": ["src/...:L45-67"],
  "blockers": [],
  "conditions": [],
  "external_module_required": false
}
```

`external_module_required=true` → §0.G2 게이트 발동.

### 8.2 결과 분기

- `implementability == "blocked"` → **Phase 4 진행 안 함**. 사용자에게 보고 후 결정 요청. `add_requirement` 호출 금지.
- `product_fit == "out-of-scope"` → 사용자 확인 (속행 여부).
- 그 외 → Phase 4 진행. REQ tag에 `feasibility:high|medium|low` 첨부.

---

## MCP / CLI fallback — target 등록

정상 경로는 MCP 다. 아래 CLI 셀은 MCP 를 쓸 수 없는 degraded 상태에서 **target 등록만** 복구하기 위한 경로이며, 일반 SRS mutation 을 CLI 로 대체하는 허가가 아니다. 전체 도구 대응표는 `references/extended-workflow.md` §13 — 본 행만 여기에 인라인하는 이유는 미등록 target 등록이 §3.1 의 진입 조건이라 SKILL.md 안에서 해소되어야 하기 때문이다.

| 작업 | MCP | CLI fallback |
|---|---|---|
| Target 활성화 | `set_active_target` (미등록이면 `create`) | `speckiwi set-active-target <t> --create` |

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
SRS mutation sequences, evaluation, severity loop, finalization, fallback, and convergence criteria
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
