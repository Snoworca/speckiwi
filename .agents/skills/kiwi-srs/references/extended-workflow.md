# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 9. Phase 4 — SRS write/update (high-reasoning × 1)
- 9.1 작성자 컨텍스트
- 9.2 분류별 MCP 시퀀스
- 9.4 Markdown 반영 (speckiwi 황금률)
- 9.5 산출물
- 10. Phase 5 — Verification
- 10.1 평가자 입력 (§0.2 격리)
- 10.2 검증 축 (10개)
- 10.3 출력 스키마
- 10.4 토폴로지
- 11. Phase 6 — Severity gate + loop
- 11.1 심각도
- 11.2 종료 조건
- 11.3 개선 라우팅 (Improvement agent, high-reasoning)
- 11.4 사실 위조 거절 (§0.9)
- 12. Phase 7 — Finalize
- 12.1 검증
- 12.1.5 Pipeline event emit (의무)
- 12.2 사용자 보고 (대화 메시지, 파일 아님)
- kiwi-srs 완료 보고
- MCP 호출 로그
- Unresolved user_required OQs (승급 차단 항목)
- 다음 단계
- 12.3 다음 단계 결정표
- 13. MCP availability and remediation
- 14. 수렴 기준 (Phase 7 객관 메트릭)
- 15. 주의사항

---

## 9. Phase 4 — SRS write/update (high-reasoning × 1)

### 9.1 작성자 컨텍스트

작성자 high-reasoning 서브에이전트에게 전달:
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

§0.G1 결정표 적용. **speckiwi MCP mutation 호출 = Markdown line-patch 1회. 추가 `apply_patch` manual edit 사용 금지.**

speckiwi 보장 사항:
- `add_requirement` → §4 Requirements 신규 블록 자동 삽입 (`renderRequirementBlock` 결정적 출력)
- `update_status` → Status metadata row 단일 `replaceLine`
- `add_trace_link` → Trace Links 테이블 row insert
- `add_completed_work` → `00.index.md` Completed Work Log + Change Notes 자동 row 추가
- 모든 호출은 `apply-patch.ts` SHA256 snapshot stale-check + tmp+rename atomic write

작성자 high-reasoning 서브에이전트 책임:
1. 분류 결과에 따른 §9.2 mutation 시퀀스 호출
2. 시퀀스 종료 후 `validate_spec` 1회 호출 → PASS 확인
3. mutation 도구 외 어떤 방법으로도 `docs/spec/*.srs.md` 파일 수정 금지

**§6.4 게이트 통과 후 §2 Scope Boundaries 변경**: 현재 mutation API 미제공. 사용자 prose 영역으로 간주하여 `apply_patch` manual edit 가능 (§0.G1 예외). 변경 후 `validate_spec` 필수.

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

각 평가자가 독립 검토:

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

10. **Golden rule violation (§0.G1)** — speckiwi MCP mutation 호출 후 동일 SRS 파일에 `apply_patch` manual edit 사용 흔적 검출. `srs_delta.json.scope_doc_edits` 또는 운영 로그에서 mutation 직후 동일 path `apply_patch` manual edit = **CRITICAL**. 예외: §0.G1 표의 허용 행만.

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

### 11.3 개선 라우팅 (Improvement agent, high-reasoning)

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

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 MCP `workflow_pipeline_emit` 또는 CLI `speckiwi workflow pipeline-emit --json` 으로 정확히 1개 이벤트를 기록. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

공식 workflow tools 가 모두 실패한 degraded mode 에서만 raw `./kiwi/pipeline.jsonl` append 를 허용한다. 이때 사용자 보고와 event notes 에 capturing tool diagnostics, affected artifact paths, active target, follow-up requirement or candidate ID 를 반드시 포함한다.

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

본 표는 §12.2 사용자 보고의 `{next_steps}` 섹션 생성 규칙. 작성자(high-reasoning, Phase 4)는 분류 결과 + 신규/영향 REQ 의 현재 status/stability 를 입력으로 본 표를 순회하며 해당하는 모든 권고를 출력. 표가 도출하지 않은 권고는 추가하지 않음 (pipeline SSOT 와의 정합 보장).

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
| C | 신규 REQ 의 `feasibility.implementability ∈ {high, very-high, infeasible}` OR blocker 모호 | "구현 가능성 모호 — `$kiwi-srs-feasibility` (target 전수 평가) 또는 `$kiwi-srs-research --req-id {NEW-ID}` (블로커 심화)" | pipeline §4.1 |
| C | 신규 REQ 의 `stability = draft` (초기) | "stability 라이프사이클 진행은 `$kiwi-srs-feasibility` 책임. draft → evolving 승급 평가 권장" | pipeline §3.2 |
| D | 위 권고 모두 부재 + 신규 REQ status = `proposed` + addition_site 없음 | "AC + trace 검토 후 `update_status(planned\|implemented)` 진행 가능. 구현은 `$kiwi-coder` (stability ≥ evolving 시)" | pipeline §4.2 |
| D | (최종 catch-all, 다른 항목 매칭 시 생략) | "SRS 갱신 완료. 후속 행동 없음 — 다음 요구사항 대기" | — |

각 권고는 1줄로 출력. 중복 제거 후 ≤6개 권장. 사용자 가독성을 위해 우선순위 A 항목은 ⚠️ 마커 부착.

---

## 13. MCP availability and remediation

Normal target-scoped SRS reads, mutations, status/stability changes, evidence,
trace links, and completed-work logging require `speckiwi mcp`. CLI commands may
diagnose installation/version/configuration or help the user restore MCP, but
they are not normal fallback mutation paths.

| 작업 | MCP | CLI diagnostic only |
|---|---|---|
| Active target | `get_active_target` | 설치/버전/설정 확인만 |
| Target 활성화 | `set_active_target` | 설치/버전/설정 확인만 |
| REQ 조회 | `get_requirement` | 설치/버전/설정 확인만 |
| REQ 추가 | `add_requirement` | 설치/버전/설정 확인만 |
| Status 변경 | `update_status` | 설치/버전/설정 확인만 |
| Trace 추가 | `add_trace_link` | 설치/버전/설정 확인만 |
| Evidence | `add_verification_evidence` | 설치/버전/설정 확인만 |
| AC 체크 | `check_acceptance_criteria` | 설치/버전/설정 확인만 |
| 검증 | `validate_spec` | 설치/버전/설정 확인만 |
| 요약 | `summarize_target` | 설치/버전/설정 확인만 |
| 목록 | `list_requirements` | 설치/버전/설정 확인만 |

---

## 14. 수렴 기준 (Phase 7 객관 메트릭)

§0.1 위배 아님 — MCP 객관 출력 + 결정적 메트릭만.

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
