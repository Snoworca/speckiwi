---
name: kiwi-srs
description: "신규 요구사항을 받아 기존 코드 + speckiwi MCP SRS 데이터베이스와 교차 분석하여 conflict/update/new-feature/new-scope 4방향 분류 → 구현 가능성 판정 → speckiwi MCP를 SSOT로 SRS 증분 작성·갱신. 3 Sonnet 사전조사 병렬 + Opus 시니어 작성자 + 현재 세션 모델을 상속하는 단일 검증 서브에이전트(Max는 + 독립 2차 검증 패스) + 심각도 게이트(Normal: CRITICAL=0+HIGH=0 / Max: 2연속 MEDIUM-zero). 트리거 — SRS 업데이트, 요구사항 추가, kiwi srs 써줘, 기존 SRS에 반영해줘, 새 기능 요구사항 SRS, SRS 충돌 감지, 충돌 SRS 확인, 증분 SRS authoring, 신규 기능 SRS, 요구사항 명세 갱신, speckiwi 요구사항 등록, srs conflict 분석, kiwi srs 작성, incremental srs, add requirement to srs, update existing SRS, new feature spec, kiwi requirement authoring. **기본 QnA 활성** (Agent Dropout, 무제한 qna 루프, Phase 1 모호성 0건 시 skip). **--auto 로 질문 없이 진행** (현재의 무옵션 동작과 등가). `--qna` 는 v0.11 까지 deprecated alias. --max로 검증 강화(단일 검증 서브에이전트 + 독립 2차 검증 패스, 2연속 MEDIUM-zero 종료). 평가·검증은 현재 세션 모델을 상속하는 단일 검증 서브에이전트로 수행하며 `--model <name>` 로 override 한다(게이트 불변). 종료 시 ./kiwi/pipeline.jsonl 에 이벤트 1줄 append (kiwi-pipeline 메타 스킬용)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-srs v0.11

신규 요구사항을 받아 **기존 코드 + 기존 speckiwi SRS**와 교차 분석하여 **4-way 분류** → **feasibility 판정** → **speckiwi MCP를 SSOT로 SRS 증분 작성·갱신**하는 스킬.

**규칙 진술 원칙**: 본 문서의 모든 규칙은 **현재 적용되는 동작**만 declarative하게 기술한다. 연혁/정정/이관 주석은 git history 로 추적한다 (본문에 변경 이력 섹션 없음). 에이전트는 본문을 시간 차원 없이 그대로 적용한다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 별도 서브에이전트**. 인라인 자가검증 금지 |
| §0.2 | **검증자 입력 격리**. Phase 4 작성자의 결론 JSON·정당화 전달 금지. 원본 REQ + 코드 + 생성된 SRS 파일 + 필터링된 컨텍스트만 |
| §0.3 | **코드 증거 우선**. 신규/갱신 REQ는 `add_requirement` 시 `trace` 배열에 source 첨부 (NFR/PERF 예외) |
| §0.4 | **할루시네이션 금지**. 코드/요구사항 텍스트에 증거 없는 기능 작성 금지. 추정은 `stability=draft` + `[INFERRED:high\|med\|low]` |
| §0.5 | **SRS-MD Authoring Rules v3.0.0 준수**. heading / ID 정규식 / prefix-type 매핑 위반 금지. `checked_compatible` 호환성 캐시 필드(§23.5, `semanticSha`/`checked-at`)는 허용 필드 allowlist 에 포함 |
| §0.6 | **speckiwi MCP 우선 + 황금률**. CLI 직접 호출은 MCP 부재 시에만. **황금률**: speckiwi MCP mutation 도구 (`add_requirement` / `update_status` / `add_trace_link` / `add_verification_evidence` / `check_acceptance_criteria` / `add_completed_work` / `set_active_target`) 호출 1회 = Markdown line-patch 1회 (`apply-patch.ts` atomic write). **mutation 호출 후 동일 SRS 파일에 `Edit` 도구 사용 절대 금지** (예외는 §9.4) |
| §0.7 | **scope/target 결정은 사용자 확인**. AskUserQuestion 단일 호출 분해 |
| §0.8 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.9 | **사실 위조 거절**. 존재하지 않는 함수/CVE/파일 추가 요구는 거절 + `rejected_findings.log` |
| §0.10 | **type prefix와 scope prefix 동일 자동 제외** (FR/NFR/IR/DR/SEC/PERF/REL/OBS/OPS/MIG/CON) |
| §0.11 | **Multi-aspect 요구사항 분리**. 1개 사용자 문장이 ≥2 코드 표면(예: addTodo + listTodos)을 다루면 기본은 표면당 1개 REQ로 분리하고 `depends_on` 으로 연결. 합치는 경우 `classification.rationale` 에 사유 기록 |
| §0.12 | **`[INFERRED:level]` 배치 위치**. Markdown SRS에서는 (a) 추론 항목이 AC 라인 → 해당 AC 끝에 ` [INFERRED:high\|med\|low]` 부착, (b) 기본값/검증 정책 등 statement 차원 → §6 Open Questions 에 별도 등재 + REQ의 `rationale` 필드에도 동일 라벨 명시 |
| §0.13 | **[INFERRED] 2단계 분류**. 라벨 뒤에 `:user_required` 또는 `:advisory` 추가. `user_required` = `status: proposed → planned` 승격 **전 사용자 답변 필수**. `advisory` = 참고용, 승급 가능. 예: `[INFERRED:med:user_required]` |
| §0.14 | **Trace intent 분리**. Code 타입 trace entry 에만 적용 — Requirement 타입 trace_link 에는 `trace_intent` 필드 미부착. Code trace `trace_intent` enum: `verifies` (기존 코드가 statement 동작 수행) / `addition_site` (해당 위치에 구현 추가 예정) / `negative` (의도된 부재). **Dual-intent split**: 동일 file:line-range 가 두 intent 를 동시에 가지면 범위 폭이 다른 별도 entry로 분리 등록. **Status cap**: 어느 trace 라도 `trace_intent=addition_site` 잔존 시 해당 REQ 의 status 는 `proposed` 상한. 라이브 모드에서 `update_status(planned\|implemented)` 호출 시도 → 차단 + AskUserQuestion "구현 증거가 있습니까? (코드 path:line)" |
| §0.15 | **Fabricated AC → OQ 강제**. AC 항목에 코드 증거 없거나 사용자 prompt 에 명시 없는 구체 값(예: 400-error body shape, 특정 timeout 초)이 포함되면 AC 라인에 포함 금지 — 대신 §6 Open Questions 에 `[NEEDS-USER]` 라벨로 등재. AC는 결정 가능 명제만. **Canonical placeholder grammar**: AC 본문이 OQ 결정을 참조하면 `{{OQ-N}}` 형식만 허용. `<default per OQ-1>`, `pending decision`, `TBD` 등 자유 형식 금지 |
| §0.16 | **Discarded/Draft 마커 정책**. kiwi-srs 는 본문 마커(strikethrough / `[DISCARDED]` / `[DRAFT]`) 적용을 skip — speckiwi `Status=discarded` + `add_completed_work` Change Notes 기록을 SSOT 로 간주. 인덱스 (`00.index.md`) `(discarded)`/`(draft)` 접미사도 speckiwi mutation 이 자동 처리 |
| §0.17 | **finding_hash 정확화**. `finding_hash = sha1(utf8_bytes(f"{req_id or '_'}|{axis}|{evidence_path or '_'}|{severity}"))` — lowercase hex digest 40자 결과 문자열, 포뮬러 리터럴(`"sha1('...')"`) 금지. **Test vector**: `sha1_hex("FR-TODO-004|ac|src/api.ts:7-11|HIGH")` = `a5c02377715e12f316cec087d202cb76315c734c`. 평가자는 동일 입력으로 디지스트 계산 → 불일치 시 자체 거절 |
| §0.18 | **Canonical relation encoding**. REQ 간 의존성은 `add_trace_link { type: "Requirement", relation: "depends_on\|supersedes\|conflicts_with\|extends\|regression-only" }` 만 SSOT. `tags: ["depends_on:X"]` 같은 tag 형식 금지. **방향 SSOT**: trace_link 는 항상 `id: {신규 REQ} → reference: {기존 REQ}` 방향. e.g. `supersedes`: `{NEW-ID} supersedes {OLD-ID}` |
| §0.19 | **외부 모듈 수정 시 사용자 확인 의무**. 작업 대상은 cwd 하위 모듈로 한정. cwd 외부 경로(상위 디렉토리, 형제 프로젝트, 외부 패키지, monorepo 다른 워크스페이스) 수정 신호 감지 시 즉시 중단 + AskUserQuestion. 상세는 §0.G2 결정표 |
| §0.20 | **검증 서브에이전트 모델 정책 SSOT**. SRS 만족도 평가자·QnA 라운드 등 평가·검증은 **단일(single) 검증 서브에이전트**로 수행하며 기본적으로 **현재 세션 모델(current session model)**을 상속한다 (기존 Opus×1+Sonnet×1 이중 모델 평가자 패널을 대체). `--model <name>` (또는 사용자가 지명한 모델) 로 이 검증 서브에이전트의 모델을 override 한다. 검증 서브에이전트 구성 외 심각도 게이트·라운드 상한·QnA 라운드 수는 불변 |
| §0.21 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. 기존 `--auto` 시맨틱 (Phase 1.5 QnA loop skip + AskUserQuestion 발동 대신 **차단** — §1.2 4번째 bullet) 은 유지되며, 차단 대상 게이트(외부 모듈 §0.G2 / scope-boundary §0.G4 / combined §0.G5)는 본 §0.G6 critical_gates 에 인라인된다. `--auto` 와 `--qna` 동시 명시 ERROR 시맨틱(§1.2) 도 critical. 본 스킬의 `critical_gates[]` 는 §0.G6 (아래) 참조 |
| §0.22 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |

### §0.G — 핵심 게이트 결정표

본 절은 §0.6 / §0.14 / §0.19 / §6.4 / §10.2 axis 10 의 IF-THEN 결정 규칙을 모은 단일 참조표. 에이전트는 조건 매칭 → 동작 실행을 결정적으로 수행한다.

#### §0.G1 — 황금률 (mutation ↔ Edit)

| IF (조건) | THEN (동작) | 위반 severity |
|---|---|---|
| speckiwi mutation 도구 호출 (§0.6 enum) | Markdown 자동 line-patch 1회 발생; 추가 Edit 호출 금지 | — |
| mutation 호출 후 동일 `docs/spec/*.srs.md` 에 `Edit` 도구 사용 | 차단 + 작성자 재spawn | **CRITICAL** (axis 10) |
| 새 scope 파일 초기 템플릿 작성 (Phase 2.5, 빈 파일) | `Edit` 허용 | — |
| §1/§3/§5/§6 prose 영역 갱신 (mutation 미지원 자유 텍스트) | `Edit` 허용 + 직후 `validate_spec` 필수 | — |
| §4 Requirements / §7 Change Notes / §2 In/Out of Scope 표 | `Edit` 금지 (mutation 전용) | **CRITICAL** |

#### §0.G2 — 외부 모듈 영향 (§0.19)

| IF (감지 채널) | THEN (동작) |
|---|---|
| trace 후보가 cwd 외부 path | 즉시 중단 + AskUserQuestion |
| conflict/update 대상 REQ 가 다른 scope/target | 즉시 중단 + AskUserQuestion |
| feasibility 판정이 외부 모듈 변경을 전제 | 즉시 중단 + AskUserQuestion |
| Phase 1 code-context analyst 가 외부 경로를 relevant_files 로 보고 | 즉시 중단 + AskUserQuestion |

AskUserQuestion 3옵션: `(1) 진행 승인` / `(2) 외부 변경 제외하고 cwd 한정` / `(3) 작업 중단 후 외부 작업장 재실행`. 사용자 답변 전 외부 경로에 `add_requirement` / `update_status` / `Edit` 등 부작용 호출 절대 금지. `classification.json.external_module_impact` 에 감지 내역 기록.

#### §0.G3 — Trace intent status cap (§0.14)

| IF | THEN |
|---|---|
| REQ 의 어느 Code trace 라도 `trace_intent = addition_site` 잔존 | status 상한 = `proposed` |
| 위 상태에서 `update_status(planned\|implemented)` 호출 시도 | 차단 + AskUserQuestion "구현 증거 path:line 제시 가능?" |
| 사용자가 path:line 제시 → 검증 통과 | `addition_site` → `verifies` 로 trace 갱신 → status 승급 허용 |
| 동일 file:line-range 가 두 intent 동시 보유 | 범위 폭이 다른 별도 entry 로 분리 등록 (단일 entry `verifies+addition_site` 금지) |

#### §0.G4 — Scope boundary impact (§6.4)

| IF | THEN |
|---|---|
| 신규 REQ 가 대상 scope §2 Out of Scope 또는 §3 Constraints 와 충돌 | `classification.json.scope_boundary_impact` 기록 + AskUserQuestion 3옵션 |
| 응답 `yes` | Phase 4 진행; Markdown sync 단계에서 §2 갱신 |
| 응답 `no` | 사용자 결정 대기; `add_requirement` 호출 금지 |
| 응답 `new-scope 분리` | classification 갱신 → Phase 2.5 진입 |
| boundary 영향을 Open Questions 에만 기록하고 진행 | §0.7 위반 (차단) |

#### §0.G5 — Combined gate (boundary + conflict 동시)

| IF | THEN (단일 트랜잭션 4옵션) |
|---|---|
| §6.4 boundary 변경 + conflict 분류 동시 식별 | AskUserQuestion 단일 호출, 선택지 4종 |
| `proceed-both` | conflict 시퀀스 + boundary §2 sync 모두 실행 |
| `proceed-conflict-only` | conflict MCP 시퀀스만; §2 변경 skip → `[BOUNDARY-PENDING]` 마커 + `boundary_change_deferred: true` |
| `proceed-boundary-only` | §2 sync 만; conflict 신규 REQ `add_requirement` skip → `conflict_reqs_deferred: true` |
| `block-all` | 양쪽 skip; MCP 호출 0건; 사용자 결정 대기 |

**우선순위**: prompt 가 OoS 명시 + conflict 동시 발견 → 본 G5 우선. prompt 가 OoS 명시만 (conflict 없음) → §0.G4 Rule 1 (yes 등가).

#### §0.G6 — `--auto` critical_gates[] 선언

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트 (SSOT `_shared/kiwi/auto-option.md` §5 인터페이스 준수). 기존 §1.2 "AskUserQuestion 발동 대신 차단" 시맨틱의 대상 게이트를 본 표로 인라인 — 결정 서브에이전트로 우회 금지:

| gate_id | reason | 발생 위치 |
|---|---|---|
| `external-module-impact` | trace 후보 / conflict / feasibility / code-context 가 cwd 외부 path 진입 (§0.G2) | §0.G2 |
| `scope-boundary-impact` | 신규 REQ 가 §2 Out of Scope 또는 §3 Constraints 와 충돌 (§0.G4) | §0.G4 / §6.4 |
| `combined-boundary-conflict` | §0.G5 단일 트랜잭션 4옵션 (boundary + conflict 동시) | §0.G5 |
| `auto-qna-mutual-exclusion` | `--auto` + `--qna` 동시 명시 ERROR (§1.2 옵션 의미) | §1.2 |
| `implementability-blocked` | Phase 3 feasibility 결과 `implementability=blocked` — 진행 불가 사용자 결정 필요 | §10.2 axis (feasibility) |
| `mcp-cli-both-unavailable` | preflight MCP + CLI 모두 부재 (§3.0 case 3) — HALT 강제 | §3.0 |
| `fact-fabrication-rejection` | 존재하지 않는 함수/CVE/파일 추가 요구 거절 (§0.9) — 사실 위조 시도 | §0.9 |

**기존 시맨틱 보존**: §1.2 의 "`--auto` 명시 → ... 외부/scope-boundary 게이트 (§0.G2/§0.G4/§0.G5) 도 *AskUserQuestion 발동 대신 차단* 으로 동작" 는 본 §0.G6 의 `critical_gates[]` 인라인 선언으로 보존된다 — 차단 동작은 SSOT §4 의 `critical` severity 처리 (HALT, --auto 무관) 와 동일.

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
| "--auto", "자동", "묻지 말고", "질문 없이" | `--auto` (SSOT: auto-option.md v1.0) | off (질문 활성이 기본) |
| "--qna", "질문하며 작성" | `--qna` (deprecated alias) | — — 본 인자는 v0.11 까지 QnA 모드 alias 로 동작하고 v0.12 부터 제거. 사용 시 stderr `[DEPRECATED] --qna is now default; use --auto to suppress` |
| "--max", "정밀 검증" | `--max` | off |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (단일 검증 서브에이전트) |
| "리서치 문서 X", "--research-doc <path>", "연구 문서로 SRS 검증" | `--research-doc <path>` (반복 가능; §9.6 A/B 루프 인자) | omit → 단발 패스 |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |

**옵션 의미 (v0.11 이후 SSOT)**:
- `--auto` 와 `--qna` 동시 명시 → ERROR ("두 옵션은 상호 배타. --auto 만 사용하십시오.").
- `--auto` 부재 (기본) → Phase 1.5 QnA loop 활성 (단, Phase 1 `intent.json.ambiguities` 가 빈 배열이면 자동 skip).
- `--auto` 명시 → Phase 1.5 QnA loop skip + 외부/scope-boundary 게이트 (§0.G2/§0.G4/§0.G5) 도 *AskUserQuestion 발동 대신 차단* 으로 동작 (사용자 결정 보류, 자동 우회 아님).
- `--qna` 명시 → `--auto` 의 역으로 동작 (기본과 등가). stderr 에 DEPRECATED 경고 1줄.
- **`--qna-force` (강제) ≠ `--qna` (deprecated alias)**: `--qna-force` 는 모호성이 없어 보여도 무제한 qna 루프를 **강제 진입**시키는 플래그(§5.2)이고, `--qna` 는 v0.11 까지의 deprecated alias(기본 동작 + stderr DEPRECATED 경고)다. `--qna-force` 는 `--qna` 를 **접두 부분문자열**로 포함하므로 파싱을 **fail-closed 앵커 규칙**으로 고정한다: `--qna-force`(강제)는 정확히 `--qna-force` 토큰일 때만 매칭 — 정규식 `(?<![-\w])--qna-force\b`. `--qna`(deprecated)는 뒤에 `-force` 가 붙지 않은 정확한 `--qna` 토큰일 때만 매칭 — 정규식 `(?<![-\w])--qna(?![-\w])` (즉 `--qna-force` 를 `--qna` 로 오탐하지 않는다). **substring/prefix 매칭 금지.** **fail-closed 규약**: 위 두 정규식 중 어느 것과도 정확히 일치하지 않는 토큰 — 미인식 플래그, 단일 대시 변형(`-qna`·`-qna-force` 등), 오탈자 — 은 silent no-op 도 silent 반대 동작도 아닌 **hard-error 로 거부**하고 사용자에게 오류를 보고한 뒤 중단한다(관례 역전으로 인한 무성 오동작 원천 차단). (플래그 이름은 SRS FR-FLOW-024 가 고정하므로 변경하지 않는다.)

### 1.3 출력

- **SRS Markdown**: `docs/spec/{NN}.{slug}.srs.md` (기존 또는 신규 scope)
- **인덱스**: `docs/spec/00.index.md` (신규 scope 시 Edit)
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
- **Phase 1 / Phase 5 서브에이전트 inline 허용** (dry-run 컨텍스트가 단일 격리 세션이므로). 프로덕션 실행은 반드시 별도 서브에이전트 (§0.1).
- 보고에 `mode: "dry-run"` 명시.

**dry-run AskUserQuestion 시뮬레이션 결정 알고리즘** (§6.4 / §0.G4 / §0.G5 게이트):

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
Phase 1   : Pre-investigation (Sonnet × 3 병렬: intent / code / existing-SRS)
Phase 1.5 : QnA loop (기본 활성, --auto 시 skip, Sonnet, Agent Dropout)
Phase 2   : Classification (Sonnet, SCOPE 제공 + 모호성 없으면 skip)
Phase 2.5 : Scope gate (new-scope 시 AskUserQuestion)
Phase 3   : Feasibility (Sonnet)
Phase 4   : SRS write/update (Opus × 1, 분류별 §9 MCP 시퀀스)
Phase 5   : Verification (단일 현재 세션 모델 검증 서브에이전트; Max: + 독립 2차 검증 패스)
Phase 6   : Severity gate + loop → Phase 4 또는 Phase 7
Phase 7   : Finalize (validate_spec + summarize_target + 사용자 보고)
```

---

## 3. Phase 0 — Bootstrap

### 3.0 speckiwi 가용성 사전 점검

MCP 와 CLI 가 모두 부재하면 스킬을 즉시 차단하고 설치 가이드를 출력한다.

판정 순서:
1. speckiwi MCP 도구 가용 (`get_active_target` 호출 성공) → **PASS**, Phase 0.1 진행
2. MCP 불가 → CLI 체크: `speckiwi --version` (또는 `npx speckiwi --version`) exit 0 → **PASS** (`mode: "cli-fallback"` 기록), Phase 0.1 진행
3. 둘 다 실패 → **HALT**. 사용자에게 다음 메시지 출력 후 종료. 어떤 부작용 호출도 금지:

```
⛔ kiwi-srs 차단: speckiwi 가 설치되어 있지 않거나 MCP 가 비활성 상태입니다.

다음 중 하나로 복구하십시오:

  1. CLI 설치 (필수):
     npm install -g speckiwi@latest

  2. MCP 활성화 (권장):
     claude mcp add speckiwi npx speckiwi mcp

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
4. **AskUserQuestion (single)** — 위 모두 실패 시 "어느 target에 등록하시겠습니까?".
5. 최종 선택한 TARGET이 활성과 다르면 `set_active_target` 호출. `classification.json.target` 에 기록.

### 3.2 SRS 컨텍스트 로드

- `summarize_target { target: TARGET }` — 기존 REQ 총수/scope 분포
- `list_requirements { target: TARGET }` — Phase 1 SRS reader에 전달
- `docs/spec/00.index.md` Read — Scope Map 추출

---

## 4. Phase 1 — Pre-investigation (Sonnet × 3, 격리, 병렬)

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

Agent Dropout 패턴 (snoworca-srs-qna 로직 차용, 직접 구현 — §0.8).

**활성화 조건**:
- `--auto` 부재 (기본) → 본 Phase 진입
- `--auto` 명시 → 본 Phase 전체 skip
- `--qna` 명시 → 본 Phase 진입 + stderr DEPRECATED 경고

**자동 skip 조건** (활성 모드에서도 적용):
- Phase 1 `intent.json.ambiguities` 가 빈 배열 → "질문할 모호성 0건. QnA skip." 안내 후 Phase 2 로 진행
- Phase 1 `intent.json.semantic_equivalences` 가 모든 ambiguity 를 해소했다고 표시 → skip

본 QnA 루프는 유한 라운드가 아니라 **무제한 qna 루프**로 운영된다(§5.2). 각 라운드:
1. Sonnet QnA agent가 Phase 1 출력의 `ambiguities` + 충돌/누락 후보를 질문으로 나열
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

리서치 문서도 없고 요청도 막연해 자체 모호성 해소만으로 요구사항을 확정하기 어려우면, kiwi-srs 는 **요구사항 수집**(requirement-gathering) 리서치 **서브에이전트 3개**를 병렬 투입한다. 이 세 서브에이전트는 대상 도메인의 **아키텍처**·**알고리즘**·**구현 방안**(implementation plan)을 조사하고, 각자의 조사 결과를 `docs/research/` 아래에 리서치 문서로 **저장**한다. 저장된 리서치 문서를 확보한 뒤 kiwi-srs 는 그대로 **FR-FLOW-023** 검증/개선(A/B) 루프(§9.6)로 진행하여, 수집된 리서치 문서를 프로세스 A 입력으로 삼는다.

---

## 6. Phase 2 — Classification (Sonnet)

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

### 6.5 Multi-aspect 요구사항 분리

§0.11 적용. 1 사용자 문장이 ≥2 코드 표면을 다루면:
- 기본: 표면당 1 REQ 분리 + `depends_on` cross-link
- 합치는 경우: `classification.rationale` 에 "merged because: ..." 기록
- 분리한 경우 각 REQ는 동일 classification 라벨 공유

---

## 7. Phase 2.5 — Scope gate (new-scope only)

`classification == "new-scope"` 일 때:

1. AskUserQuestion 분해 (단일 호출):
   - Q1: "새 scope 이름은? (제안: {proposed_scope})"
   - Q2: "prefix는? (제안: {proposed_prefix})"
   - Q3: "ordering NN? (인덱스 분석 후 제안)"
   - Q4 (§0.10 위반 시): type prefix 충돌 → 대안 선택
2. Write `docs/spec/{NN}.{slug}.srs.md` — kiwi-srs-from-code §6.2 템플릿
3. Edit `docs/spec/00.index.md` §2 SRS Documents + §4 Scope Map
4. `set_active_target(TARGET)` — 활성이 다를 때
5. `validate_spec` — 구조 검증

---

## 8. Phase 3 — Feasibility

### 8.1 판정 (Sonnet, 도메인 복잡 시 Opus)

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

## 9. Phase 4 — SRS write/update (Opus × 1)

### 9.1 작성자 컨텍스트

작성자 Opus 서브에이전트에게 전달:
- Phase 1/2/3 산출물
- `existing_srs_context.json` (관련 REQ 전체 내용)
- 신규 REQ 초안 (Phase 2의 proposed_*)
- 분류별 MCP 시퀀스 (§9.2)
- §0.G 결정표

신규 REQ 기본 status: **`proposed`** (사용자 미승인).

### 9.2 분류별 MCP 시퀀스

#### conflict

1. `get_requirement { id: REQ-X }`
2. `add_requirement` — new REQ
   - `status: "proposed"`
   - `tags: ["conflict-with:REQ-X", "feasibility:{level}"]`
   - `rationale: "Conflicts with REQ-X: {reason}. Pending user resolution."`
   - `trace`: 코드 증거
3. `add_trace_link { id: NEW-ID, type: "Requirement", reference: "REQ-X", relation: "conflicts_with", notes: "{reason}; re_stated_from: REQ-X#AC1, REQ-X#AC2; reason_detail: {refinement-detail}" }`
   - `re_stated_from` provenance 는 `notes` 에 grammar `re_stated_from:\s*REQ-ID#ACn(,\s*REQ-ID#ACn)*` 로 인라인 인코딩 (speckiwi `add_trace_link` 가 별도 필드 미지원)
4. `update_status { id: "REQ-X", status: "draft" }` — 자동 폐기 회피. status 만 변경, `stability` 필드 불변. 변경 사유는 §7 Change Notes 가 SSOT
5. **Final `validate_spec`** — Markdown sync 완료 후 호출
6. **사용자에게 충돌 보고** — `--qna` 미사용 시에도 conflict 발견은 사용자 결정 필요. §6.4 boundary 게이트와 동시 발동 시 §0.G5 적용

#### update

1. `get_requirement { id: REQ-X }`
2. `add_requirement` — new REQ
   - `status: "proposed"`
   - `tags: ["supersedes:REQ-X", "feasibility:{level}"]`
   - `rationale: "Supersedes REQ-X: {delta}"`
   - **`acceptanceCriteria` 정책**: 원본 REQ-X 의 AC를 재진술 + 신규 AC 추가 (참조 형식 금지). `check_acceptance_criteria` 가 REQ별 독립 AC를 요구하므로 ID-참조는 검증 불가
3. `add_trace_link { id: NEW-ID, type: "Requirement", reference: "REQ-X", relation: "supersedes", notes: "{delta}; re_stated_from: REQ-X#AC1, REQ-X#AC2" }`
4. `update_status { id: REQ-X, status: "discarded" }` — Change Notes에 NEW-ID 참조 (SRS-MD §11.4 ID 재사용 금지). status 만 변경, `stability` 불변
5. `add_trace_link { id: NEW-ID, type: "Code", reference: "{path:line}", trace_intent: "verifies|addition_site" }`
6. **Markdown sync** (§9.4)
7. **Final `validate_spec`** — Markdown sync 완료 후 재호출

#### new-feature

1. `add_requirement` — type / scope / target / title / requirement / acceptanceCriteria / trace=[Code, with `trace_intent`] / status=proposed / priority / tags=[feasibility:{level}]
2. `add_trace_link` — 관련 REQ 의존성 (`depends_on` / `extends`, 방향: NEW-ID → 기존 REQ; §0.18)
   - cross-REQ AC 재진술 시 `notes: "{base}; re_stated_from: REQ-X#ACn"` provenance 필수
3. `validate_spec` — pre-check
4. **Markdown sync** (§9.4)
5. **Final `validate_spec`** — Markdown sync 완료 후 재호출

**AC cross-REQ claim 금지**: new-feature 가 `depends_on` 으로 다른 REQ를 참조할 때, 그 의존 REQ의 동작을 AC로 단정 금지. 필요 시 의존 REQ AC를 재진술 + `re_stated_from` 인라인 provenance.

#### new-scope

Phase 2.5에서 scope 파일 + 인덱스 등록 완료. 여기서는 `add_requirement` 실행 (new-feature와 동일).

### 9.4 Markdown 반영 (speckiwi 황금률)

§0.G1 결정표 적용. **speckiwi MCP mutation 호출 = Markdown line-patch 1회. 추가 `Edit` 도구 사용 금지.**

speckiwi 보장 사항:
- `add_requirement` → §4 Requirements 신규 블록 자동 삽입 (`renderRequirementBlock` 결정적 출력)
- `update_status` → Status metadata row 단일 `replaceLine`
- `add_trace_link` → Trace Links 테이블 row insert
- `add_completed_work` → `00.index.md` Completed Work Log + Change Notes 자동 row 추가
- 모든 호출은 `apply-patch.ts` SHA256 snapshot stale-check + tmp+rename atomic write

작성자 Opus 서브에이전트 책임:
1. 분류 결과에 따른 §9.2 mutation 시퀀스 호출
2. 시퀀스 종료 후 `validate_spec` 1회 호출 → PASS 확인
3. mutation 도구 외 어떤 방법으로도 `docs/spec/*.srs.md` 파일 수정 금지

**§6.4 게이트 통과 후 §2 Scope Boundaries 변경**: 현재 mutation API 미제공. 사용자 prose 영역으로 간주하여 `Edit` 가능 (§0.G1 예외). 변경 후 `validate_spec` 필수.

### 9.5 산출물

`srs_delta.json`:
```json
{
  "classification": "...",
  "mode": "live|dry-run",
  "mcp_calls": [
    { "tool": "add_requirement", "args": {...}, "result_id": "FR-TODO-004", "ok": true }
  ],
  "scope_doc_edits": [
    { "file": "docs/spec/10.todo-core.srs.md", "section": "§4 Requirements", "op": "append" }
  ],
  "validate_spec_result": { "ok": true, "diagnostics": [] },
  "change_notes_diff": "- 2026-05-13 update: FR-TODO-004 supersedes FR-TODO-001 ...",
  "oos_changes": { "removed": [], "added": [] },
  "added_ids": [],
  "demoted_ids": [],
  "discarded_ids": []
}
```

### 9.6 리서치 문서 기반 SRS 검증/개선 (A/B) 루프 (Phase 4.5)

`kiwi-srs` 는 하나 이상의 **리서치 문서**(연구 문서)를 명시적 `--research-doc <path>` **인자**(반복 지정 가능)로 받거나, 사용자 **프롬프트**에서 **참조**된 경로("docs/research/foo.md 리서치 문서를 사용" 형태)로 해석하여 루프 진입 전에 확보한다. 확보한 리서치 문서는 프로세스 A 로 투입된다. 리서치 문서가 주어지면 kiwi-srs 는 단발 Phase 4→7 패스 대신 아래 A/B 검증/개선 루프를 돈다.

이 루프는 두 개의 독립 서브에이전트 — **프로세스 A**(검증)와 **프로세스 B**(적용) — 가 번갈아 도는 A/B 구조다.

**프로세스 A — 검증.** 프로세스 A 는 리서치 문서를 이미 작성된 SRS 와 대조하여 다음을 보고한다: (i) 리서치에는 있으나 SRS 에 **누락된 요구**사항, (ii) **잘못 작성**된(요구 의도와 어긋나게 기술된) 부정확 요구사항, (iii) 각 요구사항의 현재 아키텍처상 **구현 가능성**(feasibility) — feasibility-policy-schema-v1 의 인라인 feasibility 휴리스틱을 재사용한다(새 dual-mode 인터페이스 없음). 또한 프로세스 A 는 제안된 SRS 변경이 **기존 제품 기능**을 **회귀**(손상)시키는지 플래그한다. 프로세스 A 는 **개선사항 문서**를 run-scoped **임시 디렉터리**(실행 단위 임시 경로, run-id 로 키된 OS temp 경로)에 기록한다. 프로세스 A 가 개선사항이 없다고 판단하면 루프를 **종료**한다(개선사항이 없으면 종료; 0건이면 exit).

**프로세스 B — 적용.** 프로세스 B 는 개선사항 문서를 읽어 개선 내용을 Phase 4 speckiwi MCP mutation 시퀀스(§9.2)로 SRS 에 **반영/적용**한 뒤, 재검증을 위해 **제어권을 프로세스 A 로 반환**한다.

**발산 가드(divergence guard).** A/B 루프는 최대 반복(maximum-iteration) 발산 가드로 상한을 둔다: **5 (기본) / 8 (--max)** 회 반복에서 멈춘다. 상한 도달 시 루프를 중단하고 잔여 개선사항을 사용자 결정용으로 보고한다.

**검증 팬아웃(fan-out).**
- 기본, 단일 리서치 문서: 프로세스 A 는 검증 서브에이전트 1개를 돌린다.
- `--max`, 단일 문서 기준: 프로세스 A 는 그 단일 문서에 대해 검증 **서브에이전트 3개**(3 verification subagents)를 교차 검증에 투입한다.
- 다중 리서치 문서, 비-max: 프로세스 A 는 검증 서브에이전트를 **문서별로 순차**(sequential, per document)로 생성한다(문서 1개당 서브에이전트 1개, 한 번에 한 문서씩).
- 다중 리서치 문서, `--max`: 프로세스 A 는 (**문서 수 × 3**, document count × 3)개의 검증 서브에이전트를 병렬로 팬아웃한다 — 단일 문서 3-서브에이전트 기준을 리서치 문서 수만큼 스케일한다.

---

## 10. Phase 5 — Verification

### 10.1 평가자 입력 (§0.2 격리)

**허용 — 평가자가 보는 사실 입력**:
- 원본 `REQ_TEXT`/`REQ_PATH` 내용
- `intent.json.summary` + `intent.json.ambiguities` 만
- `existing_srs_context.json.candidate_matches[]`
- `classification.json.classification` (라벨만) + `affected_existing_reqs[]`
- `feasibility.json.implementability` + `product_fit` + `code_evidence[]`
- 새로 작성된 SRS Markdown 전체
- `list_requirements { scope, target }` 현재 상태
- `srs_delta.json.scope_doc_edits[]` + `srs_delta.json.mcp_calls[*].{tool, args.id, args.reference, result_id, ok}` (axis 10 검출용 메타데이터)
- 직전 `eval_iter{N-1}.json` (있을 때, escalation 판정용)

**금지 — 평가자에게 다음 필드 strip**:
- `srs_delta.json.mcp_calls[*].args.rationale` (작성자 정당화)
- `classification.json.rationale` (분류 정당화)
- `feasibility.json.rationale` (구현 가능성 정당화)
- Phase 4 작성자의 내부 모놀로그/메모

### 10.2 검증 축 (10개)

검증 서브에이전트가 독립 검토 (Max 2차 패스도 동일 축):

1. **Classification correctness** — 4-way 라벨 적합?
2. **Conflict integrity** — conflict 시 상대 REQ-ID 명시 + status 갱신?
3. **Trace link validity** — 코드 path:line 실존?
4. **AC verifiability** — AC 코드/테스트 검증 가능?
5. **Scope fit** — 할당 scope 적합? cross-scope 누수 없음?
6. **Incremental delta consistency** — update 시 supersede 명시? 용어 일관성?
7. **Feasibility grounding** — 구현 가능성/제품 적합성 코드 증거 뒷받침?
8. **MCP call completeness + SRS-MD compliance** — 필수 MCP 호출 완료? §10-11 준수?
9. **Requirement internal coherence** — 작성된 신규/갱신 REQ 자체의 내부 일관성 검증:
   - (a) **모호 어휘**: "빠르게", "적절한", "사용자 친화적", "fast", "appropriate", "user-friendly" 같이 측정 불가 형용사·부사가 statement 또는 AC에 있는가?
   - (b) **statement ↔ AC 모순**: REQ 본문 단언과 AC 항목이 충돌? (예: "삭제할 수 없다" + "AC: DELETE 호출 시 204 반환")
   - (c) **AC 간 모순**: AC #N과 AC #M이 동시 만족 불가? (예: #1 "빈 title 거부" + #2 "title 없으면 자동 채움")
   - (d) **타입/제약 자가 모순**: `type=functional` 인데 statement가 "성능"만 기술, `priority=critical` 인데 rationale 이 "nice-to-have"
   - (e) **trace ↔ statement 모순**: trace 가 가리키는 코드 동작이 statement 와 정반대 (코드 1초 timeout, statement 무한 대기)

   Severity:
   - (b)/(c)/(e) → **CRITICAL** (자체 모순; 검증 불가능)
   - (a) 다수 / (d) → **HIGH**
   - (a) 단일 어휘 / 경미한 wording → **MEDIUM**

   **HIGH inflation guard** — 평가자 finding 출력 시 다음 필드 모두 필수:
   - `vague_terms: [string, ...]` — 검출 모호 어휘
   - `linked_oq: ["OQ-2", ...]` — 명시적으로 연결된 [NEEDS-USER] OQ id

   **모호 어휘 keyword set** (정규식 기반 일차 검출):
   ```
   적절한|빠른|빠르게|적당한|충분한|user-friendly|사용자 친화적|consistent|일관된|chosen|선택된|relevant|관련된|적당히|reasonable|합리적
   appropriate|fast|adequate|sufficient|seamless|smoothly|effective|효율적|user 친화
   ```

   강등 조건 (모두 만족 시 HIGH → MEDIUM):
   1. `linked_oq.length ≥ 1`
   2. REQ statement 또는 AC 라인이 placeholder `{{OQ-N}}` 사용
   3. 해당 OQ entry 가 §6 에 실제 등재 (bidirectionality)

   강등 불가: keyword 매칭 있으나 OQ 연결 없거나 placeholder 미사용 → HIGH 유지.

10. **Golden rule violation (§0.G1)** — speckiwi MCP mutation 호출 후 동일 SRS 파일에 `Edit` 도구 사용 흔적 검출. `srs_delta.json.scope_doc_edits` 또는 운영 로그에서 mutation 직후 동일 path `Edit` = **CRITICAL**. 예외: §0.G1 표의 허용 행만.

### 10.3 출력 스키마

```json
{
  "evaluator": "verify-pass-1|verify-pass-2",
  "iter": N,
  "findings": [
    {
      "id": "{axis}-{iter}-{seq}",
      "finding_hash": "sha1(f\"{req_id or '_'}|{axis}|{evidence_path or '_'}|{severity}\")",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "axis": "classification|conflict|trace|ac|scope|delta|feasibility|mcp_srsmd|internal_coherence|golden_rule",
      "req_id": "FR-TODO-004 | null",
      "evidence_path": "src/...:L45-67 | null",
      "description": "...",
      "suggested_action": "fix_via_mcp|reclassify|discard|escalate",
      "vague_terms": [],
      "linked_oq": []
    }
  ],
  "summary": { "CRITICAL": N, "HIGH": N, "MEDIUM": N, "LOW": N }
}
```

메인이 병합 (동일 `finding_hash` MAX severity, OR 합집합).

### 10.4 토폴로지

평가·검증은 **단일 검증 서브에이전트**가 수행하며 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 이 검증 서브에이전트의 모델을 override 한다.

| 모드 | 검증 서브에이전트 | 모델 |
|---|---|---|
| Normal | 단일 검증 서브에이전트 × 1 | 현재 세션 모델 (`--model` override) |
| --max | 단일 검증 서브에이전트 + 독립 2차 검증 패스 | 현재 세션 모델 (`--model` override) |

---

## 11. Phase 6 — Severity gate + loop

### 11.1 심각도

| Level | 정의 |
|---|---|
| **CRITICAL** | 신규 REQ가 verified/stable REQ와 명백히 모순; 분류 명백히 틀림; 필수 MCP 호출 누락; REQ-ID 중복; trace path 비존재; REQ 자체 내부 모순(axis 9 b/c/e); 황금률 위반 (axis 10) |
| **HIGH** | feasibility 근거 없음; AC 검증 불가; 신규 REQ가 기존과 사실상 동일한데 update 아님; trace 부재 (코드 증거 있음); update인데 Change Notes diff 없음; REQ 본문 모호 어휘 다수 또는 타입/제약 자가 모순 (axis 9 a다수/d) |
| **MEDIUM** | 분류 rationale 약함; trace 약함 (file-only); scope 추정 근거 약함; REQ 모호 (비모순); priority 미설정 |
| **LOW** | 제목 스타일; tag 불일치; Change Notes 포맷; 미미한 wording |

### 11.2 종료 조건

#### Normal
- CRITICAL = 0 AND HIGH = 0 → 통과 (즉시 Phase 7)
- 미충족 → Phase 4 재spawn (개선 agent로 라우팅)
- 최대 **5회**
- 진동: 동일 `finding_hash` 3회 연속 → 사용자 에스컬레이션
- MEDIUM/LOW는 보고만, 블록 안 함

#### Max
- 2회 연속 `findings.filter(s ∈ {CRITICAL, HIGH, MEDIUM}).length === 0` → 통과
- 첫 iter PASS여도 다음 iter도 PASS 필요
- 최대 **15회**
- 진동: 동일 `finding_hash` 2회 연속 → 사용자 에스컬레이션

### 11.3 개선 라우팅 (Improvement agent, Opus)

CRITICAL/HIGH 우선, MEDIUM 후순위 (Max 한정). 처리:

- **classification 축**: 메인이 Phase 2 복귀 결정. 사용자 확인.
- **trace/ac/scope/delta/feasibility/mcp_srsmd**: 개선 agent가 §9 MCP 보강
  - 누락 trace → `add_trace_link`
  - 누락 evidence → `add_verification_evidence`
  - AC 추가/검증 → `check_acceptance_criteria`
  - status 변경 → `update_status`
  - statement 변경 필요 → 신규 `add_requirement` + 기존 `update_status(discarded)` (SRS-MD §11.4)
- **golden_rule 축**: 작성자 재spawn, mutation only 강제

산출물: `improvement_iter{N}.json`.

### 11.4 사실 위조 거절 (§0.9)

존재하지 않는 코드/함수 등록 요구 → 거절 + `rejected_findings.log`.

---

## 12. Phase 7 — Finalize

### 12.1 검증

1. `validate_spec` — 전체 SRS 구조
2. `summarize_target { target: TARGET }` — 최종 상태 요약

### 12.1.5 Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-srs"`
- `status`: 정상 종료 = `TASK_DONE`; 사용자 결정 보류로 종료 = `NEEDS_USER`; 실패 = `FAILED`; dry-run = `DRY_RUN`
- `next_hint`: 분류 결과 + 신규 REQ stability 기준 — 보통 `"kiwi-srs-feasibility"`. conflict/draft 잔존 시 `null` (사용자 결정 우선)
- `req_ids`: 본 호출에서 신규/갱신한 REQ-ID 배열
- `artifacts.spec_files`: 갱신된 SRS Markdown 경로
- `artifacts.analysis_dir`: `docs/analysis/kiwi-srs-{run-id}/`

emit 실패는 best-effort — 본 작업 (SRS 갱신·사용자 보고) 의 성공 보고는 별도로 출력.

### 12.2 사용자 보고 (대화 메시지, 파일 아님)

```markdown
## kiwi-srs 완료 보고

- run-id: {YYYY-MM-DD}.{slug}.{req-slug}
- target: {TARGET}
- 분류: {classification}
- 신규 REQ-ID: {NEW-ID}
- 영향 받은 기존 REQ: [{ id, status_before, status_after }, ...]
- Feasibility: {implementability} / {product_fit}
- 평가 루프: {N} iter
- 잔존 finding: CRITICAL {0} / HIGH {0} / MEDIUM {n} / LOW {n}
- validate_spec: PASS / FAIL

### MCP 호출 로그
(srs_delta.json 요약)

### Unresolved user_required OQs (승급 차단 항목)
| OQ ID | Linked REQ | 질문 | 차단 status |
|---|---|---|---|
| OQ-1 | FR-TODO-004 | priority 기본값? | proposed → planned 차단 |
...

(이 표가 비어 있어야만 `proposed → planned` 승급 가능)

### 다음 단계
{next_steps}
```

`{next_steps}` 는 §12.3 결정표로 분류·상태에서 *도출*. 정적 텍스트 하드코딩 금지.

### 12.3 다음 단계 결정표

본 표는 §12.2 사용자 보고의 `{next_steps}` 섹션 생성 규칙. 작성자(Opus, Phase 4)는 분류 결과 + 신규/영향 REQ 의 현재 status/stability 를 입력으로 본 표를 순회하며 해당하는 모든 권고를 출력. 표가 도출하지 않은 권고는 추가하지 않음 (pipeline SSOT 와의 정합 보장).

**우선순위**: A → B → C → D 순으로 평가, 매칭되는 모든 항목 누적. 자동 chain 호출은 금지 — 본 섹션은 *권고* 만, 사용자 결정 후 별도 호출.

| 우선 | IF (조건) | THEN (권고) | 근거 |
|---|---|---|---|
| A | 잔존 finding 에 CRITICAL/HIGH > 0 또는 `validate_spec: FAIL` | "수렴 미달 — 평가 loop 재개 또는 사용자 결정 후 재실행 필요" | §11.2 수렴 기준 |
| A | Unresolved user_required OQ ≥ 1 | "{N}건 OQ 미해결로 `proposed → planned` 차단. OQ 표 참조 후 답변 제공" | §0.G3 trace 보호 |
| A | §0.G2 외부 모듈 감지 + 사용자 미결정 | "외부 모듈 변경 신호 감지. 작업장 분리 또는 cwd 한정 결정 필요" | §0.G2 |
| B | 분류 = `conflict` | "기존 REQ {X} 는 `draft` 로 demote 됨. 폐기/재작성/수동 stable 복원 중 결정 필요" | §9.2 conflict |
| B | 분류 = `update` 이면서 영향 REQ status = discarded | "기존 REQ {X} discarded. NEW-ID 가 SoT — 의존 REQ trace 갱신 검토" | §9.2 update |
| B | 분류 = `new-scope` | "신규 scope `{S}` 진입. `set_active_target` 또는 scope 인덱스 갱신 검토" | §7 Scope gate |
| C | 신규 또는 영향 REQ 중 `addition_site` trace 잔존 | "{N}건 REQ 가 구현 증거 부재로 `proposed` 상한. 코드 추가 후 evidence 등록 → `update_status` 가능" | §0.14 trace cap |
| C | 신규 REQ 의 `feasibility.implementability ∈ {medium, low}` OR blocker 모호 | "구현 가능성 모호 — `/kiwi-srs-feasibility` (target 전수 평가) 또는 `/kiwi-srs-research --req-id {NEW-ID}` (블로커 심화)" | pipeline §4.1 |
| C | 신규 REQ 의 `stability = draft` (초기) | "stability 라이프사이클 진행은 `/kiwi-srs-feasibility` 책임. draft → evolving 승급 평가 권장" | pipeline §3.2 |
| D | 위 권고 모두 부재 + 신규 REQ status = `proposed` + addition_site 없음 | "AC + trace 검토 후 `update_status(planned\|implemented)` 진행 가능. 구현은 `/kiwi-coder` (stability ≥ evolving 시)" | pipeline §4.2 |
| D | (최종 catch-all, 다른 항목 매칭 시 생략) | "SRS 갱신 완료. 후속 행동 없음 — 다음 요구사항 대기" | — |

각 권고는 1줄로 출력. 중복 제거 후 ≤6개 권장. 사용자 가독성을 위해 우선순위 A 항목은 ⚠️ 마커 부착.

---

## 13. MCP / CLI fallback

| 작업 | MCP | CLI fallback |
|---|---|---|
| Active target | `get_active_target` | `speckiwi active-target --json` |
| Target Map 전체 | (미노출) | `speckiwi targets --json` |
| Target 활성화 | `set_active_target` | `speckiwi set-active-target <t>` |
| REQ 조회 | `get_requirement` | `speckiwi show <id> --json` |
| REQ 추가 | `add_requirement` | `speckiwi add-requirement --type ... --scope ... --target ... --title ... --requirement ... --ac ... --trace 'type\|reference\|relation\|notes'` |
| Status 변경 | `update_status` | `speckiwi update-status <id> <status>` |
| Trace 추가 | `add_trace_link` | `speckiwi add-trace <id> --type ... --reference ...` |
| Evidence | `add_verification_evidence` | `speckiwi add-evidence <id> --type ... --reference ...` |
| AC 체크 | `check_acceptance_criteria` | (MCP 필수) |
| 검증 | `validate_spec` | `speckiwi validate --json` |
| 요약 | `summarize_target` | `speckiwi summary --target <t> --json` |
| 목록 | `list_requirements` | `speckiwi list --scope <s> --target <t> --json` |

---

## 14. 수렴 기준 (Phase 7 객관 메트릭)

§0.1 위배 아님 — MCP/CLI 객관 출력 + 결정적 메트릭만.

- `validate_spec` PASS
- Normal: 루프 ≤ 5 iter; Max: ≤ 15 iter
- Normal 종료: CRITICAL = 0 ∧ HIGH = 0
- Max 종료: 2 consec iter 에서 CRITICAL/HIGH/MEDIUM 합산 = 0
- update 분류 시 discarded REQ에 NEW-ID 참조 명시
- 신규 REQ trace path 실존 확인

---

## 15. 주의사항

- 신규 REQ 기본 status = `proposed`. 사용자 검토 후 `planned`/`implemented` 승격
- conflict 시 자동 discard 금지 — `draft` demote + 사용자 결정
- update 시 기존 REQ는 `discarded` (재사용 금지)
- Phase 1 분석가 결론은 평가자에게 전달 금지 (§0.2)
- 잔존 모호성은 `qna_log.json` 명시 기록 후 진행
- `/snoworca-*` 호출 절대 금지 (§0.8)
- 검증자 출력은 파일(`eval_iter{N}.json`)로 저장, 메인에는 summary count + top 3 CRITICAL/HIGH만 로드 (컨텍스트 보호)
