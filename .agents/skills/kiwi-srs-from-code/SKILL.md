---
name: kiwi-srs-from-code
description: 코드베이스를 역분석해 speckiwi MCP로 scope별 SRS Markdown을 자동 생성. 4축 서브에이전트 검증(누락/오류/할루시네이션/scope-creep) 루프로 모든 scope의 결함이 사라질 때까지 반복. 트리거 — kiwi srs from code, speckiwi srs 역추출, 코드로 speckiwi srs 만들어줘, kiwi 코드 분석 SRS, 기존 코드로 kiwi srs 생성. 필수 CODE_PATH. 선택 TARGET(기본 v0.1) / --max-eval-iter(기본 3) / --skip-init / 검증 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 override 가능(4축 토폴로지·게이트 불변).
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-srs-from-code v1.4

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

코드베이스를 역분석하여 **speckiwi MCP 도구**로 scope별 SRS Markdown 문서를 자동 생성하는 스킬.

본체 `snoworca-srs-from-code`와 달리 단일 md/jsonl 직접 관리 대신 **speckiwi가 정의한 SRS-MD Authoring Rules v1.0.0**과 **speckiwi MCP 도구**를 사용하여 scope별 다중 `docs/spec/{NN}.{slug}.srs.md` 문서를 작성한다.

**v1.1 변경 (2026-05-11, 감사 보고서 `172454_kiwi-srs-from-code v1.0 감사 보고서.md` 반영)**:
- CRITICAL 패치: 다중 scope 부트스트랩(scope 파일 사전 UTF-8 file write), CLI 명령명 교정, Phase 3 resume protocol
- HIGH 패치: update_status MCP 강제, add_requirement `trace` 필드 사용, Target 등록 절차, Phase 5 라우팅 메인 재할당, Codex clarification gate 호출 분해, spawn 가드레일(활성 scope만), Hallucination ↔ Scope-Creep 판정 신호 분리, public 표면 인벤토리 게이트, description 압축, 자연어→인자 파싱 매핑
- MEDIUM 패치: `requirement` 1차 키 명시, status 결정 매트릭스, type prefix 제외, 진동 동등성 키, draft↔discarded 결정 트리, prefix-type cross-check, §0 SSOT화, Bash→read/search, NFR trace 예외
- LOW 패치: §13 → §13 "수렴 기준", validate_spec manual edit via apply_patch 후 재호출, 전역 누적 상한

---

## 0. 공통 규약 (SSOT)

이 절은 본 스킬 전체의 단일 진실원본이다. 후속 절은 이 규칙을 재선언하지 않고 §0.N 으로 참조한다.

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 반드시 별도 서브에이전트**. 인라인 자가검증 금지 (사용자 project verification rule) |
| §0.2 | **검증자 입력 격리**. 작성자(Phase 3 scope agent) 결론 JSON·정당화 전달 금지. 원본 코드 + 생성된 SRS 파일 + 필터링된 `scope_assignments_view.json` 만 전달 |
| §0.3 | **코드 증거 우선**. 모든 요구사항은 `add_requirement` 호출 시 `trace` 배열에 source 첨부 필수. manual file edit via apply_patch으로 사후 보강 금지 (단, NFR/PERF/REL 예외 §6.1) |
| §0.4 | **할루시네이션·임의 요구사항 금지**. 코드에 존재 증거 없는 기능 작성 금지. 추정 항목은 `Stability=draft` + Rationale `[INFERRED:high\|med\|low]` 명시 |
| §0.5 | **SRS-MD Authoring Rules v1.0.0 절대 준수**. `docs/rule/SRS-MD-Rules-v1.0.0.md` 의 heading 형식, ID 정규식, prefix-type 매핑(§11.3) 위반 금지 |
| §0.6 | **speckiwi MCP 도구 필수**. 정상 target-scoped SRS read/mutation/status/evidence 는 MCP 로만 수행한다. CLI 는 설치/버전/설정 진단과 MCP 복구 안내에만 사용하고 정상 대체 경로가 아니다. status 변경은 항상 `update_status` MCP 로만 수행한다. manual file edit via apply_patch 금지 |
| §0.7 | **scope 분할은 반드시 사용자 확인**. Codex clarification gate 호출은 §5.1 처럼 N개 단일 질문으로 분해. 자동 분할만으로 진행 금지 |
| §0.8 | **type prefix(FR/NFR/IR/DR/SEC/PERF/REL/OBS/OPS/MIG/CON) 와 동일한 scope prefix 자동 제외**. 사용자가 명시 선택해도 재질문 |
| §0.9 | **사실 위조 거절**. 서브에이전트가 존재하지 않는 함수/CVE/파일을 요구하면 거절 + `rejected_findings` 로그 |
| §0.10 | **검증 서브에이전트 모델 정책 SSOT**. Phase 3 scope agent / Phase 4 검증자 4축 등 검증 서브에이전트는 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 검증 서브에이전트의 모델을 override 한다. 4축 토폴로지·심각도 게이트·인벤토리 게이트·`--max-eval-iter` 정책은 불변 |
| §0.11 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. inferred requirement loss, scope splitting, coverage gaps, and MCP absence are critical gates (§1.4). |
| §0.12 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |

---

## 1. 입력 / 출력

### 1.1 필수 입력

- `CODE_PATH` — 분석할 코드베이스 루트 (절대경로)

### 1.2 선택 입력 + 자연어 매핑

스킬은 자연어로 호출된다. 메인은 사용자 메시지에서 다음 키워드를 추출해 인자에 매핑:

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "v0.2", "릴리즈 X", "타깃 X" | `TARGET` | `v0.1` |
| "이미 초기화", "init 건너뛰", "기존 speckiwi" | `--skip-init` | false |
| "루프 N회", "N번 검증" | `--max-eval-iter` | 3 |
| "최소 N scope", "scope N개부터" | `--scope-min` | 3 |
| "최대 N scope", "scope N개까지" | `--scope-max` | 8 |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (검증 서브에이전트) |
| "--auto", "자동", "묻지 말고" | `--auto` | off (`../_shared/kiwi/auto-option.md`) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |

명시 신호가 없으면 Phase 0 종료 시점에 Codex clarification gate 으로 `TARGET` 과 `--max-eval-iter` 만 확정한다 (나머지는 기본값 적용).

### 1.4 `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `inferred-requirement-loss` | 추론 요구사항 손실/삭제는 사용자 검토 필요 | Phase 4/5 |
| `scope-splitting-ambiguity` | scope 분할/병합은 SRS 구조 변경 | Phase 1/2 |
| `inventory-coverage-gap` | public surface 누락 가능성 | Phase 7 |
| `mcp-unavailable` | SpecKiwi MCP 부재. CLI 진단 가능 여부와 무관하게 정상 SRS read/mutation 대체 금지 | Phase 0 |
| `fact-fabrication-risk` | 코드 증거 없는 요구사항 생성 위험 | §0.4 |

### 1.3 출력

- `docs/spec/00.index.md` (스킬이 직접 갱신)
- `docs/spec/{NN}.{slug}.srs.md` (scope당 1개, Phase 2.5에서 사전 생성)
- 보조: `docs/analysis/kiwi-srs-from-code-{run-id}/`
  - `intent_context.json`
  - `inventory.json` (public 표면 결정적 체크리스트)
  - `scope_proposal.json`
  - `scope_assignments.json` (작성자용 전체)
  - `scope_assignments_view.json` (검증자용 필터링)
  - `eval_iter{N}.json` (검증 루프 기록)
  - `improvement_iter{N}.json` (개선 적용 로그)
  - `rejected_findings.log`

`{run-id}` = `{YYYY-MM-DD}.{project-slug}`

---

## 2. Phase 플로우 (요약)

```
Phase 0   : speckiwi 초기화 + 얕은 코드 스캔 + Target 등록 검증 + 인벤토리 추출
Phase 1   : scope 추론 (모듈/API/디렉토리/인벤토리 기반)
Phase 2   : 사용자 확인 (N개 단일 Codex clarification gate 분해)
Phase 2.5 : scope 파일 사전 UTF-8 file write (00.index.md manual edit via apply_patch + scope srs.md 헤더 UTF-8 file write)
Phase 3   : scope별 서브에이전트 병렬 SRS 작성 (add_requirement + trace)
Phase 4   : 검증자 4축 서브에이전트 병렬 평가 (입력 격리)
Phase 5   : 개선 사항 라우팅 (메인 재할당) → 활성 scope만 재spawn
Phase 6   : Phase 4 로 복귀. 종료 조건 만족 시 Phase 7
Phase 7   : 인벤토리 게이트 + validate_spec + summarize_target 최종 보고
```

---

## 3. Phase 0 — 초기화 + 얕은 스캔 + 인벤토리

### 3.1 speckiwi 초기화 + Target 등록

1. **존재 확인 (Windows 호환)**: `rg --files` search로 `{CODE_PATH}/docs/spec/00.index.md` 매칭. Shell `test -f` 사용 금지.
2. **MISSING + `--skip-init` 미지정**: MCP `init_project` 호출. 인자: `{ target: TARGET, force: false }` (`scope` 필드는 omit — undefined 명시 전달 금지).
3. **EXISTS**: 건너뜀. `summarize_target { target: TARGET }` 로 컨텍스트 확인.
4. **Target 등록 검증 (필수)**:
   - MCP `get_active_target`, `summarize_target`, `list_requirements` 결과로 TARGET 을 확인한다. CLI `speckiwi targets --json` 은 진단 보조 출력으로만 사용하고 정상 판정/등록 근거로 삼지 않는다.
   - MCP 로 등록 여부를 판정할 수 없으면 HALT 후 `speckiwi mcp` 복구 또는 명시적 target 재실행을 요구한다.
   - 미등록 시:
     - MCP `init_project` / `set_active_target` 등 승인된 MCP bootstrap 경로만 사용한다. 지원 MCP 경로가 없으면 HALT 하고 복구 안내를 출력한다.
     - 기존 active target 이 있고 본 TARGET 으로 바꿔야 하면 MCP `set_active_target { target: TARGET }` 호출. 이미 active 면 호출 불필요.
   - **사용 금지 도구**:
     - `get_active_target` 응답에는 단일 active target 만 포함되고 전체 target 목록은 없으므로(read-tools.ts:48-52) 등록 여부 판정 불가.
     - `summarize_target` 은 미등록 target 에 대해 silently `total: 0` 의 ok 응답을 반환하므로(summary.ts:42 `records.filter`) 등록/미등록을 구분 못함.
   - 이 단계 누락 시 Phase 3 의 모든 `add_requirement` 가 `MUTATION_DENIED: Unknown target` 으로 실패하므로 절대 생략 금지.

### 3.2 얕은 스캔 (서브에이전트 1개, standard, 격리)

추출 대상:
- 진입점 (package.json `bin`/`main`, src/index.*, cmd/, main.go)
- 최상위 디렉토리 트리 depth 2
- 외부 의존성 (package.json/requirements.txt/go.mod/pom.xml)
- API 표면 라우트 grep
- UI 컴포넌트 디렉토리 존재 여부
- 기존 문서 (`README*`, `AGENTS.md`, `docs/`)

출력: `intent_context.json` (project_slug, entry_points, top_dirs, deps, api_surface, ui_present, existing_docs, size_metrics).

### 3.3 Public 표면 인벤토리 추출 (필수, 결정적)

별도 서브에이전트 1개(standard, 격리)가 코드를 재훑어 다음을 **결정적 grep/AST 기반**으로 추출:

```json
{
  "rest_endpoints": [{ "method": "GET", "path": "/api/x", "file": "src/server/x.ts", "line": 45 }],
  "cli_commands": [{ "name": "add-requirement", "file": "src/cli/commands/mutations.ts", "line": 134 }],
  "public_classes_or_funcs": [{ "symbol": "createSession", "file": "...", "line": ... }],
  "config_options": [{ "key": "PORT", "file": "...", "line": ... }],
  "data_entities": [{ "name": "Session", "file": "...", "line": ... }],
  "events_messages": [{ "name": "session.created", "file": "...", "line": ... }]
}
```

저장: `inventory.json`. **이 파일은 Phase 4 Missing-Detector 의 결정적 체크리스트 + Phase 7 게이트의 100% 매핑 기준점**으로 사용된다.

---

## 4. Phase 1 — Scope 추론

### 4.1 추론 휴리스틱

scope 후보 도출 신호 (우선순위):
1. 최상위 모듈 디렉토리 (`src/{module}/`, `packages/{pkg}/`, `apps/{app}/`)
2. 외부 인터페이스 경계 (CLI / HTTP / MCP / gRPC / UI 별도)
3. 도메인 키워드 (auth, payment, parser, validation, pipeline, storage)
4. 기존 문서 chapter
5. 데이터 모델 경계
6. **인벤토리 분포** — `inventory.json` 의 항목들이 어느 디렉토리에 집중되는지

### 4.2 scope 제안 출력

scope 개수 권장: 3~8개 (`--scope-min`/`--scope-max`).

각 scope:
```json
{
  "name": "Parser and Validation",
  "slug": "parser-validation",
  "prefix": "PARSE",
  "ordering": 20,
  "primary_dirs": ["src/core/parser/", "src/core/validation/"],
  "primary_files_glob": ["src/core/{parser,validation}/**/*.ts"],
  "rationale": "AST 파서와 검증기가 한 도메인을 형성",
  "estimated_req_count": 18,
  "candidate_prefix_alternatives": ["PARSE", "PARS", "VAL"],
  "inventory_share": { "rest_endpoints": 0, "cli_commands": 0, "public_classes_or_funcs": 12, "config_options": 3, "data_entities": 4 }
}
```

prefix 규칙:
- SRS-MD Rules §11.2 정규식 만족 + 전역 unique
- **§0.8: type prefix(FR/NFR/IR/DR/SEC/PERF/REL/OBS/OPS/MIG/CON) 자동 제외**
- 위반 시 alternatives 에서 자동 재선택

저장: `scope_proposal.json`

---

## 5. Phase 2 — 사용자 확인 (분해된 Codex clarification gate)

### 5.1 단일 질문 분해

**§0.7: Codex clarification gate 은 1회 호출당 1개 명확한 질문**. multiSelect + textarea 혼합 호출 금지. 다음을 순차 호출:

1. **scope 분할 승인** (multiSelect) — 옵션: 각 scope 이름. 선택된 것만 채택. 모두 선택 시 그대로 진행
2. **scope 수정 필요 여부** (single, yes/no) — yes 면 일반 대화로 추가/병합/제거 받기 (Phase 2 일시 정지)
3. **prefix 충돌 또는 §0.8 위반 scope당** (single, alternatives 중 선택) — 자동 제안이 type prefix와 일치할 때만 발동
4. **target 확정** (single) — 옵션: `v0.1`(기본), 기존 Target Map 의 다른 target, "다른 값 입력"
5. **draft 정책** (single) — 옵션: `keep_draft`(추정 항목 보존), `discard_all_inferred`(추정 항목 즉시 discarded)

### 5.2 사용자 응답 → scope_assignments.json

```json
{
  "target": "v0.1",
  "draft_policy": "keep_draft",
  "scopes": [
    {
      "name": "Parser and Validation",
      "slug": "parser-validation",
      "prefix": "PARSE",
      "ordering": 20,
      "agent_id": "scope-agent-1",
      "primary_files_glob": [...],
      "document": "docs/spec/20.parser-validation.srs.md",
      "inventory_share": {...}
    }
  ]
}
```

추가로 **검증자용 필터링 view** `scope_assignments_view.json` 도 생성 (필드: `{ name, slug, prefix, primary_files_glob, document }` 만). `agent_id`, `draft_policy` 등은 검증자에게 전달 금지 (§0.2).

### 5.3 prefix-type 매핑 cross-check (자동)

각 scope에 대해 추정 type 분포(인벤토리 비율 기반)를 산출. SRS-MD §11.3 prefix-type 1:1 매핑 위반(예: scope prefix가 `FR`인데 type=`functional`인 ID가 `FR-FR-001`이 됨) 시 사용자에게 §5.1 항목 3 재질문.

---

## 6. Phase 2.5 — Scope 파일 사전 UTF-8 file write (CRITICAL 차단 해제)

`add_requirement` MCP 는 `scope.document` 파일과 Scope Map 등록을 **사전조건으로 요구**한다(`add-requirement.ts:220-235`). 따라서 Phase 3 spawn 전에 다음을 메인이 직접 수행:

### 6.1 00.index.md 갱신 (manual edit via apply_patch)

각 scope 마다:
- §2 SRS Documents 표 행 추가: `| {name} | [{document}]({path}) | {prefix} | {rationale} |`
- §4 Scope Map 표 행 추가: `| {name} | {prefix} | [{document}]({path}) | {ordering} |`

### 6.2 빈 scope SRS 파일 UTF-8 file write

각 scope 마다 `docs/spec/{NN}.{slug}.srs.md` 를 다음 템플릿으로 UTF-8 file write:

**참고**: SRS-MD-Rules v1.0.0 §8.1 의 필수 필드는 `Document Type` / `Scope` / `Scope Name` / `Version` / `Last Updated` 5종. 아래 템플릿의 `Product` · `Product Version` · `Rules` 는 speckiwi 자체 spec 8개 문서에서 사용되는 **확장 필드(권장)** 이며 외부 코드베이스에서는 선택 사항. 외부 프로젝트의 SRS-MD 호환성을 엄격히 유지하려면 확장 3행을 생략 가능.

```markdown
# {Name} SRS

| Field | Value |
|---|---|
| Document Type | scope_srs |
| Scope | {PREFIX} |
| Scope Name | {Name} |
| Version | 1.0.0 |
| Last Updated | {YYYY-MM-DD} |
| Product | {project_slug} <!-- 확장(선택) --> |
| Product Version | {version} <!-- 확장(선택) --> |
| Rules | SRS-MD Authoring Rules v1.0.0 (`docs/rule/SRS-MD-Rules-v1.0.0.md`) <!-- 확장(선택) --> |

## 1. Scope Overview

(Phase 3 작성자가 채움)

## 2. Scope Boundaries

### In Scope

(Phase 3 작성자가 채움)

### Out of Scope

(Phase 3 작성자가 채움)

## 3. Assumptions and Constraints

(Phase 3 작성자가 채움)

## 4. Requirements

(여기에 add_requirement 가 추가)

## 5. Cross-scope Dependencies

## 6. Open Questions

## 7. Change Notes
```

### 6.3 검증

Phase 2.5 종료 시점에 `validate_spec` MCP 호출. diagnostic 0건이면 Phase 3 진입. SRS-MD §8.1 구조 위반이 있으면 즉시 수정 후 재검증.

---

## 7. Phase 3 — scope별 SRS 작성 (병렬, resume-safe)

### 7.1 서브에이전트 spawn (병렬)

scope 1개 = high-reasoning 서브에이전트 1개 (격리 컨텍스트). **병렬 실행 = 단일 메시지에서 모든 scope agent 를 동시 spawn**.

### 7.2 Resume Protocol (CRITICAL 차단 해제)

spawn 전 메인이 각 scope 마다 MCP `list_requirements { scope: prefix, target: TARGET }` 호출 → 기존 ID 스냅샷. 결과를 `existing_ids[]` 로 페이로드에 포함하여 agent에 전달.

### 7.3 작성자 지시문 템플릿

```
역할: speckiwi SRS 작성자 (단일 scope 책임)
scope: {name} / prefix: {prefix} / target: {target}
범위 파일: {primary_files_glob}
인벤토리 share: {inventory_share}
existing_ids (재실행 시 중복 방지용): [...]
산출물: docs/spec/{ordering}.{slug}.srs.md (Phase 2.5 에서 사전 생성됨)

작업:
1. 범위 파일을 read/search 으로 전수 분석
2. 각 발견 요구사항에 대해 MCP add_requirement 호출
   - type: functional|non_functional|interface|data|security|performance|reliability|observability|operational|migration|constraint
   - scope: "{prefix}"
   - target: "{target}"
   - title: 한 줄 (em dash·colon·hyphen 금지, SRS-MD §10.3)
   - requirement: Requirement 본문 (1차 키. statement 는 fallback)
   - acceptanceCriteria: 코드 검증 가능 항목 [string[]]
   - trace: [{ "type": "Code", "reference": "src/...:L45-67", "relation": "verifies", "notes": "..." }]  <-- §0.3 필수
   - status: §7.4 결정 매트릭스 적용
   - stability: §7.5 결정 매트릭스 적용
   - tags: 도메인 키워드
   - priority: "critical"|"high"|"medium"|"low"
3. 중복 방지: title + source path:line-range 가 existing_ids 의 trace 와 일치하면 skip
4. 추정 항목은 Rationale 에 `[INFERRED:high|med|low]` + Stability=draft (§0.4)
5. prefix-type 매핑 위반 시 자체 거절 (§0.5)
6. 코드에 없는 기능 작성 금지 (§0.4)
7. 작업 종료 직전 MCP list_requirements { scope: prefix } 호출로 자기 상태 동기화 → 출력 JSON 의 added_requirement_ids 에 반영

출력 (구조화 JSON):
{
  "scope": "{prefix}",
  "added_requirement_ids": [...],
  "skipped_duplicate_ids": [...],
  "skipped_observations": [...],
  "inferred_ids": [...],
  "self_sync_count": N
}
```

### 7.4 Status 결정 매트릭스

| 코드 증거 | AC 모두 테스트 커버 | Stability | → Status |
|---|---|---|---|
| 완전 | yes | stable | `implemented` — add_requirement 호출 시 `status: "implemented"`. 그 후 `add_verification_evidence` MCP 로 evidence 첨부 + `check_acceptance_criteria` MCP 로 모든 AC 체크 + `update_status` MCP 로 `verified` 승격. **add_requirement 단독으로 `status: "verified"` 호출 금지** — `canBeVerified` 게이트(`add-requirement.ts:216` 의 "verified requires all checked AC and evidence")에 막혀 `MUTATION_DENIED` 발생 |
| 완전 | 부분/없음 | stable | `implemented` |
| 부분 (INFERRED med/high) | - | draft | `planned` |
| 전무 (INFERRED low) | - | draft | `planned` (Phase 4 에서 hallucinated 판정 시 discarded) |

### 7.5 Stability 결정 매트릭스

| 코드 증거 | 일반화 추정 | Stability |
|---|---|---|
| path:line + AC 코드 검증 가능 | 없음 | `stable` |
| 부분 path 존재 + 일부 추정 | 있음 | `draft` |
| path 전무 | - | (Phase 4 hallucinated 판정 후보) |

### 7.6 Trace Links 첨부 정책 (§0.3 보완)

- **기능/IR/DR/SEC**: `trace` 배열에 `{type: "Code", reference: "path:Lstart-Lend"}` 필수. **`type: "Code"` 는 add-requirement.ts:226-229 의 trace 검증에서 reference 존재성 검사를 우회**(검증은 `type === "Requirement"` 일 때만 ID 실재 검증)하므로, 작성자는 read/search 으로 path 실존을 호출 직전 확인해야 함
- **NFR/PERF/REL/OBS (예외)**: 측정 hook · timeout 상수 · SLO 코드 · 벤치마크 스크립트 path 를 trace 로 허용. 그것조차 없으면 Stability=draft 강등
- **CON**: 환경/플랫폼 제약은 `package.json` engines, `Dockerfile`, CI config path 등을 trace 로

### 7.7 Phase 3 mid-gate

각 서브에이전트 종료 후:
1. MCP `list_requirements { scope: prefix, target: TARGET }` 로 등록 수 확인
2. **Trace Links 0 개 요구사항 비율** < 5% 검증. 초과 시 작성자 재spawn
3. 등록 수 0 인 scope 발견 시 즉시 사용자 보고

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
validator topology, improvement routing, final inventory gates, reporting, fallback, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
