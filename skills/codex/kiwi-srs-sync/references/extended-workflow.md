# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 8. Phase 5 — dry-run 산출물 생성
- 9. Phase 6 — 사용자 게이트
- 10. Phase 7 — MCP mutation 일괄 적용
- 10.1 호출 순서 SSOT
- 10.2 멱등성
- 10.3 보고서
- 11. 호출 예시
- 12. 기존 스킬과의 경계
- 13. Out of Scope
- 14. v0.x → v1.0 마일스톤
- 15. Pipeline event emit (의무)

---

## 8. Phase 5 — dry-run 산출물 생성

§1.5 의 `proposed-mutations.md` 양식대로 작성. 동시에 `proposed-mutations.json` 생성:

```json
{
  "run_id": "...",
  "target": "...",
  "summary": { "cu_total": K, "classifications": {"conflict": A, "update": B, "new_feature": C, "new_scope": D} },
  "mutations": [
    {
      "ordinal": 1,
      "cu_id": "CU-001",
      "classification": "update",
      "tool": "append_section_note",
      "args": { "id": "FR-X-001", "section": "Acceptance Criteria", "note": "..." },
      "args_hash": "sha1...",
      "rationale": "...",
      "blocking_question": null
    }
  ],
  "blocking_questions": [
    { "cu_id": "CU-007", "question": "new-scope: 이 변경을 어디로?", "options": ["create-scope-X", "extend-scope-Y", "move-to-other-target"] }
  ]
}
```

`blocking_questions` 비어있지 않으면 Phase 6 진입 전 Codex clarification gate 강제.

---

## 9. Phase 6 — 사용자 게이트

`--auto-apply` / `--yes-all` 부재 시 의무.

Codex clarification gate 4옵션:
- `apply-all`: 전체 mutation 실행
- `apply-selected`: 사용자가 선택한 ordinal 만 실행 (multiSelect)
- `dry-run-only`: 산출물만 보존, mutation 0건
- `abandon`: 산출물 삭제 + 작업 종료

`blocking_questions` 가 있으면 본 게이트 전에 각각 해소 (4옵션은 그 다음 차례).

**new-scope 분류 CU 처리 (§0.G3 옵션별 종료 흐름)**:
- 옵션 (1) "신규 scope 생성" → 해당 CU 의 mutation 큐를 큐에서 제거, 사용자에게 `$kiwi-srs` 호출 안내, 본 스킬은 해당 CU 만 skip 하고 다른 CU 진행 (다른 CU 도 모두 (1)/(3) 선택 시 본 스킬은 mutation 0건으로 종료)
- 옵션 (2) "기존 scope 확장" → §10.1 step 1 `add_requirement` 진행 (기존 scope 명 args 에 포함)
- 옵션 (3) "다른 target 이동" → 해당 CU 의 mutation 큐를 큐에서 제거, 사용자에게 "`set_active_target` 수동 실행 후 본 스킬 재실행" 안내, 본 스킬은 해당 CU skip
- 옵션 (1)/(3) 으로 skip 된 CU 는 보고서 §10.3 본문 섹션 9 "skip 된 CU 목록" 에 명시 (잔존 finding §10 과 분리)

---

## 10. Phase 7 — MCP mutation 일괄 적용

### 10.1 호출 순서 SSOT

```
0. (사전 검증) 각 mutation 의 args 를 SRS-MD-Rules 대조:
   - update_status: 기존 status > 제안 status 면 backward 차단 (예: verified → implemented 금지)
   - update_stability: 기존 stability > 제안 stability 면 backward 차단 (frozen → evolving 금지). 단 deprecated 로의 전이는 모든 단계에서 허용
   - append_section_note: REQ 의 Stability=frozen 이면 차단 + 사용자 게이트 3옵션: (1) 해당 mutation skip + 다른 CU 진행 / (2) 사용자가 별도로 `update_stability` 강등 (frozen→deprecated 또는 명시적 unfreeze 의사결정) 후 본 스킬 재실행 / (3) 본 sync run abandon
   - add_requirement: target/scope 존재 확인, REQ-ID 충돌 확인
   - 위반 발견 시 해당 mutation skip + `rejected_findings.log` 기록 + 사용자 보고
   - **의무**: MCP `validate_spec` 을 dry-run 단계(§5) 말미에 1회 호출하여 사전 검증. 결과는 `proposed-mutations.md §1` 끝에 "validate_spec 결과" 1행으로 명시 (PASS / WARN n건 / ERROR n건). ERROR 잔존 시 §0.G1 의 평가자 FAIL 과 동일하게 mutation 0건으로 종료
1. add_requirement (new-feature / new-scope=(2)기존 scope 확장만) — 신규 REQ 생성
2. append_section_note (update) — 기존 REQ AC 보강
3. add_trace_link — code anchor 등록 (source: Requirement, target: Code, reference: src/x.ts:45-67, relation: implements)
4. add_verification_evidence — 테스트 통과한 경우 type=test 로 등록
5. update_status — implemented / verified 전이 (§0번 사전 검증 통과한 것만)
6. update_stability — proposed→evolving 등 승급 시 (§0번 사전 검증 통과한 것만)
7. add_completed_work — 변경 작업 자체를 작업 로그로 기록 (한 번에 묶어서)
```

각 호출은 `applied-mutations.jsonl` 에 append:
```json
{"called_at": "ISO-8601", "ordinal": 1, "tool": "add_requirement", "args": {...}, "args_hash": "sha1...", "ok": true, "response_hash": "sha1...", "dry_run": false}
```

### 10.2 멱등성

동일 `args_hash` 재호출 skip. 실패 시 후속 호출 중단 + 사용자 보고 + `pending_mutations[]` 적재.

### 10.3 보고서

`docs/analysis/kiwi-srs-sync-{run-id}/report.md`:

```yaml
---
run_id: ...
target: ...
mode: normal|max|model|dry-run-only
base_ref: main
head_ref: HEAD
applied: 12
skipped: 3 (dedup)
failed: 0
---
```

본문 섹션:
1. 사용된 플래그 + 비용 배수
2. 변경 분석 요약 (CU 총수, 4방향 분포)
3. 적용된 mutation 목록 (도구별, REQ-ID별)
4. 새로 생성된 REQ 목록 (신규 ID + 초안 인용)
5. 갱신된 AC 목록 (REQ-ID + diff)
6. Stability/Status 전이 결과
7. 외부 모듈 영향 (있다면)
8. 평가자 finding 통계 (severity별)
9. **skip 된 CU 목록** (§9 의 new-scope (1)/(3) 선택 + frozen 차단 등으로 mutation 큐에서 제외된 CU. cu_id / 분류 / skip 사유 / 후속 권고 안내)
10. 잔존 MEDIUM/LOW finding (사후 검토 권고. 평가자 axis 별 finding 목록)
11. 메타 (run-id, 시간, 실측 토큰)

§9 와 §10 은 명백히 다른 카테고리이므로 보고서에서 합치지 말 것 — §9 는 "본 스킬이 의도적으로 처리 보류한 CU", §10 은 "평가자가 통과시킨 후 잔존한 finding".

---

## 11. 호출 예시

```
$kiwi-srs-sync
$kiwi-srs-sync --base=develop --head=HEAD
$kiwi-srs-sync --staged
$kiwi-srs-sync --since=2026-05-15
$kiwi-srs-sync --files=src/auth.ts,src/payment.ts
$kiwi-srs-sync --max
$kiwi-srs-sync --auto-apply --yes-all
$kiwi-srs-sync --dry-run-only
$kiwi-srs-sync --model <name>
$kiwi-srs-sync TARGET=v1.0.0
$kiwi-srs-sync TARGET=v1.0.0 --base=develop
```

`--auto-apply` / `--yes-all` 은 사용자가 직접 요청한 경우에만 사용한다.
부모 skill 의 `--auto` 전파만으로 이 예시를 실행하지 않는다.

자연어 매핑 예시:
- "타겟 1.0.0 에 대하여 비교하고 업데이트 해줘" → `$kiwi-srs-sync TARGET=v1.0.0`
- "v0.3 와 코드 동기화" → `$kiwi-srs-sync TARGET=v0.3`
- "구현된 코드 SRS 에 반영" → `$kiwi-srs-sync` (활성 target 자동)

---

## 12. 기존 스킬과의 경계

| 시나리오 | 사용 스킬 |
|---|---|
| 처음부터 SRS 신규 작성 (코드 전체 → SRS 0건 상태) | `$kiwi-srs-from-code` |
| 신규 요구사항 자연어 → SRS 증분 (spec-first) | `$kiwi-srs` |
| target 활성 REQ 전수 feasibility + Stability 일괄 | `$kiwi-srs-feasibility` |
| REQ 또는 연구 질문 deep research | `$kiwi-srs-research` |
| 계획 수립 (Phase>Task 분해) | `$kiwi-planner` |
| 계획 기반 TDD-first 구현 | `$kiwi-coder` |
| **코드 변경(diff) → 기존 SRS 사후 동기화** (본 스킬) | `$kiwi-srs-sync` |

---

## 13. Out of Scope

| 범위 밖 | 담당 스킬 |
|---|---|
| target 신규 생성 / scope 자체 신규 등록 | `$kiwi-srs` (사용자 게이트 후) |
| 계획 문서 (plan.md) 작성 | `$kiwi-planner` |
| 코드 구현 자체 | `$kiwi-coder` 또는 외부 도구 |
| git commit / push | 사용자 결정 (시그니처 금지 §0.8) |
| 통합 테스트 작성 | `$kiwi-coder` Phase 4 |

---

## 14. v0.x → v1.0 마일스톤

- v0.2: PR 본문 자동 생성 (변경 분석 요약 + 신규/갱신 REQ-ID 목록)
- v0.3: 다중 target 일괄 sync (브랜치별 target 매핑)
- v0.4: 비-git VCS (jj, hg) 지원
- v1.0: SRS-MD-Rules v2 호환

---

## 15. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-srs-sync"`
- `status`: mutation 완료 = `TASK_DONE`; dry-run 만 종료 = `DRY_RUN`; conflict 보류 = `NEEDS_USER`; 실패 = `FAILED`
- `next_hint`: 통상 `"kiwi-pipeline"` (재평가 — 사용자 결정에 따라 후속 스킬 분기)
- `req_ids`: mutation 영향 REQ-ID 배열 (신규 + 갱신)
- `artifacts.spec_files`: 갱신된 SRS Markdown 경로
- `artifacts.analysis_dir`: `docs/analysis/kiwi-srs-sync-{run-id}/`
- `notes`: 4방향 분류 통계 ("conflict:1 update:3 new-feature:2 new-scope:0") 권장

emit 실패는 best-effort.
