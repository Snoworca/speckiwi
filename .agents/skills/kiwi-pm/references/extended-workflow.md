# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 4. Lifecycle Gate (kiwi-pipeline-v1 §4.2)
- 4.1 차단 분류
- 4.2 interactive 3지선다 (draft 차단 시)
- 4.3 `--auto` 동작
- 4.4 MCP 미가용 fallback
- 4.5 의사코드
- 5. `--auto` decision worker + 재개 + 부분 재실행
- 5.1 severity policy
- 5.2 NEEDS_USER 재spawn 상한 (§0.G3 재기재)
- 5.3 FAILED 3지선다 (§0.G4 재기재)
- 5.4 `--resume` 동작
- 5.5 `--from-task=T-PH001-XX`
- 5.6 의사코드
- 6. plan.md 체크박스 + 종료 마무리
- 6.1 plan.md 체크박스 (PM 중앙 집중 관리)
- Phase PH-001: {phase title}
- Phase PH-002: {phase title}
- 6.2 T-final SRS Status 마무리
- 6.3 종료 보고서 + doculight 표시
- 7. 호환성 / 에러 처리 / 매핑
- 7.1 입력 무결성 게이트 (T-1)
- 7.2 런타임 에러
- 7.3 snoworca-pm → kiwi-pm 매핑
- 7.4 Out of Scope (v0.1)
- 7.5 v0.2 후보
- 8. 호출 예시
- 9. 설계 요약
- MCP 호출 분담 표 (speckiwi 실제 schema)
- 10. Pipeline event emit (의무)

---

## 4. Lifecycle Gate (kiwi-pipeline-v1 §4.2)

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

- `draft` 차단 → 자동 HALT (business-decision 영역, 자동 우회 금지)
- `deprecated` / `frozen` → 즉시 HALT (정책 위반 / 의도된 제거)
- target 비어있음 → HALT
- `--auto --skip-lifecycle-gate` 조합은 §1.3 에서 차단

### 4.4 MCP 미가용 처리

1. `list_requirements(target, projection: "compact")` 호출 시도
2. 실패 시 정상 SRS read 가 불가능하므로 HALT. CLI 는 설치/버전/설정 진단과 MCP 복구 안내에만 사용하고 lifecycle gate 대체 판정에 사용하지 않는다.
3. 평가 결과는 `state.lifecycle_gate_state.stability_snapshot` 에 저장 (REQ-ID → stability)

### 4.5 의사코드

```
FUNCTION APPLY_LIFECYCLE_GATE(plan, sidecar, state, args):
    IF args.skip_lifecycle_gate:
        worklog.append({event: "lifecycle_override", reason: "--skip-lifecycle-gate"})
        RETURN

    # 1. 활성 target 확인
    target = MCP_CALL("get_active_target")
    IF MCP unavailable:
        HALT("speckiwi mcp unavailable; CLI is diagnostics/remediation only")
    IF NOT target:
        HALT("활성 target 없음. speckiwi set_active_target 으로 지정 후 재실행")
    IF target != state.target_slug AND state.target_slug:
        Codex clarification gate(f"plan target={state.target_slug} vs 활성 target={target} 불일치 — 진행?")

    # 2. REQ-ID 집계
    req_ids = UNIQUE([t.req_id FOR task IN sidecar.tasks FOR t IN (task.traces OR [])])
    IF NOT req_ids:
        worklog.append({event: "lifecycle_gate_no_traces", reason: "sidecar tasks lack traces"})
        RETURN   # trace 없는 plan 은 lifecycle gate 대상 아님 (kiwi-planner 가 traces 의무 위반한 경우)

    # 3. 일괄 read
    TRY:
        reqs = MCP_CALL(list_requirements, target=target, projection="compact")
    CATCH mcp_unavailable:
        HALT("speckiwi mcp unavailable; CLI is diagnostics/remediation only")

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
        choice = Codex clarification gate("draft REQ 차단", options=[
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

## 5. `--auto` decision worker + 재개 + 부분 재실행

### 5.1 severity policy

| severity | `--auto` 동작 | interactive 동작 |
|---|---|---|
| `clarification` | `../../_shared/kiwi/auto-option.md` decision worker 또는 `default_if_auto` fast path | 사용자에게 옵션 제시 |
| `business-decision` | critical_gates[] 가 아니면 decision worker 판단. confidence 미달 또는 고위험이면 HALT | 사용자에게 옵션 제시 |
| `rollback-confirmation` | 좁은 rollback 은 decision worker 또는 기본 승인 가능. 광범위 destructive reset 은 HALT | 사용자에게 옵션 제시 |

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

`--auto + SHA mismatch` → business-decision 영역, HALT.

### 5.5 `--from-task=T-PH001-XX`

해당 Task 부터 실행. 강제 조건:
- 이전 Task 가 모두 `done` 상태가 아니면 경고 출력
- `depends_on` 위반 시 강한 경고 (`Codex clarification gate` — 사용자가 책임지고 진행)
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
                    answers[q.id] = AUTO_DECISION_WORKER_OR_HALT(q, critical_gates)
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
        choice = Codex clarification gate(§0.G4 3지선다)
        RETURN choice


FUNCTION VERIFY_SHA_ON_RESUME(state, plan_path, sidecar_path, args):
    current_plan_sha = SHA256(plan_path)
    current_sidecar_sha = SHA256(sidecar_path)
    IF state.plan_sha256 == current_plan_sha AND state.sidecar_sha256 == current_sidecar_sha:
        RETURN True

    IF args.auto:
        HALT("plan/sidecar SHA mismatch — --auto business-decision HALT")

    choice = Codex clarification gate("plan/sidecar 외부 변경 감지", options=[
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
            choice = Codex clarification gate(
                f"T-final 제안: {len(proposals)} 개 REQ 를 implemented 로 승급?",
                details=proposals,
                options=["A) 적용", "B) skip (pending_mutations 로 보고서 적재)", "C) per-REQ 개별 확인"]
            )
            IF choice == "B":
                state.pending_mutations = proposals
                worklog.append({event: "t_final_user_skipped"})
                RETURN
            IF choice == "C":
                proposals = [p FOR p IN proposals IF Codex clarification gate(f"{p.req_id}: {p.from} → {p.to} 적용?") == "yes"]

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

    IF NOT MCP_TOOL_AVAILABLE("open_markdown"):
        worklog.append({event: "doculight_skip", reason: "mcp_unavailable"})
        PRINT(f"보고서: {report_path}")   # fallback: 경로만 출력
        RETURN

    TRY:
        IF state.doculight_viewer_id:
            # --resume 후속 실행 — 기존 viewer 갱신
            MCP_CALL(update_markdown,
                     viewer_id=state.doculight_viewer_id,
                     file=report_path)
            worklog.append({event: "doculight_updated", viewer_id: state.doculight_viewer_id})
        ELSE:
            # 신규 viewer 열기
            result = MCP_CALL(open_markdown, file=report_path)
            state.doculight_viewer_id = result.viewer_id
            SAVE_STATE(state)
            worklog.append({event: "doculight_opened", viewer_id: result.viewer_id})
            PRINT(f"보고서 viewer 열림: viewer_id={result.viewer_id}")
    CATCH AS e:
        worklog.append({event: "doculight_skip", reason: f"call_failed: {e}"})
        PRINT(f"보고서: {report_path}")
```

doculight 호출은 best-effort. 실패해도 PM 정상 종료 흐름 유지 (보고서 마크다운은 디스크에 작성되어 있음).

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
| sub-agent timeout | 2회 재시도 후 FAILED → 3지선다 (§0.G4) |
| 자식 JSON 파싱 실패 | 1회 재spawn 시 "단일 JSON 만" 강조 재주입, 실패 시 FAILED |
| 자식이 빈 응답 / 산문만 반환 | JSON 파싱 실패와 동일 처리 |
| `pm-state.json` 손상 (parse error) | `.bak` 복구 시도 → 실패 시 사용자 동의 후 새 상태 생성 |
| MCP 미가용 (lifecycle gate read) | 정상 SRS read 불가이므로 HALT. CLI 는 진단/복구 안내에만 사용 (§4.4) |
| MCP 미가용 (T-final update_status) | `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내 |
| `update_status` transition guard 거부 (MCP 응답 reject) | catch → `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내. 강제 우회 없음. (`update_status` MCP 에 dryRun 옵션 없음 — 사전 시뮬레이션 불가, 호출 시점에 거부 가능성 catch) |
| 자식이 `update_status` backward 시도 | kiwi-coder §0.G5 자체 차단. PM 무대응 |
| `--auto` + business-decision NEEDS_USER | critical_gates[] 매칭 시 HALT, 아니면 decision worker |
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
| `--headless` (legacy CLI subprocess) | **제거** | 모든 자식 실행이 Codex 서브에이전트 위임 단일 모드 (§0.15) |
| T1/T2/T3 forbidden_patterns 게이트 | **제거** | Codex 권한 모델 사용, 외부 강제 불필요 |
| ENV_WHITELIST / SANITIZE_USER_ANSWERS / PARSE_SENTINEL | **제거** | subprocess 부재로 무용 |
| process group 격리 / Windows CTRL_BREAK_EVENT | **제거** | subprocess 부재 |
| `_shared/snoworca/` 모듈 import | **금지** | 로직만 차용, 실행은 본 스킬 내부 (§0.3) |
| python-fix-hook self-heal | **제거** | subprocess Python 호출 없음 |
| §11.5 Phase↔TASK 휴리스틱 | **제거** | 항상 Task |
| §11.6 비용 추적 (subprocess usage) | **제거** | 서브에이전트 usage 노출 정책은 런타임에 따름 — v0.2 후보 |
| §15 plan.md 체크박스 + §15.8 checklist.md 폴백 | **유지** | 매칭 패턴 그대로 (§6.1) |
| 3상태 프로토콜 (PHASE_DONE/NEEDS_USER/FAILED) | **유지** (`TASK_DONE`) | severity 3종 동일 |
| `--auto` decision worker | **갱신** | clarification/business-decision/rollback-confirmation + critical_gates[] |
| `--resume` / `--from-phase` | **유지** (`--from-task`) | task_id 기반 |
| `--max` / `--ultra` / `--no-self-heal` | **제거** | `--model` 만 도입 (kiwi 시리즈 표준) |
| `RESUME_FROM` 4지선다 (FAILED 분기) | **간소화 3지선다** | kiwi-coder 가 `partial_progress` 미보고. v0.2 후보 |
| `mode = "headless"/"interactive"` | **단일 모드** | interactive 만 |
| lifecycle gate (Stability) | **신규** | kiwi-pipeline-v1 §4.2 정합 (§4) |
| 종료 T-final REQ status 마무리 | **신규** | kiwi-pm 의 핵심 부가가치 (§6.2) |
| doculight 보고서 표시 | **신규** | MCP 가용 시 (§6.3) |

### 7.4 Out of Scope (v0.1)

- PRD / SRS / feasibility / planner / coder 자체 호출 (각각 kiwi-prd, kiwi-srs, kiwi-srs-feasibility, kiwi-planner, kiwi-coder 영역)
- 구현 리뷰 (kiwi-reviewer 영역, 미구현)
- 풀 파이프라인 오케스트레이션 (별도 kiwi-pipeline 향후 스킬)
- Stability 변경 (kiwi-srs-feasibility / kiwi-reviewer)
- verified 승급 (kiwi-reviewer 영역)
- `--headless` 모드 (Codex 서브에이전트 위임 단일 모드 정책)
- 비용 / 토큰 추적 (sub-agent usage 노출 후 검토)
- 병렬 Task spawn (`depends_on` 독립 Task 동시 실행, v0.2 후보)
- 멀티 plan 동시 실행 (`pm.lock` 의도)
- snoworca 시리즈 호출 (AGENTS.md / .skillfactory AGENTS.md 금지)

### 7.5 v0.2 후보

- `--headless` 부활 (legacy CLI subprocess + 안전 게이트 복원, 별도 스킬 분리 가능)
- 비용 추적 (sub-agent usage 노출 시 또는 doculight 보고서에 통합)
- kiwi-coder `partial_progress.last_completed_stage` 보고 → FAILED 분기 4지선다 확장
- `depends_on` DAG 분석 후 독립 Task 병렬 spawn (Race 안전성 사전 검증 필요)
- snoworca-pm 등의 기존 `.snoworca/sessions/` state 마이그레이션 도우미
- `task.requires_human_approval` / `task.owns` (semantic ownership) 휴리스틱 — kiwi-planner sidecar schema 가 해당 필드 도입 시 §3.5 에 재활성화. 현재 sidecar `Task` interface 에는 미존재하여 v0.1 에서 제외 (path 기반 휴리스틱으로 일부 보완 가능)

---

## 8. 호출 예시

```bash
# 기본 실행 (interactive)
$kiwi-pm PLAN_PATH=docs/plans/2026-05-19.kiwi-pm.v0-1.plan.md

# 자동 모드 + 비용 절감
$kiwi-pm PLAN_PATH=docs/plans/...plan.md --auto --model <name>

# 이전 세션 재개
$kiwi-pm PLAN_PATH=docs/plans/...plan.md --resume

# 디버깅: 특정 Task 부터 실행
$kiwi-pm PLAN_PATH=docs/plans/...plan.md --from-task=T-PH002-03

# stale lock 강제 해제 후 재개
$kiwi-pm PLAN_PATH=docs/plans/...plan.md --resume --force

# doculight 끄고 자동 실행 (CI 환경 등)
$kiwi-pm PLAN_PATH=docs/plans/...plan.md --auto --no-doculight

# SIDECAR_PATH 명시 (plan.md frontmatter 추론 실패 시)
$kiwi-pm PLAN_PATH=docs/plans/...plan.md SIDECAR_PATH=docs/plans/...plan.json
```

---

## 9. 설계 요약

`$kiwi-pm` v0.1 은 plan-contract=1.2.0 + sidecar TDD plan 을 입력으로 받아 **각 Task 를 Codex 서브에이전트 위임으로 kiwi-coder 자식을 격리 실행** 하는 coder-loop runner. PM 책임 6항:

1. **부팅 lifecycle gate** — speckiwi `list_requirements` read, Stability ∈ {evolving, stable} 만 진행 허용 (§4)
2. **Task 순차 spawn + 3상태 프로토콜** — sub-agent child 결과를 TASK_DONE / NEEDS_USER / FAILED 로 분기 (§3)
3. **`--auto` decision worker** — 공용 auto-option 정책. critical_gates[] 만 강제 HALT (§5.1)
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
| `open_markdown` / `update_markdown` | **kiwi-pm** | T-final 보고서 작성 직후 (가용 시) |

**규모 축소**: snoworca-pm 1907 줄 → kiwi-pm v0.1 ~ 800 줄. `--headless` / T1/T2/T3 forbidden_patterns / ENV_WHITELIST / sentinel parser / Python self-heal / Phase↔TASK 휴리스틱 / 비용 추적 모두 제거.

---

## 10. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 로 이벤트를 작성한 뒤, 본 스킬 1회 실행 종료 직전 MCP `workflow_pipeline_emit` 를 호출한다. 멱등성, source hash, owner, dry-run, stale guard 는 공식 mutation envelope 를 따른다.

CLI `speckiwi workflow pipeline-emit --json` 은 MCP 미가용 진단/복구 중에만 사용한다. 직접 `./kiwi/pipeline.jsonl` 에 append 하는 것은 degraded mode 이며, 사용하려면 captured tool diagnostics, affected artifact paths, active target, follow-up requirement or candidate ID 를 보고서와 worklog 에 남긴다.

**자식 emit 흡수 책임**: kiwi-pm 이 자식(`kiwi-coder`) 을 spawn 하는 경우 자식은 자체 emit 하지 않는다 (§7 자식 컨텍스트 SSOT). 본 스킬이 plan 전체 종료 시 1줄로 통합 emit.

- `skill`: `"kiwi-pm"`
- `status`: 모든 Task 완료 + T-final mutation 성공 = `TASK_DONE`; business-decision 버블업 = `NEEDS_USER`; Task FAILED 잔존 = `FAILED`
- `next_hint`: 통상 `"kiwi-review-fix-loop"` (close 검증 권고) 또는 `"kiwi-commit-auto-push"` (구현 완료)
- `req_ids`: T-final 에서 `update_status("implemented")` 호출한 REQ-ID 배열
- `artifacts.plan_file`: 입력 plan.md 경로
- `artifacts.sidecar_file`: 입력 sidecar.json 경로
- `artifacts.analysis_dir`: `.kiwi/sessions/{run-id}/`
- `notes`: Task 통계 ("total:8 done:7 skipped:1 failed:0") + plan-summary entry id 권장

emit 실패는 best-effort.
