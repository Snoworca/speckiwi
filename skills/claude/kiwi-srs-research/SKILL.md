---
name: kiwi-srs-research
description: "REQ 또는 연구 질문을 받아 5-서브에이전트 토폴로지(Sonnet×1 Triage + Opus×3 Code/External/Risk + Opus×1 Synthesizer)로 연구를 수행하고, dual-mode 로 동작한다. standalone 모드는 speckiwi MCP 에 research 본문을 영속화하고, subagent 모드는 read-only JSON 만 반환한다(kiwi-srs-feasibility 등이 호출). 트리거 — REQ 연구, kiwi srs research, 요구사항 연구, research enrichment, 연구 보강, deep research, requirement research, srs research, 연구문서 작성, 도메인 조사. --mode=standalone|subagent 로 모드 분기. --target/--scope/--req-id 로 입력 지정. 검증·연구 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 override 가능(토폴로지 불변)."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-srs-research v0.5

REQ 본문 또는 연구 질문에 대해 **5-서브에이전트 고정 토폴로지** 로 연구를 수행하는 스킬.

| 모드 | 트리거 | 동작 |
|---|---|---|
| **standalone** | 직접 호출 (`Skill` 도구) | 연구 수행 + speckiwi `append_section_note` 로 REQ research 영속화 |
| **subagent** | 다른 스킬(예: `kiwi-srs-feasibility`)이 `Agent` 도구로 호출 | **read-only**. JSON 반환만. MCP mutation 0건 |

**파이프라인 SSOT**: `_shared/kiwi/pipeline-event.md` (이벤트 schema + next_hint 결정표) 참조.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **검증자는 별도 서브에이전트** (Synthesizer 가 부분 담당). 인라인 자가검증 금지 |
| §0.2 | **검증자/Synthesizer 입력 격리**. Triage 의 분류 의도 + researcher 의 내부 모놀로그는 strip. 사실 데이터(코드 path, 외부 URL, 발견 항목)만 |
| §0.3 | **코드 증거 우선**. 모든 finding 은 path:line 또는 URL 증거 첨부. 증거 없는 finding 은 `evidence_strength: weak` 라벨 |
| §0.4 | **할루시네이션 금지**. Synthesizer 는 입력 4종에 없는 신규 주장 추가 금지. 위반 시 §10 axis 8 CRITICAL |
| §0.5 | **5-서브에이전트 토폴로지 고정**. Sonnet×1 (Triage) + Opus×3 (Code/External/Risk) + Opus×1 (Synthesizer). 사용자 임의 변경 불가. **서브에이전트 모델은 현재 세션 모델을 상속하며 `--model` 로 override 가능**, 5-서브에이전트 토폴로지·격리·역할 분담은 그대로 (§0.17 참조) |
| §0.6 | **speckiwi MCP 우선 + 황금률**. standalone 모드만 mutation. mutation 호출 1회 = Markdown line-patch 1회. mutation 호출 후 동일 SRS 파일 `Edit` 도구 절대 금지 |
| §0.7 | **subagent 모드 mutation 0건**. 어떤 speckiwi mutation 도구도 호출 금지. JSON 반환만 |
| §0.8 | **/snoworca-* 스킬 호출 절대 금지**. 로직만 차용, 실행은 본 스킬 내부 |
| §0.9 | **사실 위조 거절**. 존재하지 않는 코드/URL/CVE 인용 거절 + `rejected_findings.log` |
| §0.10 | **3 researcher 간 격리**. Opus A/B/C 는 서로 출력 미공유. Synthesizer 만 4종 raw 입력 수신 |
| §0.11 | **이견 보존 의무**. Synthesizer 는 합의로 위장 금지. 1 vs 2+ 이견은 `dissent_findings` 에 명시 |
| §0.12 | **외부 모듈 수정 시 사용자 확인 의무**. cwd 외부 경로 수정 신호 감지 시 즉시 중단 + AskUserQuestion |
| §0.13 | **Status/Stability 변경 권한 없음**. 본 스킬은 research 필드만 다룸. status/stability 는 다른 스킬 책임 |
| §0.14 | **research 필드 갱신 도구 선정**. speckiwi `append_section_note { id, section: "research", text, mode: "append\|replace" }` 사용. 500자 제한 → 본문이 길면 다중 호출 또는 분석 로그 링크 |
| §0.15 | **subagent 모드 호출자 입력 isolation 의무**. 호출자(예: kiwi-srs-feasibility)는 본 스킬에 prompt 주입 시 자기 결론/판정/justification 을 strip 해야 함. 위반 검출 시 §0.G5 적용 |
| §0.16 | **mode flag 검출 채널 우선순위 확정**. (a) Skill/Agent 인자 `--mode=<value>` > (b) prompt 본문 정확 문자열 `--mode=<value>` > (c) 자연어 "subagent mode"/"standalone mode" > (d) 기본값 standalone. 상세는 §0.G6 및 §3.1 |
| §0.17 | **검증 서브에이전트 모델 정책 SSOT**. Researchers·Synthesizer 등 연구·검증 서브에이전트는 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 서브에이전트의 모델을 override 한다. **5-서브에이전트 토폴로지 고정(§0.5)·격리(§0.10)·이견 보존(§0.11)·Synthesizer 무결성 게이트(§0.G4)·심각도 게이트는 불변**. 호출자(kiwi-srs-feasibility 등) 가 `--model` 활성 상태로 본 스킬을 subagent 모드 호출 시 `--model` 전파 의무 |
| §0.18 | **`--auto` 옵션 SSOT (standalone 모드 한정 적용)**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. 본 스킬의 `critical_gates[]` 는 §1.7 (아래) 참조. **subagent 모드 호출 시 silent skip** — subagent 모드는 mutation 0건(§0.7)이므로 사용자 게이트 자체 부재 → `--auto` 인자 수신해도 무동작. **standalone 모드 한정 적용** — research 본문 영속화(`append_section_note`) 게이트 + Synthesizer 무결성 게이트 결정 + 외부 모듈 영향 게이트가 `--auto` 활성 시 §2 서브에이전트 결정으로 위임. **`--mode` 와 `--auto` 는 독립 축** — §0.G6 4채널 우선순위(mode 검출)와 `--auto` 검출(auto-option.md §1 4채널)은 직교하므로 (a) Skill/Agent 인자에 `--mode=standalone --auto` 동시 매칭 가능, (b) `--mode=subagent --auto` 매칭 시 `--auto` 만 silent skip, (c) `--mode` 채널과 `--auto` 채널 우선순위 충돌은 발생 불가 (서로 다른 토큰) |
| §0.19 | `--mini` / `--loops N` 수용(no-op). 본 스킬은 검증-개선 루프가 없어 `_shared/kiwi/loop-option.md` §5 에 따라 문서화된 no-op 으로 수용(오케스트레이터 전파 균일성) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — 황금률 (mutation ↔ Edit)

| IF | THEN | severity |
|---|---|---|
| standalone 모드 + mutation 호출 후 동일 SRS 파일 `Edit` | 차단 + 재spawn | **CRITICAL** (§10 axis 9) |
| subagent 모드에서 mutation 호출 시도 | 차단 (§0.7 위반) | **CRITICAL** (§10 axis 10) |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| 연구 대상 REQ 의 trace 가 cwd 외부 path | 해당 연구 중단 + AskUserQuestion |
| Opus B(external) 가 외부 모듈 변경을 권고 | 권고는 `external-research.json.suggested_mitigations` 에 기록, 적용은 본 스킬 범위 외 |

#### §0.G3 — 모드 분기 게이트

| IF | THEN |
|---|---|
| 호출자가 `--mode=subagent` 명시 | mutation 도구 일체 봉인 + 출력 형식 강제 (JSON only, no Markdown side-effects) |
| 호출자가 `--mode=standalone` 또는 명시 없음 | mutation 허용 + 사용자 보고 작성 |
| subagent 모드에서 standalone 출력 형식 생성 | §10 axis 10 CRITICAL |

#### §0.G4 — Synthesizer 무결성

| IF | THEN |
|---|---|
| Synthesizer 출력에 4 raw 입력에 없는 claim 등장 | §0.4 위반 → §10 axis 8 CRITICAL |
| Synthesizer 가 이견을 합의로 변환 | §0.11 위반 → §10 axis 7 HIGH |
| 4 raw 입력 모두 침묵한 영역에 대해 Synthesizer 가 추측 | §10 axis 8 HIGH |

#### §0.G5 — Subagent 호출자 입력 isolation 게이트

본 스킬이 subagent 모드로 호출될 때 **호출자 prompt 의 허용/금지 입력**:

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
| 1 | **Skill/Agent 도구 인자 또는 description token** | `Skill(args: "--mode=subagent ...")` / `Agent({ description: "... --mode=subagent" })` 의 args/description 파라미터에서 정규식 `--mode=(subagent\|standalone)` 매칭 | 가장 강한 신호. 무조건 채택. (Agent 도구는 `args` 인자가 없으므로 `description` 의 token 을 채널 1 로 간주) |
| 2 | **prompt 본문 정확 문자열** | prompt 텍스트 내 `--mode=subagent` 또는 `--mode=standalone` (공백·하이픈 정확). **백틱 코드 펜스/인라인 코드 안의 매칭은 제외** (의도하지 않은 강제 방지) | 채널 1 부재 시 채택 |
| 3 | **자연어 명시** | prompt 본문에 `"subagent mode"`/`"standalone mode"` (대소문자 무관). 동일하게 코드 블록 안은 제외 | 위 둘 부재 시 채택 |
| 4 | **기본값** | 어느 채널도 없음 | `standalone` 가정 |

충돌 처리:
- 채널 1·2 충돌 (예: args 는 subagent, prompt 본문은 standalone) → 채널 1 채택 + WARNING 기록
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
- `GITHUB_ISSUE` — GitHub 이슈 번호(issue number, 예: `#123`) 또는 이슈 본문/컨텍스트. `kiwi-pipeline` 의 이슈 진입 흐름(FR-FLOW-028)이 이슈 해결(resolution) 방향 + 구현 접근(implementation-approach) 연구를 위해 본 입력으로 전달한다. 이슈 본문·연결 정보를 `RESEARCH_QUESTION` 으로 정규화하여 5-서브에이전트 토폴로지에 투입한다.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "subagent 로 호출", "JSON 만" | `--mode` | `standalone` |
| "target v0.X 컨텍스트" | `--target` | `get_active_target` |
| "scope X 한정" | `--scope` | omit |
| "코드 경로 X" | `CODE_PATH` | cwd |
| "외부 검색 제외" | `--no-external` | external 활성 |
| "context7 자료만" | `--external-sources` | `context7,websearch` |
| "--dry-run", "제안만" | `--dry-run` | off |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (연구·검증 서브에이전트) |
| "자동", "묻지 말고", "확인 없이", "auto" | `--auto` (SSOT: auto-option.md v1.0) | off (사용자 결정 활성이 기본; subagent 모드 시 silent skip) |

### 1.3 출력 — standalone 모드

- **speckiwi mutation**: `append_section_note { id: REQ_ID, section: "research", text: ..., mode: "append" }` (다중 호출 시 mode 동일 유지)
- **분석 로그**: `docs/analysis/kiwi-srs-research-{run-id}/`
  - `preflight.json` / `triage.json` / `run-mode.json`
  - `research-raw/` 디렉토리:
    - `code-research.json` (Opus A)
    - `external-research.json` (Opus B)
    - `risk-research.json` (Opus C)
  - `research-summary.json` (Opus Synthesizer 출력)
  - `mutation-log.json` (append_section_note 호출 로그)
  - `mode-detection.log` (§0.G6 채널 결정 + 충돌 기록)
  - `bias_strip.log` (§0.G5; subagent 모드일 때만, standalone 에선 빈 파일)
  - `report.md` (사용자용 종합 보고서)
  - `rejected_findings.log`

### 1.4 출력 — subagent 모드

- **MCP mutation 호출 0건** (§0.7)
- 호출자(메인 세션)에게 반환할 JSON: `research-summary.json` 의 내용 단일 객체. `input_bias_warnings` 필드에 §0.G5 strip 결과 요약 (비어있으면 빈 배열)
- 부수 효과: `docs/analysis/kiwi-srs-research-{run-id}/` 디렉토리는 동일하게 작성 (감사 추적). `mutation-log.json` 은 비어있음. `bias_strip.log` 는 호출자 prompt strip 결과를 기록 (위반 0건이면 빈 파일)

### 1.5 Run-id

`{YYYY-MM-DD}.{project-slug}.{req-id-or-question-slug}.{mode-prefix}{seq}`

- `mode-prefix`: `s`(standalone) 또는 `sa`(subagent)
- `seq`: 동일 REQ/질문의 당일 호출 순번

### 1.6 Dry-run 모드

`--dry-run` 또는 `KIWI_DRY_RUN=1`:

- standalone 모드여도 mutation 호출 0건 (전부 `dryRun: true` 또는 skip)
- 제안 결과는 `outputs/proposed-research/{req-id}.md` 에 별도 저장
- 보고에 `mode_effective: "dry-run"` 명시

### 1.7 `--auto` critical_gates[] 선언 (standalone 모드 한정)

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트. **subagent 모드에서는 본 절 전체 무효** (mutation 0건이므로 게이트 부재 → §0.18).

| gate_id | reason | 발생 위치 |
|---|---|---|
| `standalone-replace-overwrite` | standalone 모드 `append_section_note` 의 `mode: "replace"` 결정은 기존 research 본문 전수 덮어쓰기 — 비가역 영속화 | §0.14 / §1.3 |
| `external-module-impact` | 연구 대상 REQ trace 가 cwd 외부 path — 외부 시스템 영향 결정 비가역 | §0.G2 |
| `paraphrase-detector-dissent` | Synthesizer paraphrase 검출 (§6.3.1) 이 researcher 간 사실 이견을 의역으로 위장한 경우 — 사실 무결성 결정은 사용자 의무 | §0.G4 / §6.3.1 / §10 axis 7~8 |
| `input-bias-violation-standalone` | §0.G5 호출자 입력 bias strip 결과를 standalone 모드에서 영속화 시도 — §0.G1 mutation 가드 위반 | §0.G5 / §0.G1 |

---

## 2. Phase 흐름

```
Phase 0   : Bootstrap (preflight, mode 확인, REQ 조회 또는 question 정규화)
Phase R0  : Triage (Sonnet × 1) — 질문 분해 + 입력 패키지 분배
Phase R1  : Parallel research (Opus × 3, 격리)
            ├─ Opus A: Code archaeology
            ├─ Opus B: External knowledge
            └─ Opus C: Risk & alternatives
Phase R2  : Synthesis (Opus × 1) — 4 raw 입력 → research-summary.json
Phase R3  : Mode 분기
            ├─ standalone: speckiwi append_section_note + 사용자 보고
            └─ subagent: JSON 반환 (mutation 0건)
```

---

## 3. Phase 0 — Bootstrap

### 3.0 speckiwi 가용성 사전 점검

`kiwi-srs` §3.0 과 동일. MCP/CLI 둘 다 부재 시 HALT. subagent 모드 + REQ_ID 입력이면 speckiwi 필수 (REQ 본문 조회). question-only 입력 + subagent 모드면 speckiwi 없이도 진행 가능.

추가 점검 — standalone 모드: `append_section_note` MCP 또는 CLI 가용성 확인.

### 3.1 Mode 결정

**§0.G6 의 채널 우선순위를 적용**한다. 결정 절차:

1. **채널 1 — Skill/Agent 도구 인자**: 호출 시 args 에 `--mode=<value>` 가 있는가? 있으면 그 값 채택, 다른 채널 확인은 충돌 검사 목적으로만 수행.
2. **채널 2 — prompt 본문 정확 문자열**: prompt 텍스트에 `--mode=subagent` 또는 `--mode=standalone` (공백·하이픈 정확) 매칭? 있으면 채택.
3. **채널 3 — 자연어 명시**: prompt 본문에 `"subagent mode"` 또는 `"standalone mode"` (대소문자 무관) 매칭? 있으면 채택.
4. **채널 4 — 기본값**: 위 모두 부재 시 `standalone`.

채널 간 충돌 시 §0.G6 표의 우선순위에 따라 채택 + WARNING 기록.

결정된 모드 + 적용 채널 + 충돌 WARNING 을 `run-mode.json` 에 기록:
```json
{
  "mode": "subagent",
  "channel_used": 1,
  "channel_evidence": "--mode=subagent in args",
  "warnings": []
}
```

이후 §0.G3 (mode 분기 게이트) + §0.G5 (입력 isolation 게이트) 순차 적용.

### 3.1.1 입력 isolation 검사 (§0.G5)

subagent 모드 확정 직후 호출자 prompt 의 금지 필드 검출 → strip + `bias_strip.log` 기록 → 위반 발견 시 호출자에 WARNING 반환. 상세는 §0.G5.

### 3.2 REQ 또는 질문 정규화

- `REQ_ID` 입력 시: `get_requirement { id: REQ_ID }` → REQ 본문 전체 + 현재 stability/status + trace + tags 수집
- `RESEARCH_QUESTION` 입력 시: 자연어 질문 → 구조화 (의도, 키워드, 추정 출처 후보)

산출물: `subject.json`

---

## 4. Phase R0 — Triage (Sonnet × 1)

### 4.1 책임

연구 질문 분해 + 3 Opus 의 격리 입력 패키지 생성. **결론·판정 금지** (분배 책임만).

### 4.2 입력

- `subject.json`
- 코드 컨텍스트 (CODE_PATH 의 얕은 인덱스)
- 사용 가능 외부 출처 목록 (context7, web search, 사용자 첨부)
- 운영 모드 (standalone/subagent)
- **호출자 seed `sub_questions[]`** (선택; subagent 모드에서 호출자가 재spawn 시 직전 dissent 를 변환해 전달). 본 시드는 Triage 가 사용자/호출자 의도를 보존하면서 자체 분해를 추가하는 입력으로 사용. 수신 시 `triage.json.sub_questions` 초기 시드로 채우고 Triage 가 보강.

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

Triage 의 산출물 중 각 패키지는 해당 Opus 에만 전달. **다른 Opus 의 패키지는 전달 금지**. Triage 자체의 결론·판정 (있다면) 은 strip.

---

## 5. Phase R1 — Parallel Research (Opus × 3, 격리, 병렬)

### 5.1 Opus A — Code archaeology

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

### 5.2 Opus B — External knowledge

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
  "standards_references": [],
  "findings": [
    { "claim": "...", "evidence_url": "https://...", "confidence": "high|med|low" }
  ]
}
```

### 5.3 Opus C — Risk & alternatives

입력: `triage.json.packages.risk_package` (Opus A/B 결과 미참조 — §0.10 격리)

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

Opus A/B/C 서로 출력 미공유. 각자 자신의 패키지 + CODE_PATH(A)/외부 도구(B)/없음(C) 만 접근.

### 5.5 병렬 실행

3 Opus 를 `Agent { run_in_background: true }` 로 동시 spawn. 시간 상한은 `--research-timeout` (기본 240초). 시간 초과 시 부분 결과 처리:

| 수신 결과 | 처리 |
|---|---|
| 3/3 (모두 정시 수신) | 정상 Phase R2 진입 |
| 2/3 | `triage.json` + 수신된 2개 raw + 누락된 1개에 대한 `missing_input_marker` 를 Phase R2 에 전달. Synthesizer 는 누락 영역을 침묵으로 처리 (§0.G4 의 "침묵 영역에 대한 추측" 금지 적용) |
| 1/3 | `research-summary.json.verdict_summary` 에 "부분 결과 (1/3 researchers)" 경고 + `partial_result_warning: { received: ["opus_A"], missing: ["opus_B", "opus_C"] }` 필드 첨부. 사용자/호출자에게 재호출 권장 |
| 0/3 | HALT + `timeout-failure.log` 기록. 호출자에게 실패 회신 (subagent 모드) 또는 사용자 보고 (standalone) |

수렴 기준 §9 의 "Synthesizer 가 4 raw 입력 모두 참조" 항목은 **3/3 수신** 의 경우만 적용. 2/3, 1/3 경우 별도 부분 결과 게이트 적용 (재spawn 또는 부분 결과 진행).

---

## 6. Phase R2 — Synthesis (Opus × 1)

### 6.1 입력 (4종 raw)

- `triage.json` (scope 경계, sub_questions)
- `code-research.json` (Opus A)
- `external-research.json` (Opus B)
- `risk-research.json` (Opus C)

§0.2 격리: 각 raw 의 `confidence` / `claim` / `evidence_*` 필드는 보존. `rationale` 같은 정당화 필드는 strip.

### 6.2 책임

1. **합의 추출**: ≥2 researcher 가 동일하거나 호환되는 claim 식별 → `consensus_findings`
2. **이견 보존**: 1 vs 2+ 또는 명백한 충돌 → `dissent_findings` 별도 항목
3. **증거 통합**: 같은 claim 의 증거 경로/URL 합집합
4. **신뢰도 가중**: 다수 합의 + 강한 증거 = high / 단일 + 약한 증거 = low
5. **권고 도출**: research_question 에 대한 최종 권고 (불확실 시 명시)

### 6.3 금지 (§0.G4)

- 4 raw 입력에 없는 신규 claim 추가
- 이견을 합의로 위장
- 침묵 영역에 대한 추측
- raw 입력의 `evidence_strength: weak` 를 strong 으로 격상

### 6.3.1 source_quotes 강제 (자동 할루시네이션 detector)

모든 `consensus_findings[*]` / `dissent_findings[*]` 의 claim 마다 `source_quotes[]` 1개 이상 필수. 각 quote 는:
- `from`: opus_A / opus_B / opus_C / triage
- `quote`: raw 입력의 *원문 그대로 인용* (paraphrase 금지)
- `raw_path`: raw 파일 내부 JSON path (예: `research-raw/code-research.json#findings[2].claim`)

본 스킬은 Synthesizer 출력 후 자동 검증 단계를 수행:
1. 각 source_quote 의 `quote` 가 `raw_path` 위치의 텍스트와 **literal string match** 되는지 확인 (결정적 검증, 자기검증 편향 없음)
2. 매칭 실패 발견 시 `§10 axis 8 CRITICAL` finding 발생 + Synthesizer 재spawn
3. 매칭 성공 후 의역 detector 2축 병렬 검증:
   - **Sonnet detector**: "claim 이 quote 의 의미를 보존하는가? 의역/확장/축소 여부" 판정
   - **Opus detector**: 동일 질문 (모델 비대칭 보정)
4. 두 detector 모두 "의역 의심" 시 `§10 axis 8 HIGH` finding + Synthesizer 재spawn
5. 한 detector 만 의심 (불일치) 시 사용자 보고에 "의역 의심 분기됨: claim 검토 권장" 경고 첨부. 본 detector 이견은 별도 필드 `paraphrase_detector_disagreements[]` 에 기록 (`dissent_findings` 와 분리 — 후자는 원본 researcher A/B/C 이견 전용 컨테이너)

**주의 사용자 메시지**: 의역 의심 0건 보고도 detector LLM 자기 판단이므로 사용자 샘플 검토 권장. report.md 에 "자동 detector 통과는 100% 무결성 보증 아님 — 1-2건 sampling 권장" 워닝 첨부 (§7.1.3 사용자 보고).

본 메커니즘 없이는 §0.G4 / §6.3 의 금지 규칙이 검증 가능성을 잃음.

### 6.4 출력: `research-summary.json`

```json
{
  "research_question": "...",
  "mode": "standalone|subagent",
  "consensus_findings": [
    {
      "claim": "...",
      "supported_by": ["opus_A", "opus_B"],
      "evidence": ["src/api.ts:L45-67", "context7:react/hooks#XYZ"],
      "source_quotes": [
        { "from": "opus_A", "quote": "raw 인용 텍스트 (원문 변형 금지)", "raw_path": "research-raw/code-research.json#findings[2]" }
      ],
      "confidence": "high|med|low"
    }
  ],
  "dissent_findings": [
    {
      "claim": "...",
      "supporter": "opus_C",
      "conflicting_views": [
        { "by": "opus_A", "view": "..." }
      ],
      "resolution_suggested": "user_decision_required | additional_research_needed | accept_dissent_as_minor"
    }
  ],
  "suggested_mitigations": [
    { "for_finding": "claim_id_or_text", "mitigation": "...", "source": "opus_C" }
  ],
  "open_questions": [],
  "paraphrase_detector_disagreements": [
    { "claim_id_or_text": "...", "sonnet_verdict": "literal", "opus_verdict": "paraphrased", "claim_review_recommended": true }
  ],
  "raw_outputs_archived_at": "docs/analysis/kiwi-srs-research-{run-id}/research-raw/",
  "verdict_summary": "한 줄 권고 (호출자가 빠르게 소비)",
  "input_bias_warnings": [
    { "field": "axes[*].rationale", "reason": "calling-skill bias strip", "count": 3 }
  ]
}
```

`input_bias_warnings`:
- subagent 모드에서 §0.G5 strip 이 발생한 경우만 비어있지 않음
- standalone 모드에선 항상 빈 배열
- 호출자(예: kiwi-srs-feasibility)는 본 필드가 비어있지 않으면 자신의 호출 prompt 를 재점검

---

## 7. Phase R3 — Mode 분기

### 7.1 standalone 모드

#### 7.1.1 사용자 결정 게이트

`research-summary.json` 의 `dissent_findings.length > 0` 또는 `consensus_findings` 중 confidence=low 항목 존재 시:

AskUserQuestion 분해:
- Q1: "이견 항목을 어떻게 처리할까요? (기록만 / 추가 연구 / 사용자 직접 결정)"
- Q2: "REQ research 필드에 어떤 내용을 영속화할까요? (summary 만 / consensus 만 / 전체)"
- Q3: "research 영속화 방식? (append / replace 기존 research)"

#### 7.1.2 speckiwi 영속화

`append_section_note { id: REQ_ID, section: "research", text, mode: "append|replace" }` 호출.

text 본문 (500자 한도 — §0.14):
```
[kiwi-srs-research {run-id}] verdict: {verdict_summary}. Consensus: {n} findings. Dissent: {n} flags. Full report: docs/analysis/kiwi-srs-research-{run-id}/report.md
```

500자 초과 시 처리 우선순위:
1. **권장**: 본문은 분석 로그(`docs/analysis/kiwi-srs-research-{run-id}/report.md`)에 보관하고 영속화 text 는 **요약 + 보고서 path 링크** 만으로 1회 호출 (≤500자 보장)
2. **대안**: 다중 `append_section_note` 순차 호출. speckiwi MCP 가 호출 간 atomicity 를 보장하지 않으므로 다른 스킬의 note 가 사이에 끼어들 가능성 존재 — race condition 발생 시 본 스킬은 *감지·복구하지 않음*. 호출자가 동시성 환경이면 옵션 1 선택 권장.

#### 7.1.3 사용자 보고

대화 메시지 (파일 아님):
```markdown
## kiwi-srs-research 완료 보고 (standalone)

- run-id: {YYYY-MM-DD}.{slug}.{req-slug}.s{seq}
- 대상: REQ {REQ_ID} (또는 질문)
- 5-subagent 토폴로지: Sonnet(triage) + Opus×3(researchers) + Opus(synthesizer)

### 합의 findings: {n}
- {claim 1} (confidence: high, supported by: A, B)
- ...

### 이견: {n}
- {claim} (supporter: C, conflicting view: ...)

### 권고
{verdict_summary}

### 영속화
- speckiwi: append_section_note(REQ {REQ_ID}, section: research, mode: append)
- 전체 보고: docs/analysis/kiwi-srs-research-{run-id}/report.md

### 다음 단계
- 이견 해소 필요 시 사용자 결정 또는 재호출
- REQ status/stability 변경은 kiwi-srs / kiwi-srs-feasibility 담당
```

### 7.2 subagent 모드

#### 7.2.1 mutation 금지 (§0.7)

`append_section_note` 등 모든 speckiwi mutation 도구 호출 금지. 호출 시도 시 §10 axis 10 CRITICAL.

#### 7.2.2 반환 형식

호출자(kiwi-srs-feasibility 등)에게 `research-summary.json` 의 객체 그대로 반환. Markdown 보고서·사용자 메시지 작성 금지.

`docs/analysis/kiwi-srs-research-{run-id}/` 디렉토리는 동일 작성 (감사 추적). `mutation-log.json` 은 `{ mode: "subagent", mutations: [] }` 로 비어있음.

#### 7.2.3 반환 메타데이터

호출자가 사용할 수 있도록 다음 필드 보장:
- `verdict_summary` — 한 줄 권고
- `consensus_findings` / `dissent_findings` — 의사결정 입력
- `evidence` — 증거 경로 (호출자가 trace 검증 가능)
- `raw_outputs_archived_at` — 호출자가 필요 시 raw 접근 가능

---

## 8. MCP / CLI fallback

| 작업 | MCP | CLI fallback |
|---|---|---|
| REQ 조회 | `get_requirement` | `speckiwi show <id> --json` |
| Research 필드 갱신 | **`append_section_note`** | (CLI 미확정 — MCP 필수) |
| Active target | `get_active_target` | `speckiwi active-target --json` |
| 검증 | `validate_spec` | `speckiwi validate --json` |

`append_section_note` CLI 미제공 시 standalone 모드는 MCP 필수. MCP 부재 + standalone 호출 → HALT.

---

## 9. 수렴 기준

- Triage 가 3 패키지 모두 생성 (누락 시 재spawn)
- 3 Opus 모두 결과 반환 (시간 초과 시 부분 결과 + 경고)
- Synthesizer 가 4 raw 입력 모두 참조 (참조 누락 시 재spawn)
- §0.G4 무결성 검증 통과 (입력에 없는 claim 0건)
- standalone 모드: `append_section_note` 호출 결과 ok
- subagent 모드: mutation 호출 0건 확인

---

## 10. 검증 축 (Synthesizer 자체 검증 + 호출자 측 점검)

| Axis | 내용 | Severity |
|---|---|---|
| 1. Triage scope correctness | 3 패키지가 research_question 을 충분히 포괄? | HIGH |
| 2. Code evidence existence | code-research.json 의 path:line 실존? | CRITICAL |
| 3. External source reliability | external-research.json 의 URL/ref 유효? | HIGH |
| 4. Risk grounding | risk-research.json 의 failure_modes 가 가정으로부터 추론 가능? | MEDIUM |
| 5. Researcher isolation | A/B/C 가 서로 출력 공유 흔적? (cross-reference 발견 시 위반) | CRITICAL |
| 6. Consensus correctness | Synthesizer 의 consensus 가 실제로 ≥2 supporter? | HIGH |
| 7. Dissent preservation | Synthesizer 가 이견을 합의로 위장? (§0.11) | HIGH |
| 8. Hallucination | Synthesizer 출력에 raw 4종에 없는 claim? (§0.G4) | CRITICAL |
| 9. Golden rule (standalone) | mutation 후 동일 SRS 파일 Edit? (§0.G1) | CRITICAL |
| 10. Mode boundary (subagent) | subagent 모드에서 mutation 시도? (§0.G3) | CRITICAL |

평가자 토폴로지는 본 스킬에선 별도 Phase 없음. 검증 책임은:
- standalone: 호출 후 사용자가 보고서 검토 + 필요 시 `kiwi-srs-reviewer` 호출 (계획)
- subagent: 호출자(예: kiwi-srs-feasibility) 가 자체 검증 축에 본 표 일부 포함

---

## 11. 주의사항

- **5-서브에이전트 토폴로지 고정** — 사용자가 옵션으로 줄이거나 늘릴 수 없음 (§0.5)
- standalone 모드 mutation = `append_section_note` 만. status/stability 변경 금지 (§0.13)
- subagent 모드는 read-only — JSON 반환만, 파일/MCP 부수효과 0건 (§0.7)
- 3 researcher 격리 — 서로 결과 공유 금지 (§0.10)
- Synthesizer 는 raw 입력에 없는 claim 추가 금지 (§0.4, §0.G4)
- 이견 보존 의무 — 합의로 위장 금지 (§0.11)
- 외부 모듈 영향 발견 시 해당 연구 단위 중단 (§0.G2)
- `/snoworca-*` 호출 절대 금지 (§0.8)
- 비용 관리: 1 연구 호출 = 5 subagent (Sonnet 1 + Opus 4). 호출자가 budget 관리 책임
- subagent 모드 호출자는 자기 결론·판정·정당화를 본 스킬 prompt 에 주입 금지 (§0.15, §0.G5). 위반 시 본 스킬이 strip 후 진행하지만 `input_bias_warnings` 로 호출자에 회신
- mode flag 검출은 §0.G6 우선순위 (args > 정확 문자열 > 자연어 > 기본 standalone). 호출자는 가능하면 채널 1(args) 사용 권장

---

## 12. 파이프라인 위치

본 스킬은 두 시점에서 호출됨:

1. **standalone**: 사용자가 단일 REQ 또는 일반 연구 질문에 대해 깊이 있는 조사 필요 시
2. **subagent**: `kiwi-srs-feasibility` 가 feasibility ∈ {medium, low} 인 REQ 의 블로커 모호성 해소를 위해 Phase 2.5 에서 호출 (kiwi-srs-feasibility §1.2 `--enable-research`)

상세는 `_shared/kiwi/pipeline-event.md` §4 (next_hint 결정표) 참조.

---

## 13. Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

**모드별 emit 정책**:
- **standalone 모드**: `skill: "kiwi-srs-research"`, `status: "TASK_DONE"`, `next_hint`: 통상 `"kiwi-srs-feasibility"` (재평가 권장).
- **subagent 모드 (호출자에서 spawn)**: 본 스킬은 emit 하지 않는다 — 호출자(`kiwi-srs-feasibility`) 의 이벤트가 SSOT. 본 스킬 결과는 호출자의 `notes` 에 인용.

- `req_ids`: research 본문이 추가된 REQ-ID 배열 (standalone 한정)
- `artifacts.analysis_dir`: `docs/analysis/kiwi-srs-research-{run-id}/`

emit 실패는 best-effort.
