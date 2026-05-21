---
name: kiwi-srs-research
description: "OpenCode/Hermes local-LLM variant for requirement research enrichment. Requires speckiwi mcp for standalone persistence. Defaults to --max, collapses research/review fanout to one delegated worker at a time, and exits only after three clean evaluations. Triggers: kiwi srs research, requirement research."
---

# kiwi-srs-research v0.5

> etc local-LLM profile: read ../_shared/kiwi/local-llm-profile.md before executing. It requires working speckiwi mcp, treats --max as the default, disables multi-worker fanout, uses one delegated worker/evaluator at a time, and advances only after three consecutive no-improvement evaluations.

**etc override:** If any legacy section below appears to allow CLI mutation fallback or direct normal SRS Markdown mutation, the shared etc local-LLM profile wins: normal SRS operations require `speckiwi mcp`; CLI is diagnostic/remediation only.

> User clarification gate means: ask the user directly in Default mode; use `direct user prompt` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `local-LLM max-profile`, `local evaluator`, and `local evaluator` map to the current host agent model and effort options available in the session.

REQ 본문 또는 연구 질문에 대해 **single-worker 고정 토폴로지** 로 연구를 수행하는 스킬.

| 모드 | 트리거 | 동작 |
|---|---|---|
| **standalone** | 직접 호출 (`Skill` 도구) | 연구 수행 + speckiwi `append_section_note` 로 REQ research 영속화 |
| **delegated worker** | 다른 스킬(예: `kiwi-srs-feasibility`)이 위임 worker로 호출 | **read-only**. JSON 반환만. MCP mutation 0건 |

**파이프라인 SSOT**: `../_shared/kiwi/pipeline-v1.md` 참조.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 단일 위임 evaluator**. 인라인 자가검증 금지 |
| §0.2 | **검증자/종합 단계 입력 격리**. 분류 의도와 내부 모놀로그는 strip. 사실 데이터(코드 path, 외부 URL, 발견 항목)만 |
| §0.3 | **코드 증거 우선**. 모든 finding 은 path:line 또는 URL 증거 첨부. 증거 없는 finding 은 `evidence_strength: weak` 라벨 |
| §0.4 | **할루시네이션 금지**. 종합 단계는 입력 근거에 없는 신규 주장 추가 금지. 위반 시 §10 axis 8 CRITICAL |
| §0.5 | **single-worker 토폴로지 고정**. `../_shared/kiwi/local-llm-profile.md` 의 단일 worker/evaluator 정책을 따른다. 코드/외부/위험 관점은 하나의 위임 worker 또는 메인 에이전트가 순차 처리한다. child-of-child worker 그룹 금지 |
| §0.6 | **speckiwi MCP 우선 + 황금률**. standalone 모드만 mutation. mutation 호출 1회 = Markdown line-patch 1회. mutation 호출 후 동일 SRS 파일 manual file edit 절대 금지 |
| §0.7 | **delegated worker 모드 mutation 0건**. 어떤 speckiwi mutation 도구도 호출 금지. JSON 반환만 |
| §0.8 | **/snoworca-* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.9 | **사실 위조 거절**. 존재하지 않는 코드/URL/CVE 인용 거절 + `rejected_findings.log` |
| §0.10 | **관점별 입력 격리**. 코드/외부/위험 관점은 순차 처리하고 서로의 중간 추론을 공유하지 않는다. 종합 단계만 raw evidence 요약을 수신 |
| §0.11 | **이견 보존 의무**. 종합 단계는 합의로 위장 금지. 관점 간 이견은 `dissent_findings` 에 명시 |
| §0.12 | **외부 모듈 수정 시 사용자 확인 의무**. cwd 외부 경로 수정 신호 감지 시 즉시 중단 + User clarification gate |
| §0.13 | **Status/Stability 변경 권한 없음**. 본 스킬은 research 필드만 다룸. status/stability 는 다른 스킬 책임 (kiwi-pipeline-v1 §3) |
| §0.14 | **research 필드 갱신 도구 선정**. speckiwi `append_section_note { id, section: "research", text, mode: "append\|replace" }` 사용. 500자 제한 → 본문이 길면 다중 호출 또는 분석 로그 링크 |
| §0.15 | **delegated worker 모드 호출자 입력 isolation 의무**. 호출자(예: kiwi-srs-feasibility)는 본 스킬에 prompt 주입 시 자기 결론/판정/justification 을 strip 해야 함. 위반 검출 시 §0.G5 적용 |
| §0.16 | **mode flag 검출 채널 우선순위 확정**. (a) skill invocation or delegated delegated worker message `--mode=<value>` > (b) prompt 본문 정확 문자열 `--mode=<value>` > (c) 자연어 "delegated worker mode"/"standalone mode" > (d) 기본값 standalone. 상세는 §0.G6 및 §3.1 |
| §0.17 | **etc local-LLM profile SSOT**. 본 스킬은 `../_shared/kiwi/local-llm-profile.md` 를 따른다. `--max` 는 항상 기본값이고, multi-worker fanout 은 금지되며, 위임 worker/evaluator 는 한 번에 하나만 사용한다. 평가/개선 루프는 3회 연속 개선사항 없음 후 다음 단계로 진행 |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — 황금률 (mutation ↔ manual SRS file edit)

| IF | THEN | severity |
|---|---|---|
| standalone 모드 + mutation 호출 후 동일 SRS 파일 manual file edit | 차단 + 재spawn | **CRITICAL** (§10 axis 9) |
| delegated worker 모드에서 mutation 호출 시도 | 차단 (§0.7 위반) | **CRITICAL** (§10 axis 10) |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| 연구 대상 REQ 의 trace 가 cwd 외부 path | 해당 연구 중단 + User clarification gate |
| local-LLM max-profile B(external) 가 외부 모듈 변경을 권고 | 권고는 `external-research.json.suggested_mitigations` 에 기록, 적용은 본 스킬 범위 외 |

#### §0.G3 — 모드 분기 게이트

| IF | THEN |
|---|---|
| 호출자가 `--mode=delegated worker` 명시 | mutation 도구 일체 봉인 + 출력 형식 강제 (JSON only, no Markdown side-effects) |
| 호출자가 `--mode=standalone` 또는 명시 없음 | mutation 허용 + 사용자 보고 작성 |
| delegated worker 모드에서 standalone 출력 형식 생성 | §10 axis 10 CRITICAL |

#### §0.G4 — 종합 단계 무결성

| IF | THEN |
|---|---|
| 종합 출력에 입력 근거에 없는 claim 등장 | §0.4 위반 → §10 axis 8 CRITICAL |
| 종합 단계가 이견을 합의로 변환 | §0.11 위반 → §10 axis 7 HIGH |
| 모든 입력 근거가 침묵한 영역에 대해 종합 단계가 추측 | §10 axis 8 HIGH |

#### §0.G5 — Subagent 호출자 입력 isolation 게이트

본 스킬이 delegated worker 모드로 호출될 때 **호출자 prompt 의 허용/금지 입력**:

| 필드 | 허용 여부 | 비고 |
|---|---|---|
| `REQ_ID` / `RESEARCH_QUESTION` | ✅ 필수 (택1) | 식별자 |
| REQ 본문 (`statement`, `acceptance_criteria`, `trace`, `tags`, `status`, `stability`) | ✅ 허용 | 사실 데이터 |
| 코드 경로 / 증거 path:line | ✅ 허용 | 객관 사실 |
| 블로커 후보 (객관적 사실) | ✅ 허용 | 호출자가 발견한 사실 신호 |
| 호출자의 잠정 feasibility 점수/라벨 | ⛔ 금지 | 자기검증 편향 |
| 호출자의 권장 stability / 결정 | ⛔ 금지 | 결론 주입 |
| 호출자의 axes[*].rationale, justification | ⛔ 금지 | 정당화 주입 |
| 예측된 stability transition (`predicted_transitions`) | ⛔ 금지 | 결론 주입 |
| 호출자의 사용자 선호·메인 세션 결론 | ⛔ 금지 | 편향 |

검출 알고리즘 (Phase 0 진입 시, 2 단계):

**1단계 — 구조적 필드 화이트리스트 (1차 방어, 강력 권장)**:
호출자는 가능하면 JSON-shaped 구조로 입력 전달:
```json
{
  "REQ_ID": "...",
  "research_question": "...",
  "req_body": { "statement": "...", "acceptance_criteria": [...], "trace": [...] },
  "blockers_factual": ["..."],
  "code_paths": ["src/api.ts:45-67"]
}
```
JSON 화이트리스트 외 필드는 자동 무시. 결론 주입 차단의 가장 강한 방어.

**2단계 — 정규식 휴리스틱 (2차 방어, 평문 prompt fallback)**:
JSON 구조가 아닌 평문 prompt 일 때만:
1. 영문·한국어 금지 키워드 후보 정규식 검사 (예: `feasibility[\s:]+(high|medium|low|blocked)`, `(권장|recommend).{0,20}stability`, `predicted[\s_]stability`, `axes[\.\[].*rationale`, `평가\s*점수`, `결론[:은이가]`)
2. 매칭 발견 시 해당 토큰 strip + `bias_strip.log` 에 원본·strip 후 기록
3. `bias_strip.log` 가 비어있지 않으면 출력 `research-summary.json.input_bias_warnings` 필드에 요약 기록
4. 호출자에게 WARNING 반환

**한계 인정**: 정규식 휴리스틱은 완곡어·의역·새 표현 우회를 100% 막지 못한다. 본질적 방어는 1단계 화이트리스트.

**평문 prompt 수신 시 자동 WARNING 강제**: 호출자가 1단계 JSON 구조를 사용하지 않고 평문 prompt 를 보낸 경우 (정규식 매칭 0건이어도), 본 스킬은 `input_bias_warnings` 에 다음을 **항상 1건 자동 추가**:
```json
{ "field": "<plain_text_prompt>", "reason": "calling-skill bypassed JSON whitelist (2단계 정규식만 적용 — 완곡어 우회 가능)", "count": 1 }
```
호출자가 본 WARNING 을 수신하면 자기 호출 prompt 를 JSON 구조로 재구성하도록 안내 (kiwi-srs-feasibility §5.5.2 의 `input_bias_violations` 로깅에 반영).

심각도: 위반 자체는 본 스킬 차원 결함이 아니므로 차단하지 않음. strip 후 진행. 단 `bias_strip.log` 가 비어있지 않은 채로 standalone 모드에서 영속화하는 것은 금지 (§0.G1 의 mutation 가드).

#### §0.G6 — Mode flag 검출 채널 우선순위

§0.16 의 채널 우선순위를 결정표로 명시. **첫 매칭 채널의 값을 채택**, 후순위 채널의 다른 값은 무시 + 충돌 시 WARNING.

| 우선 | 채널 | 형식 예시 | 채택 규칙 |
|---|---|---|---|
| 1 | **skill invocation prompt or delegated delegated worker message token** | `$kiwi-srs-research --mode=delegated worker` 형태의 스킬 호출 문구 또는 위임 worker message 안의 `--mode=delegated worker` / `--mode=standalone` 토큰을 정규식 `--mode=(delegated worker\|standalone)` 로 매칭 | 가장 강한 신호. 무조건 채택. 위임 worker 위임은 message text를 사용하므로 message token을 채널 1로 간주 |
| 2 | **prompt 본문 정확 문자열** | prompt 텍스트 내 `--mode=delegated worker` 또는 `--mode=standalone` (공백·하이픈 정확). **백틱 코드 펜스/인라인 코드 안의 매칭은 제외** (의도하지 않은 강제 방지) | 채널 1 부재 시 채택 |
| 3 | **자연어 명시** | prompt 본문에 `"delegated worker mode"`/`"standalone mode"` (대소문자 무관). 동일하게 코드 블록 안은 제외 | 위 둘 부재 시 채택 |
| 4 | **기본값** | 어느 채널도 없음 | `standalone` 가정 |

충돌 처리:
- 채널 1·2 충돌 (예: args 는 delegated worker, prompt 본문은 standalone) → 채널 1 채택 + WARNING 기록
- 채널 2·3 충돌 → 채널 2 채택 + WARNING 기록
- 모든 WARNING 은 `mode-detection.log` 에 기록 + `run-mode.json.warnings` 에 요약

오인 위험 완화:
- 채널 2·3 의 매칭은 **백틱 코드 펜스(` ``` ` ~ ` ``` `) 및 인라인 코드(` ` ~ ` `) 안의 토큰을 제외**한다. 정규식 단계에서 먼저 코드 블록 영역을 마스킹 후 본문에서만 매칭.
- 본 SSOT 문서 자체를 다른 prompt 가 인용해도 인용 부분이 코드 블록 안이면 mode 강제되지 않음.
- 호출자는 가능하면 채널 1(args/description) 사용 권장.

---

## 1. 입력 / 출력

### 1.1 필수 입력 (택1)

- `REQ_ID` — speckiwi REQ id (e.g. `FR-TODO-005`). 본 스킬이 REQ 본문 자동 조회 (`get_requirement`)
- `RESEARCH_QUESTION` — 자연어 연구 질문 (REQ 와 무관한 일반 연구 시)

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "delegated worker 로 호출", "JSON 만" | `--mode` | `standalone` |
| "target v0.X 컨텍스트" | `--target` | `get_active_target` |
| "scope X 한정" | `--scope` | omit |
| "코드 경로 X" | `CODE_PATH` | cwd |
| "외부 검색 제외" | `--no-external` | external 활성 |
| "context7 자료만" | `--external-sources` | `context7,websearch` |
| "--dry-run", "제안만" | `--dry-run` | off |
| "로컬 LLM", "OpenCode/Hermes", "정밀" | `--max` | default on (`../_shared/kiwi/local-llm-profile.md` v1.0) |

### 1.3 출력 — standalone 모드

- **speckiwi mutation**: `append_section_note { id: REQ_ID, section: "research", text: ..., mode: "append" }` (다중 호출 시 mode 동일 유지)
- **분석 로그**: `docs/analysis/kiwi-srs-research-{run-id}/`
  - `preflight.json` / `triage.json` / `run-mode.json`
  - `research-raw/` 디렉토리:
    - `code-research.json` (local-LLM max-profile A)
    - `external-research.json` (local-LLM max-profile B)
    - `risk-research.json` (local-LLM max-profile C)
  - `research-summary.json` (종합 단계 출력)
  - `mutation-log.json` (append_section_note 호출 로그)
  - `mode-detection.log` (§0.G6 채널 결정 + 충돌 기록)
  - `bias_strip.log` (§0.G5; delegated worker 모드일 때만, standalone 에선 빈 파일)
  - `report.md` (사용자용 종합 보고서)
  - `rejected_findings.log`

### 1.4 출력 — delegated worker 모드

- **MCP mutation 호출 0건** (§0.7)
- 호출자(메인 세션)에게 반환할 JSON: `research-summary.json` 의 내용 단일 객체. `input_bias_warnings` 필드에 §0.G5 strip 결과 요약 (비어있으면 빈 배열)
- 부수 효과: `docs/analysis/kiwi-srs-research-{run-id}/` 디렉토리는 동일하게 작성 (감사 추적). `mutation-log.json` 은 비어있음. `bias_strip.log` 는 호출자 prompt strip 결과를 기록 (위반 0건이면 빈 파일)

### 1.5 Run-id

`{YYYY-MM-DD}.{project-slug}.{req-id-or-question-slug}.{mode-prefix}{seq}`

- `mode-prefix`: `s`(standalone) 또는 `sa`(delegated worker)
- `seq`: 동일 REQ/질문의 당일 호출 순번

### 1.6 Dry-run 모드

`--dry-run` 또는 `KIWI_DRY_RUN=1`:

- standalone 모드여도 mutation 호출 0건 (전부 `dryRun: true` 또는 skip)
- 제안 결과는 `outputs/proposed-research/{req-id}.md` 에 별도 저장
- 보고에 `mode_effective: "dry-run"` 명시

---

## 2. Phase 흐름

```
Phase 0   : Bootstrap (preflight, mode 확인, REQ 조회 또는 question 정규화)
Phase R0  : Triage (local evaluator × 1) — 질문 분해 + 입력 패키지 분배
Phase R1  : Sequential research (local-LLM max-profile × 1, 격리)
            ├─ local-LLM max-profile A: Code archaeology
            ├─ local-LLM max-profile B: External knowledge
            └─ local-LLM max-profile C: Risk & alternatives
Phase R2  : Synthesis (local-LLM max-profile × 1) — 4 raw 입력 → research-summary.json
Phase R3  : Mode 분기
            ├─ standalone: speckiwi append_section_note + 사용자 보고
            └─ delegated worker: JSON 반환 (mutation 0건)
```

---

## 3. Phase 0 — Bootstrap

### 3.0 speckiwi 가용성 사전 점검

`kiwi-srs` §3.0 과 동일. MCP 부재 시 HALT; CLI는 진단/복구 안내에만 사용. delegated worker 모드 + REQ_ID 입력이면 speckiwi 필수 (REQ 본문 조회). question-only 입력 + delegated worker 모드면 speckiwi 없이도 진행 가능.

추가 점검 — standalone 모드: `append_section_note` MCP 가용성 확인. MCP 로 persistence 를 수행할 수 없으면 HALT 하고 복구 안내만 제공한다.

### 3.1 Mode 결정

**§0.G6 의 채널 우선순위를 적용**한다. 결정 절차:

1. **채널 1 — skill invocation or delegated delegated worker message**: 호출 시 args 에 `--mode=<value>` 가 있는가? 있으면 그 값 채택, 다른 채널 확인은 충돌 검사 목적으로만 수행.
2. **채널 2 — prompt 본문 정확 문자열**: prompt 텍스트에 `--mode=delegated worker` 또는 `--mode=standalone` (공백·하이픈 정확) 매칭? 있으면 채택.
3. **채널 3 — 자연어 명시**: prompt 본문에 `"delegated worker mode"` 또는 `"standalone mode"` (대소문자 무관) 매칭? 있으면 채택.
4. **채널 4 — 기본값**: 위 모두 부재 시 `standalone`.

채널 간 충돌 시 §0.G6 표의 우선순위에 따라 채택 + WARNING 기록.

결정된 모드 + 적용 채널 + 충돌 WARNING 을 `run-mode.json` 에 기록:
```json
{
  "mode": "delegated worker",
  "channel_used": 1,
  "channel_evidence": "--mode=delegated worker in args",
  "warnings": []
}
```

이후 §0.G3 (mode 분기 게이트) + §0.G5 (입력 isolation 게이트) 순차 적용.

### 3.1.1 입력 isolation 검사 (§0.G5)

delegated worker 모드 확정 직후 호출자 prompt 의 금지 필드 검출 → strip + `bias_strip.log` 기록 → 위반 발견 시 호출자에 WARNING 반환. 상세는 §0.G5.

### 3.2 REQ 또는 질문 정규화

- `REQ_ID` 입력 시: `get_requirement { id: REQ_ID }` → REQ 본문 전체 + 현재 stability/status + trace + tags 수집
- `RESEARCH_QUESTION` 입력 시: 자연어 질문 → 구조화 (의도, 키워드, 추정 출처 후보)

산출물: `subject.json`

---

## 4. Phase R0 — Triage (local evaluator × 1)

### 4.1 책임

연구 질문 분해 + 코드/외부/위험 관점의 격리 입력 패키지 생성. **결론·판정 금지** (분배 책임만).

### 4.2 입력

- `subject.json`
- 코드 컨텍스트 (CODE_PATH 의 얕은 인덱스)
- 사용 가능 외부 출처 목록 (context7, web search, 사용자 첨부)
- 운영 모드 (standalone/delegated worker)
- **호출자 seed `sub_questions[]`** (선택; delegated worker 모드에서 호출자가 재spawn 시 직전 dissent 를 변환해 전달). 본 시드는 Triage 가 사용자/호출자 의도를 보존하면서 자체 분해를 추가하는 입력으로 사용. 수신 시 `triage.json.sub_questions` 초기 시드로 채우고 Triage 가 보강.

### 4.3 출력: `triage.json`

```json
{
  "research_question": "구조화된 핵심 질문",
  "sub_questions": ["...", "..."],
  "packages": {
    "code_package": {
      "target_modules": ["src/api.ts", "src/services/"],
      "relevant_traces": ["src/api.ts:L45-67"],
      "focus_questions": ["..."],
      "scope_boundaries": ["cwd 한정"]
    },
    "external_package": {
      "search_keywords": ["...", "..."],
      "candidate_sources": ["context7:react", "websearch"],
      "focus_questions": ["..."],
      "exclusion_filters": ["non-relevant domain ..."]
    },
    "risk_package": {
      "implementation_assumptions": ["...", "..."],
      "candidate_failure_modes": ["..."],
      "alternative_design_seeds": ["..."],
      "focus_questions": ["..."]
    }
  },
  "external_paths_detected": []
}
```

`external_paths_detected` 가 비어있지 않으면 §0.G2 발동.

### 4.4 격리

Triage 의 산출물 중 각 패키지는 해당 local-LLM max-profile 에만 전달. **다른 local-LLM max-profile 의 패키지는 전달 금지**. Triage 자체의 결론·판정 (있다면) 은 strip.

---

## 5. Phase R1 — Sequential Research (local-LLM max-profile × 1, 격리, 순차 단일)

### 5.1 local-LLM max-profile A — Code archaeology

입력: `triage.json.packages.code_package` + CODE_PATH 접근

책임:
- 관련 모듈 심층 분석 (구현 상태, 의존성, 결합도)
- 기존 테스트 커버리지 + 검증 가능 여부
- 변경 이력(`git log`) 에서 관련 PR/issue 식별
- 코드 메트릭 (복잡도 추정)

출력: `code-research.json`
```json
{
  "modules_analyzed": [
    { "path": "src/api.ts", "summary": "...", "complexity": "low|medium|high", "coupling": "low|medium|high" }
  ],
  "dependency_graph": { "nodes": [...], "edges": [...] },
  "test_coverage": [
    { "module": "src/api.ts", "tested_by": ["test/api.test.ts"], "coverage_estimate": "high|partial|none" }
  ],
  "change_history_signals": [
    { "ref": "git:abc123", "summary": "...", "relevance": "..." }
  ],
  "findings": [
    { "claim": "...", "evidence_path": "src/api.ts:L45-67", "confidence": "high|med|low" }
  ]
}
```

### 5.2 local-LLM max-profile B — External knowledge

입력: `triage.json.packages.external_package` + 외부 도구 접근 (context7, web search, 사용자 첨부)

책임:
- context7 라이브러리 문서 조회 (`--external-sources` 에 context7 포함 시)
- web search (활성화 시)
- 사용자 첨부 문서 분석
- 베스트 프랙티스 / 표준 / 라이브러리 권고사항 식별

출력: `external-research.json`
```json
{
  "sources_consulted": [
    { "type": "context7", "ref": "react/hooks", "summary": "..." },
    { "type": "websearch", "query": "...", "top_results": [...] }
  ],
  "best_practices": [
    { "claim": "...", "source": "context7:react/hooks", "confidence": "high|med|low" }
  ],
  "library_recommendations": [],
  "local_references": [],
  "findings": [
    { "claim": "...", "evidence_url": "https://...", "confidence": "high|med|low" }
  ]
}
```

### 5.3 Risk & alternatives perspective

입력: `triage.json.packages.risk_package` (다른 관점의 중간 결과 미참조 — §0.10 격리)

책임:
- 가정·전제의 실패 모드 분석
- 알려진 anti-pattern 매칭
- 대안 설계 후보 도출
- 비용·일정 위험 평가

출력: `risk-research.json`
```json
{
  "failure_modes": [
    { "mode": "...", "trigger_conditions": [...], "severity": "critical|high|medium|low", "likelihood": "high|med|low" }
  ],
  "anti_patterns_detected": [],
  "alternative_designs": [
    { "name": "...", "summary": "...", "trade_offs": {...} }
  ],
  "cost_schedule_risks": [],
  "findings": [
    { "claim": "...", "rationale": "...", "confidence": "high|med|low" }
  ]
}
```

### 5.4 격리 원칙

코드/외부/위험 관점은 서로 중간 추론을 공유하지 않는다. 각 관점은 필요한 사실 데이터만 raw evidence 로 남긴다.

### 5.5 순차 단일 실행

단일 delegated worker가 코드/외부/위험 관점을 순차 처리. 시간 상한은 `--research-timeout` (기본 240초). 시간 초과 시 부분 결과 처리:

| 수신 결과 | 처리 |
|---|---|
| 3/3 (모두 정시 수신) | 정상 Phase R2 진입 |
| 부분 입력 | `triage.json` + 수신 raw + 누락 관점에 대한 `missing_input_marker` 를 Phase R2 에 전달. 종합 단계는 누락 영역을 침묵으로 처리 (§0.G4 의 "침묵 영역에 대한 추측" 금지 적용) |
| 입력 부족 | `research-summary.json.verdict_summary` 에 "부분 결과" 경고 + `partial_result_warning` 필드 첨부. 사용자/호출자에게 재시도 권장 |
| 0/3 | HALT + `timeout-failure.log` 기록. 호출자에게 실패 회신 (delegated worker 모드) 또는 사용자 보고 (standalone) |

수렴 기준 §9 의 "종합 단계가 모든 raw 입력을 참조" 항목은 전체 입력 수신 시에만 적용한다. 부분 입력은 별도 부분 결과 게이트를 적용한다.

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
synthesis output schema, standalone/delegated worker mode handling, fallback, convergence criteria, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
