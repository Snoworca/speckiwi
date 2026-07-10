---
run_id: 2026-07-10.speckiwi.v2301-flow
skill: kiwi-planner
mode: --max
target: v2.3.0.1
generated_at: 2026-07-10
scope: planned-only (FR-FLOW-022~032, 11 of 96 non-discarded)
phases: 6
tasks: 23
reqs: 11
acs: 41
test_cases: 84
validator_exit: 0
verification_rounds: 6
status: complete
---

# kiwi-planner --max 보고서 — v2.3.0.1 FR-FLOW-022~032 구현계획

## 1. 개요 / 범위
- **활성 target** `v2.3.0.1`. 계획 범위 = `status=planned` 11건(`FR-FLOW-022~032`, `REQ_FILTER` 한정) — implemented/verified 85건은 구현완료라 제외.
- 전부 **SKILL.md/에이전트-지침 요구**. 구현 = skills/{claude,codex,etc}/ SKILL.md 편집 + `test/skills/*.test.ts` content-assertion, **TDD red→green 페어**(FR-FLOW-014 kiwi-step 선례).
- plan_contract `1.2.0`, tdd_policy `relaxed`. **validator.mjs exit 0 (25검사 0/0)**.

## 2. 산출물
| 파일 | 내용 |
|---|---|
| `docs/plans/2026-07-10.speckiwi.v2301-flow.plan.md` | 계획 문서 (§1~§6) |
| `docs/plans/2026-07-10.speckiwi.v2301-flow.sidecar.json` | 사이드카 SSOT (6 phase / 23 task / 41 AC coverage / 84 test_case / 23 trace_link + 11 evidence mcp_call_log) |
| `docs/plans/2026-07-10.speckiwi.v2301-flow.validator.json` | validator 보고 (exit 0) |
| `docs/analysis/kiwi-planner-2026-07-10.speckiwi.v2301-flow/inventory.json` | REQ 인벤토리 |

## 3. Phase 구조 (의존성 순)
```
PH-001 Foundations: 022(단일모델·--mini 제거) + 025(--auto 위원회 3/5/7)
PH-002 kiwi-srs 연구루프 + planner 사이드브랜치: 023 + 031(workflow_* MCP) + 032(커버리지 루프)
PH-003 kiwi-srs 모호성 + kiwi-pipeline 코어: 024 + 026(5-stage 체인)
PH-004 kiwi-pipeline 확장: 027(worktree) + 028(github issue)
PH-005 kiwi-wave-master(신규): 029 + 030(epic)
PH-006 설치미러 sync + repo-wide 일관성 (file_op)
```
각 REQ = red(content 테스트 작성) → green(SKILL.md 편집) 페어, `depends_on_task`로 순서 강제. 커버리지 **11/11 REQ, 41/41 AC**(orphan 0, unreferenced 0).

## 4. --max 적대검증 (6 라운드, Opus×2+Sonnet×1/라운드, §0.2 격리)
각 라운드가 **서로 다른 실제 갭**을 포착·해소(오실레이션 아님):

| 라운드 | 포착 | 처리 |
|---|---|---|
| R1 | files[] 8/34 under-list, `npm test -- undefined` 보간버그, 030 산술 | ✅ |
| R2 | **`.agents/skills/` codex 미러 build-break**(3번째 mini-option.md, install-skill 드리프트) | ✅ **PH-006 신설** |
| R3 | **package-doctor `EXPECTED_KIWI_SKILLS` 미등록**(kiwi-wave-master) + 023/024 AC 실질 + 029 AC-4 skip-srs 통합 | ✅ (src/doctor 편집 + R-005) |
| R4 | **031 install-skill 토큰계약 보존**(get_next_work_order·workflow_pipeline_emit 등, 5-skill 계약) + PH-006 미러 over-reach + provider 검증 + AC 실질 + md_path 스키마 | ✅ (R-006, `-t "official workflow tools"` 게이트, 13-skill by-name 미러, md_sha256 정정) |
| R5 | plan.md↔사이드카 T-PH006-01 action drift(`install codex all` 잔존) | ✅ (사이드카 sync) |
| R6 | **clean** (cosmetic LOW만) | 수렴 |

**최종: 모든 CRITICAL/HIGH 해소, 라운드 6 clean.** 잔여 LOW(비차단): (a) plan↔사이드카 action 4건 cosmetic 문구차(backtick/trailing-slash, 의미 동일), (b) kiwi-pipeline/kiwi-srs의 PH-003/PH-004 편집에 per-task `-t` 토큰게이트 없음(PH-006 full test가 backstop), (c) tool-signature-parity.test.ts는 어느 task도 직접 실행 안 함(설계상 위반 없음).

## 5. Phase 5 — trace 영속화 (완료)
§0.11 실행: **23 add_trace_link**(Task→REQ, depends_on) + **11 add_verification_evidence**(type=plan, 각 REQ VE-1) = **34 mutation 전부 written:true**. `validate_spec` 0/0 재확인. (Status/Stability 무변경 — planner 권한 §0.13.)

## 6. 미해결 사용자 결정
- **OQ-030** (epic-research-skip): SRS 자체가 "provisional, pending user confirmation"으로 표시 → **FR-FLOW-030 구현 前 사용자 확인 체크포인트** 필요(사이드카 open_questions + needs_clarification 기록, blocks_task=false). 나머지 provisional 항목(024 임계값, 025 tie-break, 029 wave-split, 023/032 divergence)은 위원회식 default 채택(open_questions 기록).

## 7. 다음 단계
- `/kiwi-pm docs/plans/2026-07-10.speckiwi.v2301-flow.plan.md` — 23 Task를 kiwi-coder 서브에이전트로 순차 실행(TDD red→green). 착수 前 OQ-030 확인 권장.
- 구현 순서는 phase 의존성이 강제(025·022 foundation 먼저, 026 前 023/025, 029 前 026, 030 前 029).
- **미커밋**: feasibility + 이 plan 세트 + 34 SRS trace/evidence mutation 모두 커밋 대기(직전 지시대로 push 안 함).
