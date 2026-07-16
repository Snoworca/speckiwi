# SDS 도구 갭(G1~G10) 구현 완료 보고서

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-07-16 |
| 근거 문서 | docs/research/tddmode/05.sds-tooling-gaps.md |
| Target | v2.4.0 |
| Requirement IDs | IR-CLI-073, IR-CLI-074, FR-MCP-053, FR-MCP-054, FR-NODE-078~083, FR-FLOW-038 (11건 전부 **verified**) |
| 최종 스위트 | 203 파일 / 1271 pass / 1 skip / **0 fail** · typecheck·lint·validate 클린 |
| 커밋 상태 | **미커밋** — 커밋/푸시는 사용자 지시 대기 |

---

## 1. 배경 — 무엇이 문제였나 (쉬운 설명)

SpecKiwi에는 최근 "**TDD 모드**"가 추가되었습니다. 설계 문서(SDS, `design.md`)를 먼저 쓰고 → 실패하는 테스트를 만들고 → 구현하고 → 마지막에 요구사항 문서(SRS)로 승격하는 작업 방식입니다.

그런데 이 사이클을 실제로 돌려 보니, **"기능은 만들어져 있는데 쓸 수 있는 버튼이 없는"** 구간이 여러 곳 있었습니다. 비유하면 엘리베이터는 설치했는데 호출 버튼을 안 단 층이 있었던 겁니다. 연구 문서(05.sds-tooling-gaps.md)가 이런 구멍 10개를 G1~G10으로 정리했고, 이번 작업이 그중 9개를 구현했습니다(G4는 별도 설계가 먼저 필요해 보류).

## 2. 문제 → 해결 (갭별)

### G1 — 합성 엔진에 버튼이 없었다
- **문제**: step 산출물을 SRS 문서로 합쳐 주는 `synthesizeStepSrs` 함수는 테스트까지 끝난 완성품인데, CLI에도 MCP에도 노출이 안 돼 **아무도 호출할 수 없었습니다**. 에이전트는 매번 손으로 SRS를 정리해야 했습니다.
- **해결**: CLI `speckiwi step synthesize <task>` 와 MCP 도구 `synthesize_step_srs`를 추가했습니다. 이미 결과물이 있으면 아무것도 안 하는(멱등) 안전한 동작 그대로입니다.

### G2 — MCP가 없으면 TDD 사이클을 시작조차 못 했다
- **문제**: step을 선점(claim)·상태변경·승격하는 3개 도구가 **MCP 전용**이었습니다. MCP 서버가 없는 환경에서는 TDD 사이클 진입 자체가 불가능 — "MCP 없으면 CLI로 대신한다"는 이 저장소의 원칙과 모순이었습니다.
- **해결**: CLI 명령 3종(`step claim` / `step update-state` / `step promote`)을 추가했습니다. 내부 도구 장부(레지스트리)에서도 이 3개 MCP 도구를 엉뚱한 명령에 얹어 두던 임시 조치를 걷어내고 제자리(새 step 명령)로 옮겼습니다.

### G3 — "완료 검문소"가 만들어만 놓고 연결이 안 돼 있었다
- **문제**: "모순되는 요구사항이 남아 있으면 step을 merged(완료)로 바꾸면 안 된다"는 검문 함수가 있었지만, **실제 완료 처리 코드가 이 함수를 한 번도 호출하지 않았습니다**. 검문소를 지어 놓고 도로를 안 낸 상태였죠.
- **해결**: step을 merged로 바꿀 때(vibe/tdd 모드 한정) 그 step이 건드린 요구사항 범위의 미해결 모순을 검사해 `COMPLETION_GATE_BLOCKED`로 막도록 연결했습니다. 정말 넘어가야 할 때는 `acknowledged` 옵션으로 명시적으로만 통과할 수 있습니다.

### G5 — 설계 문서(SDS)의 존재를 아무 조회 도구도 보여주지 않았다
- **해결**: `list_steps` 결과에 step별 `sdsPresent`(design.md 존재 여부)와 `sdsStatus`(draft/agreed/superseded)를 추가했습니다. 이제 에이전트가 파일을 뒤지지 않아도 SDS 상태가 보입니다.

### G6 — 게이트 상태를 MCP로 확인할 방법이 없었다
- **문제**: 완료 전 점검 명령 `vibe-gate check`가 CLI 안에만 박혀 있어, MCP만 쓰는 에이전트는 자기 상태를 확인할 수 없었습니다.
- **해결**: 검사 로직을 core 함수로 추출해 CLI와 새 읽기 전용 MCP 도구 `check_vibe_gate`가 **같은 코드를 공유**하게 했습니다. CLI 동작은 그대로입니다.

### G7 — SDS 템플릿을 매번 손으로 복사해야 했다
- **해결**: `speckiwi step scaffold <task>`(MCP `scaffold_step`)가 design.md·intent.md **빈 뼈대**를 만들어 줍니다. 이미 있는 파일은 절대 덮어쓰지 않고(writeIfMissing), 템플릿의 필수 제목 7개는 검증기와 같은 상수를 공유해 어긋날 수 없습니다. **내용은 여전히 직접 작성**합니다 — 스캐폴드는 골격만 만듭니다.

### G8 — SDS 상태(draft→agreed→superseded)를 손으로 고쳐야 했다
- **해결**: `speckiwi step sds-status <task> <status>`(MCP `set_sds_status`)를 추가했습니다. 앞으로만 가는(forward-only) 상태머신을 강제해서, 예를 들어 agreed를 draft로 되돌리는 잘못된 전이는 `INVALID_SDS_TRANSITION`으로 거부됩니다.

### G9 — doctor가 SDS 규칙 문서의 존재를 몰랐다
- **해결**: `speckiwi doctor`가 `docs/rule/SDS-MD-Rules-v1.0.0.md` 설치 여부를 검사해, 없으면 "speckiwi init을 실행하라"는 경고를 줍니다. (위원회 결정에 따라 버전 추적 없이 존재 확인만 — 인덱스 문서는 건드리지 않습니다.)

### G10 — codex용 스킬 미러가 소스보다 뒤처져 있었다
- **문제**: `.agents/skills`(codex 에이전트용 복사본)에 kiwi-step·kiwi-tdd·kiwi-wave-master가 빠져 있었습니다. 소스는 갱신됐는데 복사본을 다시 안 만든, 조용한 드리프트였습니다.
- **해결**: ① `speckiwi skills install codex all`로 미러를 재생성(16개 스킬 동기화). ② 같은 문제가 또 조용히 생기지 않도록 doctor에 **미러↔소스 일치 검사**를 신설했습니다. 기대 목록은 하드코딩이 아니라 소스 폴더를 스캔해서 뽑으므로, 스킬이 새로 추가되면 코드 수정 없이 자동으로 감시 대상이 됩니다.

### FR-FLOW-038 — 스킬 설명서가 거짓말하지 않도록
새 도구가 생기면서 kiwi-step/kiwi-tdd 스킬 문서의 "step 저작 도구는 없다", "claim은 MCP 전용" 같은 문장이 낡은 사실이 되었습니다. 3개 변형(claude/codex/etc) 전부를 "스캐폴드는 뼈대만, 내용은 직접 저작", "MCP 우선 + CLI fallback"으로 고치고 콘텐츠 테스트도 함께 갱신했습니다.

### 보류 — G4 (오케스트레이터 통합)
kiwi-pm/planner가 work-mode를 읽고 tdd로 자동 라우팅하는 건 `tdd_policy`와 work-mode의 **개념 통합 설계가 먼저** 필요해, 5인 결정위원회(4:1)가 별도 설계 패스로 보류했습니다.

## 3. 어떻게 일했나 (과정)

1. **조사**: 독립 조사 에이전트 3기가 갭별 구현 표면을 file:line 단위로 확인 — 여기서 "강제 테스트 3종"(CLI 이름 장부 일치, 24개 도구 계약, 부록 등재)이라는 지뢰를 미리 파악해 한 번도 밟지 않았습니다.
2. **결정**: 갈림길 6개(D1~D6)를 5인 결정위원회가 서로 다른 관점(아키텍처·리스크·가치·유지보수·거버넌스)에서 투표로 확정.
3. **SRS 등록**: 요구사항 11건을 v2.4.0에 등록. (등록 직후 `proposed`가 이 룰셋에서 유효하지 않은 상태값이라는 걸 검증기가 잡아 `planned`로 정정 — 검증기가 제 역할을 한 사례.)
4. **TDD 구현**: 요구사항마다 **실패하는 테스트를 먼저** 작성하고 빨간불(red)을 확인한 뒤 구현해 초록불(green)로 — 신규 테스트 10파일/47케이스 + 스킬 콘텐츠 스위트.
5. **독립 검증 2축**: 제 결론을 전달하지 않은 검증자 2기가 별도로 검사.
   - 검증A(SRS 의도 일치): **ALL_MATCH** — 11건 전 AC 충족, 테스트 약화 0건.
   - 검증B(코드 품질): **PASS** — CRITICAL/HIGH 0.
6. **지적사항 수정 후 재검증** (개선-재검증 루프):
   - MEDIUM: `list_steps`가 step마다 순차로 파일을 읽던 것 → 병렬(Promise.all)로 수정.
   - LOW: `set_sds_status`에 경로 탈출(traversal) 가드 추가(`INVALID_STEP_NAME`).
   - LOW: 미러 비교가 줄바꿈(CRLF/LF) 차이만으로 오탐하던 것 → 정규화 후 비교.
   - LOW: `--depends-on` CLI 경로 테스트 커버리지 공백 → 케이스 추가.
   - 각 수정은 실패 테스트 추가 → red 확인 → 수정 → green 순서로, 이후 전체 스위트 재통과.

## 4. 결과 수치

| 항목 | 값 |
|---|---|
| verified 요구사항 | 11 / 11 |
| 신규 MCP 도구 | 4 (`synthesize_step_srs`, `check_vibe_gate`, `scaffold_step`, `set_sds_status`) — 총 70개 |
| 신규 CLI 명령 | 6 (`step synthesize/claim/update-state/promote/scaffold/sds-status`) |
| 신규 테스트 | 10파일 47케이스 + FLOW 콘텐츠 스위트 (전부 red→green) |
| 전체 회귀 | 203파일 / 1271 pass / 0 fail (0 회귀) |
| dogfood doctor | SDS rules ok · Codex mirror in sync(16 skills) |

## 5. 남은 것

- **커밋/푸시**: 전체 변경이 워킹트리에 미커밋 상태 — 사용자 지시 대기.
- **G4**: planner `tdd_policy` ↔ work-mode `tdd` 개념 통합 설계 후 별도 진행.
- 경미한 후속 후보: FR-MCP-054 AC-4의 스위트 인용 표기(ir-cli-031 파일명 vs IR-CLI-049 REQ 코드), 미러 doctor 검사의 실제 번들 경로 분기 통합 테스트.
