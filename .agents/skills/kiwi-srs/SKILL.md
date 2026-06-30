---
name: kiwi-srs
description: "신규 요구사항을 받아 기존 코드 + speckiwi MCP SRS 데이터베이스와 교차 분석하여 conflict/update/new-feature/new-scope 4방향 분류 → 구현 가능성 판정 → speckiwi MCP를 SSOT로 SRS 증분 작성·갱신. 3 standard 사전조사 병렬 + high-reasoning 시니어 작성자 + high-reasoning×1+standard×1 평가자(Max는 high-reasoning×2+standard×1) + 심각도 게이트(Normal: CRITICAL=0+HIGH=0 / Max: 2연속 MEDIUM-zero). 트리거 — SRS 업데이트, 요구사항 추가, kiwi srs 써줘, 기존 SRS에 반영해줘, 새 기능 요구사항 SRS, SRS 충돌 감지, 충돌 SRS 확인, 증분 SRS authoring, 신규 기능 SRS, 요구사항 명세 갱신, speckiwi 요구사항 등록, srs conflict 분석, kiwi srs 작성, incremental srs, add requirement to srs, update existing SRS, new feature spec, kiwi requirement authoring. **기본 QnA 활성** (reviewer dropout, Normal 3/Max 7 라운드, Phase 1 모호성 0건 시 skip). **--auto 로 질문 없이 진행** (현재의 무옵션 동작과 등가). `--qna` 는 v0.11 까지 deprecated alias. --max로 평가자 승격(high-reasoning×2+standard×1, 2연속 MEDIUM-zero 종료). --mini로 비용 절감(모든 high-reasoning→standard override, `../_shared/kiwi/mini-option.md` v1.0 — 토폴로지·게이트 불변). 종료 시 `workflow_pipeline_emit` 으로 이벤트 1줄 기록 (kiwi-pipeline 메타 스킬용)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-srs v0.11

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

## Official Workflow Tool Policy

Workflow 상태 조회·다음 작업 선택·이벤트 기록의 정상 경로는 MCP `workflow_pipeline_tail`, `workflow_pipeline_status`, `get_next_work_order`, `workflow_pipeline_emit` 또는 동일 기능의 `speckiwi workflow ...` CLI 이다. Raw file append/read 는 degraded mode 에서만 허용하며, 반드시 capturing tool diagnostics, affected artifact paths, active target, follow-up requirement or candidate ID 를 사용자 보고와 pipeline notes 에 남긴다.

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
| §0.5 | **SRS-MD Authoring Rules v1.0.0 준수**. heading / ID 정규식 / prefix-type 매핑 위반 금지 |
| §0.6 | **speckiwi MCP 필수 + 황금률**. 정상 target-scoped SRS read/mutation/status/evidence/completed-work 는 MCP 로만 수행한다. CLI 는 설치/버전/설정 진단과 MCP 복구 안내에만 사용하고 정상 mutation 대체 경로가 아니다. **황금률**: speckiwi MCP mutation 도구 (`add_requirement` / `update_status` / `add_trace_link` / `add_verification_evidence` / `check_acceptance_criteria` / `add_completed_work` / `set_active_target`) 호출 1회 = Markdown line-patch 1회 (`apply-patch.ts` atomic write). **mutation 호출 후 동일 SRS 파일에 `apply_patch` manual edit 사용 절대 금지** (예외는 §9.4) |
| §0.7 | **scope/target 결정은 사용자 확인**. Codex clarification gate 단일 호출 분해 |
| §0.8 | **/snoworca-\* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.9 | **사실 위조 거절**. 존재하지 않는 함수/CVE/파일 추가 요구는 거절 + `rejected_findings.log` |
| §0.10 | **type prefix와 scope prefix 동일 자동 제외** (FR/NFR/IR/DR/SEC/PERF/REL/OBS/OPS/MIG/CON) |
| §0.11 | **Multi-aspect 요구사항 분리**. 1개 사용자 문장이 ≥2 코드 표면(예: addTodo + listTodos)을 다루면 기본은 표면당 1개 REQ로 분리하고 `depends_on` 으로 연결. 합치는 경우 `classification.rationale` 에 사유 기록 |
| §0.12 | **`[INFERRED:level]` 배치 위치**. Markdown SRS에서는 (a) 추론 항목이 AC 라인 → 해당 AC 끝에 ` [INFERRED:high\|med\|low]` 부착, (b) 기본값/검증 정책 등 statement 차원 → §6 Open Questions 에 별도 등재 + REQ의 `rationale` 필드에도 동일 라벨 명시 |
| §0.13 | **[INFERRED] 2단계 분류**. 라벨 뒤에 `:user_required` 또는 `:advisory` 추가. `user_required` = `status: proposed → planned` 승격 **전 사용자 답변 필수**. `advisory` = 참고용, 승급 가능. 예: `[INFERRED:med:user_required]` |
| §0.14 | **Trace intent 분리**. Code 타입 trace entry 에만 적용 — Requirement 타입 trace_link 에는 `trace_intent` 필드 미부착. Code trace `trace_intent` enum: `verifies` (기존 코드가 statement 동작 수행) / `addition_site` (해당 위치에 구현 추가 예정) / `negative` (의도된 부재). **Dual-intent split**: 동일 file:line-range 가 두 intent 를 동시에 가지면 범위 폭이 다른 별도 entry로 분리 등록. **Status cap**: 어느 trace 라도 `trace_intent=addition_site` 잔존 시 해당 REQ 의 status 는 `proposed` 상한. 라이브 모드에서 `update_status(planned\|implemented)` 호출 시도 → 차단 + Codex clarification gate "구현 증거가 있습니까? (코드 path:line)" |
| §0.15 | **Fabricated AC → OQ 강제**. AC 항목에 코드 증거 없거나 사용자 prompt 에 명시 없는 구체 값(예: 400-error body shape, 특정 timeout 초)이 포함되면 AC 라인에 포함 금지 — 대신 §6 Open Questions 에 `[NEEDS-USER]` 라벨로 등재. AC는 결정 가능 명제만. **Canonical placeholder grammar**: AC 본문이 OQ 결정을 참조하면 `{{OQ-N}}` 형식만 허용. `<default per OQ-1>`, `pending decision`, `TBD` 등 자유 형식 금지 |
| §0.16 | **Discarded/Draft 마커 정책**. kiwi-srs 는 본문 마커(strikethrough / `[DISCARDED]` / `[DRAFT]`) 적용을 skip — speckiwi `Status=discarded` + `add_completed_work` Change Notes 기록을 SSOT 로 간주. 인덱스 (`00.index.md`) `(discarded)`/`(draft)` 접미사도 speckiwi mutation 이 자동 처리 |
| §0.17 | **finding_hash 정확화**. `finding_hash = sha1(utf8_bytes(f"{req_id or '_'}|{axis}|{evidence_path or '_'}|{severity}"))` — lowercase hex digest 40자 결과 문자열, 포뮬러 리터럴(`"sha1('...')"`) 금지. **Test vector**: `sha1_hex("FR-TODO-004|ac|src/api.ts:7-11|HIGH")` = `a5c02377715e12f316cec087d202cb76315c734c`. 평가자는 동일 입력으로 디지스트 계산 → 불일치 시 자체 거절 |
| §0.18 | **Canonical relation encoding**. REQ 간 의존성은 `add_trace_link { type: "Requirement", relation: "depends_on\|supersedes\|conflicts_with\|extends\|regression-only" }` 만 SSOT. `tags: ["depends_on:X"]` 같은 tag 형식 금지. **방향 SSOT**: trace_link 는 항상 `id: {신규 REQ} → reference: {기존 REQ}` 방향. e.g. `supersedes`: `{NEW-ID} supersedes {OLD-ID}` |
| §0.19 | **외부 모듈 수정 시 사용자 확인 의무**. 작업 대상은 cwd 하위 모듈로 한정. cwd 외부 경로(상위 디렉토리, 형제 프로젝트, 외부 패키지, monorepo 다른 워크스페이스) 수정 신호 감지 시 즉시 중단 + Codex clarification gate. 상세는 §0.G2 결정표 |
| §0.20 | **`--mini` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/mini-option.md` v1.0 을 따른다. `--mini` 활성 시 본 문서의 "high-reasoning 시니어 작성자", "high-reasoning×1 평가자", "high-reasoning×2 평가자", "QnA high-reasoning 라운드" 등 high-reasoning 인용은 모두 standard 으로 read-time replace. 토폴로지·심각도 게이트·라운드 상한·QnA 라운드 수는 불변 |
| §0.21 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. 기존 QnA skip 의미는 유지하되 외부 모듈, scope boundary, combined conflict, MCP 부재, 사실 위조 게이트는 §0.G6 critical_gates[] 로 자동 우회하지 않는다. |

### §0.G — 핵심 게이트 결정표

본 절은 §0.6 / §0.14 / §0.19 / §6.4 / §10.2 axis 10 의 IF-THEN 결정 규칙을 모은 단일 참조표. 에이전트는 조건 매칭 → 동작 실행을 결정적으로 수행한다.

#### §0.G1 — 황금률 (mutation ↔ manual edit via apply_patch)

| IF (조건) | THEN (동작) | 위반 severity |
|---|---|---|
| speckiwi mutation 도구 호출 (§0.6 enum) | Markdown 자동 line-patch 1회 발생; 추가 manual edit via apply_patch 호출 금지 | — |
| mutation 호출 후 동일 `docs/spec/*.srs.md` 에 `apply_patch` manual edit 사용 | 차단 + 작성자 재spawn | **CRITICAL** (axis 10) |
| 새 scope 파일 초기 템플릿 작성 (Phase 2.5, 빈 파일) | `apply_patch` manual edit 허용 | — |
| §1/§3/§5/§6 prose 영역 갱신 (mutation 미지원 자유 텍스트) | `apply_patch` manual edit 허용 + 직후 `validate_spec` 필수 | — |
| §4 Requirements / §7 Change Notes / §2 In/Out of Scope 표 | `apply_patch` manual edit 금지 (mutation 전용) | **CRITICAL** |

#### §0.G2 — 외부 모듈 영향 (§0.19)

| IF (감지 채널) | THEN (동작) |
|---|---|
| trace 후보가 cwd 외부 path | 즉시 중단 + Codex clarification gate |
| conflict/update 대상 REQ 가 다른 scope/target | 즉시 중단 + Codex clarification gate |
| feasibility 판정이 외부 모듈 변경을 전제 | 즉시 중단 + Codex clarification gate |
| Phase 1 code-context analyst 가 외부 경로를 relevant_files 로 보고 | 즉시 중단 + Codex clarification gate |

Codex clarification gate 3옵션: `(1) 진행 승인` / `(2) 외부 변경 제외하고 cwd 한정` / `(3) 작업 중단 후 외부 작업장 재실행`. 사용자 답변 전 외부 경로에 `add_requirement` / `update_status` / `apply_patch` manual edit 등 부작용 호출 절대 금지. `classification.json.external_module_impact` 에 감지 내역 기록.

#### §0.G3 — Trace intent status cap (§0.14)

| IF | THEN |
|---|---|
| REQ 의 어느 Code trace 라도 `trace_intent = addition_site` 잔존 | status 상한 = `proposed` |
| 위 상태에서 `update_status(planned\|implemented)` 호출 시도 | 차단 + Codex clarification gate "구현 증거 path:line 제시 가능?" |
| 사용자가 path:line 제시 → 검증 통과 | `addition_site` → `verifies` 로 trace 갱신 → status 승급 허용 |
| 동일 file:line-range 가 두 intent 동시 보유 | 범위 폭이 다른 별도 entry 로 분리 등록 (단일 entry `verifies+addition_site` 금지) |

#### §0.G4 — Scope boundary impact (§6.4)

| IF | THEN |
|---|---|
| 신규 REQ 가 대상 scope §2 Out of Scope 또는 §3 Constraints 와 충돌 | `classification.json.scope_boundary_impact` 기록 + Codex clarification gate 3옵션 |
| 응답 `yes` | Phase 4 진행; Markdown sync 단계에서 §2 갱신 |
| 응답 `no` | 사용자 결정 대기; `add_requirement` 호출 금지 |
| 응답 `new-scope 분리` | classification 갱신 → Phase 2.5 진입 |
| boundary 영향을 Open Questions 에만 기록하고 진행 | §0.7 위반 (차단) |

#### §0.G5 — Combined gate (boundary + conflict 동시)

| IF | THEN (단일 트랜잭션 4옵션) |
|---|---|
| §6.4 boundary 변경 + conflict 분류 동시 식별 | Codex clarification gate 단일 호출, 선택지 4종 |
| `proceed-both` | conflict 시퀀스 + boundary §2 sync 모두 실행 |
| `proceed-conflict-only` | conflict MCP 시퀀스만; §2 변경 skip → `[BOUNDARY-PENDING]` 마커 + `boundary_change_deferred: true` |
| `proceed-boundary-only` | §2 sync 만; conflict 신규 REQ `add_requirement` skip → `conflict_reqs_deferred: true` |
| `block-all` | 양쪽 skip; MCP 호출 0건; 사용자 결정 대기 |

**우선순위**: prompt 가 OoS 명시 + conflict 동시 발견 → 본 G5 우선. prompt 가 OoS 명시만 (conflict 없음) → §0.G4 Rule 1 (yes 등가).

#### §0.G6 — `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `external-module-impact` | cwd 외부 path 또는 다른 target/scope 영향 | §0.G2 |
| `scope-boundary-impact` | scope out-of-scope/constraints 변경 | §0.G4 |
| `combined-boundary-conflict` | boundary 변경과 conflict 분류 동시 발생 | §0.G5 |
| `mcp-unavailable` | SpecKiwi MCP 부재. CLI 진단 가능 여부와 무관하게 정상 SRS read/mutation 대체 금지 | Phase 0 |
| `fact-fabrication-risk` | 코드/요구사항 증거 없는 기능/AC 작성 위험 | §0.4 / §0.15 |

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
| "--qna", "질문하며 작성" | `--qna` (deprecated alias) | — — 본 인자는 v0.11 까지 QnA 모드 alias 로 동작하고 v0.12 부터 제거. 사용 시 stderr `[DEPRECATED] --qna is now default; use --auto to suppress` |
| "--max", "정밀 검증" | `--max` | off |
| "--mini", "mini 모드", "비용 절감", "standard 으로" | `--mini` | off (모든 high-reasoning → standard, `../_shared/kiwi/mini-option.md` v1.0) |

**옵션 의미 (v0.11 이후 SSOT)**:
- `--auto` 와 `--qna` 동시 명시 → ERROR ("두 옵션은 상호 배타. --auto 만 사용하십시오.").
- `--auto` 부재 (기본) → Phase 1.5 QnA loop 활성 (단, Phase 1 `intent.json.ambiguities` 가 빈 배열이면 자동 skip).
- `--auto` 명시 → Phase 1.5 QnA loop skip + 외부/scope-boundary 게이트 (§0.G2/§0.G4/§0.G5) 도 *Codex clarification gate 발동 대신 차단* 으로 동작 (사용자 결정 보류, 자동 우회 아님).
- `--qna` 명시 → `--auto` 의 역으로 동작 (기본과 등가). stderr 에 DEPRECATED 경고 1줄.

### 1.3 출력

- **SRS Markdown**: `docs/spec/{NN}.{slug}.srs.md` (기존 또는 신규 scope)
- **인덱스**: `docs/spec/00.index.md` (신규 scope 시 manual edit via apply_patch)
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

**dry-run Codex clarification gate 시뮬레이션 결정 알고리즘** (§6.4 / §0.G4 / §0.G5 게이트):

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
Phase 1   : Pre-investigation (standard × 3 병렬: intent / code / existing-SRS)
Phase 1.5 : QnA loop (기본 활성, --auto 시 skip, standard, reviewer dropout)
Phase 2   : Classification (standard, SCOPE 제공 + 모호성 없으면 skip)
Phase 2.5 : Scope gate (new-scope 시 Codex clarification gate)
Phase 3   : Feasibility (standard)
Phase 4   : SRS write/update (high-reasoning × 1, 분류별 §9 MCP 시퀀스)
Phase 5   : Evaluation (high-reasoning×1+standard×1; Max: high-reasoning×2+standard×1)
Phase 6   : Severity gate + loop → Phase 4 또는 Phase 7
Phase 7   : Finalize (validate_spec + summarize_target + 사용자 보고)
```

---

## 3. Phase 0 — Bootstrap

### 3.0 speckiwi 가용성 사전 점검

MCP 가 부재하면 스킬을 즉시 차단하고 설치 가이드를 출력한다. CLI 는 진단/복구 안내에만 사용하며 정상 SRS read/mutation 의 PASS 대체 조건이 아니다.

판정 순서:
1. speckiwi MCP 도구 가용 (`get_active_target` 호출 성공) → **PASS**, Phase 0.1 진행
2. MCP 불가 → CLI 체크: `speckiwi --version` (또는 `npx speckiwi --version`) 는 진단 정보에만 기록
3. **HALT**. 사용자에게 다음 메시지 출력 후 종료. 어떤 부작용 호출도 금지:

```
⛔ kiwi-srs 차단: speckiwi 가 설치되어 있지 않거나 MCP 가 비활성 상태입니다.

다음 중 하나로 복구하십시오:

  1. CLI 설치 (필수):
     npm install -g speckiwi@latest

  2. MCP 활성화 (권장):
     Configure the SpecKiwi MCP server for Codex according to the local MCP setup, or use `npx speckiwi mcp` as the server command.

  3. 확인:
     speckiwi --version

설치 후 동일 명령으로 kiwi-srs 를 다시 실행하십시오.
```

기록: `docs/analysis/kiwi-srs-{run-id}/preflight.json`: `{ mcp: false, cli: false, halted: true }`.

dry-run 모드(`--dry-run`)에서도 동일 점검 적용.

### 3.1 TARGET 확인 (우선순위 순)

1. **사용자 지정 `TARGET` 인자** — 최우선. 다른 모든 단계 skip.
2. **MCP `get_active_target`** — 활성 target 채택.
3. MCP 에서 target 을 확인할 수 없으면 HALT 후 `speckiwi mcp` 복구 또는 사용자의 명시적 target 재실행을 요구한다. CLI target 조회는 진단 출력에만 사용하고 정상 채택 근거가 아니다.
4. **Codex clarification gate (single)** — 위 모두 실패 시 "어느 target에 등록하시겠습니까?".
5. 최종 선택한 TARGET이 활성과 다르면 `set_active_target` 호출. `classification.json.target` 에 기록.

### 3.2 SRS 컨텍스트 로드

- `summarize_target { target: TARGET }` — 기존 REQ 총수/scope 분포
- `list_requirements { target: TARGET }` — Phase 1 SRS reader에 전달
- `docs/spec/00.index.md` file read — Scope Map 추출

---

## 4. Phase 1 — Pre-investigation (standard × 3, 격리, 병렬)

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

- Normal: max **3** 라운드
- Max: max **7** 라운드 (진동 감지 시 사용자 호출)

각 라운드:
1. standard QnA agent가 Phase 1 출력의 `ambiguities` + 충돌/누락 후보를 질문으로 나열
2. 사용자 답변 → agent 재평가
3. `satisfied=true` 면 종료
4. 동일 질문 2회 → 사용자에게 "잔존 모호성 기록 후 진행할까?" 확인

산출물: `qna_log.json`.

---

## 6. Phase 2 — Classification (standard)

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

1. Codex clarification gate 분해 (단일 호출):
   - Q1: "새 scope 이름은? (제안: {proposed_scope})"
   - Q2: "prefix는? (제안: {proposed_prefix})"
   - Q3: "ordering NN? (인덱스 분석 후 제안)"
   - Q4 (§0.10 위반 시): type prefix 충돌 → 대안 선택
2. Use an approved SpecKiwi MCP bootstrap path to create `docs/spec/{NN}.{slug}.srs.md` from the kiwi-srs-from-code §6.2 template.
3. Use an approved SpecKiwi MCP bootstrap path to update `docs/spec/00.index.md` §2 SRS Documents + §4 Scope Map; if no supported MCP bootstrap tool exists, halt with remediation guidance instead of treating CLI or raw Markdown edits as normal operation.
4. `set_active_target(TARGET)` — 활성이 다를 때
5. `validate_spec` — 구조 검증

---

## 8. Phase 3 — Feasibility

### 8.1 판정 (standard, 도메인 복잡 시 high-reasoning)

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


## Extended References

- Read `references/extended-workflow.md` when executing or validating
SRS mutation sequences, evaluation, severity loop, finalization, fallback, and convergence criteria
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
