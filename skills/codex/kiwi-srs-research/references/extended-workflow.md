# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 6. Phase R2 — Synthesis (high-reasoning × 1)
- 6.1 입력 (4종 raw)
- 6.2 책임
- 6.3 금지 (§0.G4)
- 6.3.1 source_quotes 강제 (자동 할루시네이션 detector)
- 6.4 출력: `research-summary.json`
- 7. Phase R3 — Mode 분기
- 7.1 standalone 모드
- kiwi-srs-research 완료 보고 (standalone)
- 합의 findings: {n}
- 이견: {n}
- 권고
- 영속화
- 다음 단계
- 7.2 subagent 모드
- 8. MCP availability and remediation
- 9. 수렴 기준
- 10. 검증 축 (Synthesizer 자체 검증 + 호출자 측 점검)
- 11. 주의사항
- 12. 파이프라인 위치
- 13. Pipeline event emit (의무)

---

## 6. Phase R2 — Synthesis (high-reasoning × 1)

### 6.1 입력 (4종 raw)

- `triage.json` (scope 경계, sub_questions)
- `code-research.json` (high-reasoning A)
- `external-research.json` (high-reasoning B)
- `risk-research.json` (high-reasoning C)

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
- `from`: researcher_a / researcher_b / researcher_c / triage
- `quote`: raw 입력의 *원문 그대로 인용* (paraphrase 금지)
- `raw_path`: raw 파일 내부 JSON path (예: `research-raw/code-research.json#findings[2].claim`)

본 스킬은 Synthesizer 출력 후 자동 검증 단계를 수행:
1. 각 source_quote 의 `quote` 가 `raw_path` 위치의 텍스트와 **literal string match** 되는지 확인 (결정적 검증, 자기검증 편향 없음)
2. 매칭 실패 발견 시 `§10 axis 8 CRITICAL` finding 발생 + Synthesizer 재spawn
3. 매칭 성공 후 의역 detector 2축 병렬 검증:
   - **standard detector**: "claim 이 quote 의 의미를 보존하는가? 의역/확장/축소 여부" 판정
   - **high-reasoning detector**: 동일 질문 (모델 비대칭 보정)
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
      "supported_by": ["researcher_a", "researcher_b"],
      "evidence": ["src/api.ts:L45-67", "context7:react/hooks#XYZ"],
      "source_quotes": [
        { "from": "researcher_a", "quote": "raw 인용 텍스트 (원문 변형 금지)", "raw_path": "research-raw/code-research.json#findings[2]" }
      ],
      "confidence": "high|med|low"
    }
  ],
  "dissent_findings": [
    {
      "claim": "...",
      "supporter": "researcher_c",
      "conflicting_views": [
        { "by": "researcher_a", "view": "..." }
      ],
      "resolution_suggested": "user_decision_required | additional_research_needed | accept_dissent_as_minor"
    }
  ],
  "suggested_mitigations": [
    { "for_finding": "claim_id_or_text", "mitigation": "...", "source": "researcher_c" }
  ],
  "open_questions": [],
  "paraphrase_detector_disagreements": [
    { "claim_id_or_text": "...", "standard_verdict": "literal", "synthesizer_verdict": "paraphrased", "claim_review_recommended": true }
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

Codex clarification gate 분해:
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
- 5-subagent 토폴로지: standard(triage) + high-reasoning×3(researchers) + high-reasoning(synthesizer)

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

## 8. MCP availability and remediation

Standalone research persistence and REQ_ID lookup require `speckiwi mcp`. CLI
commands may diagnose installation/version/configuration or help restore MCP,
but they are not normal fallback mutation paths.

| 작업 | MCP | CLI diagnostic only |
|---|---|---|
| REQ 조회 | `get_requirement` | 설치/버전/설정 확인만 |
| Research 필드 갱신 | **`append_section_note`** | (CLI 미확정 — MCP 필수) |
| Active target | `get_active_target` | 설치/버전/설정 확인만 |
| 검증 | `validate_spec` | 설치/버전/설정 확인만 |

`append_section_note` CLI 미제공 시 standalone 모드는 MCP 필수. MCP 부재 + standalone 호출 → HALT.

---

## 9. 수렴 기준

- Triage 가 3 패키지 모두 생성 (누락 시 재spawn)
- 3 high-reasoning 모두 결과 반환 (시간 초과 시 부분 결과 + 경고)
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
| 9. Golden rule (standalone) | mutation 후 동일 SRS 파일 `apply_patch` manual edit? (§0.G1) | CRITICAL |
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
- 비용 관리: 1 연구 호출 = 5 subagent (standard 1 + high-reasoning 4). 호출자가 budget 관리 책임
- subagent 모드 호출자는 자기 결론·판정·정당화를 본 스킬 prompt 에 주입 금지 (§0.15, §0.G5). 위반 시 본 스킬이 strip 후 진행하지만 `input_bias_warnings` 로 호출자에 회신
- mode flag 검출은 §0.G6 우선순위 (args > 정확 문자열 > 자연어 > 기본 standalone). 호출자는 가능하면 채널 1(args) 사용 권장

---

## 12. 파이프라인 위치

본 스킬은 두 시점에서 호출됨:

1. **standalone**: 사용자가 단일 REQ 또는 일반 연구 질문에 대해 깊이 있는 조사 필요 시
2. **subagent**: `kiwi-srs-feasibility` 가 feasibility ∈ {medium, low} 인 REQ 의 블로커 모호성 해소를 위해 Phase 2.5 에서 호출 (kiwi-srs-feasibility §1.2 `--enable-research`)

상세는 `../../_shared/kiwi/pipeline-v1.md` §3 책임 매트릭스 참조.

---

## 13. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

**모드별 emit 정책**:
- **standalone 모드**: `skill: "kiwi-srs-research"`, `status: "TASK_DONE"`, `next_hint`: 통상 `"kiwi-srs-feasibility"` (재평가 권장).
- **subagent 모드 (호출자에서 spawn)**: 본 스킬은 emit 하지 않는다 — 호출자(`kiwi-srs-feasibility`) 의 이벤트가 SSOT. 본 스킬 결과는 호출자의 `notes` 에 인용.

- `req_ids`: research 본문이 추가된 REQ-ID 배열 (standalone 한정)
- `artifacts.analysis_dir`: `docs/analysis/kiwi-srs-research-{run-id}/`

emit 실패는 best-effort.
