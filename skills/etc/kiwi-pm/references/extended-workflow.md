# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 4. Lifecycle Gate (kiwi-pipeline-v1 §4.2)
- 4.1 차단 분류
- 4.2 interactive 2지선다 (draft 차단 시)
- 4.3 `--auto` 동작
- 4.4 MCP 미가용
- 4.5 의사코드
- 5. `--auto` 가드레일 + 재개
- 5.1 severity 가드레일
- 5.2 NEEDS_USER 재spawn 상한 (§0.G3 재기재)
- 5.3 FAILED 2지선다 (§0.G4 재기재)
- 5.4 `--resume` 동작
- 5.5 의사코드
- 6. 종료 마무리
- 6.1 실행 결과 판정
- 6.2 T-final SRS Status 마무리
- 6.3 종료 보고서 + doculight 표시
- 6.4 kiwi-review-fix-loop hand-off
- 7. 호환성 / 에러 처리
- 7.1 입력 무결성 게이트 (T-1)
- 7.2 런타임 에러
- 7.3 Out of Scope (v0.1)
- 8. 호출 예시
- 9. 설계 요약
- MCP 호출 분담 표 (speckiwi 실제 schema)
- 10. Pipeline event emit (의무)

---

## 4. Lifecycle Gate (kiwi-pipeline-v1 §4.2)

부팅 T0 단계 — SDS `@req` 집합(`SKILL.md` §2.2 `req_ids`)을 1회 `list_requirements` read 로 일괄 평가. `--skip-lifecycle-gate` 명시 시 SKIP (사용자 책임, worklog `lifecycle_override` 기록).

### 4.1 차단 분류

| 분류 | REQ Stability | 동작 |
|---|---|---|
| 진행 가능 | `evolving` / `stable` | OK |
| 진행 불가 (정상) | `draft` | **차단** + interactive 2지선다 / `--auto` 는 그 SDS 를 실행하지 않고 요구 필터로 돌려보낸다 (`SKILL.md` §3.6) |
| 진행 불가 (정책) | `deprecated` / `frozen` | **즉시 HALT** — frozen=정책 위반, deprecated=의도된 제거 |
| target 비어있음 | — | **차단** + "speckiwi `set_active_target` 으로 활성 target 지정 후 재실행" |

### 4.2 interactive 2지선다 (draft 차단 시)

SDS 하나는 실행 하나라 요구 하나만 떼어 내 진행할 수 없다. 요구 단위로 나누는 일은 SDS 범위를 정하는 `$kiwi-sds` 의 몫이다.

- **(A) HALT** — `$kiwi-srs-feasibility` 로 승급하거나 `$kiwi-sds` 요구 필터로 그 REQ 를 뺀 SDS 를 다시 쓴 뒤 재시도 (권장)
- **(B) override 진행** — 사용자 책임. worklog `lifecycle_override` 기록 + 보고서에 경고 명시

### 4.3 `--auto` 동작

`SKILL.md` §3.6 이 SSOT 다 (무인 실행의 중단 지점이므로 core map 에 둔다).

### 4.4 MCP 미가용

1. `mcp__speckiwi__list_requirements(target, projection: "compact")` 호출 시도
2. 실패 시 HALT + worklog `lifecycle_gate_mcp_unavailable` 기록
3. CLI 는 진단/복구 안내에만 사용하며, 사용자 승인으로 lifecycle gate 를 우회하지 않는다
4. 평가 결과는 `state.lifecycle_gate_state.stability_snapshot` 에 저장 (REQ-ID → stability)

### 4.5 의사코드

```
FUNCTION APPLY_LIFECYCLE_GATE(sds, state, args):
    IF args.skip_lifecycle_gate:
        worklog.append({event: "lifecycle_override", reason: "--skip-lifecycle-gate"})
        RETURN

    # 1. 활성 target 확인
    target = MCP_CALL("get_active_target")
    IF NOT target:
        HALT("활성 target 없음. speckiwi set_active_target 으로 지정 후 재실행")
    IF target != state.target_slug AND state.target_slug:
        User clarification gate(f"SDS target={state.target_slug} vs 활성 target={target} 불일치 — 진행?")

    # 2. 일괄 read — 대상은 SDS @req 집합
    TRY:
        reqs = MCP_CALL(list_requirements, target=target, projection="compact")
    CATCH mcp_unavailable:
        HALT("speckiwi mcp 미가용: lifecycle gate 평가 불가. CLI 는 진단/복구 안내에만 사용")

    # 3. 분류
    stability_snapshot = {}
    status_snapshot = {}
    blocked = []
    FOR req IN reqs IF req.id IN state.req_ids:
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

    # 4. 차단 처리
    IF NOT blocked: RETURN

    deprecated_or_frozen = [r FOR r IN blocked IF r.stability IN {"deprecated", "frozen"}]
    IF deprecated_or_frozen:
        HALT(f"deprecated/frozen REQ 발견 (즉시 차단): {[r.id for r in deprecated_or_frozen]}")

    # draft 만 남은 경우 — SDS 는 나눌 수 없으므로 실행하지 않고 요구 필터로 돌려보낸다
    IF args.auto:
        worklog.append({event: "lifecycle_skip_per_req", auto: True, req_ids: [r.id FOR r IN blocked]})
        state.lifecycle_skips = [{req_id: r.id, reason_class: "draft-stability-skip"} FOR r IN blocked]
        SAVE_STATE(state)
        END_NEEDS_USER(f"[auto] draft REQ {[r.id for r in blocked]} — $kiwi-sds 요구 필터로 뺀 SDS 를 다시 쓰십시오")
    ELSE:
        choice = User clarification gate("draft REQ 차단", options=[
            "A) HALT — $kiwi-srs-feasibility 로 승급하거나 $kiwi-sds 요구 필터로 뺀 SDS 로 재시도 (권장)",
            "B) override 진행 (사용자 책임)"
        ])
        IF choice == "A": HALT("사용자 선택: HALT")
        worklog.append({event: "lifecycle_override", req_ids: [r.id FOR r IN blocked]})
        SAVE_STATE(state)
```

`END_NEEDS_USER(msg)` 는 자식을 띄우지 않고 실행을 끝낸다 — `run.status = "blocked"` 와 사유를 기록해 SAVE_STATE, 보고서(§6.3, 7번 절에 돌려보낸 draft REQ 목록)를 쓰고, §10 이벤트를 `NEEDS_USER` 로 emit 한 뒤 락을 풀고 반환한다. MAIN 으로 돌아가지 않으므로 spawn 도 §6.4 hand-off 도 없다.

종료 시 (T-final) `state.lifecycle_gate_state.stability_snapshot` 과 현재 stability 를 비교하여 drift 가 감지되면 보고서에 경고로 명시 (의도된 변경일 수도 있으므로 차단은 안 함).

---

## 5. `--auto` 가드레일 + 재개

### 5.1 severity 가드레일

| severity | `--auto` 동작 | interactive 동작 |
|---|---|---|
| `clarification` | `default_if_auto` 자동 채택 (부재 시 보수적 default) | 사용자에게 옵션 제시 |
| `business-decision` | **강제 중단** (--auto 무시) — 외부 관찰 가능 변경은 사용자 결정 필요 | 사용자에게 옵션 제시 |
| `rollback-confirmation` | "YES" 자동 승인 | 사용자에게 옵션 제시 |

**예외 (always HALT, 모드 무관)**:
- §4 lifecycle gate `deprecated`/`frozen` 차단 (`draft` 는 `SKILL.md` §3.6 요구 필터로 분리 — 예외 아님)
- 외부 모듈 영향 (kiwi-coder §0.G2)
- 기존 public 심볼의 삭제 · 시그니처 변경 버블업 (§0.G7 `existing-public-contract-change`) — 경로와 무관
- 기존 테스트의 **약화·삭제** 버블업 (§0.G7 `existing-test-weakened-or-deleted`) — 회귀 안전망 제거는 위원회 결정 대상이 아니다
- MCP mutation ≥10건 batch (kiwi-coder §0.8)
- T-final dryRun 거부 / transition guard 거부 (§0.G6)
- SDS SHA256 mismatch on `--resume` (§5.4)

### 5.2 NEEDS_USER 재spawn 상한 (§0.G3 재기재)

같은 SDS 실행에서 NEEDS_USER 3회 누적 시 (재spawn 한도) 2지선다:

- **(A) 추가 질문 1회 더 시도** — `attempts` 카운터는 계속 증가, 다음 NEEDS_USER 도착 시 다시 2지선다
- **(B) 중단 + blocked 기록** — `run.status = "blocked"`, `state.last_question` 보존, SAVE_STATE 후 RETURN (사용자가 `--resume` 으로 재개 가능)

### 5.3 FAILED 2지선다 (§0.G4 재기재)

- **(A) 같은 SDS 재시도** (처음부터) — `attempts` 증가, 재spawn
- **(B) 중단** — `run.status = "failed"`, `state.last_error` 보존

`--auto` 모드 동작: (A) 자동 재시도 1회 → 또 FAILED 면 사용자에게 에스컬레이션 (`--auto` 라도 무한 재시도 금지). 이 HALT 는 §0.G7 critical_gates `task-failure-escalation` 로 선언되어 있어, 게이트 표만 읽어도 중단 지점을 예측할 수 있다.

### 5.4 `--resume` 동작

`.kiwi/sessions/{sds_id}/pm-state.json` 로드 후:

1. **`run.status = "done"` → 실행 skip**, T-final 이후 단계만 이어간다
2. **`run.status = "blocked"` + `last_question` 존재 → 재제시**: 사용자에게 질문 다시 보여주고 답변 받음 → 답변 주입 후 재spawn
3. **`run.status = "failed"` → 사용자 재시도 게이트**: 재시도/중단 2지선다
4. **`run.status = "running"` → 비정상 종료 의심**: 이전 세션이 강제 종료된 흔적. `pending` 으로 복구 후 사용자 확인 (interactive). `--auto` 시 자동 `pending` 복구 + 진행
5. **`sds_sha256` mismatch**: 외부에서 SDS 가 바뀌었다. 사용자 게이트 3지선다:
   - (A) 새 SHA 로 갱신 + `check_sds` 재실행 후 계속 진행 (의도적 수정)
   - (B) 중단 (멀티 PM 인스턴스 / 외부 변경 의심)
   - (C) diff 표시 후 재결정 (재귀)

재개 후 이번 실행이 쓰기 집합 안에 아무 변경도 남기지 않았으면 §10 의 무동작 재진입 규칙을 적용한다 — 이미 끝난 실행을 다시 부른 재개는 완료가 아니다.

`--auto + SHA mismatch` → §0.G7 critical_gates `sha-mismatch-on-resume` — `--auto` 무관 HALT.

### 5.5 의사코드

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
                    PRINT(f"⚠️ business-decision — --auto 에서도 중단")
                    PRINT(f"질문: {q.question}")
                    PRINT(f"근거: {q.context}")
                    answers[q.id] = User clarification gate(q)   # HALT 후 사용자 개입
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
    PRINT(f"⚠️ FAILED: {result.error.reason}")
    PRINT(f"시도한 것: {result.error.attempted}")

    IF args.auto AND state.run.attempts < 2:
        LOG("[auto] FAILED 1회 자동 재시도")
        RETURN "A"
    ELSE:
        RETURN User clarification gate(§0.G4 2지선다)


FUNCTION VERIFY_SHA_ON_RESUME(state, args):
    current_sds_sha = SHA256(state.sds_path)
    IF state.sds_sha256 == current_sds_sha:
        RETURN True

    IF args.auto:
        HALT("SDS SHA mismatch — §0.G7 critical_gates `sha-mismatch-on-resume` HALT")

    choice = User clarification gate("SDS 외부 변경 감지", options=[
        "A) 새 SHA 로 갱신 + check_sds 재실행 후 계속 진행 (의도적 SDS 수정)",
        "B) 중단 (멀티 PM 의심)",
        "C) git diff 보기 후 재결정"
    ])
    SWITCH choice:
        CASE "A":
            LOAD_AND_CHECK_SDS(state.sds_path)
            state.sds_sha256 = current_sds_sha
            SAVE_STATE(state)
            RETURN True
        CASE "B":
            HALT("사용자 중단 — SHA mismatch")
        CASE "C":
            SHOW_DIFF(state.sds_path, state.sds_sha256, current_sds_sha)
            RETURN VERIFY_SHA_ON_RESUME(state, args)
```

---

## 6. 종료 마무리

### 6.1 실행 결과 판정

kiwi-coder 실행이 끝나면 PM 이 결과를 `run` 에 확정한다. `run.changed` 는 실행 시작 이후 쓰기 집합 안에 새 commit 이 생겼거나 `git status --porcelain -- <쓰기 집합>` 이 비어 있지 않으면 `true` 다 — §10 의 무동작 판정이 이 값을 읽는다. `--commit-lane-work` 가 있고 `run.status = "done"` 이면 이 시점에 `SKILL.md` §1.5 의 commit 1개를 만든다. 그 밖에 PM 은 자동 commit 하지 않는다 — `--commit-lane-work` 를 명시한 오케스트레이션 실행이 그 유일한 예외다.

### 6.2 T-final SRS Status 마무리

`--no-final` 이 명시되면 본 절의 **요구 승급을 수행하지 않는다** (SKILL.md §1.5) — 한 요구가 여러 unit 에 걸칠 때 `all_done` 분모가 한 unit 의 몫이 되기 때문이다. 보고서 작성(§6.3)은 그대로 수행한다.

**문제**: kiwi-coder 는 `update_status(in_progress)` 만 호출한다. 한 SDS 가 여러 요구를 구현하고 한 요구가 여러 SDS 에 걸칠 수 있어 자식 시야에서는 `implemented` 승급을 판단할 수 없다. PM 이 실행이 끝난 뒤 SDS `@req` 집합을 일괄 마무리한다.

**의사코드**:

```
FUNCTION T_FINAL_SRS_MUTATION(state, args):
    # 1. read REQ 현재 status
    reqs = MCP_CALL(list_requirements, target=state.target_slug, projection="compact")
    reqs_by_id = {r.id: r for r in reqs}

    # 2. proposals 생성 (forward-only) — 대상은 SDS @req 집합
    STATUS_ORDER = ["planned", "in_progress", "implemented", "verified"]
    all_done = (state.run.status == "done")
    proposals = []
    FOR req_id IN state.req_ids:
        req = reqs_by_id.get(req_id)
        IF NOT req: CONTINUE   # SDS @req 가 가리키지만 활성 target 에 없는 REQ — 무시
        current_idx = STATUS_ORDER.index(req.status) IF req.status IN STATUS_ORDER ELSE -1
        target_idx = STATUS_ORDER.index("implemented")

        state.req_coverage[req_id] = {
            status_at_start: state.lifecycle_gate_state.status_snapshot.get(req_id, req.status),   # 부팅 T0 시점 Status
            status_at_end: req.status,                                                              # T-final read 직후 Status (mutation 적용 전)
            stability_at_start: state.lifecycle_gate_state.stability_snapshot.get(req_id),
            all_done: all_done
        }

        IF all_done AND current_idx < target_idx AND current_idx >= 0:
            proposals.append({ req_id: req_id, from: req.status, to: "implemented" })

    # 3. 사용자 승인 (--auto 면 자동, 단 backward transition 차단)
    IF proposals:
        IF NOT args.auto:
            choice = User clarification gate(
                f"T-final 제안: {len(proposals)} 개 REQ 를 implemented 로 승급?",
                details=proposals,
                options=["A) 적용", "B) skip (pending_mutations 로 보고서 적재)", "C) per-REQ 개별 확인"]
            )
            IF choice == "B":
                state.pending_mutations = proposals
                worklog.append({event: "t_final_user_skipped"})
                RETURN
            IF choice == "C":
                proposals = [p FOR p IN proposals IF User clarification gate(f"{p.req_id}: {p.from} → {p.to} 적용?") == "yes"]

        # 4. 실제 mutation (사전 guard → apply → 기록)
        #
        # speckiwi `update_status` MCP schema (SSOT): { id: string, status: string } — 그 외 인자 없음 (dryRun 미지원)
        # speckiwi `add_completed_work` MCP schema (SSOT):
        #   필수 { date: "YYYY-MM-DD", summary: string }
        #   선택 { requirementIds: string[], target?: string, scope?: string,
        #          reportPaths?: string[], allowIncomplete?: boolean, dryRun?: boolean }
        # → MCP 에 sds_id / run_id / kind / entries 같은 임의 필드 전달 불가.
        #   sds-summary 메타는 summary 텍스트에 인코딩하고, 보고서 파일은 reportPaths 로 전달.
        is_pm_dry_run = (args.dry_run == True)

        FOR p IN proposals:
            TRY:
                IF is_pm_dry_run:
                    worklog.append({event: "t_final_dryrun_only", req_id: p.req_id, kind: "update_status"})
                ELSE:
                    MCP_CALL(update_status, id=p.req_id, status="implemented")
                state.final_mutations.append({
                    ts: NOW(), kind: "update_status", req_id: p.req_id,
                    from: p.from, to: "implemented", dry_run: is_pm_dry_run
                })

                # sds-summary completed-work entry — REQ 별 1회 호출. speckiwi 표준 필드만 사용.
                summary_text = (
                    f"[sds-summary] sds_id={state.run_id} "
                    f"sds={state.sds_path} "
                    f"— SDS 구현 완료, coder_run_id={state.run.coder_run_id}"
                )
                MCP_CALL(add_completed_work,
                    date=TODAY_DATE_YYYY_MM_DD(),
                    summary=summary_text,
                    requirementIds=[p.req_id],
                    target=state.target_slug,
                    reportPaths=([state.report_path] IF state.report_path ELSE []),
                    dryRun=is_pm_dry_run
                )
                state.final_mutations.append({
                    ts: NOW(), kind: "add_completed_work_sds_summary", req_id: p.req_id,
                    summary: summary_text, dry_run: is_pm_dry_run
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
| `add_completed_work` | `date, summary` | `requirementIds, target, scope, reportPaths, allowIncomplete, dryRun` | `requirementIds[]` 로 다중 REQ 묶기 가능하지만, REQ 별 1회 호출로 기록을 요구별로 남긴다 |

**실행이 성공으로 끝나지 않았을 때** (실패·차단) 해당 REQ 의 `all_done == False` → `update_status` 호출 안 함 (REQ 는 in_progress 또는 blocked 그대로 유지). `add_completed_work(sds-summary)` 도 skip. 보고서 §6.3 에서 미완료 REQ 목록을 명시.

**Stability 변경 / verified 승급**: PM 권한 아님. Stability 변경은 kiwi-srs-feasibility, verified 전이는 kiwi-review-fix-loop `--close-reqs` 영역.

### 6.3 종료 보고서 + doculight 표시

`.kiwi/sessions/{sds_id}/reports/pm-{ts}.md` 작성. **8개 섹션**:

1. **요약** — SDS 경로 / 실행 status / attempts / 소요 시간
2. **실행 결과** — coder_run_id / result_summary / `run.changed` / commit sha (`--commit-lane-work` 일 때)
3. **req_coverage 표** — REQ-ID / 진입 시 status / 종료 시 status / all_done / verified 여부
4. **SRS mutation 로그** — `state.final_mutations` 시간순. `pending_mutations` 도 별도 명시 (MCP 미가용으로 보류된 항목, 사용자 수동 처리 안내)
5. **NEEDS_USER 이력** — severity 분포 + 질문 본문 요약
6. **`--auto` 자동 해소 항목** (있을 때만)
7. **lifecycle gate 초기 차단 항목** — `state.lifecycle_gate_state.blocked_req_ids` + 사용자 선택 (A/B) 또는 `--auto` 로 돌려보낸 draft REQ 목록. 돌려보낸 REQ 는 `reason_class` (`draft-stability-skip`) 와 함께 잔여로 열거하며, 잘라내지 않고 **전량** 적는다
8. **§6.4 hand-off** — 넘긴 인자와 `kiwi-sds --close` 두 호출의 결과(옮긴 결정, 지운 SDS 파일 — 미커밋), 또는 hand-off 하지 않은 사유 (`--no-final` / `--review-hop-owned-by-parent`). 보고서는 hand-off 앞에 쓰이므로 두 `kiwi-sds --close` 결과와 review-fix-loop 의 "후속 close 결과" 는 hand-off 가 끝난 뒤 이 절 끝에 덧붙인다

**Stability drift 경고** (§4 종료 시 비교): `lifecycle_gate_state.stability_snapshot` vs 종료 시점 stability 비교. drift 발견 시 §1 또는 §7 섹션 끝에 경고 박스 추가 (의도된 변경일 수도 있어 차단 안 함, 단 보고서에 명시).

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

### 6.4 kiwi-review-fix-loop hand-off

단독 실행은 끝에서 **항상** `kiwi-review-fix-loop` 로 넘긴다 — 미루거나 건너뛰는 갈래는 두지 않는다. 끝은 실행이 `done` 또는 `failed` 로 확정된 때다. `blocked` 는 끝이 아니라 멈춤이며 `--resume` 으로 이어간다.

```
Use $kiwi-sds with --close {state.run_id}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}
MOVED = CLOSE_SAFE(state) AND check_sds(state.sds_path).status == "closed"
Use $kiwi-review-fix-loop with --req-filter {state.req_ids 를 쉼표로 이음} --sds {state.sds_path}{' --close-reqs' if MOVED else ''}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}
Use $kiwi-sds with --close {state.run_id}{' --auto' if args.auto else ''}{' --max' if args.max else ''}{' --model ' + args.model if args.model else ''}{LOOP_FLAGS}
```

- `$kiwi-sds --close` 는 `CLOSE_SAFE` 일 때, 곧 hand-off 가 `--close-reqs` 를 붙일 때만 위 순서로 두 번 부른다 — 리뷰 앞에서 SDS 의 해석 결정을 SRS 로 옮기고(승급 전이어야 한다, FR-FLOW-183), 리뷰와 그 마지막 단계인 테스트 충분성 확인 뒤에 요구가 모두 승급됐으면 SDS 파일을 지운다 (`$kiwi-sds` §3). 인자는 이 실행의 SDS id(`state.run_id`, `SKILL.md` §0.14)와 리뷰 호출과 같은 `--auto` / `--max` / `--model` / 루프 플래그다. 첫 호출 뒤 `check_sds` 로 SDS Status 를 다시 읽어 `closed` 가 아니면(옮기기가 `sds-close-after-promotion` · `stability-frozen-violation` · `validate-spec-error` 등으로 멈춤) 옮기기가 끝나지 않은 것이다 — 리뷰는 `--close-reqs` 없이 돌고(`MOVED` 거짓), 두 번째 호출은 하지 않으며, 멈춘 gate id 를 보고서 8번 절에 적는다. 승급은 옮기기가 끝난 뒤에만 온다(FR-FLOW-183). `--close-reqs` 없이 넘기는 실행은 승급하지 않으므로 SDS 를 닫지 않는다 — 닫힌 SDS 는 다음 kiwi-pm 실행이 받지 않는다(`SKILL.md` §1.1). 지운 파일은 커밋하지 않으므로 보고서에 그렇게 적는다.
- `--req-filter` 와 `--sds` 는 이 SDS 의 요구 범위를 넘긴다 — review-fix-loop 의 마지막 단계인 테스트 충분성 확인(`../../_shared/kiwi/test-sufficiency.md`)이 이 실행의 범위를 본다.
- `--close-reqs` 는 실행이 `done` 으로 끝나 T-final 이 요구를 `implemented` 로 올렸고 (`CLOSE_SAFE`) 옮기기가 끝났을 때(`MOVED`)만 붙인다. 실행이 `failed` 이거나 critical 로 격상된 NEEDS_USER 가 남은 채로 `--close-reqs` 를 붙이는 것은 §0.G7 `followup-review-fix-loop-close-unsafe` 가 막는다 — 되감을 수 없는 `verified` 를 향하기 때문이며 `--auto` 도 이 멈춤을 덮지 못한다. 그 경우에도 hand-off 는 `--close-reqs` 없이 돈다.
- `--no-final` 이 있으면 hand-off 하지 않는다 — 워커 실행이며 리뷰는 호출자가 돈다.
- `--review-hop-owned-by-parent` 를 **명시적 인자로** 받으면 hand-off 하지 않는다 — 부모(`kiwi-pipeline` 사이클)가 이 실행 뒤 리뷰 홉을 직접 돈다. 인자가 없으면 진입 경로를 추론하지 않고 언제나 넘긴다.
- 부모 PM 의 `--model` / `--max` / `--mini` / `--loops N` 은 args 에 전파한다 (loop-option.md §6).
- review-fix-loop 의 종료 상태 (`closed_reqs.json`) 는 본 PM 보고서 8번 절 끝의 "후속 close 결과" 에 첨부 (review-fix-loop 종료 직후 갱신, best-effort).
- PM 자체는 `update_status("verified")` 를 호출하지 않는다 — verified 전이는 review-fix-loop 의 몫이다 (`SKILL.md` §0.12 mutation 분담 SSOT 불변).

---

## 7. 호환성 / 에러 처리

### 7.1 입력 무결성 게이트 (T-1)

| 실패 조건 | 동작 |
|---|---|
| `SDS_PATH` 부재 또는 파일 없음 | HALT — "`$kiwi-sds` 로 SDS 를 먼저 작성·합의하십시오" |
| 경로가 `docs/sds/*.sds.md` 가 아님 | HALT |
| `Profile ≠ lite` | HALT — tdd step `design.md` 는 `$kiwi-tdd` 몫 |
| Status ≠ `agreed` | HALT — `$kiwi-sds` 로 합의 |
| `check_sds` error ≥1 | HALT — 진단 코드와 줄을 보고하고 `$kiwi-sds` 로 수정 |
| SDS `@req` 집합이 비어 있음 | HALT |
| `sds_id` 정규식 위반 (`SKILL.md` §0.14) | HALT |

### 7.2 런타임 에러

| 상황 | 대응 |
|---|---|
| delegated worker timeout | 2회 재시도 후 FAILED → 2지선다 (§0.G4) |
| 자식 JSON 파싱 실패 | 1회 재spawn 시 "단일 JSON 만" 강조 재주입, 실패 시 FAILED |
| 자식이 빈 응답 / 산문만 반환 | JSON 파싱 실패와 동일 처리 |
| `pm-state.json` 손상 (parse error) | `.bak` 복구 시도 → 실패 시 사용자 동의 후 새 상태 생성 |
| MCP 미가용 (`check_sds` / lifecycle gate read) | HALT. CLI 는 진단/복구 안내에만 사용하고 사용자 승인으로 gate 를 우회하지 않음 |
| MCP 미가용 (T-final update_status) | HALT + `state.pending_mutations[]` 기록. MCP 복구 후 재개 |
| `update_status` transition guard 거부 (MCP 응답 reject) | catch → `state.pending_mutations[]` 적재 + 보고서 명시 + 사용자 수동 처리 안내. 강제 우회 없음. (`update_status` MCP 에 dryRun 옵션 없음 — 사전 시뮬레이션 불가, 호출 시점에 거부 가능성 catch) |
| 자식이 `update_status` backward 시도 | kiwi-coder §0.G5 자체 차단. PM 무대응 |
| `--auto` + business-decision NEEDS_USER | HALT 후 사용자 대화 복귀 |
| `--auto` + lifecycle gate `draft` | SDS 를 실행하지 않고 요구 필터로 돌려보냄 + 잔여 보고 (`SKILL.md` §3.6). `deprecated`/`frozen` 은 종전대로 HALT |
| SDS SHA256 mismatch on `--resume` | 사용자 게이트 3지선다 (§5.4). `--auto` 면 HALT |
| `pm.lock` 30분 stale | 자동 해제 + 경고 log |
| `pm.lock` 다른 host 활성 | 명시적 차단 (`--force` 필요) |
| `run.status="running"` 잔존 on `--resume` | `pending` 으로 복구 + 사용자 확인 (interactive) / `--auto` 자동 복구 |

### 7.3 Out of Scope (v0.1)

- SRS / feasibility / SDS 작성 스킬 자체 호출 (각각 kiwi-srs, kiwi-srs-feasibility, kiwi-sds 영역) — §6.4 의 `kiwi-sds --close` 마감 호출만 예외다. PRD 저작을 선언하는 스킬은 없다 — 사이클은 kiwi-srs 에서 시작한다
- SDS 수정 (kiwi-sds 영역 — 설계가 틀렸으면 NEEDS_USER 로 올린다)
- 구현 리뷰 (kiwi-review-fix-loop 영역 — kiwi-pm 은 §6.4 에서 그 스킬로 넘길 뿐 직접 리뷰하지 않는다)
- 풀 파이프라인 오케스트레이션 (kiwi-pipeline 영역)
- Stability 변경 (kiwi-srs-feasibility 영역)
- verified 승급 (kiwi-review-fix-loop `--close-reqs` 영역에 위임)
- `--headless` 모드 (위임 worker 위임 단일 모드 정책)
- 비용 / 토큰 추적 (delegated worker usage 노출 후 검토)
- 여러 SDS 동시 실행 (`pm.lock` 의도 — 병렬 wave 는 워크트리마다 kiwi-pm 하나가 돈다)
- snoworca 시리즈 호출 (project instructions 금지)

---

## 8. 호출 예시

```bash
# 기본 실행 (interactive)
$kiwi-pm SDS_PATH=docs/sds/4.0.0-todo-service.sds.md

# 자동 모드 + local-LLM 안정성 우선
$kiwi-pm SDS_PATH=docs/sds/4.0.0-todo-service.sds.md --auto

# 이전 세션 재개
$kiwi-pm SDS_PATH=docs/sds/4.0.0-todo-service.sds.md --resume

# stale lock 강제 해제 후 재개
$kiwi-pm SDS_PATH=docs/sds/4.0.0-todo-service.sds.md --resume --force

# doculight 끄고 자동 실행 (CI 환경 등)
$kiwi-pm SDS_PATH=docs/sds/4.0.0-todo-service.sds.md --auto --no-doculight
```

---

## 9. 설계 요약

`$kiwi-pm` v0.1 은 합의된 lite SDS 한 파일을 입력으로 받아 **그 SDS 를 위임 worker 위임으로 kiwi-coder 자식 실행 하나에 격리** 하는 runner. PM 책임 6항:

1. **부팅 SDS 검사 + lifecycle gate** — `check_sds` 로 lite SDS 를 검사하고, speckiwi `list_requirements` read 로 SDS `@req` 집합의 Stability ∈ {evolving, stable} 만 진행 허용 (§4)
2. **SDS 하나 = kiwi-coder 실행 하나 + 3상태 프로토콜** — delegated worker child 결과를 TASK_DONE / NEEDS_USER / FAILED 로 분기 (`SKILL.md` §3)
3. **`--auto` severity 가드레일** — clarification 자동 / business-decision 강제 HALT / rollback-confirmation 자동 승인 (§5.1)
4. **T-final REQ status 마무리** — 실행이 성공으로 끝났으면 SDS `@req` 집합에 `update_status(id, "implemented")` + `add_completed_work(date, summary, requirementIds, target, reportPaths)` (§6.2)
5. **보고서 작성 + doculight MCP 표시** — 8섹션 마크다운 + (가용 시) `open_markdown` (§6.3)
6. **리뷰 hand-off** — 단독 실행이면 끝에서 항상 `kiwi-review-fix-loop` 로 넘긴다. `--close-reqs` 를 붙이는 실행은 그 앞뒤로 `kiwi-sds --close` 를 부른다 (§6.4)

### MCP 호출 분담 표 (speckiwi 실제 schema)

| 호출 | 호출자 | 시점 | 시그니처 |
|---|---|---|---|
| `check_sds` (read) | **kiwi-pm** | T-1 입력 검사 | `{path}` |
| `get_active_target` (read) | **kiwi-pm** | T0 lifecycle gate | `{}` |
| `list_requirements` (read) | **kiwi-pm** | T0 / T-final | `{target?, status?, stability?, scope?, tag?, type?}` |
| `add_trace_link` | kiwi-coder (자식) | 실행 종료 시 (Code anchor) | `{id, type, reference, relation, [notes]}` (flat) |
| `add_verification_evidence` | kiwi-coder (자식) | 실행 종료 시 | `{id, type, reference, [covers, notes]}` |
| `update_status(in_progress)` | kiwi-coder (자식) | 실행 시작 시 | `{id, status: "in_progress"}` |
| `add_completed_work` (실행 요약) | kiwi-coder (자식) | 실행 종료 시 — SDS-AC/test 증거 | `{date, summary, [requirementIds, target, scope, reportPaths, allowIncomplete, dryRun]}` |
| `update_status("implemented")` | **kiwi-pm** | T-final, 실행이 성공으로 끝났을 때 (조건부, forward-only) | `{id, status: "implemented"}` (dryRun 인자 없음) |
| `add_completed_work(sds-summary)` | **kiwi-pm** | T-final, SDS 단위 요약 메타 entry |
| `open_markdown` / `update_markdown` | **kiwi-pm** | T-final 보고서 작성 직후 (가용 시) |

---

## 10. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 의 §6.4 hand-off 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

- 멱등 키: 재진입 실행은 `{run_id}#r{n}` 를 쓴다(`pipeline-event.md` §5.4) — 멱등 skip 은 **같은 키**에만 적용되며, 같은 키가 아니면 skip 하지 않는다. `--resume` 로 같은 SDS 를 다시 도는 재진입이 이벤트를 남기지 못하면 체인이 볼 새 `TASK_DONE` 이 없다.

**자식 emit 흡수 책임**: kiwi-pm 이 자식(`kiwi-coder`) 을 spawn 하는 경우 자식은 자체 emit 하지 않는다 (§7 자식 컨텍스트 SSOT). 본 스킬이 실행 종료 시 1줄로 통합 emit.

- `skill`: `"kiwi-pm"`
- `status`: 실행 `done` + T-final mutation 성공 = `TASK_DONE`; business-decision 버블업 또는 `--auto` 가 draft REQ 로 SDS 를 돌려보냄(§4.3, `draft-stability-skip`) = `NEEDS_USER`; 실행 `failed` = `FAILED`
  - **무동작 재진입은 완료가 아니다**: 이번 kiwi-coder 실행이 SDS 쓰기 집합 안에 commit 도 작업 트리 변경도 남기지 않았으면(`run.changed = false`) `TASK_DONE` 이 아니라 `no-op` 사유를 실은 `NEEDS_USER` 를 반환한다 — 아무것도 하지 않은 재진입이 성공으로 기록되면 부모의 개선 루프가 같은 finding 을 상한 소진까지 반복한다.
- `next_hint`: `CLOSE_SAFE` 면 `"kiwi-sds"` — 다음 단계는 승급 전 옮기기 `kiwi-sds --close <sds-id>` 이고 그 뒤가 `kiwi-review-fix-loop --close-reqs` 다 (FR-FLOW-183, §6.4). 아니면 `"kiwi-review-fix-loop"` (`--close-reqs` 없이 리뷰). 이벤트는 §6.4 hand-off 앞에 쓴다 — 이미 돈 홉을 가리키지 않는다
- `req_ids`: T-final 에서 `update_status("implemented")` 호출한 REQ-ID 배열
- `artifacts.sds_files`: 입력 SDS 경로 하나를 담은 배열 (`pipeline-event.md` §2 스키마)
- `artifacts.analysis_dir`: `.kiwi/sessions/{sds_id}/`
- `notes`: 실행 통계 ("attempts:1 changed:true") + sds-summary entry id 권장

`--no-pipeline-emit` 이 명시되면 본 절의 append 를 **수행하지 않는다** (SKILL.md §1.5) — 오케스트레이션된 unit 이 자기 이름으로 남기는 기록은 run 을 **거짓으로 기술**하기 때문이다: 저널에는 `kiwi-pm` run 하나가 완료한 것으로 보이지만 실제로는 한 wave · 한 stage 의 unit 하나가 끝났을 뿐이다.

emit 실패는 best-effort.
