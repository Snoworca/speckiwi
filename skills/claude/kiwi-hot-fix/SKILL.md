---
name: kiwi-hot-fix
description: "긴급 버그·운영 이슈에 대해 SRS→pm→coder 풀 파이프라인을 우회하면서도 speckiwi 거버넌스(REQ-ID·TDD·sync)를 유지하는 hot-fix 스킬. 입력 자동 감지(GitHub issue URL / 자연어 증상 / git status 변경분) + 원인 분석과 재현은 `/kiwi-bug-repro` 위임(돌려받은 재현 테스트가 회귀 테스트, 재현되지 않거나 버그가 아니거나 자동 테스트가 없으면 fix 없이 멈춤, 작업 트리 변경은 임시 worktree 에서 재현) + 시니어 fixer + 정형 검사 + 까칠 리뷰어 + 개선 루프 + 회귀 테스트 + 종료 시 `/kiwi-srs-sync` Skill 호출 위임으로 SRS 사후 동기화. **코드 수정 발생 시 까칠 리뷰어 서브에이전트 의무**(kiwi-coder Phase 2.f/2.g 동등). 트리거 — kiwi hot fix, 핫픽스, hot-fix, 긴급 수정, 긴급 패치, 운영 이슈 수정, hotfix, urgent fix, 버그 긴급 수정, 이 이슈 고쳐줘, 빠르게 고쳐줘, 즉시 수정, prod 이슈, production hotfix, issue 처리, github issue 수정. 검증(정형 검사·까칠 리뷰어) 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 override 한다(시니어 fixer 는 영향 없음; `/kiwi-bug-repro` 위임에는 전파). --max 로 까칠 ×2 강도 승격. --auto 로 사용자 게이트 자동 진행(severity 가드레일). --no-sync 로 kiwi-srs-sync 위임 skip."
---

> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

# kiwi-hot-fix

긴급 버그·운영 이슈 대응 스킬. spec-first 가 원칙이지만, **현실에서 자주 발생하는 긴급 케이스**를 위한 우회 경로:

- 운영 환경 prod 이슈 핫픽스
- GitHub issue 의 긴급 처리
- 단순 버그 수정 (정식 SRS 갱신 불필요할 정도로 작음)
- 리포트된 회귀 즉시 수정

본 스킬은 spec-first 원칙을 **우회하지 않고** 사후 동기화한다 — fix 완료 후 `/kiwi-srs-sync` Skill 호출로 변경분을 SRS 에 정합화 위임. TDD 와 까칠 리뷰는 의무.

---

## Workflow 도구 정책

세션 상태 조회의 정상 경로는 공식 workflow 읽기 도구다 — `--resume` 이 읽는 `.kiwi/sessions/{run-id}/state.json` 은 MCP `workflow_resolve_artifact` 에 그 실행의 `runId` 와 함께 `kind` 를 `coder-state` 로, `includeBody` 를 `true` 로 주어 읽고, 실행 기록 `worklog.jsonl` 은 `workflow_worklog_tail` 로 조회한다. 파일을 직접 읽는 것은 그 도구를 쓸 수 없을 때의 degraded 폴백이며, 그 실행은 도구 진단·산출물 경로·active target·후속 요구 또는 후보 ID 를 사용자 보고에 함께 남긴다.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 의무**. 모든 hot-fix 는 `/kiwi-bug-repro` 가 돌려준 재현 테스트를 회귀 테스트로 채택하고, 그 재현 테스트가 fix 전에 red 이고 fix 뒤에 같은 테스트로 green 인 것을 확인한다. 우회 금지. 본 스킬은 원인 분석이나 재현 테스트 작성을 따로 하지 않는다(§4). speckiwi CLAUDE.md TDD 원칙 계승 (예외 1종: §4.0 `TDD_EXEMPT_REASON` ≥20자 명시 시 재현 테스트만 skip 허용 + 원인은 여전히 `/kiwi-bug-repro --analysis-only` 로 받음 + P7 정당성 평가 강제) |
| §0.2 | **까칠 리뷰어 의무**. 코드 수정 발생 시 반드시 까칠 리뷰어 서브에이전트 (현재 세션 모델, `--model` 로 override 가능) 호출 + 개선 루프. kiwi-coder Phase 2.f/2.g 동등 (§5 참조). 리뷰 skip 플래그 없음 — fix-and-forget 절대 금지 |
| §0.3 | **검증자는 별도 서브에이전트** (CLAUDE.md §5). 까칠 리뷰어 / 정형 검사기 / sync 위임 모두 별도 spawn |
| §0.4 | **검증자 입력 격리**. 시니어 fixer 의 결론·정당화 텍스트 전달 금지. 원본 diff + 버그 증상 + 테스트 결과만 |
| §0.5 | **/snoworca-\* 호출 절대 금지** (프로젝트 CLAUDE.md §7). 로직만 차용 |
| §0.6 | **Mock 금지** (regex 자동 탐지). CRITICAL severity. kiwi-coder §0.6 계승 |
| §0.7 | **외부 모듈 수정 금지**. cwd 외부 path 가 fix diff 에 진입 시 즉시 §0.G2 발동 |
| §0.8 | **시그니처 금지** (CLAUDE.md §6). 커밋·코드 주석·산출물 어디에도 AI 식별 정보 금지. `Co-Authored-By` 자동 추가 차단 |
| §0.9 | **MCP mutation 자체 호출 금지 (느슨 결합)**. 본 스킬은 직접 `add_requirement` / `add_trace_link` 등 MCP mutation 을 호출하지 않는다. 모든 SRS 변경은 §6 의 `/kiwi-srs-sync` Skill 호출 위임으로만 수행. 위임 실패 시 사용자 보고 + state.json `pending_sync` 적재. **예외 1종**: 사용자가 `--no-sync` 명시 시 위임 skip 허용 (사용자 책임) |
| §0.10 | **검증 서브에이전트 모델 정책 SSOT** (kiwi-coder §0.16 정합). 정형 검사·까칠 리뷰어 등 **검증 서브에이전트**는 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 검증 서브에이전트의 모델을 override 한다 (**시니어 fixer 는 영향 없음** — 현재 세션 모델 유지, kiwi-coder 시니어 코더와 동일). 위임된 `/kiwi-bug-repro` · `/kiwi-srs-sync` 호출에도 `--model` 전파 의무 |
| §0.11 | **`.kiwi/` 상태 영속**. 모든 단계 종료마다 `cwd/.kiwi/sessions/{run-id}/state.json` 갱신. 재개 가능 (kiwi-coder §7 패턴 계승, 단순화 버전) |
| §0.12 | **stability 게이트 우회 허용 (사후 정합화 전제)**. speckiwi CLAUDE.md 의 "stability=draft 차단" 규칙은 본 스킬에서 일시 우회 허용 — 단, 종료 시 `/kiwi-srs-sync` 위임으로 사후 정합화 의무 (§0.9). `--no-sync` 시 우회 금지 (stability 검사 강제) |
| §0.13 | **fix 단위 = 단일 의미 변경**. 본 스킬은 1회 실행당 단일 fix 의미 단위만 처리. 다중 이슈는 별도 실행으로 분리. 단일 fix 가 N개 파일에 걸쳐도 무방, 단 N개 파일이 서로 무관한 fix 면 거부 + 분리 권고 (§4.3 범위 판정에서) |
| §0.14 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. 본 스킬의 `--auto` 는 자식 `kiwi-srs-sync` 호출에 **`--auto` 만 전파**하며 `--auto-apply` / `--yes-all` 는 자동으로 추가하지 않는다 — 사용자가 직접 그 플래그를 지정한 경우에만 전파 (SSOT §7.1). `kiwi-srs-sync` 는 `--auto` 단독으로도 dry-run 선행과 critical_gates HALT (예: apply-all 비가역 MCP mutation) 를 유지하므로 부모 `--auto` 만으로 사용자 승인 게이트가 우회되지 않는다. 모든 런타임 변형(claude/codex/etc)이 동일한 안전 전파 계약을 따른다. `--auto-apply` / `--yes-all` 와의 의미 분리는 SSOT §11.1 참조. 본 스킬의 `critical_gates[]` 는 §0.G6 (아래) 참조 |
| §0.15 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §6.2 참고 | `--mini`/`--loops N` 는 kiwi-srs-sync 위임에 전파 (loop-option.md §6) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — 입력 자동 감지

| 입력 신호 | 우선순위 | 판정 |
|---|---|---|
| 인자 `ISSUE_URL=https://github.com/.../issues/N` 명시 | 1 | gh issue view → 본문·코멘트 수집 |
| 자연어에 GitHub issue URL 포함 (정규식 `https?://github\.com/[^/]+/[^/]+/issues/\d+`) | 2 | 동일 처리 |
| 자연어에 버그 증상 서술 (≥20자) | 3 | 자연어를 SYMPTOM 으로 사용 |
| `git status` 에 변경분 존재 + 위 1~3 모두 부재 | 4 | "이 변경이 hot-fix 인가?" 와 그 변경이 고치는 증상을 AskUserQuestion 으로 확인한 뒤 진행. 재현은 HEAD 의 임시 worktree 에서 한다(§4.1) |
| 위 1~4 모두 부재 | 5 | HALT + 사용자에게 입력 요청 |

#### §0.G2 — 외부 모듈 영향

| IF | THEN |
|---|---|
| fix diff 에 cwd 외부 path 진입 | 즉시 중단 + AskUserQuestion 3옵션 (cwd 한정 / 외부 포함 진행 / 작업장 이동) |
| 외부 모듈의 public API 호출만 추가 (외부 수정 없음) | WARN 만, 진행 |

#### §0.G3 — 개선 루프 발산

| IF | THEN |
|---|---|
| 시니어 fixer 재호출 3회 누적 | AskUserQuestion 4옵션 (§0.G3.1) |
| 까칠 리뷰어 재호출 2회 누적 + 동일 finding 잔존 | AskUserQuestion 4옵션 |
| 회귀 테스트 2회 연속 동일 파일 fail | 즉시 사용자 에스컬레이션 + state.json `failed: true` |

§0.G3.1 4옵션: `(1) draft-keep` (작업물 보존 + 종료) / `(2) partial-commit` (현재 상태에서 종료, sync 위임 여부 사용자 선택) / `(3) force-proceed` (사용자 책임으로 게이트 무시) / `(4) abandon` (아무것도 되돌리지 않고 종료. fixer 가 이 run 에서 바꾼 파일과 복사한 재현 테스트의 목록을 리포트에 적어 사용자가 직접 정리하게 한다).

#### §0.G4 — kiwi-srs-sync 위임 게이트

| IF | THEN |
|---|---|
| `--no-sync` 명시 | sync 위임 skip + state.json `sync_skipped: "user-opt-out"` |
| §0.G3.1 옵션 (1)(4) 선택 | sync 위임 skip (변경물 미존재 또는 미확정) |
| 위임 직전 테스트 충분성 확인(§6.2.1)이 `test-sufficiency-gap` 을 올림 | 위임하지 않고 멈춘다 (사용자 결정) |
| fix 적용 성공 + 회귀 PASS + 테스트 충분성 확인이 게이트를 올리지 않음(`pass` 또는 `no-scope`) + 위 미해당 | `/kiwi-srs-sync` Skill 호출 (자동), `--auto` 시 `--auto` 만 전파 (`--auto-apply` / `--yes-all` 는 사용자가 직접 지정한 경우에만) |
| Skill 호출 자체 실패 (Skill 도구 오류) | state.json `pending_sync: {reason}` + 사용자 보고 + 본 스킬 종료 |

#### §0.G5 — 외부 모듈 영향이 fix 의 본질인 경우

| IF | THEN |
|---|---|
| root-cause 가 cwd 외부 라이브러리 버그 + 본 cwd 에 wrapper/workaround 가 필요 | wrapper 가 cwd 내부면 정상 진행 (외부 수정 아님), wrapper 가 외부 path 면 §0.G2 발동 |

#### §0.G6 — `--auto` critical_gates[] 선언

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트 (SSOT `_shared/kiwi/auto-option.md` §5 인터페이스 준수). 아래 게이트는 `--auto` 무관 항상 사용자 결정 필요 — 결정 서브에이전트로 우회 금지:

| gate_id | reason | 발생 위치 |
|---|---|---|
| `no-sync-with-stability-gate` | `--no-sync` 명시 시 stability 검사 강제 (§0.12). draft REQ 영향 진입 시 차단 | §0.12 |
| `external-module-impact` | fix diff 에 cwd 외부 path 진입 (§0.7 / §0.G2) | §0.G2 |
| `improvement-loop-divergence-4opt` | §0.G3 4옵션 게이트 발동 (시니어 fixer 3회 / 까칠 2회 동일 finding / 회귀 2회 연속 동일 fail) | §0.G3 |
| `fix-complexity-large` | `fix_complexity_estimate == "large"` — 풀 파이프라인 권고 대상 (§4.3) | §4.3 |
| `bug-not-reproduced` | `/kiwi-bug-repro` 가 세 단계 끝까지 재현하지 못했거나, `TDD_EXEMPT_REASON` 없이 자동 테스트 없는 재현만 돌려줌. 그 스킬의 질문이나 결과를 그대로 사용자에게 내고 fix 를 적용하지 않는다 | §4.2 |
| `bug-not-a-bug` | `/kiwi-bug-repro` 가 재현한 동작이 SRS 나 문서화된 계약이 정한 그대로라고 보고함. 고칠 버그가 없으므로 fix 를 적용하지 않고 요구 변경은 `/kiwi-srs` 로 안내한다 | §4.2 |
| `bug-input-insufficient` | `/kiwi-bug-repro` 가 이슈를 읽을 수 없거나 기대 동작과 실제 동작이 없다고 보고함. 모자란 내용은 사용자만 안다 | §4.2 |
| `repro-base-moved` | `--resume` 에서 HEAD 가 재현 worktree 의 기준 커밋(`repro_base`)과 다름. 그 사이 사용자가 커밋했으므로 지금 복사하면 그 커밋의 수정을 작업 트리에서 되돌릴 수 있다 | §4.1 |
| `repro-dirty-tree` | 이슈나 자연어 증상 입력인데 작업 트리에 커밋하지 않은 변경이 있음. 그 변경이 fix 와 섞이므로, 커밋할지 치울지 그 변경이 fix 인지는 사용자가 정한다 | §4.1 |
| `bug-repro-question` | `/kiwi-bug-repro` 가 결과 대신 질문(`repro-restore-conflict` 등)으로 멈춤. 답은 사용자만 갖고 있다 | §4.2 |
| `repro-worktree-unprepared` | `git-status` 입력의 HEAD worktree 에 lockfile 대로 의존성을 준비할 수 없음. 설치 방법과 환경은 사용자만 안다 | §4.1 |
| `repro-path-occupied` | 재현 테스트나 보고서를 복사할 경로에 사용자 트리의 파일이 이미 있음. 복사하면 사용자의 커밋하지 않은 수정을 덮어쓴다 | §4.1 |
| `zero-tolerance-hypothesis-fix-mismatch` | fix 가 채택 가설과 무관한 변경 포함 (§5.2 ZERO TOLERANCE) | §5.2 |
| `mock-detection` | Mock regex 자동 탐지 CRITICAL (§0.6) | §0.6 / §5.2 |
| `mcp-cli-both-unavailable` | preflight MCP + CLI 모두 실패 — sync 위임 차단 / `--no-sync` 강제 | §3.0 case 5 |
| `test-sufficiency-gap` | 위임 직전 테스트 충분성 확인의 채우기 1회 뒤에도 인용 gap 이 남음 (`_shared/kiwi/test-sufficiency.md`) | Phase 6 — `kiwi-srs-sync` 위임 직전 (§6.2.1) |

**자식 sync 전파 (§7.1 SSOT)**: 본 스킬 `--auto` 활성 시 `kiwi-srs-sync` 호출 args 에 `--auto` 만 전파한다. `--auto-apply` / `--yes-all` 는 자동으로 추가하지 않으며, 사용자가 직접 그 플래그를 지정한 경우에만 전파한다 — codex/etc 변형과 동일한 안전 계약. `kiwi-srs-sync` 는 `--auto` 단독으로도 dry-run 선행과 critical_gates HALT 를 유지한다.

---

## 1. 입력 / 출력

### 1.1 필수 입력

(없음) — §0.G1 자동 감지.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| GitHub issue URL 포함 | `ISSUE_URL=...` | 자연어에서 추출 |
| "이 파일들만 보고", "범위는 X,Y" | `SCOPE_FILES=src/x.ts,src/y.ts` (콤마) | git status 자동 |
| "테스트 작성 어려움" — exempt 사유 | `TDD_EXEMPT_REASON="..."` (≥20자) | TDD 의무 강제 |
| "이 재현 보고서로", 기존 `/kiwi-bug-repro` 보고서 경로 | `BUG_REPRO_REPORT=docs/analysis/kiwi-bug-repro-{run-id}/` | 없음 (직전 파이프라인 이벤트에서 찾음, §4.0) |
| "sync 건너뜀", "SRS 동기화 안 함" | `--no-sync` | sync 의무 |
| "max 모드", "정밀" | `--max` | off (Normal) |
| "자동 적용", "확인 없이", "자동", "묻지 말고" | `--auto` (사용자 게이트 자동 결정; SSOT: auto-option.md v1.0. sync 위임 시 `--auto` 만 전파하고 `--auto-apply` / `--yes-all` 는 자동 추가 안 함) | off |
| "dry-run", "변경 없이" | `--dry-run` | off |
| "회귀 skip" | `--skip-regression` | off (회귀 의무) |
| "리뷰 강도 낮춤" — **불가** | (해당 인자 없음 — 까칠 리뷰는 §0.2 의무) | — |
| "--model <name>", "검증 모델 지정" | `--model <name>` | 현재 세션 모델 (검증 서브에이전트) |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |
| "재개" | `--resume` | off |

### 1.3 모드 매트릭스

정형 검사·까칠 리뷰어 **검증 서브에이전트**는 **현재 세션 모델(current session model)**을 상속하며 `--model <name>` (또는 사용자가 지명한 모델) 로 그 모델을 override 한다. 시니어 fixer 는 현재 세션 모델이나 `--model` 영향 없음 (kiwi-coder 시니어 코더와 동일). 원인 분석과 재현은 `/kiwi-bug-repro` 한 번에 맡기고 `--max` · `--model` 을 그 호출에 전파한다. `--max` 는 모델이 아니라 **count** 를 격상한다.

| 모드 | `/kiwi-bug-repro` 위임 | 시니어 fixer (현재 세션 모델) | 정형 검사 (현재 세션 모델) | 까칠 리뷰어 (현재 세션 모델) | 비용 배수 |
|---|---|---|---|---|---|
| Normal (기본) | × 1 | × 1 | × 1 | × 1 | 1.0× (기준) |
| `--max` | × 1 (`--max` 전파) | × 2 | × 1 | × 2 = **순차 2라운드**(동시 2기 아님), 2 연속 MEDIUM=0 종료 | 2× |

까칠 리뷰어는 **모든 모드에서 활성** (§0.2). off 플래그 없음.

### 1.4 출력 (산출물)

- **코드 변경**: fix 대상 파일에 직접 작성. git commit 은 사용자 결정 (시그니처 금지 §0.8)
- **분석 디렉토리**: `docs/analysis/kiwi-hot-fix-{run-id}/`
  - `input_inventory.json` — 입력 자동 감지 결과 (issue / 자연어 / git status)
  - `bug_repro.json` — `/kiwi-bug-repro` 결과 요약 (결과, 가장 유력한 원인과 `file:line`, 관련 요구 ID, 보고서 경로) + §4.3 범위 판정
  - `regression_test.json` — 회귀 테스트로 채택한 재현 테스트 메타 (파일/it/expected_failure_signature)
  - `fix_summary.json` — fixer 의 변경 요약 (file/line/symbol/rationale)
  - `formal_review_iter{N}.json` — 정형 검사 결과 (현재 세션 모델)
  - `prickly_review_iter{N}.json` — 까칠 리뷰 결과 (현재 세션 모델)
  - `regression_run.jsonl` — 회귀 테스트 실행 로그
  - `test_sufficiency.json` — 위임 직전 테스트 충분성 확인 결과 (§6.2.1)
  - `sync_delegation.json` — `/kiwi-srs-sync` Skill 호출 결과 요약
  - `rejected_findings.log`
- **`.kiwi/` 상태**: `cwd/.kiwi/sessions/{run-id}/` (kiwi-coder §7 단순화 버전)
  - `state.json` — phase, fix 상태, sync 위임 결과
  - `worklog.jsonl` — 이벤트 시계열
- **`/kiwi-srs-sync` 위임 산출물**: `docs/analysis/kiwi-srs-sync-{sync-run-id}/` (sync 스킬이 자체 생성)

**Run-id**: `{YYYY-MM-DD}.{project-slug}.hotfix-{ISO-time-short}`. 정규식: `^[a-z0-9.-]{4,50}$`. ASCII kebab, ≤50자.

### 1.5 `--dry-run`

- 코드 변경 / 회귀 테스트 작성·실행 / 까칠 리뷰 / sync 위임 모두 수행하되, 최종 fix diff 를 working tree 에 commit 하지 않고 patch 파일만 생성: `docs/analysis/kiwi-hot-fix-{run-id}/fix.patch`
- sync 위임도 dry-run 전파 (`--dry-run-only` 옵션으로 호출)
- 보고서 `mode: "dry-run"` 명시

---

## 2. Phase 흐름

```
Phase 0 : Bootstrap (preflight, 입력 자동 감지, .kiwi init/resume)
Phase 1 : 원인 분석과 재현 — `/kiwi-bug-repro` 위임 + 범위 판정
Phase 2 : 재현 테스트를 회귀 테스트로 채택 (TDD red 확정)
Phase 3 : Fix 적용 (시니어 fixer 서브에이전트 — 현재 세션 모델)
Phase 4 : 정형 검사 (현재 세션 모델×1) + 까칠 리뷰 (현재 세션 모델×1/2) + 개선 루프
Phase 5 : 회귀 테스트 실행 (green 확인 + 영향 회귀)
Phase 6 : 테스트 충분성 확인(`_shared/kiwi/test-sufficiency.md`) → kiwi-srs-sync Skill 위임
Phase 7 : 보고서 + pipeline.jsonl emit
```

---

## 3. Phase 0 — Bootstrap

### 3.0 preflight

판정 순서:
1. MCP `get_active_target` 성공 → PASS (sync 위임 사전 준비)
2. CLI `speckiwi --version` exit 0 → PASS (`mode: "cli-fallback"`)
3. git 환경 확인: `git rev-parse --git-dir` 성공 → PASS
4. GitHub issue 입력 시 `gh --version` exit 0 확인 → PASS (없으면 WARN + 자연어 fallback)
5. 위 1·2 모두 실패 → sync 위임 차단 + 사용자 보고 (`--no-sync` 강제)

### 3.1 입력 자동 감지 (§0.G1 적용)

알고리즘:
```
if ISSUE_URL 인자 또는 자연어에 GitHub issue URL:
  inputs.issue = gh issue view {N} --json title,body,comments
  inputs.source = "github-issue"
elif 자연어 ≥20자 (버그 증상 서술):
  inputs.symptom = 자연어 전체
  inputs.source = "natural-language"
elif git status 에 변경분 존재:
  AskUserQuestion("현재 working tree 의 변경분이 hot-fix 대상인가?", [yes, no])
  yes → inputs.symptom = AskUserQuestion("이 변경이 고치는 증상은?")
        inputs.diff = git diff HEAD; inputs.source = "git-status"
  no → HALT
else:
  HALT + 입력 요청
```

산출물: `input_inventory.json`

### 3.2 .kiwi init / resume

`--resume` 또는 `cwd/.kiwi/sessions/{run-id}/state.json` 존재 시 마지막 phase 부터 재개. 신규 시 init.

state.json 초기 스키마:
```json
{
  "run_id": "...",
  "skill": "kiwi-hot-fix",
  "schema_version": "1.0.0",
  "started_at": "ISO-8601",
  "mode_flags": ["--model?", "--max?", "--auto?", "--dry-run?", "--no-sync?"],
  "input_source": "github-issue|natural-language|git-status",
  "repro_worktree": null,
  "repro_base": null,
  "phase": "0|1|...|7",
  "fix_applied": false,
  "review_iter": 0,
  "regression_pass": false,
  "sync_delegated": false,
  "sync_run_id": null,
  "failed": false,
  "pending_sync": null
}
```

### 3.3 사용자 비용 안내

Normal 비용 ≤ kiwi-coder 단일 task 수준. 사용자 게이트 없이 진행 (단 `--max` 시 안내만 1회 출력).

---

## 4. Phase 1 — 원인 분석과 재현 (`/kiwi-bug-repro` 위임)

본 스킬은 원인 분석도 재현도 직접 하지 않는다. 둘 다 `/kiwi-bug-repro` 가 한다. 정적 분석으로 원인 후보를 추리고, 가장 작은 범위부터 재현해 증상과 같게 실패하는 재현 테스트를 돌려준다.

### 4.0 부르기 전에 확인할 것

1. **`TDD_EXEMPT_REASON`** 이 처음부터 있으면 재현 테스트만 건너뛰고, 원인은 `/kiwi-bug-repro --analysis-only` 로 받아 가장 유력한 원인을 fix 가설로 쓴다. 이 모드는 단계를 돌리지 않고 테스트도 쓰지 않는다. 까칠 리뷰어가 exempt 사유를 P7 로 평가한다(§5.1).
2. **기존 보고서**: `BUG_REPRO_REPORT` 가 주어졌거나 직전 파이프라인 이벤트가 같은 입력에 대한 `kiwi-bug-repro` 실행이면(그 이벤트의 `artifacts.analysis_dir`), 그 보고서를 쓰고 다시 재현하지 않는다. 같은 입력인지는 그 보고서의 `input.md` 를 §3.1 이 감지한 입력과 대조해 정하고, 다르면 새로 부른다. `git-status` 입력에 기존 보고서를 쓰면 Phase 2 의 red 확인에 HEAD worktree 가 여전히 필요하다: §4.1 대로 worktree 를 만들고 준비한 뒤, 그 보고서의 재현 테스트를 worktree 의 같은 경로에 놓고 거기서 red 를 확인한다.

### 4.1 호출

```
Skill(skill="kiwi-bug-repro", args="<§3.1 이 감지한 입력> --no-pipeline-emit {auto} {max} {model} {mini|loops}")
```

- 입력은 §3.1 이 감지한 것을 그대로 넘긴다. 이슈면 그 이슈(링크나 읽은 본문), 자연어면 그 증상 서술이다.
- `--auto` · `--max` · `--model` · `--mini` / `--loops N` 은 그대로 전파한다.
- **작업 트리에 커밋하지 않은 변경이 있는데 입력이 이슈나 자연어 증상이면** 재현하기 전에 멈춰서 사용자에게 묻는다(`repro-dirty-tree`, `--auto` 에서도): 그 변경이 fix 와 섞여 green 이 누구 덕인지, fix diff 가 무엇인지 가릴 수 없기 때문이다. 여기서 셀 변경은 추적되는 파일의 커밋하지 않은 변경 가운데, 이 입력에 대한 `/kiwi-bug-repro` 실행이 `state.json` 에 적은 파일 중 지금 해시가 기록된 해시와 같고 그 실행이 새로 만들었거나 고치기 전 HEAD 와 같았던 파일과, 그 실행의 보고서 디렉토리를 뺀 것이다. 이 확인은 `/kiwi-bug-repro` 를 부르기 전(`--analysis-only` 포함)과 기존 보고서를 쓰기 전에 한다. 사용자가 그 변경을 커밋하거나 치운 뒤 재개하면 그대로 진행하고, 그 변경이 이 버그의 fix 라고 답하면 `git-status` 입력으로 다룬다.
- **`git-status` 입력**: 사용자의 변경은 stash 하지도, reset 하지도, checkout 하지도 않는다. 재현은 HEAD 의 임시 worktree 에서 한다. `git worktree add <OS 임시 디렉토리>/kiwi-hot-fix-{run-id} HEAD` 로 만들고 그 경로를 `state.json.repro_worktree` 에, 그 HEAD 의 sha 를 `state.json.repro_base` 에 적는다. `git worktree add` 는 `node_modules` 같은 무시된 파일을 가져오지 않으므로, `/kiwi-bug-repro` 를 부르기 전에 저장소의 lockfile 대로 그 worktree 의 의존성을 수명주기 스크립트를 끈 설치 명령(예: `npm ci --ignore-scripts`)으로 준비한다. lockfile 이 없는 생태계(Maven, Gradle 등)는 그 빌드 도구가 의존성을 받는 명령으로 준비하고, 받을 의존성이 없는 프로젝트는 준비할 것도 없다. 의존성을 준비할 수 없으면(설치가 실패하거나, 스크립트를 끄면 테스트를 돌릴 수 없으면) 멈춰서 사용자에게 묻는다(`repro-worktree-unprepared`, `--auto` 에서도). 그다음 그 worktree 안에서 사용자가 확인해 준 증상으로 `/kiwi-bug-repro` 를 부른다. 사용자의 작업 트리에서는 그 변경이 증상을 가릴 수 있으므로 거기서는 `/kiwi-bug-repro` 를 부르지 않는다. 재현 테스트는 그 worktree 에서 red 여야 한다. 돌아온 재현 테스트와 보고서 디렉토리는 `/kiwi-bug-repro` 가 만든 파일(그 `state.json` 이 만든 파일로 적은 것)일 때, 사용자의 작업 트리에서 파일이 없는 경로에만 복사한다. 재현이 HEAD 에 이미 있던 파일을 고쳤으면, 사용자 트리의 그 파일이 `repro_base` 의 판과 바이트까지 같을 때만(사용자가 건드리지 않았을 때만) 복사한다. 이 비교는 사용자의 작업 트리에서 `git diff --quiet <repro_base> -- <경로>` 로 한다: 줄 끝 변환(autocrlf)은 차이로 보지 않는다. 그 밖의 경우(사용자가 그 파일을 고치거나 옮기거나 지웠거나, 경로가 이미 차 있으면)에는 복사하지 않고 손으로 합치지도 않으며, 멈춰서 사용자에게 묻는다(`repro-path-occupied`, `--auto` 에서도). 복사하면 사용자의 커밋하지 않은 작업을 덮어쓰거나 되돌리기 때문이다. 사용자가 그 케이스를 직접 옮겼다고 답하면 `--resume` 은 사용자 트리에서 그 재현 테스트를 찾아 Phase 2 로 간다. 아직 복사하지 않은 채 `--resume` 하는데 HEAD 가 `repro_base` 와 다르면(사용자가 기다리는 동안 커밋했으면) 아무것도 복사하지 않고 멈춰서 사용자에게 묻는다(`repro-base-moved`, `--auto` 에서도). 사용자가 다시 재현하라고 답하면 `--resume` 은 그 worktree 를 지우고 지금 HEAD 로 다시 만들어 `repro_base` 를 새로 적은 뒤 `/kiwi-bug-repro` 를 다시 부른다. 사용자의 변경이 fix 후보이고 이 재현 테스트가 그 변경으로 green 이 되어야 한다. 모자라면 시니어 fixer 는 그 변경을 완성하며, 두 번째 fix 를 따로 더하지 않는다. run 이 사용자 답을 기다리며 멈춘 동안(`bug-not-reproduced`, `bug-input-insufficient`, `repro-worktree-unprepared`, `repro-path-occupied`, `repro-base-moved` 의 질문)에는 worktree 를 남겨 둔다. `--resume` 은 `state.json.repro_worktree` 의 worktree 를 다시 쓴다. `--resume` 에서 그 경로가 없으면 `git worktree prune` 으로 남은 등록을 지운 뒤 같은 방식으로 다시 만든다. worktree 를 지우기 전에, 그 안의 `/kiwi-bug-repro` 보고서 디렉토리 가운데 `state.json` 에 끝났다고 기록되어 있고 사용자 트리에 아직 없는 것만 사용자 트리의 같은 경로로 옮겨 둔다. 끝나지 않은 보고서는 옮기지 않는다: 옮기면 다음 `/kiwi-bug-repro` 실행이 그 복구 기록을 사용자 파일에 적용하기 때문이다. run 이 완료되거나, `bug-not-a-bug` 로 끝나거나, 포기되면 `git worktree remove --force <경로>` 로 지우고 `repro_worktree` 를 비운다. run 을 포기해도 이 run 이 사용자 트리에 복사한 재현 테스트는 지우지도 되돌리지도 않는다: 복사 뒤에 사용자가 고쳤을 수 있기 때문이다. 대신 그 경로와 fixer 가 바꾼 파일을 리포트에 적어 사용자에게 알린다. 포기는 사용자 트리에서 아무것도 되돌리지 않는다.

### 4.2 결과 처리

| 결과 | 처리 |
|---|---|
| 재현됨 (`reproduced`) | `bug_repro.json` 에 기록하고 Phase 2 로 간다. 재현 테스트가 회귀 테스트이고, 가장 유력한 원인이 fix 가설이다 |
| 자동 테스트 없이 재현됨 (`reproduced-no-test`) | 자동 테스트 없이 재현됐으면 `TDD_EXEMPT_REASON` 이 없는 한 멈추고 fix 를 적용하지 않는다 (`bug-not-reproduced`). `reproduced-no-test` 로 멈춘 뒤 사용자가 `--resume` 에 `TDD_EXEMPT_REASON` 을 주면, 이미 재현했으므로 `--analysis-only` 를 다시 부르지 않고 그 재현의 스크립트를 fix 전과 뒤에 돌려 확인한다. 재현 스크립트는 `/kiwi-bug-repro` §0.2 대로 자격 증명을 뺀 격리된 임시 사본에서 돌고, `git-status` 입력이면 fix 전에는 `repro_worktree` 를, fix 뒤에는 사용자 트리를 그 사본의 원본으로 쓴다 |
| 재현하지 못함 (`not-reproduced`) | 멈추고 `/kiwi-bug-repro` 의 질문을 그대로 사용자에게 낸다. 재현하지 못했으므로 **fix 를 적용하지 않는다** (`bug-not-reproduced`, `--auto` 에서도) |
| 버그가 아님 (`not-a-bug`) | 멈추고 버그가 아니라는 판정의 근거(요구 ID·AC 또는 문서 문장)를 보고한다. 버그가 아님 판정이므로 **fix 를 적용하지 않고** 요구 변경은 `/kiwi-srs` 로 안내한다 (`bug-not-a-bug`) |
| 입력 부족 (`input-insufficient`) | 멈추고 그 질문을 그대로 사용자에게 낸다. fix 를 적용하지 않는다 |

`/kiwi-bug-repro` 는 파이프라인 상태가 아니라 위 결과 하나를 돌려준다. `not-reproduced` 나 `input-insufficient` 로 돌아오면 fix 를 적용하지 않고 멈춘다(`--auto` 에서도). 그 밖의 질문(`repro-restore-conflict` 등)으로 멈춰도 그 질문을 그대로 내고 fix 를 적용하지 않고 멈춘다(`bug-repro-question`, `--auto` 에서도). 사용자가 답하면 본 스킬이 `--resume` 에서 그 답을 입력에 더해 `/kiwi-bug-repro` 를 다시 부른다(`git-status` 입력이면 `repro_worktree` 안에서).

### 4.3 범위 판정

원인을 다시 분석하지 않는다. `/kiwi-bug-repro` 가 돌려준 가장 유력한 원인의 `file:line` 과 재현 테스트(exempt 면 `--analysis-only` 의 원인 목록)를 읽어 `bug_repro.json` 에 다음을 적는다:

- `affected_files`: 가장 유력한 원인과 재현 테스트가 가리키는 파일
- `candidate_req_ids`: `/kiwi-bug-repro` 가 돌려준 관련 요구 ID. 재현 테스트 제목 줄이 인용한 요구는 `match_confidence: high`, 나머지는 `medium`
- `external_module_touch`: 원인이 cwd 밖에 있으면 `true` → §0.G2 · §0.G5
- `fix_complexity_estimate` (`trivial|small|medium|large`): `fix_complexity_estimate = large` 면 `fix-complexity-large` 로 멈추고 `/kiwi-srs` → `/kiwi-pm` 풀 파이프라인을 권고한다

---

## 5. Phase 2~4 — TDD + Fix + 까칠 리뷰

### 5.1 Phase 2 — 재현 테스트를 회귀 테스트로 채택

`/kiwi-bug-repro` 가 돌려준 재현 테스트가 이 hot-fix 의 회귀 테스트다. 시니어 fixer 는 같은 증상을 단언하는 테스트를 새로 쓰지 않는다.

1. 재현 테스트를 한 번 돌려 red 인 것을 확인하고(`git-status` 입력이면 `repro_worktree` 에서. 사용자의 트리에서는 그 변경 때문에 이미 green 일 수 있다), 실패 메시지를 `regression_test.json.expected_failure_signature` 에 저장한다 — `/kiwi-bug-repro` 가 기록한 red 출력과 같은 증상이어야 한다.
2. red 가 아니면(그 사이 트리가 바뀜) fix 를 적용하지 않고 멈춰 사용자에게 보고한다.
3. 재현 테스트를 약화하거나 고쳐서 통과시키지 않는다. Phase 5 의 green 은 이 같은 테스트로 판정한다.

**TDD exempt** (§4.0):
- `TDD_EXEMPT_REASON` 인자 (≥20자) 명시 시 위 1~3 을 건너뛴다. 원인 분석은 건너뛰지 않는다. fix 가설과 §4.3 범위 판정은 `--analysis-only` 결과로 fix 전에 정한다
- exempt 시 `regression_test.json.exempted: true` + `reason` 기록
- 까칠 리뷰어가 exempt 사유의 정당성을 추가 평가 (axis P7, MEDIUM warn 가능)

### 5.2 Phase 3 — Fix 적용

시니어 fixer 서브에이전트가 다음을 수행:

1. `bug_repro.json` 의 가장 유력한 원인(fix 가설)에 기반한 최소 변경
2. Mock 금지 (§0.6). regex 자동 탐지: `mock\(`, `jest\.fn\(\)`, `unittest\.mock`, `MagicMock` 등
3. cwd 외부 path 편집 시도 차단 (§0.7 / §0.G2)
4. 변경 요약을 `fix_summary.json` 에 기록 (file/line_range/symbol/rationale/change_type)

**ZERO TOLERANCE 가설-fix 일치 게이트**: fix 가 `bug_repro.json` 의 가장 유력한 원인과 무관한 변경을 포함하면 CRITICAL.

### 5.3 Phase 4 — 정형 검사 + 까칠 리뷰 (§0.2 의무)

#### 5.3.1 정형 검사 (현재 세션 모델×1, 4축)

입력: fix diff + 회귀 테스트 + bug_repro.json (단 §0.4 격리 — fixer rationale strip)
축:
- F1: syntax/type 무결성 (언어별 linter/타입체커 시뮬레이션)
- F2: 코드 스타일 일관성 (기존 코드와 비교)
- F3: import/export 정합성
- F4: TDD 흐름 정합 (red → fix → green 순서 위반 여부)

severity: F1 CRITICAL, F2-F4 HIGH.

산출물: `formal_review_iter{N}.json`

#### 5.3.2 까칠 리뷰 (현재 세션 모델×1, 7축 — hot-fix 고유 축)

입력: fix diff + 회귀 테스트 + symptom (단 §0.4 격리 — fixer rationale strip)
축 (hot-fix 고유 축 — kiwi-coder §5.2 와 주제가 다르므로 그 표를 차용하지 않는다):
- P1: root-cause 정합성 — fix 가 실제 root cause 를 해결하는가 (band-aid 금지)
- P2: 회귀 위험 — 영향 범위 / side effect 평가
- P3: 보안 — 입력 검증 누락 / 인증·인가 우회
- P4: 성능 — 명백한 회귀 (O(n²) / N+1 / 메모리 누수)
- P5: 동시성 — race / deadlock 가능성
- P6: 에러 처리 — silent failure / 잘못된 fallback
- P7: hot-fix 적정성 — 본 변경이 hot-fix 로 적절한가, 정식 SRS 갱신 권고 사항 (HIGH → 사용자 보고)

severity: P1-P5 CRITICAL, P6 HIGH, P7 HIGH (정보성 가능).

산출물: `prickly_review_iter{N}.json`

#### 5.3.3 개선 루프 (심각도 카운터)

| 종료 조건 | 모드 |
|---|---|
| CRITICAL=0 + HIGH=0 | Normal PASS |
| 2 라운드 연속 MEDIUM=0 | Max PASS |

미충족 시 fixer 재호출 (`bug_repro.json` + 새 finding 만 전달, §0.4 격리). 카운터 초과 시 §0.G3 발동.

---

## 6. Phase 5~6 — 회귀 + sync 위임

### 6.1 Phase 5 — 회귀 테스트

1. Phase 2 에서 red 를 확인한 같은 재현 테스트 실행 → green 확인 (red before, green after). fail 시 Phase 4 개선 루프 편입 (HIGH 카운터 소모). **TDD exempt 활성 시** (state.tdd_exempted=true) step 1 skip + state.json `regression_pass=skipped` 기록 + step 2 만 진행
2. `--skip-regression` 부재 시 영향 회귀 (`bug_repro.json.affected_files` 의 모든 테스트) 실행
3. 회귀 PASS → Phase 6 진입. fail → §0.G3 (2 연속 동일 fail 시 즉시 에스컬레이션)
4. 결과: `regression_run.jsonl`

### 6.2 Phase 6 — kiwi-srs-sync 위임

#### 6.2.1 위임 결정 (§0.G4 적용)

**위임 직전 테스트 충분성 확인** — `_shared/kiwi/test-sufficiency.md` 를 범위 `--ids <bug_repro.json.candidate_req_ids 중 match_confidence=high>` 로 따르고 결과를 `test_sufficiency.json` 에 남긴다. gap 이 남으면 `test-sufficiency-gap` 으로 멈추고 위임하지 않는다. 범위가 비면 결과는 `no-scope` 이고 위임은 진행한다 — `kiwi-srs-sync` 가 `verified` 를 쓰기 직전에 같은 확인을 다시 돈다. 위임하지 않는 실행(§6.2.3)에서는 돌지 않는다. `--dry-run` 이면 계약 §3 대로 채우기 없이 처음 결과만 적는다.

조건 통과 시 다음을 메인이 수행:

```
Skill(skill="kiwi-srs-sync", args="{auto} {model} --staged 또는 --files={fix 대상 파일 콤마}")
```

`args` 구성 규칙:
- `--auto` → `--auto` 만 전파 (`--auto-apply` / `--yes-all` 는 자동으로 추가하지 않으며, 사용자가 직접 그 플래그를 지정한 경우에만 전파). `kiwi-srs-sync` 는 `--auto` 단독으로도 dry-run 선행 + critical_gates HALT 를 유지
- `--model <name>` 활성 → 전파 (부모가 지정한 검증 모델을 자식에 명시)
- `--mini` / `--loops N` 활성 → 그대로 `kiwi-srs-sync` 위임에 전파 (loop-option.md §6)
- `--dry-run` → `--dry-run-only` 전파
- fix 대상 파일이 명확 (`fix_summary.json.files`) → `--files=...` 전달, 그 외 `--staged`

#### 6.2.2 위임 결과 처리

`/kiwi-srs-sync` 종료 후:
- 정상 종료 → `sync_delegation.json` 에 sync run_id / 4방향 분류 통계 / 적용된 mutation 수 기록
- Skill 호출 자체 실패 (Skill 도구 오류) → state.json `pending_sync: { reason, suggested_cli }` + 사용자 보고 (수동 호출 권고)
- sync 가 DRY_RUN 으로 종료 (사용자가 사용자 게이트에서 dry-run-only 선택) → state.json `sync_status: "dry_run"` + 후속 권고 안내

#### 6.2.3 위임 skip 케이스

- `--no-sync` 명시 (§0.G4)
- §0.G3.1 옵션 (1)(4) — fix 미적용 또는 rollback
- preflight 에서 MCP/CLI 모두 실패 (§3.0 case 5)

skip 시 `sync_delegation.json.skipped: true` + `reason` 기록.

---

## 7. Phase 7 — 보고서 + pipeline emit

### 7.1 보고서

`docs/analysis/kiwi-hot-fix-{run-id}/report.md`:

```yaml
---
run_id: ...
mode: normal|max|dry-run
input_source: github-issue|natural-language|git-status
fix_files: [...]
regression_pass: true|false
test_sufficiency: pass|gap|no-scope
review_iter: N
sync_delegated: true|false
sync_run_id: ...
---
```

본문 섹션:
1. 사용된 플래그 + 비용 배수
2. 입력 요약 (issue title / 자연어 / git status 변경분)
3. `/kiwi-bug-repro` 결과 (가장 유력한 원인 + `file:line`, 보고서 경로)
4. 회귀 테스트로 채택한 재현 테스트 (파일·it·fix 전 red 시그니처·fix 뒤 green)
5. 적용된 fix 요약 (파일별 변경 라인 + rationale)
6. 정형 + 까칠 리뷰 결과 (axis 별 finding + 해소 라운드)
7. 회귀 테스트 실행 결과 (PASS/FAIL + 실행 시간)
8. 테스트 충분성 확인 결과 (`test_sufficiency.json` 의 verdict · 범위 · 채우기로 더한 테스트)
9. kiwi-srs-sync 위임 결과 (sync run_id + 4방향 분류 통계 + 적용 mutation)
10. 잔존 MEDIUM/LOW finding (사후 검토 권고)
11. 메타 (실측 토큰, 시간)

### 7.2 Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- `skill`: `"kiwi-hot-fix"` (pipeline-event.md §3 의 skill enum 에 등재됨)
- `status`: fix + 회귀 PASS + sync 위임 성공 = `TASK_DONE`; sync 위임 dry-run 또는 skip = `DRY_RUN`; 사용자 게이트 보류 = `NEEDS_USER`; 실패 = `FAILED`
- `next_hint`: 통상 `"kiwi-commit-auto-push"` (사용자가 commit 결정), sync 위임 후속 검토 필요 시 `"kiwi-pipeline"`
- `req_ids`: sync 위임이 영향 준 REQ-ID 배열 (sync_delegation.json 에서 추출)
- `artifacts.analysis_dir`: `docs/analysis/kiwi-hot-fix-{run-id}/`
- `notes`: "delegated to kiwi-srs-sync run_id=... / fix_files=N / review_iter=M" 권장

emit 실패는 best-effort.

---

## 8. 호출 예시

```
/kiwi-hot-fix
/kiwi-hot-fix "로그인 후 세션 즉시 만료되는 버그"
/kiwi-hot-fix ISSUE_URL=https://github.com/owner/repo/issues/42
/kiwi-hot-fix SCOPE_FILES=src/auth.ts,src/session.ts "토큰 갱신 실패"
/kiwi-hot-fix --max
/kiwi-hot-fix --model claude-sonnet-4-6
/kiwi-hot-fix --auto
/kiwi-hot-fix --no-sync
/kiwi-hot-fix --dry-run
/kiwi-hot-fix --resume
```

자연어 매핑 예시:
- "이 이슈 고쳐줘 https://github.com/owner/repo/issues/42" → ISSUE_URL 자동
- "프로덕션에서 로그인 안 됨, 빨리 고쳐줘" → natural-language source
- "현재 작업물이 hot-fix 야" → git-status source (확인 게이트)

---

## 9. 기존 스킬과의 경계

| 시나리오 | 사용 스킬 |
|---|---|
| 신규 요구사항 → SRS 증분 (spec-first) | `/kiwi-srs` |
| 코드 변경 → SRS 사후 동기화 (단독) | `/kiwi-srs-sync` |
| SRS 선행 풀 구현 (본문 범위 작업) | `/kiwi-srs` → `/kiwi-pm` (`--sds` 면 그 사이에 `/kiwi-sds`) |
| 단일 task TDD 구현 | `/kiwi-coder` |
| 버그 확인·재현만 (fix 없이) | `/kiwi-bug-repro` |
| **긴급 버그 fix + 까칠 리뷰 + 회귀 + SRS 사후 동기화** (본 스킬) | `/kiwi-hot-fix` |
| 이미 머지된 코드 / 외부 PR 셀프 리뷰 | `/kiwi-review-fix-loop` |

---

## 10. Out of Scope

| 범위 밖 | 담당 스킬 |
|---|---|
| 신규 기능 개발 (hot-fix 아닌 normal feature) | `/kiwi-srs` → `/kiwi-pm` (`--sds` 면 그 사이에 `/kiwi-sds`) |
| 대규모 refactor / 아키텍처 변경 | `/kiwi-srs` → `/kiwi-pm` 풀 파이프라인 |
| 다중 무관 이슈 동시 처리 | 본 스킬 다회 실행 (단일 fix 의미 단위, §0.13) |
| MCP mutation 직접 호출 | `/kiwi-srs-sync` 위임 (§0.9) |
| git commit / push | 사용자 결정 또는 `/kiwi-commit-auto-push` |
| 통합 테스트 | `/kiwi-coder` Phase 4 |
| 코드 리뷰 단독 (fix 없이) | `/kiwi-review-fix-loop` 셀프 모드 |
