# Extended Workflow Reference

This file was split from `SKILL.md` for progressive disclosure. Read it only when the active task needs the detailed phases, schemas, reports, fallback rules, or pipeline event instructions listed below.

## Table of Contents
- 11. kiwi-* 시리즈 통합 (speckiwi MCP 연동)
- 11.1 입력 컨텍스트 자동 감지 (Step 3 확장)
- 11.2 REQ-ID / Task-ID 매칭 평가 (Step 3.3 확장)
- 11.3 Stability 가드 (★ kiwi 전용 안전망)
- 11.4 커밋 메시지 trailer 다중 부착 순서 SSOT
- 11.5 speckiwi MCP mutation (★ Step 9 확장)
- 11.6 `$kiwi-coder` / `$kiwi-pm` 와의 인계 프로토콜
- 11.7 옵션 매트릭스 (kiwi 전용)
- 11.8 보고 양식 확장
- 11.9 변경 이력 섹션 없음
- 12. Pipeline event emit (의무)

---

## 11. kiwi-* 시리즈 통합 (speckiwi MCP 연동)

본 스킬은 **GitHub issue 와 speckiwi REQ/Task 그래프를 동시에 닫는 양면 closure 도구**다. `$kiwi-coder` / `$kiwi-pm` 종료 시점에 호출되어 commit ↔ REQ ↔ Task 의 양방향 trace 를 영속화한다.

**핵심 설계 결정** (이후 변경 시 본 문단도 함께 갱신):
- **trailer 키 5종 화이트리스트** (`Closes` / `Refs` / `REQ` / `Task` / `STABILITY-OVERRIDE`) — git native convention(`Closes`/`Refs`) + speckiwi REQ/Task 식별자 + frozen 가드의 4축 책임을 명시적으로 분리. 다른 trailer 키는 평가자가 거부.
- **MCP type 컨벤션** — `add_trace_link.type="Code"`, `add_verification_evidence.type="commit"`. MCP schema 자체는 free-form string 이지만 kiwi 시리즈 내부 SSOT 일관성을 위해 본 스킬이 위 두 값을 점유. 다른 kiwi 스킬과 충돌 시 본 SKILL.md 만 갱신.
- **자율 결정 원칙 예외 2건** — frozen REQ 변경 / push 충돌. 둘 다 비가역·고위험이므로 standalone 모드에서는 Codex clarification gate, child 모드에서는 NEEDS_USER bubble-up.
- **speckiwi 연동 게이트** — REQ trailer 가 없거나 사용자가 `--no-speckiwi` 를 명시한 경우에만 MCP 연동 실패를 warning 으로 둔다. REQ trailer 가 있고 `--no-speckiwi` 가 없으면 MCP trace/evidence 실패는 `FAILED` 또는 `NEEDS_USER` 이며 warning-only `TASK_DONE` 금지.

### 11.1 입력 컨텍스트 자동 감지 (Step 3 확장)

Step 3.1 의 후보 수집과 **병렬로** speckiwi 컨텍스트를 자동 추출:

| 우선 | 출처 | 추출 방법 |
|---|---|---|
| 1 | **호출자 prompt 인자** | kiwi-pm / kiwi-coder 가 본 스킬을 sub-agent로 spawn 할 때 prompt 에 직접 주입한 `task_id` / `req_ids` / `run_id` (§11.6 인계 프로토콜 참조) |
| 2 | **활성 plan sidecar** | `docs/plans/*.sidecar.json` 중 가장 최신 + `frozen_at` 없는 것. `tasks[].id` / `tasks[].req_ids` 를 후보 매핑에 사용 |
| 3 | **`.kiwi/sessions/` 활성 상태** | `.kiwi/sessions/*/pm-state.json` 또는 `.kiwi/sessions/*/current-task.json` 존재 시 (`$kiwi-pm` v0.1 의 state 영속 파일) `task_id` + `req_ids` 직접 채택 |
| 4 | **speckiwi MCP** | `get_active_target` + `list_requirements({status:"in_progress"})` 로 활성 REQ 후보 도출 |
| 5 | **branch 명 REQ 패턴** | `^(FR|NFR|CON|REQ)-[A-Z]+-\d+` 정규식 매칭 |
| 6 | **diff 내 trace anchor** | speckiwi REQ 의 `trace[code].reference` 와 변경 파일 경로 교차 |

`speckiwi mcp` 부재 시: 출처 4 skip, 1·2·3·5·6 만 사용. 자동 매칭 결과가 0건이면 REQ trailer 없이 진행할 수 있다. 사용자가 `--req` 를 명시했거나 diff/plan 에서 REQ trailer 를 붙이기로 결정한 뒤에는 MCP trace/evidence 가 필수이며 CLI 로 대체하지 않는다.

### 11.2 REQ-ID / Task-ID 매칭 평가 (Step 3.3 확장)

Step 3.3 의 lightweight 평가자에 평가 축 2종 추가:

| 축 | A+ 조건 |
|---|---|
| req_match | 후보 REQ 의 acceptance criteria 가 diff 로 충족됨 (`check_acceptance_criteria` MCP 결과 또는 lightweight 자체 평가) |
| task_match | 후보 plan task 의 `files[]` 와 diff 변경 파일이 일치 + `dod` 가 diff 로 충족 |

**판정**:
- 두 축 모두 A+ → `REQ: FR-XXX-001` + `Task: T-PHnnn-mm` trailer 부착
- REQ 만 A+ → `REQ:` trailer 만
- 둘 다 A 이하 → REQ/Task trailer 없음 (GitHub issue trailer 는 독립 결정)

### 11.3 Stability 가드 (★ kiwi 전용 안전망)

`get_requirement(id: REQ-ID)` 로 매칭된 REQ 의 `Stability` 확인:

| Stability | 동작 (standalone 모드) | 동작 (kiwi-pm child 모드, §11.6) |
|---|---|---|
| `evolving` / `stable` | 정상 진행 | 정상 진행 (TASK_DONE 으로 응답) |
| `frozen` | **Codex clarification gate 3옵션** (자율 결정 원칙 예외 — frozen 변경은 비가역·범위 외 위험): (1) `STABILITY-OVERRIDE: <reason>` trailer 추가 후 진행 / (2) commit 중단 / (3) REQ 의 stability 갱신 후 재시도 (`$kiwi-srs-feasibility` 호출 권고) | `NEEDS_USER` 상태로 즉시 bubble-up. `decision_options` 에 standalone 3옵션을 직렬화 (§11.6 NEEDS_USER 스키마 참조). kiwi-pm 의 §0.G2 lifecycle gate 와 정합 |
| `deprecated` | WARN 만 출력하고 trailer 부착 skip + 정상 진행 | 동일 (TASK_DONE + warning) |
| `draft` | WARN + trailer 부착 skip (draft REQ 는 commit 대상 부적합 신호) | 동일 (TASK_DONE + warning) |
| MCP 부재로 stability 미확인 | REQ trailer 를 붙이지 않는 경우만 WARN 진행. REQ trailer 를 붙이면 MCP 복구 전 HALT | child mode 에서는 REQ trailer 존재 시 `FAILED` 또는 `NEEDS_USER` |

### 11.4 커밋 메시지 trailer 다중 부착 순서 SSOT

trailer 부착 순서는 git convention + speckiwi `add_trace_link` parsing 일관성을 위해 **고정**:

```
{type}: {subject}

{body}

Closes #N              ← Step 3 GitHub issue 결정 (A+ 매칭 시)
Refs #N                ← Step 3 결정 (A 이하 매칭, close 안 함)
REQ: FR-XXX-001        ← §11.2 REQ 매칭 (A+ 매칭 시)
Task: T-PHnnn-mm       ← §11.2 task 매칭 (A+ 매칭 시)
STABILITY-OVERRIDE: <reason>  ← §11.3 frozen 변경 시
```

빈 줄 1개로 trailer 블록 분리. trailer 키 화이트리스트: `Closes` / `Refs` / `REQ` / `Task` / `STABILITY-OVERRIDE` 5종. `Closes` 와 `Refs` 는 동일 issue 에 대해 상호 배타 (둘 다 부착 금지 — Step 3 결정에서 둘 중 정확히 하나만 선택). Step 5 SpecComplianceChecker 에 **trailer_format_correctness** 평가 축 추가 (위 순서 + 화이트리스트 5종 + 상호배타성).

### 11.5 speckiwi MCP mutation (★ Step 9 확장)

`--no-speckiwi` 명시 시 본 절 skip. push 성공 후 (Step 9 GitHub issue 코멘트와 **동시**):

#### 11.5.1 `add_trace_link` — commit ↔ REQ/Code 연결

REQ trailer 가 있을 때 호출. MCP schema (required: `id`, `type`, `reference`, `relation` — 모두 free-form string, enum 제약 없음):

```
add_trace_link({
  id: "FR-XXX-001",
  type: "Code",
  reference: "{repo}@{commit_hash}:{primary_file_path}",
  relation: "implements",
  notes: "kiwi-commit-auto-push by run-id {run_id}"   // optional
})
```

값 컨벤션:
- `type` — `"Code"` 사용 (kiwi-planner 가 `"Requirement"` 사용하는 것과 구분). kiwi-coder 가 다른 type 컨벤션을 채택하면 본 스킬을 그에 맞춰 갱신
- `relation` — `"implements"` 사용. backup·revert·refactor commit 의 경우 각각 `"refactors"` / `"reverts"` 도 허용

다중 REQ trailer 시 각각 호출. 호출 결과는 `.kiwi/sessions/commit-{timestamp}/mcp-calls.jsonl` 에 append.

#### 11.5.2 `add_verification_evidence` — REQ 의 verification evidence 로 commit 등록

MCP schema (required: `id`, `type`, `reference` — 모두 free-form string):

```
add_verification_evidence({
  id: "FR-XXX-001",
  type: "commit",            // 본 스킬 컨벤션 — kiwi-* 시리즈 type 분담은 운영 결정 사안
  reference: "{commit_url}",
  notes: "{commit_message_subject}"   // optional
})
```

`type` 값은 free-form 이므로 본 스킬은 `"commit"` 으로 운영 — 다른 kiwi 스킬과 type 컨벤션 충돌 발견 시 본 SKILL.md 만 갱신.

#### 11.5.3 plan task 갱신 (sidecar `mcp_call_log` append)

Task trailer 가 있고 활성 sidecar 가 감지된 경우:
- sidecar `tasks[].trace_links[]` 에 새 link 객체 추가 (위 `add_trace_link` 호출과 multiset 정합)
- sidecar `mcp_call_log[]` 에 호출 entry 등록 (kiwi-planner C15 정합 보존)
- sidecar 파일 직접 `apply_patch` manual edit (kiwi-planner 의 황금률은 `docs/spec/*.srs.md` mutation 후 동일 SRS 파일 manual edit via apply_patch 만 차단하며, sidecar JSON 의 mcp_call_log 외 필드 수동 편집은 허용한다는 정책에 정합. 정확 절번호는 kiwi-planner SKILL.md 본문 확인 — 변경 시 본 절 보정)

#### 11.5.4 MCP 부재 / mutation 실패

- `--no-speckiwi` 명시 또는 REQ trailer 없음 → §11.5 전체 skip 가능 + WARN
- REQ trailer 존재 + `--no-speckiwi` 없음 + MCP 부재 → `FAILED` 또는 child-mode `NEEDS_USER`
- 특정 REQ mutation 실패 → 해당 REQ 를 warning-only 로 두지 말고 `FAILED` 또는 `NEEDS_USER`
- commit/push 는 이미 성공했을 수 있으므로 payload 의 `partial_state` 에 commit hash / branch / push 상태를 기록한다.

### 11.6 `$kiwi-coder` / `$kiwi-pm` 와의 인계 프로토콜

본 스킬이 서브에이전트로 호출되었고 호출자 prompt 에 다음 형태의 컨텍스트가 명시되어 있을 때 **child 모드** 로 전환:

```
KIWI_PM_CONTEXT:
  run_id: 2026-05-19.skf.v01
  task_id: T-PH001-02
  req_ids: [FR-AUTH-001]
  child_mode: true
```

(kiwi-pm 은 서브에이전트 prompt 에 직접 위 컨텍스트를 인라인으로 주입한다. 환경변수 인계는 가정하지 않는다.)

#### 11.6.1 child 모드 동작 변경

- Codex clarification gate 비활성 — kiwi-pm 의 3상태 프로토콜(TASK_DONE / NEEDS_USER / FAILED) 로 bubble-up
- doculight / telegram / google-chat 보고 channel 비활성 (호출자가 표시 책임)
- `.kiwi/sessions/{run_id}/commit-{task_id}.json` 에 본 스킬의 결과 영속화 (kiwi-pm 이 §0.G3 누적 카운터 추적 가능)

#### 11.6.2 3상태 반환 JSON SSOT (kiwi-pm 3상태 프로토콜 정합)

**TASK_DONE** (정상 완료):
```json
{
  "state": "TASK_DONE",
  "task_id": "T-PH001-02",
  "commit_hash": "abc123def",
  "commit_url": "https://github.com/.../commit/abc123def",
  "push_branch": "feature/auth",
  "trailers": { "Closes": ["#42"], "REQ": ["FR-AUTH-001"], "Task": ["T-PH001-02"] },
  "issue_comments_posted": [42],
  "mcp_calls": [
    { "tool": "add_trace_link", "id": "FR-AUTH-001", "ok": true },
    { "tool": "add_verification_evidence", "id": "FR-AUTH-001", "ok": true }
  ],
  "warnings": []
}
```

**NEEDS_USER** (사용자 결정 필요 — frozen REQ / push 충돌 / Step 3 후보 모호):
```json
{
  "state": "NEEDS_USER",
  "task_id": "T-PH001-02",
  "reason": "stability_frozen" | "push_conflict_non_fast_forward" | "push_conflict_rebase" | "push_conflict_merge" | "issue_candidate_ambiguous",
  "context": {
    "req_id": "FR-AUTH-001",
    "stability": "frozen"
  },
  "decision_options": [
    { "id": "stability-override", "label": "STABILITY-OVERRIDE 부착 후 진행", "needs_reason": true },
    { "id": "abort", "label": "commit 중단" },
    { "id": "feasibility-first", "label": "$kiwi-srs-feasibility 선행 후 재시도" }
  ],
  "severity": "business-decision"
}
```

`severity` enum (kiwi-pm `--auto` 정합): `clarification` / `business-decision` / `rollback-confirmation`. frozen / push 충돌은 `business-decision` 이면서 `../../_shared/kiwi/auto-option.md` critical_gates[] 에 매핑되므로 자동 우회하지 않는다.

**FAILED** (복구 불가 오류):
```json
{
  "state": "FAILED",
  "task_id": "T-PH001-02",
  "error": "git_push_authentication_failed" | "speckiwi_mcp_unavailable_required" | "gh_cli_not_installed_required" | "commit_signature_check_failed_post_amend",
  "details": "한 줄 설명",
  "partial_state": {
    "commit_hash": "abc123def | null",
    "pushed": false
  }
}
```

`partial_state` 는 부분 성공 (commit 됨 / push 실패 등) 상황 복구를 위해 채움.

#### 11.6.3 child 모드 게이트 매핑

| standalone 동작 | child 모드 동작 |
|---|---|
| frozen REQ → Codex clarification gate 3옵션 | NEEDS_USER (reason: stability_frozen, severity: business-decision, decision_options: 동일 3옵션 직렬화) |
| push 충돌 → Codex clarification gate 3옵션 (rebase/merge/중단) | NEEDS_USER (reason: push_conflict_non_fast_forward, severity: business-decision) |
| rebase/merge 파일 충돌 | NEEDS_USER (reason: push_conflict_rebase / push_conflict_merge) |
| issue 후보 매칭 모호 (예: lightweight 평가가 모든 후보 A 이하) | NEEDS_USER (reason: issue_candidate_ambiguous, severity: clarification — `--auto` 시 자동 trailer skip 처리) |
| gh CLI 인증 실패 | FAILED (error: gh_cli_not_installed_required, partial_state.commit/push 채움) |
| REQ trailer 없음 또는 `--no-speckiwi` 명시 후 speckiwi MCP 호출 실패 | TASK_DONE 진행 (warnings 채움) |
| REQ trailer 존재 + `--no-speckiwi` 없음 + speckiwi MCP 호출 실패 | FAILED 또는 NEEDS_USER (partial_state 에 commit/push 채움) |

### 11.7 옵션 매트릭스 (kiwi 전용)

| 인자 | 동작 |
|---|---|
| `--no-issue` | GitHub issue 처리 비활성 |
| `--no-comment` | issue 자동 코멘트 비활성 |
| `--no-speckiwi` | speckiwi mutation 전부 skip (trailer 는 부착) |
| `--no-trailer` | 모든 trailer 부착 skip (speckiwi mutation 도 자동 skip) |
| `--req=FR-X` | REQ 자동 감지 건너뛰고 명시된 REQ 만 사용 |
| `--task=T-PH001-01` | task 자동 감지 건너뛰고 명시된 task 만 사용 |
| `--stability-override=<reason>` | frozen 가드 우회 + reason trailer 자동 부착 (사용자 명시 책임) |
| `--model <name>` | kiwi 시리즈 일관성 위해 추가 (현재는 lightweight 평가자가 기본이라 사실상 no-op, 미래 별도 검증 서브에이전트 도입 시 지정 모델 적용) |
| `--auto` | standalone 사용자 게이트에 공용 auto-option decision worker 적용. frozen/push-conflict/force-push/issue ambiguity 는 critical gate |

### 11.8 보고 양식 확장

```
커밋: <hash> <message 첫 줄>
push: origin/<branch> ← 성공
issue: #N close (Closes trailer + 코멘트 등록 완료)
REQ: FR-XXX-001 (add_trace_link + add_verification_evidence 등록)
Task: T-PH001-01 (sidecar mcp_call_log + trace_links 갱신)
stability: stable (정상)
```

stability 가 `frozen` 이고 override 사용 시:
```
stability: frozen ⚠️ override (reason: "hotfix-CVE-2026-xxxx")
```

### 11.9 변경 이력 섹션 없음

project change-history and skill-boundary instruction — 스킬 본문에 changelog 작성 금지. 연혁은 `git log` 추적.

---

## 12. Pipeline event emit (의무)

`../../_shared/kiwi/pipeline-event.md` v1.0.0 의 §2 schema 와 §5 emit 패턴을 따라 본 스킬 1회 실행 종료 직전 `./kiwi/pipeline.jsonl` 에 정확히 1줄 append. 멱등성: 동일 `run_id` 의 이벤트가 이미 존재하면 skip.

**호출 컨텍스트별 정책**:
- **단독 호출 (사용자 직접)**: 본 스킬이 emit. `next_hint`: 통상 `"kiwi-pipeline"` (다음 plan 또는 종료).
- **kiwi-pm 자식 모드**: 부모(`kiwi-pm`) 의 통합 이벤트에 흡수. 본 스킬 자체 emit 하지 않음.

- `skill`: `"kiwi-commit-auto-push"`
- `status`: 커밋 + push 성공 = `TASK_DONE`; 충돌 사용자 결정 보류 = `NEEDS_USER`; push 실패 = `FAILED`
- `req_ids`: trailer 또는 commit 본문에 명시된 REQ-ID 배열
- `notes`: commit hash + branch + closed issue ids 권장
- `artifacts`: 빈 객체 (커밋은 git history 가 SSOT, 별도 파일 산출물 없음)

emit 실패는 best-effort.
