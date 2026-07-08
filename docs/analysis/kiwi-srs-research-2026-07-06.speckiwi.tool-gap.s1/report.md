# SpecKiwi 도구 갭 심층 조사 보고서 (kiwi-srs-research)

| 항목 | 값 |
|---|---|
| run-id | 2026-07-06.speckiwi.tool-gap.s1 |
| 모드 | standalone (질문-전용 입력, REQ mutation 0건) |
| 연구 질문 | SpecKiwi v2.3.0 완료 시점 기준, 실사용 관점에서 더 필요한 기능 또는 도구 갭 심층 조사 (CLI/MCP/진단/워크플로/스킬 전반) |
| 토폴로지 | Sonnet×1 Triage + Opus×3 Researchers(격리) + Opus×1 Synthesizer + 의역 detector 2축(Sonnet/Opus) |
| 근거 검증 | source_quotes literal match **32/32 PASS** · 의역 detector 분기 2건(아래 §6) |
| 기준 상태 | v2.3.0: 72 REQ = 54 verified + 18 discarded, blocked 0, missingEvidence 0 |

## 1. 한 줄 결론

> v2.3.0은 workflow-read/lock/collision-repair 갭을 실제로 shipped했으나, 잔존 실사용 갭의 핵심은 **granular 필드편집 · 신뢰성 있는 result/error 봉투 · batch 등록 · doctor 통합(landmine 포함) · 양방향 traceability**이며, 최우선(P1)은 **hand-edit 우회를 없애는 구조적 편집 도구와 미커밋 WIP 거버넌스**다.

## 2. P1 — 최우선 갭 (합의, 증거 강함)

| # | 갭 | 범주 | v3 계획 중복 | 제안 도구/기능 | 핵심 증거 |
|---|---|---|---|---|---|
| 1 | **Granular 구조필드 편집 부재** — AC/Tags/Related Docs/Priority를 안전하게 고칠 mutation이 없어 스킬이 SRS-MD를 직접 hand-edit (실사용 로그에 반복 축적) | core | partial (FR-NODE-019 트랙) | `edit_acceptance_criteria`(add/update/delete/reorder), `update_tags`, `update_related_docs`(링크 정규화), `set_priority`(값 검증) | `kiwi/pipeline.jsonl:4,14,16`, `fix-priority.mjs:16` |
| 2 | **Result/error 봉투 신뢰성 부족** — CLI read 실패가 JSON이 아닌 stderr 프로즈, mutation payload 비일관 → bulk 스크립트가 ERR/PARSE fallback 자체 구현 | cli | partial | 버전드 `--json` 계약 + exit-code taxonomy + 모든 실패를 JSON 봉투(안정 SRS-E코드 + next-action hint)로 | `register-p0p1.mjs:35-38`, 09.md:145,203 |
| 3 | **Doctor taxonomy 파편화** — 3종 doctor(package-smoke/workflow/미배선 env-health)가 상이한 어휘·동명이의 인터페이스, `diagnoseHealth`는 어디서도 import 안 됨, **동일 `speckiwi doctor --json`을 상호배타 계약으로 검증하는 landmine 테스트 상존** | diagnostics | partial | `speckiwi doctor --scope env\|package\|workflow\|--all` + 공유 HealthCheck 타입 + landmine 정리 + install/update 실패모드 점검 | `src/cli/commands/doctor.ts:3-14`, `src/core/health/doctor.ts:291-305` |
| 4 | **양방향 traceability/self-audit 부재** — links check가 forward만 검증(scope creep 놓침), verified REQ의 @req 태그가 tracked source에 있는지 검증 불가, mutation↔REQ↔CLI↔MCP 매핑 없음 | diagnostics | net-new | links check 양방향 확장(orphaned REQ + orphaned trace target) + self-audit trace matrix 커맨드 | Ketryx RTM, code findings[13] |
| 5 | **ToolSpec 단일 SSOT 미완성** — ToolSpec.args가 CLI positionals와 불일치(FND-001), `--input-json`이 mutation 22개에만 한정 | core | partial | ToolSpec에 positional 포함(단일 SSOT) + `--input-json`/`--help --json`을 read/workflow 커맨드 전체로 확장 | `src/cli/input-json.ts:13-17` |
| 6 | **Lock 관찰/해제 표면 부재** — stale lock에 `--ignore-lock` 외 수단 없음, 병렬 pm 하 30+ mutation의 락 커버리지 미검증 | governance | net-new | `speckiwi lock status\|release`(+MCP) + concurrency lock coverage audit + 다중프로세스 경합 테스트 | `srs-lock.ts:9-13,36-60` |
| 7 | **미커밋 WIP 거버넌스** — v3.0.0 산출물 대량 untracked → 유실 위험 + '이미 계획됨' 오분류 위험 (본 조사의 분류 신뢰성에도 영향) | governance | net-new | doctor에 untracked SRS/계획 산출물 경고 + shipped-vs-WIP 경계 커밋 선행 | git status 142 untracked |

## 3. P2 — 차순위 갭

| # | 갭 | 범주 | 제안 |
|---|---|---|---|
| 8 | Batch/bulk REQ 등록 부재 (50+ REQ 등록에 ad-hoc .mjs 드라이버 작성됨) | mcp | guarded batch `add_requirements` + atomic register-with-dependencies(제목→신규ID 해소) + 멱등 재실행 |
| 9 | CLI↔MCP parity 자동 대조 부재 + server.ts 540줄 monolith(churn 1위) | mcp | 파리티 진단(SRS-W) + 스키마 colocate 분할 |
| 10 | 실사용 실패경로 harness 부재 (verified ≠ 실사용검증 — coverage theater 위험) | workflow | 동시 mutation·MCP-down fallback·malformed SRS 복구 골든패스 통합테스트 |
| 11 | MCP 결과 품질 업계 baseline 미달 (structuredContent/outputSchema/annotations/elicitation/pagination) | mcp | MCP 2025-06 스펙 기능 채택 |
| 12 | Stability 성숙도 미달 (71 evolving / 1 stable) + 단건 저위험 승급도 NEEDS_USER로 자동화 중단 | workflow | `speckiwi stabilize` target-wide 승급 게이트 + 저위험 policy/auto-approve |

**v2.3-done 확인**: pipeline.jsonl read 표면(status/tail/next/compact/session/worklog/doctor/diff/schema-check)은 CLI/MCP parity로 실제 shipped — 잔존 과제는 kiwi-* 스킬이 raw-parse 대신 공식 리더를 쓰도록 마이그레이션(MIG-FLOW-003/004 연장)뿐.

## 4. 이견 (dissent, 보존)

- **pipeline SSOT**: Opus A "read 도구 갭은 해소됨(largely closed)" vs Opus C "pm-state·.kiwi 병존으로 재개 시 상태 분기 위험 미검증" — 서로 다른 축(read-tooling vs state-model)이므로 둘 다 참일 수 있음 → **추가 실측 연구 권장** (병렬 재개 divergence 테스트).

## 5. 미해결 질문

1. pipeline.jsonl ↔ pm-state 실제 divergence 여부 (실측 필요)
2. 진단 비용의 REQ 72→206 스케일 특성 (미검증, low confidence)
3. mutation 모듈 dead code / skill-string-only 참조 실존 여부
4. EARS-form AC lint 채택 가치 (외부 단일 스트림 제안)
5. `--fields/--brief` 출력 축소 모드의 실효성 (추측 단계)

## 6. 검증 상태 및 주의

- literal match 32/32 PASS (결정적 검증). 의역 detector **분기 2건**: consensus[0](Related Docs/Priority 부분), consensus[11](TextContent/elicitation 부분) — Sonnet은 quote 미첨부를 지적, Opus는 faithful 판정. 두 건 모두 누락 quote가 raw 파일에 실존함을 경로로 확인(`paraphrase-verdicts.json`). **자동 detector 통과가 100% 무결성 보증은 아니므로 1-2건 sampling 검토 권장.**
- `aux-docs-gap-inventory`의 already_planned 분류는 2026-06-17 v3 plan 기준으로 stale → Synthesizer가 shipped-code 관찰 기준으로 재분류함.

## 7. 부록 — 세션 중 즉시 처리된 갭 (별도 사용자 지시)

본 조사와 병행하여 사용자 지시("mcp에 root 파라미터 제거")로 **IR-CLI-045 / REL-MCP-004**가 신규 등록·구현됨: `speckiwi mcp`의 `--root` 전면 제거(usage 오류 exit 2), `McpServerOptions.root` 제거, rootSource explicit 분기 제거(cwd-discovery 전용), IR-CLI-017·REL-MCP-003 supersede+discard, README/appendix 갱신. 상세는 커밋 및 SRS Change Notes 참조.

## 8. 산출물

- `research-summary.json` — 13 consensus + 1 dissent (source_quotes 포함)
- `research-raw/` — code/external/risk + aux 2종
- `paraphrase-verdicts.json`, `quote-verification.json`, `triage.json`, `preflight.json`, `run-mode.json`
