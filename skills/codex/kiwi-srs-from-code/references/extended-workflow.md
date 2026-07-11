# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 8. Phase 4 — 검증자 4축 (병렬, 입력 격리)
- 8.1 검증자 4종 (모두 격리 컨텍스트)
- 8.2 검증자 입력 (§0.2 격리)
- 8.3 Hallucination ↔ Scope-Creep 판정 신호 분리 (HIGH 차단 해제)
- 8.4 검증자 출력 스키마 + 동등성 키
- 8.5 게이트
- 9. Phase 5 — 개선 라우팅 (메인 재할당)
- 9.1 메인의 라우팅 책임 (HIGH 차단 해제)
- 9.2 활성 scope만 spawn (비용 가드레일)
- 9.3 개선 서브에이전트 지시문
- 9.4 거절 처리
- 10. Phase 6 — 루프
- 10.1 종료 조건 (모두 만족)
- 10.2 진동 감지 (HIGH 차단 해제)
- 10.3 조기 종료
- 10.4 max-eval-iter 기본값
- 11. Phase 7 — 인벤토리 게이트 + 최종 검증
- 11.1 인벤토리 100% 매핑 게이트 (HIGH 차단 해제)
- 11.2 validate_spec
- 11.3 summarize_target
- 11.4 verified 후보 식별 (선택)
- 11.5 최종 보고 (사용자 직접 출력)
- kiwi-srs-from-code 완료 보고
- 품질 게이트 (자동 경고)
- scope별 요약
- verified 후보
- 남은 작업 제안
- 12. MCP availability and remediation
- 13. 수렴 기준 (Phase 7 객관 메트릭)
- 14. Pipeline event emit (의무)

---

## 8. Phase 4 — 검증자 4축 (병렬, 입력 격리)

### 8.1 검증자 4종 (모두 격리 컨텍스트)

4축 검증자는 모두 **현재 세션 모델(current session model)**을 상속하며 `--model <name>` (또는 사용자가 지명한 모델) 로 override 한다.

| 축 | 책임 |
|---|---|
| **Missing-Detector** | `inventory.json` 의 모든 항목이 최소 1개 요구사항에 매핑되는지 전수 점검 |
| **Correctness-Auditor** | SRS 항목의 statement·AC가 실제 코드 동작과 일치하는지 검증 |
| **Hallucination-Hunter** | **단정 서술 + 코드 증거 전무** 항목 발견 (거짓 사실 진술) |
| **Scope-Creep-Reviewer** | **추측 서술 + 코드 무관** 항목 발견 (향후 요구·임의 작성) |

**반복(iteration) 정책**: 1st iter는 4축을 모두 실행한다. 2nd+ iter에서 동일 axis가 동일 finding을 다시 보고하면 해당 축을 재검증(re-run)하여 확증한다 — 모델 격상이 아니라 **반복 확증**으로 처리한다(검증 모델은 현재 세션 모델 불변). 검증자 출력은 파일(`eval_iter{N}.json`)로만 저장하고 메인 컨텍스트에는 summary count + top 3 CRITICAL/HIGH 만 로드.

### 8.2 검증자 입력 (§0.2 격리)

각 검증자에 동일 제공:
- `CODE_PATH` (file-read access)
- `docs/spec/*.srs.md` 전체
- `inventory.json` (Missing-Detector 에만 결정적 체크리스트로)
- `scope_assignments_view.json` (필터링된 필드만)
- 직전 iter의 `eval_iter{N-1}.json` (escalation 판정용, 2nd iter 부터)

**금지**: Phase 3 작성자 출력 JSON, `scope_assignments.json` 원본(`agent_id`/`draft_policy` 포함), 메인 결론.

### 8.3 Hallucination ↔ Scope-Creep 판정 신호 분리 (HIGH 차단 해제)

| 신호 | Hallucination | Scope-Creep |
|---|---|---|
| 서술 유형 | "X 기능을 제공한다" (단정 사실 진술) | "X 기능이 필요하다" / "사용자가 X 를 원할 것" (추측 / 향후 요구) |
| AC | 코드 검증 가능 동작을 단정 | 측정 불가, 추상적 |
| 코드 증거 | 전무 (path 없음) | 전무 또는 무관한 path |
| 처리 | `update_status` 로 `discarded` + Change Notes "거짓 사실 진술" | `update_status` 로 `discarded` + Change Notes "scope_creep: 코드 증거 없음" |

판정 신호가 동시에 부합하면 **단정/추측 서술이 1차 키**. 메인 dedup 시 동일 `(scope, requirement_id, evidence_path)` 키의 두 finding 은 머지 (§8.4).

### 8.4 검증자 출력 스키마 + 동등성 키

```json
{
  "axis": "missing|correctness|hallucination|scope_creep",
  "iter": N,
  "findings": [
    {
      "id": "{axis}-{iter}-{seq}",
      "finding_hash": "sha1({scope}|{requirement_id||evidence_path:line}|{type}|{axis})",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "scope": "PARSE",
      "requirement_id": "FR-PARSE-007 | null",
      "type": "missing|wrong|hallucinated|unnecessary",
      "evidence": "src/core/parser/foo.ts:45-67",
      "evidence_path": "src/core/parser/foo.ts",
      "evidence_line_range": "45-67",
      "description": "...",
      "suggested_action": "add|edit_via_mcp|discard_via_update_status|split|merge",
      "suggested_patch": "... (선택)"
    }
  ],
  "summary": { "CRITICAL": N, "HIGH": N, "MEDIUM": N, "LOW": N }
}
```

**`finding_hash` 는 메인의 진동/dedup 키.** 검증자가 텍스트 표현만 바꿔도 hash 가 같으면 동일 finding.

### 8.5 게이트

| 등급 | 의미 | scope당 한도 | **전역 누적 한도** |
|---|---|---|---|
| CRITICAL | 코드와 불일치, 할루시네이션 확정, 핵심 누락 | 0 | 0 |
| HIGH | 중요 누락, 명백한 임의 요구사항 | 0 | 0 |
| MEDIUM | 개선 권장 | ≤2 | ≤10 |
| LOW | 스타일, 용어 | ≤5 | ≤25 |

---

## 9. Phase 5 — 개선 라우팅 (메인 재할당)

### 9.1 메인의 라우팅 책임 (HIGH 차단 해제)

검증자 출력의 `scope` 필드는 **hint 로만 취급**. 메인은 다음 단계로 라우팅 결정:

1. `finding.evidence_path` 를 `scope_assignments.scopes[*].primary_files_glob` 와 매칭
2. 매칭되는 scope 가 1개 → 그 scope agent 로 라우팅
3. 매칭이 복수 → inventory_share 비중이 큰 scope
4. 매칭이 0개 → cross-scope finding. 사용자에게 보고하거나 새 scope 생성 제안

### 9.2 활성 scope만 spawn (비용 가드레일)

iter당 finding 이 0건인 scope 의 개선 agent 는 spawn 하지 않음. finding 보유 scope 만 병렬 spawn.

### 9.3 개선 서브에이전트 지시문

```
역할: speckiwi SRS 개선자 (단일 scope)
scope: {prefix}
입력 findings (메인이 재라우팅한 후): [...]

작업:
1. severity CRITICAL/HIGH 먼저, MEDIUM/LOW 후순위
2. type 별 처리 (모두 MCP 정식 도구만 사용, manual file edit via apply_patch 금지):
   - **missing** → MCP `add_requirement` 신규 추가 (trace 배열에 evidence path 필수)
   - **wrong, 사소한 정정** (AC 추가/체크, evidence 누락, trace 누락 등 statement·title·type 변경 불필요한 경우) → `add_verification_evidence` / `add_trace_link` / `check_acceptance_criteria` MCP 로 보강. status 만 변경하면 충분한 경우는 `update_status` 사용.
   - **wrong, statement/title/type 변경 필요** → `update_status` 는 status만 바꾸므로 부적합. 신규 `add_requirement` 호출로 새 ID 발급 + 기존 ID 를 `update_status { status: "discarded" }` 로 폐기 + Change Notes 에 신규 ID 참조 추가. (SRS-MD §11.4: 폐기 ID 재사용 금지)
   - **hallucinated** → MCP `update_status { id, status: "discarded" }` + Change Notes "거짓 사실 진술 — 코드 증거 없음"
   - **unnecessary (scope_creep)** → MCP `update_status { id, status: "discarded" }` + Change Notes "scope_creep — 코드 증거 없음"
3. suggested_patch 는 참고만. 코드 재확인 후 판단 (§0.9: 사실 위조 거절)
4. ID 수정/삭제 시 SRS-MD §11.4 준수 (재사용 금지)

출력:
{
  "scope": "{prefix}",
  "iter": N,
  "applied": [ { finding_hash, action, requirement_id, result: "ok|skipped|rejected", reason } ],
  "rejected_findings": [ ... ]
}
```

### 9.4 거절 처리

agent 가 거절한 finding (예: 존재하지 않는 함수 추가 요구) 은 메인이 `rejected_findings.log` 에 보존 + Phase 7 보고에 포함. **거절 = 사실 위조 거부**이므로 페널티 아님.

저장: `improvement_iter{N}.json`

---

## 10. Phase 6 — 루프

### 10.1 종료 조건 (모두 만족)

1. 모든 scope에서 CRITICAL = 0 (전역 0)
2. 모든 scope에서 HIGH = 0 (전역 0)
3. MEDIUM 전역 ≤ 10, LOW 전역 ≤ 25
4. 직전 iter 대비 신규 finding_hash 0건 또는 `--max-eval-iter` 도달

### 10.2 진동 감지 (HIGH 차단 해제)

동일 `finding_hash` 가 **2 iter 연속 등장**하면 즉시 사용자 에스컬레이션. (3 iter는 너무 늦음. 본 스킬은 2회로 단축)

### 10.3 조기 종료

2 iter 연속 신규 finding_hash 0건 → 즉시 Phase 7.

### 10.4 max-eval-iter 기본값

`--max-eval-iter` 기본 **3** (v1.0 의 6에서 축소. 비용 가드레일). 명시 상향 가능.

---

## 11. Phase 7 — 인벤토리 게이트 + 최종 검증

### 11.1 인벤토리 100% 매핑 게이트 (HIGH 차단 해제)

메인이 다음을 수행:
1. `inventory.json` 의 모든 항목과 MCP `list_requirements { target: TARGET }` 결과의 모든 요구사항 `trace[*].reference` 를 다음 **정규화 비교**로 매칭:
   - **path 정규화**: 양쪽 reference 에서 path 부분(`:` 또는 `#L` 직전까지)을 추출, 소문자 + forward slash 통일, 워크스페이스 루트 기준 상대경로로 정규화
   - **line range overlap**: inventory 의 `line` 과 trace 의 `Lstart-Lend` 가 **중첩되거나 inventory.line ∈ [Lstart, Lend]** 이면 매칭. line 정보 없으면 path 일치만으로 매칭
   - 매칭 결과를 `inventory_coverage.json` 에 기록
2. 각 항목 (rest endpoint, cli command, public function, config option, data entity, event) 이 **최소 1개 요구사항** 과 매칭되어야 함
3. 미매핑 항목이 있으면 → 해당 path 가 속한 scope 의 개선 agent 재spawn (1회 한정, 미매핑 목록을 finding 형식으로 주입)
4. 1회 재spawn 후에도 미매핑 → 사용자 에스컬레이션

### 11.2 validate_spec

MCP `validate_spec` 호출. diagnostic 처리:
- speckiwi 정식 도구로 수정 가능 (status → update_status, evidence → add_verification_evidence, trace → add_trace_link) → 자동 수정 후 즉시 `validate_spec` 재호출로 staleness 확인
- manual file edit via apply_patch 가 필요한 경우 → 사용자 에스컬레이션 (자동 manual edit via apply_patch 금지)

### 11.3 summarize_target

MCP `summarize_target { target: TARGET }` 호출. 결과를 보고에 포함.

### 11.4 verified 후보 식별 (선택)

`acceptanceCriteria` 가 모두 코드 테스트로 커버되는 요구사항 후보 리스트를 출력. **자동 승격 금지** — 사용자 또는 kiwi-coder 후속 스킬에 위임.

### 11.5 최종 보고 (사용자 직접 출력)

```markdown
## kiwi-srs-from-code 완료 보고

- run-id: {YYYY-MM-DD}.{project-slug}
- target: {TARGET}
- scope 개수: N
- 요구사항 총 개수: M (functional A / non_functional B / interface C / ...)
- 검증 루프: N iter (조기수렴 여부)
- 인벤토리 100% 매핑: PASS / FAIL ({k}개 미매핑)
- discarded (할루시네이션·scope_creep 제거): X건
- draft (추정 항목): Y건
- validate_spec: PASS / FAIL ({n} diagnostics)
- rejected_findings: Z건 (사실 위조 거절)

### 품질 게이트 (자동 경고)

| 항목 | 임계값 | 실측 | 상태 |
|---|---|---|---|
| validate_spec | PASS | ... | ... |
| 인벤토리 매핑 | 100% | ...% | ... |
| iter 수렴 | ≤3 | N | ... |
| discarded ratio | <15% | ...% | WARN if 초과 |
| 전역 MEDIUM | ≤10 | ... | ... |
| 전역 LOW | ≤25 | ... | ... |

### scope별 요약

| scope | prefix | file | requirements | draft | discarded |
|---|---|---|---|---|---|

### verified 후보

(코드 테스트 커버 + AC 전체 충족 후보 리스트 — 사용자$kiwi-coder 승격 위임)

### 남은 작업 제안

- draft → stable 승격은 사용자가 코드 확정 후 수동 수행
- discarded 는 ID 보존 상태 (재사용 금지)
- 다음: kiwi-coder / snoworca-kiwi-coder 로 구현 검증 가능
```

---

## 12. MCP availability and remediation

Normal target-scoped SRS reads, mutations, status/stability changes, evidence,
trace links, and completed-work logging require `speckiwi mcp`. CLI commands may
diagnose installation/version/configuration or help the user restore MCP, but
they are not normal fallback mutation paths.

| 작업 | MCP | CLI diagnostic only |
|---|---|---|
| 초기화 | `init_project` | 설치/버전/설정 확인만 |
| Active Target 조회 | `get_active_target` | 설치/버전/설정 확인만 |
| Target 활성화 | `set_active_target` | 설치/버전/설정 확인만 |
| 요구사항 추가 | `add_requirement` | 설치/버전/설정 확인만 |
| Status 변경 | `update_status` | 설치/버전/설정 확인만 |
| Trace 추가 | `add_trace_link` | 설치/버전/설정 확인만 |
| Verification 추가 | `add_verification_evidence` | 설치/버전/설정 확인만 |
| 검증 | `validate_spec` | 설치/버전/설정 확인만 |
| 요약 | `summarize_target` | 설치/버전/설정 확인만 |
| 목록 | `list_requirements` | 설치/버전/설정 확인만 |
| 요구사항 조회 | `get_requirement` | 설치/버전/설정 확인만 |

MCP 미가용 시 정상 SRS 작업을 중단하고 복구 안내를 보고한다.

---

## 13. 수렴 기준 (Phase 7 객관 메트릭)

본 절은 §0.1 "인라인 자가검증 금지" 와 충돌하지 않는다. 모두 MCP 의 객관 출력 또는 결정적 rg/search 결과를 사용하는 메트릭이며 메인의 주관 판단을 포함하지 않는다.

- 인벤토리 100% 매핑 (Phase 7 게이트)
- `validate_spec` PASS
- 검증 루프 ≤ 3 iter 수렴 (기본값 기준)
- discarded ratio < 15% (초과 시 Phase 3 작성자 임의 작성 의심 — 재실행 권장)
- 전역 MEDIUM ≤ 10, LOW ≤ 25
- rejected_findings 의 모든 항목이 사실 위조 거절 사유와 함께 보존

---

## 14. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-srs-from-code"`
- `status`: 정상 종료 = `TASK_DONE`; 사용자 결정 보류 = `NEEDS_USER`; 실패 = `FAILED`; dry-run = `DRY_RUN`
- `next_hint`: 통상 `"kiwi-srs-feasibility"` (Stability=draft 가 생성되었으므로 feasibility 평가 권장)
- `req_ids`: 본 호출에서 등록한 신규 REQ-ID 배열
- `artifacts.spec_files`: 생성/갱신된 SRS Markdown 경로 배열
- `artifacts.analysis_dir`: `docs/analysis/kiwi-srs-from-code-{run-id}/`

emit 실패는 best-effort — 본 작업 (SRS 역추출) 의 보고는 별도로 출력.
