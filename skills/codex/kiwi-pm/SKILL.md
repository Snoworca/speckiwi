---
name: kiwi-pm
description: "kiwi-planner 산출물(plan_contract=1.2.0 + sidecar TDD) 을 입력 SSOT 로 받아 각 Task 를 격리된 sub-agent(kiwi-coder) 로 순차 실행하는 coder-loop runner v0.1. 3상태 프로토콜(TASK_DONE / NEEDS_USER / FAILED) 로 메인 세션과 대화하며, 부팅 시 speckiwi Stability lifecycle gate(evolving/stable 만 진행), 종료 시 REQ status implemented 일괄 승급 + add_completed_work(plan-summary) 마무리, doculight MCP 가용 시 보고서 표시. --auto 는 공용 auto-option 정책으로 clarification/business-decision/rollback-confirmation 게이트를 자동 결정하되 critical_gates[] 는 항상 중단한다. `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 지정 전파. --resume / --from-task 재개 가능. 트리거 — plan 돌려, kiwi pm, kiwi 코더 루프, task 루프 실행, 자동 코딩 실행, plan-driven loop, kiwi planner 산출물 실행, coder loop runner, plan 순차 실행, plan 자동 실행. 범위 외 — PRD/SRS/feasibility/planner/reviewer 호출 안 함, /snoworca-* 호출 절대 금지."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-pm v0.1

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

## Official Workflow Tool Policy

For covered workflow artifact flows, use official SpecKiwi workflow tools before raw file reads or manual appends:

1. Select and read plan/session state through MCP `get_next_work_order`, `workflow_plan_status`, `workflow_plan_task`, `workflow_next_plan_task`, `workflow_session_status`, `workflow_resume_hint`, `workflow_worklog_tail`, `workflow_doctor`, and `workflow_schema_check` before reading `docs/plans`, `.kiwi/sessions`, worklogs, or pipeline JSONL directly.
2. Use guarded workflow mutations (`workflow_task_check`, `workflow_checklist_set`, `workflow_task_status_set`, `workflow_worklog_emit`, `workflow_pipeline_emit`, and `workflow_repair_record`) before direct plan checkbox edits, PM state rewrites, or shell JSONL append snippets.
3. Use CLI `speckiwi workflow ... --json` only as diagnostic/remediation fallback when MCP workflow tools are unavailable; CLI is not a normal replacement for MCP SRS mutations.
4. Raw file fallback is degraded mode. It is allowed only after capturing tool diagnostics, affected artifact paths, active target, and a follow-up requirement or candidate ID in `pm-state.json`, the report, or worklog.

`kiwi-planner` 가 만든 plan.md + sidecar.json (`plan_contract=1.2.0`, `schema_version=1.1.0`) 을 입력 SSOT 로 받아, 각 Task 를 격리된 sub-agent(`kiwi-coder`) 로 순차 실행하는 coder-loop runner. 메인 세션 컨텍스트 누적 없이 장기 plan(40 Task+) 완주 가능.

legacy Phase 단위 + CLI subprocess(`--headless`) 구조를 폐기하고, **Task 단위 + Codex 서브에이전트 위임 단일 모드** 로 단순화한 마이그레이션 산출물. legacy 자식 프로세스 안전 게이트(T1/T2/T3 forbidden_patterns / ENV_WHITELIST / sentinel parser / Python self-heal) 는 Codex 권한 모델에 맞지 않아 제거.

PM 자체는 read-only orchestrator 에 가깝다 — Task 실행/TDD/회귀/MCP mutation 4종 중 3종 은 자식 `kiwi-coder` 전권. PM 은 부팅 시 speckiwi `list_requirements` read 로 Stability lifecycle gate 적용하고, 모든 Task 완료 후 T-final 단계에서 `update_status("implemented")` + `add_completed_work(plan-summary)` 2종 mutation 으로 plan 단위 마무리. 보고서는 doculight MCP 가용 시 doculight MCP `open_markdown` 으로 표시.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 강제 위임**. PM 은 TDD 게이트 직접 호출 안 함 — kiwi-coder §0.1/§0.G1 가 자체 처리. 자식이 자기 Task 의 TDD 사이클(test → red → impl → green) 책임 |
| §0.2 | **plan-contract 의무 SSOT**. 입력 plan 은 `plan_contract = "1.2.0"` + `schema_version = "1.1.0"` + `tdd_policy ∈ {strict, relaxed}` 필수. 위반 시 §7.1 입력 무결성 게이트 차단. `tdd_policy = "disabled"` 인 plan 거부 |
| §0.3 | **`/snoworca-*` 호출 절대 금지** + `_shared/snoworca/` 모듈 import 절대 금지. snoworca-pm 의 로직만 차용했으며 실행은 본 스킬 내부에서 직접 수행. kiwi-* 시리즈 독립 운영 원칙 |
| §0.4 | **검증은 서브에이전트**. plan 정합성 평가·sidecar 무결성 추가 검증 등 판단이 끼는 모든 작업은 sub-agent로 위임 (project verification rule). 자기검증 금지 |
| §0.5 | **메인 세션의 직접 파일 수정 금지** — 단, `plan.md` 체크박스 갱신 (§6.1) 과 `{plan_id}.checklist.md` 폴백 생성 (§6.1) 은 PM 중앙 집중 관리 책임으로 예외. 코드 파일은 어떤 경우에도 PM 이 직접 수정 안 함 |
| §0.6 | **Mock 검출은 kiwi-coder 책임** (kiwi-coder §0.6). PM 은 무대응 |
| §0.7 | **spawn 단위 = Task 1:1**. sidecar.tasks[] 가 곧 작업 단위이며 PM 이 임의로 분할/병합하지 않는다. 필요 시 `$kiwi-planner` 재실행 권고 (kiwi-coder §0.15 정합) |
| §0.8 | **사용자 확인 의무 + `--auto` 처리** — 다음 시점에 `Codex clarification gate` 또는 `../_shared/kiwi/auto-option.md` decision worker 적용: ① lifecycle gate 차단 (§4) ② NEEDS_USER severity=business-decision (§5.1) ③ T-final mutation dryRun 결과 승인 (§6.2) ④ MCP 미가용 시 HALT 및 복구 안내 ⑤ plan/sidecar SHA256 mismatch on `--resume` (§5.4). §0.G7 critical_gates[] 는 `--auto` 로 우회하지 않는다. |
| §0.9 | **외부 모듈 영향 처리는 kiwi-coder 책임** (kiwi-coder §0.G2). 자식이 `NEEDS_USER + severity=business-decision` 으로 PM 에 버블업하면 §5 가드레일 적용 |
| §0.10 | **project signature-ban instruction** + **project change-history policy**. 본 스킬 본문에 `## 변경 이력` / `## Changelog` / `### v0.x.y` 섹션 없음 — git history 가 SSOT. 커밋 메시지·코드 주석·산출물 어디에도 AI 식별 정보 금지 |
| §0.11 | **`.kiwi/sessions/{run_id}/pm-state.json` 영속 의무**. 모든 Task 종료 / NEEDS_USER 버블업 / FAILED / `--resume` 진입 / lifecycle gate 평가 직후 SAVE_STATE. 손상 시 `.bak` 복구 (§7.2) |
| §0.12 | **MCP 호출 분담 + 시그니처 SSOT** — speckiwi MCP 실제 schema 기준. PM 호출 2종: (a) `update_status(id, status)` — T-final 조건부 implemented 승급, dryRun 옵션 없음. (b) `add_completed_work(date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun])` — T-final plan-summary, plan_id/run_id/tasks 같은 임의 필드는 summary 텍스트에 인코딩. read 2종: `get_active_target` / `list_requirements`. 자식 kiwi-coder 4종 mutation: `add_trace_link(id, type, reference, relation)` / `add_verification_evidence(id, type, reference, [covers, notes])` / `update_status(id, status="in_progress")` / `add_completed_work(date, summary, ...)`. doculight MCP: `open_markdown` / `update_markdown` (§6.3) |
| §0.13 | **회귀 테스트는 kiwi-coder §0.13 책임**. PM 은 별도 회귀 호출 안 함. 종합 통합 테스트가 필요하면 사용자에게 별도 안내 |
| §0.14 | **id 정규식 SSOT** (kiwi-planner / kiwi-coder §0.14 와 동일). `run_id` = `[a-z0-9.-]{4,40}`, `phase_id` = `^PH-\d{3}$`, `task_id` = `^T-PH\d{3}-\d{2}$`. sidecar 가 위반하면 §7.1 차단 |
| §0.15 | **서브에이전트 위임 모드 단일** — 사용 가능한 Codex sub-agent/delegation 도구로 자식 `kiwi-coder` 를 실행한다. 자식 모델 = 현재 세션 모델 (또는 `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 override). legacy `--headless` CLI subprocess 폐기. 메인 컨텍스트 직접 skill 재진입 금지 (메인 컨텍스트 격리가 PM 본질 가치). 본 결정의 영향 — T1/T2/T3 forbidden_patterns 게이트 / ENV_WHITELIST / sentinel parser / process group / Python self-heal hook 모두 불필요해져 제거 |
| §0.16 | **`--auto` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/auto-option.md` v1.0 을 따른다. `business-decision` 은 더 이상 blanket hard halt 가 아니며, §0.G7 critical gate 에 해당하지 않는 경우 decision worker 가 결정할 수 있다. 자식 `$kiwi-coder` 호출에는 `--auto` 를 전파한다. |
| §0.17 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `../_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §0.18 참고 | `--mini`/`--loops N` 는 kiwi-coder 자식 spawn 에 전파 (loop-option.md §6) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — sidecar 무결성

| IF | THEN |
|---|---|
| `plan_contract ≠ "1.2.0"` 또는 `schema_version ≠ "1.1.0"` | 거부 + "kiwi-planner --tdd-policy=relaxed\|strict 로 재실행하여 산출물을 생성하십시오" 안내 (kiwi-coder §0.G3 정합) |
| `tdd_policy = "disabled"` | 거부 + 권고 |
| sidecar JSON parse 실패 | 거부 + validator.mjs 재실행 권고 (`node ../kiwi-planner/scripts/validator.mjs ...`) |
| sidecar.tasks[] 빈 배열 또는 부재 | 거부 — 실행할 Task 없음 |
| `task_id` / `phase_id` / `run_id` 정규식 위반 (§0.14) | 거부 |
| `validator.json` 존재 + `exit_code != 0` | WARN + 사용자 진행 동의 |
| plan.md.frontmatter.sidecar_path ↔ 실제 sidecar 경로 불일치 | WARN + 실제 경로 사용 |

#### §0.G2 — Lifecycle gate (Stability)

§4 의 표를 SSOT 로 참조. 진행 가능 = `evolving` / `stable` 만. `draft` 는 사용자 3지선다, `deprecated` / `frozen` 은 즉시 HALT.

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
| `lifecycle-gate-draft` | draft/deprecated/frozen lifecycle blocker | §4 |
| `auto-skip-lifecycle-gate-combo` | `--auto --skip-lifecycle-gate` 조합은 사용자 책임 범위 | §1.3 |
| `path-heuristic-business-decision` | auth/schema/migration 등 외부 관찰 가능 정책 변경 | §5.1 |
| `sha-mismatch-on-resume` | plan/sidecar SHA mismatch 는 외부 변경 의심 | §5.4 |
| `t-final-backward-transition` | status 역방향 전이 금지 | §0.G5 |
| `t-final-dryrun-rejected` | final mutation dryRun/transition guard 거부 | §0.G6 |
| `mcp-unavailable` | lifecycle 또는 final mutation 판단 불가. CLI 진단 가능 여부와 무관하게 정상 SRS read/mutation 대체 금지 | §4.4 / §6.2 |

---

## 1. 입력 / 출력

### 1.1 필수 입력

**`PLAN_PATH`** — kiwi-planner 산출물 `*.plan.md` 의 경로.

부재 시 fallback:
1. `docs/plans/*.plan.md` 의 가장 최신 `generated_at` 자동 채택
2. 후보 ≥2 개일 시 `Codex clarification gate` 으로 선택 요청
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
| "검증 모델 지정", "다른 모델로 검증" | `--model <name>` | 현재 세션 모델 |
| "이전 lock 무시", "강제" | `--force` | false |
| "lifecycle 무시" (위험) | `--skip-lifecycle-gate` | false |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |
| "doculight 끄고" | `--no-doculight` | doculight 자동 표시 |

### 1.3 CLI 인자 요약

```
$kiwi-pm PLAN_PATH=docs/plans/...plan.md
         [SIDECAR_PATH=...]              # 부재 시 frontmatter.sidecar_path 로 추론
         [CODE_PATH=.]                   # 부재 시 cwd
         [--auto]                         # auto-option decision worker 활성, critical gates 는 HALT
         [--model <name>]                 # kiwi-coder 자식에 --model 전파 (검증 서브에이전트 모델 지정)
         [--resume]                       # .kiwi/sessions/{run_id}/pm-state.json 이어가기
         [--from-task=T-PH001-XX]         # 특정 Task 부터 (디버깅 / 부분 재실행)
         [--force]                        # stale lock 강제 해제 (주의 경고 후 진행)
         [--skip-lifecycle-gate]          # §4 게이트 우회 (사용자 책임, --auto 와 함께 사용 불가)
         [--no-doculight]                 # doculight MCP 표시 강제 skip
```

**`--auto` 와 `--skip-lifecycle-gate` 동시 사용 금지** — lifecycle gate 차단은 business-decision 영역이므로 사용자 결정이 필요. 두 플래그가 함께 명시되면 HALT + 안내.

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
- `tasks[].attempts` — sub-agent spawn 횟수 (재spawn 포함). §0.G3/§0.G4 카운터
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
            IF args.auto: HALT(f"depends_on 위반: {task.task_id}")
            ELSE: Codex clarification gate("depends_on 위반 — 진행 여부?")

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
                    choice = Codex clarification gate(§0.G3 3지선다)
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

### 3.2 서브에이전트 자식 실행 프롬프트

사용 가능한 Codex 서브에이전트 위임 도구로 자식에게 다음 프롬프트를 전달한다. 권장 실행 속성: worker 역할, high reasoning effort (또는 `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 override).

```
당신은 kiwi-coder 스킬을 실행하는 격리된 서브에이전트입니다.

## INPUTS
- PLAN_PATH={args.plan_path}
- SIDECAR_PATH={args.sidecar_path}
- RUN_ID={state.run_id}                # .kiwi/sessions/{run_id}/ 영속화에 사용
- TARGET={state.target_slug}           # lifecycle gate 일관성 확인용
- TASK_FILTER={task.task_id}           # 이번 자식은 이 Task 하나만 실행
- CODE_PATH={args.code_path}
- AUTO={true if args.auto else false}
- LOOP_FLAGS={forward --mini / --loops N round-cap to the kiwi-coder child}
- LIFECYCLE_BLOCKED_REQS={state.lifecycle_gate_state.blocked_req_ids}
- 이전 NEEDS_USER 답변 (재spawn 시):
{user_answers OR "없음"}

## 실행 지침

**1단계: kiwi-coder 스킬 사용**
Codex skill invocation prose로 `kiwi-coder` 를 사용하라:

```
Use $kiwi-coder with PLAN_PATH={args.plan_path} SIDECAR_PATH={args.sidecar_path} TASK_FILTER={task.task_id} RUN_ID={state.run_id}{' --auto' if args.auto else ''}{' --model ' + args.model if args.model else ''}
```

스킬 내용을 추측하거나 우회하지 말 것. 가능한 경우 실제 `kiwi-coder` skill body를 로드하고, 스킬 로딩 기능이 없으면 해당 skill folder의 `SKILL.md`를 직접 읽어 따른다.

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
      "severity": "clarification | business-decision | rollback-confirmation",
      "question": "...",
      "context": "<왜 묻는가 + 근거>",
      "options": [
        {{ "key": "A", "label": "...", "consequence": "..." }},
        {{ "key": "B", "label": "...", "consequence": "..." }}
      ],
      "default_if_auto": "A | null"  // business-decision 도 critical_gates[] 외에는 auto-option decision worker 대상
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
- standard×4 TDD 검증 finding → kiwi-coder Phase 1.3 개선 루프
- 까칠 코드 리뷰어 finding → kiwi-coder Phase 2.h 개선 루프
- 회귀 테스트 fail → kiwi-coder §0.13 개선 루프
- Mock 검출 (§0.6) → kiwi-coder CRITICAL 자체 차단

이들은 자식 안에서 처리되며 외부에서 보면 단순히 자식 spawn 시간이 길어질 뿐 PM 메인의 NEEDS_USER 인터럽트 없음.

### 3.4 메인까지 올라오는 NEEDS_USER

다음 시점에만 자식이 PM 으로 버블업:

- 외부 모듈 영향 (kiwi-coder §0.G2) — cwd 외부 path 수정 필요 시
- 비즈니스 결정 (severity=business-decision) — UX/API/권한/세션 정책 변경
- MCP mutation guard 위반 (kiwi-coder §0.G5) — backward status 시도 등
- 개선 루프 발산 (kiwi-coder §0.G4) — 시니어 3회 / 리뷰어 2회 / standard 검증 3회 누적 + 동일 finding 잔존
- 사용자 결정 의무 (kiwi-coder §0.8) — 외부 모듈 / 통합 테스트 / MCP mutation ≥10건 batch / plan 외 파일 변경

### 3.5 severity enum + 판단 휴리스틱

| severity | 의미 | 예시 |
|---|---|---|
| `clarification` | 구현 세부의 모호성 해소 | 파일명 camelCase ↔ snake_case, 에러 메시지 문구, 로그 레벨, private 함수 시그니처 |
| `business-decision` | 외부 관찰 가능 동작 변경 | 기존 API 응답 스키마 변경, UX 문구 수정, 권한 정책 변경, 세션 타임아웃 정책, 마이그레이션 호환성 |
| `rollback-confirmation` | 실패 후 rollback 실행 승인 | `git reset --hard HEAD~1`, 부분 커밋 폐기, 직전 mutation 되돌리기 |

**판단 휴리스틱** (자식이 severity 분류 시 적용):

- **의심되면 business-decision 으로 상향** — clarification 오분류가 `--auto` 자동 처리 위험으로 직결되므로 보수적으로 상향.
- 외부 관찰 가능 (API / UX / 권한 / 세션 / 호환성) → business-decision
- 순수 구현 세부 (naming / 로그 레벨 / 내부 private 함수) → clarification
- 명시적 rollback 키워드 (`git reset` / `revert` / `되돌` / `복구`) → rollback-confirmation
- task.files[].path 에 `migration` / `schema` / `auth` 경로 토큰 포함 → business-decision 강제 (path 기반 휴리스틱 — kiwi-planner sidecar 의 표준 `files[]` 필드만 참조)

---


## Extended References

- Read `references/extended-workflow.md` when executing or validating
lifecycle gate, auto/resume handling, final SRS status mutations, reporting, compatibility mapping, and pipeline event emission
.
- Keep `SKILL.md` as the core trigger and workflow map; load the reference file only after the relevant phase is reached.
