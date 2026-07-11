---
run_id: 2026-07-11.speckiwi.2axis-2301flow
kind: 2-axis-eval (SRS-intent-match + quality)
target: v2.3.0.1
generated_at: 2026-07-10T20:37:31.240Z
axis_a_final: ALL_MATCH (11/11 full)
axis_b_final: substantive_clean=true, clean=true
fix_rounds: 7
verdict: CONVERGED
---

# 2축 평가 루프 최종 보고서 — v2.3.0.1 FR-FLOW-022~032

사용자 목표: (A) SRS 원래 의도 ↔ 코드/결과물 일치 평가 + (B) 품질 리뷰(2축, 독립 서브에이전트) → 문제 개선 → 재평가 → 개선사항 0까지 반복 → 종료.

## 1. 최종 결과 (수렴)
- **Axis A (SRS 의도 일치)**: ALL_MATCH — 11개 REQ 전부 full intent match (r6·r7·r8 3연속). 모든 SHALL/AC 가 스킬 지침에 실제 실현(키워드 아님).
- **Axis B (품질)**: substantive_clean=true, gate PASS. substantive/cosmetic/out-of-scope 신규 잔여 0.
- **회귀**: test/skills 148/148, install-skill 17/17, 전체 스위트 신규 실패 0 (잔여 2건 srs-lock/release-readiness 는 사전존재 parallel-load flaky, 격리 시 pass).

## 2. 라운드별 수렴 (7 fix 라운드)

| R | Axis A | Axis B new | 처리 |
|---|---|---|---|
| 1 | ALL_MATCH(1 LOW hist) | 10 (M4/L6) | QB-001~010 fixed |
| 2 | ALL_MATCH | 3 new (M1/L2) | QB-101~103 fixed |
| 3 | ALL_MATCH | 2 new (L) | QB-201/202 fixed |
| 4 | ALL_MATCH | 1 new (M, QB-203) | QB-203 fixed (etc auto-option 구모델 sweep) |
| 5 (A r3/r4) | **GAPS: FR-FLOW-022 partial** | QB-204 (HIGH) + QB-205 (defer) | **FR-FLOW-022 AC-2 완성** (5스킬 이중모델표→단일) + local-llm-profile 위원회 정합 + 테스트 확장 |
| 6 | GAPS→ hot-fix §0.10↔§1.3 | QB-206 (M) | hot-fix 역할-모델 선례 기반 정합 + 테스트 정교화 |
| 7 | ALL_MATCH | QB-207/208 + F-R6 | 검증자 라벨 hygiene (Opus 시니어 저작 유지) |
| 8 | ALL_MATCH | QB-209 (M subst) + 210 | etc single-worker 병렬→순차 재작성 |
| 9 (final) | **ALL_MATCH** | **substantive 0 — clean** | 종료 |

## 3. 2축 루프가 포착한 핵심 결함 (이전 패스가 놓친 것)
- **FR-FLOW-022 AC-2 미완 (가장 중요)**: 원 구현(T-PH001-02)이 각 스킬 §0.x SSOT/frontmatter 는 고쳤으나 **운영 평가자 토폴로지 표**(kiwi-srs §10.3/10.4, feasibility §8.4, from-code §8.1, review-fix-loop/hot-fix §1.3)를 누락 → 스킬이 자기 SSOT 와 모순. content 테스트 AC-2 가 좁게 검사한 사각지대 + review-fix-loop 3라운드·Axis A r1/r2 도 못 잡음. **Axis A 심층 read(r3)가 포착** → AC-2 를 5개 스킬에 완성 + 확장 테스트로 repo-wide 고정(section-scoped 정밀매칭, cheap-fixed Sonnet 허용).
- **QB-204 (HIGH)**: FR-FLOW-025 위원회 리팩터가 동반 SSOT `local-llm-profile.md`(31곳 참조)를 놓쳐 etc 에서 위원회 무력화(false-green). 정합.
- **QB-209 (substantive)**: FR-FLOW-023/024/028 이 etc(single-worker) 변형에 병렬-팬아웃 문구를 복사 → etc SSOT/금칙토큰 위반. 순차 어휘로 재작성(SRS N-조사 의도 순차 실행으로 보존).

## 4. 결정 (위원회 규칙 적용)
- **hot-fix §0.10↔§1.3 역할-모델 방향 대립** (Axis A: §0.10 오류 / Axis B: §1.3 오류): kiwi-coder 선례(§0.16/§1.3 line147 — 정형검사=현재세션, TDD=Sonnet)가 객관 사실로 두 축을 결정론적 reconcile → 정형검사·까칠리뷰·fixer=현재세션 / root-cause·TDD=Sonnet. **위원회 생략(규칙 예외: 명백한 권장안)**, fixer 독립 선례 검증 후 적용.

## 5. 미해결(문서화, 이 루프 밖) — 사용자 후속 결정
1. **[TOOLING-GAP]** `speckiwi skills install` 이 `_shared/kiwi/*` 를 .agents 미러에 복사 안 함 → 수동 cp 회피. **v2.3.0.x 신규 SRS 후보**.
2. **[SRS-SUGGESTION FR-FLOW-024]** `-qna`(단일대시 강제) vs `--qna`(deprecated) footgun → 향후 강제 플래그 리네임(--qna-force 등) 검토.
3. **[SRS-SUGGESTION FR-FLOW-029]** kiwi-wave-master `--wt` 근거 부재로 제거 → wave별 워크트리 원하면 FR-FLOW-029 AC 에 전파 동작 추가 후 재도입.
4. **[OUT-OF-SCOPE-DEFER]** kiwi-hot-fix→kiwi-srs-sync 전파: claude `--auto-apply --yes-all` 합성 vs codex/etc 금지 (안전게이트 parity, 사전존재) → business-decision, v2.3.0.1 밖. 후속 SRS 후보.
5. **[역사적]** skills/{codex,etc}/MIGRATION_PLAN.md 의 --mini/mini-option/--squirrel 참조는 과거 마이그레이션 기록(비-dangling) → 미변경(history 보존).

## 6. 산출물
- axis_a_intent_r{1,3,5,6,7,8}.json / axis_b_quality_r{1..8}.json — 라운드별 평가
- fix_round{1..7}.json — 라운드별 개선
- worklog.jsonl
