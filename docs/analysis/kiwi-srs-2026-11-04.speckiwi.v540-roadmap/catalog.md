# 5.4.0 로드맵 요구 목록

PRD: `docs/prd/2026-11-04.v530-wave-master-work-graph-roadmap.prd.md`. 범위는 PRD-25·26·27, 그리고 PRD-28 가운데 도구 공백 부분이다. PRD-29(대시보드 화면을 만들지 않음)는 제외 항목으로 지켰다. 모든 요구는 target 5.4.0, Status planned, Stability draft 다.

| 요구 ID | 제목 | 인용한 PRD 항목 | depends_on |
|---|---|---|---|
| FR-PARSE-046 | 로드맵 파서: `docs/roadmap.md` 를 순수 함수로 읽고 `ROADMAP-` 코드로 결함 보고 | PRD-25, PRD-26, PRD-27 | - |
| FR-PARSE-047 | 로드맵 문법과 진단 코드를 SRS-MD 규칙 부록에 둠 | PRD-26, PRD-27 | FR-PARSE-046 |
| FR-NODE-255 | 상태·AC 진행률·일정 상태를 SRS 와 로드맵에서 계산(as-of 입력) | PRD-25, PRD-27 | FR-PARSE-046, FR-PARSE-044 |
| FR-NODE-256 | add·update 쓰기: SRS 락·patch plan·dry-run, 필드마다 변경 이력 행 | PRD-25, PRD-26, PRD-27 | FR-PARSE-046 |
| FR-NODE-257 | sync: 빈 실제 날짜만 제안, `apply` 일 때만 쓰기, 항목 하나로 한정 가능 | PRD-25, PRD-27 | FR-NODE-255, FR-NODE-256 |
| FR-NODE-258 | target 이름 변경이 로드맵 `Targets` 참조도 같은 쓰기에서 바꿈 | PRD-28 | IR-CLI-112, FR-NODE-256 |
| IR-CLI-115 | CLI `speckiwi roadmap list·show·check·add·update·sync`, `--json` 출력 계약 `schema: 1` | PRD-25, PRD-27 (PRD-29 제외 유지) | FR-PARSE-046, FR-NODE-255, FR-NODE-256, FR-NODE-257 |
| IR-CLI-116 | 활성화하지 않고 target 을 planned 로 등록하는 CLI 명령 | PRD-28 | - |
| IR-MCP-009 | MCP 짝 6개: 읽기 셋은 `workspaceRoot` 를 받고 쓰기 셋은 거부 | PRD-25, PRD-27 | IR-CLI-115 |
| IR-MCP-010 | MCP `list_targets` (`speckiwi targets` 의 짝) | PRD-3, PRD-28 | - |
| FR-FLOW-224 | `kiwi-roadmap` 스킬: 맨 앞 10줄 핵심 규칙 넷, 추정 3,000 토큰 이하, 착수 시 `/kiwi-prd` 로 넘김 | PRD-3, PRD-5, PRD-25, PRD-27 | IR-MCP-009, FR-FLOW-225 |
| FR-FLOW-225 | `kiwi-prd` 가 `ROADMAP_ITEM` 을 다음 단계 안내에 싣고, `kiwi-srs` 가 새 target 을 그 항목에 연결 | PRD-3, PRD-25 | IR-MCP-009 |
| FR-FLOW-226 | `kiwi-wave-master` 가 run 시작과 끝에 해당 항목에만 `sync_roadmap_actuals` 적용 | PRD-3, PRD-27 | IR-MCP-009, FR-FLOW-212, FR-FLOW-222 |

## 범위 PRD 항목을 인용한 요구

| PRD 항목 | 인용한 요구 ID |
|---|---|
| PRD-25 기능 로드맵·마일스톤 기록과 조회 | FR-PARSE-046, FR-NODE-255, FR-NODE-256, FR-NODE-257, IR-CLI-115, IR-MCP-009, FR-FLOW-224, FR-FLOW-225 |
| PRD-26 로드맵은 SRS 처럼 구조화된 md | FR-PARSE-046, FR-PARSE-047, FR-NODE-256 |
| PRD-27 별도 target, `docs/roadmap.md`, `--json` 출력 계약, 계산 상태, 거친 날짜, 규칙 부록, 실제 날짜는 wave-master 가 기록, 도구 6개, `kiwi-roadmap` | FR-PARSE-046, FR-PARSE-047, FR-NODE-255, FR-NODE-256, FR-NODE-257, IR-CLI-115, IR-MCP-009, FR-FLOW-224, FR-FLOW-226 |
| PRD-28 발견한 도구 공백은 5.3.0 이후 target 에 기록 | FR-NODE-258, IR-CLI-116, IR-MCP-010 |

## 확인 결과

- `speckiwi prd coverage … --target 5.4.0`: ungroundedCriteria 0, uncitedRequirements 0. PRD-25~28 은 모두 인용됨(남은 미인용 항목 PRD-1~24 는 5.3.0 범위).
- `validate_spec`: 오류 0, 경고 17(모두 기존 SRS-W073). 이번 변경으로 생긴 진단 0.
- Active Target 은 그대로 5.2.0.
- 루트 `CLAUDE.md`·`agents.md` 의 "next tool-improvement target (currently 5.2.0)" 문구 수정은 IR-CLI-116 의 Implementation Notes 에 적음.
