# kiwi-srs-feasibility 보고 — 미구현 3건 (v2.3.0.1)

- **run-id**: 2026-07-08.speckiwi.v2301.01
- **target**: v2.3.0.1
- **평가일**: 2026-07-08
- **모드**: normal, --auto (스코프: status=planned 3건)
- **평가 REQ**: FR-FLOW-014, FR-FLOW-015, FR-FLOW-018

## 1. 종합 판정: NOT-READY

미구현 3건 중 **1건만 즉시 구현 가능**하고, 2건은 실제로 존재하지 않거나 노출되지 않은 런타임에 의존합니다.

| REQ | 스킬 | feasibility | 점수 | 판정 |
|---|---|---|---|---|
| FR-FLOW-014 | kiwi-step | **high** | 85 | ✅ 즉시 구현 가능 |
| FR-FLOW-015 | kiwi-spec-merge | **low** | 44 | ⚠️ 런타임 노출 작업 선행 필요 |
| FR-FLOW-018 | kiwi-vibe | **blocked** | 31 | ⛔ 런타임 부재 (구현 선행 필요) |

## 2. Feasibility 분포

high 1 / medium 0 / low 1 / blocked 1

## 3. Stability 변경 결과

**적용 mutation 0건** (전부 keep=evolving no-op).
- FR-FLOW-014: high + 무증거 → evolving 유지
- FR-FLOW-015: low이나 원인이 *수정 가능한 의존성 노출 갭*이므로 draft 강등 대신 keep + 블로커 보고 (§14)
- FR-FLOW-018: blocked이나 올바른 조치는 deprecated가 아니라 start_vibe_task 구현이므로 keep + 보고 (§14)

## 4. 블로커 상세 (코드 증거)

### FR-FLOW-015 (kiwi-spec-merge)
- **`diff_steps` 미노출**: core 구현은 `src/core/query/diff-steps.ts:54`에 존재하나 MCP/CLI 어디에도 등록 안 됨. schemas.ts:165는 `workflow_diff`(별개 도구). → 스킬이 AC-3(diff_steps 분류 라우팅)을 호출할 수단 없음.
- **merge-journal 미연결**: `src/core/patch/merge-journal.ts`(MultiFileCommit/recoverMerge)는 존재하나 `src/` 내 caller 0건. → 스킬이 AC-4(중단 후 resume)를 달성 불가.
- (AC-5 검증감소 리포트 + loser 증거 이관은 런타임 백킹 없음이나 스킬 레벨에서 add_verification_evidence + summary diff로 구현 가능.)

### FR-FLOW-018 (kiwi-vibe)
- **`start_vibe_task` 전무**: `src/` 전체에 core/MCP/CLI 어느 형태로도 존재하지 않음. intent.md는 읽기만(synthesis.ts:265) 됨. 가장 근접한 `setWorkMode`(work-mode.ts:82)는 CLI 전용이며 activeTask 인자를 노출하지 않음. → 스킬이 AC-1/2/3(전부 start_vibe_task 기반) 달성 불가.

## 5. 거버넌스 결함: phantom-implemented 요구

앞선 2026-07-08 v3→v2.3.0.1 살베지가 *파일 존재 휴리스틱*으로 `implemented`를 부여한 결과, 실제 코드/도구가 없는데 implemented로 표기된 요구가 확인됨:

| REQ | 도구 | SRS Status | 실제 | 증거 |
|---|---|---|---|---|
| FR-MCP-044 | diff_steps | implemented | core-only, 미등록 | schemas.ts:165=workflow_diff |
| FR-MCP-046 | start_vibe_task | implemented | 코드 0건 | grep 0, AC 전부 미체크, evidence/trace 공란 (40...:3338-3389) |

**진짜 구현 확인됨**(대조군): FR-MCP-040 validate_step, FR-MCP-042 claim_step, FR-MCP-043 promote_step_requirement — 모두 registered.

**체계적 리스크**: step/vibe MCP-tool 계열의 `implemented` 라벨은 도구 노출 완결성 기준으로 재감사 필요(살베지는 실제 등록이 아닌 파일 존재로 판정).

## 6. 다음 단계 권고

파이프라인을 3건 전부에 대해 자동 진행할 수 없음(혼재 + 무결성 결함). 사용자 스코프 결정 필요:

- **FR-FLOW-014**: 즉시 planner→pm→review 진행 가능.
- **FR-FLOW-015 / FR-FLOW-018**: 스킬 구현 전에 런타임 선행 필요 —
  - diff_steps를 MCP/CLI 도구로 노출 + merge-journal 연결 (FR-MCP-044 실구현)
  - start_vibe_task 실구현 (FR-MCP-046 실구현)
  - FR-MCP-044/046의 허위 `implemented` status를 kiwi-srs로 정정 (implemented→planned/in_progress)

## 7. 산출물

- `docs/analysis/kiwi-srs-feasibility-2026-07-08.speckiwi.v2301.01/`
  - preflight.json / target-snapshot.json / policy-resolved.json / policy_context.json
  - code_context.json / existing_srs_context.json (사전조사 2-analyst)
  - per-req-judgement.json / synthesis.json / mutation-plan.json / report.md
