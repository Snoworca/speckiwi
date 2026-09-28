# Conditional Sections Reference

`kiwi-review-fix-loop` 의 본문에서 옮겨 온 절이다. 본문은 호출마다 통째로 실려 오고 이 파일은 그렇지 않으므로, **아래 진입 조건에 해당할 때만** 읽는다.

- 4.1.p PR 모드 — gh CLI 수집
- 6.6 Phase 7.5 — REQ verified 일괄 승급 (`--close-reqs` 활성 시)
- 7.2 PR 응답 코멘트 (PR 모드 + 응답 활성, §0.13)

---

### 4.1.p PR 모드 — gh CLI 수집

§0.G3 의 알고리즘 그대로:
1. `gh pr view --json title,body,number,headRefName,baseRefName,reviewDecision`
2. `gh pr view --comments --json comments,reviews`
3. 정규화하여 finding 으로 변환:
   ```json
   {
     "id": "FND-001",
     "source": "review_comment|issue_comment|review",
     "author": "github-user",
     "submitted_at": "ISO-8601",
     "location": { "file": "src/x.ts", "line": 45 } | null,
     "body": "코멘트 본문",
     "review_state": "CHANGES_REQUESTED|COMMENTED|APPROVED" | null
   }
   ```
4. APPROVED 만 있고 finding 0건 → §0.G3 의 skip 흐름 (Phase 7 직행)

산출물 (양 모드 공통): `review_inventory.json`

---

### 6.6 Phase 7.5 — REQ verified 일괄 승급 (`--close-reqs` 활성 시)

§0.G7 게이트 전부 통과 시에만 실행. 부재 시 본 phase 전체 skip.

#### 6.6.1 영향 REQ-ID 추출

**분모 획득 (§6.6 진입 직전 의무, 후보 추출보다 먼저)**: MCP `get_active_target` 으로 이번 실행의 target 을 해소하고, `list_requirements({ target: <해소한 target>, status: "implemented" })` 로 **분모**를 받는다. 이 둘은 read 이므로 §0.8 의 mutation 금지 밖이며 `--close-reqs` 없이도 호출한다. target 을 해소하지 못하면 **분모를 만들지 못했다고 보고하고 멈춘다** — 임의의 값으로 진행하지 않는다. 분모를 스킬이 스스로 만들지 않는 이유는 하나다: 후보를 자기가 추출하는 한 **덜 추출하면 어떤 게이트도 피할 수 있고**, 같은 주체에게 보고 의무를 더해 봐야 자기선언이 둘로 늘 뿐이다. 이 절차는 Phase 7.4 테스트 충분성 확인(SKILL.md §6.5.1)이 범위를 정하려고 먼저 돌리며, 여기서는 그때 만든 집합을 그대로 쓴다.

네 집합을 이 이름으로 쓴다.

| 이름 | 무엇인가 |
|---|---|
| `denominator` | `list_requirements` 가 돌려준 집합. 스킬이 만들지 않는다 |
| `scoped` | `denominator` 를 이번 실행의 리뷰 범위와 교차한 부분집합. 교차 근거는 아래 `match_confidence` 이며 `high` 미만은 교차에서 빠지되 **제외로 계상한다**. 호출자가 `--sds` 나 `--req-filter` 로 범위를 지명했으면 교차 상대는 그 ID 집합(`--sds` 면 그 SDS 의 `@req` 요구)이고 아래 휴리스틱을 쓰지 않는다 — 지명된 요구가 휴리스틱에 빠져 승급되지 않으면 SDS 가 run 뒤에도 남는다(`kiwi-sds` §3.2) |
| `eligible` | `scoped` 에서 산문 증거 REQ 와 `stability` 가 `draft`·`deprecated` 인 REQ 를 뺀 것. status 가 `implemented` 가 아닌 REQ 는 분모가 이미 걸러 냈다 |
| `transitioned` | 실제로 `verified` 전이에 성공한 수 |
| `excluded` | `scoped` 에서 닫히지 않은 REQ 를 사유와 함께 REQ 단위로 열거한 목록 |

**처분 대조**: `전이 성공 수 + 제외 수 = scoped 크기` 가 성립해야 한다. **항등식이 성립하지 않으면 그 실행은 무효다** — 처분을 받지 못한 REQ 가 있다는 뜻이고, "덜 추출" 이 바로 여기서 개수 불일치로 드러난다. 산문 증거 REQ 와 `draft`·`deprecated` REQ 는 `eligible` 에서 빠지지만 **`scoped` 에는 남고** 제외 사유를 받는다 — `scoped` 에서 빼면 항등식이 그 REQ 의 부재를 보지 못한다.

**trace link 인덱스 (분모 획득 직후, 추가 호출 없음)**: 위 `list_requirements` 응답의 레코드가 이미 `traceReferences` 필드를 담으므로 그것으로 인덱스를 만든다. `summarize_target` 을 여기서 **부르지 않는다** — 그 도구는 카운트와 ID 목록만 돌려주고 trace link 은 하나도 싣지 않으며, 대상을 지명하지 않고 부르면 바로 앞의 `get_active_target` 이 이미 돌려준 활성 target 요약을 그대로 다시 받는다. MCP 미가용 시 source 1 skip + source 2 (scope heuristic) 만 사용 + 추출 결과에 `data_source: "scope-heuristic-only"` 메타 명시.

범위를 지명받지 않았으면 `scoped` 는 `denominator` 를 아래 두 소스와 교차해 얻는다 — 두 소스는 교차의 **근거**이지 집합의 출처가 아니다:
1. 위 `list_requirements` 응답의 레코드 중 변경 파일과 그 `traceReferences` 필드가 매칭되는 REQ
2. 변경 파일 경로 ↔ REQ scope 의 휴리스틱 매칭 (scope name keyword + path prefix 일치, confidence=high 만)

스키마:
```json
{
  "candidate_reqs": [
    { "req_id": "FR-AUTH-001", "match_source": "trace|scope-heuristic", "match_confidence": "high|medium|low", "current_status": "implemented", "stability": "evolving" }
  ],
  "extraction_basis": { "trace_references_used": true, "trace_links_used": N, "scope_heuristic_used": M }
}
```

`match_confidence` < high 항목은 자동 close 대상에서 제외하되 **`excluded` 에 사유와 함께 계상**하고, 보고서 §9 에 후속 검토 권고로 명시.

**처분 회계 (보고 의무)**: `scoped` 의 **모든 REQ 를 REQ 단위로 행으로 열거**하고 각 행이 닫힘 또는 제외 사유 하나를 갖는다. 개수 요약이나 표본으로 줄이지 않는다 — 이 열거가 없으면 위 항등식을 사람이 확인할 수 없고, 확인할 수 없는 항등식은 분모를 밖에서 받은 의미를 지운다.

산출물: `closed_reqs.json.scoped` (각 REQ 에 처분 하나: 닫힘 또는 제외 사유)

#### 6.6.2 MCP 호출 (§0.8 화이트리스트 3종)

각 `eligible` REQ 에 대해 순서대로:

1. `add_verification_evidence({ id: req_id, type: "test", reference: <그 AC 의 인용 테스트 파일>, covers: <그 AC-ID>, notes: "kiwi-review-fix-loop 회귀 검증 통과 (run_id={run-id})" })` — speckiwi MCP schema `covers: z.string().optional()` 준수. AC 마다 1건씩 호출한다. `reference` 와 `covers` 는 Phase 7.4 테스트 충분성 확인(SKILL.md §6.5.1)이 그 AC 에 돌려준 인용에서 가져온다 (`_shared/kiwi/test-sufficiency.md` §4). 인용이 없는 AC 에는 증거를 등록하지 않는다.
2. `check_acceptance_criteria({ id: req_id, acIds: [<인용이 있는 AC-ID>], checked: true })` — **AC 마다 그 AC 를 통과시킨 테스트 식별자는 Phase 7.4 테스트 충분성 확인이 그 AC 에 돌려준 인용(파일 경로와 테스트 줄)이다** — 에이전트가 스스로 테스트를 지목하지 않는다. 직전 1번 호출은 같은 인용을 `reference` 로 등록했다. **지목이 없는 AC 는 체크하지 않는다** — 도구가 인용을 돌려주지 않은 AC 다. `acIds` 에서 빼고 그 REQ 를 `skipped_reason: "unnamed-ac"` 로 기록한다. 체크는 mutation 이므로, 통과하지 않은 AC 를 체크하면 게이트가 형식만 만족된다.
3. `update_status({ id: req_id, status: "verified" })`

순서 의무: evidence 등록 → AC 체크 → status 전이 (앞 단계 실패 시 뒤 단계 skip + skipped_reason 기록). `update-status.ts` 의 게이트가 AC 전량 체크와 증거를 함께 요구하므로, 2번을 건너뛴 3번은 `MUTATION_DENIED` 로 거부된다.

각 호출은 `mcp_call_log.jsonl` 에 1줄 append:
```json
{"called_at": "ISO-8601", "tool": "update_status|add_verification_evidence|check_acceptance_criteria", "args": {...}, "args_hash": "sha1...", "ok": true|false, "response": {...}}
```

#### 6.6.3 멱등성 + 실패 처리

- 동일 `args_hash` 재호출 — 직전 호출 `ok=true` 인 경우에만 skip (dedupe). 직전 `ok=false` 인 경우는 재시도 허용 (일시 실패 복구 시나리오 — resume 시 status 전이 재시도 가능). dedupe 판정은 `mcp_call_log.jsonl` 의 가장 최근 동일 args_hash 엔트리의 `ok` 필드 기준
- `update_status` 가 backward transition (이미 verified) → skip (forward-only)
- MCP 가용 실패 (preflight 결과 mcp=false) → 본 phase 전체 skip + 사용자 보고 + `state.json.pending_close: [...]` 적재 + 후속 CLI fallback 권고
- 부분 실패 (일부 REQ ok, 일부 실패) → `closed_reqs.json` 에 결과별 명시 + 보고서에 명시

#### 6.6.4 산출물

`closed_reqs.json`:
```json
{
  "run_id": "...",
  "trigger": "--close-reqs",
  "scope_mode": "self",
  "candidates_total": N,
  "verified_transitioned": M,
  "skipped": [
    { "req_id": "FR-X-002", "reason": "stability=draft" },
    { "req_id": "FR-X-003", "reason": "current_status=verified (already)" }
  ],
  "failed": [],
  "evidence_refs": ["tests/regression/foo.test.ts#it_returns_200"]
}
```

---

### 7.2 PR 응답 코멘트 (PR 모드 + 응답 활성, §0.13)

`--no-respond` 부재 + PR 모드 + fix 1건 이상 적용 시:

`pr_response.md` 본문 양식:
```markdown
## Review fix summary (kiwi-review-fix-loop)

### Applied fixes
- FND-001 (file:line) — 한 줄 요약 + commit ref (있을 시)
- FND-003 (file:line) — ...

### Discussion needed
- FND-005 — 질문/이슈 본문

### Rejected (with rationale)
- FND-007 [external_library] — 사유: ...

(각 항목은 `[rejection_category]` prefix 사용. enum 은 §0.G5 의 `out_of_scope|already_intended|external_library|misunderstanding` 4종)

Regression tests: PASS (N tests)
```

(시그니처 금지 §0.6 — `🤖 Generated with ...` 등 어떤 도구 식별 정보도 추가 안 함)

`gh pr comment {N} --body-file pr_response.md` 로 작성. 실패 시 사용자 보고 + `state.json.pr_responded: false` 유지.
