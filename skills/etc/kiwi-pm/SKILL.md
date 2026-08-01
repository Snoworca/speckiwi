---
name: kiwi-pm
description: "OpenCode/Hermes local-LLM variant for running kiwi-planner task plans through kiwi-coder. Requires speckiwi mcp for lifecycle and completion updates. Defaults to --max, uses one delegated worker at a time, and does not use multi-worker fanout. Triggers: kiwi pm, plan execution, coder loop runner."
---

# kiwi-pm v0.1

> etc local-LLM profile: read ../_shared/kiwi/local-llm-profile.md before executing. It requires working speckiwi mcp, treats --max as the default, disables multi-worker fanout, uses one delegated worker/evaluator at a time, and advances only after three consecutive no-improvement evaluations.
**etc override:** If any legacy section below appears to allow CLI mutation fallback or direct normal SRS Markdown mutation, the shared etc local-LLM profile wins: normal SRS operations require `speckiwi mcp`; CLI is diagnostic/remediation only.
> User clarification gate means: ask the user directly in Default mode; use `direct user prompt` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `local-LLM max-profile`, `local evaluator`, and `local evaluator` map to the current host agent model and effort options available in the session.
> `--auto` policy: read `../_shared/kiwi/auto-option.md` when `--auto` is active. The `critical_gates[]` below always halt for user input.

`kiwi-planner` 가 만든 plan.md + sidecar.json (`plan_contract=1.2.0`, `schema_version=1.1.0`) 을 입력 SSOT 로 받아, 각 Task 를 격리된 delegated worker(`kiwi-coder`) 로 순차 실행하는 coder-loop runner. 메인 세션 컨텍스트 누적 없이 장기 plan(40 Task+) 완주 가능.

legacy Phase 단위 + CLI subprocess(`--headless`) 구조를 폐기하고, **Task 단위 + 위임 worker 위임 단일 모드** 로 단순화한 마이그레이션 산출물. legacy 자식 프로세스 안전 게이트(T1/T2/T3 forbidden_patterns / ENV_WHITELIST / sentinel parser / Python self-heal) 는 host-agent permission model에 맞지 않아 제거.

PM 자체는 read-only orchestrator 에 가깝다 — Task 실행/TDD/회귀/MCP mutation 4종 중 3종 은 자식 `kiwi-coder` 전권. PM 은 부팅 시 speckiwi `list_requirements` read 로 Stability lifecycle gate 적용하고, 모든 Task 완료 후 T-final 단계에서 `update_status("implemented")` + `add_completed_work(plan-summary)` 2종 mutation 으로 plan 단위 마무리. 보고서는 doculight MCP 가용 시 doculight MCP `open_markdown` 으로 표시.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 강제 위임**. PM 은 TDD 게이트 직접 호출 안 함 — kiwi-coder §0.1/§0.G1 가 자체 처리. 자식이 자기 Task 의 TDD 사이클(test → red → impl → green) 책임 |
| §0.2 | **plan-contract 의무 SSOT**. 입력 plan 은 `plan_contract = "1.2.0"` + `schema_version = "1.1.0"` + `tdd_policy ∈ {strict, relaxed}` 필수. 위반 시 §7.1 입력 무결성 게이트 차단. `tdd_policy = "disabled"` 인 plan 거부 |
| §0.3 | **`/snoworca-*` 호출 절대 금지** + `_shared/snoworca/` 모듈 import 절대 금지. snoworca-pm 의 로직만 차용했으며 실행은 본 스킬 내부에서 직접 수행. kiwi-* 시리즈 독립 운영 원칙 |
| §0.4 | **검증은 위임 worker**. plan 정합성 평가·sidecar 무결성 추가 검증 등 판단이 끼는 모든 작업은 delegated worker로 위임 (project verification rule). 자기검증 금지 |
| §0.5 | **메인 세션의 직접 파일 수정 금지** — 단, `plan.md` 체크박스 갱신 (§6.1) 과 `{plan_id}.checklist.md` 폴백 생성 (§6.1) 은 PM 중앙 집중 관리 책임으로 예외. 코드 파일은 어떤 경우에도 PM 이 직접 수정 안 함 |
| §0.6 | **Mock 검출은 kiwi-coder 책임** (kiwi-coder §0.6). PM 은 무대응 |
| §0.7 | **spawn 단위 = Task 1:1**. sidecar.tasks[] 가 곧 작업 단위이며 PM 이 임의로 분할/병합하지 않는다. 필요 시 `$kiwi-planner` 재실행 권고 (kiwi-coder §0.15 정합) |
| §0.8 | **사용자 확인 의무** — 다음 시점에 `User clarification gate` 강제: ① lifecycle gate 차단(단, MCP 미가용은 HALT) (§4) ② NEEDS_USER severity=business-decision (§5.1) ③ T-final mutation dryRun 결과 승인 (§6.2) ④ plan/sidecar SHA256 mismatch on `--resume` (§5.4) |
| §0.9 | **외부 모듈 영향 처리는 kiwi-coder 책임** (kiwi-coder §0.G2). 자식이 `NEEDS_USER + severity=business-decision` 으로 PM 에 버블업하면 §5 가드레일 적용 |
| §0.10 | **project signature-ban instruction** + **project change-history policy**. 본 스킬 본문에 `## 변경 이력` / `## Changelog` / `### v0.x.y` 섹션 없음 — git history 가 SSOT. 커밋 메시지·코드 주석·산출물 어디에도 AI 식별 정보 금지 |
| §0.11 | **`.kiwi/sessions/{run_id}/pm-state.json` 영속 의무**. 모든 Task 종료 / NEEDS_USER 버블업 / FAILED / `--resume` 진입 / lifecycle gate 평가 직후 SAVE_STATE. 손상 시 `.bak` 복구 (§7.2) |
| §0.12 | **MCP 호출 분담 + 시그니처 SSOT** — speckiwi MCP 실제 schema 기준. PM 호출 2종: (a) `update_status(id, status)` — T-final 조건부 implemented 승급, dryRun 옵션 없음. (b) `add_completed_work(date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun])` — T-final plan-summary, plan_id/run_id/tasks 같은 임의 필드는 summary 텍스트에 인코딩. read 2종: `get_active_target` / `list_requirements`. 자식 kiwi-coder 4종 mutation: `add_trace_link(id, type, reference, relation)` / `add_verification_evidence(id, type, reference, [covers, notes])` / `update_status(id, status="in_progress")` / `add_completed_work(date, summary, ...)`. doculight MCP: `open_markdown` / `update_markdown` (§6.3) |
| §0.13 | **회귀 테스트는 kiwi-coder §0.13 책임**. PM 은 별도 회귀 호출 안 함. 종합 통합 테스트가 필요하면 사용자에게 별도 안내 |
| §0.14 | **id 정규식 SSOT** (kiwi-planner / kiwi-coder §0.14 와 동일). `run_id` = `[a-z0-9.-]{4,40}`, `phase_id` = `^PH-\d{3}$`, `task_id` = `^T-PH\d{3}-\d{2}$`. sidecar 가 위반하면 §7.1 차단. 이 정규식은 **사이드카 식별자** 전용이며 **이벤트 emit 키**에는 **적용하지 않는다** — 재진입 emit 키 `{run_id}#r{n}` 는 다른 id 공간이다(`pipeline-event.md` §5.4) |
| §0.15 | **위임 worker 위임 모드 단일** — 사용 가능한 delegated worker/delegation 도구로 자식 `kiwi-coder` 를 실행한다. 자식 모델 = local-LLM max-profile (또는 `local-LLM max profile` 시 kiwi-coder 내부에서 local evaluator override). legacy `--headless` CLI subprocess 폐기. 메인 컨텍스트 직접 skill 재진입 금지 (메인 컨텍스트 격리가 PM 본질 가치). 본 결정의 영향 — T1/T2/T3 forbidden_patterns 게이트 / ENV_WHITELIST / sentinel parser / process group / Python self-heal hook 모두 불필요해져 제거 |
| §0.16 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §0.17 참고 | `--mini`/`--loops N` 는 kiwi-coder 자식 spawn 에 전파 (loop-option.md §6) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — sidecar 무결성

| IF | THEN |
|---|---|
| `plan_contract ≠ "1.2.0"` 또는 `schema_version ≠ "1.1.0"` | 거부 + "kiwi-planner --tdd-policy=relaxed\|strict 로 재실행하여 산출물을 생성하십시오" 안내 (kiwi-coder §0.G3 정합) |
| `tdd_policy = "disabled"` | 거부 + 권고 |
| 입력 plan 의 `tdd_policy` 가 현재 work-mode 파생 기본과 **모순** (예: work-mode=tdd + plan `relaxed`) | **WARN (non-HALT)** — `../_shared/kiwi/workmode-policy.md` §3 인용, 1줄 경고 후 plan 의 `tdd_policy` 로 진행. 현재 work-mode 는 MCP `get_work_mode` → CLI `speckiwi mode` 로 읽는다. 위 `tdd_policy = "disabled"` 거부 행은 별개이며 불변 |
| sidecar JSON parse 실패 | 거부 + validator.mjs 재실행 권고 (`node ../kiwi-planner/scripts/validator.mjs ...`) |
| sidecar.tasks[] 빈 배열 또는 부재 | 거부 — 실행할 Task 없음 |
| `task_id` / `phase_id` / `run_id` 정규식 위반 (§0.14) | 거부 |
| `validator.json` 존재 + `exit_code != 0` | WARN + 사용자 진행 동의 |
| plan.md.frontmatter.sidecar_path ↔ 실제 sidecar 경로 불일치 | WARN + 실제 경로 사용 |

#### §0.G2 — Lifecycle gate (Stability)

§4 의 표를 SSOT 로 참조. 진행 가능 = `evolving` / `stable` 만. `draft` 는 interactive 3지선다 / `--auto` 는 해당 REQ trace Task 만 skip (§3.6), `deprecated` / `frozen` 은 즉시 HALT.

#### §0.G3 — NEEDS_USER 누적 상한

동일 Task 에서 NEEDS_USER 3회 누적 시 (재spawn 한도) 3지선다 게이트 발동:
- (A) 추가 질문 1회 더 시도
- (B) Task 건너뛰기 (`status = "skipped"`)
- (C) 중단 + `status = "blocked"` 기록

#### §0.G4 — FAILED 분기

자식이 `status = "FAILED"` 반환 시 3지선다:
- (A) 같은 Task 재시도 (처음부터)
- (B) Task 건너뛰기 (`status = "skipped"`)
- (C) 중단

`--auto` 모드에서는 (A) 1회 자동 재시도 후에도 FAILED 면 사용자에게 에스컬레이션.

#### §0.G5 — T-final mutation backward transition

`update_status` 가 REQ status 를 역방향 (예: `implemented → in_progress`) 으로 전이시키는 호출은 PM 측에서 차단 + 경고. forward only (proposed/planned/in_progress → implemented) 만 허용.

#### §0.G6 — T-final dryRun 거부 / transition guard 거부

speckiwi `apply-patch.ts` 또는 `stability-transition.js` 가 mutation 을 거부할 경우, dryRun 단계에서 미리 감지 → 사용자에게 거부 사유 / 대체 옵션 제시. 강제 우회 없음 (kiwi-pipeline-v1 §5.3 정합).

#### §0.G7 — `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `lifecycle-gate-policy-stop` | `deprecated` / `frozen` lifecycle blocker — 정책 위반 / 의도된 제거. `draft` 는 본 행에 포함되지 않는다 (§3.6 per-REQ skip) | §4 |
| `task-failure-escalation` | `--auto` 자동 재시도 1회 후에도 FAILED — 사용자 에스컬레이션 (§0.G4 / §5.3). 본 표만 읽고도 중단 지점을 예측할 수 있어야 하므로 본문에만 있던 HALT 를 등재 | §5.3 |
| `existing-public-contract-change` | 자식 kiwi-coder 가 기존 public 심볼의 삭제 · 시그니처 변경을 버블업 (kiwi-coder 동명 게이트) — **경로와 무관**하게 critical. 아래 `path-heuristic-business-decision` 은 auth/schema/migration 경로 토큰에만 걸리므로 그 밖의 경로에서 깨지는 공개 계약을 잡지 못한다 | §5.1 |
| `existing-test-weakened-or-deleted` | 자식 kiwi-coder 가 기존 테스트 파일 삭제 · 케이스 제거 · 단언 약화를 버블업 (kiwi-coder 동명 게이트) — 회귀 안전망 자체를 제거하는 가장 비가역적 변경. 본 행이 없으면 `business-decision` 기본 분류로 떨어져 `--auto` 에서 decision worker 가 승인한다 | §5.1 |
| `auto-skip-lifecycle-gate-combo` | `--auto --skip-lifecycle-gate` 조합은 사용자 책임 범위 | §1.3 |
| `path-heuristic-business-decision` | auth/schema/migration 등 외부 관찰 가능 정책 변경 | §5.1 |
| `sha-mismatch-on-resume` | plan/sidecar SHA mismatch 는 외부 변경 의심 | §5.4 |
| `depends-on-violation` | `--from-task` 사용 시 depends_on 미충족 | §5.5 |
| `t-final-backward-transition` | status 역방향 전이 금지 | §0.G5 |
| `t-final-dryrun-rejected` | final mutation dryRun/transition guard 거부 | §0.G6 |
| `mcp-mutation-batch-large` | MCP mutation ≥10건 batch (kiwi-coder §0.8 버블업) | §5.1 |
| `external-module-impact` | 외부 모듈 영향 (kiwi-coder §0.G2 버블업) | §5.1 |
| `mcp-cli-both-unavailable` | speckiwi MCP + CLI 모두 부재 — lifecycle or final mutation judgment requires `speckiwi mcp`; CLI diagnostics cannot replace normal read/mutation | §4.4 / §6.2 |

**자식 선언 승계 (일반 규칙)**: 자식 스킬이 `NEEDS_USER` payload 의 `gate_id` 로 올린 게이트가 그 **자식 자신의** `critical_gates` 목록에 있으면, 본 표에 동명 행이 **없더라도** severity 로 재분류하지 않고 **무조건 HALT** 한다. 게이트별 수동 전사는 자식이 게이트를 추가할 때마다 누락되며, 누락된 게이트는 `auto-option.md` §4 의 기본 분류에 따라 `business-decision` 으로 떨어져 `--auto` 에서 결정 위원회가 승인한다 — 승계는 표의 동기화가 아니라 규칙으로 성립해야 한다.

---

## 1. 입력 / 출력

### 1.1 필수 입력

**`PLAN_PATH`** — kiwi-planner 산출물 `*.plan.md` 의 경로.

부재 시 fallback:
1. `docs/plans/*.plan.md` 의 가장 최신 `generated_at` 자동 채택
2. 후보 ≥2 개일 시 `User clarification gate` 으로 선택 요청
3. 후보 0개 → HALT + "kiwi-planner 로 plan 먼저 작성하십시오" 안내

**`SIDECAR_PATH`** — 단독 입력도 허용. 이 경우 plan.md 는 frontmatter `sidecar_path` 의 inverse 로 추론. 둘 다 명시되었으나 frontmatter 와 불일치 시 §0.G1 WARN 발동.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "plan X 로", "X 계획", "{plan_id} 실행" | `PLAN_PATH` | 자동 추정 |
| "코드는 Y 디렉토리에서" | `CODE_PATH` | 현재 작업 디렉토리 |
| "T-PH001-XX 부터" | `--from-task=T-PH001-XX` | 첫 pending Task |
| "자동", "auto", "묻지 말고" | `--auto` | false (interactive) |
| "재개", "이어서", "resume" | `--resume` | false (신규 세션) |
| "로컬 LLM", "OpenCode/Hermes", "정밀" | `--max` | default on |
| "이전 lock 무시", "강제" | `--force` | false |
| "lifecycle 무시" (위험) | `--skip-lifecycle-gate` | false |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드" | `--loops N` | off (스킬 기본 상한) |
| "비용 경고 자동 skip" (부모 전달) | `--auto-cost-warning` | off — 명시 입력만 kiwi-coder 로 pass-through (§3.2) |
| "통합 테스트 자동 동의" (부모 전달) | `--auto-integration` | off — 명시 입력만 kiwi-coder 로 pass-through (§3.2) |
| "doculight 끄고" | `--no-doculight` | doculight 자동 표시 |
| "handoff 로", "이 unit 만" (오케스트레이터 전달) | `--handoff <path>` (실행 집합 + 임차, §1.5) | off (plan 전체 실행) |
| "레인 세션", "세션 분리" (오케스트레이터 전달) | `--session-suffix <lane>` (세션 디렉터리 재배치, §1.5) | off (평면 배치) |
| "T-final 승급 생략" (오케스트레이터 전달) | `--no-final` (T-final 요구 승급 skip, §1.5) | off |
| "파이프라인 이벤트 억제" (오케스트레이터 전달) | `--no-pipeline-emit` (인자 없음 — `kiwi/pipeline.jsonl` append 를 수행하지 않는다, §1.5) | off (emit 수행) |
| "unit 산출물 commit" (오케스트레이터 전달) | `--commit-lane-work` (인자 없음 — handoff 의 `write_set` 만 stage, §1.5) | off (자동 commit 없음 — `--commit-lane-work` 가 유일한 예외, §1.5) |

### 1.3 CLI 인자 요약

```
$kiwi-pm PLAN_PATH=docs/plans/...plan.md
         [SIDECAR_PATH=...]              # 부재 시 frontmatter.sidecar_path 로 추론
         [CODE_PATH=.]                   # 부재 시 cwd
         [--auto]                         # severity 가드레일 활성, business-decision 여전히 HALT
         # etc local-LLM profile is always active: --max, single delegated worker/evaluator, 3 clean evaluations
         #   --max 는 kiwi-coder 자식 args 에도 그대로 전달된다 (§3.2)
         [--auto-cost-warning]            # 명시 입력 시에만 kiwi-coder 로 pass-through (§3.2)
         [--auto-integration]             # 명시 입력 시에만 kiwi-coder 로 pass-through (§3.2)
         [--regression-baseline <path>]   # 부모가 pin 한 회귀 기준선을 kiwi-coder 로 pass-through
         [--resume]                       # .kiwi/sessions/{run_id}/pm-state.json 이어가기
         [--from-task=T-PH001-XX]         # 특정 Task 부터 (디버깅 / 부분 재실행)
         [--force]                        # stale lock 강제 해제 (주의 경고 후 진행)
         [--skip-lifecycle-gate]          # §4 게이트 우회 (사용자 책임, --auto 와 함께 사용 불가)
         [--handoff <path>]               # 실행 집합 + 임차. task_ids[] 만 정확히 실행 (§1.5). --from-task 와 동시 사용 거절
         [--session-suffix <lane>]        # 세션 디렉터리를 .kiwi/sessions/{plan_run_id}/lanes/{lane}/ 로 재배치 (§1.5)
         [--no-final]                     # T-final 요구 승급 skip (§1.5)
         [--no-pipeline-emit]             # 인자 없음 — kiwi/pipeline.jsonl append 를 수행하지 않는다 (§1.5)
         [--commit-lane-work]             # 인자 없음 — handoff 의 write_set 만 stage 해 Task 당 commit 1개 (§1.5)
         [--no-doculight]                 # doculight MCP 표시 강제 skip
```

**`--auto` 와 `--skip-lifecycle-gate` 동시 사용 금지** — lifecycle gate 의 정책 차단(`deprecated` / `frozen`)은 §0.G7 critical_gates `lifecycle-gate-policy-stop` / `auto-skip-lifecycle-gate-combo` 로 `--auto` 무관 항상 HALT. 두 플래그가 함께 명시되면 HALT + 안내.

### 1.4 산출물

| 산출물 | 시점 | 주체 |
|---|---|---|
| `.kiwi/sessions/{run_id}/pm-state.json` | 매 Task 종료 / NEEDS_USER / FAILED / `--resume` 진입 시 갱신 | PM |
| `.kiwi/sessions/{run_id}/pm.lock` | 시작 시 생성, 종료/HALT 시 삭제 (finally) | PM |
| `.kiwi/sessions/{run_id}/state.json` + `tasks/{task_id}.json` | Task 별 TDD 단계 영속 | kiwi-coder (자식) |
| `.kiwi/sessions/{run_id}/worklog.jsonl` | append-only 이벤트 로그 | PM + 자식 공유 |
| `plan.md` 체크박스 갱신 | Task done 시 즉시 | PM (자식 금지) |
| `{plan_id}.checklist.md` 폴백 | 체크박스 0개 또는 매칭률 <50% 시 | PM |
| `.kiwi/sessions/{run_id}/reports/pm-{ts}.md` | T-final 단계 | PM |
| speckiwi REQ status `implemented` 승급 | T-final mutation | PM (조건부) |
| speckiwi `add_completed_work(plan-summary)` | T-final mutation | PM |
| doculight viewer 표시 | T-final 보고서 작성 직후 | PM (가용 시) |

### 1.5 오케스트레이션 위임 플래그 (`--handoff` / `--session-suffix` / `--no-final` / `--no-pipeline-emit` / `--commit-lane-work`)

상위 오케스트레이터(`kiwi-orchestrator`)가 하나의 plan 을 **여러 실행 단위(unit)** 로 쪼개 순차 실행할 때 쓰는 5개 플래그. 단독 실행에는 어느 것도 필요 없고, 명시하지 않으면 본 스킬의 기존 동작이 그대로 유지된다.

#### `--handoff <path>` — **실행 집합(execution set)과 임차(lease)**

`--handoff` 는 실행 집합과 임차를 공급할 뿐 **Task 본문은 공급하지 않는다** — handoff 는 plan 이 아니며, Task 본문도 `tdd` 블록도 `acceptance_tests` 도 `dod` 도 `rollback` 도 싣지 않는다. 본 스킬이 handoff 에서 읽는 것은 front matter 뿐이다.

- **실행 집합**: front matter 의 `task_ids[]` 에 있는 Task 를 **정확히** 그것만, sidecar **선언 순서**로 실행한다. plan 의 다른 Task 는 실행하지 않는다. 각 Task 의 본문은 종전대로 `sidecar_path` 에서 읽는다.
- **`write_set`**: `--commit-lane-work` 가 stage 할 commit **pathspec** 이다 (아래).
- **`req_ids[]` / `acceptance[]`**: **읽기 전용** 컨텍스트로, §3.2 kiwi-coder **spawn 프롬프트**에 그대로 실어 보낸다. 어떤 **실행 결정**(어느 Task 를 도는지 · 순서 · 게이트 발동)도 이 두 값으로 내리지 않는다.
- **`depends_on_task`**: 의존 판정은 **실행 집합 안에서만** 한다. `task_ids[]` 밖의 선행은 **충족된 것으로** 취급하고 `depends-on-violation` 게이트(§0.G1 / §3.1.1)를 발동하지 않는다 — 구성상 그 선행은 이미 앞 stage 에서 병합되었거나 같은 unit 안에 있다. 실행 **집합 안**의 의존 위반은 종전대로 **게이트**다.
- **`--from-task` 와 동시 사용 거절**: `--handoff` 와 `--from-task` 가 함께 오면 HALT + 안내. `--from-task` 는 *시작점* 선택자인데 `task_ids[]` 는 충돌 그래프의 연결 성분이라 일반적으로 **비-연속(non-contiguous)** 이며, 시작점 하나로는 표현되지 않는다.
- **이 정의가 필요한 이유**: 한 plan 위에서 **두 unit** 이 각각 plan 의 **모든** Task 를 실행하면 둘 다 같은 파일을 쓰고 둘 다 `lane-lease-breach` 를 밟는다. handoff 가 실행 집합을 고정하는 것이 그 경로를 닫는 유일한 장치다.

#### `--session-suffix <lane>` — 세션 디렉터리 재배치

세션 디렉터리 **전체**를 `.kiwi/sessions/{plan_run_id}/lanes/{lane}/` 로 옮긴다 — §2.1 의 `pm-state.json` · `pm.lock` · `worklog.jsonl` · `state.json` · `reports/` 다섯 산출물이 **모두** 그 아래로 간다. 일부만 옮기면 공유된 파일 하나가 남고, 그 하나가 곧 race 다.

§3.2 spawn 프롬프트의 **`RUN_ID`** 줄도 같은 재배치를 따른다 — `kiwi-coder` 가 자기 `.kiwi/` 경로를 그 줄에서 도출하므로, 이 줄이 따라가지 않으면 자식이 평면 경로에 쓴다. 이렇게 해서 §2.1 의 "sequential spawn 이라 race 없음" 전제는 **약화되는 것이 아니라 해소**된다 — unit 마다 자기 파일을 갖는다.

#### `--no-final` — T-final 승급 skip

§6.2 T-final 의 **요구 승급을 건너뛴다**(체크박스 갱신과 보고서 작성은 그대로). 근거: 한 요구는 여러 unit 에 걸치므로, 한 unit 의 Task 부분집합을 `all_done` **분모**로 삼으면 부분 증거로 승급하게 된다.

#### `--no-pipeline-emit` — 자식 파이프라인 기록 억제

- **`--no-pipeline-emit`** — **인자를 받지 않는다**. 명시하면 §10 의 `kiwi/pipeline.jsonl` append 를 수행하지 않는다. 플래그가 **없으면** 기존 emit 동작이 그대로다.
- 오케스트레이터의 실행기는 **매 unit** 실행마다 `--no-pipeline-emit` 을 넘긴다. 빠뜨리면 그 unit 이 **거짓 파이프라인 기록**을 남긴다 — 저널에는 `kiwi-pm` run 하나가 완료한 것으로 보이지만 실제로는 한 wave · 한 stage 의 unit 하나가 끝났을 뿐이고, 그 기록을 부모가 자식 대신 정정하는 것은 허용되지 않는다.
- `kiwi-pipeline` 은 `--no-pipeline-emit` 을 **갖지 않는다** — 오케스트레이션된 unit 이 `kiwi-pipeline` 을 호출하지 않기 때문이다.

#### `--commit-lane-work` — unit 산출물 commit

- **`--commit-lane-work`** — **인자를 받지 않는다**. 같은 호출이 이미 넘긴 `--handoff` 의 `write_set` 을 그대로 stage 한다.
- **Task 당 commit 1개**를 만든다. stage 대상은 `write_set` 에서 뽑은 **명시 pathspec** 이며, **작업 트리 전체를 stage 하지 않는다**(`git add -A` 금지) — unit 밖의 미커밋 변경과 오케스트레이터 자신의 상태 파일까지 딸려 들어간다.
- run 좌표(`Orch-Run` · `Orch-Wave` · `Orch-Stage` · `Orch-Lane` · `Orch-Task`)는 git **trailer** 로 싣는다. commit **제목**에는 run 좌표를 **넣지 않는다** — 제목의 단계·진행 표식은 CLAUDE.md §6 이 금지한다.
- **pathspec 파일은 쓰지 않는다**: 오케스트레이터 자신의 상태 디렉터리(`kiwi/orchestrator/`) 아래 경로는 git-ignore 대상이라 격리된 워크스페이스에는 아예 존재하지 않는다. pathspec 은 같은 호출이 이미 갖고 있는 handoff 에서 와야 한다.
- **플래그를 생략하면** 본 스킬은 **아무것도 commit 하지 않는다**. 그 unit 의 산출물은 **미커밋** 작업 트리로 남고, **다음 unit** 의 실행이 그것을 밟는다. §6.1 의 "PM 은 자동 commit 하지 않는다" 는 이 플래그를 명시하지 않은 경우의 규칙이며, `--commit-lane-work` 가 그 유일한 예외다.

---

## 2. 상태 관리

### 2.1 디렉토리 SSOT

`.kiwi/sessions/{run_id}/` — kiwi-coder 의 `.kiwi/` 영역을 공유. `run_id` 는 plan.md frontmatter 의 `run_id` 를 그대로 재사용 (kiwi-planner SSOT). PM 이 새 id 생성하지 않음.

```
.kiwi/sessions/{run_id}/
├── pm-state.json           # pm 진행 상태 (본 스킬 소유)
├── pm.lock                 # pm 동시 실행 방지 (본 스킬 소유)
├── state.json              # kiwi-coder 소유 — 자식이 자기 Task 진행 영속
├── coder.lock              # kiwi-coder 소유 — 자식 자체 lock (이름 분리로 충돌 회피)
├── tasks/{task_id}.json    # kiwi-coder 소유 — Task 별 TDD 단계
├── worklog.jsonl           # 공유 append-only 로그 (PM + 자식)
└── reports/pm-{ts}.md      # 종료 보고서 (PM 소유)
```

자식 `kiwi-coder` 는 자기 영역 (`state.json` / `tasks/` / `coder.lock`) 만 수정. PM 은 자기 영역 (`pm-state.json` / `pm.lock` / `reports/`) 만 수정. `worklog.jsonl` 만 양쪽이 append (race 없음 — sequential spawn).

### 2.2 pm-state.json 스키마

```json
{
  "run_id": "2026-05-19.kiwi-pm.v0-1",
  "plan_path": "docs/plans/2026-05-19.kiwi-pm.v0-1.plan.md",
  "sidecar_path": "docs/plans/2026-05-19.kiwi-pm.v0-1.plan.json",
  "plan_sha256": "abcdef0123...",
  "sidecar_sha256": "fedcba9876...",
  "target_slug": "v0.1",
  "started_at": "2026-05-19T09:00:00Z",
  "last_updated_at": "2026-05-19T11:30:00Z",
  "pm_version": "0.1",
  "tasks": [
    {
      "task_id": "T-PH001-01",
      "phase_id": "PH-001",
      "status": "done",
      "tdd_exempted": false,
      "started_at": "2026-05-19T09:01:00Z",
      "ended_at": "2026-05-19T09:18:00Z",
      "coder_run_id": "coder-xyz789",
      "result_summary": "테스트 5개 PASS, 구현 완료",
      "trace_req_ids": ["REQ-CORE-001", "REQ-CORE-002"],
      "questions": [],
      "attempts": 1
    },
    {
      "task_id": "T-PH001-02",
      "phase_id": "PH-001",
      "status": "pending",
      "tdd_exempted": false,
      "started_at": null,
      "ended_at": null,
      "coder_run_id": null,
      "result_summary": null,
      "trace_req_ids": ["REQ-CORE-003"],
      "questions": [],
      "attempts": 0
    }
  ],
  "stats": {
    "total": 27,
    "done": 1,
    "running": 0,
    "pending": 26,
    "failed": 0,
    "blocked": 0,
    "skipped": 0
  },
  "last_question": null,
  "last_error": null,
  "lifecycle_gate_state": {
    "evaluated_at": "2026-05-19T09:00:30Z",
    "blocked_req_ids": [],
    "stability_snapshot": {
      "REQ-CORE-001": "evolving",
      "REQ-CORE-002": "evolving",
      "REQ-CORE-003": "stable"
    },
    "status_snapshot": {
      "REQ-CORE-001": "proposed",
      "REQ-CORE-002": "in_progress",
      "REQ-CORE-003": "proposed"
    }
  },
  "req_coverage": {},
  "final_mutations": [],
  "pending_mutations": [],
  "report_path": null,
  "doculight_viewer_id": null
}
```

**필드 의미**:

- top-level — plan 식별 + 부팅 SHA256 (외부 변경 감지에 사용, §5.4 `--resume`)
- `tasks[]` — Task 단위 진행. `status` enum: `pending` | `running` | `done` | `failed` | `blocked` | `skipped`
- `tasks[].trace_req_ids` — sidecar `task.traces[].req_id` 에서 부팅 시 미리 추출 (T0 lifecycle gate 사용)
- `tasks[].attempts` — delegated worker spawn 횟수 (재spawn 포함). §0.G3/§0.G4 카운터
- `stats` — UI/보고서 출력용 집계 (매 Task 종료 시 재계산)
- `lifecycle_gate_state` — 부팅 T0 평가 결과 캐싱. stability_snapshot 은 부팅 시점의 REQ Stability 스냅샷 (종료 시 drift 감지 가능)
- `req_coverage` — T-final 단계에 채워짐. REQ-ID 별 `{status_at_start, status_at_end, tasks: [...], all_done: bool}`
- `final_mutations[]` — T-final mutation 로그. 각 항목: `{ts, kind, req_id, from, to, dry_run, summary?}`
- `pending_mutations[]` — MCP 일시 미가용 / transition guard 거부 등으로 보류된 mutation proposal. 보고서 §4 에 명시 + 사용자 수동 처리 안내
- `report_path` — T-final mutation 호출 전 결정적으로 계산된 종료 보고서 path. `add_completed_work` 의 `reportPaths` 인자에 전달. 실제 파일 작성은 T-final 직후
- `doculight_viewer_id` — doculight `open_markdown` 1회 호출 후 viewer ID 보존 (`--resume` 후속 실행 시 `update_markdown` 으로 재사용)

### 2.3 동시 실행 방지 (pm.lock)

```json
{
  "pid": 12345,
  "started_at": "2026-05-19T09:00:00Z",
  "host": "hostname"
}
```

**부팅 시 동작**:

1. lock 존재 + `started_at` 30분 이내 + 동일 host → "다른 세션 실행 중" HALT. `--force` 로만 해제
2. lock 존재 + 30분 경과 → stale 자동 해제 + 경고 log
3. lock 존재 + 다른 host → 네트워크 파일 시스템 의심, 명시적 차단 (`--force` 필요)
4. lock 없음 → 신규 lock 생성 후 진행

**종료 시 동작** (정상 / HALT / FAILED 무관, finally):
- `pm.lock` 파일 삭제

**kiwi-coder `coder.lock` 과의 분리**: 파일명을 분리하여 PM 과 자식이 서로의 lock 을 잘못 해제하는 일을 방지. 자식 `kiwi-coder` 가 자기 `coder.lock` 만 관리하므로 PM 측은 PM `pm.lock` 만 본다.

`--force` 사용 시: 사용자에게 "lock 강제 해제 — 다른 PM 인스턴스가 실행 중이라면 충돌 위험" 경고를 출력한 뒤 진행 (interactive). `--auto --force` 조합은 허용 (자율 운영 의도).

---

## 3. 메인 루프 + 3상태 프로토콜

### 3.1 Task 루프 의사코드

```
FUNCTION MAIN(args):
    # T-1: 부팅
    plan, sidecar = PARSE_PLAN_AND_SIDECAR(args.plan_path, args.sidecar_path)
    APPLY_INTEGRITY_GATE(plan, sidecar)         # §7.1 표 적용, 위반 시 HALT
    state = LOAD_OR_INIT_STATE(plan, sidecar)   # --resume 분기 (§5.4)
    ACQUIRE_LOCK(state.run_id, args.force)
    SAVE_STATE(state)

    # T0: lifecycle gate
    IF NOT args.skip_lifecycle_gate:
        APPLY_LIFECYCLE_GATE(plan, sidecar, state, args)   # §4 — draft/deprecated/frozen 차단

    # T-loop: pending Task 순차 spawn
    FOR each task IN sidecar.tasks[] (선언 순서):
        IF state.tasks[task.task_id].status IN {done, skipped}: CONTINUE
        IF NOT DEPENDS_ON_SATISFIED(task, state):
            IF UNSATISFIED_PREDECESSORS_ALL_SKIPPED(task, state):
                RESOLVE_SKIPPED_PREDECESSOR(task, state, args)   # §3.1.1 — 계속 / 함께 skip 자동 결정
            ELIF args.auto: HALT(f"depends_on 위반: {task.task_id}")
            ELSE: User clarification gate("depends_on 위반 — 진행 여부?")

        state.tasks[task.task_id].status = "running"
        state.tasks[task.task_id].started_at = NOW()
        SAVE_STATE(state)

        attempts = state.tasks[task.task_id].attempts
        user_answers = None
        WHILE True:
            result = AGENT_SPAWN_KIWI_CODER(task, plan, sidecar, state, args, user_answers)
            attempts += 1
            state.tasks[task.task_id].attempts = attempts

            SWITCH result.status:
              CASE "TASK_DONE":
                state.tasks[task.task_id].status = "done"
                state.tasks[task.task_id].result_summary = result.summary
                state.tasks[task.task_id].coder_run_id = result.coder_run_id
                state.tasks[task.task_id].ended_at = NOW()
                UPDATE_PLAN_CHECKBOX(args.plan_path, task)   # §6.1
                BREAK

              CASE "NEEDS_USER":
                IF attempts >= 3:
                    choice = User clarification gate(§0.G3 3지선다)
                    IF choice == "A": pass        # 추가 1회 시도
                    ELIF choice == "B":
                        state.tasks[task.task_id].status = "skipped"; BREAK
                    ELIF choice == "C":
                        state.tasks[task.task_id].status = "blocked"
                        state.last_question = result.questions
                        SAVE_STATE(state); RETURN
                user_answers = HANDLE_QUESTIONS(result.questions, args)   # §5 — severity 분기
                # 루프 계속 → 재spawn

              CASE "FAILED":
                state.tasks[task.task_id].status = "failed"
                state.last_error = result.error
                choice = HANDLE_FAILED(result, args)    # §0.G4 3지선다
                IF choice == "A": pass               # 재시도
                ELIF choice == "B":
                    state.tasks[task.task_id].status = "skipped"; BREAK
                ELIF choice == "C":
                    SAVE_STATE(state); RETURN

        UPDATE_STATS(state)
        SAVE_STATE(state)
        PRINT(f"[{i+1}/{len(sidecar.tasks)}] {task.task_id} {state.tasks[task.task_id].status} — {state.tasks[task.task_id].result_summary OR '...'}")

    # T-final: 종료 마무리 (§6.2, §6.3)
    state.report_path = COMPUTE_REPORT_PATH(state)   # 결정적 path 사전 계산 (.kiwi/sessions/{run_id}/reports/pm-{ts}.md)
    T_FINAL_SRS_MUTATION(state, args)                # update_status implemented + add_completed_work(plan-summary)
    WRITE_REPORT(state)                              # state.report_path 에 8섹션 보고서 작성 (final_mutations 포함)
    DOCULIGHT_DISPLAY(state.report_path, args, state)
    RELEASE_LOCK()
    PRINT_FINAL_SUMMARY(state)
```

### 3.1.1 skip 된 선행 Task 의 depends_on 처리

선행 Task 가 **실패가 아니라 skip** 된 경우에는 HALT 로 직행하지 않고, 이 Task 를 계속할지 함께 skip 할지를 **자동 결정**한다 (`--auto` 는 SSOT `../_shared/kiwi/auto-option.md` §2 decision worker, interactive 는 `User clarification gate` 2지선다). 근거 — 한 Task 의 skip 이 depends_on 사슬을 타고 wave 를 두 번째로 멈추게 하던 경로를 없앤다.

- 판정 입력: 선행 Task 의 `status` 와 skip 사유 (`lifecycle_skip_per_req` / `task_skipped_after_3_questions` / §0.G4 (B)), 그리고 이 Task 가 선행 산출물에 실제로 의존하는지 여부
- 결정 결과는 `pm-state.json` (`tasks[].status` + worklog `depends_on_skipped_predecessor`) 과 종료 보고서 잔여에 남긴다. 함께 skip 한 Task 는 선행의 `reason_class` 를 승계한다
- **완화 범위 한정** — 선행 Task 가 `failed` / `blocked` 인 경우의 depends_on 처리는 §5.5 와 §3.1 의 기존 게이트를 그대로 유지한다. `--from-task` 로 건너뛴 미실행 선행도 종전대로 사용자 결정 대상이다

### 3.2 위임 worker 자식 실행 프롬프트

사용 가능한 위임 worker 위임 도구로 자식에게 다음 프롬프트를 전달한다. 권장 실행 속성: worker 역할, high reasoning effort (또는 `local-LLM max profile` 시 kiwi-coder 내부에서 local evaluator override 처리).

```
당신은 kiwi-coder 스킬을 실행하는 격리된 위임 worker입니다.

## INPUTS
- PLAN_PATH={args.plan_path}
- SIDECAR_PATH={args.sidecar_path}
- RUN_ID={state.run_id}                # .kiwi/sessions/{run_id}/ 영속화에 사용. --session-suffix 지정 시 .kiwi/sessions/{run_id}/lanes/{lane}/ (§1.5)
- TARGET={state.target_slug}           # lifecycle gate 일관성 확인용
- TASK_FILTER={task.task_id}           # 이번 자식은 이 Task 하나만 실행
- CODE_PATH={args.code_path}
- ETC_PROFILE=default-max-single-worker
- LOOP_FLAGS={forward --mini / --loops N round-cap to the kiwi-coder child}
- PASS_THROUGH_FLAGS={부모에게서 명시 입력으로 받은 --auto-cost-warning / --auto-integration / --regression-baseline 을 그대로 재현}
- LIFECYCLE_BLOCKED_REQS={state.lifecycle_gate_state.blocked_req_ids}
- 이전 NEEDS_USER 답변 (재spawn 시):
{user_answers OR "없음"}

## 실행 지침

**1단계: kiwi-coder 스킬 사용**
Open Agent Skills invocation wording로 `kiwi-coder` 를 사용하라:

```
Use $kiwi-coder with PLAN_PATH={args.plan_path} SIDECAR_PATH={args.sidecar_path} TASK_FILTER={task.task_id} RUN_ID={state.run_id} --max{LOOP_FLAGS}{PASS_THROUGH_FLAGS}
```

스킬 내용을 추측하거나 우회하지 말 것. 가능한 경우 실제 `kiwi-coder` skill body를 로드하고, 스킬 로딩 기능이 없으면 해당 skill folder의 `SKILL.md`를 직접 읽어 따른다.

**pass-through 전파**: `--max` (etc local-LLM profile 기본 on) 와 `--mini` / `--loops N` (loop-option.md §6), 그리고 부모(`$kiwi-pipeline` / `$kiwi-wave-master`)에게서 **명시 입력으로 받은** `--auto-cost-warning` / `--auto-integration` 은 자식 args 에 그대로 전달한다 — `kiwi-wave-master → kiwi-pipeline → kiwi-pm → kiwi-coder` 사슬에서 중간 홉이 옵션을 떨어뜨리면 kiwi-coder 의 비용 경고 · 통합 테스트 동의 게이트가 무인 실행을 멈춘다. 본 스킬은 그 3종을 `--auto` 만으로 **스스로 만들어내지 않으며**, 명시 입력을 중계할 뿐이다.

부모가 pin 한 `--regression-baseline <path>` 도 같은 방식으로 자식 args 에 그대로 전달한다 — 중간 홉이 이 값을 떨어뜨리면 kiwi-coder 가 자기 시점 기준선을 다시 캡처해, 앞 Task 가 만든 실패가 "원래 있던 실패"로 분류된다.

**2단계: 이번 Task 만 실행**
sidecar 의 `{task.task_id}` 하나만 처리. 다른 Task 진행 금지. plan.md / sidecar 의 다른 Task 부분 수정 금지.

**3단계: 중단 조건**
다음 발생 시 즉시 중단하고 아래 JSON 반환:
- 구현 세부 모호성 (severity = clarification)
- 외부 관찰 가능 변경 필요 (severity = business-decision — 의심되면 이쪽으로 상향)
- rollback 실행 승인 필요 (severity = rollback-confirmation)
- 복구 불가 오류 (status = FAILED)

## 절대 금지 사항
- **plan.md 직접 수정 금지** — 체크박스 갱신은 PM 메인 중앙 집중 (§6.1). 본 자식은 코드 파일만 수정.
- **`/snoworca-*` 호출 금지** — `_shared/snoworca/` 모듈 import 금지 (kiwi 시리즈 독립 운영).
- **다음 Task 실행 금지** — 본 자식은 `{task.task_id}` 만 담당.
- **JSON 외 텍스트 출력 금지** — 첫 글자 `{`, 마지막 글자 `}`. markdown code fence (```) 금지. 설명 산문 금지.

## 반환 형식 (단일 JSON 객체)

{{
  "status": "TASK_DONE" | "NEEDS_USER" | "FAILED",
  "task_id": "{task.task_id}",
  "coder_run_id": "<kiwi-coder 가 생성한 run_id>",
  "summary": "<1~3줄 요약>",

  // TASK_DONE 시 필수
  "completed_task_ids": ["{task.task_id}"],

  // NEEDS_USER 시 필수
  "questions": [
    {{
      "id": "Q-001",
      "severity": "clarification | business-decision | rollback-confirmation | critical",
      "gate_id": "<자기 §0.G6 게이트 id — severity=critical 시 필수, 그 외 null>",
      "question": "...",
      "context": "<왜 묻는가 + 근거>",
      "options": [
        // "recommended": opt-in 구조화 boolean. 생략 가능하며 생략 시 false — 필드가 없는 옵션은 권장이 아니다.
        // true 인 옵션은 `--auto` 가 위원회 없이 즉시 채택한다 (`_shared/kiwi/auto-option.md` §3 0단계).
        // 산문으로 적힌 권장 표기는 이 필드가 아니며 기계적 의미가 없다.
        // 어떤 옵션이 왜 권장되는지를 기술하는 필드는 두지 않는다 — 권장 동기를 심사하는 게이트는 본 버전의 범위 밖이다.
        {{ "key": "A", "label": "...", "consequence": "...", "recommended": false }},
        {{ "key": "B", "label": "...", "consequence": "...", "recommended": false }}
      ],
      "default_if_auto": "A | null"  // business-decision 은 null 강제
    }}
  ],

  // FAILED 시 필수
  "error": {{
    "reason": "<원인 1~2줄>",
    "attempted": ["<시도한 것 1>", "<시도한 것 2>"],
    "suggestion": "retry | rollback-and-halt | user-decision"
  }}
}}
```

### 3.3 자식 내부에서 자체 해결되는 영역 (메인까지 안 올라옴)

kiwi-coder §0.G4 자체 게이트가 처리. PM 무대응:

- TDD red 실패 → kiwi-coder 시니어 코더 재시도
- local evaluator×1 TDD 검증 finding → kiwi-coder Phase 1.3 개선 루프
- local-LLM max-profile 까칠 코드 리뷰어 finding → kiwi-coder Phase 2.h 개선 루프
- 회귀 테스트 fail → kiwi-coder §0.13 개선 루프
- Mock 검출 (§0.6) → kiwi-coder CRITICAL 자체 차단

이들은 자식 안에서 처리되며 외부에서 보면 단순히 자식 spawn 시간이 길어질 뿐 PM 메인의 NEEDS_USER 인터럽트 없음.

### 3.4 메인까지 올라오는 NEEDS_USER

다음 시점에만 자식이 PM 으로 버블업:

- 외부 모듈 영향 (kiwi-coder §0.G2) — cwd 외부 path 수정 필요 시
- 비즈니스 결정 (severity=business-decision) — UX/API/권한/세션 정책 변경
- MCP mutation guard 위반 (kiwi-coder §0.G5) — backward status 시도 등
- 개선 루프 발산 (kiwi-coder §0.G4) — 시니어 3회 / 리뷰어 2회 / local evaluator 검증 3회 누적 + 동일 finding 잔존
- 사용자 결정 의무 (kiwi-coder §0.8) — 외부 모듈 / 통합 테스트 / MCP mutation ≥10건 batch / plan 외 파일 변경

자식(`kiwi-coder`) 이 자기 §0.G6 게이트로 중단한 경우 그 payload 의 `gate_id` 를 그대로 읽어 **동명**의 §0.G7 게이트로 매핑한다 — severity 로 재분류하지 않는다. 재분류하면 always-HALT 로 선언한 두 보존 게이트가 `business-decision` 기본 분류로 되돌아간다.
§0.G7 에 동명 행이 없는 `gate_id` 는 §0.G7 **자식 선언 승계** 규칙으로 처리한다 — 전사 누락이 곧 자동 승인이 되는 경로를 닫는 잔여 규칙이다.

### 3.5 severity enum + 판단 휴리스틱

| severity | 의미 | 예시 |
|---|---|---|
| `clarification` | 구현 세부의 모호성 해소 | 파일명 camelCase ↔ snake_case, 에러 메시지 문구, 로그 레벨, private 함수 시그니처 |
| `business-decision` | 외부 관찰 가능 동작 변경 | 기존 API 응답 스키마 변경, UX 문구 수정, 권한 정책 변경, 세션 타임아웃 정책, 마이그레이션 호환성 |
| `rollback-confirmation` | 실패 후 rollback 실행 승인 | `git reset --hard HEAD~1`, 부분 커밋 폐기, 직전 mutation 되돌리기 |
| `critical` | 자식이 자기 `critical_gates` 로 선언한 게이트의 버블업 | `existing-public-contract-change` / `existing-test-weakened-or-deleted` / `existing-file-deleted-or-moved` — `--auto` 무관 항상 **HALT** (`auto-option.md` §4 severity 분기 / §0.G7 자식 선언 승계) |

**판단 휴리스틱** (자식이 severity 분류 시 적용):

- **의심되면 business-decision 으로 상향** — clarification 오분류가 `--auto` 자동 처리 위험으로 직결되므로 보수적으로 상향.
- 외부 관찰 가능 (API / UX / 권한 / 세션 / 호환성) → business-decision
- 순수 구현 세부 (naming / 로그 레벨 / 내부 private 함수) → clarification
- 명시적 rollback 키워드 (`git reset` / `revert` / `되돌` / `복구`) → rollback-confirmation
- task.files[].path 에 `migration` / `schema` / `auth` 경로 토큰 포함 → business-decision 강제 (path 기반 휴리스틱 — kiwi-planner sidecar 의 표준 `files[]` 필드만 참조)
- 기존 테스트의 **약화·삭제** 버블업은 severity 로 분류하지 않는다 → §0.G7 `existing-test-weakened-or-deleted` 로 always HALT (`references/extended-workflow.md` §5.1) — 회귀 안전망 제거는 결정 위임 대상이 아니다

### 3.6 Lifecycle gate 차단의 `--auto` 동작

§4 lifecycle gate (`references/extended-workflow.md`) 가 REQ 를 차단했을 때의 `--auto` 분기 SSOT. 무인 실행의 중단 지점을 결정하므로 core map 에 둔다.

- `draft` 차단 → **해당 REQ 를 trace 하는 Task 만 skip** 하고 나머지 Task 는 계속 진행. skip 목록을 보고한다 (worklog `lifecycle_skip_per_req`, 보고서 §7). 근거 — 종래의 전면 차단은 `--auto` 가 대화형 §4.2 (B) 보다 선택지가 적어지는 역전을 만들었다
- skip 된 REQ 는 조용히 사라지지 않는다 — `reason_class = "draft-stability-skip"` 로 종료 보고서 §7 과 부모 wave 검증의 `verification.residual` 에 잔여로 표면화한다
- `deprecated` / `frozen` → 즉시 HALT (정책 위반 / 의도된 제거, §0.G7 `lifecycle-gate-policy-stop`)
- target 비어있음 → HALT
- `--auto --skip-lifecycle-gate` 조합은 §1.3 에서 차단

본 절의 완화는 `draft` 한 종류에 한정한다 — `deprecated` / `frozen` 의 HALT, `--auto` 가 자식의 안전 우회 옵션(`--yes-all` 등)을 자동 생성하지 않는다는 원칙, §5.1 의 나머지 예외는 그대로 유지한다.

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
lifecycle gate, auto/resume handling, final SRS status mutations, reporting, compatibility mapping, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
