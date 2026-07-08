# kiwi-review-fix-loop 보고 — FR-FLOW-014 (kiwi-step)

- **run_id**: 2026-07-08.speckiwi.self-kiwi-step
- **mode**: self, --auto --close-reqs FR-FLOW-014
- **scope**: FR-FLOW-014 구현 5개 파일 (src/doctor/package-doctor.ts + skills/{claude,codex,etc}/kiwi-step/SKILL.md + test/skills/kiwi-step-content.test.ts)

## 1. 리뷰(까칠 리뷰어, 독립 서브에이전트)

CRITICAL 0 / HIGH 1 / MEDIUM 3 / LOW 1:
- **FND-001 (HIGH)**: authoring 스킬인데 step 요구 작성 방법 미명시. step 전용 author 도구 부재 → `add_requirement`(body-scope) 오용 시 AC-2 위반 유발.
- **FND-002 (MED)**: 미존재 `kiwi-spec-merge`(=FR-FLOW-015 planned) 참조.
- **FND-003 (MED)**: AC-3 테스트 trivial(토큰 존재만).
- **FND-004 (MED)**: 테스트가 영어 키워드 강제 → 한국어 claude 변형에 영어 삽입 유발.
- **FND-005 (LOW)**: AC-2 금지 검사가 인접성만 확인.

## 2. 수정(시니어 fixer, 서브에이전트) — fix→verify 워크플로

- FND-001: 3 변형 §2.3/§4에 "step 전용 author 도구 없음 → Write/Edit 직접 작성, `add_requirement` 사용 금지" 명시.
- FND-002: `kiwi-spec-merge`를 [PLANNED](FR-FLOW-015)로 표기 + 현행 승격 수단은 `promote_step_requirement` MCP 도구.
- FND-003/004/005: 테스트를 언어중립·구조순서 기반으로 재작성(도구명/경로/구조 앵커, 한국어 금지·halt 어휘 허용, add_requirement 경고 assertion 추가). claude 변형의 삽입 영어를 자연스러운 한국어로 재작성(기술 토큰 유지).
- RED-first 확인(FND-001 assertion이 skill 편집 전 실패) 후 GREEN.

## 3. 적대적 재검증(독립 서브에이전트, §0.2 격리)

**PASS**: 5건 전부 해소, 코드베이스 대조 사실 검증(claim_step MCP-only, validate_step MCP+CLI, add_requirement body-scope, promote_step_requirement 실존, kiwi-spec-merge=FR-FLOW-015 planned). 0 CRITICAL / 0 HIGH. 잔존 LOW 1건(순서 검사가 frontmatter description 어순 검증) → **메인이 body 기준 순서 검사로 추가 강화**(frontmatter strip).

## 4. 회귀(스코프)

- package-doctor + content 테스트: **16/16 green**
- typecheck 0, lint 0

## 5. REQ close (Phase 7.5, --close-reqs)

§0.G7 게이트 통과 → FR-FLOW-014 **implemented → verified**:
- AC-1/2/3 체크, 증거 VE-2/VE-3/VE-4
- sync-index로 카운트 보정(verified 168), validate_spec 0/0

## 6. ⚠️ 범위 밖 (사용자 확인)

- **기존 실패 6건**(feat/2.3.0.1 HEAD, kiwi-step 무관): completed-work(FR-PARSE-021)/install-skill/srs-lock/stdio-purity/stdio-update-stability/smoke-package. FR-FLOW-014를 건드리지 않으므로 verified 판정에 영향 없음. Task #6 추적.
- **phantom-implemented**: FR-MCP-044(diff_steps)/FR-MCP-046(start_vibe_task) — FR-FLOW-015/018 보류의 원인. Task #5 추적.

## 7. 결과

FR-FLOW-014 (kiwi-step) = **verified**. 파이프라인 4단계(feasibility→planner→pm→review-fix-loop) 완주(스코프 B).
