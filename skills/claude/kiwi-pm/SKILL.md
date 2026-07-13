---
name: kiwi-pm
description: "kiwi-planner 산출물(plan_contract=1.2.0 + sidecar TDD) 을 입력 SSOT 로 받아 각 Task 를 격리된 Agent 서브에이전트(kiwi-coder) 로 순차 spawn 하는 coder-loop runner v0.1. 3상태 프로토콜(TASK_DONE / NEEDS_USER / FAILED) 로 메인 세션과 대화하며, 부팅 시 speckiwi Stability lifecycle gate(evolving/stable 만 진행), 종료 시 REQ status implemented 일괄 승급 + add_completed_work(plan-summary) 마무리, doculight MCP 가용 시 보고서 표시. --auto 시 severity 가드레일(clarification 자동 / business-decision 서브에이전트 자동 결정 — confidence ≥ 0.7 미만 시 critical 격상 / rollback-confirmation 자동승인, SSOT `_shared/kiwi/auto-option.md` §4). `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 지정 전파. --resume / --from-task 재개 가능. 트리거 — plan 돌려, kiwi pm, kiwi 코더 루프, task 루프 실행, 자동 코딩 실행, plan-driven loop, kiwi planner 산출물 실행, coder loop runner, plan 순차 실행, plan 자동 실행. 범위 외 — PRD/SRS/feasibility/planner/reviewer 호출 안 함, /snoworca-* 호출 절대 금지."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.
# kiwi-pm v0.1

`kiwi-planner` 가 만든 plan.md + sidecar.json (`plan_contract=1.2.0`, `schema_version=1.1.0`) 을 입력 SSOT 로 받아, 각 Task 를 격리된 `Agent` 서브에이전트(`kiwi-coder`) 로 순차 spawn 하는 coder-loop runner. 메인 세션 컨텍스트 누적 없이 장기 plan(40 Task+) 완주 가능.

snoworca-pm v3.0 의 Phase 단위 + claude CLI subprocess(`--headless`) 구조를 폐기하고, **Task 단위 + `Agent` 도구 단일 모드** 로 단순화한 마이그레이션 산출물. snoworca-pm 의 자식 spawn 안전 게이트(T1/T2/T3 forbidden_patterns / ENV_WHITELIST / sentinel parser / Python self-heal) 는 `Agent` 도구가 권한 모델을 자체 제공하므로 모두 제거.

PM 자체는 read-only orchestrator 에 가깝다 — Task 실행/TDD/회귀/MCP mutation 4종 중 3종 은 자식 `kiwi-coder` 전권. PM 은 부팅 시 speckiwi `list_requirements` read 로 Stability lifecycle gate 적용하고, 모든 Task 완료 후 T-final 단계에서 `update_status("implemented")` + `add_completed_work(plan-summary)` 2종 mutation 으로 plan 단위 마무리. 보고서는 `Agent` 가용 시 doculight MCP `open_markdown` 으로 표시.

---

## 0. 공통 규약 (SSOT)

| 키 | 규칙 |
|---|---|
| §0.1 | **TDD 강제 위임**. PM 은 TDD 게이트 직접 호출 안 함 — kiwi-coder §0.1/§0.G1 가 자체 처리. 자식이 자기 Task 의 TDD 사이클(test → red → impl → green) 책임 |
| §0.2 | **plan-contract 의무 SSOT**. 입력 plan 은 `plan_contract = "1.2.0"` + `schema_version = "1.1.0"` + `tdd_policy ∈ {strict, relaxed}` 필수. 위반 시 §7.1 입력 무결성 게이트 차단. `tdd_policy = "disabled"` 인 plan 거부 |
| §0.3 | **`/snoworca-*` 호출 절대 금지** + `_shared/snoworca/` 모듈 import 절대 금지. snoworca-pm 의 로직만 차용했으며 실행은 본 스킬 내부에서 직접 수행. kiwi-* 시리즈 독립 운영 원칙 |
| §0.4 | **검증은 서브에이전트**. plan 정합성 평가·sidecar 무결성 추가 검증 등 판단이 끼는 모든 작업은 `Agent` 서브에이전트로 위임 (CLAUDE.md §5). 자기검증 금지 |
| §0.5 | **메인 세션의 직접 파일 수정 금지** — 단, `plan.md` 체크박스 갱신 (§6.1) 과 `{plan_id}.checklist.md` 폴백 생성 (§6.1) 은 PM 중앙 집중 관리 책임으로 예외. 코드 파일은 어떤 경우에도 PM 이 직접 수정 안 함 |
| §0.6 | **Mock 검출은 kiwi-coder 책임** (kiwi-coder §0.6). PM 은 무대응 |
| §0.7 | **spawn 단위 = Task 1:1**. sidecar.tasks[] 가 곧 작업 단위이며 PM 이 임의로 분할/병합하지 않는다. 필요 시 `/kiwi-planner` 재실행 권고 (kiwi-coder §0.15 정합) |
| §0.8 | **사용자 확인 의무** — 다음 시점에 `AskUserQuestion` 강제: ① lifecycle gate 차단 (§4) ② NEEDS_USER severity=business-decision (§5.1) ③ T-final mutation dryRun 결과 승인 (§6.2) ④ MCP 미가용 시 진행 동의 ⑤ plan/sidecar SHA256 mismatch on `--resume` (§5.4) |
| §0.9 | **외부 모듈 영향 처리는 kiwi-coder 책임** (kiwi-coder §0.G2). 자식이 `NEEDS_USER + severity=business-decision` 으로 PM 에 버블업하면 §5 가드레일 적용 |
| §0.10 | **CLAUDE.md §6 시그니처 금지** + **§7 변경 이력 금지**. 본 스킬 본문에 `## 변경 이력` / `## Changelog` / `### v0.x.y` 섹션 없음 — git history 가 SSOT. 커밋 메시지·코드 주석·산출물 어디에도 AI 식별 정보 금지 |
| §0.11 | **`.kiwi/sessions/{run_id}/pm-state.json` 영속 의무**. 모든 Task 종료 / NEEDS_USER 버블업 / FAILED / `--resume` 진입 / lifecycle gate 평가 직후 SAVE_STATE. 손상 시 `.bak` 복구 (§7.2) |
| §0.12 | **MCP 호출 분담 + 시그니처 SSOT** — speckiwi MCP 실제 schema 기준. PM 호출 2종: (a) `update_status(id, status)` — T-final 조건부 implemented 승급, dryRun 옵션 없음. (b) `add_completed_work(date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun])` — T-final plan-summary, plan_id/run_id/tasks 같은 임의 필드는 summary 텍스트에 인코딩. read 2종: `get_active_target` / `list_requirements`. 자식 kiwi-coder 4종 mutation: `add_trace_link(id, type, reference, relation)` / `add_verification_evidence(id, type, reference, [covers, notes])` / `update_status(id, status="in_progress")` / `add_completed_work(date, summary, ...)`. doculight MCP: `open_markdown` / `update_markdown` (§6.3) |
| §0.13 | **회귀 테스트는 kiwi-coder §0.13 책임**. PM 은 별도 회귀 호출 안 함. 종합 통합 테스트가 필요하면 사용자에게 별도 안내 |
| §0.14 | **id 정규식 SSOT** (kiwi-planner / kiwi-coder §0.14 와 동일). `run_id` = `[a-z0-9.-]{4,40}`, `phase_id` = `^PH-\d{3}$`, `task_id` = `^T-PH\d{3}-\d{2}$`. sidecar 가 위반하면 §7.1 차단 |
| §0.15 | **spawn 모드 단일** — `Agent` 도구만. 자식 모델 = 현재 세션 모델 (또는 `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 override). snoworca-pm 의 `--headless` (claude CLI subprocess) 폐기. `Skill` 도구 직접 호출 금지 (메인 컨텍스트 격리가 PM 본질 가치). 본 결정의 영향 — T1/T2/T3 forbidden_patterns 게이트 / ENV_WHITELIST / sentinel parser / process group / Python self-heal hook 모두 불필요해져 제거 |
| §0.16 | **`--auto` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/auto-option.md` v1.0 을 따른다. 본 스킬의 3종 severity enum (`clarification` / `business-decision` / `rollback-confirmation`) 은 §5.1 에서 유지되며, SSOT §4 severity 분기 정책의 정확한 mapping 대상이다 (SSOT §11 마이그레이션 표 참조: 기존 business-decision HALT 중 비가역/외부영향 큰 항목은 본 §0.G7 critical_gates 로 인라인). 본 스킬의 `critical_gates[]` 는 §0.G7 (아래) 참조 |
| §0.17 | **`--mini` / `--loops N` 옵션 SSOT**. 본 스킬은 `_shared/kiwi/loop-option.md` v1.0 을 따른다. `--mini` = 검증-개선 루프 라운드 상한 3, `--loops N` = 라운드 상한 N(정수 ≥1). 동시 지정 시 **`--loops` 우선(경고)**. `--max` 와 직교(조합). 상한 도달 시 잔여 finding 보고(안전 게이트 불우회) |
| §0.18 참고 | `--mini`/`--loops N` 는 kiwi-coder 자식 spawn 에 전파 (loop-option.md §6) |

### §0.G — 핵심 게이트 결정표

#### §0.G1 — sidecar 무결성

| IF | THEN |
|---|---|
| `plan_contract ≠ "1.2.0"` 또는 `schema_version ≠ "1.1.0"` | 거부 + "kiwi-planner --tdd-policy=relaxed\|strict 로 재실행하여 산출물을 생성하십시오" 안내 (kiwi-coder §0.G3 정합) |
| `tdd_policy = "disabled"` | 거부 + 권고 |
| sidecar JSON parse 실패 | 거부 + validator.mjs 재실행 권고 (`node ~/.claude/skills/kiwi-planner/validator.mjs ...`) |
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

speckiwi `apply-patch.ts` 또는 `stability-transition.js` 가 mutation 을 거부할 경우, dryRun 단계에서 미리 감지 → 사용자에게 거부 사유 / 대체 옵션 제시. 강제 우회 없음.

#### §0.G7 — `--auto` critical_gates[] 선언

본 스킬의 `--auto` 활성 시 사용자 강제 HALT 게이트 (SSOT `_shared/kiwi/auto-option.md` §5 인터페이스 준수). §5.1 severity 가드레일 표의 `business-decision` 카테고리 중 비가역/외부영향이 큰 항목을 본 표로 인라인 — 이들은 결정 서브에이전트로 우회 금지:

| gate_id | reason | 발생 위치 |
|---|---|---|
| `lifecycle-gate-draft` | REQ stability=draft 차단 (§4 lifecycle gate). business-decision 영역, 자동 우회 금지 | §4 / §5.1 예외 |
| `plan-sidecar-sha-mismatch` | `--resume` 진입 시 plan/sidecar SHA256 mismatch (§5.4) — 외부 변경 의심, business-decision | §5.4 / §0.8 ⑤ |
| `depends-on-violation` | `--from-task` 사용 시 depends_on 미충족 (§5.5) | §5.5 |
| `t-final-backward-transition` | `update_status` REQ status 역방향 전이 (§0.G5) | §0.G5 |
| `mcp-cli-both-unavailable` | speckiwi MCP + CLI 모두 부재 (§0.8 ④) — sync 위임 차단 | §0.8 ④ |
| `auto-skip-lifecycle-gate-combo` | `--auto` + `--skip-lifecycle-gate` 동시 명시 (§1.3 후미) — HALT 강제 | §1.3 |
| `path-heuristic-business-decision` | task.files[].path 에 `migration` / `schema` / `auth` 토큰 — business-decision 강제 (§3.5 후미 휴리스틱) | §3.5 |
| `mcp-mutation-batch-large` | MCP mutation ≥10건 batch (kiwi-coder §0.8 인용, §5.1 예외) | §5.1 예외 |
| `t-final-dryrun-reject` | T-final dryRun 거부 / transition guard 거부 (§0.G6) | §0.G6 |
| `external-module-impact` | 외부 모듈 영향 (kiwi-coder §0.G2 버블업) — §5.1 예외 | §5.1 예외 |

**기존 severity enum 유지**: §3.5 / §5.1 의 `clarification` / `business-decision` / `rollback-confirmation` 3종 enum 은 SSOT `_shared/kiwi/auto-option.md` §4 severity 분기 정책에 매핑됨. `business-decision` 은 **서브에이전트 자동 결정** (confidence ≥ 0.7 채택, 미만이면 critical 격상) — 강제 HALT 가 아님. 본 §0.G7 critical_gates 의 항목은 그 중 SSOT §11 마이그레이션 표에 따라 "비가역/외부영향 큰" 항목만 인라인하여 auto 무관 항상 critical 로 격상한 케이스 (severity enum 자체와 별개 채널).

---

## 1. 입력 / 출력

### 1.1 필수 입력

**`PLAN_PATH`** — kiwi-planner 산출물 `*.plan.md` 의 경로.

부재 시 fallback:
1. `docs/plans/*.plan.md` 의 가장 최신 `generated_at` 자동 채택
2. 후보 ≥2 개일 시 `AskUserQuestion` 으로 선택 요청
3. 후보 0개 → HALT + "kiwi-planner 로 plan 먼저 작성하십시오" 안내

**`SIDECAR_PATH`** — 단독 입력도 허용. 이 경우 plan.md 는 frontmatter `sidecar_path` 의 inverse 로 추론. 둘 다 명시되었으나 frontmatter 와 불일치 시 §0.G1 WARN 발동.

### 1.2 선택 입력 + 자연어 매핑

| 자연어 신호 | 인자 | 기본값 |
|---|---|---|
| "plan X 로", "X 계획", "{plan_id} 실행" | `PLAN_PATH` | 자동 추정 |
| "코드는 Y 디렉토리에서" | `CODE_PATH` | 현재 작업 디렉토리 |
| "T-PH001-XX 부터" | `--from-task=T-PH001-XX` | 첫 pending Task |
| "자동", "auto", "묻지 말고" | `--auto` (SSOT: auto-option.md v1.0) | false (interactive) |
| "재개", "이어서", "resume" | `--resume` | false (신규 세션) |
| "검증 모델 지정", "다른 모델로 검증" | `--model <name>` | 현재 세션 모델 |
| "이전 lock 무시", "강제" | `--force` | false |
| "lifecycle 무시" (위험) | `--skip-lifecycle-gate` | false |
| "doculight 끄고" | `--no-doculight` | doculight 자동 표시 |
| "미니 모드", "빠른 모드", "3라운드" | `--mini` | off (스킬 기본 상한) |
| "루프 N회", "N라운드", "N번 돌려" | `--loops N` | off (스킬 기본 상한) |

### 1.3 CLI 인자 요약

```
/kiwi-pm PLAN_PATH=docs/plans/...plan.md
         [SIDECAR_PATH=...]              # 부재 시 frontmatter.sidecar_path 로 추론
         [CODE_PATH=.]                   # 부재 시 cwd
         [--auto]                         # severity 가드레일 활성, business-decision = 서브에이전트 자동 결정 (§5.1)
         [--model <name>]                 # kiwi-coder 자식에 --model 전파 (검증 서브에이전트 모델 지정)
         [--resume]                       # .kiwi/sessions/{run_id}/pm-state.json 이어가기
         [--from-task=T-PH001-XX]         # 특정 Task 부터 (디버깅 / 부분 재실행)
         [--force]                        # stale lock 강제 해제 (주의 경고 후 진행)
         [--skip-lifecycle-gate]          # §4 게이트 우회 (사용자 책임, --auto 와 함께 사용 불가)
         [--no-doculight]                 # doculight MCP 표시 강제 skip
```

**`--auto` 와 `--skip-lifecycle-gate` 동시 사용 금지** — lifecycle gate 차단은 §0.G7 critical_gates `lifecycle-gate-draft` / `auto-skip-lifecycle-gate-combo` 매핑으로 `--auto` 무관 항상 HALT (business-decision 자동 결정의 예외). 두 플래그가 함께 명시되면 HALT + 안내.

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
- `tasks[].attempts` — Agent spawn 횟수 (재spawn 포함). §0.G3/§0.G4 카운터
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
            ELSE: AskUserQuestion("depends_on 위반 — 진행 여부?")

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
                    choice = AskUserQuestion(§0.G3 3지선다)
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

### 3.2 Agent 자식 spawn 프롬프트

`Agent` 도구 호출 시 다음 프롬프트를 자식에게 전달. `subagent_type = "general-purpose"`, `model = "opus"` (또는 `--model <name>` 로 kiwi-coder 검증 서브에이전트 모델 override).

```
당신은 kiwi-coder 스킬을 실행하는 격리된 서브에이전트입니다.

## INPUTS
- PLAN_PATH={args.plan_path}
- SIDECAR_PATH={args.sidecar_path}
- RUN_ID={state.run_id}                # .kiwi/sessions/{run_id}/ 영속화에 사용
- TARGET={state.target_slug}           # lifecycle gate 일관성 확인용
- TASK_FILTER={task.task_id}           # 이번 자식은 이 Task 하나만 실행
- CODE_PATH={args.code_path}
- LOOP_FLAGS={forward --mini / --loops N round-cap to the kiwi-coder child}
- LIFECYCLE_BLOCKED_REQS={state.lifecycle_gate_state.blocked_req_ids}
- SPAWN_CONTEXT=pm-child   # 이 자식 호출이 PM 자식임을 식별. coder 가 §8.4 의 자동 시작 게이트를 skip 하기 위한 결정 필드
- 이전 NEEDS_USER 답변 (재spawn 시):
{user_answers OR "없음"}

## 실행 지침

**1단계: kiwi-coder 스킬 로드**
`Skill` 도구로 `kiwi-coder` 를 호출하라:
  Skill(skill="kiwi-coder",
        args="PLAN_PATH={args.plan_path} SIDECAR_PATH={args.sidecar_path} \
              TASK_FILTER={task.task_id} RUN_ID={state.run_id}\
              {' --auto' if args.auto else ''}\
              {' --model ' + args.model if args.model else ''}")

**`--auto` 자식 전파**: 본 스킬이 `--auto` 활성 상태에서 `kiwi-coder` 를 spawn 할 때 자식 args 에 `--auto` 명시 전파 (SSOT auto-option.md §7). 단, kiwi-coder 의 `--yes-all` / `--auto-integration` / `--auto-cost-warning` 3종 옵션은 별개이며 자동 활성하지 않음.

스킬 내용을 추측하거나 우회하지 말 것. 반드시 실제로 로드.

**2단계: 이번 Task 만 실행**
sidecar 의 `{task.task_id}` 하나만 처리. 다른 Task 진행 금지. plan.md / sidecar 의 다른 Task 부분 수정 금지.

**3단계: 중단 조건**
다음 발생 시 즉시 중단하고 아래 JSON 반환:
- 구현 세부 모호성 (severity = clarification)
- 외부 관찰 가능 변경 필요 (severity = business-decision — 의심되면 이쪽으로 상향. `--auto` 시 서브에이전트가 SSOT auto-option.md §4 분기로 자동 결정)
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
      "default_if_auto": "A | null"  // clarification 권장. business-decision 은 null (부모 PM 이 서브에이전트로 결정 — SSOT auto-option.md §4)
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
- Sonnet×4 TDD 검증 finding → kiwi-coder Phase 1.3 개선 루프
- 까칠 코드 리뷰어 finding → kiwi-coder Phase 2.h 개선 루프
- 회귀 테스트 fail → kiwi-coder §0.13 개선 루프
- Mock 검출 (§0.6) → kiwi-coder CRITICAL 자체 차단

이들은 자식 안에서 처리되며 외부에서 보면 단순히 자식 spawn 시간이 길어질 뿐 PM 메인의 NEEDS_USER 인터럽트 없음.

### 3.4 메인까지 올라오는 NEEDS_USER

다음 시점에만 자식이 PM 으로 버블업:

- 외부 모듈 영향 (kiwi-coder §0.G2) — cwd 외부 path 수정 필요 시
- 비즈니스 결정 (severity=business-decision) — UX/API/권한/세션 정책 변경
- MCP mutation guard 위반 (kiwi-coder §0.G5) — backward status 시도 등
- 개선 루프 발산 (kiwi-coder §0.G4) — 시니어 3회 / 리뷰어 2회 / Sonnet 검증 3회 누적 + 동일 finding 잔존
- 사용자 결정 의무 (kiwi-coder §0.8) — 외부 모듈 / 통합 테스트 / MCP mutation ≥10건 batch / plan 외 파일 변경

### 3.5 severity enum + 판단 휴리스틱

| severity | 의미 | 예시 |
|---|---|---|
| `clarification` | 구현 세부의 모호성 해소 | 파일명 camelCase ↔ snake_case, 에러 메시지 문구, 로그 레벨, private 함수 시그니처 |
| `business-decision` | 외부 관찰 가능 동작 변경 | 기존 API 응답 스키마 변경, UX 문구 수정, 권한 정책 변경, 세션 타임아웃 정책, 마이그레이션 호환성 |
| `rollback-confirmation` | 실패 후 rollback 실행 승인 | `git reset --hard HEAD~1`, 부분 커밋 폐기, 직전 mutation 되돌리기 |

**판단 휴리스틱** (자식이 severity 분류 시 적용):

- **의심되면 business-decision 으로 상향** — clarification 은 confidence ≥ 0.5 채택, business-decision 은 confidence ≥ 0.7 채택 + 미만 시 critical 격상 (SSOT auto-option.md §4). 외부 영향이 의심되면 보수적으로 상향하여 서브에이전트가 더 엄격한 게이트로 평가하게 한다.
- 외부 관찰 가능 (API / UX / 권한 / 세션 / 호환성) → business-decision
- 순수 구현 세부 (naming / 로그 레벨 / 내부 private 함수) → clarification
- 명시적 rollback 키워드 (`git reset` / `revert` / `되돌` / `복구`) → rollback-confirmation
- task.files[].path 에 `migration` / `schema` / `auth` 경로 토큰 포함 → business-decision 강제 (path 기반 휴리스틱 — kiwi-planner sidecar 의 표준 `files[]` 필드만 참조)

---

## 4. Lifecycle Gate

부팅 T0 단계 — sidecar 의 모든 Task 의 `traces[].req_id` 추출 후 1회 `list_requirements` read 로 일괄 평가. `--skip-lifecycle-gate` 명시 시 SKIP (사용자 책임, worklog `lifecycle_override` 기록).

### 4.1 차단 분류

| 분류 | REQ Stability | 동작 |
|---|---|---|
| 진행 가능 | `evolving` / `stable` | OK |
| 진행 불가 (정상) | `draft` | **차단** + interactive 3지선다 / `--auto` HALT |
| 진행 불가 (정책) | `deprecated` / `frozen` | **즉시 HALT** — frozen=정책 위반, deprecated=의도된 제거 |
| target 비어있음 | — | **차단** + "speckiwi `set_active_target` 으로 활성 target 지정 후 재실행" |

### 4.2 interactive 3지선다 (draft 차단 시)

- **(A) HALT** — kiwi-srs-feasibility 실행 후 재시도 (권장)
- **(B) 해당 REQ trace Task 만 skip 하고 나머지 진행** — 부분 진행. skip 된 Task 는 `status = "skipped"`, worklog `lifecycle_skip_per_req` 기록
- **(C) override 진행** — 사용자 책임. worklog `lifecycle_override` 기록 + 보고서에 경고 명시

### 4.3 `--auto` 동작

- `draft` 차단 → 자동 HALT (§0.G7 critical_gates `lifecycle-gate-draft` 인라인 — business-decision 자동 결정의 예외)
- `deprecated` / `frozen` → 즉시 HALT (정책 위반 / 의도된 제거)
- target 비어있음 → HALT
- `--auto --skip-lifecycle-gate` 조합은 §1.3 에서 차단

### 4.4 MCP 미가용 fallback

1. `mcp__speckiwi__list_requirements(target, projection: "compact")` 호출 시도
2. 실패 시 `speckiwi list --target {target} --json` CLI fallback
3. CLI 도 실패 시:
   - interactive → `AskUserQuestion("lifecycle gate 평가 불가 — 진행 여부 결정")` + worklog `lifecycle_gate_mcp_unavailable` 기록
   - `--auto` → HALT (안전 우선)
4. 평가 결과는 `state.lifecycle_gate_state.stability_snapshot` 에 저장 (REQ-ID → stability)

### 4.5 의사코드

```
FUNCTION APPLY_LIFECYCLE_GATE(plan, sidecar, state, args):
    IF args.skip_lifecycle_gate:
        worklog.append({event: "lifecycle_override", reason: "--skip-lifecycle-gate"})
        RETURN

    # 1. 활성 target 확인
    target = MCP_CALL_OR_CLI("get_active_target", fallback_cli="speckiwi active-target --json")
    IF NOT target:
        HALT("활성 target 없음. speckiwi set_active_target 으로 지정 후 재실행")
    IF target != state.target_slug AND state.target_slug:
        AskUserQuestion(f"plan target={state.target_slug} vs 활성 target={target} 불일치 — 진행?")

    # 2. REQ-ID 집계
    req_ids = UNIQUE([t.req_id FOR task IN sidecar.tasks FOR t IN (task.traces OR [])])
    IF NOT req_ids:
        worklog.append({event: "lifecycle_gate_no_traces", reason: "sidecar tasks lack traces"})
        RETURN   # trace 없는 plan 은 lifecycle gate 대상 아님 (kiwi-planner 가 traces 의무 위반한 경우)

    # 3. 일괄 read
    TRY:
        reqs = MCP_CALL(list_requirements, target=target, projection="compact")
    CATCH mcp_unavailable:
        TRY: reqs = CLI_FALLBACK(f"speckiwi list --target {target} --json")
        CATCH cli_failed:
            IF args.auto: HALT("MCP/CLI 모두 미가용, --auto 안전 우선 HALT")
            ELSE: AskUserQuestion("lifecycle gate 평가 불가, 진행 여부?")

    # 4. 분류
    stability_snapshot = {}
    status_snapshot = {}
    blocked = []
    FOR req IN reqs IF req.id IN req_ids:
        stability_snapshot[req.id] = req.stability
        status_snapshot[req.id] = req.status         # T-final 의 status_at_start 비교에 사용
        IF req.stability IN {"draft", "deprecated", "frozen"}:
            blocked.append(req)

    state.lifecycle_gate_state = {
        evaluated_at: NOW(),
        blocked_req_ids: [r.id FOR r IN blocked],
        stability_snapshot: stability_snapshot,
        status_snapshot: status_snapshot
    }
    SAVE_STATE(state)

    # 5. 차단 처리
    IF NOT blocked: RETURN

    deprecated_or_frozen = [r FOR r IN blocked IF r.stability IN {"deprecated", "frozen"}]
    IF deprecated_or_frozen:
        HALT(f"deprecated/frozen REQ 발견 (즉시 차단): {[r.id for r in deprecated_or_frozen]}")

    # draft 만 남은 경우
    IF args.auto:
        HALT(f"--auto 모드: draft REQ 차단, kiwi-srs-feasibility 선행 권장: {[r.id for r in blocked]}")
    ELSE:
        choice = AskUserQuestion("draft REQ 차단", options=[
            "A) HALT — kiwi-srs-feasibility 실행 후 재시도 (권장)",
            "B) 해당 REQ trace Task 만 skip 하고 나머지 진행",
            "C) override 진행 (사용자 책임)"
        ])
        IF choice == "A": HALT("사용자 선택: HALT")
        ELIF choice == "B":
            # 해당 REQ trace Task 들을 미리 skipped 마크
            FOR task IN sidecar.tasks:
                IF ANY(t.req_id IN [r.id FOR r IN blocked] FOR t IN (task.traces OR [])):
                    state.tasks[task.task_id].status = "skipped"
            worklog.append({event: "lifecycle_skip_per_req", req_ids: [r.id FOR r IN blocked]})
        ELIF choice == "C":
            worklog.append({event: "lifecycle_override", req_ids: [r.id FOR r IN blocked]})
        SAVE_STATE(state)
```

종료 시 (T-final) `state.lifecycle_gate_state.stability_snapshot` 과 현재 stability 를 비교하여 drift 가 감지되면 보고서에 경고로 명시 (의도된 변경일 수도 있으므로 차단은 안 함).

---

## 5. `--auto` 가드레일 + 재개 + 부분 재실행

### 5.1 severity 가드레일

| severity | `--auto` 동작 | interactive 동작 |
|---|---|---|
| `clarification` | `default_if_auto` 자동 채택 (부재 시 보수적 default) | 사용자에게 옵션 제시 |
| `business-decision` | **서브에이전트 자동 결정** (confidence ≥ 0.7 채택, 미만이면 critical 격상 — SSOT auto-option.md §4). §0.G7 critical_gates 매칭 항목은 예외로 HALT | 사용자에게 옵션 제시 |
| `rollback-confirmation` | "YES" 자동 승인 | 사용자에게 옵션 제시 |

**예외 (always HALT, 모드 무관)**:
- §4 lifecycle gate `draft`/`deprecated`/`frozen` 차단
- 외부 모듈 영향 (kiwi-coder §0.G2)
- MCP mutation ≥10건 batch (kiwi-coder §0.8)
- T-final dryRun 거부 / transition guard 거부 (§0.G6)
- plan/sidecar SHA256 mismatch on `--resume` (§5.4)

### 5.2 NEEDS_USER 재spawn 상한 (§0.G3 재기재)

동일 Task 에서 NEEDS_USER 3회 누적 시 (재spawn 한도) 3지선다:

- **(A) 추가 질문 1회 더 시도** — `attempts` 카운터는 계속 증가, 다음 NEEDS_USER 도착 시 다시 3지선다
- **(B) Task 건너뛰기** — `status = "skipped"`, worklog `task_skipped_after_3_questions` 기록
- **(C) 중단 + blocked 기록** — `status = "blocked"`, `state.last_question` 보존, SAVE_STATE 후 RETURN (사용자가 `--resume` 으로 재개 가능)

### 5.3 FAILED 3지선다 (§0.G4 재기재)

- **(A) 같은 Task 재시도** (처음부터) — `attempts` 증가, 동일 Task 재spawn
- **(B) Task 건너뛰기** — `status = "skipped"`
- **(C) 중단** — `status = "failed"`, `state.last_error` 보존, RETURN

`--auto` 모드 동작: (A) 자동 재시도 1회 → 또 FAILED 면 사용자에게 에스컬레이션 (`--auto` 라도 무한 재시도 금지).

### 5.4 `--resume` 동작

`.kiwi/sessions/{run_id}/pm-state.json` 로드 후:

1. **`status = "done"` Task → skip** (이미 완료)
2. **`status = "blocked"` + `last_question` 존재 → 재제시**: 사용자에게 질문 다시 보여주고 답변 받음 → 답변 주입 후 해당 Task 재spawn
3. **`status = "failed"` → 사용자 재시도 게이트**: 재시도/skip/중단 3지선다
4. **`status = "running"` → 비정상 종료 의심**: 이전 세션이 강제 종료된 흔적. `pending` 으로 복구 후 사용자 확인 (interactive). `--auto` 시 자동 `pending` 복구 + 진행
5. **`plan_sha256` / `sidecar_sha256` mismatch**: 외부에서 plan 변경됨. 사용자 게이트 3지선다:
   - (A) 새 SHA 로 갱신 + 계속 진행 (의도적 수정)
   - (B) 중단 (멀티 PM 인스턴스 / 외부 변경 의심)
   - (C) diff 표시 후 재결정 (재귀)

`--auto + SHA mismatch` → §0.G7 critical_gates `plan-sidecar-sha-mismatch` 인라인 — `--auto` 무관 HALT.

### 5.5 `--from-task=T-PH001-XX`

해당 Task 부터 실행. 강제 조건:
- 이전 Task 가 모두 `done` 상태가 아니면 경고 출력
- `depends_on` 위반 시 강한 경고 (`AskUserQuestion` — 사용자가 책임지고 진행)
- `--auto` 시 의존성 미충족이면 HALT (사용자 결정 필요)

`--from-task` + `--resume` 조합: `--from-task` 가 우선. `--resume` 의 첫 pending Task 탐색을 override.

### 5.6 의사코드

```
FUNCTION HANDLE_QUESTIONS(questions, args):
    answers = {}
    FOR q IN questions:
        IF args.auto:
            SWITCH q.severity:
                CASE "clarification":
                    answers[q.id] = q.default_if_auto OR CONSERVATIVE_DEFAULT(q)
                    LOG(f"[auto] {q.id} = {answers[q.id]}")
                CASE "business-decision":
                    # SSOT auto-option.md §4: 서브에이전트 자동 결정. confidence ≥ 0.7 채택, 미만이면 critical 격상.
                    # §0.G7 critical_gates 매칭 항목 (path-heuristic-business-decision 등) 은 예외로 HALT.
                    IF MATCH_CRITICAL_GATES(q):
                        PRINT(f"⚠️ critical_gate 매칭 (§0.G7) — --auto 무관 HALT")
                        answers[q.id] = AskUserQuestion(q)
                    ELSE:
                        result = SPAWN_DECISION_SUBAGENT(q)   # SSOT §2 토폴로지
                        IF result.confidence >= 0.7:
                            answers[q.id] = result.decision
                            LOG(f"[auto] {q.id} = {result.decision} (subagent, conf={result.confidence})")
                        ELSE:
                            PRINT(f"⚠️ business-decision confidence<0.7 — critical 격상 HALT")
                            answers[q.id] = AskUserQuestion(q)
                CASE "rollback-confirmation":
                    answers[q.id] = "YES"
                    LOG(f"[auto] {q.id} = YES (rollback 자동 승인)")
        ELSE:
            PRINT(f"❓ [{q.severity}] {q.question}")
            PRINT(f"근거: {q.context}")
            FOR opt IN q.options:
                PRINT(f"  {opt.key}) {opt.label} → {opt.consequence}")
            answers[q.id] = COLLECT_ANSWER()
    RETURN answers


FUNCTION CONSERVATIVE_DEFAULT(q):
    # default_if_auto 부재 시 보수적 default:
    # - "기본값 유지", "변경 안 함", "기존 동작 보존" 같은 옵션 우선 선택
    # - 옵션 라벨에서 "유지" / "보존" / "기본" / "현행" 키워드 매칭
    FOR opt IN q.options:
        IF MATCH(opt.label, /유지|보존|기본|현행|skip|preserve|keep/i):
            RETURN opt.key
    # 매칭 실패 → 첫 옵션 (관습)
    RETURN q.options[0].key


FUNCTION HANDLE_FAILED(result, args):
    state.last_error = result.error
    PRINT(f"⚠️ FAILED: {result.error.reason}")
    PRINT(f"시도한 것: {result.error.attempted}")

    IF args.auto AND state.tasks[task.task_id].attempts < 2:
        LOG("[auto] FAILED 1회 자동 재시도")
        RETURN "A"
    ELSE:
        choice = AskUserQuestion(§0.G4 3지선다)
        RETURN choice


FUNCTION VERIFY_SHA_ON_RESUME(state, plan_path, sidecar_path, args):
    current_plan_sha = SHA256(plan_path)
    current_sidecar_sha = SHA256(sidecar_path)
    IF state.plan_sha256 == current_plan_sha AND state.sidecar_sha256 == current_sidecar_sha:
        RETURN True

    IF args.auto:
        HALT("plan/sidecar SHA mismatch — §0.G7 critical_gates `plan-sidecar-sha-mismatch` HALT")

    choice = AskUserQuestion("plan/sidecar 외부 변경 감지", options=[
        "A) 새 SHA 로 갱신 + 계속 진행 (의도적 plan 수정)",
        "B) 중단 (멀티 PM 의심)",
        "C) git diff 보기 후 재결정"
    ])
    SWITCH choice:
        CASE "A":
            state.plan_sha256 = current_plan_sha
            state.sidecar_sha256 = current_sidecar_sha
            SAVE_STATE(state)
            RETURN True
        CASE "B":
            HALT("사용자 중단 — SHA mismatch")
        CASE "C":
            SHOW_DIFF(plan_path, state.plan_sha256, current_plan_sha)
            RETURN VERIFY_SHA_ON_RESUME(state, plan_path, sidecar_path, args)
```

---

## 6. plan.md 체크박스 + 종료 마무리

### 6.1 plan.md 체크박스 (PM 중앙 집중 관리)

Task `status = "done"` 마다 PM 이 plan.md 의 해당 라인을 `- [ ]` → `- [x]` 로 교체. **kiwi-coder 자식은 plan.md 직접 수정 금지** (중앙 집중 관리, race 회피).

**매칭 패턴** (RE2 multiline `^\s*-\s*\[\s*\]\s*(\*\*)?{task_id}\b`):

| plan.md 라인 | 매칭 | 교체 결과 |
|---|---|---|
| `- [ ] **T-PH001-01** ...` | YES | `- [x] **T-PH001-01** ...` |
| `- [ ] T-PH001-01: ...` | YES | `- [x] T-PH001-01: ...` |
| `- [ ] \`T-PH001-01\` ...` | YES | `- [x] \`T-PH001-01\` ...` |
| `- [x] ...` 이미 체크 | NO | 무변경 (idempotent) |
| TASK-ID 없는 line | NO | 경고 로그만 |

**체크박스 부재 폴백** (`{plan_id}.checklist.md`):

부팅 시 plan.md 의 TASK 체크박스 매칭률이 **<50%** 또는 **0건** 이면 외부 폴백 파일을 사용:

- interactive: 3지선다
  - (a) `{plan_id}.checklist.md` 자동 생성 (권장)
  - (b) 체크박스 없이 진행 (pm-state.json 으로만 추적)
  - (c) 중단 — 직접 plan.md 수정 후 재실행
- `--auto`: (a) 자동 선택

생성 형식:

```markdown
# {plan_id} — Phase Checklist

> PM 자동 생성 파일. plan.md 의 보조 뷰이며 정규 진행 상태는 `pm-state.json` 이 SSOT.
> 수동 수정 가능하지만 PM 재실행 시 덮어써질 수 있음.
> 생성: {ISO-8601} / plan 원본: {plan.md 파일명}

## Phase PH-001: {phase title}
- [ ] **T-PH001-01** {task title}
- [ ] **T-PH001-02** {task title}

## Phase PH-002: {phase title}
- [ ] **T-PH002-01** {task title}
...
```

**`.bak` 백업** — 매 갱신마다 `.md.bak` 자동 생성. `.gitignore` 권장: `*.md.bak`.

`--resume` 시 checklist.md 가 존재하고 sidecar.tasks 와 일치하면 재사용. TASK 추가/삭제 감지 시 경고 + 재생성 (interactive 확인 / `--auto` 자동).

git 관리는 사용자 책임. PM 은 자동 commit 하지 않음.

### 6.2 T-final SRS Status 마무리

**문제**: kiwi-coder 는 Task 단위로 `update_status(in_progress)` 만 호출. 한 REQ 가 여러 Task 로 trace 될 때 multi-Task REQ 의 `implemented` 승급 판단 불가 (자식 시야 한계). PM 이 모든 Task 완료 후 일괄 마무리.

**의사코드**:

```
FUNCTION T_FINAL_SRS_MUTATION(state, args):
    # 1. read REQ 현재 status
    reqs = MCP_CALL(list_requirements, target=state.target_slug, projection="compact")
    reqs_by_id = {r.id: r for r in reqs}

    # 2. REQ 별 trace Task 집계
    req_to_tasks = {}
    FOR task IN state.tasks:
        FOR req_id IN task.trace_req_ids:
            req_to_tasks.setdefault(req_id, []).append(task)

    # 3. proposals 생성 (forward-only)
    STATUS_ORDER = ["proposed", "planned", "in_progress", "implemented", "verified"]
    proposals = []
    FOR req_id, tasks IN req_to_tasks.items():
        req = reqs_by_id.get(req_id)
        IF NOT req: CONTINUE   # plan trace 에 없는 REQ — 무시

        all_done = ALL(t.status == "done" FOR t IN tasks)
        current_idx = STATUS_ORDER.index(req.status) IF req.status IN STATUS_ORDER ELSE -1
        target_idx = STATUS_ORDER.index("implemented")

        state.req_coverage[req_id] = {
            status_at_start: state.lifecycle_gate_state.status_snapshot.get(req_id, req.status),   # 부팅 T0 시점 Status
            status_at_end: req.status,                                                              # T-final read 직후 Status (mutation 적용 전)
            stability_at_start: state.lifecycle_gate_state.stability_snapshot.get(req_id),
            tasks: [t.task_id for t in tasks],
            all_done: all_done
        }

        IF all_done AND current_idx < target_idx AND current_idx >= 0:
            proposals.append({
                req_id: req_id,
                from: req.status,
                to: "implemented"
            })

    # 4. 사용자 승인 (--auto 면 자동, 단 backward transition 차단)
    IF proposals:
        IF NOT args.auto:
            choice = AskUserQuestion(
                f"T-final 제안: {len(proposals)} 개 REQ 를 implemented 로 승급?",
                details=proposals,
                options=["A) 적용", "B) skip (pending_mutations 로 보고서 적재)", "C) per-REQ 개별 확인"]
            )
            IF choice == "B":
                state.pending_mutations = proposals
                worklog.append({event: "t_final_user_skipped"})
                RETURN
            IF choice == "C":
                proposals = [p FOR p IN proposals IF AskUserQuestion(f"{p.req_id}: {p.from} → {p.to} 적용?") == "yes"]

        # 5. 실제 mutation (사전 guard → apply → 기록)
        #
        # speckiwi `update_status` MCP schema (SSOT): { id: string, status: string } — 그 외 인자 없음 (dryRun 미지원)
        # speckiwi `add_completed_work` MCP schema (SSOT):
        #   필수 { date: "YYYY-MM-DD", summary: string }
        #   선택 { requirementIds: string[], target?: string, scope?: string,
        #          reportPaths?: string[], allowIncomplete?: boolean, dryRun?: boolean }
        # → MCP 에 plan_id / run_id / tasks / kind / entries 같은 임의 필드 전달 불가.
        #   plan-summary 메타는 summary 텍스트에 인코딩하고, 보고서 파일은 reportPaths 로 전달.

        # 5a. backward transition 사전 guard — §0.G6
        #     (current_idx >= target_idx 인 proposal 은 §3 단계에서 이미 제외됐으므로 여기서는 forward 만 남는다.
        #      그래도 MCP 측에서 정책 변경으로 거부할 가능성에 대비해 catch.)

        # 5b. (선택) PM --dry-run 플래그: 실제 호출 대신 dryRun 옵션 전달
        is_pm_dry_run = (args.dry_run == True)

        FOR p IN proposals:
            TRY:
                # 5c. update_status 적용 (forward-only)
                IF is_pm_dry_run:
                    worklog.append({event: "t_final_dryrun_only", req_id: p.req_id, kind: "update_status"})
                ELSE:
                    MCP_CALL(update_status, id=p.req_id, status="implemented")
                state.final_mutations.append({
                    ts: NOW(),
                    kind: "update_status",
                    req_id: p.req_id,
                    from: p.from,
                    to: "implemented",
                    dry_run: is_pm_dry_run
                })

                # 5d. plan-summary completed-work entry — REQ 별 1회 호출
                #     speckiwi 표준 필드만 사용. plan 메타는 summary 본문에 인코딩.
                today = TODAY_DATE_YYYY_MM_DD()
                task_ids = req_to_tasks[p.req_id].map(t -> t.task_id)
                summary_text = (
                    f"[plan-summary] run_id={state.run_id} "
                    f"plan={state.plan_path} "
                    f"tasks={','.join(task_ids)} "
                    f"— plan 완주, {len(task_ids)} Task done"
                )
                report_path = state.report_path   # §6.3 보고서가 이미 작성됐다고 가정 (T-final 전 호출)

                MCP_CALL(add_completed_work,
                    date=today,
                    summary=summary_text,
                    requirementIds=[p.req_id],
                    target=state.target_slug,
                    reportPaths=([report_path] IF report_path ELSE []),
                    dryRun=is_pm_dry_run
                )
                state.final_mutations.append({
                    ts: NOW(),
                    kind: "add_completed_work_plan_summary",
                    req_id: p.req_id,
                    summary: summary_text,
                    dry_run: is_pm_dry_run
                })
            CATCH mcp_error AS e:
                # MCP 일시 미가용 / transition guard 거부 등
                state.pending_mutations = state.pending_mutations + [p]
                worklog.append({event: "t_final_mcp_error", req_id: p.req_id, error: str(e)})

        SAVE_STATE(state)
```

**MCP 호출 시그니처 SSOT (요약)**:

| 호출 | 필수 인자 | 선택 인자 | 비고 |
|---|---|---|---|
| `update_status` | `id, status` | — | 본 호출에 `dryRun` 옵션 없음. PM 의 --dry-run flag 시 호출 자체를 skip |
| `add_completed_work` | `date, summary` | `requirementIds, target, scope, reportPaths, allowIncomplete, dryRun` | `requirementIds[]` 로 다중 REQ 묶기 가능하지만, REQ 별 summary 가 다르므로 REQ 별 1회 호출 권장 |

**부분 실패 시**:
- 일부 Task 가 `failed` / `skipped` / `blocked` → 해당 REQ 의 `all_done == False` → `update_status` 호출 안 함 (해당 REQ 는 in_progress 또는 blocked 그대로 유지)
- `add_completed_work(plan-summary)` 도 skip (REQ 가 미완료인데 plan-summary append 는 오해 소지)
- 보고서 §6.3 에서 부분 완료 REQ 목록을 명시

**Stability 변경 / verified 승급**: PM 권한 아님. kiwi-srs-feasibility / kiwi-reviewer 영역.

### 6.3 종료 보고서 + doculight 표시

`.kiwi/sessions/{run_id}/reports/pm-{ts}.md` 작성. **8개 섹션**:

1. **요약** — 총 Task / done / skipped / failed / blocked / 소요 시간
2. **Task 별 결과** — task_id / status / coder_run_id / result_summary
3. **req_coverage 표** — REQ-ID / 진입 시 status / 종료 시 status / trace Task 목록 / all_done / verified 여부
4. **SRS mutation 로그** — `state.final_mutations` 시간순. `pending_mutations` 도 별도 명시 (MCP 미가용으로 보류된 항목, 사용자 수동 처리 안내)
5. **NEEDS_USER 이력** — severity 분포 + 발생 Task / 질문 본문 요약
6. **`--auto` 자동 해소 항목** (있을 때만)
7. **lifecycle gate 초기 차단 항목** — `state.lifecycle_gate_state.blocked_req_ids` + 사용자 선택 (A/B/C)
8. **checklist.md 사용 여부** — `생성 / 재사용 / 미사용` + 경로

**Stability drift 경고** (§4 종료 시 비교): `lifecycle_gate_state.stability_snapshot` vs 종료 시점 stability 비교. drift 발견 시 §1 또는 §4 섹션 끝에 경고 박스 추가 (의도된 변경일 수도 있어 차단 안 함, 단 보고서에 명시).

**doculight MCP 표시**:

```
FUNCTION DOCULIGHT_DISPLAY(report_path, args, state):
    IF args.no_doculight:
        worklog.append({event: "doculight_skip", reason: "--no-doculight"})
        RETURN

    IF NOT MCP_TOOL_AVAILABLE("mcp__doculight__open_markdown"):
        worklog.append({event: "doculight_skip", reason: "mcp_unavailable"})
        PRINT(f"보고서: {report_path}")   # fallback: 경로만 출력
        RETURN

    TRY:
        IF state.doculight_viewer_id:
            # --resume 후속 실행 — 기존 viewer 갱신
            MCP_CALL(mcp__doculight__update_markdown,
                     viewer_id=state.doculight_viewer_id,
                     file=report_path)
            worklog.append({event: "doculight_updated", viewer_id: state.doculight_viewer_id})
        ELSE:
            # 신규 viewer 열기
            result = MCP_CALL(mcp__doculight__open_markdown, file=report_path)
            state.doculight_viewer_id = result.viewer_id
            SAVE_STATE(state)
            worklog.append({event: "doculight_opened", viewer_id: result.viewer_id})
            PRINT(f"보고서 viewer 열림: viewer_id={result.viewer_id}")
    CATCH AS e:
        worklog.append({event: "doculight_skip", reason: f"call_failed: {e}"})
        PRINT(f"보고서: {report_path}")
```

doculight 호출은 best-effort. 실패해도 PM 정상 종료 흐름 유지 (보고서 마크다운은 디스크에 작성되어 있음).

### 6.4 kiwi-review-fix-loop 후속 권고 + 자동 시작 게이트

T-final mutation + 보고서 작성 + doculight 표시 완료 직후, 사용자에게 다음 안내:

> "본 plan 의 REQ status 가 `implemented` 로 승급되었습니다. 회귀 검증 + 까칠 리뷰를 거쳐 `verified` 로 닫으려면 `/kiwi-review-fix-loop --close-reqs` 를 호출하십시오."

`AskUserQuestion` 3지선다:
- `(1) 지금 자동 시작` — 메인 세션에서 `Skill(skill="kiwi-review-fix-loop", args="--close-reqs --auto")` 호출 (부모 PM 의 `--model` 활성 시 args 에 전파)
- `(2) 나중에 수동` — 안내만 출력하고 본 스킬 종료 (사용자가 직접 호출 시점 결정)
- `(3) skip` — verified 닫지 않음 (`implemented` 상태 유지)

`--auto` 모드 시: (1) 자동 채택 + severity 가드레일 — 직전 plan 실행 중 `failed_task_ids[]` 비어있지 않거나 NEEDS_USER severity=business-decision 이 critical 격상되어 HALT 잔존한 경우 (SSOT auto-option.md §4 conf<0.7 분기) (3) 자동 채택 (verified 닫기 부적합).

자동 시작 시 후속 review-fix-loop 의 종료 상태 (`closed_reqs.json`) 는 본 PM 보고서 §9 "후속 close 결과" 신규 섹션에 첨부 (review-fix-loop 종료 직후 갱신, best-effort).

본 §6.4 는 사용자 의도 (PM 종료 직후 review-fix-loop 자동 진입) 의 진입점. PM 의 mutation 책임 경계 외 (verified 전이) 는 review-fix-loop §6.6 에 위임 — PM 자체는 `update_status("verified")` 호출하지 않는다 (§0.12 mutation 분담 SSOT 불변).

---

## 7. 호환성 / 에러 처리 / 매핑

### 7.1 입력 무결성 게이트 (T-1)

| 실패 조건 | 동작 |
|---|---|
| PLAN_PATH 부재 또는 파일 없음 | HALT — "kiwi-planner 로 plan 먼저 작성하십시오" |
| `plan_contract ≠ "1.2.0"` | HALT — kiwi-coder §0.G3 동치 거부 + 재실행 권고 |
| `schema_version ≠ "1.1.0"` | HALT |
| `tdd_policy = "disabled"` | HALT — TDD 강제 정책 |
| sidecar.json parse 실패 | HALT — validator.mjs 재실행 권고 |
| sidecar.tasks 빈 배열 또는 부재 | HALT — 실행할 Task 없음 |
| `task_id` / `phase_id` / `run_id` 정규식 위반 (§0.14) | HALT |
| `validator.json` 존재 + `exit_code != 0` | WARN + 사용자 진행 동의 |
| frontmatter `sidecar_path` ↔ 실제 경로 불일치 | WARN + 실제 경로 사용 |

### 7.2 런타임 에러

| 상황 | 대응 |
|---|---|
| Agent 자식 timeout | 2회 재시도 후 FAILED → 3지선다 (§0.G4) |
| 자식 JSON 파싱 실패 | 1회 재spawn 시 "단일 JSON 만" 강조 재주입, 실패 시 FAILED |
| 자식이 빈 응답 / 산문만 반환 | JSON 파싱 실패와 동일 처리 |
| `pm-state.json` 손상 (parse error) | `.bak` 복구 시도 → 실패 시 사용자 동의 후 새 상태 생성 |
| MCP 미가용 (lifecycle gate read) | speckiwi CLI fallback → 둘 다 실패 시 사용자 진행 동의 또는 `--auto` HALT (§4.4) |
| MCP 미가용 (T-final update_status) | `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내 |
| `update_status` transition guard 거부 (MCP 응답 reject) | catch → `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내. 강제 우회 없음. (`update_status` MCP 에 dryRun 옵션 없음 — 사전 시뮬레이션 불가, 호출 시점에 거부 가능성 catch) |
| 자식이 `update_status` backward 시도 | kiwi-coder §0.G5 자체 차단. PM 무대응 |
| `--auto` + business-decision NEEDS_USER | 서브에이전트 자동 결정 (conf ≥ 0.7 채택, 미만 시 critical 격상 HALT — SSOT auto-option.md §4). §0.G7 critical_gates 매칭 시 즉시 HALT |
| `--auto` + lifecycle gate `draft` | 자동 HALT (§5.1 예외) |
| plan/sidecar SHA256 mismatch on `--resume` | 사용자 게이트 3지선다 (§5.4). `--auto` 면 HALT |
| `pm.lock` 30분 stale | 자동 해제 + 경고 log |
| `pm.lock` 다른 host 활성 | 명시적 차단 (`--force` 필요) |
| Task `status="running"` 잔존 on `--resume` | `pending` 으로 복구 + 사용자 확인 (interactive) / `--auto` 자동 복구 |

### 7.3 snoworca-pm → kiwi-pm 매핑

| snoworca-pm | kiwi-pm | 비고 |
|---|---|---|
| `plan-contract-v1.0/1.1` dual-read | `plan_contract = "1.2.0"` + sidecar.json | sidecar JSON 단일, validator.mjs 통과 의무 |
| `phases[]` spawn 단위 | **`tasks[]` spawn 단위** | Task 1:1 격리 (§0.7) |
| `--headless` (claude CLI subprocess) | **제거** | 모든 spawn 이 `Agent` 도구 단일 모드 (§0.15) |
| T1/T2/T3 forbidden_patterns 게이트 | **제거** | `Agent` 도구의 권한 모델 자체 제공, 외부 강제 불필요 |
| ENV_WHITELIST / SANITIZE_USER_ANSWERS / PARSE_SENTINEL | **제거** | subprocess 부재로 무용 |
| process group 격리 / Windows CTRL_BREAK_EVENT | **제거** | subprocess 부재 |
| `_shared/snoworca/` 모듈 import | **금지** | 로직만 차용, 실행은 본 스킬 내부 (§0.3) |
| python-fix-hook self-heal | **제거** | subprocess Python 호출 없음 |
| §11.5 Phase와 Task 휴리스틱 | **제거** | 항상 Task |
| §11.6 비용 추적 (claude CLI usage) | **제거** | Agent 도구는 usage 노출 안 함 — v0.2 후보 |
| §15 plan.md 체크박스 + §15.8 checklist.md 폴백 | **유지** | 매칭 패턴 그대로 (§6.1) |
| 3상태 프로토콜 (PHASE_DONE/NEEDS_USER/FAILED) | **유지** (`TASK_DONE`) | severity 3종 동일 |
| `--auto` severity 가드레일 | **유지** (시맨틱 변경) | enum 3종 유지. business-decision = 서브에이전트 자동 결정 (SSOT auto-option.md §4 / §11 마이그레이션) |
| `--resume` / `--from-phase` | **유지** (`--from-task`) | task_id 기반 |
| `--max` / `--ultra` / `--no-self-heal` | **제거** | `--model` 만 도입 (kiwi 시리즈 표준) |
| `RESUME_FROM` 4지선다 (FAILED 분기) | **간소화 3지선다** | kiwi-coder 가 `partial_progress` 미보고. v0.2 후보 |
| `mode = "headless"/"interactive"` | **단일 모드** | interactive 만 |
| lifecycle gate (Stability) | **신규** | Stability 라이프사이클 게이트 (§4) |
| 종료 T-final REQ status 마무리 | **신규** | kiwi-pm 의 핵심 부가가치 (§6.2) |
| doculight 보고서 표시 | **신규** | MCP 가용 시 (§6.3) |

### 7.4 Out of Scope (v0.1)

- PRD / SRS / feasibility / planner / coder 자체 호출 (각각 kiwi-prd, kiwi-srs, kiwi-srs-feasibility, kiwi-planner, kiwi-coder 영역)
- 구현 리뷰 (kiwi-reviewer 영역, 미구현)
- 풀 파이프라인 오케스트레이션 (별도 kiwi-pipeline 향후 스킬)
- Stability 변경 (kiwi-srs-feasibility / kiwi-reviewer)
- verified 승급 (kiwi-reviewer 영역)
- `--headless` 모드 (Agent 도구 단일 모드 정책)
- 비용 / 토큰 추적 (Agent 도구 usage 노출 후 검토)
- 병렬 Task spawn (`depends_on` 독립 Task 동시 실행, v0.2 후보)
- 멀티 plan 동시 실행 (`pm.lock` 의도)
- snoworca 시리즈 호출 (CLAUDE.md / .skillfactory CLAUDE.md 금지)

### 7.5 v0.2 후보

- `--headless` 부활 (claude CLI subprocess + 안전 게이트 복원, 별도 스킬 분리 가능)
- 비용 추적 (Agent usage 노출 시 또는 doculight 보고서에 통합)
- kiwi-coder `partial_progress.last_completed_stage` 보고 → FAILED 분기 4지선다 확장
- `depends_on` DAG 분석 후 독립 Task 병렬 spawn (Race 안전성 사전 검증 필요)
- snoworca-pm 등의 기존 `.snoworca/sessions/` state 마이그레이션 도우미
- `task.requires_human_approval` / `task.owns` (semantic ownership) 휴리스틱 — kiwi-planner sidecar schema 가 해당 필드 도입 시 §3.5 에 재활성화. 현재 sidecar `Task` interface 에는 미존재하여 v0.1 에서 제외 (path 기반 휴리스틱으로 일부 보완 가능)

---

## 8. 호출 예시

```bash
# 기본 실행 (interactive)
/kiwi-pm PLAN_PATH=docs/plans/2026-05-19.kiwi-pm.v0-1.plan.md

# 자동 모드 + 비용 절감
/kiwi-pm PLAN_PATH=docs/plans/...plan.md --auto --model claude-sonnet-4-6

# 이전 세션 재개
/kiwi-pm PLAN_PATH=docs/plans/...plan.md --resume

# 디버깅: 특정 Task 부터 실행
/kiwi-pm PLAN_PATH=docs/plans/...plan.md --from-task=T-PH002-03

# stale lock 강제 해제 후 재개
/kiwi-pm PLAN_PATH=docs/plans/...plan.md --resume --force

# doculight 끄고 자동 실행 (CI 환경 등)
/kiwi-pm PLAN_PATH=docs/plans/...plan.md --auto --no-doculight

# SIDECAR_PATH 명시 (plan.md frontmatter 추론 실패 시)
/kiwi-pm PLAN_PATH=docs/plans/...plan.md SIDECAR_PATH=docs/plans/...plan.json
```

---

## 9. 설계 요약

`/kiwi-pm` v0.1 은 plan-contract=1.2.0 + sidecar TDD plan 을 입력으로 받아 **각 Task 를 `Agent` 도구로 kiwi-coder 자식을 격리 spawn** 하는 coder-loop runner. PM 책임 6항:

1. **부팅 lifecycle gate** — speckiwi `list_requirements` read, Stability ∈ {evolving, stable} 만 진행 허용 (§4)
2. **Task 순차 spawn + 3상태 프로토콜** — `Agent` 자식 결과를 TASK_DONE / NEEDS_USER / FAILED 로 분기 (§3)
3. **`--auto` severity 가드레일** — clarification 자동 / business-decision 서브에이전트 자동 결정 (conf ≥ 0.7 채택, 미만 시 critical 격상) / rollback-confirmation 자동 승인 (§5.1, SSOT auto-option.md §4)
4. **plan.md 체크박스 + checklist.md 폴백** — 중앙 집중 관리, 자식 수정 금지 (§6.1)
5. **T-final REQ status 마무리** — 모든 trace Task done 인 REQ 에 한해 `update_status(id, "implemented")` 일괄 + `add_completed_work(date, summary, requirementIds, target, reportPaths)` (§6.2)
6. **보고서 작성 + doculight MCP 표시** — 8섹션 마크다운 + (가용 시) `open_markdown` (§6.3)

### MCP 호출 분담 표 (speckiwi 실제 schema)

| 호출 | 호출자 | 시점 | 시그니처 |
|---|---|---|---|
| `get_active_target` (read) | **kiwi-pm** | T0 lifecycle gate | `{}` |
| `list_requirements` (read) | **kiwi-pm** | T0 / T-final | `{target?, status?, stability?, scope?, tag?, type?}` |
| `add_trace_link` | kiwi-coder (자식) | Task 종료 시 (Code anchor) | `{id, type, reference, relation, [notes]}` (flat) |
| `add_verification_evidence` | kiwi-coder (자식) | Task 종료 시 | `{id, type, reference, [covers, notes]}` |
| `update_status(in_progress)` | kiwi-coder (자식) | Task 시작 시 | `{id, status: "in_progress"}` |
| `add_completed_work` (Task 수준 요약) | kiwi-coder (자식) | Task 종료 시 — DoD/test 증거 | `{date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun]}` |
| `update_status("implemented")` | **kiwi-pm** | T-final, 모든 trace Task done 시 (조건부, forward-only) | `{id, status: "implemented"}` (dryRun 인자 없음) |
| `add_completed_work(plan-summary)` | **kiwi-pm** | T-final, plan 단위 요약 메타 entry |
| `mcp__doculight__open_markdown` / `update_markdown` | **kiwi-pm** | T-final 보고서 작성 직후 (가용 시) |

**규모 축소**: snoworca-pm 1907 줄 → kiwi-pm v0.1 ~ 800 줄. `--headless` / T1/T2/T3 forbidden_patterns / ENV_WHITELIST / sentinel parser / Python self-heal / Phase와 Task 휴리스틱 / 비용 추적 모두 제거.

---

## 10. Pipeline event emit (의무)

`~/.claude/skills/_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

**자식 emit 흡수 책임**: kiwi-pm 이 자식(`kiwi-coder`) 을 spawn 하는 경우 자식은 자체 emit 하지 않는다 (§7 자식 컨텍스트 SSOT). 본 스킬이 plan 전체 종료 시 1줄로 통합 emit.

- `skill`: `"kiwi-pm"`
- `status`: 모든 Task 완료 + T-final mutation 성공 = `TASK_DONE`; business-decision 버블업 = `NEEDS_USER`; Task FAILED 잔존 = `FAILED`
- `next_hint`: 통상 `"kiwi-review-fix-loop"` (`--close-reqs` 검증 권고). commit 은 review-fix-loop 통과 후 `kiwi-review-fix-loop` 의 `next_hint` 로 진행
- `req_ids`: T-final 에서 `update_status("implemented")` 호출한 REQ-ID 배열
- `artifacts.plan_file`: 입력 plan.md 경로
- `artifacts.sidecar_file`: 입력 sidecar.json 경로
- `artifacts.analysis_dir`: `.kiwi/sessions/{run-id}/`
- `notes`: Task 통계 ("total:8 done:7 skipped:1 failed:0") + plan-summary entry id 권장

emit 실패는 best-effort.
