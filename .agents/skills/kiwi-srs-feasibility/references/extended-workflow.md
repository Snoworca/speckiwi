# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 5.5 Phase 2.5 — Research enrichment (조건부)
- 5.5.1 트리거 조건
- 5.5.2 Subagent 호출 패턴
- 5.5.3 호출자 측 격리 (§0.2)
- 5.5.4 결과 병합
- 5.5.5 §0.13 권한 경계 유지
- 5.5.6 비용 가드
- 5.5.7 산출물
- 6. Phase 3 — Target-wide synthesis (high-reasoning 시니어)
- 7. Phase 4 — Mapping resolution
- 8. Phase 5 — Evaluation
- 8.1 평가자 입력 (§0.2 격리)
- 8.2 검증 축 (10개)
- 8.3 출력 스키마
- 8.4 토폴로지
- 9. Phase 6 — Severity gate + loop
- 9.1 심각도
- 9.2 종료 조건
- 9.3 재spawn 라우팅
- 10. Phase 7 — User approval + dryRun verification
- 10.1 사용자 승인 게이트
- 10.2 최종 dryRun
- 11. Phase 8 — Apply mutations + finalize
- 11.1 분류별 MCP 시퀀스
- 11.2 결과 집계
- 11.3 tag 갱신 (선택적)
- 11.4 validate_spec + summarize_target + sync 점검
- 11.5 사용자 보고
- kiwi-srs-feasibility 완료 보고
- Stability 변경 결과
- Status 충돌 REQ
- 다음 단계
- 비용 (--enable-research 활성 시)
- 보고 채널
- 12. MCP availability and remediation
- 13. 수렴 기준 (Phase 8 객관 메트릭)
- 14. 주의사항
- 15. 파이프라인 위치
- 16. Pipeline event emit (의무)

---

## 5.5 Phase 2.5 — Research enrichment (조건부)

`--enable-research` 명시 시에만 활성. `kiwi-srs-research` 스킬을 **subagent 모드** 로 호출하여 모호한 블로커/조건을 가진 REQ 에 대한 연구 결과를 per-REQ judgement 에 병합.

### 5.5.1 트리거 조건

per-REQ judgement 결과 중 다음을 만족하는 REQ 가 연구 후보:

- `feasibility ∈ {medium, low}` AND `blockers.length > 0` AND 블로커 내용에 외부 의존/도메인 불확실성 신호
- 또는 `evidence_strength: weak` 항목이 2개 이상
- 또는 사용자가 `--research-targets="FR-X,FR-Y"` 로 명시

후보가 `--research-limit` (기본 5) 를 초과하면 정규화된 점수 낮은 순(불확실성 높은 순)으로 상위 N 선택. 초과 항목은 skip + 보고.

### 5.5.2 Subagent 호출 패턴

각 후보 REQ 당 1회 호출 (중복 방지). kiwi-srs-research 내부 토폴로지 = **standard 1(Triage) + high-reasoning 3(Code/External/Risk) + high-reasoning 1(Synthesizer) = 5 sub-subagent**. 본 스킬은 호출자 turn 에서 직접 결과를 수신 (별도 호출자 측 subagent 없음).

**Mode flag 전달은 채널 1 (서브에이전트 message token) + 채널 2 (prompt 본문 정확 문자열) 이중 명시** — kiwi-srs-research §0.G6 의 채널 우선순위에 따라 채널 1 이 1차 truth. 채널 2 는 backward-compat 안전망.

사용 가능한 서브에이전트 위임 도구로 default 연구 에이전트 1개를 실행한다. 메시지에는 아래 토큰과 본문을 모두 포함한다.

```text
kiwi-srs-research subagent for FR-TODO-005 --mode=subagent

kiwi-srs-research 스킬의 subagent 모드 절차(§3.1 Mode 결정, §7.2 반환 형식)를 적용하시오. 스킬 path 는 runtime 환경에서 자동 해석.

--mode=subagent

(이 토큰은 kiwi-srs-research §0.G6 채널 2 의 정확 문자열 매칭 대상입니다.
 mutation 호출 0건, JSON 객체만 반환.)

대상 REQ_ID: FR-TODO-005
연구 질문: "external API 의존성이 코어 모듈에 미치는 영향 평가"

REQ 컨텍스트 (kiwi-srs-research §0.G5 허용 필드만):
  - statement / acceptance_criteria / trace / tags / status / stability
  - 블로커 후보 (객관적 사실, rationale 제거)
  - 코드 컨텍스트 (path:line 사실)

금지 (kiwi-srs-research §0.G5 위반 회피):
  - 본 스킬의 feasibility 점수/라벨
  - 본 스킬의 권장 stability
  - axes[*].rationale, justification
  - predicted_transitions
  - 메인 세션의 선호·결론

반환: research-summary.json 의 JSON 객체 (input_bias_warnings 필드 포함).
Markdown 보고서·MCP mutation 일체 금지.
```

다수 후보는 가능한 경우 병렬로 호출한다. 메인은 4분 시간 상한 후 일괄 수신.

수신 후 `research-summary.input_bias_warnings` 필드 검사:
- 비어있지 않으면 본 스킬의 호출 prompt 가 §0.G5 금지 필드를 누설한 증거 → `research-invocations.json.input_bias_violations` 에 기록 + 다음 iter 호출 prompt 재점검

### 5.5.3 호출자 측 격리 (§0.2)

subagent 에 전달하는 prompt 는 다음을 strip:
- `per-req-judgement.json.judgements[*].axes[*].rationale`
- `policy_context.json.predicted_transitions[*]` (예측 결과)
- 메인 세션의 선호·결론

전달 허용:
- REQ 본문 (statement, AC, trace, tags, status, stability)
- 블로커 후보 (객관적 사실)
- 코드 컨텍스트 (path:line 사실)
- 연구 질문 (구조화된 질의)

### 5.5.4 결과 병합

subagent 가 반환한 `research-summary.json` 을 per-REQ judgement 에 병합:

```
per_req.research_enrichment = {
  "summary": research-summary.verdict_summary,
  "consensus_findings": [...],
  "dissent_findings": [...],
  "raw_archived_at": "docs/analysis/kiwi-srs-research-{run-id}/"
}
```

병합 후 **재판정 단계**: research 가 새로운 블로커를 발견했거나 기존 블로커를 해소한 경우, Phase 2 의 per-REQ 평가 축을 재계산. 점수/라벨 변경 가능.

재판정 결과는 `per-req-judgement.json` 에 `revised_after_research: true` 표시. 원본 판정도 `original_judgement` 필드로 보존 (감사 추적).

### 5.5.5 §0.13 권한 경계 유지

본 Phase 는 research 결과를 **REQ 본문에 영속화하지 않음** (MCP mutation 0건). 메모리상으로는 per-REQ judgement 에 enrichment 로 통합하고 §11.5.1 report.md 에 요약 기재하지만, speckiwi `append_section_note` (research 영속화) 는 본 스킬 권한 외 — `kiwi-srs-research` standalone 모드에서만 가능. 사용자에게 필요 시 별도 호출 안내:

```
보고 메시지:
  "research 결과를 REQ FR-TODO-005 의 research 필드에 영속화하려면 별도로 다음을 호출:
   $kiwi-srs-research --req-id FR-TODO-005 --mode=standalone"
```

### 5.5.6 비용 가드

- `--enable-research` 미지정 시 Phase 2.5 전체 skip (기본 off)
- `--research-limit` (기본 5) — **초기 호출 후보 REQ 수** 상한, 초과 후보 skip
- `--research-respawn-limit` (기본 2) — **per-REQ 재spawn 횟수** 상한. **§9.3 의 `req_respawn_count[req_id]` 카운터 상한과 동일** (단일 카운터, 다른 이름 별칭 아님)
- 동일 run 내 동일 REQ_ID 의 초기 호출 중복 방지 (캐시). 재spawn 은 `req_respawn_count` 별도 증분
- 각 subagent 호출 = 5 sub-subagent (standard 1 + high-reasoning 4 — Triage 1 standard, Code/External/Risk 3 high-reasoning, Synthesizer 1 high-reasoning)
- 최악 시나리오 Phase 2.5 단독 비용: `(--research-limit) × (1 + --research-respawn-limit) × 5` sub-subagent. 기본 `5 × (1 + 2) × 5 = 75`. 비용 우려 시 limit/respawn-limit 하향 조정.
- **본 스킬 1 run 의 sub-subagent 총량 (Phase 1~8 합산, --enable-research 활성 시)**:
  - Phase 1 = 3 (standard × 3 사전조사)
  - Phase 2.0 prescreen = ceil(N / chunk-size) (standard, N≥7 시)
  - Phase 2 per-REQ = senior_targets 수 (high-reasoning)
  - Phase 2.5 = 최대 75
  - Phase 5 evaluator = 1-2 × iter (Normal 단일 검증 서브에이전트 1 / Max +독립 2차 패스 2; Normal 최대 5 iter / Max 최대 15)
  - **총량 가드**: 위 합산이 사용자가 직관적으로 예측 가능하도록 `cost-estimate.json` 산출물(Phase 0 종료 시) 에 사전 추정치 기록 + 사용자에게 보고. `--cost-cap N` 옵션으로 상한 강제 가능 (초과 시 HALT + 옵션 조정 안내).

### 5.5.7 산출물

- `research-invocations.json`: 호출 후보 / skip / 실패 / 성공 로그
- `docs/analysis/kiwi-srs-feasibility-{run-id}/research-enrichment/`: 각 subagent 의 research-summary.json 사본

---

## 6. Phase 3 — Target-wide synthesis (high-reasoning 시니어)

per-REQ 판정을 종합하여 target 전체 판정 도출.

출력: `synthesis.json`
```json
{
  "target": "v0.1",
  "total_reqs_evaluated": 25,
  "feasibility_distribution": { "high": 12, "medium": 8, "low": 3, "blocked": 2 },
  "target_verdict": "release-ready|conditionally-ready|not-ready",
  "critical_blockers": [
    { "req_id": "FR-TODO-007", "blocker": "..." }
  ],
  "dependency_chains": [
    { "chain": ["FR-TODO-001", "FR-TODO-002"], "weakest_link_score": 45 }
  ],
  "stability_drift_candidates": [
    { "req_id": "FR-TODO-005", "current": "stable", "feasibility_drift_to": "low", "reason": "..." }
  ]
}
```

---

## 7. Phase 4 — Mapping resolution

per-REQ judgement + 정책 → per-REQ stability 제안.

알고리즘:
1. 각 REQ 에 대해 정책 mappings 순회 → 첫 매칭 적용 (정책 순서 = 우선순위)
2. 매칭 결과 `then.stability` 가 `keep` 이면 현재 stability 유지
3. 매칭 결과가 §0.G5 (stable/frozen 승급) 에 해당하면 사용자 승인 플래그
4. transition guard 사전 검증 (§0.G4) — `dryRun: true` 호출
5. guard 거부 시 `reason_template` 적용 후 재시도 또는 fallback

출력: `mutation-plan.json`
```json
{
  "plan": [
    {
      "req_id": "FR-TODO-001",
      "current_stability": "draft",
      "proposed_stability": "evolving",
      "matched_rule_index": 1,
      "requires_user_confirm": false,
      "reason": "Feasibility=high (score 85). Blockers: none. Run: 2026-05-15.skf.v01",
      "dryrun_guard_verdict": "ok",
      "user_decision": null
    }
  ],
  "summary": {
    "total_mutations": 18,
    "auto_apply": 12,
    "user_confirm_required": 4,
    "no_op": 2,
    "guard_blocked": 0
  }
}
```

---

## 8. Phase 5 — Evaluation

### 8.1 평가자 입력 (§0.2 격리)

**허용**:
- 원본 target snapshot (REQ 본문 전체)
- Phase 1 산출물 (code_context, existing_srs_context, policy_context)
- Phase 2.0 산출물 (`prescreen-{chunk-id}.json` 전체 — quick_pass 의 예측 검증을 위해 필수)
- `per-req-judgement.json` 의 axes/blockers/conditions/has_verification 필드
- `synthesis.json` 의 verdict + distribution
- `mutation-plan.json` 의 plan + summary (rationale 필드 제외)
- 정책 파일 내용
- 직전 `eval_iter{N-1}.json` (있을 때)

**금지 (strip)**:
- `per-req-judgement.json.judgements[*].axes[*].rationale` (시니어 정당화)
- `synthesis.json.target_verdict_rationale` (있다면)
- 시니어 분석가의 내부 모놀로그

### 8.2 검증 축 (10개)

1. **Score-label consistency** — score 80+ 가 high 라벨? 매핑 일관성
2. **Evidence existence** — trace path:line 실존 확인 (file read로 샘플 검증)
3. **AC verifiability ground** — AC 검증 가능 판정이 실제 AC 내용과 일치?
4. **Dependency cycle** — 의존 그래프 순환 누락?
5. **Blocker substantiation** — 블로커 사유가 코드 증거로 뒷받침?
6. **Mapping conformance** — Phase 4 매핑이 정책 mapping 순서대로 적용?
7. **Guard verdict honored** — dryRun guard 거부 시 무시하지 않음?
8. **Status conflict honor** — §0.G3 정책 따랐는가?
9. **Internal coherence** — per-REQ 판정 자체 일관성 (score↔label↔axes 합산)
10. **Golden rule violation (§0.G1)** — mutation 후 동일 SRS 파일 `apply_patch` manual edit 사용 흔적

### 8.3 출력 스키마

`kiwi-srs` §10.3 과 동일 구조. `finding_hash = sha1(f"{req_id or '_'}|{axis}|{evidence_path or '_'}")` lowercase hex 40자.

**severity 는 hash 입력에서 제외** — 평가자가 동일 finding 의 severity 를 HIGH↔MEDIUM 으로 흔들어도 동일 hash 가 되어 §9.2 진동 감지가 회피되지 않음.

### 8.4 토폴로지

평가·검증은 **단일 검증 서브에이전트**가 수행하며 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 이 검증 서브에이전트의 모델을 override 한다.

| 모드 | 검증 서브에이전트 | 모델 |
|---|---|---|
| Normal | 단일 검증 서브에이전트 × 1 | 현재 세션 모델 (`--model` override) |
| --max | 단일 검증 서브에이전트 + 독립 2차 검증 패스 | 현재 세션 모델 (`--model` override) |

---

## 9. Phase 6 — Severity gate + loop

### 9.1 심각도

| Level | 정의 |
|---|---|
| **CRITICAL** | trace path 비존재; score-label 불일치; 매핑 정책 위반; status 충돌 무시; transition guard 거부 우회; §0.G1 황금률 위반 |
| **HIGH** | 블로커 코드 증거 부재; 의존 순환 누락; AC 검증 가능 판정이 실제와 다름; 자체 점수 합산 오류 |
| **MEDIUM** | 판정 근거 약함; 정책 순회 모호; reason 템플릿 치환 누락 |
| **LOW** | tag 포맷; 보고서 wording |

### 9.2 종료 조건

**진동 카운터는 per-run 누적** (per-REQ 가 아님 — 동일 finding 이 다른 REQ 에서 반복되면 별도 hash 이므로 자연 분리).

#### Normal
- CRITICAL = 0 AND HIGH = 0 → 통과 (Phase 7)
- 미충족 → §9.3 재spawn 라우팅
- 최대 5회. 진동 (동일 finding_hash 3회) → 사용자 에스컬레이션

#### Max
- 2회 연속 `{CRITICAL, HIGH, MEDIUM}.length === 0` → 통과
- 최대 15회. 진동 (동일 finding_hash 2회) → 사용자 에스컬레이션
  - Max 가 Normal 보다 진동 임계가 낮은 의도: Max 는 MEDIUM-zero 까지 요구하므로 동일 finding 의 2회 반복은 평가자가 합의된 결함이라는 강한 신호. 더 일찍 사용자 에스컬레이션해야 사용자 시간 보호.

### 9.3 재spawn 라우팅

평가자 finding 의 axis · severity 에 따라 어느 Phase 를 재실행할지 결정:

| Finding axis (§8.2) | 재spawn 대상 | 비고 |
|---|---|---|
| 1 Score-label / 9 Internal coherence | Phase 2 (per-REQ judgement) | 시니어 분석 재수행 |
| 2 Evidence existence / 5 Blocker substantiation | Phase 2 | code evidence 재수집 후 재판정 |
| 3 AC verifiability ground | Phase 2 | AC 검증 가능성 재평가 |
| 4 Dependency cycle | Phase 3 (target-wide synthesis) | 의존 그래프 재구성 |
| 6 Mapping conformance / 7 Guard verdict / 8 Status conflict | Phase 4 (Mapping resolution) | 정책 매핑 재수행 |
| 10 §0.G1 황금률 위반 | 작성자 전체 재spawn | mutation 후 manual edit via apply_patch 발견 시 작성자 교체 |
| **research-derived axis** (5 Blocker substantiation / 2 Evidence existence / 9 Internal coherence 중 finding 의 evidence 가 research-summary 를 인용) AND `--enable-research` 활성 | **Phase 2.5 재spawn** (kiwi-srs-research subagent 재호출) | 직전 research-summary 의 dissent/low-confidence 가 finding 근거인 경우 |

Phase 2.5 재spawn 발동 조건 (모두 AND 결합 만족 시):
1. `--enable-research` 활성
2. 해당 REQ 의 `revised_after_research: true` (Phase 2.5 가 이전 iter 에 적어도 1회 실행됨)
3. finding 의 `evidence` 필드가 `research-summary.json.consensus_findings[*]` 또는 `dissent_findings[*]` 를 직접 인용 (string match 또는 explicit ref)
4. 해당 REQ 의 `research-invocations.json.req_respawn_count[req_id]` < `--research-respawn-limit` (둘은 **동일 카운터**, §5.5.6 정의. 기본 2)

**조건 1 은 표 행과 중복 명시되어 있다** (가드 강조). 표 행만 평가해도 동일 결과.

재spawn 시 kiwi-srs-research 호출 prompt 구성 (§5.5.2 패턴 확장):
- 기존 `연구 질문` 필드는 유지
- **신규**: `sub_questions` 배열 필드 추가 — 직전 `research-summary.json.dissent_findings[*].claim` + `resolution_suggested` 를 풀어서 sub_questions 로 변환
- 본 배열은 kiwi-srs-research §4.3 의 Phase R0 Triage 가 수신하여 `triage.json.sub_questions` 의 시드로 사용 (Triage 가 추가 분해 가능)
- 재spawn 호출 description 에 `--respawn-iter={N}` 토큰 부착 (감사 추적)

---

## 10. Phase 7 — User approval + dryRun verification

### 10.1 사용자 승인 게이트

`mutation-plan.json.summary.user_confirm_required > 0` 또는 §0.G5 적용 항목 존재 시:

1. `report.md` 생성 (요약 + per-REQ proposed change 표)
2. **Codex clarification gate 단일 호출** (§0.7 보장):
   - 단일 질문에 stable 승급 / deprecated 강등 / status 충돌 3 카테고리를 분리된 옵션 그룹으로 제시
   - 각 그룹은 기본 "전체 승인" 옵션 + "개별 결정" 옵션 (선택 시 후속 호출)
   - 옵션 그룹 ≤ 4 (Codex clarification gate 도구 제약 준수)
3. 사용자가 "개별 결정" 선택 시에만 카테고리당 1회 추가 호출 (최악 3+1=4 회. 평소 1 회)
4. 사용자 결정을 `mutation-plan.json.plan[*].user_decision` 에 기록

### 10.2 최종 dryRun

승인 완료 후 `mutation-plan.json.plan` 전체에 대해 `dryRun: true` 재호출 → guard verdict 최종 확인.

| IF (1차 ↔ 2차 dryRun verdict) | THEN |
|---|---|
| 모두 동일 (ok ↔ ok) | Phase 8 진행 |
| 일부 항목 차이 (ok → blocked) | 차이 항목 자동 차단 + 사용자 재승인 게이트 (Codex clarification gate). 다른 항목은 진행 |
| 일부 항목 차이 (blocked → ok) | 의외 통과 — 사용자에게 보고 후 진행 여부 확인 |
| MCP 에러 (네트워크/timeout) | 해당 항목 system_failed 분류 + 보고 |

근거: 1차 dryRun 과 2차 사이에 외부 사용자/스킬이 동일 SRS 를 수정할 가능성 존재 (race). "동일 결과 기대" 는 가정일 뿐 보증 아님.

---

## 11. Phase 8 — Apply mutations + finalize

### 11.1 분류별 MCP 시퀀스

#### stability 변경

per-REQ 독립 호출 (§0.13):

```js
update_stability({
  id: "FR-TODO-001",
  stability: "evolving",
  reason: "Feasibility=high (score 85). Blockers: none. Evidence: src/api.ts:45-67. Run: 2026-05-15.skf.v01",
  dryRun: false
})
```

#### NO-OP (status 충돌 또는 keep)

mutation 호출 안 함. `mutation-plan.json` 에 `applied: false, reason: "..."` 기록.

#### guard 거부 잔존

Phase 7 에서 guard 거부 항목이 처리되지 않은 경우 (예: 사용자가 대체 stability 선택 거부) → mutation 안 함, 보고만.

### 11.2 결과 집계

`stability-mutations.json`:
```json
{
  "mode": "live|dry-run",
  "applied": [
    { "req_id": "FR-TODO-001", "from": "draft", "to": "evolving", "reason": "...", "ok": true }
  ],
  "skipped": [
    { "req_id": "FR-TODO-002", "reason": "status_conflict", "current_status": "in_progress" }
  ],
  "guard_blocked": [
    { "req_id": "FR-TODO-003", "attempted_to": "stable", "guard_reason": "..." }
  ],
  "user_rejected": [],
  "system_failed": [
    { "req_id": "FR-TODO-004", "error_type": "mcp_timeout|network_error|mcp_exception", "error_message": "..." }
  ],
  "summary": {
    "applied_count": 12,
    "skipped_count": 2,
    "guard_blocked_count": 0,
    "user_rejected_count": 0,
    "system_failed_count": 0
  }
}
```

### 11.3 tag 갱신 (선택적)

| IF (speckiwi 의 기존 REQ tag mutation API 가용성) | THEN |
|---|---|
| 가용 (현재 미제공, 미래 버전에서 추가 가능성 있음) | per-REQ 호출로 `feasibility:{label}` / `feasibility-score:{NN}` / `feasibility-run:{run-id}` 부착 |
| 미가용 (현재 기본 상태) | **임시 회피**: `mutation-plan.json` 에 제안 tag 만 기록 + 사용자 보고. 다음 `kiwi-srs` 호출 시 신규 REQ 에만 부착하도록 패턴 안내 |

**회피 성격**: 본 회피는 **임시** — speckiwi 가 향후 기존 REQ tag mutation API 를 추가하면 즉시 본 §11.3 의 첫 행 경로로 전환한다. 영구 우회 의도 아님. 현재 회피의 한계:
- feasibility 정보가 REQ 메타에 영속화되지 않아 다음 run 에서 drift 감지(stable→draft 등) 시점에 이전 feasibility 결과를 재참조 불가
- 사용자는 `docs/analysis/kiwi-srs-feasibility-{run-id}/` 의 보고서를 SoT 로 참고해야 함

**전환 트리거**: speckiwi changelog 에 tag mutation API 가 등장하면 Phase 0 §3.0 의 가용성 점검에 `tag_mutation` 항목 추가 + 본 §11.3 표의 첫 행 자동 활성.

### 11.4 validate_spec + summarize_target + sync 점검

- `validate_spec` — 전체 SRS 구조 검증
- `summarize_target { target: TARGET }` — 최종 상태 요약
- **MCP↔Markdown sync 점검 (전수)** — applied mutation 의 **모든** REQ 에 대해:
  1. `get_requirement { id }` 의 `stability` 필드 조회
  2. 동일 REQ 의 Markdown 파일에서 stability 필드 read
  3. 두 값 일치 → PASS
  4. 두 값 불일치 시 **단계적 대응**:
     | 단계 | 동작 |
     |---|---|
     | a. 자동 retry 1회 | `--sync-retry-delay-ms` (기본 200) 만큼 대기 후 `get_requirement` 재조회 (지연 sync 가능성). Markdown 재 read 도 함께. 200ms 근거: speckiwi 의 typical Markdown line-patch 지연 추정치, 환경(파일시스템·MCP IPC)에 따라 조정 권장 |
     | b. retry 후 일치 | `sync-mismatch.log` 에 transient 라벨로 1줄 기록 후 PASS (사용자 보고 생략) |
     | c. retry 후 여전히 불일치 | `sync-mismatch.log` 에 persistent 라벨 + 양쪽 값 + REQ id 기록 + 사용자 보고 (CRITICAL) |
     | d. 자동 복구 없음 | §0.G1 황금률 (mutation 후 manual edit via apply_patch 금지) 때문에 자동 정정 불가. 사용자가 speckiwi MCP 동작을 확인하도록 안내 |

  - **`sync-mismatch.log` 포맷**: JSONL (1 REQ 1 line). 스키마:
    ```json
    { "run_id": "2026-05-18.skf.v01.v01", "req_id": "FR-TODO-001", "label": "transient|persistent", "mcp_value": "evolving", "md_value": "draft", "retry_count": 1, "retry_delay_ms": 200, "detected_at": "2026-05-18T13:01:23Z" }
    ```
    외부 도구 소비를 위해 필드명 고정. 추가 필드는 prefix `ext_` 권장.

  - 표본 추출 미사용 근거: applied 가 보통 ≤50건이므로 전수 read 비용 부담 작음. 결정적 보증이 안전.
  - 본 가드는 §0.G1 황금률이 speckiwi MCP 의 자동 Markdown sync 동작에 의존하므로, 그 가정 자체를 검증.

### 11.5 사용자 보고

본 Phase 는 **2 채널 보고** 의무: (a) 대화 메시지 요약 + (b) doculight viewer 노출. 둘 다 동일 `report.md` 를 source of truth 로 함.

#### 11.5.1 report.md 생성 (보고 SSOT)

`docs/analysis/kiwi-srs-feasibility-{run-id}/report.md` 작성. 본 파일이 §11.5.2 / §11.5.3 양 채널의 공통 SoT.

권장 섹션:
1. 메타 (run-id, target, 평가일, 모드)
2. Feasibility 분포 + Target 종합 판정
3. Stability 변경 결과 표 (per-REQ)
4. Status 충돌 REQ 목록
5. guard 거부 / 사용자 거부 항목
6. 다음 단계 권고
7. Phase 2.5 research 결과 요약 (활성 시)

#### 11.5.2 doculight viewer 노출

```js
open_markdown({
  path: "docs/analysis/kiwi-srs-feasibility-{run-id}/report.md",
  title: "kiwi-srs-feasibility {target} {run-id}"
})
```

호출 실패 또는 doculight MCP 부재 시 **순차 fallback**:

| 순위 | 채널 | 조건 | 동작 |
|---|---|---|---|
| 1 | doculight viewer | `open_markdown` 성공 | viewer 노출 + `status: opened` |
| 2 | doculight update | `search_documents` 가 동일 target 기존 보고서 탐색 성공 | `update_markdown` 덮어쓰기 안내만 (자동 덮어쓰기 금지) + `status: updated` |
| 3 | telegram | `--report-channel telegram` 명시 또는 doculight 1·2 모두 실패 + telegram MCP 가용 | `send_telegram_markdown` 으로 report.md 요약(≤4096자) 송출 + `status: sent` |
| 4 | google-chat | `--report-channel google-chat` 명시 또는 doculight·telegram 모두 실패 + google-chat MCP 가용 | `send_google_chat_markdown` 송출 + `status: sent` |
| 5 | path-only | 위 채널 전부 실패 또는 부재 | §11.5.3 메시지에 `report.md` 절대경로만 포함 + `status: unavailable` |

`--report-channel` 옵션은 *우선 시도 채널* 만 지정 — 해당 채널이 실패하면 다음 순위로 자동 fallback.

`report-channels.json` 에 채널별 결과 기록:
```json
{
  "primary_channel_requested": "doculight|telegram|google-chat",
  "doculight": { "status": "opened|updated|unavailable", "viewer_id": "...", "path": "..." },
  "telegram": { "status": "sent|skipped|unavailable", "char_count": 0 },
  "google_chat": { "status": "sent|skipped|unavailable", "char_count": 0 },
  "chat_message": { "status": "emitted|skipped", "char_count": 0 }
}
```

- `chat_message.status="emitted"`: 어시스턴트 응답에 §11.5.3 메시지 텍스트가 포함됨 (사용자 *수신·읽음* 여부는 본 스킬 책임 외)
- `chat_message.status="skipped"`: 사용자가 `--no-chat-report` 옵션 명시 또는 dry-run 모드에서 메시지 생략

#### 11.5.3 대화 메시지 요약

```markdown
## kiwi-srs-feasibility 완료 보고

- run-id: {YYYY-MM-DD}.{slug}.{target-slug}.{seq}
- target: {TARGET}
- 평가 REQ 수: {N}
- Feasibility 분포: high {n}, medium {n}, low {n}, blocked {n}
- Target 종합 판정: {release-ready | conditionally-ready | not-ready}

### Stability 변경 결과
- 적용: {applied_count}
  - draft → evolving: {n}
  - draft → stable: {n} (사용자 승인 완료)
  - * → deprecated: {n} (사용자 승인 완료)
- skip (status 충돌): {skipped_count}
- guard 거부: {guard_blocked_count}
- 사용자 거부: {user_rejected_count}

### Status 충돌 REQ
| REQ ID | status | feasibility | 권고 |
|---|---|---|---|
| FR-TODO-005 | in_progress | blocked | kiwi-coder 중단 검토 |

### 다음 단계
- evolving REQ 는 kiwi-coder 로 구현 단계 진입 가능
- deprecated REQ 는 SRS 재작성 또는 scope 제거 검토
- guard 거부 REQ 는 정책 검토 또는 수동 update_stability

### 비용 (--enable-research 활성 시)
- Phase 2.5 호출 후보: {N} REQ (limit {--research-limit})
- Phase 2.5 재spawn: 총 {N} 회 (per-REQ 상한 {--research-respawn-limit})
- 본 run sub-subagent 총량 (사전추정/실측): {est}/{actual}
- cost-cap: {--cost-cap or "unset"}

### 보고 채널
- 1차 채널 ({primary_channel_requested}): {opened|updated|sent|unavailable}
- fallback 사용: {none|telegram|google-chat|path-only}
- 분석 로그: docs/analysis/kiwi-srs-feasibility-{run-id}/
- 보고서 (SSOT): docs/analysis/kiwi-srs-feasibility-{run-id}/report.md
```

비용 섹션은 `--enable-research` 비활성 또는 `--no-cost-report` 옵션 시 생략. 사전추정(`cost-estimate.json`)과 실측을 함께 표기하여 가드 정확도 모니터링.

---

## 12. MCP availability and remediation

Normal target-scoped SRS reads, mutations, status/stability changes, evidence,
trace links, and completed-work logging require `speckiwi mcp`. CLI commands may
diagnose installation/version/configuration or help the user restore MCP, but
they are not normal fallback mutation paths.

| 작업 | MCP | CLI diagnostic only |
|---|---|---|
| Active target | `get_active_target` | 설치/버전/설정 확인만 |
| Target 활성화 | `set_active_target` | 설치/버전/설정 확인만 |
| REQ 조회 | `get_requirement` | 설치/버전/설정 확인만 |
| REQ 목록 | `list_requirements` | 설치/버전/설정 확인만 |
| **Stability 변경** | **`update_stability`** | **설치/버전/설정 확인만** |
| 검증 | `validate_spec` | 설치/버전/설정 확인만 |
| 요약 | `summarize_target` | 설치/버전/설정 확인만 |

---

## 13. 수렴 기준 (Phase 8 객관 메트릭)

- `validate_spec` PASS
- Normal: 루프 ≤ 5 iter; Max: ≤ 15 iter
- Normal 종료: CRITICAL = 0 ∧ HIGH = 0
- Max 종료: 2 consec iter 에서 CRITICAL/HIGH/MEDIUM 합산 = 0
- mutation-plan 의 `applied + skipped + guard_blocked + user_rejected + system_failed` = 평가 대상 REQ 수
- 모든 mutation 의 guard verdict = ok

---

## 14. 주의사항

- **Status 변경 권한 없음** (§0.10) — feasibility=blocked 라도 Status 는 그대로 두고 stability 만 변경 (또는 keep + 보고)
- 신규 REQ 추가 권한 없음 — REQ 작성은 `kiwi-srs` 담당
- `stable` / `frozen` 승급은 정책 무관 항상 사용자 승인 (§0.7, §0.G5)
- transition guard 우회 금지 (§0.11)
- per-REQ 독립 mutation, 부분 실패 허용 (§0.13)
- 검증자 출력은 `eval_iter{N}.json` 파일로 저장, 메인에는 summary count + top 3 CRITICAL/HIGH 만 로드
- `/snoworca-feasibility` 호출 절대 금지 (§0.8)
- 외부 모듈 영향 발견 시 해당 REQ 단위 중단 (§0.G2) — 전체 중단 아님

---

## 15. 파이프라인 위치

```
kiwi-srs (authoring) → kiwi-srs-feasibility (target 전수 평가) → kiwi-coder (구현)
                              ↑ 본 스킬
```

상세는 `../../_shared/kiwi/pipeline-v1.md` 참조.

---

## 16. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-srs-feasibility"`
- `status`: 정상 종료 = `TASK_DONE`; dry-run = `DRY_RUN`; 사용자 보류 = `NEEDS_USER`; 실패 = `FAILED`
- `next_hint`: 평가 결과 stability ≥ evolving 다수 → `"kiwi-planner"`; 블로커 모호 다수 → `"kiwi-srs-research"`; 혼재 → `null` (사용자 결정)
- `req_ids`: 본 호출에서 stability 가 변경된 REQ-ID 배열
- `artifacts.analysis_dir`: `docs/analysis/kiwi-srs-feasibility-{run-id}/`
- `notes`: stability 전이 통계 ("draft→evolving:5 evolving→stable:2 → deprecated:1") 권장

emit 실패는 best-effort.
