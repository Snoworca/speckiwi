---
name: kiwi-review-fix-loop
description: "코드 리뷰 → 수정 → 재리뷰 루프를 자동으로 돌리는 스킬. **코드 전용** — 산문 문서(`SKILL.md` · `README` · SRS · 연구 노트)는 리뷰도 수정도 하지 않는다(§11). **셀프 리뷰가 기본** — 까칠 리뷰어 서브에이전트가 working tree 변경분(git status)을 분석. `--pr`/`-pr`/`--PR`/`-PR` 옵션 또는 사용자가 'PR 리뷰 읽고 수정' 명시 시 GitHub PR 모드 전환(`gh pr view --comments`). **코드 리뷰와 코드 개선은 반드시 서브에이전트로 수행**(메인 직접 수정 절대 금지). Finding 4분류(즉시수정/선언된 한계/논의필요/거절+사유) + TDD 회귀 테스트 + 시니어 fixer + 까칠 리뷰어 재검증 루프 + keep/drop 종료 게이트(차단 kept finding 0 — 기록 finding 은 통과를 막지 않음) + 회귀 PASS 의무. 트리거 — kiwi review fix loop, 리뷰 루프, 리뷰 수정 루프, 셀프 리뷰, 코드 리뷰해줘, 셀프 코드 리뷰, review fix, self review, code review loop, 리뷰 자동 적용, PR 리뷰 읽고 수정, PR 코멘트 적용, gh pr review fix, pr 응답, 머지 전 셀프 리뷰, 품질 게이트 돌려줘. --pr/-pr/--PR/-PR 로 PR 모드 활성. 검증(까칠 리뷰어·분류기·정형 검사) 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 override 한다(시니어 fixer 는 영향 없음). --max 로 검증 강도(뮤테이션·적대적 실행) 승격(리뷰어는 전 모드 1개). --auto 로 사용자 게이트 자동 진행(keep/drop 가드레일). --no-respond 로 PR 모드에서 PR 코멘트 응답 skip. --close-reqs 로 회귀 PASS + finding 0건 시 영향 REQ status를 implemented→verified 전이 + verification evidence 등록 (셀프 모드 전용, 기본 off)."
---

> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

# kiwi-review-fix-loop

코드 리뷰-수정-재리뷰 자동화 스킬. 두 가지 모드:

- **셀프 모드 (기본)**: 까칠 리뷰어 서브에이전트가 현재 working tree 변경분 (또는 지정 범위) 을 리뷰 → 즉시수정 항목 자동 수정 → 재리뷰 → 통과까지 반복. 머지 전 품질 게이트, 외부 PR 흡수 후 정리, 레거시 코드 정합화 등에 사용.
- **PR 모드 (`--pr` 옵션 또는 사용자 명시)**: GitHub PR 의 리뷰 코멘트를 `gh pr view --comments` 로 수집 → 분류 → 즉시수정 항목 자동 수정 → 재리뷰 → (선택) PR 응답 코멘트 → 통과까지 반복. 동료 리뷰 응답 자동화.

본 스킬의 핵심 원칙: **코드 리뷰와 코드 개선은 반드시 별도 서브에이전트로 spawn** (§0.1). 메인 세션이 직접 리뷰하거나 직접 수정하는 행위는 모든 모드에서 금지.

---

## 클린 코드 라운드 — 컴팩션 뒤에도 남는 규칙 (FR-FLOW-206)

이 블록은 아래 본문보다 앞선다. 본문의 어느 절도 이 블록의 규칙을 건너뛰게 하지 않는다.

**분류.** 리뷰어는 중복·과도 추상화·명명·함수나 클래스 크기·책임 혼재·죽은 코드 지적을 keep/drop 판정과 따로 `clean-code` 분류로 보고하고, 지적마다 어긴 원칙과 코드 위치(파일·줄)를 적는다. `clean-code` 지적은 kept finding 수에 들어가지 않고 keep/drop 종료 게이트(kept finding 0)를 막지 않으며, `dismissed` 나 `unresolved` 가 남아도 실행의 종료 상태를 바꾸지 않는다.

**라운드.** fixer 는 `clean-code` 지적을 한 실행에서 클린 코드 라운드 **최대 3회** 안에서 고친다 — 라운드 하나는 리뷰어의 `clean-code` 지적, 분류기의 `dismissed` 표시, fixer 의 수정, 보존 스캔, 회귀 테스트 확인을 이 순서로 한 번씩 거친다. 클린 코드 라운드는 기능 결함 루프가 끝난 뒤에 돌고, 라운드를 시작하는 리뷰가 `clean-code` 지적을 하나도 내지 않으면 그 라운드에서 바로 끝난다. 리뷰어에게는 앞선 라운드에서 `dismissed` 된 지적 목록을 함께 넘기고, 이미 `dismissed` 된 지적과 같은 원칙·같은 위치를 다시 낸 지적은 그 라운드의 지적으로 세지 않는다 — 그런 지적만 나온 라운드도 그 라운드에서 바로 끝난다. 클린 코드 라운드 번호와 `dismissed` 지적은 실행 상태 `state.json` 의 `clean_code_round` 와 `clean_code_dismissed` 에 기록하고, 재개된 실행은 기록된 번호에서 이어 세며 기록된 `dismissed` 지적을 계속 세지 않는다.

**표시.** 분류기는 어긴 원칙이나 위치를 적지 않은 지적, 프로젝트의 기존 관례와 충돌하는 지적, 타당하지 않다고 판단한 지적을 `dismissed` 로 표시하고 사유를 적으며, fixer 는 그 지적을 고치지 않는다. 세 번째 클린 코드 라운드가 끝나도 고쳐지지 않은 지적은 `unresolved` 로 표시해 보고하고 더 고치지 않는다 — `dismissed` 지적은 보고서에서 계속 `dismissed` 이고 `unresolved` 가 되지 않는다.

**테스트.** 모든 클린 코드 수정은 그 실행의 회귀 테스트 명령을 통과해야 유지한다 — 통과는 회귀 기준선 대비 신규 실패 0 이다. 수정이 회귀 테스트 명령을 통과하지 못하면 그 수정을 되돌리고, 그 지적을 실패 출력과 함께 `unresolved` 로 표시한다. 보존 스캔(보존 스캔 절, §0.17)과 그 밖에 fixer diff 를 검사하는 게이트도 모든 클린 코드 수정을 검사한다 — 클린 코드 수정이 기존 public 심볼을 지우거나 시그니처를 바꾸거나, 기존 테스트 케이스를 지우거나 약화하거나, 비-테스트 기존 파일을 지우거나 옮기거나(`existing-public-contract-change` · `existing-test-weakened-or-deleted` · `existing-file-deleted-or-moved`), Mock 탐지(`mock-detection`)나 cwd 외부 path 검사(`external-module-impact`)에 걸리면 그 수정을 되돌리고, 그 지적을 걸린 게이트와 스캔 사유와 함께 `unresolved` 로 표시하며, 그 게이트를 올리지 않고 실행을 멈추지 않는다. 되돌린 클린 코드 수정은 kept finding 이 아니므로 개선 루프 발산 게이트(`improvement-loop-divergence-4opt`)의 횟수에 세지 않는다. 회귀 테스트를 돌리지 않는 실행(`--skip-regression`)이나 회귀 기준선을 잡지 못한 실행(`regression_baseline = null`)은 클린 코드 수정을 유지할 수 없으므로 클린 코드 라운드를 돌지 않고 그 사실을 보고한다.

**빠른 처리.** 호출 인자나 사용자 요청이 클린 코드 원칙을 지키지 않아도 된다고 하거나 빠른 처리를 요구하면(예: `ASAP`, `아삽`, `최대한 빨리`), 시작할 때 클린 코드 검사를 건너뛸지 한 번만 묻고 사용자가 확인하면 클린 코드 라운드를 모두 건너뛴다. `--auto` 이면 같은 신호가 있을 때 묻지 않고 건너뛴다. 건너뛰었으면 보고서에 클린 코드 검사를 건너뛴 사실과 그 이유(신호가 된 인자나 요청 문구)를 적는다. `--mini`, `--loops` 같은 라운드 상한 옵션은 빠른 처리 신호가 아니다. 사용자의 답이나 `--auto` 의 건너뛰기는 답을 받은 즉시, 다음 phase 가 돌기 전에 실행 상태 `state.json` 의 `clean_code_skip` 에 기록하고, 재개된 실행은 다시 묻지 않고 기록된 답을 따른다 — 건너뛰기로 기록됐으면 클린 코드 라운드를 돌지 않는다. `--skip-clean-code` 는 이 스킬을 부른 스킬이 이미 확인한 건너뛰기다 — 이 인자를 받으면 다시 묻지 않고 클린 코드 라운드를 모두 건너뛰며, Phase 0 에서 `clean_code_skip` 에 `true` 로 기록하고 보고서의 이유에 그 인자를 적는다. `--keep-clean-code` 는 이 스킬을 부른 스킬이 이미 받은 유지 답이다 — 이 인자를 받으면 다시 묻지 않고 클린 코드 라운드를 돌며, Phase 0 에서 `clean_code_skip` 에 `false` 로 기록한다. `--skip-clean-code` 나 `--keep-clean-code` 가 `--auto` 와 함께 오면 그 인자가 `--auto` 의 건너뛰기보다 우선한다. `--skip-clean-code` 와 `--keep-clean-code` 를 함께 받으면 어느 답인지 알 수 없으므로 시작하지 않고 거부한다. 이 스킬을 리뷰 hop 으로 부르는 스킬은 같은 신호를 받으면 자기 시작 시점에 한 번만 묻고(`--auto` 면 묻지 않고 건너뛴다) 그 답을 자기 실행 상태에 기록하며, 자기가 부르는 모든 리뷰 hop 에 사용자가 확인했으면 `--skip-clean-code` 를, 거절했으면 `--keep-clean-code` 를 넘긴다 — 사용자 요청을 보지 못하는 wave 워커의 리뷰 hop 에는 dispatch 카드로 넘긴다. 사용자가 `--auto` 로 돌리지 않은 리뷰 hop 에 `--auto` 를 붙이는 스킬(예: 단독 실행 끝의 kiwi-coder)도 그런 호출자로서 먼저 묻는다. 리뷰 hop 을 부르는 스킬이 부모에게서 `--skip-clean-code` 나 `--keep-clean-code` 를 받으면 묻지 않고 그 답을 자기 실행 상태에 기록하며, 자기가 부르는 모든 리뷰 hop 과 리뷰 hop 에 이르는 자식에 그 인자를 그대로 넘긴다 — 스킬 본문의 호출 예시에 적힌 `[--skip-clean-code | --keep-clean-code]` 자리가 그 답이다.

---

## 차단·기록과 회차 판정 — 컴팩션 뒤에도 남는 규칙 (FR-FLOW-229)

이 블록은 본문 규칙의 요약이며 규칙을 더하지 않는다 — 줄마다 본문에 같은 문장이 있다.

- **보장 범위** — 실행을 시작할 때 리뷰 대상 코드의 보장 범위를 실행 상태 `state.json` 의 `guarantee_scope` 에 기록한다.
- **판정 주체** — kept finding 을 차단(`block`)과 기록(`record`)으로 가르는 것은 리뷰어가 아니라 리드(분류기)다.
- **차단** — AC 를 어기거나, 실제 호출 경로에서 재현되거나, 데이터를 잃거나, 비밀을 노출하거나, 인증·권한을 우회하는 kept finding 은 차단이다 — 보안 finding 은 입력이 드물어도 차단이고, 선언된 계약을 깨는 값의 조용한 손실과 평범한 올바른 입력의 거부는 입력을 어떻게 만들었든 차단이다.
- **기록** — 실패하는 테스트로 입증됐지만 실제 호출 경로가 없거나 보장 범위 밖인 kept finding 은 drop 하지 않고 기록(`declared_limit`)으로 분류해 고치지 않으며, 증거와 함께 선언된 한계 목록 `declared_limits[]` 에 올리고, 사용자는 그것을 차단으로 올릴 수 있다 — 차단 조건에 드는 finding 은 실제 호출 경로가 없거나 입력을 만들어 냈어도 기록으로 분류하지 않는다.
- **2회차 범위** — 2회차부터 리뷰 범위의 기본값은 `check_review_round` 가 정하는 회차 범위(FR-NODE-274 AC-2)이며, 전체 범위로 넓히는 것은 사유를 `scope_widen_reason` 에 기록하는 명시적 결정이다.
- **계열 재발** — 같은 계열(`family`)의 kept finding 이 앞선 두 회차 이상에서 나온 뒤 다시 나오면, 리드는 표준 도구 쓰기(`standard-tool`)·한 규칙으로 통합(`single-rule`)·한계 선언(`declare-limit`) 중 정확히 하나를 골라 `family_action` 으로 기록하고, fixer 는 그 구성원 하나만 덧대지 않고 그 선택을 적용한다.
- **회차 검사** — 회차가 끝날 때마다 읽기 전용 검사 `check_review_round`(CLI `speckiwi review-round check`)를 부르고, 범위·앞 회차 수정의 과반·통과·상한이나 예산 멈춤에 대해 그 검사가 돌려준 판정(`PASS` · `NEEDS_USER` · `CONTINUE`)을 따른다.
- **통과** — 차단 kept finding 이 0 이고 리뷰 커버리지 대조(FR-FLOW-171)가 통과하고 residual 이 남지 않았을 때(FR-FLOW-203 AC-11) 실행이 통과하며, 기록 finding 은 통과를 막지 않는다.
- **남은 차단** — 앞 회차에서 해소되지 않은 차단 kept finding 도 그 회차 `findings[]` 에 다시 싣고 `id` · `family` · `introduced_by_round` 는 처음 기록한 값을 그대로 두므로, 최근 회차만 읽는 `check_review_round` 가 남은 차단을 모두 센다.
- **상한·예산 멈춤** — 차단 kept finding 이 남은 채 최근 회차 번호가 `limits.round_cap` 에 닿거나, `limits.token_budget` 이 null 이 아니고 회차별 `tokens_used` 합이 그것을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈추고 통과로 기록하지 않는다 — `limits.token_budget` 이 null 이면 예산 멈춤은 없다.
- **과반 멈춤** — 한 회차의 차단 kept finding 중 앞 회차 수정이 만든 것(`introduced_by_round` 가 그 회차보다 앞선 것)이 그 회차 차단의 절반을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈춘다.
- **--auto** — 이 두 멈춤은 `--auto` 의 결정 서브에이전트가 풀지 못한다(critical gate `round-cap-or-budget-needs-user` · `fix-induced-defects-majority`).

---

## Workflow 도구 정책

세션 상태 조회의 정상 경로는 공식 workflow 읽기 도구다 — `--resume` 이 읽는 `.kiwi/sessions/{run-id}/state.json` 은 MCP `workflow_resolve_artifact` 에 그 실행의 `runId` 와 함께 `kind` 를 `coder-state` 로, `includeBody` 를 `true` 로 주어 읽고, 실행 기록 `worklog.jsonl` 은 `workflow_worklog_tail` 로 조회한다. 파일을 직접 읽는 것은 그 도구를 쓸 수 없을 때의 degraded 폴백이며, 그 실행은 도구 진단·산출물 경로·active target·후속 요구 또는 후보 ID 를 사용자 보고에 함께 남긴다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **서브에이전트 강제 (메인 직접 작업 금지)**. 코드 리뷰는 까칠 리뷰어 서브에이전트만 수행 (kiwi-coder Phase 2.f 8축 차용). 코드 수정은 시니어 fixer 서브에이전트만 수행. 메인은 오케스트레이션 + 사용자 게이트 + 산출물 통합 외 어떤 코드 판단·수정도 직접 하지 않는다. 본 §0.1 위반은 본 스킬 설계의 근본 우회 — 발견 즉시 메인이 self-abort + 사용자 보고 |
| §0.2 | **검증자 입력 격리** (CLAUDE.md §5). 까칠 리뷰어 재검증 라운드에 시니어 fixer 의 결론·정당화 텍스트 전달 금지. 원본 diff + 직전 finding + 적용된 fix 의 파일/라인 메타데이터만 |
| §0.3 | **TDD 의무 (조건부)**. Finding 이 `is_behavioral=true` 또는 `tags ∈ {bug, regression, security, performance}` 인 항목은 회귀 테스트 선행 작성 (상세 트리거 §6.1 참조). "style_only" / "naming" finding 과 클린 코드 라운드의 `clean-code` 지적은 회귀 테스트 선행 작성을 면제한다 — 동작을 바꾸지 않는 수정이며, 대신 그 수정은 회귀 테스트 명령을 통과해야 유지된다 (클린 코드 라운드 블록). 시니어 fixer 가 면제 판정 시 worklog `tdd_exempted { finding_id, reason_enum }` |
| §0.4 | **Mock 금지** (regex 자동 탐지). 탐지는 기계 검사이므로 곧바로 kept finding. kiwi-coder §0.6 계승 |
| §0.5 | **외부 모듈 수정 금지**. cwd 외부 path 가 fix diff 에 진입 시 §0.G4 발동 |
| §0.6 | **시그니처 금지** (CLAUDE.md §6). 커밋·코드 주석·PR 응답 코멘트·산출물 어디에도 AI 식별 정보 금지 |
| §0.7 | **/snoworca-\* 호출 절대 금지** (프로젝트 CLAUDE.md §7). 로직만 차용 |
| §0.8 | **MCP mutation 자체 호출 금지 (느슨 결합)**. 본 스킬은 직접 `add_requirement` / `add_trace_link` / `update_status` 등을 호출하지 않는다. 리뷰-fix 흐름에서 SRS 변경이 필요한 finding 이 발생하면 사용자 보고 + `/kiwi-srs-sync` 또는 `/kiwi-srs` 위임 권고 (Skill 자동 호출 안 함 — review-fix-loop 의 책임 경계 외). **예외 (옵션 opt-in)**: 사용자가 `--close-reqs` 명시 시 셀프 모드 한정으로 `update_status` (implemented→verified, forward-only) + `add_verification_evidence` (type=test) + `check_acceptance_criteria` (AC 마다 지목 선행) 3종 호출 허용 (§0.G7 + §6.6). 기본 동작은 종전대로 mutation 금지 유지. read 호출 (`get_active_target` / `summarize_target` / `list_requirements`) 은 mutation 이 아니므로 §0.8 적용 외 — `--close-reqs` 미활성 상태에서도 호출 가능. |
| §0.9 | **검증 서브에이전트 모델 정책 SSOT** (kiwi-coder §0.16 정합). 까칠 리뷰어 / 분류기 / 정형 검사 등 **검증 서브에이전트**는 기본적으로 **현재 세션 모델(current session model)**을 상속하며 `--model <name>` (또는 사용자가 지명한 모델) 로 그 모델을 override 한다. **시니어 fixer 는 현재 세션 모델이나 `--model` 영향 없음** (kiwi-coder 시니어 코더와 동일). count 는 모든 모드 공통 (각 ×1) |
| §0.10 | **`.kiwi/` 상태 영속**. `cwd/.kiwi/sessions/{run-id}/state.json` 갱신. 재개 가능 (`--resume`) |
| §0.11 | **모드 결정 SSOT (§0.G1)**. 기본은 셀프 모드. `--pr` / `-pr` / `--PR` / `-PR` 옵션 또는 자연어 명시 ("PR 리뷰 읽고 수정", "PR 코멘트 적용", "gh pr review fix") 시 PR 모드. 두 모드는 상호 배타 |
| §0.12 | **PR 모드 사용자 의사결정 권한**. PR 리뷰 코멘트는 동료의 의견 — 본 스킬이 자동 거절·자동 수용 모두 위험. 분류기의 판정은 사용자 게이트 후 적용. `--auto` 시 keep/drop 가드레일: `--auto` 에서는 **차단 kept→자동 수정 / 기록 kept→선언된 한계로 자동 보고(고치지 않음) / dropped→자동 보고 / residual→사용자 결정**으로 가르며, `--auto` 는 기록 finding 을 차단으로 올리지 않는다. |
| §0.13 | **PR 응답 코멘트 의무 (PR 모드 + 응답 활성)**. `--no-respond` 부재 + PR 모드 + fix 1건 이상 적용 시 PR 에 응답 코멘트 1개 작성 (수정 완료 항목 + 거절 항목 + 사유). `gh pr comment` 사용. 시그니처 §0.6 적용 |
| §0.14 | **셀프 모드 우선순위 결정**. 셀프 모드의 리뷰 대상 범위는 다음 순서: (1) 인자 `--files` / `--commits` / `--since` / `--base` `--head` 우선 / (2) 부재 시 `git status` 변경분 (working tree + staged) / (3) 변경분 0건 시 `HEAD~5..HEAD` fallback (사용자 확인 게이트 후) |
| §0.15 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. §0.G5 finding 4분류 매핑 (immediate_fix / declared_limit / discussion_needed / rejected) 및 §0.12 keep/drop 가드레일 (차단 kept → 자동수정, 기록 kept → 선언된 한계로 자동 보고, dropped → 자동 보고, residual → 사용자 결정) 은 본 스킬 고유 finding 분류 정책으로 유지된다 — SSOT 는 게이트 결정 채널만 정규화. 본 스킬의 `critical_gates[]` 는 §0.G8 (아래) 참조 |
| §0.16 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 차단 kept finding 이 남았으면 잔여 보고로 끝내지 않고 차단·기록 목록과 함께 `NEEDS_USER` 로 멈춘다(안전 게이트 불우회, §6.4). 스킬 기본 상한의 숫자는 §6.4 가 정한다 |
| §0.17 | **기존 구조 불가침** (kiwi-coder §0.20 정합). fix 로 green 을 만들기 위한 **기존 테스트 파일 삭제**, **기존 테스트 케이스 제거**, **기존 단언 약화**, **기존 public 심볼의 삭제·시그니처 변경**, **비-테스트 기존 파일의 삭제·이동**을 모두 **금지**한다 — 본 스킬은 kiwi-coder 를 거치지 않는 코드 변경 경로이므로, 여기서 보존 규약이 빠지면 그 우회로가 그대로 열린다. 판정 기준은 kiwi-coder §0.20.1~§0.20.3 를 그대로 따른다. 탐지·차단 = **보존 스캔** 절 (§6) + §0.G8 `existing-test-weakened-or-deleted` / `existing-public-contract-change` / `existing-file-deleted-or-moved` |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — 모드 결정

| 입력 신호 | 모드 |
|---|---|
| `--pr` / `-pr` / `--PR` / `-PR` (값 없음) | PR 모드, 현재 브랜치의 PR 자동 탐지 (`gh pr view --json`) |
| `--pr=<URL>` / `--pr <URL>` / `-pr <URL>` 등 | PR 모드, URL 의 PR 사용 |
| 자연어 "PR 리뷰 읽고 수정해줘", "PR 코멘트 적용해줘", "gh pr review fix", "pr 응답해줘" | PR 모드 (현재 브랜치 자동 탐지) |
| 위 모두 부재 | 셀프 모드 (기본) |
| `--pr` 와 셀프 모드 신호 동시 부재 시 자연어 모호 (예: "리뷰해줘") | 셀프 모드 (기본 정책) |
| `--pr` 명시 + `gh` CLI 미설치 또는 미인증 | HALT + 사용자에게 `gh auth login` 안내 |

#### §0.G2 — 셀프 모드 범위 결정 (§0.14 적용)

```
if --files / --commits / --since / --base+--head 명시:
  사용
elif git status --porcelain | wc -l > 0:
  working tree + staged 변경분 (git diff HEAD)
else:
  AskUserQuestion("working tree 변경 없음. HEAD~5..HEAD 를 리뷰할까요?", [yes, no, custom-range])
  yes → git diff HEAD~5..HEAD
  no → HALT
  custom-range → 사용자 입력
```

self_scope.source enum 매핑 (§3.1):
- `--files` → `source=files`
- `--commits` → `source=commits`
- `--since` → `source=since`
- `--base` + `--head` → `source=base-head`
- `git status > 0` → `source=working-tree`
- `HEAD~5..HEAD` 자동 fallback → `source=fallback-head-n`
- `custom-range` 사용자 입력 → `source=commits` + `commit_range` 에 사용자 입력값 기록

#### §0.G3 — PR 모드 입력 수집

```
1. gh pr view --json title,body,number,headRefName,baseRefName,reviewDecision
2. gh pr view --comments --json comments,reviews
3. 분류:
   - 리뷰 코멘트 (review_comments): inline 코멘트 with file/line
   - 일반 코멘트 (issue_comments): PR 전체 코멘트
   - 리뷰 (reviews): APPROVED / CHANGES_REQUESTED / COMMENTED 의 본문
4. 응답 대상: CHANGES_REQUESTED + COMMENTED 의 본문 + 모든 inline 코멘트
5. APPROVED 만 있고 다른 finding 없음 → "리뷰 통과 상태, 수정 불필요" + Phase 1 skip → Phase 7 (사용자 보고) 직행
```

`gh` 실패 시 §0.G1 HALT.

#### §0.G4 — 외부 모듈 영향

| IF | THEN |
|---|---|
| fix diff 에 cwd 외부 path 진입 | 즉시 중단 + AskUserQuestion 3옵션 (cwd 한정 / 외부 포함 / 작업장 이동) |

#### §0.G5 — Finding 4분류 SSOT

분류기 (×1) 가 각 finding 에 대해 다음 중 정확히 1개로 분류:

| 분류 | 정의 | 액션 |
|---|---|---|
| **immediate_fix** | 실행으로 입증된 차단 kept finding(AC 위반·실제 호출 경로 재현·데이터 손실·비밀 노출·인증·권한 우회, 사용자가 차단으로 올린 기록 포함) — 자동 수정 가능 | Phase 3-5 진입 |
| **declared_limit** | 기록 kept finding — 실패하는 테스트로 입증됐지만 실제 호출 경로가 없거나 보장 범위(`guarantee_scope`) 밖이고 차단 조건에 들지 않는 것 | 고치지 않고 증거와 함께 `declared_limits[]` 에 올려 보고한다. 사용자가 차단으로 올리면 `immediate_fix` 로 간다 (`--auto` 는 올리지 않는다) |
| **discussion_needed** | residual finding — 기능 결함이라 주장했으나 실행으로 입증하지 못했거나, 설계 의사결정·사용자 의도 확인이 필요해 판정을 사용자에게 넘기는 것 | AskUserQuestion (Normal) 또는 보고만 + 사용자 결정 위임 (Max 가능) |
| **rejected** | dropped finding 만 온다 — 실행 입증 없음·스타일·명명·순서·주석, 또는 오해·scope-out·이미 의도된 동작·외부 라이브러리 책임처럼 결함이 아닌 것. `rejection_category` 가 그 drop 사유를 적는다 | 거절 사유 기록 + (PR 모드) 응답 코멘트에 거절 사유 포함 |

`unclassified` 허용 안 함. 분류 모호 시 `discussion_needed` 로 폴백.

#### §0.G6 — 개선 루프 발산

| IF | THEN |
|---|---|
| 시니어 fixer 재호출 3회 누적 (단일 finding) | AskUserQuestion 4옵션 (§0.G6.1) |
| 까칠 리뷰어 재검증 2회 누적 + 동일 finding 잔존 | AskUserQuestion 4옵션 |
| 회귀 테스트 2회 연속 동일 파일 fail | 즉시 사용자 에스컬레이션 + §0.G6.1 4옵션 적용 |

§0.G6.1 4옵션: `(1) draft-keep` / `(2) partial-commit` / `(3) force-proceed` (사용자 책임) / `(4) abandon-finding` (단일 finding skip, 다음 finding 진행).

#### §0.G7 — REQ close 게이트 (`--close-reqs` 활성 시)

| IF | THEN |
|---|---|
| `--close-reqs` 부재 | §6.6 skip (mutation 호출 0건, 기본 동작) |
| `--close-reqs` + PR 모드 | 차단 + 사용자 보고 ("`--close-reqs` 는 셀프 모드 전용. PR 모드에서 SRS mutation 은 머지 후 별도 처리") |
| `--close-reqs` + 회귀 fail | 차단 + WARN ("회귀 미통과로 verified 전이 부적합") |
| `--close-reqs` + 차단 kept 또는 residual finding 잔존 (≥1) | 차단 + WARN — 기록(`declared_limit`) finding 은 승급을 막지 않는다. residual 은 사용자 결정 전까지 승급하지 않는다 (FR-FLOW-203) |
| `--close-reqs` + Phase 7.4 테스트 충분성 확인이 `test-sufficiency-gap` 을 올림 | 차단 — gap 이 남은 요구를 `verified` 로 쓰지 않는다 (§6.5.1) |
| `--close-reqs` + `scoped` 0건 | §6.6 skip + 보고. **"close 대상 REQ 없음" 한 줄로 끝내지 않는다** — `denominator` 의 크기와 교차가 0이 된 사유를 함께 적는다. 분모가 0이면 그 자체가 신호다 (`FR-NODE-198` 참조: enum 밖 status 로 쓰인 REQ 는 분모에 애초에 들어오지 않는다) |
| `--close-reqs` + `eligible` 1건 이상 + 전이 0건 | **`TASK_DONE` 이 아니다.** `FAILED` 로 종료 + 보고 (§7.3) |
| `--close-reqs` + 처분 대조 불일치 (`전이 성공 수 + 제외 수 ≠ scoped 크기`) | 그 실행은 **무효**. `FAILED` 로 종료 + 처분 없는 REQ 열거 |
| `--close-reqs` + 영향 REQ 중 stability=draft 1건 이상 | 해당 REQ skip + 사용자 보고 (draft 는 verified 부적격), 나머지 진행 |
| `--close-reqs` + 영향 REQ 중 현재 status 가 implemented 가 아닌 항목 (예: verified 이미 / planned) | 해당 REQ skip + 보고, 나머지 진행. **이 항목은 분모 밖이므로 `scoped` 에도 처분 대조에도 들어오지 않는다** |
| `--close-reqs` + 영향 REQ 가 **산문 문서를 검증 증거**로 삼는 경우 | 해당 REQ 를 **닫지 않는다** + 보고 — 본 스킬은 §11 로 산문을 보지 않아 `FR-FLOW-136` AC-6 의 전체 문서 감사를 수행할 수 없고, 수행할 수 없는 의무는 게이트가 아니다. **그런 요구를 자동으로 닫는 경로는 파이프라인에 없다** — 사람이 감사하고 닫는다. 보고에 그 사실을 함께 적어, 닫히지 않은 이유가 실패로 읽히지 않게 한다 |
| 위 차단/skip 미해당 | §6.6 진입 |

#### §0.G8 — `--auto` critical_gates[] 선언

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트 (SSOT `_shared/kiwi/auto-option.md` §5 인터페이스 준수). 아래 게이트는 `--auto` 무관 항상 사용자 결정 필요 — 결정 서브에이전트로 우회 금지:

| gate_id | reason | 발생 위치 |
|---|---|---|
| `classifier-fix-hypothesis-fail-fallback` | 분류기 fix 가설 생성 실패 fallback — discussion_needed 유지 + 사용자 게이트 강제 복귀 (무한 루프 방지) (§5.1) | §5.1 |
| `residual-finding-user-decision` | residual finding(실행으로 입증하지 못한 기능 결함 주장)은 `--auto` 의 결정 서브에이전트가 정리하지 못한다 — 사용자 결정 전까지 남는다 (FR-FLOW-203) | §0.G5 / §5.1 |
| `round-cap-or-budget-needs-user` | 차단 kept finding 이 남은 채 라운드 상한(`limits.round_cap`)에 닿거나 토큰 예산(`limits.token_budget`)을 넘었다 — 차단·기록 목록과 함께 `NEEDS_USER` 로 멈추고 `--auto` 의 결정 서브에이전트가 풀지 못한다 (FR-FLOW-229 AC-4) | §6.4 |
| `fix-induced-defects-majority` | 한 회차의 차단 kept finding 중 앞 회차 수정이 만든 것이 절반을 넘었다 — 차단·기록 목록과 함께 `NEEDS_USER` 로 멈추고 `--auto` 의 결정 서브에이전트가 풀지 못한다 (FR-FLOW-229 AC-6) | §6.4 |
| `close-reqs-with-pr-mode` | `--close-reqs` + PR 모드 조합 차단 (§0.G7 Rule 2) | §0.G7 |
| `close-reqs-with-regression-fail` | `--close-reqs` + 회귀 fail — verified 전이 부적합 (§0.G7 Rule 3) | §0.G7 |
| `close-reqs-critical-or-high-residual` | `--close-reqs` + 차단 kept 또는 residual finding ≥1 잔존 — close 차단, 기록 finding 은 막지 않는다 (§0.G7 Rule 4). 게이트 ID 는 호환을 위해 유지한다 | §0.G7 |
| `external-module-impact` | fix diff 에 cwd 외부 path 진입 (§0.5 / §0.G4) | §0.G4 |
| `improvement-loop-divergence-4opt` | §0.G6 4옵션 게이트 발동 (시니어 fixer 3회 / 까칠 2회 동일 finding / 회귀 2회 연속 동일 fail) | §0.G6 |
| `mock-detection` | Mock regex 자동 탐지 — kept finding (§0.4) | §0.4 / §6.2 |
| `pr-mode-gh-unavailable` | PR 모드 활성 시 `gh` CLI 미설치/미인증 (§0.G1 마지막 행) | §0.G1 |
| `mcp-cli-both-unavailable` | `--close-reqs` 활성 상태에서 MCP·CLI 양쪽 미가용 — evidence 등록·status 전이를 대체할 경로가 없다 (§6.6.3) | §6.6.3 |
| `bulk-close-or-finalize` | REQ close 는 REQ 단위 + 증거 등록이 선행 조건 — bulk finalize·archive·target 비우기 시도 (§0.8 / §6.6) | §6.6 |
| `existing-test-weakened-or-deleted` | fix diff 에서 기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화 검출 (§0.17) | §0.17 / §6.2 |
| `existing-public-contract-change` | fix diff 에서 기존 public 심볼의 삭제 또는 시그니처 변경 검출 — **경로와 무관**하게 critical (§0.17) | §0.17 / §6.2 |
| `empty-code-scope` | 부류 필터 뒤 코드 대상 0건 (§11) | §11 / §3.1 |
| `existing-file-deleted-or-moved` | fix diff 에서 비-테스트 기존 파일의 삭제·이동 검출 (§0.17) | §0.17 / §6.2 |
| `review-coverage-mismatch` | 리뷰 커버리지 대조 실패가 2회 연속 — 무효 라운드만 쌓이며 cap 을 소진한다 (§12) | §12 / §6.4 |
| `test-sufficiency-gap` | 테스트 충분성 확인의 채우기 1회 뒤에도 인용 gap 이 남음 — gap 이 남은 요구는 `verified` 로 쓰지 않는다 (`_shared/kiwi/test-sufficiency.md`) | Phase 7.4 (§6.5.1) |
| `validate-spec-error` | `validate_spec` 가 error 급 진단을 하나라도 돌려줌 — 오류를 안은 요구 위에 증거와 승급을 쌓으면 그 통과가 무엇을 근거로 기록되었는지 되읽을 수 없다 | `--close-reqs` 승급 직전 |

**이 게이트를 관측하는 자리**: 위 표에서 이 행의 세 번째 칸이 가리키는 홉에서 MCP `validate_spec` 을 실행한다 — MCP 가 없으면 CLI `speckiwi validate --json` 이다. error 급 진단이 하나라도 남아 있으면 그 홉을 진행하지 않고 `validate-spec-error` 로 중단하며, `--auto` 도 이 중단을 덮지 못한다. 실행하지 않은 채 통과로 기록하지 않는다.

**클린 코드 수정은 이 표의 게이트를 올리지 않는다**: 클린 코드 수정이 `existing-public-contract-change` · `existing-test-weakened-or-deleted` · `existing-file-deleted-or-moved` · `mock-detection` · `external-module-impact` · `improvement-loop-divergence-4opt` 에 걸리면 클린 코드 라운드 블록의 **테스트.** 규칙대로 되돌리고 `unresolved` 로 표시하며 실행을 멈추지 않는다. 기능 결함 수정과 채우기 서브에이전트의 diff 에는 이 표가 그대로 적용된다.

**finding 분류 매핑 (§0.G5) 와 keep/drop 가드레일 (§0.12) 은 본 critical_gates 와 별개 채널**: discussion_needed/immediate_fix/declared_limit/rejected 의 자동 액션 매핑은 keep/drop 가드레일(차단 kept→자동 수정 / 기록 kept→선언된 한계로 자동 보고 / dropped→자동 보고 / residual→사용자 결정)의 적용 대상이며, 본 §0.G8 는 그 매핑이 실패하거나 critical 영역에 진입할 때의 HALT 게이트만 선언한다.

---

## 1. 입력 / 출력

### 1.1 필수 입력

(없음) — 셀프 모드 + working tree 자동.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "PR 리뷰 읽고 수정", "PR 코멘트 적용", "pr 응답" | `--pr` / `-pr` / `--PR` / `-PR` (값 없음 시 현재 브랜치 PR 자동 탐지) | off (셀프 모드) |
| "PR https://...", "이 PR 리뷰" | `--pr=<URL>` | off |
| "셀프 리뷰", "현재 변경물 리뷰" | (기본 동작) | (자동) |
| "어제부터", "ISO date 이후" | `--since=YYYY-MM-DD` | off (working tree) |
| "이 파일들만" | `--files=src/x.ts,src/y.ts` (콤마) | off |
| "최근 N 커밋" | `--commits=HEAD~N` | off |
| "base 가 develop", "main 대비" | `--base=main` `--head=HEAD` | off |
| "max 모드", "정밀" | `--max` | off (Normal) |
| "자동 진행", "확인 없이" | `--auto` (SSOT: auto-option.md v1.0) | off |
| "dry-run", "변경 없이 리뷰만" | `--dry-run` | off (fix 적용) |
| "회귀 skip" | `--skip-regression` | off |
| "PR 응답 안 함" | `--no-respond` | off (PR 모드 응답 의무) |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (검증 서브에이전트) |
| "REQ 닫기", "verified 전이", "검증 완료 표시" | `--close-reqs` | off (셀프 모드 + 회귀 PASS + finding 0건 시에만 활성) |
| "이 요구들만", "요구 범위" | `--req-filter <id,...>` (콤마) — 테스트 충분성 확인의 요구 범위 (§6.5.1) | off |
| "이 SDS 대비", "SDS 경로" | `--sds <path>` — 테스트 충분성 확인에 함께 넘길 lite SDS(`docs/sds/*.sds.md`) (§6.5.1) | off |
| "재개" | `--resume` | off |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |
| 부모 기준선 | `--regression-baseline <path>` | off (자기 시점 캡처) |
| "파이프라인 이벤트 억제" (오케스트레이터 전달) | `--no-pipeline-emit` (인자 없음 — `kiwi/pipeline.jsonl` append 를 수행하지 않는다, §7.3) | off (emit 수행) |
| 호출 스킬이 확인한 클린 코드 건너뛰기 (오케스트레이터 전달) | `--skip-clean-code` (인자 없음 — 다시 묻지 않고 클린 코드 라운드를 건너뛴다, 클린 코드 라운드 블록) | off (빠른 처리 신호면 Phase 0 에서 한 번 묻는다) |
| 호출 스킬이 받은 클린 코드 유지 답 (오케스트레이터 전달) | `--keep-clean-code` (인자 없음 — 다시 묻지 않고 클린 코드 라운드를 돈다, 클린 코드 라운드 블록) | off (빠른 처리 신호면 Phase 0 에서 한 번 묻는다) |

### 1.3 모드 매트릭스

까칠 리뷰어 / 분류기 / 정형 검사 **검증 서브에이전트**는 **현재 세션 모델(current session model)**을 상속하며 `--model <name>` (또는 사용자가 지명한 모델) 로 그 모델을 override 한다. 시니어 fixer 는 현재 세션 모델이나 `--model` 영향 없음 (kiwi-coder 시니어 코더와 동일). `--max` 는 모델이 아니라 **검증 강도**를 격상한다.

| 모드 | 까칠 리뷰어 | 분류기 | 시니어 fixer | 정형 검사 | 비용 배수 |
|---|---|---|---|---|---|
| Normal (기본) | × 1 | × 1 | × 1 | × 1 | 1.0× (기준) |
| `--max` | × 1 (전 모드 동일 — 뮤테이션·적대적 실행으로 검증 강도만 상향) | × 1 | × 1 | × 1 | 강도만큼 상향 |

까칠 리뷰어는 **전 모드에서 1개**이며, `--max` 는 리뷰어 수가 아니라 검증 강도(뮤테이션·적대적 실행)만 올린다.

까칠 리뷰어 / 시니어 fixer 는 **항상 서브에이전트** (§0.1). off 플래그 없음.

### 1.4 출력 (산출물)

- **코드 변경**: fix 대상 파일에 직접 작성. git commit 은 사용자 결정
- **분석 디렉토리**: `docs/analysis/kiwi-review-fix-loop-{run-id}/`
  - `mode_decision.json` — 모드 결정 결과 (셀프/PR) + 범위
  - `review_inventory.json` — 리뷰 finding 인벤토리 (셀프: 까칠 리뷰어 산출 / PR: gh pr comments + reviews)
  - `classified_findings.json` — 4분류 결과 (immediate_fix / declared_limit / discussion_needed / rejected)
  - `fix_iter{N}.json` — 시니어 fixer 적용 결과 (finding_id → patch summary)
  - `prickly_recheck_iter{N}.json` — 까칠 리뷰어 재검증 결과
  - `regression_run.jsonl` — 회귀 테스트 실행 로그
  - `pr_response.md` (PR 모드) — PR 응답 코멘트 본문 (`--no-respond` 부재 시)
  - `rejected_findings.log` — 거절된 finding 사유
  - `test_sufficiency.json` (요구 범위가 알려진 실행) — 테스트 충분성 확인 결과 (§6.5.1)
  - `closed_reqs.json` (`--close-reqs` 활성 시) — REQ verified 전이 결과 (req_id → from_status, to_status, evidence_ref, skipped_reason)
  - `mcp_call_log.jsonl` (`--close-reqs` 활성 시) — MCP mutation 호출 로그 (update_status, add_verification_evidence, check_acceptance_criteria)
- **`.kiwi/` 상태**: `cwd/.kiwi/sessions/{run-id}/`
  - `state.json` — phase, finding 큐, fix 적용 상태
  - `worklog.jsonl`

**Run-id**: `{YYYY-MM-DD}.{project-slug}.{mode-prefix}-{ISO-time-short}` where `mode-prefix ∈ {self, pr}`. 정규식: `^[a-z0-9.-]{4,50}$`.

### 1.5 `--dry-run`

- 모든 phase 정상 수행하되, 최종 fix diff 를 working tree 에 commit 하지 않고 patch 파일만 생성: `docs/analysis/kiwi-review-fix-loop-{run-id}/fix.patch`
- PR 모드에서도 `--no-respond` 자동 적용 (응답 코멘트 작성 안 함)
- 보고서 `mode: "dry-run"` 명시

---

## 2. Phase 흐름

```
Phase 0 : Bootstrap (preflight, 모드 결정, 범위 결정, .kiwi init/resume, 빠른 처리 신호면 클린 코드 건너뛰기를 한 번 묻고 답을 받은 즉시 `clean_code_skip` 기록)
Phase 1 : 리뷰 인벤토리 수집
  1.s (셀프): 까칠 리뷰어 서브에이전트 → working tree diff 리뷰
  1.p (PR)  : gh pr view --comments + reviews → 정규화
Phase 2 : Finding 4분류 (분류기 ×1)
Phase 3 : 즉시수정 항목에 회귀 테스트 작성 (TDD 조건부, §0.3)
Phase 4 : 시니어 fixer 적용 (서브에이전트)
Phase 5 : 까칠 리뷰어 재검증 (서브에이전트, 입력 격리 §0.2)
Phase 6 : 미해결 시 Phase 4-5 반복 (kept 카운터)
Phase 6.5 : 클린 코드 라운드 (최대 3회, 클린 코드 라운드 블록 — 빠른 처리 신호면 건너뜀)
Phase 7 : 회귀 테스트 실행
Phase 7.4 : 테스트 충분성 확인 — 요구 범위가 알려졌을 때(`--close-reqs` · `--req-filter` · `--sds`) `_shared/kiwi/test-sufficiency.md` 를 따른다 (§6.5.1)
Phase 7.5 : (`--close-reqs` 활성 시) 영향 REQ verified 일괄 승급 (§6.6, §0.G7 게이트)
Phase 8 : 보고서 + (PR 모드) PR 응답 코멘트 + pipeline.jsonl emit
```

---

## 3. Phase 0 — Bootstrap

### 3.0 preflight

판정 순서:
1. git 환경: `git rev-parse --git-dir` 성공 → PASS
2. PR 모드 활성 시: `gh --version` + `gh auth status` 성공 → PASS. 실패 시 §0.G1 HALT
3. 회귀 테스트 실행 환경: 자동 감지 (`package.json` test script / `pytest.ini` / `cargo.toml` / `go.mod` 등). 없으면 `--skip-regression` 자동 활성 + 사용자 보고
4. 회귀 기준선: `--skip-regression` 미활성 시 §6.0 의 기준선 캡처를 여기서 1회 수행하고 `state.regression_baseline` 에 고정 — Phase 3 이 회귀 테스트를 추가하기 전 시점이어야 한다

### 3.1 모드 결정 + 범위 결정

§0.G1 알고리즘 적용 → `mode_decision.json`:
```json
{
  "mode": "self|pr",
  "pr_url": null | "https://github.com/...",
  "pr_number": null | 42,
  "self_scope": {
    "source": "files|commits|since|base-head|working-tree|fallback-head-n",
    "files": [...] | null,
    "commit_range": null | "HEAD~5..HEAD",
    "diff_loc": N,
    "excluded_prose": [...],
    "refused_artifacts": [...],
    "unclassified_files": [...]
  }
}
```

PR 모드면 §0.G3 PR 입력 수집 즉시 수행 → `mode_decision.json.pr_metadata` 에 PR title/body/base/head 추가.

### 3.2 .kiwi init / resume

state.json 초기 스키마:
```json
{
  "run_id": "...",
  "skill": "kiwi-review-fix-loop",
  "schema_version": "1.0.0",
  "started_at": "ISO-8601",
  "mode": "self|pr",
  "mode_flags": ["--model?", "--max?", "--auto?", "--dry-run?", "--no-respond?", "--close-reqs?"],
  "phase": "0|1|...|8",
  "finding_queue": [],
  "fix_iter": 0,
  "recheck_iter": 0,
  "clean_code_round": 0,
  "clean_code_dismissed": [],
  "clean_code_skip": null,
  "guarantee_scope": null,
  "declared_limits": [],
  "limits": { "round_cap": 5, "token_budget": null },
  "rounds": [],
  "regression_baseline": null,
  "regression_pass": false,
  "pr_responded": false,
  "failed": false
}
```

**착수 기록.** 실행을 시작할 때 리뷰 대상 코드의 보장 범위를 실행 상태 `state.json` 의 `guarantee_scope` 에 기록한다. `limits.round_cap` 은 실행 모드의 기본 상한(§6.4, `--loops N` 이면 N)이고 `limits.token_budget` 은 양의 정수 또는 null 이다. `rounds[]` 는 회차마다 한 항목이며 `{ round, tree_sha, scope: "since-prev"|"full", scope_widen_reason, files[], tokens_used, residual_count, coverage_passed, findings: [{ id, tier: "block"|"record", family, introduced_by_round }] }` 을 담는다 — `tree_sha` 는 그 회차 리뷰가 읽은 작업 트리 스냅숏(§6.3), `tokens_used` 는 리드가 그 회차에 기록한 토큰 수, `residual_count` 는 그 회차의 residual 수, `coverage_passed` 는 그 회차의 리뷰 커버리지 대조 결과(§12)다. 앞 회차에서 해소되지 않은 차단 kept finding 도 그 회차 `findings[]` 에 다시 싣고 `id` · `family` · `introduced_by_round` 는 처음 기록한 값을 그대로 두므로, 최근 회차만 읽는 `check_review_round` 가 남은 차단을 모두 센다. `declared_limits[]` 의 항목은 `{ id, reason, evidence }` 다. 이 기록이 회차 검사 `check_review_round` 의 입력이다(FR-NODE-274 AC-1).

resume 알고리즘 (`--resume` 활성 시):
1. state.json.phase 기반 entry-point 결정 — 해당 phase 부터 재개
2. git diff 검증 — working tree 가 직전 실행 후 변경되었으면 사용자 확인 게이트 (계속 / 새 run 시작 / HALT)
3. finding_queue / fix_iter / recheck_iter 누적 (리셋 안 함)
4. 까칠 리뷰어 / 시니어 fixer 재호출 카운터 누적 (§0.G6 발산 가드 유지)
5. `state.json.clean_code_skip` 이 기록돼 있으면 클린 코드 검사를 건너뛸지 다시 묻지 않고 기록된 답을 따른다 — `true` 면 클린 코드 라운드를 돌지 않는다 (Phase 0 에서 답을 받은 즉시 기록한다 — 사용자가 확인했거나 `--auto` 가 건너뛰면 `true`, 신호가 없거나 사용자가 거절하면 `false`, 클린 코드 라운드 블록)
6. `state.json.clean_code_round` 와 `state.json.clean_code_dismissed` 는 리셋하지 않는다 — 클린 코드 라운드는 기록된 번호에서 이어 세어 3회를 넘지 않고, 기록된 `dismissed` 지적(원칙·위치·사유)은 다음 라운드 리뷰어에게 다시 넘겨 그 라운드의 지적으로 세지 않는다 (클린 코드 라운드 블록)
7. `state.json.guarantee_scope` · `limits` · `rounds[]` · `declared_limits[]` 는 리셋하지 않는다 — 재개된 실행은 기록된 회차 뒤에서 이어 센다

---

## 4. Phase 1 — 리뷰 인벤토리 수집

### 4.1.s 셀프 모드 — 까칠 리뷰어 (서브에이전트)

까칠 리뷰어 spawn (kiwi-coder §5.2 8축 차용):

입력:
- `mode_decision.json.self_scope` 의 git diff 본문
- `review_denominator[]` — 루프가 고정한 리뷰 분모. `self_scope.files[]` 의 포함 버킷을 그대로 옮긴 것이며, 항목마다 루프가 센 `hunks_total` 을 함께 싣는다 (§12). 리뷰어가 이 집합을 정하지 않는다
- 변경 파일 주변 컨텍스트 (각 hunk 전후 50라인)
- 활성 target 의 관련 REQ-ID 목록과 그 `traceReferences` (best-effort, `list_requirements` 결과)
- 코드베이스 README / CLAUDE.md (있다면)

출력 (Markdown + JSON 둘 다):
```json
{
  "findings": [
    {
      "id": "FND-001",
      "axis": "P1|P2|P3|P4|P5|P6|P7|P8",
      "verdict": "keep|drop|residual",
      "evidence": { "command": "정확한 명령", "output": "그 명령이 낸 출력", "intent_output": "의도가 요구하는 출력" },
      "drop_reason": "verdict=drop 일 때만",
      "title": "한 줄 요약",
      "location": { "file": "src/x.ts", "line_range": "45-67" },
      "description": "본문",
      "suggested_fix": "옵션 — 부재 가능",
      "is_behavioral": true | false,
      "tags": ["bug", "performance", "security", "style", "naming", "doc"]
    }
  ],
  "clean_code": [ { "id": "CC-001", "principle": "어긴 원칙", "location": { "file": "src/x.ts", "line_range": "45-67" }, "description": "본문" } ],
  "coverage_rows": [
    {
      "file": "src/x.ts",
      "hunks_total": 3,
      "anchors": ["const budget = 30_000;", "readHolderAt", "- if (error.code === \"ENOENT\") return null;"],
      "findings": ["FND-001"]
    }
  ],
  "summary": { "total": N, "by_verdict": {...}, "by_axis": {...} }
}
```

`coverage_rows[]` 는 §12 의 리뷰 커버리지 분모가 정한다 — `review_denominator[]` 의 모든 파일이 한 행씩 갖고, 행마다 hunk 당 앵커 하나를 싣는다. 루프는 그 앵커를 diff 와 기계 대조하며, 어긋나면 라운드를 무효로 기록한다.

`is_behavioral=true` 가 §0.3 TDD 의무의 트리거 (회귀 테스트 작성 대상).

**keep/drop 규칙** — finding 의 분류는 심각도 라벨이 아니라 실행 증거가 정한다:

- finding 은 **실행이 입증할 때만 keep** 한다 — 실패하는 테스트·재현 절차·반례가 그 실패를 보이고 그 실패가 의도를 깨뜨릴 때다.
- 실행으로 입증하지 못한 것과 스타일·명명·순서·주석류는 **drop** 하며, 심각도 라벨(CRITICAL·HIGH·MEDIUM·LOW)은 종료 판정에 쓰지 않는다.
- 이 drop 은 기능 결함 finding 의 keep/drop 판정에 대한 것이다 — 중복·과도 추상화·명명 같은 클린 코드 지적은 이 판정에 넣지 않고 `clean-code` 분류로 따로 모아 클린 코드 라운드(클린 코드 라운드 블록)가 다룬다.
- 기능 결함이라 **주장**했으나 실행으로 입증하지 못한 finding 은 drop 하지 않고 **residual 로 사용자 결정**에 올린다.
- 기록 finding 은 실행으로 입증된 것이므로 residual 로 올리지 않는다.
- kept finding 을 차단(`block`)과 기록(`record`)으로 가르는 것은 리뷰어가 아니라 리드(분류기)다.
- AC 를 어기거나, 실제 호출 경로에서 재현되거나, 데이터를 잃거나, 비밀을 노출하거나, 인증·권한을 우회하는 kept finding 은 차단이다 — 보안 finding 은 입력이 드물어도 차단이고, 선언된 계약을 깨는 값의 조용한 손실과 평범한 올바른 입력의 거부는 입력을 어떻게 만들었든 차단이다.
- 실패하는 테스트로 입증됐지만 실제 호출 경로가 없거나 보장 범위 밖인 kept finding 은 drop 하지 않고 기록(`declared_limit`)으로 분류해 고치지 않으며, 증거와 함께 선언된 한계 목록 `declared_limits[]` 에 올리고, 사용자는 그것을 차단으로 올릴 수 있다 — 차단 조건에 드는 finding 은 실제 호출 경로가 없거나 입력을 만들어 냈어도 기록으로 분류하지 않는다.
- residual finding 이 하나라도 남으면 이 실행은 `TASK_DONE` 이 아니라 `NEEDS_USER` 로 끝난다 — 상위 오케스트레이터는 그 residual 을 사용자가 결정하기 전까지 step 승급·lane 병합으로 넘어가지 않는다.
- 라운드 상한에 닿거나 토큰 예산을 넘거나, 차단 kept finding 이 남은 채 수렴 가드로 끝나거나, 앞 회차 수정이 만든 차단이 과반이어서 멈춘 실행도 `TASK_DONE` 이 아니라 `NEEDS_USER` 로 끝난다.
- keep/drop 판정과 4분류는 고정 매핑이다: 차단 kept→`immediate_fix`, 기록 kept→`declared_limit`, residual→`discussion_needed`(`rejected` 로 보낼 수 없다), dropped→`rejected`.
- keep 의 증거로 제출한 테스트는 현재 코드에서 **red 임을 실행으로 확인**한 뒤에만 인정하고, 그 테스트가 회귀 테스트가 되어 fix 후 green·뮤테이션으로 확인한다.
- 리뷰어는 기능 결함으로 의심되는 모든 finding 에 실행 입증을 시도해야 하며, 시도 없이 주장만 한 finding 은 리뷰어 자신의 결함으로 기록한다.

산문 문서는 애초에 리뷰 범위에 들어오지 않는다(§11). 산문 델타 프로토콜은 `_shared/kiwi/verify-loop.md` §10 이 소유하며, 그것을 부르는 것은 이 스킬이 아니다.

### 4.1.p PR 모드 수집 — PR 모드 전용 (`references/conditional-sections.md`)

셀프 모드(기본)에서는 적용되지 않는다. **PR 모드**로 진입한 경우에만 `references/conditional-sections.md` 의 §4.1.p (gh CLI 수집 알고리즘과 finding 정규화 schema)를 읽는다.

---

## 5. Phase 2 — Finding 4분류 (분류기 ×1, §0.G5)

분류기 spawn:
입력:
- `review_inventory.json`
- 변경 파일의 git diff 본문
- (PR 모드) PR title/body, base branch (의도 파악)
- (셀프 모드) 활성 target REQ 인벤토리 (의도 파악)

출력: `classified_findings.json`
```json
{
  "immediate_fix": [
    { "id": "FND-001", "rationale": "...", "estimated_complexity": "trivial|small|medium", "is_behavioral": true | false, "tags": ["bug", "regression", "security", "performance"] }
  ],
  "declared_limit": [
    { "id": "FND-005", "rationale": "...", "evidence": "실패하는 테스트와 그 출력", "limit_reason": "no_real_call_path|outside_guarantee_scope" }
  ],
  "kept_tiers": [
    { "id": "FND-001", "tier": "block|record", "family": "계열 이름", "introduced_by_round": null | N, "family_action": null | "standard-tool|single-rule|declare-limit" }
  ],
  "discussion_needed": [
    { "id": "FND-003", "rationale": "...", "questions_for_user": ["..."] }
  ],
  "rejected": [
    { "id": "FND-007", "rationale": "...", "rejection_category": "dropped|out_of_scope|already_intended|external_library|misunderstanding" }
  ]
}
```

분류 검증 (메인 게이트):
- `unclassified` 0건 확인 (§0.G5)
- 합계 = `review_inventory.findings.length` 검증 — 네 키(`immediate_fix` · `declared_limit` · `discussion_needed` · `rejected`)를 더한다
- `kept_tiers[]` 는 kept finding 마다 정확히 한 항목이고, `tier` 가 `block` 이면 그 finding 은 `immediate_fix` 에, `record` 이면 `declared_limit` 에 든다. `introduced_by_round` 는 그 finding 을 만든 앞 회차 수정의 회차 번호이며 없으면 null 이다
- 위반 시 분류기 재호출 (최대 2회)

### 5.1 discussion_needed 처리

`--auto` 활성 시:
- keep/drop 가드레일 SSOT 는 §0.12. 본 절은 §0.12 의 가드레일을 인용하여 discussion_needed 항목에 적용한다 (차단 kept → immediate_fix 로 강제 재분류, 분류기에게 fix 가설 요구 / 기록 kept → declared_limit 유지, 고치지 않고 자동 보고 — 차단으로 올리지 않는다 / dropped → rejected 로 강제 재분류, 사유: "auto mode dropped finding" / residual → 재분류하지 않고 사용자 결정 유지).
- **분류기 fix 가설 생성 실패 fallback**: 강제 재분류 요구에도 분류기가 immediate_fix 의 fix 가설 (rationale + estimated_complexity) 을 생성하지 못하면, 해당 finding 은 discussion_needed 상태로 유지하고 사용자 게이트로 강제 복귀 (무한 루프 방지).

`--auto` 부재 시:
- 모든 discussion_needed 에 대해 AskUserQuestion (단일 호출에 옵션 분해): 각 finding 별 (fix-now / reject-with-reason / defer-to-user-later)

### 5.1.1 declared_limit 처리

- 고치지 않는다. 증거와 함께 `state.json.declared_limits[]` 와 보고서(§7.1)에 올린다.
- 사용자가 차단으로 올린 항목은 `kept_tiers[].tier` 를 `block` 으로 바꿔 `immediate_fix` 로 옮긴다. `--auto` 는 이 승격을 하지 않는다.

### 5.2 rejected 처리

- 사유 기록 → `rejected_findings.log`
- PR 모드 + 응답 활성 시: PR 응답 코멘트에 거절 사유 명시 (§7 의 응답 코멘트 본문)

---

## 6. Phase 3~7 — TDD + Fix + 재검증 + 회귀

### 6.0 회귀 테스트 기준선 캡처 (델타 판정 SSOT)

본 스킬은 kiwi-coder 를 거치지 않는 코드 변경 경로이므로, 회귀 판정도 kiwi-coder §6.1.0 / §6.1.3 과 같은 형태를 쓴다 — 같은 파이프라인 안의 두 수정 주체가 다른 판정을 하면, 한쪽에서 관용되는 사전 실패가 다른 쪽에서 발산 게이트로 올라간다.

- **기준선 캡처**: **코드를 바꾸기 전에** 전체 회귀 스위트를 1회 실행해 기준선 결과를 저장한다. 캡처 시점은 Phase 3 회귀 테스트 작성 이전 (§3.0 preflight 4번) 이며, 결과는 `state.regression_baseline` 에 고정한다
- **델타 판정**: 회귀 여부는 기준선 대비 **델타로 판정**한다 — 기준선에서 pass 였는데 이번 실행에서 fail 한 test 만 이 fix 가 만든 **신규 실패**다
- **기존 실패 귀속 금지**: 기준선에 이미 있던 **기존 실패**는 그대로 **보고하고** 현재 fix 의 것으로 **귀속하지 않는다** — 남의 실패를 좇는 동안 이 스킬의 개선 루프가 발산한다
- **캡처 실패 격하**: 테스트 명령은 있는데 캡처 자체가 실패하면 `state.json.regression_baseline = null` 로 두고, 이 run 의 회귀 판정은 델타 없이 실패 전량 보고로 격하하며, 클린 코드 라운드는 돌지 않는다(클린 코드 라운드 블록). 두 사실을 보고서에 명시한다. 테스트 명령이 없으면 이 격하가 아니라 `--skip-regression` 자동 활성이 적용된다
- **부모 기준선 우선**: `--regression-baseline` 으로 상위 오케스트레이터가 pin 한 기준선을 받으면 그 값이 자기 시점 캡처보다 **우선한다** — 값이 주어지면 자체 캡처를 수행하지 않고 전달된 기준선을 `state.regression_baseline` 에 그대로 고정한다. 방금 만들어진 실패를 "기존 실패"로 분류해 `TASK_DONE` 을 반환하는 것이 wave 게이트와 정면으로 어긋나기 때문이다.

### 6.1 Phase 3 — 회귀 테스트 작성 (TDD 조건부, §0.3)

`immediate_fix` 큐의 각 finding 중 다음 조건 만족 항목에 회귀 테스트 선행 작성:
- `is_behavioral = true` (셀프 모드 까칠 리뷰어 산출의 필드)
- 또는 finding 의 `tags` 에 `bug` / `regression` / `security` / `performance` 중 1개 포함

시니어 fixer 서브에이전트가 다음 수행:
1. finding 의 location 과 description 기반 회귀 테스트 작성
2. 테스트 실행 → red (의도된 fail) 확인
3. red 시그니처를 `state.json.finding_queue[i].red_signature` 에 저장

면제 finding 은 worklog `tdd_exempted { finding_id, reason_enum: style_only|naming|formatting_only|comment_only|clean_code }` append + Phase 4 직행.

### 6.2 Phase 4 — 시니어 fixer 적용 (서브에이전트)

시니어 fixer 서브에이전트 (§0.1 의무):
입력:
- finding 본문 (한 fixer = N개 finding batch 가능, 단 동일 파일·인접 hunk 그룹화)
- 회귀 테스트 (Phase 3 산출) + red 시그니처
- 변경 파일의 현재 상태
- (선택) finding 의 suggested_fix (있을 때만)
- finding 의 `family` 와, 계열 재발이면 리드가 고른 `family_action` (`standard-tool` | `single-rule` | `declare-limit`)

**계열 재발.** 같은 계열(`family`)의 kept finding 이 앞선 두 회차 이상에서 나온 뒤 다시 나오면, 리드는 표준 도구 쓰기(`standard-tool`)·한 규칙으로 통합(`single-rule`)·한계 선언(`declare-limit`) 중 정확히 하나를 골라 `family_action` 으로 기록하고, fixer 는 그 구성원 하나만 덧대지 않고 그 선택을 적용한다.

출력:
- 패치 적용 (cwd 내 파일 직접 수정)
- `fix_iter{N}.json`:
  ```json
  {
    "iter": N,
    "fixes": [
      {
        "finding_id": "FND-001",
        "files_changed": [{ "path": "src/x.ts", "line_range": "45-67", "loc_changed": K }],
        "rationale_strip": "(평가자 전달용 — 비어있음, §0.2)",
        "rationale_full": "...",  // 메인 보고서용
        "mock_scan_passed": true,
        "external_module_touch": false
      }
    ]
  }
  ```

Mock 금지 (§0.4) regex 자동 탐지 — 위반 시 kept finding → Phase 4 재진입 (fixer 자체에게 재시도 요구).

cwd 외부 path 편집 시도 (§0.5 / §0.G4) — 즉시 중단.

클린 코드 수정이 위 두 검사에 걸리면 중단하지 않는다 — §0.G8 의 클린 코드 예외(클린 코드 라운드 블록의 **테스트.**)를 따른다.

### 보존 스캔 (fixer diff, §0.17)

fixer pass 가 적용한 **diff** 를 스캔한다 — **기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화**, **기존 public 심볼의 삭제·시그니처 변경**, **비-테스트 기존 파일의 삭제·이동** 중 하나라도 검출되면 **CRITICAL** 로 올리고 §0.G8 의 대응 게이트(`existing-test-weakened-or-deleted` / `existing-public-contract-change` / `existing-file-deleted-or-moved`)로 중단한다. 판정 기준은 `kiwi-coder §0.20.1~§0.20.3`.

클린 코드 수정에서 검출된 경우만 예외다 — 게이트로 중단하지 않고 클린 코드 라운드 블록의 **테스트.** 규칙대로 그 수정을 되돌리고 `unresolved` 로 표시한다. 기능 결함 수정과 채우기 서브에이전트의 diff 에는 위 중단이 그대로 적용된다.

스캔은 까칠 리뷰어 **재검증(re-review)보다 먼저** 수행한다 — 뒤에 두면 약화된 테스트가 먼저 clean 판정을 받는다.

### 6.3 Phase 5 — 까칠 리뷰어 재검증 (서브에이전트, §0.2 격리)

까칠 리뷰어 spawn (Phase 1.s 와 동일 prompt 골격, 단 입력 변경):
입력:
- 회차 범위의 diff — 아래 **회차 범위** 가 정한 범위의 diff (전체 범위로 넓힌 회차는 전체 범위의 diff)
- 직전 라운드의 finding 목록 (단 `rationale_strip` 만, `rationale_full` 금지)
- 본 라운드의 새 finding 만 식별 요구 + 직전 finding 의 해소 여부 평가
- `review_denominator[]` — 2회차부터는 회차 범위(FR-NODE-274 AC-2)를 대상으로 루프가 다시 고정하고 `hunks_total` 을 다시 센 분모 (§12). 라운드마다 다시 세는 이유는 fix 가 hunk 경계를 옮기기 때문이다

출력: `prickly_recheck_iter{N}.json` (Phase 1.s 와 동일 schema + `resolved_findings: [FND-id...]` + `coverage_rows`)

**회차 범위.** 2회차부터 리뷰 범위의 기본값은 `check_review_round` 가 정하는 회차 범위(FR-NODE-274 AC-2)이며, 전체 범위로 넓히는 것은 사유를 `scope_widen_reason` 에 기록하는 명시적 결정이다. 회차 범위는 직전 회차 `tree_sha` 와 이번 회차 `tree_sha` 사이에서 달라진 파일을 §11 부류 필터로 거르고 `.kiwi/` 아래 경로를 뺀 것과, 리드가 고른 그 변경이 닿는 파일이다. 각 회차의 리뷰를 시작할 때(1회차인 Phase 1 포함) 리드는 작업 트리를 임시 인덱스로 스냅숏해 tree 로 쓰고 그 값을 `rounds[].tree_sha` 에 기록한다 — 커밋하지 않으며 실제 인덱스·HEAD·ref 는 건드리지 않고, 끝나면 `<tmp>` 를 지운다:

```
GIT_INDEX_FILE=<tmp> git read-tree HEAD
GIT_INDEX_FILE=<tmp> git add -A
GIT_INDEX_FILE=<tmp> git write-tree
```

### 6.4 Phase 6 — 개선 루프 (차단 kept 카운터)

종료 게이트는 **차단 kept finding 이 0** 일 때만 통과하고 기록(`declared_limit`) finding 은 통과를 막지 않는다 — 이것이 기존 `CRITICAL=0 + HIGH=0` 게이트를 대체한다.

차단 kept finding 이 하나라도 남아 있으면 루프는 라운드 상한·토큰 예산·수렴 가드 안에서 계속 돈다.

| 종료 조건 | 판정 |
|---|---|
| 차단 kept 0 (resolved 제외한 new + 잔존) + 커버리지 대조 통과 + residual 0 | PASS |
| 새로 해소된 차단 kept 가 0 인 라운드 2회 연속 | 수렴 가드 종료 — 차단 kept 가 남았으면 `NEEDS_USER` (PASS 아님) |
| 차단 kept 가 남은 채 라운드 상한 소진 또는 토큰 예산 초과 | `NEEDS_USER` + 차단·기록 목록 (PASS 아님, `round-cap-or-budget-needs-user`) |
| 그 회차 차단 중 앞 회차 수정이 만든 것이 절반 초과 | `NEEDS_USER` + 차단·기록 목록 (`fix-induced-defects-majority`) |

기본 라운드 상한은 **Normal 5 / `--max` 8 / `--mini` 3** 이며, 차단 kept finding 이 남은 채 상한에 닿거나 토큰 예산을 넘으면 통과가 아니라 차단·기록 목록과 함께 `NEEDS_USER` 로 끝난다. `--loops N` 이 주어지면 상한은 N 이다 (§0.16).

수렴 가드는 finding-hash 일치가 아니라 **새로 해소된 차단 kept 가 0 인 라운드가 2회 연속**이면 종료하며, 차단 kept finding 이 남은 채 수렴 가드로 끝난 실행은 통과가 아니라 `NEEDS_USER` 로 끝난다. 앞 회차 수정이 만든 차단의 과반 멈춤(FR-FLOW-229 AC-6)은 연속 횟수와 별개로 매 회차 검사하며, 먼저 걸린 쪽이 실행을 끝낸다.

**회차 검사.** 회차가 끝날 때마다 읽기 전용 검사 `check_review_round`(CLI `speckiwi review-round check`)를 부르고, 범위·앞 회차 수정의 과반·통과·상한이나 예산 멈춤에 대해 그 검사가 돌려준 판정(`PASS` · `NEEDS_USER` · `CONTINUE`)을 따른다. 검사가 범위 실패를 보고하면 그 회차는 통과로 세지 않고, 빠진 파일을 넣어 그 회차 리뷰를 다시 한다.

**통과.** 차단 kept finding 이 0 이고 리뷰 커버리지 대조(FR-FLOW-171)가 통과하고 residual 이 남지 않았을 때(FR-FLOW-203 AC-11) 실행이 통과하며, 기록 finding 은 통과를 막지 않는다.

**멈춤.** 차단 kept finding 이 남은 채 최근 회차 번호가 `limits.round_cap` 에 닿거나, `limits.token_budget` 이 null 이 아니고 회차별 `tokens_used` 합이 그것을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈추고 통과로 기록하지 않는다 — `limits.token_budget` 이 null 이면 예산 멈춤은 없다. 한 회차의 차단 kept finding 중 앞 회차 수정이 만든 것(`introduced_by_round` 가 그 회차보다 앞선 것)이 그 회차 차단의 절반을 넘으면 차단·기록 목록과 함께 `NEEDS_USER` 로 멈춘다. 이 두 멈춤은 `--auto` 의 결정 서브에이전트가 풀지 못한다(critical gate `round-cap-or-budget-needs-user` · `fix-induced-defects-majority`).

**커버리지 대조를 통과한 라운드만 PASS 가 된다** — finding 개수만으로는 PASS 가 나오지 않는다. 대조 결과는 §12 가 정하며, 무효 라운드는 어느 행에도 해당하지 않는다.

종료는 리뷰 커버리지 대조(FR-FLOW-171)가 차단 kept 0 게이트와 **함께** 통과할 때만 허용한다.

미충족 시 Phase 4 재진입 (잔존 차단 kept + 새 차단 kept 큐로). 카운터 초과 시 §0.G6 발동.

### 6.5 Phase 7 — 회귀 테스트 실행

1. Phase 3 회귀 테스트 실행 → green 확인. fail 시 Phase 4 개선 루프 편입 (kept finding 으로 계상)
2. `--skip-regression` 부재 시 영향 회귀 (변경 파일의 모든 테스트) 실행
3. 판정은 §6.0 의 기준선 델타를 적용한다 — 신규 실패 0건이면 다음 단계(Phase 7.4) 진입. 신규 실패 ≥1 → §0.G6 (2 연속 동일 fail 시 에스컬레이션). 기준선에 이미 있던 실패는 보고만 하고 진입을 막지 않는다
4. 결과: `regression_run.jsonl`

### 6.5.1 Phase 7.4 — 테스트 충분성 확인 (마지막 검증 단계)

요구 범위가 알려진 실행이면 회귀 뒤에 `_shared/kiwi/test-sufficiency.md` 의 확인을 돈다. 이 단계가 이 스킬의 마지막 검증이다 — 뒤에는 `--close-reqs` 승급(Phase 7.5)과 보고(Phase 8)만 온다.

| 범위를 정하는 입력 | 넘기는 범위 |
|---|---|
| `--close-reqs` | §6.6.1(`references/conditional-sections.md`)의 `eligible` 집합. 그 집합을 이 단계에서 먼저 만든다 — 분모와 교차는 read 이므로 §0.8 밖이다 |
| `--req-filter <id,...>` | 그 ID |
| `--sds <path>` | 위 두 입력이 없으면 그 lite SDS 가 `@req` 로 지명한 ID(MCP `check_sds` / `speckiwi sds check` 요약의 요구 ID). SDS 는 어느 경우든 `--sds` 로 함께 넘긴다 |
| 셋 다 없음 | 돌지 않는다 — 결과는 `no-scope` 이고 통과로 적지 않는다 |

입력이 여럿이면 표의 앞 행이 ID 를 정한다. `--close-reqs` 가 있으면 확인 범위는 언제나 승급할 `eligible` 전부다 — `--req-filter` · `--sds` 는 §6.6.1 에서 `scoped` 를 정하는 데 쓰이고 확인을 그 밖으로 따로 좁히지 않는다. 승급하는 집합 전부가 확인을 거쳐야 하기 때문이다.

워커 워크트리 같은 linked worktree 에서 돌면 확인은 그 워크트리를 읽는다 — MCP `check_test_sufficiency` 에 `workspaceRoot` = 그 워크트리 절대 경로를 주고, CLI 면 그 워크트리를 cwd 로 부른다(`_shared/kiwi/test-sufficiency.md` §3 1번). 채우기 서브에이전트도 그 워크트리에서 쓴다.

`--close-reqs` 면 이 단계의 끝에서 `_shared/kiwi/test-sufficiency.md` §4 대로 증거로 쓸 인용의 테스트 파일을 실행하고, 그 실행에서 통과한 테스트의 인용만 Phase 7.5 에 넘긴다 — 실패했거나 skip 되었거나 실행되지 않은 인용의 AC 는 gap 으로 남고, gap 이 남으면 `test-sufficiency-gap` 을 올린다. 도구는 인용을 읽을 뿐 테스트를 실행하지 않으므로, 바뀌지 않은 파일의 인용이나 `skip` 된 테스트의 인용이 이 실행 없이 증거가 되지 않게 한다.

채우기 서브에이전트(계약 §3)는 §0.1 의 시니어 fixer 와 별개로 새 테스트만 쓰는 두 번째 코드 작성자다. 그 diff 에도 §6.2 의 보존 스캔을 적용한다. `--dry-run` 이면 채우기와 재실행 없이 처음 결과만 보고한다 (계약 §3).

결과는 `test_sufficiency.json`(계약 §5 형태)에 남긴다. `test-sufficiency-gap` 이 올라가면 이 실행은 사용자 결정을 기다리며, `TASK_DONE` 으로 끝나지 않고 Phase 7.5 승급에 들어가지 않는다.

### 6.6 Phase 7.5 — REQ 승급 — `--close-reqs` 전용 (`references/conditional-sections.md`)

`--close-reqs` 는 기본 off 이므로 이 절은 기본 호출에서 실행되지 않는다. `--close-reqs` 가 활성일 때만 `references/conditional-sections.md` 의 §6.6 (영향 REQ-ID 추출 · MCP 호출 · 멱등성 · 산출물)을 읽는다. 게이트 자체는 §0.G7 이 본문에 그대로 둔다.

---

## 7. Phase 8 — 보고서 + PR 응답 + pipeline emit

### 7.1 보고서

`docs/analysis/kiwi-review-fix-loop-{run-id}/report.md`:

```yaml
---
run_id: ...
mode: self|pr
mode_flags: [...]
pr_url: null | "https://..."
findings_total: N
classified: { immediate_fix: A, declared_limit: D, discussion_needed: B, rejected: C }
blocking_kept: N  # 마지막 회차에 남은 차단 kept 수
declared_limits: [...]  # 기록 finding — id · 사유 · 증거
scope_widen_reasons: [...]  # 전체 범위로 넓힌 회차와 그 사유
fix_iter: N
recheck_iter: M
regression_pass: true|false
test_sufficiency: pass|gap|no-scope  # §6.5.1
closed_reqs_count: N | null  # --close-reqs 활성 시에만, 비활성 시 null
pr_responded: true|false
---
```

본문 섹션:
1. 사용된 플래그 + 비용 배수
2. 모드 결정 + 범위
3. Finding 인벤토리 요약 (셀프: axis 별 / PR: source 별 + author 별)
4. 4분류 결과 (immediate_fix / declared_limit / discussion_needed / rejected) + 각 분류별 finding 목록
5. 적용된 fix 요약 (finding_id → 파일·라인·rationale)
6. 까칠 리뷰어 재검증 결과 (라운드별 resolved / new finding)
7. 회귀 테스트 실행 결과
8. (PR 모드) PR 응답 코멘트 본문 (작성된 경우)
9. 거절된 finding 사유 (rejected_findings.log 인용)
10. drop 한 finding 은 **사유와 함께** 보고하고 residual 은 **목록으로** 보고한다 — silent truncation 은 하지 않는다. 기록 finding 은 선언된 한계(`declared_limits[]`)로 **증거와 함께** 목록으로 보고한다 — 사용자는 그 가운데 차단으로 올릴 항목을 고른다. (사후 검토 권고)
11. (`--close-reqs` 활성 시) REQ verified 전이 결과 — `closed_reqs.json` 인용 (transitioned / skipped / failed 통계 + 영향 REQ-ID 목록 + evidence 경로)
12. 제외한 산문 전량 (`excluded_prose[]`) · 거부한 아티팩트 전량 (`refused_artifacts[]`) · 분류되지 않은 파일 전량 (`unclassified_files[]`) + 항등식 확인
13. 리뷰 커버리지 대조 결과 (§12) — 라운드별 `review_denominator[]` 크기 · 파일별 `hunks_total` 과 앵커 개수 · 무효 판정이 있었다면 어긋난 앵커 문자열
14. 테스트 충분성 확인 결과 (§6.5.1) — `test_sufficiency.json` 의 verdict · 넘긴 범위 · 처음과 마지막 gap · 채우기로 더한 테스트
15. 메타 (실측 토큰, 시간)
16. 클린 코드 라운드 결과 — 돈 라운드 수 · 고친 지적 · `dismissed`(사유) · `unresolved`(되돌린 수정의 실패 출력 포함 — `dismissed` 지적은 넣지 않는다) · 건너뛰었으면 그 사실과 이유
17. 보장 범위(`guarantee_scope`) · 회차별 범위(`scope` · `scope_widen_reason`) · 회차별 `check_review_round` 판정

### 7.2 PR 응답 코멘트 — PR 모드 전용 (`references/conditional-sections.md`)

셀프 모드(기본)에서는 적용되지 않는다. **PR 모드** + `--no-respond` 부재일 때만 `references/conditional-sections.md` 의 §7.2 (`pr_response.md` 양식과 게시 절차)를 읽는다.

### 7.3 Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴 적용. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-review-fix-loop"` (pipeline-event.md §3 의 skill enum 에 등재됨)
- `status`: 모든 immediate_fix 처리 + 회귀 PASS **+ 승급 결과 조건** = `TASK_DONE`; discussion_needed 가 사용자 대기이거나 `check_review_round` 가 `NEEDS_USER` 를 돌려준 실행(라운드 상한·토큰 예산·앞 회차 수정의 과반, 차단 kept 가 남은 수렴 가드 종료 포함) = `NEEDS_USER`; dry-run = `DRY_RUN`; 실패 = `FAILED`. **승급 결과 조건**: `--close-reqs` 활성 실행에서 `eligible` 이 **1 이상인데 전이 0건**이면 `TASK_DONE` 을 반환하지 않는다 — `FAILED` 다. 처분 대조가 어긋난 실행도 마찬가지다. `--close-reqs` 가 없는 실행에는 이 조건이 적용되지 않는다. 값은 `_shared/kiwi/pipeline-event.md` §2 의 enum 안에서만 고른다 — 새 값을 만들지 않는다
- `next_hint`: 통상 `"kiwi-commit-auto-push"` (PR 모드는 PR 푸시 이미 됨 — `null` 권장), `NEEDS_USER` 로 끝난 실행은 `null`
- `artifacts.analysis_dir`: `docs/analysis/kiwi-review-fix-loop-{run-id}/`
- `notes`: "mode=self|pr / findings=N / fixed=A / rejected=C / recheck_iter=M" 권장


**오케스트레이션 위임 — `--no-pipeline-emit`**

- **`--no-pipeline-emit`** — **인자를 받지 않는다**. 명시하면 본 절의 `kiwi/pipeline.jsonl` append 를 수행하지 않는다. 플래그가 **없으면** 기존 emit 동작이 그대로다.
- 오케스트레이터의 실행기는 **매 unit** 실행마다 `--no-pipeline-emit` 을 넘긴다. 빠뜨리면 그 unit 이 **거짓 파이프라인 기록**을 남긴다 — 저널에는 `kiwi-review-fix-loop` run 하나가 완료한 것으로 보이지만 실제로는 한 wave · 한 stage 의 unit 하나가 끝났을 뿐이고, 그 기록을 부모가 자식 대신 정정하는 것은 허용되지 않는다.
- `kiwi-pipeline` 은 `--no-pipeline-emit` 을 **갖지 않는다** — 오케스트레이션된 unit 이 `kiwi-pipeline` 을 호출하지 않기 때문이다.

---

## 8. 호출 예시

### 셀프 모드

```
/kiwi-review-fix-loop
/kiwi-review-fix-loop --files=src/auth.ts,src/session.ts
/kiwi-review-fix-loop --since=2026-05-20
/kiwi-review-fix-loop --commits=HEAD~3
/kiwi-review-fix-loop --base=develop --head=HEAD
/kiwi-review-fix-loop --max
/kiwi-review-fix-loop --model claude-sonnet-4-6
/kiwi-review-fix-loop --auto
/kiwi-review-fix-loop --dry-run
/kiwi-review-fix-loop --resume
```

### PR 모드

```
/kiwi-review-fix-loop --pr
/kiwi-review-fix-loop -pr
/kiwi-review-fix-loop --PR
/kiwi-review-fix-loop -PR
/kiwi-review-fix-loop --pr=https://github.com/owner/repo/pull/42
/kiwi-review-fix-loop --pr --no-respond
/kiwi-review-fix-loop --pr --auto --model claude-sonnet-4-6
```

### 자연어 매핑 예시

- "현재 변경물 셀프 리뷰해줘" → 셀프 모드 (기본)
- "이 PR 리뷰 읽고 수정해줘" → PR 모드 자동 활성
- "https://github.com/.../pull/42 의 코멘트 적용" → `--pr=URL` 자동 매핑
- "pr 응답해줘" → PR 모드, 응답 활성

---

## 9. 기존 스킬과의 경계

| 시나리오 | 사용 스킬 |
|---|---|
| 긴급 버그 fix + SRS 사후 동기화 | `/kiwi-hot-fix` |
| 코드 변경 → SRS 사후 동기화 (단독, 리뷰 없음) | `/kiwi-srs-sync` |
| 합의된 SDS 구현 (리뷰 내장) | `/kiwi-coder` (까칠 리뷰 Phase 2.f 내장) |
| **셀프 리뷰 단독 또는 PR 리뷰 응답** (본 스킬) | `/kiwi-review-fix-loop` |
| 신규 기능 SRS 작성 | `/kiwi-srs` |

본 스킬과 `/kiwi-coder` 의 까칠 리뷰는 다음 점에서 다르다:
- `/kiwi-coder` 의 까칠 리뷰는 SDS 기반 구현 직후 1회 (개선 루프 포함)
- 본 스킬은 SDS 없이도 임의의 코드 변경 / PR 코멘트 / 머지 전 게이트 등에 단독 사용

---

## 10. Out of Scope

| 범위 밖 | 담당 스킬 |
|---|---|
| 신규 기능 개발 | `/kiwi-srs` → `/kiwi-pm` (`--sds` 면 그 사이에 `/kiwi-sds`) |
| 긴급 fix + SRS sync 위임 | `/kiwi-hot-fix` |
| MCP mutation 직접 호출 | `/kiwi-srs-sync` 또는 `/kiwi-srs` (본 스킬은 §0.8 으로 금지) |
| git commit / push | 사용자 결정 또는 `/kiwi-commit-auto-push` |
| PR 생성 (없는 PR 새로 만들기) | 사용자 또는 `/kiwi-commit-auto-push` |
| 구현 설계 (SDS) 작성 — 사용자가 요청할 때 | `/kiwi-sds` |
| 통합 테스트 | `/kiwi-coder` Phase 4 |

---

## 11. 파일 부류 경계 — 이 스킬이 무엇을 보는가

본 스킬은 **코드를 리뷰한다.** 그런데 "코드" 는 형용사이고 형용사는 우기는 대상이 되므로, 대상은 아래 **닫힌 목록**으로 정한다. 목록에 없는 부류는 대상이 아니다.

| 부류 | 대상 | 사유 |
|---|---|---|
| 소스 코드 파일 | ○ | 본 스킬의 존재 이유 |
| 테스트 파일 | ○ | **테스트 파일은 코드다.** 범위에서 빼면 §0.17 의 `existing-test-weakened-or-deleted` 게이트가 지킬 대상을 잃는다 |
| 설정 파일 — `package.json` · `tsconfig.json` · CI yaml 등 **파일명으로 지명한 것** | ○ | **설정 파일은 코드다.** 실행 동작을 바꾸고 결함이 빌드·테스트로 재현된다 |
| 코드 파일 안의 주석 | ○ | **주석은 코드다.** 다만 강도는 종전대로다 — `@req` 실존은 기계 검사, 안전 게이트에 붙은 why-주석은 작성 시점 1회, 코드를 재서술하는 주석은 리뷰가 아니라 삭제다 |
| `SKILL.md` 등 에이전트 지시문 | ✗ | 산문이며 계약 등급이다. 이 루프가 자기를 구속하는 규칙을 고치는 경로는 열지 않는다 |
| `README.md` | ✗ | 산문이다 |
| `docs/spec/**` 의 SRS 문서 | ✗ | 산문이며, 그 전에 §0.8 이 이미 SRS mutation 을 금지하고 `/kiwi-srs-sync` 위임을 지시한다 |

**판정 순서** — 아래 순서로 평가하며 앞선 행이 뒤의 행을 이긴다. 순서를 적지 않으면 두 규칙이 모두 참인 채로 같은 파일을 반대로 판정한다.

1. **가장 먼저, 아래 목록을 거부한다.** `*.jsonl` 저널 · `*.lock` · `*.lock.json` · `resume-card.json` · run contract · `routing/probe.json` · `design/constraints.json` 을 **수정·삭제·되돌리지 않는다.** 이 목록의 구성 원리는 **run 이 동결로 선언한 것**이며, 새 동결 산출물이 생기면 그 원리에 따라 **목록에 추가한다.** 원리를 기준 자체로 삼지 않는 이유는 이 스킬이 그 선언에 닿을 인자를 갖고 있지 않기 때문이다 — 읽을 수 없는 기준은 "확인할 수 없으니 동결된 것이 없다"로 처리되어 fail-open 이 되고, 그러면 `.lock.json` 이 아닌 동결 산출물이 위 표의 "설정 파일은 코드다" 행에 그대로 삼켜진다. 닫힌 목록은 그 방향이 반대다. 되돌린 lock 한 줄은 오류를 내지 않고 다음 재개에서야 터진다. 자기 run 이 소유한 아티팩트에 **append 하는 것은 허용**한다.
2. 위 표의 부류 판정.
3. 앞의 세 처분(포함 · `excluded_prose` · `refused_artifacts`) 어디에도 들지 않는 것(바이너리·에셋 등)은 `unclassified_files[]` 에 싣는다. 버킷을 늘리는 것이 항등식을 포기하는 것보다 낫다 — 분류되지 않은 파일이 조용히 사라지면 항등식이 그것을 숨긴다.
4. 남은 것이 리뷰 대상이다.

**범위 결정과의 관계** — 본 절은 §0.14 가 산출한 후보 목록에 붙는 **후처리**이며 §0.14 를 대체하지 않는다. 부류 필터는 후보 목록이 만들어진 **직후**, 까칠 리뷰어를 spawn 하기 **전**에 적용한다. 뒤에 두면 고칠 수 없는 finding 이 §6.4 의 kept 카운터에 들어가, 루프가 영원히 통과하지 못하거나 게이트를 맞추려고 결국 그 문서를 고치게 된다.

**커밋 창은 사람의 지목이 아니다** — `--base`/`--head` · `--commits` · `--since` 는 부류 필터를 **면제하지 않는다.** `kiwi-orchestrator` 는 §15 일정에 따라 `docs/research/{work}/` 아래 run 아티팩트를 커밋한 **다음** 그 커밋 범위를 이 스킬에 창으로 넘긴다. 연구·설계 산문이 실제로 리뷰에 들어온 경로가 이것이며, 창을 지목으로 인정하면 주 경로가 그대로 필터를 면제받는다. **`--files` 만** 사람이 파일을 지목한 것으로 인정하고, 그 목록에 든 산문은 제외 사실과 사유를 **보고**한 뒤 코드만 진행한다. 지목이 전부 산문이면 진행하지 않는다.

**제외는 전수 열거한다** — 제외한 산문을 `mode_decision.json.self_scope.excluded_prose[]` 에 **빠짐없이** 싣고 보고서에도 그대로 낸다. 개수나 표본으로 줄이지 않는다. 판정 순서 1 이 거부한 저널·lock 은 `refused_artifacts[]` 에 따로 싣는다 — 코드도 산문도 아니므로 어느 쪽 버킷에 넣어도 이름을 속이게 된다. 그리고 **항등식**이 성립해야 한다: 포함한 파일 수와 `excluded_prose[]` 와 `refused_artifacts[]` 와 `unclassified_files[]` 의 수를 더한 값이 후보 수와 같아야 한다. 항등식이 없으면 규칙을 지킨 run 과 규칙을 잊은 run 이 똑같은 산출물을 남긴다.

**빈 범위는 통과가 아니다** — 필터 후 코드 대상이 **0건**이면 PASS 를 보고하지 않고 `empty-code-scope` 로 **중단**한다. 아무것도 보지 않은 실행이 품질 게이트 통과로 기록되면, 빈 기준선이 깨끗한 기준선과 구별되지 않는다.

**알려진 한계**: 후보가 처음부터 전부 산문이면 이 중단이 오케스트레이터의 종료 hop 과 충돌한다. 그 hop 은 통과 판정을 기록하는 모든 경계가 이 스킬을 정확히 한 번 거치도록 요구하는데, 준비된 면제 분기의 술어는 **커밋 창의 공백**이라 산문 커밋이 든 창에는 걸리지 않는다. 요구나 설계 문서만 산출한 wave 가 여기 해당한다. 해소하려면 `FR-FLOW-131` 이 소유한 그 술어를 넓히거나 별도 verdict 을 도입해야 하며, 둘 다 요구 수준의 결정이라 이 절이 정하지 않는다. **`FR-FLOW-152` 의 후속으로 남긴다.** 단 `_shared/kiwi/parallel-waves.md` PW-12 의 stage 마감 호스트 hop 은 부르기 전에 창의 파일을 이 절의 부류 표로 걸러, 코드 파일이 없으면 이 스킬을 부르지 않고 `no-host-code-commits` 를 기록한다 — 그 경계에서는 이 충돌이 생기지 않는다.

**산문 finding 은 어디로 가는가** — 부류 밖 문서에서 눈에 띈 문제는 §0.8 이 SRS finding 에 쓰는 것과 같은 채널로 흘린다: 고치지 않고 보고하며, 담당 스킬을 지목해 위임을 권고한다.

---

## 12. 리뷰 커버리지 분모 — 리뷰어가 무엇을 열었는가

§11 의 항등식과 본 절은 대상이 다르다. 항등식은 후보 파일이 **어느 버킷에 들어갔는지**를 세고, 본 절은 포함 버킷의 **각 hunk 를 리뷰어가 실제로 처리했는지**를 대조한다. 그러므로 항등식이 성립한다는 사실이 본 절을 대신하지 못한다 — 범위를 고르는 단계에는 분모가 있는데 그 범위를 읽는 단계에는 없었다는 것이 이 절이 생긴 이유다.

**분모는 루프가 고정한다.** 까칠 리뷰어를 spawn 하기 전에, 범위 결정이 산출한 `self_scope.files[]`(§11 의 포함 버킷)를 그대로 `review_denominator[]` 로 옮겨 리뷰어 프롬프트에 싣는다. 리뷰어가 스스로 정하지 않는다. 산문은 애초에 이 집합에 들어오지 않으므로(§11) 분모에도 넣지 않는다.

**2회차부터 분모는 회차 범위다.** 1회차의 분모는 위 `self_scope.files[]` 이고, 2회차부터는 `check_review_round` 가 정하는 회차 범위(FR-NODE-274 AC-2) — 직전 회차 리뷰가 읽은 스냅숏 `tree_sha` 와 이번 회차 리뷰가 읽는 스냅숏 `tree_sha` 사이에서 달라진 파일을 §11 부류 필터로 거르고 `.kiwi/` 아래 경로를 뺀 것과 그 변경이 닿는 파일 — 를 분모로 옮긴다. 전체 범위로 넓힌 회차(`scope` 가 `full`, 사유는 `scope_widen_reason`)만 다시 `self_scope.files[]` 를 분모로 쓴다.

**`hunks_total` 은 루프가 센다 — 리뷰어가 세지 않는다.** 분모의 파일마다 아래 명령으로 세어 `review_denominator[]` 의 각 항목에 `hunks_total` 로 함께 싣는다.

```
git diff -U0 <범위> -- <path> | grep -c '^@@'
```

`<범위>` 는 `self_scope.source` 가 정한 그 범위다. `-U0` 을 쓰는 이유는 컨텍스트 줄이 인접 hunk 를 병합해 개수를 줄이기 때문이다. **분모를 만든 범위, `hunks_total` 을 센 범위, 앵커를 대조하는 범위는 셋 다 같아야 한다** — 다르면 리뷰어가 아무 잘못 없이 무효 라운드를 받는다. 2회차부터 `<범위>` 는 `<직전 회차 tree_sha> <이번 회차 tree_sha>` 이고, 전체 범위로 넓힌 회차는 1회차의 범위로 되돌린다 — 그 변경이 닿는 파일 가운데 그 범위에서 바뀌지 않은 파일은 `hunks_total` 0 의 행으로 남는다.

**리뷰어 출력에 `coverage_rows[]` 가 추가된다.** `review_denominator[]` 의 **모든** 파일이 한 행씩 갖고, 각 행은 그 파일의 앵커 목록과 finding 이 붙었는지를 밝힌다. finding 0건인 파일도 행으로 남는다. 표본·발췌·상위 N 은 분모가 아니다.

**리뷰어는 hunk 마다 앵커 하나를 돌려준다.** 앵커는 그 hunk 안에서 **추가되거나 삭제된 줄**(`git diff -U0` 출력에서 `+` 또는 `-` 로 시작하되 `+++`·`---` 파일 헤더가 아닌 줄) 하나를 그대로 옮긴 인용이거나, 그 줄에서 추가·삭제된 심볼 이름이다. **`@@` 헤더 줄과 파일 경로는 앵커가 될 수 없다** — 그 둘은 루프가 이미 넘긴 값에서 그대로 만들어 낼 수 있으므로 그 hunk 를 열었다는 증거가 되지 못한다.

**루프가 앵커를 기계 대조한다.** 검사는 셋이다.

1. 각 앵커 문자열이 `git diff -U0` 출력의 **해당 hunk 본문 안**에 실제로 있다. **"있다"는 위 정의를 만족한다는 뜻이다** — 그 hunk 의 추가·삭제된 줄 하나와 **통째로 같거나**(앞뒤 공백만 다른 것은 같은 것으로 본다), 그 줄에 **토큰 경계로 실재하는 심볼 이름**이어야 한다 — **심볼 이름은 코드 토큰을 말하며, 산문의 낱말은 심볼 이름이 아니다.** **줄의 임의의 부분문자열은 앵커가 아니다.** 정의를 적어 두는 것과 검사가 그 정의를 강제하는 것은 다르고, 강제하지 않으면 정의는 아무것도 막지 못한다 — 부분문자열을 인정하면 diff 를 한 줄도 열지 않고 고른 흔한 한 글자 N 개가 서로 다른 hunk 에 하나씩 대응해 한 행을 통째로 채운다.
2. 한 파일 안에서 앵커 개수가 `hunks_total` 과 같고, 서로 다른 hunk 에 하나씩 대응한다. 개수만 맞추면 한 hunk 에서 뽑은 앵커 N 개가 통과한다.
3. **한 행 안에서 같은 앵커 문자열을 두 번 쓰지 않는다.** 막지 않으면 diff 전체에서 흔한 한 줄을 골라 그 행을 통째로 채우는 출력이 통과한다. 반대로 **서로 다른 행이 같은 문자열을 앵커로 갖는 것은 막지 않는다** — 여러 파일에 같은 줄이 추가되는 변경(공통 import 가 대표적)에서는 정직한 리뷰어의 앵커도 행 사이에서 겹치므로, 행 사이까지 금지하면 잘못 없는 라운드가 무효가 된다. 겹친 문자열도 검사 1 이 파일마다 따로 확인하니 근거 없이 겹칠 수는 없다.

**하나라도 어긋나면 그 라운드는 무효다.** cap 은 소비하되 PASS 로 기록하지 않으며, 무효 판정 로그에 어긋난 앵커 문자열을 그대로 남긴다 — 재사용은 개수만 세면 보이지 않고 문자열을 나란히 놓아야 눈에 띈다. **무효 라운드가 2회 연속이면 `review-coverage-mismatch` 로 중단하고 `--auto` 가 이 중단을 덮지 못한다** (게이트 선언은 `critical_gates[]` 표에 있다). 파일이 많으면 리뷰어가 행 열거를 중간에서 잘라 돌려주고 모든 라운드가 무효가 되어 cap 만 소비하는데, 그것이 이 설계에서 아무 일도 일어나지 않는 것처럼 보이는 유일한 실패 형태이기 때문이다. 그때는 분모를 쪼개 리뷰어를 여럿으로 나누고 각자에게 자기 몫의 분모를 고정해 준다. **분모 단위를 파일보다 굵게 올리거나 앵커를 파일당 하나로 줄이지 않는다.**

**이 대조가 보장하지 않는 것** — 앵커 대조는 리뷰어가 그 hunk 를 **이해했다는 것을 보장하지 않으며, 리뷰 품질을 재지 않는다.** 보장하는 것은 **분모의 모든 파일이 행으로 열거되고, 적힌 앵커 하나하나가 그 hunk 에 실재한다**는 데까지다 — **리뷰어가 diff 를 열었다는 것까지는 보장하지 않는다.** 앵커를 못 채우면 그 hunk 를 건드리지 않았다는 사실이 산출물에 남고, 틀린 앵커를 채우면 대조가 그것을 잡는다. 개수 대조에는 이 두 성질이 모두 없다 — `hunks_total` 은 루프가 넘긴 값이라 리뷰어가 같은 수를 되적는 것으로 끝나므로, 열두 파일 중 셋만 읽은 리뷰어도 열두 행 모두에서 개수를 맞춘다. 그러니 이 대조를 리뷰 판정의 자리로 쓰지 않는다. 2회차부터 분모가 회차 범위로 좁아지므로, 그 회차의 깨끗한 대조는 회차 범위 밖 파일에 대해 아무것도 말하지 않는다.

**좁힌 정의로도 남는 것** — 조건은 **hunk 가 적다는 것이 아니라 hunk 마다 흔한 토큰이 하나씩 있다**는 것이다. 확장자만 보고 고른 흔한 코드 토큰이 그 파일의 hunk 를 하나씩 차지하면, hunk 가 여럿인 평범한 소스 편집도 diff 를 한 줄도 열지 않고 채워진다 — 이 저장소의 최근 40 커밋 470 파일을 그렇게 재면 **코드 파일의 80% 남짓**이 채워지고(서로 다른 보수적 풀 두 벌로 81% 와 85%), 그 안에는 6·7·11·13 hunk 짜리가 들어 있다. 최대 반례는 손으로 고친 11-hunk 소스 파일이다. 앵커 규칙으로 닫을 구멍이 아니다 — 900 줄짜리 새 파일을 읽었다는 것은 앵커 하나로 애초에 증명되지 않는다. 그러므로 **이 대조의 통과를 그 파일을 읽었다는 근거로 읽지 않는다.** 대조가 실제로 잡는 것은 분모를 표본으로 줄인 출력, 개수만 되적은 출력, 날조하거나 도배한 앵커다. 읽었는지가 걸린 변경에서는 분모를 쪼개 리뷰어를 여럿으로 나눈다.
