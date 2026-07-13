---
name: kiwi-hot-fix
description: "긴급 버그·운영 이슈에 대해 SRS→planner→pm→coder 풀 파이프라인을 우회하면서도 speckiwi 거버넌스(REQ-ID·TDD·sync)를 유지하는 hot-fix 스킬. 입력 자동 감지(GitHub issue URL / 자연어 증상 / git status 변경분) + Sonnet×2 root-cause 사전조사 병렬 + 회귀 테스트 선행 작성(TDD) + 시니어 fixer + 정형 검사 + 까칠 리뷰어 + 개선 루프 + 회귀 테스트 + 종료 시 `/kiwi-srs-sync` Skill 호출 위임으로 SRS 사후 동기화. **코드 수정 발생 시 까칠 리뷰어 서브에이전트 의무**(kiwi-coder Phase 2.f/2.g 동등). 트리거 — kiwi hot fix, 핫픽스, hot-fix, 긴급 수정, 긴급 패치, 운영 이슈 수정, hotfix, urgent fix, 버그 긴급 수정, 이 이슈 고쳐줘, 빠르게 고쳐줘, 즉시 수정, prod 이슈, production hotfix, issue 처리, github issue 수정. 검증(정형 검사·까칠 리뷰어) 서브에이전트는 현재 세션 모델을 상속하며 `--model <name>` 로 override 한다(시니어 fixer 는 영향 없음; Root-cause 사전조사 Sonnet 불변). --max 로 까칠 ×2 강도 승격. --auto 로 사용자 게이트 자동 진행(severity 가드레일). --no-sync 로 kiwi-srs-sync 위임 skip."
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

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 의무**. 모든 hot-fix 는 (1) 버그 재현 회귀 테스트 작성 → (2) red 실패 확인 → (3) fix 적용 → (4) green 확인 순서. 우회 금지. speckiwi CLAUDE.md TDD 원칙 계승 (예외 1종: §5.1 `TDD_EXEMPT_REASON` ≥20자 명시 시 회귀 테스트 작성 skip 허용 + P7 정당성 평가 강제) |
| §0.2 | **까칠 리뷰어 의무**. 코드 수정 발생 시 반드시 까칠 리뷰어 서브에이전트 (현재 세션 모델, `--model` 로 override 가능) 호출 + 개선 루프. kiwi-coder Phase 2.f/2.g 동등 (§5 참조). 리뷰 skip 플래그 없음 — fix-and-forget 절대 금지 |
| §0.3 | **검증자는 별도 서브에이전트** (CLAUDE.md §5). 까칠 리뷰어 / 정형 검사기 / sync 위임 모두 별도 spawn |
| §0.4 | **검증자 입력 격리**. 시니어 fixer 의 결론·정당화 텍스트 전달 금지. 원본 diff + 버그 증상 + 테스트 결과만 |
| §0.5 | **/snoworca-\* 호출 절대 금지** (프로젝트 CLAUDE.md §7). 로직만 차용 |
| §0.6 | **Mock 금지** (regex 자동 탐지). CRITICAL severity. kiwi-coder §0.6 계승 |
| §0.7 | **외부 모듈 수정 금지**. cwd 외부 path 가 fix diff 에 진입 시 즉시 §0.G2 발동 |
| §0.8 | **시그니처 금지** (CLAUDE.md §6). 커밋·코드 주석·산출물 어디에도 AI 식별 정보 금지. `Co-Authored-By` 자동 추가 차단 |
| §0.9 | **MCP mutation 자체 호출 금지 (느슨 결합)**. 본 스킬은 직접 `add_requirement` / `add_trace_link` 등 MCP mutation 을 호출하지 않는다. 모든 SRS 변경은 §6 의 `/kiwi-srs-sync` Skill 호출 위임으로만 수행. 위임 실패 시 사용자 보고 + state.json `pending_sync` 적재. **예외 1종**: 사용자가 `--no-sync` 명시 시 위임 skip 허용 (사용자 책임) |
| §0.10 | **검증 서브에이전트 모델 정책 SSOT** (kiwi-coder §0.16 정합). 정형 검사·까칠 리뷰어 등 **검증 서브에이전트**는 기본적으로 **현재 세션 모델(current session model)**을 상속한다. `--model <name>` (또는 사용자가 지명한 모델) 로 검증 서브에이전트의 모델을 override 한다 (**시니어 fixer 는 영향 없음** — 현재 세션 모델 유지, kiwi-coder 시니어 코더와 동일). **Sonnet×2 root-cause 사전조사는 모든 모드·`--model` 무관 Sonnet 고정** (cheap pre-investigation). 위임된 `/kiwi-srs-sync` 호출에도 `--model` 전파 의무 |
| §0.11 | **`.kiwi/` 상태 영속**. 모든 단계 종료마다 `cwd/.kiwi/sessions/{run-id}/state.json` 갱신. 재개 가능 (kiwi-coder §7 패턴 계승, 단순화 버전) |
| §0.12 | **stability 게이트 우회 허용 (사후 정합화 전제)**. speckiwi CLAUDE.md 의 "stability=draft 차단" 규칙은 본 스킬에서 일시 우회 허용 — 단, 종료 시 `/kiwi-srs-sync` 위임으로 사후 정합화 의무 (§0.9). `--no-sync` 시 우회 금지 (stability 검사 강제) |
| §0.13 | **fix 단위 = 단일 의미 변경**. 본 스킬은 1회 실행당 단일 fix 의미 단위만 처리. 다중 이슈는 별도 실행으로 분리. 단일 fix 가 N개 파일에 걸쳐도 무방, 단 N개 파일이 서로 무관한 fix 면 거부 + 분리 권고 (사전조사 단계에서 판정) |
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
| `git status` 에 변경분 존재 + 위 1~3 모두 부재 | 4 | "이 변경이 hot-fix 인가?" AskUserQuestion 후 진행 |
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

§0.G3.1 4옵션: `(1) draft-keep` (작업물 보존 + 종료) / `(2) partial-commit` (현재 상태에서 종료, sync 위임 여부 사용자 선택) / `(3) force-proceed` (사용자 책임으로 게이트 무시) / `(4) abandon` (변경 rollback + 종료).

#### §0.G4 — kiwi-srs-sync 위임 게이트

| IF | THEN |
|---|---|
| `--no-sync` 명시 | sync 위임 skip + state.json `sync_skipped: "user-opt-out"` |
| §0.G3.1 옵션 (1)(4) 선택 | sync 위임 skip (변경물 미존재 또는 미확정) |
| fix 적용 성공 + 회귀 PASS + 위 미해당 | `/kiwi-srs-sync` Skill 호출 (자동), `--auto` 시 `--auto` 만 전파 (`--auto-apply` / `--yes-all` 는 사용자가 직접 지정한 경우에만) |
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
| `fix-complexity-large` | `fix_complexity_estimate == "large"` — 풀 파이프라인 권고 대상 (§4.1) | §4.1 |
| `zero-tolerance-hypothesis-fix-mismatch` | fix 가 채택 가설과 무관한 변경 포함 (§5.2 ZERO TOLERANCE) | §5.2 |
| `mock-detection` | Mock regex 자동 탐지 CRITICAL (§0.6) | §0.6 / §5.2 |
| `mcp-cli-both-unavailable` | preflight MCP + CLI 모두 실패 — sync 위임 차단 / `--no-sync` 강제 | §3.0 case 5 |

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
| "재현 안 됨", "테스트 작성 어려움" — exempt 사유 | `TDD_EXEMPT_REASON="..."` (≥20자) | TDD 의무 강제 |
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

정형 검사·까칠 리뷰어 **검증 서브에이전트**는 **현재 세션 모델(current session model)**을 상속하며 `--model <name>` (또는 사용자가 지명한 모델) 로 그 모델을 override 한다. 시니어 fixer 는 현재 세션 모델이나 `--model` 영향 없음 (kiwi-coder 시니어 코더와 동일). **Root-cause 사전조사는 Sonnet 고정** (모드·`--model` 무관, cheap pre-investigation). `--max` 는 모델이 아니라 **count** 를 격상한다.

| 모드 | Root-cause 사전조사 (Sonnet) | 시니어 fixer (현재 세션 모델) | 정형 검사 (현재 세션 모델) | 까칠 리뷰어 (현재 세션 모델) | 비용 배수 |
|---|---|---|---|---|---|
| Normal (기본) | × 2 (병렬) | × 1 | × 1 | × 1 | 1.0× (기준) |
| `--max` | × 2 | × 2 | × 1 | × 2 (2 연속 MEDIUM=0 종료) | 2× |

까칠 리뷰어는 **모든 모드에서 활성** (§0.2). off 플래그 없음.

### 1.4 출력 (산출물)

- **코드 변경**: fix 대상 파일에 직접 작성. git commit 은 사용자 결정 (시그니처 금지 §0.8)
- **분석 디렉토리**: `docs/analysis/kiwi-hot-fix-{run-id}/`
  - `input_inventory.json` — 입력 자동 감지 결과 (issue / 자연어 / git status)
  - `root_cause.json` — Sonnet×2 사전조사 통합 (root_cause + 영향 범위)
  - `regression_test.json` — 작성된 회귀 테스트 메타 (파일/it/expected_failure_signature)
  - `fix_summary.json` — fixer 의 변경 요약 (file/line/symbol/rationale)
  - `formal_review_iter{N}.json` — 정형 검사 결과 (현재 세션 모델)
  - `prickly_review_iter{N}.json` — 까칠 리뷰 결과 (현재 세션 모델)
  - `regression_run.jsonl` — 회귀 테스트 실행 로그
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
Phase 1 : Root cause 분석 (Sonnet×2 병렬 사전조사 — symptom analyst + scope analyst)
Phase 2 : 회귀 테스트 작성 (TDD red 확정)
Phase 3 : Fix 적용 (시니어 fixer 서브에이전트 — 현재 세션 모델)
Phase 4 : 정형 검사 (현재 세션 모델×1) + 까칠 리뷰 (현재 세션 모델×1/2) + 개선 루프
Phase 5 : 회귀 테스트 실행 (green 확인 + 영향 회귀)
Phase 6 : kiwi-srs-sync Skill 위임
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

기록: `docs/analysis/kiwi-hot-fix-{run-id}/preflight.json: { mcp, cli, git, gh, halted }`

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
  yes → inputs.diff = git diff HEAD; inputs.source = "git-status"
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

## 4. Phase 1 — Root cause 분석 (Sonnet×2 병렬)

두 analyst 격리, 메인이 통합.

### 4.1 symptom analyst

입력: `input_inventory.json` (issue 본문 / 자연어 / git status diff) + 영향 가능 파일 목록 (사전 grep)
출력: `root_cause.json.symptom`
```json
{
  "symptom_summary": "한 줄",
  "reproduction_steps": ["..."],
  "likely_root_cause_hypotheses": [
    { "hypothesis": "...", "evidence": ["..."], "confidence": "high|medium|low" }
  ],
  "fix_complexity_estimate": "trivial|small|medium|large"
}
```

`fix_complexity_estimate = large` 일 경우 시니어가 §10 의 "Out of Scope" 안내 후 사용자에게 `/kiwi-srs` → `/kiwi-planner` 풀 파이프라인 권고 (단 본 스킬은 그래도 진행 — 사용자가 hot-fix 를 선택한 책임).

### 4.2 scope analyst

입력: 영향 가능 파일 목록 + 코드베이스 import graph + 활성 target REQ 인벤토리 (`list_requirements` 또는 `summarize_target`)
출력: `root_cause.json.scope`
```json
{
  "affected_files": ["src/x.ts", "src/y.ts"],
  "affected_modules": ["AuthService", "TokenValidator"],
  "candidate_req_ids": [
    { "req_id": "FR-AUTH-001", "match_confidence": "high|medium|low" }
  ],
  "external_module_touch": false,
  "test_coverage_status": "covered|partial|none"
}
```

`external_module_touch = true` 시 §0.G2 게이트 즉시 발동.

### 4.3 통합

메인이 두 analyst 결과를 머지하여 `root_cause.json` 생성. 가장 높은 confidence 의 hypothesis 를 fix 가설로 채택.

---

## 5. Phase 2~4 — TDD + Fix + 까칠 리뷰

### 5.1 Phase 2 — 회귀 테스트 작성

시니어 fixer (현재 세션 모델; `--model` 영향 없음 — kiwi-coder 시니어 코더와 동일) 서브에이전트가 다음을 수행:

1. `root_cause.symptom.reproduction_steps` 기반 회귀 테스트 작성
2. 테스트 파일 경로 결정 — 기존 테스트 디렉토리 규칙 따름
3. 테스트 실행 → red (의도된 fail) 확인. fail 메시지를 `regression_test.json.expected_failure_signature` 에 저장
4. red 실패 안 함 → 사용자 보고 ("증상이 재현되지 않음. 가설 재검토 필요") + Phase 1 재진입

**TDD exempt**:
- `TDD_EXEMPT_REASON` 인자 (≥20자) 명시 시 회귀 테스트 작성 skip 허용
- exempt 시 `regression_test.json.exempted: true` + `reason` 기록
- 까칠 리뷰어가 exempt 사유의 정당성을 추가 평가 (axis P7, MEDIUM warn 가능)

### 5.2 Phase 3 — Fix 적용

시니어 fixer 서브에이전트가 다음을 수행:

1. `root_cause.json` 의 가설에 기반한 최소 변경
2. Mock 금지 (§0.6). regex 자동 탐지: `mock\(`, `jest\.fn\(\)`, `unittest\.mock`, `MagicMock` 등
3. cwd 외부 path 편집 시도 차단 (§0.7 / §0.G2)
4. 변경 요약을 `fix_summary.json` 에 기록 (file/line_range/symbol/rationale/change_type)

**ZERO TOLERANCE 가설-fix 일치 게이트**: fix 가 `root_cause.symptom.likely_root_cause_hypotheses[0]` 와 무관한 변경을 포함하면 CRITICAL.

### 5.3 Phase 4 — 정형 검사 + 까칠 리뷰 (§0.2 의무)

#### 5.3.1 정형 검사 (현재 세션 모델×1, 4축)

입력: fix diff + 회귀 테스트 + root_cause.json (단 §0.4 격리 — fixer rationale strip)
축:
- F1: syntax/type 무결성 (언어별 linter/타입체커 시뮬레이션)
- F2: 코드 스타일 일관성 (기존 코드와 비교)
- F3: import/export 정합성
- F4: TDD 흐름 정합 (red → fix → green 순서 위반 여부)

severity: F1 CRITICAL, F2-F4 HIGH.

산출물: `formal_review_iter{N}.json`

#### 5.3.2 까칠 리뷰 (현재 세션 모델×1, 7축 — kiwi-coder §5.2 차용)

입력: fix diff + 회귀 테스트 + symptom (단 §0.4 격리 — fixer rationale strip)
축 (kiwi-coder §5.2 입증된 SSOT):
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

미충족 시 fixer 재호출 (Sonnet×2 사전조사 결과 + 새 finding 만 전달, §0.4 격리). 카운터 초과 시 §0.G3 발동.

---

## 6. Phase 5~6 — 회귀 + sync 위임

### 6.1 Phase 5 — 회귀 테스트

1. Phase 2 회귀 테스트 실행 → green 확인. fail 시 Phase 4 개선 루프 편입 (HIGH 카운터 소모). **TDD exempt 활성 시** (state.tdd_exempted=true) step 1 skip + state.json `regression_pass=skipped` 기록 + step 2 만 진행
2. `--skip-regression` 부재 시 영향 회귀 (root_cause.scope.affected_files 의 모든 테스트) 실행
3. 회귀 PASS → Phase 6 진입. fail → §0.G3 (2 연속 동일 fail 시 즉시 에스컬레이션)
4. 결과: `regression_run.jsonl`

### 6.2 Phase 6 — kiwi-srs-sync 위임

#### 6.2.1 위임 결정 (§0.G4 적용)

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
review_iter: N
sync_delegated: true|false
sync_run_id: ...
---
```

본문 섹션:
1. 사용된 플래그 + 비용 배수
2. 입력 요약 (issue title / 자연어 / git status 변경분)
3. Root cause 가설 + 채택 가설
4. 회귀 테스트 (파일·it·red 시그니처)
5. 적용된 fix 요약 (파일별 변경 라인 + rationale)
6. 정형 + 까칠 리뷰 결과 (axis 별 finding + 해소 라운드)
7. 회귀 테스트 실행 결과 (PASS/FAIL + 실행 시간)
8. kiwi-srs-sync 위임 결과 (sync run_id + 4방향 분류 통계 + 적용 mutation)
9. 잔존 MEDIUM/LOW finding (사후 검토 권고)
10. 메타 (실측 토큰, 시간)

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
| 정식 plan 수립 후 풀 구현 | `/kiwi-planner` → `/kiwi-pm` |
| 단일 task TDD 구현 | `/kiwi-coder` |
| **긴급 버그 fix + 까칠 리뷰 + 회귀 + SRS 사후 동기화** (본 스킬) | `/kiwi-hot-fix` |
| 이미 머지된 코드 / 외부 PR 셀프 리뷰 | `/kiwi-review-fix-loop` |

---

## 10. Out of Scope

| 범위 밖 | 담당 스킬 |
|---|---|
| 신규 기능 개발 (hot-fix 아닌 normal feature) | `/kiwi-srs` → `/kiwi-planner` → `/kiwi-pm` |
| 대규모 refactor / 아키텍처 변경 | `/kiwi-planner` 풀 파이프라인 |
| 다중 무관 이슈 동시 처리 | 본 스킬 다회 실행 (단일 fix 의미 단위, §0.13) |
| MCP mutation 직접 호출 | `/kiwi-srs-sync` 위임 (§0.9) |
| git commit / push | 사용자 결정 또는 `/kiwi-commit-auto-push` |
| 통합 테스트 | `/kiwi-coder` Phase 4 |
| 코드 리뷰 단독 (fix 없이) | `/kiwi-review-fix-loop` 셀프 모드 |
