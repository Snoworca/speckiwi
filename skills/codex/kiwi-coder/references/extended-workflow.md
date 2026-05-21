# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 6. Phase 3 — Task 종료 처리
- 6.1 회귀 테스트 (§0.13 의무)
- 6.2 MCP mutation 4종 batch
- 6.3 .kiwi 상태 갱신
- 6.4 다음 task 진입
- 7. .kiwi/ 상태 스키마 SSOT
- 7.1 state.json 스키마
- 7.2 tasks/{task-id}.json 스키마
- 7.3 worklog.jsonl 이벤트 enum (21종) 및 호출 사이트
- 7.4 재개 (`--resume`) 로직
- 8. 통합 테스트 (Phase 4, 선택)
- 8.1 조건
- 8.2 플로우 (snoworca-coder §5 차용)
- 8.3 최종 보고서
- 9. 호출 예시
- 10. Out of Scope
- 11. v0.x → v1.0 마일스톤 (예고)
- 12. Pipeline event emit (의무)

---

## 6. Phase 3 — Task 종료 처리

### 6.1 회귀 테스트 (§0.13 의무)

**6.1.1 영향받는 테스트 (항상 실행)**:
- sidecar.tasks[t].files[] 의 각 파일이 의존되는 test 파일을 정적 추론 (import graph / require / package 동일성)
- 추론 어려운 경우 fallback: 최근 1주일 내 수정된 모든 test 파일

**6.1.2 전체 회귀 스위트 (--skip-regression 부재 시)**:
- 프로젝트 표준 명령 (`npm test`, `pytest`, `cargo test`, `go test ./...` 등) 자동 감지
- 실행 시간 추정 ≥10분 시 사용자 동의 게이트 (`--yes-all`/`--auto-cost-warning` skip)
- 결과를 `docs/analysis/kiwi-coder-{run-id}/regression_run.jsonl` 에 append

**6.1.3 회귀 발견 시 처리**:
- 해당 task 가 만든 변경이 기존 test 를 깬 경우 → CRITICAL + (Phase 2.c) 재진입
- 2회 연속 동일 파일 회귀 → §0.G4 발동 + state.failed_task_ids[] 등재
- 외부 모듈 (cwd 외부) 실패 → WARN 만, 차단 안 함

### 6.2 MCP mutation 4종 batch

**평탄화 의무 — sidecar nested → MCP flat 변환은 coder 책임**:

sidecar `tasks[].trace_links[]` 는 nested schema (`{source:{type,id}, target:{type,reference}, relation}`) 로 작성되어 있다. 동일하게 sidecar `mcp_call_log[].args` (planner 가 dry-run 시뮬레이션으로 적재한 entry) 도 nested 표현. 그러나 speckiwi MCP 실 호출 schema 는 **flat** 이므로, 본 §6.2 mutation 호출 직전에 반드시 평탄화해야 한다. nested 표현 그대로 호출 시 speckiwi MCP 가 임의 필드로 거부 → mutation 실패. 변환 매핑 SSOT 는 kiwi-planner §9.5 line 604-613 "sidecar nested ↔ 실 MCP flat 변환 매핑" 표 참조.

평탄화 예 (add_trace_link):
```
sidecar.tasks[].trace_links[i]            →  MCP add_trace_link args (flat)
  source: {type: "Task", id: "T-PH001-02"}    id: <REQ id from target.reference>
  target: {type: "Requirement", reference:    type: <task type 매핑 또는 "Code">
           "FR-X-001"}                         reference: <task.files[].path:line_range 또는
  relation: "implements"                                   source.id (task id)>
                                              relation: "implements"
```

**시그니처 SSOT — speckiwi MCP 실제 schema 기준** (호출 인자는 flat 객체. 임의 필드 추가 금지 — 메타 정보는 summary 텍스트 또는 reportPaths 에 인코딩):

```
1. add_trace_link (Code anchor — 선택)
   args: { id: "FR-X-001",                         # REQ id
           type: "Code",                            # target type
           reference: "src/x.ts:45-67",             # target reference (path:line_range)
           relation: "implements",                  # 관계
           [notes: "..."] }                         # 선택
   조건: sidecar.task.files[].line_range 가 모든 변경 파일에 존재할 때만 호출.
         REQ 1개당 변경 파일별 1건 (REQ id × file 개수).

2. add_verification_evidence (type=test)
   args (각 PASS 한 test_case 별 1건):
   { id: "FR-X-001",                                # REQ id
     type: "test",
     reference: "tests/x.test.ts#TC-REQ-FR-X-001-AC1-01",
     [covers: "AC-1", notes: "..."] }               # 선택 — covers 는 AC id 명시 권장

3. update_status
   args: { id: "FR-X-001", status: <전이값> }       # dryRun 인자 없음 (호출 시점 적용)
   전이 규칙:
   - Task 시작 시 → "in_progress" (kiwi-coder 권한)
   - 해당 REQ 의 모든 ac 가 green_evidence 보유 + acceptance_tests 통과 → "verified"
   - 일부 ac 만 pass → "implemented"
   - 회귀 발생 → "blocked"
   - 기존 status 보다 backward 면 §0.G5 자체 차단 (호출 안 함)

4. add_completed_work — Task 종료 시 1건 (Task 단위 요약)
   args: { date: "YYYY-MM-DD",                      # 필수 (today)
           summary: "<Task title + green 결과 + DoD 요약>",  # 필수, task_id / files / dod 정보 인코딩
           [requirementIds: ["FR-X-001", ...],      # task.req_ids
            target: "<active target slug>",
            scope: "<scope id>",
            reportPaths: ["<repo-relative POSIX path>"],   # 선택 — 보고서/test log
            allowIncomplete: false,
            dryRun: <--dry-run 플래그 전파>] }

   summary 인코딩 예:
     "[task] T-PH001-02 — login 에러 메시지 개선. green=PASS (5/5 TC).
      files: src/auth/login.ts, tests/auth/login.test.ts.
      dod: ['에러 메시지 정확', '로그 마스킹']"

   ⚠️ speckiwi schema 에 task_id / req_ids / files_changed / dod_checklist / completed_at 같은
      임의 필드 직접 전달 불가. summary 텍스트에 인코딩하거나 reportPaths 로 detail md 첨부.
```

각 호출은 state.json `mcp_call_log[]` 에 `{tool, args, args_hash: sha1(canonicalJson(args)), ok, response_hash, dry_run, called_at}` append. 동일 args_hash 중복 호출 skip (멱등).

`--dry-run` 시 mutation 4종 모두 호출 skip + `mcp_call_log[]` 에 `dry_run: true` 만 기록. `add_completed_work` 는 schema 가 `dryRun` 옵션을 직접 지원하므로 호출 자체는 시도하고 `dryRun:true` 인자 전달 (실 적용 없음). 다른 3종 (`add_trace_link` / `add_verification_evidence` / `update_status`) 은 dryRun 옵션이 없으므로 호출 자체를 skip.

### 6.3 .kiwi 상태 갱신

```
state.json:
  - completed_task_ids[] += [t]
  - current_task_id = null (다음 task 진입 직전 갱신)
  - mcp_call_log[] += (위 호출들)
  - updated_at = ISO-8601
  - next_resume_hint = null

tasks/{task-id}.json: 전체 task 실행 기록 (TDD draft → review → impl → green → mutation 까지 모두)

worklog.jsonl 이벤트:
  - task_done { task_id, phase_id, green: true, regression: "pass"|"partial"|"skip", duration_ms }
```

state.json 쓰기는 atomic (tmp → rename). 쓰기 실패 시 `.kiwi/logs/append-errors.log` 에 기록 + 사용자 알림 (다음 task 진입 차단).

### 6.4 다음 task 진입

큐가 비어있지 않으면 Phase 1.1 로 복귀. 비어있으면 Phase 4.

---

## 7. .kiwi/ 상태 스키마 SSOT

### 7.1 state.json 스키마

```json
{
  "schema_version": "1.0.0",
  "run_id": "2026-05-19.skf.v01.coder-0519",
  "plan_run_id": "2026-05-19.skf.v01",
  "plan_path": "docs/plans/2026-05-19.skf.v01.plan.md",
  "sidecar_path": "docs/plans/2026-05-19.skf.v01.sidecar.json",
  "target": "skf-v0.1",
  "mode": "normal|max|reviewer-off|squirrel|dry-run",
  "flags": ["--max"],
  "started_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "frozen_at": null,

  "current_phase_id": "PH-001",
  "current_task_id": "T-PH001-02",
  "next_resume_hint": "phase-2.c (impl)|phase-1.2 (tdd-review)|phase-3.1 (regression)|...",

  "task_queue": ["T-PH001-02", "T-PH001-03", "T-PH002-01"],
  "completed_task_ids": ["T-PH001-01"],
  "skipped_task_ids": [],
  "failed_task_ids": [],
  "tdd_exempted_task_ids": [],
  "tdd_pending_task_ids": [],

  "severity_counters": {
    "T-PH001-02": {
      "phase1": {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 0, "LOW": 0, "rounds": 1},
      "phase2": {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 1, "LOW": 0, "rounds": 0}
    }
  },

  "regression_summary": {
    "last_run_at": "ISO-8601",
    "scope": "full|impacted-only|skipped",
    "passed": 142, "failed": 0,
    "regressed_files": []
  },

  "mcp_call_log": [
    {
      "called_at": "ISO-8601",
      "tool": "add_verification_evidence",
      "args": { "...": "원본" },
      "args_hash": "sha1...",
      "ok": true,
      "response_hash": "sha1...",
      "dry_run": false,
      "task_id": "T-PH001-01"
    }
  ],

  "pending_mutations": [],

  "tool_versions": {
    "kiwi_planner": "0.6.0",
    "kiwi_coder": "0.1.0",
    "speckiwi": "2.2.3"
  }
}
```

### 7.2 tasks/{task-id}.json 스키마

```json
{
  "task_id": "T-PH001-02",
  "started_at": "...",
  "completed_at": null,
  "phase1": {
    "tdd_draft_iters": [{"iter": 1, "file_paths": [...]}],
    "standard4_reviews": [
      {"iter": 1, "intent_alignment": {...}, "tech_quality": {...}, "req_mapping": {...}, "red_verification": {...}}
    ],
    "red_evidence": { "...": "Phase 1.5 결과" }
  },
  "phase2": {
    "impl_iters": [{"iter": 1, "files_changed": [...], "loc_added": N, "loc_removed": M}],
    "formal_reviews": [{"iter": 1, "findings": [...]}],
    "prickly_reviews": [{"iter": 1, "findings": [...]}],
    "green_evidence": { "...": "Phase 2.i 결과" },
    "dod_check": [{"item": "...", "satisfied": true}]
  },
  "phase3": {
    "regression": {"scope": "full", "passed": 142, "failed": 0},
    "mcp_calls": [...]
  }
}
```

### 7.3 worklog.jsonl 이벤트 enum (21종) 및 호출 사이트

각 이벤트는 본문 명시 단계 종료 직후 append 의무.

| event | append 위치 | payload |
|---|---|---|
| `phase_start` | §3.2 .kiwi init 완료 직후 | { run_id, plan_path, target, mode, flags } |
| `task_start` | §4.1.1 task pop 직후 | { task_id, phase_id } |
| `tdd_exempted` | §4.1.2 TDD 면제 결정 시 | { task_id, reason } |
| `tdd_draft_done` | §4.1.3 테스트 작성 완료 후 | { task_id, iter, file_paths[] } |
| `tdd_review_done` | §4.2 standard×4 결과 통합 후 | { task_id, iter, severity_summary } |
| `tdd_red_confirmed` | §4.4 red 확정 후 | { task_id, exit_code, test_case_ids[] } |
| `impl_done` | §5.1.(c) 시니어 구현 완료 후 | { task_id, iter, files_changed[] } |
| `formal_review_done` | §5.1.(e) 정형 검사 완료 후 | { task_id, iter, severity_summary } |
| `prickly_review_done` | §5.1.(f) 까칠 리뷰 완료 후 | { task_id, iter, severity_summary } |
| `test_green` | §5.1.(h) green 확정 후 | { task_id, exit_code } |
| `test_fail` | §5.1.(h) fail 시 ((g) 루프 직전) | { task_id, exit_code, failed_test_case_ids[] } |
| `regression_done` | §6.1.2 회귀 스위트 종료 후 | { task_id, scope, passed, failed } |
| `mcp_call` | §6.2 각 mutation 호출 직후 | { task_id, tool, ok } |
| `task_done` | §6.3 task 종료 처리 후 | { task_id, duration_ms } |
| `task_failed` | §0.G4 4옵션 abandon 또는 §6.1.3 회귀 2연속 시 | { task_id, cause, severity } |
| `need_user` | Codex clarification gate 호출 직후 | { task_id, reason, options[] } |
| `checkpoint` | `/clear` 사전 또는 사용자 요청 시 강제 1회 | { task_id, resume_hint } |
| `phase_end` | §8 통합 테스트 완료 (skip 포함) 후 | { run_id, summary } |
| `req_tag_exempted` | §0.17.2 면제 적용 시 (Phase 2.c) | { task_id, member_path, reason_enum_id, raw_reason? } |
| `req_tag_position_ambiguous` | §0.17.4 append 위치 모호 시 (Phase 2.c) | { task_id, member_path } |
| `req_tag_missing_observed` | §0.17.7 시니어 코더 자기 점검 (Phase 2.c, 정보성, 선택) | { task_id, member_path } |

### 7.4 재개 (`--resume`) 로직

**resume_hint enum SSOT** (13종, 위반 시 차단):
`phase-1.1` (tdd-draft) / `phase-1.2` (tdd-review) / `phase-1.3` (tdd-improve) / `phase-1.4` (red-confirm) / `phase-2.a` (depends-check) / `phase-2.b` (mock-scan) / `phase-2.c` (impl) / `phase-2.d` (plan-code-match) / `phase-2.e` (formal-review) / `phase-2.f` (prickly-review) / `phase-2.h` (test-green) / `phase-3.1` (regression) / `phase-3.2` (mcp-mutation).

1. state.json 의 `current_task_id` 와 `next_resume_hint` 읽음
2. resume_hint 가 가리키는 단계로 직접 점프 (예: `phase-2.c` → 시니어 구현 재시작)
3. 이전 단계 산출물 (test 파일, 변경된 코드) 은 그대로 유지 — 멱등성:
   - `phase-1.1`: test 파일 SHA256 비교, 변경 없으면 skip
   - `phase-2.c`: 시니어 코더에게 "이전 시도 코드는 디스크에 있음, 검토 후 다음 라운드 작성" 지시
   - `phase-3.1`: 회귀 결과가 24시간 이내면 재사용 (사용자 동의)
4. resume_hint 가 enum 외 값이면 차단 + 사용자에게 state.json 수동 수정 권고

---

## 8. 통합 테스트 (Phase 4, 선택)

### 8.1 조건

- 모든 task 가 completed_task_ids[] 에 진입
- `--skip-integration` 부재
- 사용자 동의 (`--auto-integration`/`--yes-all` skip)

skip 시(`--skip-integration` 명시 또는 사용자 거부)에도 **§8.3 최종 보고서는 항상 생성**. 보고서 §8 (통합 테스트 보고서) 섹션은 "skipped: {reason}" 으로 채움.

### 8.2 플로우 (snoworca-coder §5 차용)

1. 의도 추출 (target goal + REQ 전체 AC 합집합)
2. 통합 테스트 작성 (high-reasoning 시니어, Phase 간 연계 / end-to-end / 경계)
3. 정형 + 까칠 리뷰 (Phase 2.e/f 동일)
4. 개선 루프 (심각도 카운터, 통합 시도 단위)
5. 실행 → 실패 시 관련 Phase 역순 재진입 (최대 3회)
6. 4회차 진입 직전 4지선다: 중단 / 추가 1회 / REWORK 모드 (delta 생성 후 kiwi-planner 재호출 권고) / kiwi-srs-research 호출

### 8.3 최종 보고서

`cwd/.kiwi/sessions/{run-id}/reports/coder-{run-id}.md`:

frontmatter:
```yaml
---
run_id: ...
plan_run_id: ...
target: ...
last_phase: phase-N | done
last_task: T-PHnnn-mm | null
next_skill: kiwi-coder (잔존 task 있음) | kiwi-srs-research (검증 필요) | null
state_ref: ./state.json
---
```

본문 9개 섹션 (snoworca-coder §8.2 와 동일 구조):
1. 사용된 플래그 + 비용 배수
2. Phase별 Task 완료 상태 + TDD 적용/면제 통계
3. 계획-코드 매핑 결과
4. standard×4 TDD 검증 통계 (round별)
5. 까칠 리뷰 findings 통계 (severity별)
6. 테스트 결과 (task별 + 통합)
7. 회귀 결과 (passed/failed/regressed 파일)
8. MCP mutation 요약 (4종별 호출 수)
9. 메타 (mode, 실측 토큰 추정, 총 소요 시간)

---

## 9. 호출 예시

```
$kiwi-coder
$kiwi-coder PLAN_PATH=docs/plans/2026-05-19.skf.v01.plan.md
$kiwi-coder PLAN_PATH=... TASK_FILTER=T-PH001-01,T-PH001-02
$kiwi-coder PLAN_PATH=... PHASE_FROM=2 PHASE_TO=3
$kiwi-coder PLAN_PATH=... --max
$kiwi-coder PLAN_PATH=... --reviewer-off --skip-regression
$kiwi-coder PLAN_PATH=... --squirrel
$kiwi-coder PLAN_PATH=... --resume
$kiwi-coder PLAN_PATH=... --dry-run
```

---

## 10. Out of Scope

| 범위 밖 | 담당 스킬 |
|---|---|
| 계획 생성 | `kiwi-planner` |
| SRS/요구사항 작성 | `kiwi-srs` |
| 구현 후 간극 검토 | (예정) `kiwi-reviewer` |
| 실현가능성 사전 판단 | `kiwi-srs-feasibility` |
| 외부 도구 비교 / 학습 | `kiwi-srs-research` |
| PR/이슈 생성 | 본 스킬은 코드 변경만; PR 은 사용자 결정 |
| git commit / push | 사용자 결정 (시그니처 금지 §0.10) |

---

## 11. v0.x → v1.0 마일스톤 (예고)

- v0.2: `--pm-child` 헤드리스 자식 모드 (kiwi-pm 등장 시)
- v0.3: 통합 테스트 단계 자동 회귀 분배 강화
- v0.4: `--imt` (계획 없이 즉시 코딩) 재도입 검토 (TDD 강제 유지)
- v1.0: snoworca-coder 의 모든 호환 채널 제거 확정

---

## 12. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

**호출 컨텍스트별 정책**:
- **단독 호출 (사용자 직접)**: 본 스킬이 emit. `skill: "kiwi-coder"`, `next_hint`: 통상 `"kiwi-commit-auto-push"`.
- **kiwi-pm 자식으로 spawn**: 본 스킬은 emit 하지 않는다 — 부모(`kiwi-pm`) 의 Task 종료 시 부모가 일괄 emit. 자식의 결과는 부모의 보고에 인용.

- `req_ids`: 본 Task 가 영향을 미친 REQ-ID 배열
- `artifacts.analysis_dir`: `docs/analysis/kiwi-coder-{run-id}/` 또는 `.kiwi/sessions/{run-id}/`
- `status`: TDD green + 회귀 PASS = `TASK_DONE`; business-decision = `NEEDS_USER`; 회귀 실패 = `FAILED`

emit 실패는 best-effort.
