---
name: kiwi-review-fix-loop
description: "코드 리뷰 → 수정 → 재리뷰 루프를 자동으로 돌리는 스킬. **코드 전용** — 산문 문서(`SKILL.md` · `README` · SRS · 연구 노트)는 리뷰도 수정도 하지 않는다(§11). **셀프 리뷰가 기본** — 까칠 리뷰어 서브에이전트가 working tree 변경분(git status)을 분석. `--pr`/`-pr`/`--PR`/`-PR` 옵션 또는 사용자가 'PR 리뷰 읽고 수정' 명시 시 GitHub PR 모드 전환(`gh pr view --comments`). **코드 리뷰와 코드 개선은 반드시 서브에이전트로 수행**(메인 직접 수정 절대 금지). Finding 3분류(즉시수정/논의필요/거절+사유) + TDD 회귀 테스트 + 시니어 fixer + 까칠 리뷰어 재검증 루프 + 심각도 게이트(CRITICAL=0+HIGH=0) + 회귀 PASS 의무. 트리거 — kiwi review fix loop, 리뷰 루프, 리뷰 수정 루프, 셀프 리뷰, 코드 리뷰해줘, 셀프 코드 리뷰, review fix, self review, code review loop, 리뷰 자동 적용, PR 리뷰 읽고 수정, PR 코멘트 적용, gh pr review fix, pr 응답, 머지 전 셀프 리뷰, 품질 게이트 돌려줘. --pr/-pr/--PR/-PR 로 PR 모드 활성. 검증(까칠 리뷰어·분류기·정형 검사) 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 override 한다(시니어 fixer 는 영향 없음). --max 로 까칠 ×2 강도 승격. --auto 로 사용자 게이트 자동 진행(severity 가드레일). --no-respond 로 PR 모드에서 PR 코멘트 응답 skip. --close-reqs 로 회귀 PASS + finding 0건 시 영향 REQ status를 implemented→verified 전이 + verification evidence 등록 (셀프 모드 전용, 기본 off)."
---

> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

# kiwi-review-fix-loop

코드 리뷰-수정-재리뷰 자동화 스킬. 두 가지 모드:

- **셀프 모드 (기본)**: 까칠 리뷰어 서브에이전트가 현재 working tree 변경분 (또는 지정 범위) 을 리뷰 → 즉시수정 항목 자동 수정 → 재리뷰 → 통과까지 반복. 머지 전 품질 게이트, 외부 PR 흡수 후 정리, 레거시 코드 정합화 등에 사용.
- **PR 모드 (`--pr` 옵션 또는 사용자 명시)**: GitHub PR 의 리뷰 코멘트를 `gh pr view --comments` 로 수집 → 분류 → 즉시수정 항목 자동 수정 → 재리뷰 → (선택) PR 응답 코멘트 → 통과까지 반복. 동료 리뷰 응답 자동화.

본 스킬의 핵심 원칙: **코드 리뷰와 코드 개선은 반드시 별도 서브에이전트로 spawn** (§0.1). 메인 세션이 직접 리뷰하거나 직접 수정하는 행위는 모든 모드에서 금지.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **서브에이전트 강제 (메인 직접 작업 금지)**. 코드 리뷰는 까칠 리뷰어 서브에이전트만 수행 (kiwi-coder Phase 2.f 8축 차용). 코드 수정은 시니어 fixer 서브에이전트만 수행. 메인은 오케스트레이션 + 사용자 게이트 + 산출물 통합 외 어떤 코드 판단·수정도 직접 하지 않는다. 본 §0.1 위반은 본 스킬 설계의 근본 우회 — 발견 즉시 메인이 self-abort + 사용자 보고 |
| §0.2 | **검증자 입력 격리** (CLAUDE.md §5). 까칠 리뷰어 재검증 라운드에 시니어 fixer 의 결론·정당화 텍스트 전달 금지. 원본 diff + 직전 finding + 적용된 fix 의 파일/라인 메타데이터만 |
| §0.3 | **TDD 의무 (조건부)**. Finding 이 `is_behavioral=true` 또는 `tags ∈ {bug, regression, security, performance}` 인 항목은 회귀 테스트 선행 작성 (상세 트리거 §6.1 참조). "style_only" / "naming" finding 은 TDD 면제 (회귀 가능성 없음). 시니어 fixer 가 면제 판정 시 worklog `tdd_exempted { finding_id, reason_enum }` |
| §0.4 | **Mock 금지** (regex 자동 탐지). CRITICAL severity. kiwi-coder §0.6 계승 |
| §0.5 | **외부 모듈 수정 금지**. cwd 외부 path 가 fix diff 에 진입 시 §0.G4 발동 |
| §0.6 | **시그니처 금지** (CLAUDE.md §6). 커밋·코드 주석·PR 응답 코멘트·산출물 어디에도 AI 식별 정보 금지 |
| §0.7 | **/snoworca-\* 호출 절대 금지** (프로젝트 CLAUDE.md §7). 로직만 차용 |
| §0.8 | **MCP mutation 자체 호출 금지 (느슨 결합)**. 본 스킬은 직접 `add_requirement` / `add_trace_link` / `update_status` 등을 호출하지 않는다. 리뷰-fix 흐름에서 SRS 변경이 필요한 finding 이 발생하면 사용자 보고 + `/kiwi-srs-sync` 또는 `/kiwi-srs` 위임 권고 (Skill 자동 호출 안 함 — review-fix-loop 의 책임 경계 외). **예외 (옵션 opt-in)**: 사용자가 `--close-reqs` 명시 시 셀프 모드 한정으로 `update_status` (implemented→verified, forward-only) + `add_verification_evidence` (type=test) + `check_acceptance_criteria` (AC 마다 지목 선행) 3종 호출 허용 (§0.G7 + §6.6). 기본 동작은 종전대로 mutation 금지 유지. read 호출 (`get_active_target` / `summarize_target` / `list_requirements`) 은 mutation 이 아니므로 §0.8 적용 외 — `--close-reqs` 미활성 상태에서도 호출 가능. |
| §0.9 | **검증 서브에이전트 모델 정책 SSOT** (kiwi-coder §0.16 정합). 까칠 리뷰어 / 분류기 / 정형 검사 등 **검증 서브에이전트**는 기본적으로 **현재 세션 모델(current session model)**을 상속하며 `--model <name>` (또는 사용자가 지명한 모델) 로 그 모델을 override 한다. **시니어 fixer 는 현재 세션 모델이나 `--model` 영향 없음** (kiwi-coder 시니어 코더와 동일). count 는 모든 모드 공통 (각 ×1) |
| §0.10 | **`.kiwi/` 상태 영속**. `cwd/.kiwi/sessions/{run-id}/state.json` 갱신. 재개 가능 (`--resume`) |
| §0.11 | **모드 결정 SSOT (§0.G1)**. 기본은 셀프 모드. `--pr` / `-pr` / `--PR` / `-PR` 옵션 또는 자연어 명시 ("PR 리뷰 읽고 수정", "PR 코멘트 적용", "gh pr review fix") 시 PR 모드. 두 모드는 상호 배타 |
| §0.12 | **PR 모드 사용자 의사결정 권한**. PR 리뷰 코멘트는 동료의 의견 — 본 스킬이 자동 거절·자동 수용 모두 위험. 분류기의 판정은 사용자 게이트 후 적용. `--auto` 시 severity 가드레일 (CRITICAL→자동수정 / HIGH→자동수정 / MEDIUM→자동수정 / LOW→자동 거절 with 사유) |
| §0.13 | **PR 응답 코멘트 의무 (PR 모드 + 응답 활성)**. `--no-respond` 부재 + PR 모드 + fix 1건 이상 적용 시 PR 에 응답 코멘트 1개 작성 (수정 완료 항목 + 거절 항목 + 사유). `gh pr comment` 사용. 시그니처 §0.6 적용 |
| §0.14 | **셀프 모드 우선순위 결정**. 셀프 모드의 리뷰 대상 범위는 다음 순서: (1) 인자 `--files` / `--commits` / `--since` / `--base` `--head` 우선 / (2) 부재 시 `git status` 변경분 (working tree + staged) / (3) 변경분 0건 시 `HEAD~5..HEAD` fallback (사용자 확인 게이트 후) |
| §0.15 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. §0.G5 finding 3분류 매핑 (immediate_fix / discussion_needed / rejected) 및 §0.12 severity 가드레일 표 (CRITICAL/HIGH/MEDIUM → 자동수정, LOW → 자동 거절) 은 본 스킬 고유 finding 분류 정책으로 유지된다 — SSOT 는 게이트 결정 채널만 정규화. 본 스킬의 `critical_gates[]` 는 §0.G8 (아래) 참조 |
| §0.16 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
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

#### §0.G5 — Finding 3분류 SSOT

분류기 (×1) 가 각 finding 에 대해 다음 중 정확히 1개로 분류:

| 분류 | 정의 | 액션 |
|---|---|---|
| **immediate_fix** | 명확한 버그/회귀/보안/스타일 위반 — 자동 수정 가능 | Phase 3-5 진입 |
| **discussion_needed** | 설계 의사결정 필요, 트레이드오프 명확 안 함, 또는 사용자 의도 확인 필요 | AskUserQuestion (Normal) 또는 보고만 + 사용자 결정 위임 (Max 가능) |
| **rejected** | finding 이 부적절 (오해, scope-out, 이미 의도된 동작, 외부 라이브러리 책임 등) | 거절 사유 기록 + (PR 모드) 응답 코멘트에 거절 사유 포함 |

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
| `--close-reqs` + 까칠 리뷰 finding 잔존 (CRITICAL/HIGH ≥1) | 차단 + WARN |
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
| `close-reqs-with-pr-mode` | `--close-reqs` + PR 모드 조합 차단 (§0.G7 Rule 2) | §0.G7 |
| `close-reqs-with-regression-fail` | `--close-reqs` + 회귀 fail — verified 전이 부적합 (§0.G7 Rule 3) | §0.G7 |
| `close-reqs-critical-or-high-residual` | `--close-reqs` + CRITICAL/HIGH finding ≥1 잔존 — close 차단 (§0.G7 Rule 4) | §0.G7 |
| `external-module-impact` | fix diff 에 cwd 외부 path 진입 (§0.5 / §0.G4) | §0.G4 |
| `improvement-loop-divergence-4opt` | §0.G6 4옵션 게이트 발동 (시니어 fixer 3회 / 까칠 2회 동일 finding / 회귀 2회 연속 동일 fail) | §0.G6 |
| `mock-detection` | Mock regex 자동 탐지 CRITICAL (§0.4) | §0.4 / §6.2 |
| `pr-mode-gh-unavailable` | PR 모드 활성 시 `gh` CLI 미설치/미인증 (§0.G1 마지막 행) | §0.G1 |
| `mcp-cli-both-unavailable` | `--close-reqs` 활성 상태에서 MCP·CLI 양쪽 미가용 — evidence 등록·status 전이를 대체할 경로가 없다 (§6.6.3) | §6.6.3 |
| `bulk-close-or-finalize` | REQ close 는 REQ 단위 + 증거 등록이 선행 조건 — bulk finalize·archive·target 비우기 시도 (§0.8 / §6.6) | §6.6 |
| `existing-test-weakened-or-deleted` | fix diff 에서 기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화 검출 (§0.17) | §0.17 / §6.2 |
| `existing-public-contract-change` | fix diff 에서 기존 public 심볼의 삭제 또는 시그니처 변경 검출 — **경로와 무관**하게 critical (§0.17) | §0.17 / §6.2 |
| `empty-code-scope` | 부류 필터 뒤 코드 대상 0건 (§11) | §11 / §3.1 |
| `existing-file-deleted-or-moved` | fix diff 에서 비-테스트 기존 파일의 삭제·이동 검출 (§0.17) | §0.17 / §6.2 |
| `validate-spec-error` | `validate_spec` 가 error 급 진단을 하나라도 돌려줌 — 오류를 안은 요구 위에 증거와 승급을 쌓으면 그 통과가 무엇을 근거로 기록되었는지 되읽을 수 없다 | `--close-reqs` 승급 직전 |

**이 게이트를 관측하는 자리**: 위 표에서 이 행의 세 번째 칸이 가리키는 홉에서 MCP `validate_spec` 을 실행한다 — MCP 가 없으면 CLI `speckiwi validate --json` 이다. error 급 진단이 하나라도 남아 있으면 그 홉을 진행하지 않고 `validate-spec-error` 로 중단하며, `--auto` 도 이 중단을 덮지 못한다. 실행하지 않은 채 통과로 기록하지 않는다.

**finding 분류 매핑 (§0.G5) 와 severity 가드레일 (§0.12) 은 본 critical_gates 와 별개 채널**: discussion_needed/immediate_fix/rejected 의 자동 액션 매핑은 SSOT §4 severity 분기 정책의 적용 대상이며, 본 §0.G8 는 그 매핑이 실패하거나 critical 영역에 진입할 때의 HALT 게이트만 선언한다.

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
| "재개" | `--resume` | off |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |
| 부모 기준선 | `--regression-baseline <path>` | off (자기 시점 캡처) |
| "파이프라인 이벤트 억제" (오케스트레이터 전달) | `--no-pipeline-emit` (인자 없음 — `kiwi/pipeline.jsonl` append 를 수행하지 않는다, §7.3) | off (emit 수행) |

### 1.3 모드 매트릭스

까칠 리뷰어 / 분류기 / 정형 검사 **검증 서브에이전트**는 **현재 세션 모델(current session model)**을 상속하며 `--model <name>` (또는 사용자가 지명한 모델) 로 그 모델을 override 한다. 시니어 fixer 는 현재 세션 모델이나 `--model` 영향 없음 (kiwi-coder 시니어 코더와 동일). `--max` 는 모델이 아니라 **count** 를 격상한다.

| 모드 | 까칠 리뷰어 | 분류기 | 시니어 fixer | 정형 검사 | 비용 배수 |
|---|---|---|---|---|---|
| Normal (기본) | × 1 | × 1 | × 1 | × 1 | 1.0× (기준) |
| `--max` | × 2 = **순차 2라운드**(동시 2기 아님), 2 연속 MEDIUM=0 종료 | × 1 | × 2 | × 1 | 2× |

까칠 리뷰어 / 시니어 fixer 는 **항상 서브에이전트** (§0.1). off 플래그 없음.

### 1.4 출력 (산출물)

- **코드 변경**: fix 대상 파일에 직접 작성. git commit 은 사용자 결정
- **분석 디렉토리**: `docs/analysis/kiwi-review-fix-loop-{run-id}/`
  - `mode_decision.json` — 모드 결정 결과 (셀프/PR) + 범위
  - `review_inventory.json` — 리뷰 finding 인벤토리 (셀프: 까칠 리뷰어 산출 / PR: gh pr comments + reviews)
  - `classified_findings.json` — 3분류 결과 (immediate_fix / discussion_needed / rejected)
  - `fix_iter{N}.json` — 시니어 fixer 적용 결과 (finding_id → patch summary)
  - `prickly_recheck_iter{N}.json` — 까칠 리뷰어 재검증 결과
  - `regression_run.jsonl` — 회귀 테스트 실행 로그
  - `pr_response.md` (PR 모드) — PR 응답 코멘트 본문 (`--no-respond` 부재 시)
  - `rejected_findings.log` — 거절된 finding 사유
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
Phase 0 : Bootstrap (preflight, 모드 결정, 범위 결정, .kiwi init/resume)
Phase 1 : 리뷰 인벤토리 수집
  1.s (셀프): 까칠 리뷰어 서브에이전트 → working tree diff 리뷰
  1.p (PR)  : gh pr view --comments + reviews → 정규화
Phase 2 : Finding 3분류 (분류기 ×1)
Phase 3 : 즉시수정 항목에 회귀 테스트 작성 (TDD 조건부, §0.3)
Phase 4 : 시니어 fixer 적용 (서브에이전트)
Phase 5 : 까칠 리뷰어 재검증 (서브에이전트, 입력 격리 §0.2)
Phase 6 : 미해결 시 Phase 4-5 반복 (심각도 카운터)
Phase 7 : 회귀 테스트 실행
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

기록: `docs/analysis/kiwi-review-fix-loop-{run-id}/preflight.json`

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
  "regression_baseline": null,
  "regression_pass": false,
  "pr_responded": false,
  "failed": false
}
```

resume 알고리즘 (`--resume` 활성 시):
1. state.json.phase 기반 entry-point 결정 — 해당 phase 부터 재개
2. git diff 검증 — working tree 가 직전 실행 후 변경되었으면 사용자 확인 게이트 (계속 / 새 run 시작 / HALT)
3. finding_queue / fix_iter / recheck_iter 누적 (리셋 안 함)
4. 까칠 리뷰어 / 시니어 fixer 재호출 카운터 누적 (§0.G6 발산 가드 유지)

---

## 4. Phase 1 — 리뷰 인벤토리 수집

### 4.1.s 셀프 모드 — 까칠 리뷰어 (서브에이전트)

까칠 리뷰어 spawn (kiwi-coder §5.2 8축 차용):

입력:
- `mode_decision.json.self_scope` 의 git diff 본문
- 변경 파일 주변 컨텍스트 (각 hunk 전후 50라인)
- 활성 target 의 관련 REQ-ID 목록 (best-effort, `summarize_target` 결과)
- 코드베이스 README / CLAUDE.md (있다면)

출력 (Markdown + JSON 둘 다):
```json
{
  "findings": [
    {
      "id": "FND-001",
      "axis": "P1|P2|P3|P4|P5|P6|P7|P8",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "title": "한 줄 요약",
      "location": { "file": "src/x.ts", "line_range": "45-67" },
      "description": "본문",
      "suggested_fix": "옵션 — 부재 가능",
      "is_behavioral": true | false,
      "tags": ["bug", "performance", "security", "style", "naming", "doc"]
    }
  ],
  "summary": { "total": N, "by_severity": {...}, "by_axis": {...} }
}
```

`is_behavioral=true` 가 §0.3 TDD 의무의 트리거 (회귀 테스트 작성 대상).

산문 문서는 애초에 리뷰 범위에 들어오지 않는다(§11). 산문 델타 프로토콜은 `_shared/kiwi/verify-loop.md` §10 이 소유하며, 그것을 부르는 것은 이 스킬이 아니다.

### 4.1.p PR 모드 — gh CLI 수집

§0.G3 의 알고리즘 그대로:
1. `gh pr view --json title,body,number,headRefName,baseRefName,reviewDecision`
2. `gh pr view --comments --json comments,reviews`
3. 정규화하여 finding 으로 변환:
   ```json
   {
     "id": "FND-001",
     "source": "review_comment|issue_comment|review",
     "author": "github-user",
     "submitted_at": "ISO-8601",
     "location": { "file": "src/x.ts", "line": 45 } | null,
     "body": "코멘트 본문",
     "review_state": "CHANGES_REQUESTED|COMMENTED|APPROVED" | null
   }
   ```
4. APPROVED 만 있고 finding 0건 → §0.G3 의 skip 흐름 (Phase 7 직행)

산출물 (양 모드 공통): `review_inventory.json`

---

## 5. Phase 2 — Finding 3분류 (분류기 ×1, §0.G5)

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
    { "id": "FND-001", "rationale": "...", "estimated_complexity": "trivial|small|medium", "is_behavioral": true | false, "tags": ["bug", "regression", "security", "performance", "style", "naming", "doc"] }
  ],
  "discussion_needed": [
    { "id": "FND-003", "rationale": "...", "questions_for_user": ["..."] }
  ],
  "rejected": [
    { "id": "FND-007", "rationale": "...", "rejection_category": "out_of_scope|already_intended|external_library|misunderstanding" }
  ]
}
```

분류 검증 (메인 게이트):
- `unclassified` 0건 확인 (§0.G5)
- 합계 = `review_inventory.findings.length` 검증
- 위반 시 분류기 재호출 (최대 2회)

### 5.1 discussion_needed 처리

`--auto` 활성 시:
- severity 가드레일 SSOT 는 §0.12. 본 절은 §0.12 의 가드레일을 인용하여 discussion_needed 항목에 적용한다 (CRITICAL/HIGH/MEDIUM → immediate_fix 로 강제 재분류, 분류기에게 fix 가설 요구 / LOW → rejected 로 강제 재분류, 사유: "auto mode low-severity skip").
- **분류기 fix 가설 생성 실패 fallback**: 강제 재분류 요구에도 분류기가 immediate_fix 의 fix 가설 (rationale + estimated_complexity) 을 생성하지 못하면, 해당 finding 은 discussion_needed 상태로 유지하고 사용자 게이트로 강제 복귀 (무한 루프 방지).

`--auto` 부재 시:
- 모든 discussion_needed 에 대해 AskUserQuestion (단일 호출에 옵션 분해): 각 finding 별 (fix-now / reject-with-reason / defer-to-user-later)

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
- **캡처 실패 격하**: 캡처 자체가 실패하면 (스위트 명령 미검출 등) `state.json.regression_baseline = null` 로 두고, 이 run 의 회귀 판정은 델타 없이 실패 전량 보고로 격하하며 그 사실을 보고서에 명시한다
- **부모 기준선 우선**: `--regression-baseline` 으로 상위 오케스트레이터가 pin 한 기준선을 받으면 그 값이 자기 시점 캡처보다 **우선한다** — 값이 주어지면 자체 캡처를 수행하지 않고 전달된 기준선을 `state.regression_baseline` 에 그대로 고정한다. 방금 만들어진 실패를 "기존 실패"로 분류해 `TASK_DONE` 을 반환하는 것이 wave 게이트와 정면으로 어긋나기 때문이다.

### 6.1 Phase 3 — 회귀 테스트 작성 (TDD 조건부, §0.3)

`immediate_fix` 큐의 각 finding 중 다음 조건 만족 항목에 회귀 테스트 선행 작성:
- `is_behavioral = true` (셀프 모드 까칠 리뷰어 산출의 필드)
- 또는 finding 의 `tags` 에 `bug` / `regression` / `security` / `performance` 중 1개 포함

시니어 fixer 서브에이전트가 다음 수행:
1. finding 의 location 과 description 기반 회귀 테스트 작성
2. 테스트 실행 → red (의도된 fail) 확인
3. red 시그니처를 `state.json.finding_queue[i].red_signature` 에 저장

면제 finding 은 worklog `tdd_exempted { finding_id, reason_enum: style_only|naming|formatting_only|comment_only }` append + Phase 4 직행.

### 6.2 Phase 4 — 시니어 fixer 적용 (서브에이전트)

시니어 fixer 서브에이전트 (§0.1 의무):
입력:
- finding 본문 (한 fixer = N개 finding batch 가능, 단 동일 파일·인접 hunk 그룹화)
- 회귀 테스트 (Phase 3 산출) + red 시그니처
- 변경 파일의 현재 상태
- (선택) finding 의 suggested_fix (있을 때만)

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

Mock 금지 (§0.4) regex 자동 탐지 — 위반 시 CRITICAL → Phase 4 재진입 (fixer 자체에게 재시도 요구).

cwd 외부 path 편집 시도 (§0.5 / §0.G4) — 즉시 중단.

### 보존 스캔 (fixer diff, §0.17)

fixer pass 가 적용한 **diff** 를 스캔한다 — **기존 테스트 파일 삭제 · 기존 테스트 케이스 제거 · 기존 단언 약화**, **기존 public 심볼의 삭제·시그니처 변경**, **비-테스트 기존 파일의 삭제·이동** 중 하나라도 검출되면 **CRITICAL** 로 올리고 §0.G8 의 대응 게이트(`existing-test-weakened-or-deleted` / `existing-public-contract-change` / `existing-file-deleted-or-moved`)로 중단한다. 판정 기준은 `kiwi-coder §0.20.1~§0.20.3`.

스캔은 까칠 리뷰어 **재검증(re-review)보다 먼저** 수행한다 — 뒤에 두면 약화된 테스트가 먼저 clean 판정을 받는다.

### 6.3 Phase 5 — 까칠 리뷰어 재검증 (서브에이전트, §0.2 격리)

까칠 리뷰어 spawn (Phase 1.s 와 동일 prompt 골격, 단 입력 변경):
입력:
- Phase 4 의 fix 적용 후 diff (Phase 1.s 의 diff 가 아닌 Phase 4 diff)
- 직전 라운드의 finding 목록 (단 `rationale_strip` 만, `rationale_full` 금지)
- 본 라운드의 새 finding 만 식별 요구 + 직전 finding 의 해소 여부 평가

출력: `prickly_recheck_iter{N}.json` (Phase 1.s 와 동일 schema + `resolved_findings: [FND-id...]`)

### 6.4 Phase 6 — 개선 루프 (심각도 카운터)

| 종료 조건 | 모드 |
|---|---|
| CRITICAL=0 + HIGH=0 (resolved 제외한 new + 잔존) | Normal PASS |
| 2 라운드 연속 MEDIUM=0 | Max PASS |

미충족 시 Phase 4 재진입 (잔존 finding + 새 finding 큐로). 카운터 초과 시 §0.G6 발동.

### 6.5 Phase 7 — 회귀 테스트 실행

1. Phase 3 회귀 테스트 실행 → green 확인. fail 시 Phase 4 개선 루프 편입 (HIGH 카운터)
2. `--skip-regression` 부재 시 영향 회귀 (변경 파일의 모든 테스트) 실행
3. 판정은 §6.0 의 기준선 델타를 적용한다 — 신규 실패 0건이면 Phase 8 진입. 신규 실패 ≥1 → §0.G6 (2 연속 동일 fail 시 에스컬레이션). 기준선에 이미 있던 실패는 보고만 하고 진입을 막지 않는다
4. 결과: `regression_run.jsonl`

### 6.6 Phase 7.5 — REQ verified 일괄 승급 (`--close-reqs` 활성 시)

§0.G7 게이트 전부 통과 시에만 실행. 부재 시 본 phase 전체 skip.

#### 6.6.1 영향 REQ-ID 추출

**분모 획득 (§6.6 진입 직전 의무, 후보 추출보다 먼저)**: MCP `get_active_target` 으로 이번 실행의 target 을 해소하고, `list_requirements({ target: <해소한 target>, status: "implemented" })` 로 **분모**를 받는다. 이 둘은 read 이므로 §0.8 의 mutation 금지 밖이며 `--close-reqs` 없이도 호출한다. target 을 해소하지 못하면 **분모를 만들지 못했다고 보고하고 멈춘다** — 임의의 값으로 진행하지 않는다. 분모를 스킬이 스스로 만들지 않는 이유는 하나다: 후보를 자기가 추출하는 한 **덜 추출하면 어떤 게이트도 피할 수 있고**, 같은 주체에게 보고 의무를 더해 봐야 자기선언이 둘로 늘 뿐이다.

네 집합을 이 이름으로 쓴다.

| 이름 | 무엇인가 |
|---|---|
| `denominator` | `list_requirements` 가 돌려준 집합. 스킬이 만들지 않는다 |
| `scoped` | `denominator` 를 이번 실행의 리뷰 범위와 교차한 부분집합. 교차 근거는 아래 `match_confidence` 이며 `high` 미만은 교차에서 빠지되 **제외로 계상한다** |
| `eligible` | `scoped` 에서 산문 증거 REQ 와 `stability` 가 `draft`·`deprecated` 인 REQ 를 뺀 것. status 가 `implemented` 가 아닌 REQ 는 분모가 이미 걸러 냈다 |
| `transitioned` | 실제로 `verified` 전이에 성공한 수 |
| `excluded` | `scoped` 에서 닫히지 않은 REQ 를 사유와 함께 REQ 단위로 열거한 목록 |

**처분 대조**: `전이 성공 수 + 제외 수 = scoped 크기` 가 성립해야 한다. **항등식이 성립하지 않으면 그 실행은 무효다** — 처분을 받지 못한 REQ 가 있다는 뜻이고, "덜 추출" 이 바로 여기서 개수 불일치로 드러난다. 산문 증거 REQ 와 `draft`·`deprecated` REQ 는 `eligible` 에서 빠지지만 **`scoped` 에는 남고** 제외 사유를 받는다 — `scoped` 에서 빼면 항등식이 그 REQ 의 부재를 보지 못한다.

**선결 호출 (분모 획득 직후)**: MCP `summarize_target` 호출 → trace link 인덱스 수집. MCP 미가용 시 source 1 skip + source 2 (scope heuristic) 만 사용 + 추출 결과에 `data_source: "scope-heuristic-only"` 메타 명시.

`scoped` 는 `denominator` 를 아래 두 소스와 교차해 얻는다 — 두 소스는 교차의 **근거**이지 집합의 출처가 아니다:
1. 까칠 리뷰어 입력의 활성 target REQ 인벤토리 (`summarize_target` 응답) 중 변경 파일과 trace link 가 매칭되는 REQ
2. 변경 파일 경로 ↔ REQ scope 의 휴리스틱 매칭 (scope name keyword + path prefix 일치, confidence=high 만)

스키마:
```json
{
  "candidate_reqs": [
    { "req_id": "FR-AUTH-001", "match_source": "trace|scope-heuristic", "match_confidence": "high|medium|low", "current_status": "implemented", "stability": "evolving" }
  ],
  "extraction_basis": { "summarize_target_used": true, "trace_links_used": N, "scope_heuristic_used": M }
}
```

`match_confidence` < high 항목은 자동 close 대상에서 제외하되 **`excluded` 에 사유와 함께 계상**하고, 보고서 §9 에 후속 검토 권고로 명시.

**처분 회계 (보고 의무)**: `scoped` 의 **모든 REQ 를 REQ 단위로 행으로 열거**하고 각 행이 닫힘 또는 제외 사유 하나를 갖는다. 개수 요약이나 표본으로 줄이지 않는다 — 이 열거가 없으면 위 항등식을 사람이 확인할 수 없고, 확인할 수 없는 항등식은 분모를 밖에서 받은 의미를 지운다.

산출물: `closed_reqs.json.scoped` (각 REQ 에 처분 하나: 닫힘 또는 제외 사유)

#### 6.6.2 MCP 호출 (§0.8 화이트리스트 3종)

각 `eligible` REQ 에 대해 순서대로:

1. `add_verification_evidence({ id: req_id, type: "test", reference: regression_test_path, covers: <단일 AC-ID string 또는 omit>, notes: "kiwi-review-fix-loop 회귀 검증 통과 (run_id={run-id})" })` — speckiwi MCP schema `covers: z.string().optional()` 준수. 각 REQ 의 영향 AC 별 1건씩 반복 호출 (AC-1, AC-2 …). evidence 등록 호출 총합 = N (REQ 수) × M (각 REQ 의 영향 AC 수). 어느 AC 에 매핑할지 §6.6.1 추출 단계에서 구체 AC-ID 로 resolve 되지 않은 경우 `covers` 필드 omit 허용 (REQ 전체 커버리지로 기록).
2. `check_acceptance_criteria({ id: req_id, acIds: [<지목을 마친 AC-ID>], checked: true })` — **AC 마다 그 AC 를 통과시킨 테스트 식별자를 먼저 지목한다.** 지목 대상은 파일 경로와 테스트 이름, 또는 직전 1번 호출이 그 AC 에 대해 `covers` 로 등록한 `reference` 다. **지목이 없는 AC 는 체크하지 않는다** — `acIds` 에서 빼고 그 REQ 를 `skipped_reason: "unnamed-ac"` 로 기록한다. 체크는 mutation 이므로, 통과하지 않은 AC 를 체크하면 게이트가 형식만 만족된다.
3. `update_status({ id: req_id, status: "verified" })`

순서 의무: evidence 등록 → AC 체크 → status 전이 (앞 단계 실패 시 뒤 단계 skip + skipped_reason 기록). `update-status.ts` 의 게이트가 AC 전량 체크와 증거를 함께 요구하므로, 2번을 건너뛴 3번은 `MUTATION_DENIED` 로 거부된다.

각 호출은 `mcp_call_log.jsonl` 에 1줄 append:
```json
{"called_at": "ISO-8601", "tool": "update_status|add_verification_evidence|check_acceptance_criteria", "args": {...}, "args_hash": "sha1...", "ok": true|false, "response": {...}}
```

#### 6.6.3 멱등성 + 실패 처리

- 동일 `args_hash` 재호출 — 직전 호출 `ok=true` 인 경우에만 skip (dedupe). 직전 `ok=false` 인 경우는 재시도 허용 (일시 실패 복구 시나리오 — resume 시 status 전이 재시도 가능). dedupe 판정은 `mcp_call_log.jsonl` 의 가장 최근 동일 args_hash 엔트리의 `ok` 필드 기준
- `update_status` 가 backward transition (이미 verified) → skip (forward-only)
- MCP 가용 실패 (preflight 결과 mcp=false) → 본 phase 전체 skip + 사용자 보고 + `state.json.pending_close: [...]` 적재 + 후속 CLI fallback 권고
- 부분 실패 (일부 REQ ok, 일부 실패) → `closed_reqs.json` 에 결과별 명시 + 보고서에 명시

#### 6.6.4 산출물

`closed_reqs.json`:
```json
{
  "run_id": "...",
  "trigger": "--close-reqs",
  "scope_mode": "self",
  "candidates_total": N,
  "verified_transitioned": M,
  "skipped": [
    { "req_id": "FR-X-002", "reason": "stability=draft" },
    { "req_id": "FR-X-003", "reason": "current_status=verified (already)" }
  ],
  "failed": [],
  "evidence_refs": ["tests/regression/foo.test.ts#it_returns_200"]
}
```

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
classified: { immediate_fix: A, discussion_needed: B, rejected: C }
fix_iter: N
recheck_iter: M
regression_pass: true|false
closed_reqs_count: N | null  # --close-reqs 활성 시에만, 비활성 시 null
pr_responded: true|false
---
```

본문 섹션:
1. 사용된 플래그 + 비용 배수
2. 모드 결정 + 범위
3. Finding 인벤토리 요약 (셀프: axis 별 / PR: source 별 + author 별)
4. 3분류 결과 (immediate_fix / discussion_needed / rejected) + 각 분류별 finding 목록
5. 적용된 fix 요약 (finding_id → 파일·라인·rationale)
6. 까칠 리뷰어 재검증 결과 (라운드별 resolved / new finding)
7. 회귀 테스트 실행 결과
8. (PR 모드) PR 응답 코멘트 본문 (작성된 경우)
9. 거절된 finding 사유 (rejected_findings.log 인용)
10. 잔존 MEDIUM/LOW finding (사후 검토 권고)
11. (`--close-reqs` 활성 시) REQ verified 전이 결과 — `closed_reqs.json` 인용 (transitioned / skipped / failed 통계 + 영향 REQ-ID 목록 + evidence 경로)
12. 제외한 산문 전량 (`excluded_prose[]`) · 거부한 아티팩트 전량 (`refused_artifacts[]`) · 분류되지 않은 파일 전량 (`unclassified_files[]`) + 항등식 확인
13. 메타 (실측 토큰, 시간)

### 7.2 PR 응답 코멘트 (PR 모드 + 응답 활성, §0.13)

`--no-respond` 부재 + PR 모드 + fix 1건 이상 적용 시:

`pr_response.md` 본문 양식:
```markdown
## Review fix summary (kiwi-review-fix-loop)

### Applied fixes
- FND-001 (file:line) — 한 줄 요약 + commit ref (있을 시)
- FND-003 (file:line) — ...

### Discussion needed
- FND-005 — 질문/이슈 본문

### Rejected (with rationale)
- FND-007 [external_library] — 사유: ...

(각 항목은 `[rejection_category]` prefix 사용. enum 은 §0.G5 의 `out_of_scope|already_intended|external_library|misunderstanding` 4종)

Regression tests: PASS (N tests)
```

(시그니처 금지 §0.6 — `🤖 Generated with ...` 등 어떤 도구 식별 정보도 추가 안 함)

`gh pr comment {N} --body-file pr_response.md` 로 작성. 실패 시 사용자 보고 + `state.json.pr_responded: false` 유지.

### 7.3 Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴 적용. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-review-fix-loop"` (pipeline-event.md §3 의 skill enum 에 등재됨)
- `status`: 모든 immediate_fix 처리 + 회귀 PASS **+ 승급 결과 조건** = `TASK_DONE`; discussion_needed 가 사용자 대기 = `NEEDS_USER`; dry-run = `DRY_RUN`; 실패 = `FAILED`. **승급 결과 조건**: `--close-reqs` 활성 실행에서 `eligible` 이 **1 이상인데 전이 0건**이면 `TASK_DONE` 을 반환하지 않는다 — `FAILED` 다. 처분 대조가 어긋난 실행도 마찬가지다. `--close-reqs` 가 없는 실행에는 이 조건이 적용되지 않는다. 값은 `_shared/kiwi/pipeline-event.md` §2 의 enum 안에서만 고른다 — 새 값을 만들지 않는다
- `next_hint`: 통상 `"kiwi-commit-auto-push"` (PR 모드는 PR 푸시 이미 됨 — `null` 권장), discussion_needed 잔존 시 `null`
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
| 정식 plan 수립 후 풀 구현 (리뷰 내장) | `/kiwi-coder` (까칠 리뷰 Phase 2.f 내장) |
| **셀프 리뷰 단독 또는 PR 리뷰 응답** (본 스킬) | `/kiwi-review-fix-loop` |
| 신규 기능 SRS 작성 | `/kiwi-srs` |

본 스킬과 `/kiwi-coder` 의 까칠 리뷰는 다음 점에서 다르다:
- `/kiwi-coder` 의 까칠 리뷰는 plan 기반 구현 직후 1회 (개선 루프 포함)
- 본 스킬은 plan 무관, 임의의 코드 변경 / PR 코멘트 / 머지 전 게이트 등에 단독 사용

---

## 10. Out of Scope

| 범위 밖 | 담당 스킬 |
|---|---|
| 신규 기능 개발 | `/kiwi-srs` → `/kiwi-planner` → `/kiwi-pm` |
| 긴급 fix + SRS sync 위임 | `/kiwi-hot-fix` |
| MCP mutation 직접 호출 | `/kiwi-srs-sync` 또는 `/kiwi-srs` (본 스킬은 §0.8 으로 금지) |
| git commit / push | 사용자 결정 또는 `/kiwi-commit-auto-push` |
| PR 생성 (없는 PR 새로 만들기) | 사용자 또는 `/kiwi-commit-auto-push` |
| 풀 plan 수립 (Phase 분해) | `/kiwi-planner` |
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

**범위 결정과의 관계** — 본 절은 §0.14 가 산출한 후보 목록에 붙는 **후처리**이며 §0.14 를 대체하지 않는다. 부류 필터는 후보 목록이 만들어진 **직후**, 까칠 리뷰어를 spawn 하기 **전**에 적용한다. 뒤에 두면 고칠 수 없는 finding 이 §6.4 의 `CRITICAL=0 + HIGH=0` 카운터에 들어가, 루프가 영원히 통과하지 못하거나 게이트를 맞추려고 결국 그 문서를 고치게 된다.

**커밋 창은 사람의 지목이 아니다** — `--base`/`--head` · `--commits` · `--since` 는 부류 필터를 **면제하지 않는다.** `kiwi-orchestrator` 는 §15 일정에 따라 `docs/research/{work}/` 아래 run 아티팩트를 커밋한 **다음** 그 커밋 범위를 이 스킬에 창으로 넘긴다. 연구·설계 산문이 실제로 리뷰에 들어온 경로가 이것이며, 창을 지목으로 인정하면 주 경로가 그대로 필터를 면제받는다. **`--files` 만** 사람이 파일을 지목한 것으로 인정하고, 그 목록에 든 산문은 제외 사실과 사유를 **보고**한 뒤 코드만 진행한다. 지목이 전부 산문이면 진행하지 않는다.

**제외는 전수 열거한다** — 제외한 산문을 `mode_decision.json.self_scope.excluded_prose[]` 에 **빠짐없이** 싣고 보고서에도 그대로 낸다. 개수나 표본으로 줄이지 않는다. 판정 순서 1 이 거부한 저널·lock 은 `refused_artifacts[]` 에 따로 싣는다 — 코드도 산문도 아니므로 어느 쪽 버킷에 넣어도 이름을 속이게 된다. 그리고 **항등식**이 성립해야 한다: 포함한 파일 수와 `excluded_prose[]` 와 `refused_artifacts[]` 와 `unclassified_files[]` 의 수를 더한 값이 후보 수와 같아야 한다. 항등식이 없으면 규칙을 지킨 run 과 규칙을 잊은 run 이 똑같은 산출물을 남긴다.

**빈 범위는 통과가 아니다** — 필터 후 코드 대상이 **0건**이면 PASS 를 보고하지 않고 `empty-code-scope` 로 **중단**한다. 아무것도 보지 않은 실행이 품질 게이트 통과로 기록되면, 빈 기준선이 깨끗한 기준선과 구별되지 않는다.

**알려진 한계**: 후보가 처음부터 전부 산문이면 이 중단이 오케스트레이터의 종료 hop 과 충돌한다. 그 hop 은 통과 판정을 기록하는 모든 경계가 이 스킬을 정확히 한 번 거치도록 요구하는데, 준비된 면제 분기의 술어는 **커밋 창의 공백**이라 산문 커밋이 든 창에는 걸리지 않는다. 요구나 설계 문서만 산출한 wave 가 여기 해당한다. 해소하려면 `FR-FLOW-131` 이 소유한 그 술어를 넓히거나 별도 verdict 을 도입해야 하며, 둘 다 요구 수준의 결정이라 이 절이 정하지 않는다. **`FR-FLOW-152` 의 후속으로 남긴다.**

**산문 finding 은 어디로 가는가** — 부류 밖 문서에서 눈에 띈 문제는 §0.8 이 SRS finding 에 쓰는 것과 같은 채널로 흘린다: 고치지 않고 보고하며, 담당 스킬을 지목해 위임을 권고한다.
