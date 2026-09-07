# Conditional Sections Reference

`kiwi-commit-auto-push` 의 본문에서 옮겨 온 절이다. 본문은 호출마다 통째로 실려 오고 이 파일은 그렇지 않으므로, **아래 진입 조건에 해당할 때만** 읽는다.

- 11.6 `/kiwi-coder` / `/kiwi-pm` 와의 인계 프로토콜

---

### 11.6 `/kiwi-coder` / `/kiwi-pm` 와의 인계 프로토콜

본 스킬이 `Agent` 도구로 spawn 되었고 호출자 prompt 에 다음 형태의 컨텍스트가 명시되어 있을 때 **child 모드** 로 전환:

```
KIWI_PM_CONTEXT:
  run_id: 2026-05-19.skf.v01
  task_id: T-PH001-02
  req_ids: [FR-AUTH-001]
  child_mode: true
```

(kiwi-pm 은 spawn prompt 에 직접 위 컨텍스트를 인라인으로 주입한다 — kiwi-pm SKILL.md 의 §0.15 가 `Agent` 도구만 사용한다고 명시하므로 환경변수 인계 가정 없음.)

#### 11.6.1 child 모드 동작 변경

- AskUserQuestion 비활성 — kiwi-pm 의 3상태 프로토콜(TASK_DONE / NEEDS_USER / FAILED) 로 bubble-up
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
    { "id": "feasibility-first", "label": "/kiwi-srs-feasibility 선행 후 재시도" }
  ],
  "severity": "business-decision"
}
```

`severity` enum (kiwi-pm `--auto` 가드레일 정합): `clarification` (자동 진행) / `business-decision` (사용자 강제) / `rollback-confirmation` (자동 승인). frozen / push 충돌은 `business-decision`.

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
| frozen REQ → AskUserQuestion 3옵션 | NEEDS_USER (reason: stability_frozen, severity: business-decision, decision_options: 동일 3옵션 직렬화) |
| push 충돌 → AskUserQuestion 3옵션 (rebase/merge/중단) | NEEDS_USER (reason: push_conflict_non_fast_forward, severity: business-decision) |
| rebase/merge 파일 충돌 | NEEDS_USER (reason: push_conflict_rebase / push_conflict_merge) |
| issue 후보 매칭 모호 (예: Haiku 평가가 모든 후보 A 이하) | NEEDS_USER (reason: issue_candidate_ambiguous, severity: clarification — `--auto` 시 자동 trailer skip 처리) |
| gh CLI 인증 실패 | FAILED (error: gh_cli_not_installed_required, partial_state.commit/push 채움) |
| speckiwi MCP 호출 모두 실패 | TASK_DONE 진행 (warnings 채움) — speckiwi 연동은 best-effort 이므로 FAILED 처리 아님 |
