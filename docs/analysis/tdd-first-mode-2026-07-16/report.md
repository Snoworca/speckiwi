# TDD First 모드 (v2.4.0) — SRS 등록·구현·검증 완료 보고서

| Field | Value |
|---|---|
| Date | 2026-07-16 |
| Target | v2.4.0 (신설; Active Target은 v2.3.0.1 유지 — 위원회 Q4:C) |
| Requirement IDs | FR-PARSE-032, FR-PARSE-033, FR-NODE-071~077, IR-CLI-071, IR-CLI-072, FR-FLOW-036, FR-FLOW-037, FR-MCP-052 |
| Status | 14/14 verified (per-REQ 증거 + AC 전수 체크) |
| Research Basis | docs/research/tddmode/00~04 (2026-07-16 심층 연구 + 3축 독립 검증) |

## 1. 무엇이 만들어졌나

`speckiwi mode tdd`로 켜는 **TDD First work-mode**: step 단위 작업이 "SDS(design.md) → red 테스트 → green 구현 → 회귀 → 후행 SRS 승격(증거 필수)" 사이클로 진행된다.

| 갭 | REQ | 구현 |
|---|---|---|
| G1 모드 확장 | FR-PARSE-032, FR-NODE-071, IR-CLI-071 | StepStateMode에 `tdd` (types/parser/work-mode/CLI validModes, Active Task vibe-parity) |
| G9 게이트 확장 (F1 CRITICAL 해소) | IR-CLI-072, FR-NODE-072 | vibe-gate가 tdd 발동(+design.md 검사), 완료 하드게이트 tdd enforced |
| G2 SDS 표준 | FR-FLOW-036 | docs/rule/SDS-MD-Rules-v1.0.0.md (7 필수 헤딩, EARS SDS-AC, 200줄 캡, 생략 게이트, 템플릿) |
| G3 합성 입력 | FR-NODE-073 | synthesizeStepSrs가 design.md를 `## Design` 섹션으로 병합(리댁션 적용) |
| G4 증거 게이트 | FR-NODE-074 | promote가 tdd 모드에서 증거 0건 승격을 EVIDENCE_REQUIRED로 거부(비-tdd는 advisory) |
| G6 스니펫 v1.5 | FR-NODE-075 | AGENT_INSTRUCTION_VERSION 1.5 + tdd 워크플로·3게이트·sdd 경계 문단; 저장소 자체 CLAUDE.md/agents.md/90.appendix.md 동기화 |
| G7 SDS 검증 | FR-PARSE-033 | validate_step(CLI/MCP)에 SDS-W050~W053 advisory (tdd 모드 한정) |
| G8 스킬 | FR-FLOW-037 | kiwi-tdd 스킬 3변형(claude/codex/etc) + package-doctor 등록 |
| MCP 토글 (사용자 후속 요구) | FR-MCP-052 | `get_work_mode`(read-only, fail-open wait) + `set_work_mode`(workspace mutation, INVALID_MODE 가드, dryRun) — MCP만으로 TDD 모드 on/off 가능. 부록 도구표(REL-FLOW-002 패리티) + kiwi-tdd 스킬 MCP-우선 갱신 |
| init SDS 규칙 설치 (사용자 후속 요구) | FR-NODE-076 | init이 번들 `docs/rule/SDS-MD-Rules-v1.0.0.md`를 writeIfMissing으로 설치 + npm files 화이트리스트 패키징 — 스니펫이 참조하는 SDS 규칙의 실체 보장 |
| 스니펫 v1.6 (사용자 후속 요구) | FR-NODE-077 | work-mode 문단 MCP-우선(get/set_work_mode + CLI fallback) + **모드 전환 안내**(임의 전환, sdd/wait 전환 시 Active Task 자동 제거, INVALID_MODE 거부) + 설치된 SDS 규칙 경로 인용. v1.5→v1.6 멱등 upsert |

## 2. 검증

| 항목 | 결과 |
|---|---|
| TDD 규율 | 11 REQ 전부 red 확인 후 green (신규 테스트 12파일 / 53케이스) |
| 전체 스위트 | **192 파일 / 1220 pass / 1 skip / 0 fail** (FR-NODE-076/077 포함 최종; 기준 177/1156 대비 0 회귀) |
| typecheck / lint / validate | 모두 0 오류 (`--max-warnings=0`, `--fail-on-warning`) |
| 독립 검증자 A (SRS 의도) | **ALL_MATCH** — 43 AC 중 42 MATCH, LOW 1건(FR-FLOW-036 AC-4 테스트 부재) → 즉시 보강 완료 |
| 독립 검증자 B (코드 품질) | **PASS** — CRITICAL/HIGH 0, MEDIUM 1(선재 패턴)·LOW 4 |
| 5인 결정위원회 | Q1(enum+G9) 5:0 / Q2(steps design.md) 5:0 / Q3(sdd 경계) 5:0 / Q4(target C) 3:2 / Q5(MVP+G8) 4:1 |

## 3. 검증자 지적 반영 내역

- **A/LOW-1**: FR-FLOW-036 AC-4 전용 assertion 추가 (test/docs/sds-md-rules.fr-flow-036.test.ts) — 4/4 green.
- **B/MEDIUM**: evaluateVibeCompletionGate가 production 미배선(vibe도 동일한 선재 FR-NODE-058 패턴) — FR-NODE-072 Implementation Notes에 기록, 완료 mutation 배선은 후속 과제.
- **B/LOW(도그푸딩 드리프트)**: 저장소 자체 CLAUDE.md·agents.md 관리 블록을 v1.5로 수술적 교체 완료 (F3 원자 배포).
- **B/LOW(잔여, 후속)**: loadStepDesign stepName 경로 미정규화(선재 stepPathSegment와 동일 패턴, read-only advisory 한정), SDS 헤딩 부분일치 매칭(advisory 전용 허용), `let advisories` 스타일.

## 4. 후속 과제 (미착수, 연구 문서 00 §9 잔여)

- **G5** diff_steps MCP/CLI 재노출 (tdd↔sdd 충돌 사전 경고) — 후속
- **G10** SidecarTask tdd 필드 런타임 모델링 + red/green evidence 강제 — 후속
- 완료 하드게이트의 completion mutation 배선 (B/MEDIUM 후속)
- FR-NODE-051·FR-FLOW-016의 AC 본문 내 v1.4 리터럴은 당시 상태 서술로 존치 (FR-FLOW-016 AC-2가 bump 계약을 명시)

## 5. 사용법 (요약)

```
speckiwi mode tdd                          # 모드 켜기 (CLI)
MCP set_work_mode {mode:"tdd"}             # 모드 켜기 (MCP) / get_work_mode 로 조회
/kiwi-tdd <task>                           # SDS → red → green → 회귀 → promote 오케스트레이션
speckiwi step validate <t>                 # SDS advisory (SDS-W050~053)
speckiwi vibe-gate check                   # CI 게이트 (합성 + design.md)
```

미커밋 상태 — 커밋/푸시는 사용자 지시 대기.
