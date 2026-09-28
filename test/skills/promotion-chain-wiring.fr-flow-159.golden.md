skills/claude/kiwi-review-fix-loop/references/conditional-sections.md
---
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
=== promotion section ===
skills/codex/kiwi-review-fix-loop/SKILL.md
---
## `--close-reqs` Gate

Skip or halt when:

| Condition | Action |
|---|---|
| `--close-reqs` absent | no SRS mutation |
| PR mode | halt; close after merge or in self mode |
| regression failed or skipped without evidence | halt |
| CRITICAL/HIGH finding remains | halt |
| the test-sufficiency step raised `test-sufficiency-gap` | halt; a requirement whose gaps remain is not written as `verified` (Test Sufficiency section) |
| a target requirement rests on **prose** as verification **evidence** | this skill does not close it; report the omission instead — it reviews only code (파일 부류 경계), so it cannot run the full-document audit `FR-FLOW-136` AC-6 gates the close with, and an obligation a skill cannot discharge is not a gate. **No pipeline path closes such a requirement automatically** — a person audits and closes it. Say so in the report, so an unclosed requirement does not read as a failure |
| `scoped` is empty | skip, and report the denominator's size and why the intersection came out zero |
| `eligible` is at least one and `transitioned` is zero | NOT `TASK_DONE`; end `FAILED` and report |
| `transitioned + excluded` does not equal `scoped` | the run is invalid; end `FAILED` and enumerate the requirements that received no disposition |
| impacted REQ stability is `draft` or `deprecated` | skip that REQ |
| impacted REQ status is not `implemented` | skip that REQ. It is outside the denominator, so it enters neither `scoped` nor the accounting identity |

For each eligible REQ:

1. Call `add_verification_evidence` with `type="test"`, `reference` = the test file the test-sufficiency
   step cited for an acceptance criterion and `covers` = that criterion, once per cited criterion
   (`../_shared/kiwi/test-sufficiency.md` §4).
2. Call `check_acceptance_criteria` for those criteria. **For each acceptance criterion, the test
   identifier that passed it is the citation the test-sufficiency step returned for it** — a file path
   and test line; the agent does not name one itself, and step 1 registered that citation as the
   `reference` under `covers` for that same criterion. **Do not check a criterion for which no such
   identifier is named** — one the tool returned no citation for: leave it out of `acIds` and record
   the requirement as skipped. Checking is a mutation, so a
   criterion ticked without a named test satisfies the gate in form only.
3. Then call `update_status` to `verified`. `update-status.ts` requires every criterion checked AND
   evidence present, so a transition attempted without step 2 returns `MUTATION_DENIED`.
4. Log each call and result.
=== promotion section ===
skills/codex/kiwi-review-fix-loop/references/extended-workflow.md
---
## Close Requirements

Before `--close-reqs` mutations (the test-sufficiency step runs steps 1-4 and applies the name table below first to build `eligible`, and the promotion reuses that set):

1. Call SpecKiwi MCP `get_active_target` to resolve this run's target, then call
   `list_requirements({ target, status: "implemented" })`. What it returns is the
   DENOMINATOR. Both are reads, so they sit outside the section-zero mutation
   prohibition and run without `--close-reqs`. If the target cannot be
   resolved, report that the denominator could not be built and stop; do not
   proceed on a guessed value. The skill does not build this set itself: while
   it does, extracting less is a way past any gate keyed on it, and a reporting
   duty laid on the same actor only produces a second self-declaration.
2. Build the trace-link index from the `list_requirements` records already in
   hand: each record carries `traceReferences`. Do not call `summarize_target`
   for it - that reader returns counts and identifier lists and carries no trace
   link at all, and called without a target it answers with the same active-target
   summary step 1 already received.
3. Build the SCOPED set by intersecting the denominator with this run's review
   scope, using trace links and high-confidence scope/path heuristics — unless
   the caller named the scope with `--sds` or `--req-filter`, in which case the
   intersection is taken with that ID set (see the `scoped` row).
4. Candidates below high confidence leave the intersection but are COUNTED AS
   EXCLUDED, not dropped.

Four names, used exactly:

| Name | What it is |
|---|---|
| `denominator` | what `list_requirements` returned; the skill does not build it |
| `scoped` | the denominator intersected with this run's review scope. When the caller named the scope with `--sds` or `--req-filter`, the intersection is taken with that ID set (for `--sds`, the SDS's `@req` requirements) and the heuristics of step 3 are not used — a named requirement the heuristics missed would stay unpromoted and keep the SDS alive after the run (`kiwi-sds` §3.2) |
| `eligible` | `scoped` minus prose-evidence requirements and those whose stability is `draft` or `deprecated`; a status other than `implemented` was already filtered by the denominator |
| `transitioned` | how many actually reached `verified` |
| `excluded` | the requirements in `scoped` that were not closed, enumerated one per requirement with a reason |

Accounting identity: `transitioned + excluded == scoped`. A run whose
dispositions do not account for the whole scoped set is INVALID — some
requirement received no disposition, and that is where under-extraction shows
up as a count that does not add up. Prose-evidence requirements and
`draft`/`deprecated` ones are excluded from eligibility but REMAIN IN THE
SCOPED SET carrying their reason; dropping them would make the identity blind
to exactly the requirements a person still has to act on.

Mutation order per REQ:

1. `add_verification_evidence` with `type="test"`, `reference` = the test
   file the test-sufficiency step cited for the acceptance criterion, and
   `covers` = that criterion (`../../_shared/kiwi/test-sufficiency.md` §4).
2. `check_acceptance_criteria` for those criteria. For each acceptance
   criterion, the test identifier that passed it is the citation the
   test-sufficiency step returned for it — the agent does not name one
   itself. Do not check a criterion for which no such identifier is
   named; leave it out of `acIds` and record the requirement as skipped.
3. `update_status` to `verified`.

If evidence fails for a REQ, skip its status update. Record every skipped and
failed candidate in `closed_reqs.json`.

Report the accounting by enumerating one row per requirement in `scoped`, each
carrying either its close or one exclusion reason. Do not summarise it into
counts or a sample: without the enumeration nobody can check the identity by
hand, and an identity nobody can check makes obtaining the denominator
externally pointless. When `scoped` is empty, report the DENOMINATOR'S SIZE and
why the intersection came out zero rather than reporting no candidates — a
denominator of zero is itself the signal (FR-NODE-198: a requirement written
with a status outside the enum never enters it).
=== promotion section ===
skills/etc/kiwi-review-fix-loop/SKILL.md
---
## `--close-reqs` Gate

Skip or halt when:

| Condition | Action |
|---|---|
| `--close-reqs` absent | no SRS mutation |
| PR mode | halt; close after merge or in self mode |
| regression failed or skipped without evidence | halt |
| CRITICAL/HIGH finding remains | halt |
| the test-sufficiency step raised `test-sufficiency-gap` | halt; a requirement whose gaps remain is not written as `verified` (Test Sufficiency section) |
| a target requirement rests on **prose** as verification **evidence** | this skill does not close it; report the omission instead — it reviews only code (파일 부류 경계), so it cannot run the full-document audit `FR-FLOW-136` AC-6 gates the close with, and an obligation a skill cannot discharge is not a gate. **No pipeline path closes such a requirement automatically** — a person audits and closes it. Say so in the report, so an unclosed requirement does not read as a failure |
| `scoped` is empty | skip, and report the denominator's size and why the intersection came out zero |
| `eligible` is at least one and `transitioned` is zero | NOT `TASK_DONE`; end `FAILED` and report |
| `transitioned + excluded` does not equal `scoped` | the run is invalid; end `FAILED` and enumerate the requirements that received no disposition |
| impacted REQ stability is `draft` or `deprecated` | skip that REQ |
| impacted REQ status is not `implemented` | skip that REQ. It is outside the denominator, so it enters neither `scoped` nor the accounting identity |

For each eligible REQ:

1. Call `add_verification_evidence` with `type="test"`, `reference` = the test file the test-sufficiency
   step cited for an acceptance criterion and `covers` = that criterion, once per cited criterion
   (`../_shared/kiwi/test-sufficiency.md` §4).
2. Call `check_acceptance_criteria` for those criteria. **For each acceptance criterion, the test
   identifier that passed it is the citation the test-sufficiency step returned for it** — a file path
   and test line; the agent does not name one itself, and step 1 registered that citation as the
   `reference` under `covers` for that same criterion. **Do not check a criterion for which no such
   identifier is named** — one the tool returned no citation for: leave it out of `acIds` and record
   the requirement as skipped. Checking is a mutation, so a
   criterion ticked without a named test satisfies the gate in form only.
3. Then call `update_status` to `verified`. `update-status.ts` requires every criterion checked AND
   evidence present, so a transition attempted without step 2 returns `MUTATION_DENIED`.
4. Log each call and result.
=== promotion section ===
skills/etc/kiwi-review-fix-loop/references/extended-workflow.md
---
## Close Requirements

Before `--close-reqs` mutations (the test-sufficiency step runs steps 1-4 and applies the name table below first to build `eligible`, and the promotion reuses that set):

1. Call SpecKiwi MCP `get_active_target` to resolve this run's target, then call
   `list_requirements({ target, status: "implemented" })`. What it returns is the
   DENOMINATOR. Both are reads, so they sit outside the section-zero mutation
   prohibition and run without `--close-reqs`. If the target cannot be
   resolved, report that the denominator could not be built and stop; do not
   proceed on a guessed value. The skill does not build this set itself: while
   it does, extracting less is a way past any gate keyed on it, and a reporting
   duty laid on the same actor only produces a second self-declaration.
2. Build the trace-link index from the `list_requirements` records already in
   hand: each record carries `traceReferences`. Do not call `summarize_target`
   for it - that reader returns counts and identifier lists and carries no trace
   link at all, and called without a target it answers with the same active-target
   summary step 1 already received.
3. Build the SCOPED set by intersecting the denominator with this run's review
   scope, using trace links and high-confidence scope/path heuristics — unless
   the caller named the scope with `--sds` or `--req-filter`, in which case the
   intersection is taken with that ID set (see the `scoped` row).
4. Candidates below high confidence leave the intersection but are COUNTED AS
   EXCLUDED, not dropped.

Four names, used exactly:

| Name | What it is |
|---|---|
| `denominator` | what `list_requirements` returned; the skill does not build it |
| `scoped` | the denominator intersected with this run's review scope. When the caller named the scope with `--sds` or `--req-filter`, the intersection is taken with that ID set (for `--sds`, the SDS's `@req` requirements) and the heuristics of step 3 are not used — a named requirement the heuristics missed would stay unpromoted and keep the SDS alive after the run (`kiwi-sds` §3.2) |
| `eligible` | `scoped` minus prose-evidence requirements and those whose stability is `draft` or `deprecated`; a status other than `implemented` was already filtered by the denominator |
| `transitioned` | how many actually reached `verified` |
| `excluded` | the requirements in `scoped` that were not closed, enumerated one per requirement with a reason |

Accounting identity: `transitioned + excluded == scoped`. A run whose
dispositions do not account for the whole scoped set is INVALID — some
requirement received no disposition, and that is where under-extraction shows
up as a count that does not add up. Prose-evidence requirements and
`draft`/`deprecated` ones are excluded from eligibility but REMAIN IN THE
SCOPED SET carrying their reason; dropping them would make the identity blind
to exactly the requirements a person still has to act on.

Mutation order per REQ:

1. `add_verification_evidence` with `type="test"`, `reference` = the test
   file the test-sufficiency step cited for the acceptance criterion, and
   `covers` = that criterion (`../../_shared/kiwi/test-sufficiency.md` §4).
2. `check_acceptance_criteria` for those criteria. For each acceptance
   criterion, the test identifier that passed it is the citation the
   test-sufficiency step returned for it — the agent does not name one
   itself. Do not check a criterion for which no such identifier is
   named; leave it out of `acIds` and record the requirement as skipped.
3. `update_status` to `verified`.

If evidence fails for a REQ, skip its status update. Record every skipped and
failed candidate in `closed_reqs.json`.

Report the accounting by enumerating one row per requirement in `scoped`, each
carrying either its close or one exclusion reason. Do not summarise it into
counts or a sample: without the enumeration nobody can check the identity by
hand, and an identity nobody can check makes obtaining the denominator
externally pointless. When `scoped` is empty, report the DENOMINATOR'S SIZE and
why the intersection came out zero rather than reporting no candidates — a
denominator of zero is itself the signal (FR-NODE-198: a requirement written
with a status outside the enum never enters it).
=== promotion section ===
.agents/skills/kiwi-review-fix-loop/SKILL.md
---
## `--close-reqs` Gate

Skip or halt when:

| Condition | Action |
|---|---|
| `--close-reqs` absent | no SRS mutation |
| PR mode | halt; close after merge or in self mode |
| regression failed or skipped without evidence | halt |
| CRITICAL/HIGH finding remains | halt |
| the test-sufficiency step raised `test-sufficiency-gap` | halt; a requirement whose gaps remain is not written as `verified` (Test Sufficiency section) |
| a target requirement rests on **prose** as verification **evidence** | this skill does not close it; report the omission instead — it reviews only code (파일 부류 경계), so it cannot run the full-document audit `FR-FLOW-136` AC-6 gates the close with, and an obligation a skill cannot discharge is not a gate. **No pipeline path closes such a requirement automatically** — a person audits and closes it. Say so in the report, so an unclosed requirement does not read as a failure |
| `scoped` is empty | skip, and report the denominator's size and why the intersection came out zero |
| `eligible` is at least one and `transitioned` is zero | NOT `TASK_DONE`; end `FAILED` and report |
| `transitioned + excluded` does not equal `scoped` | the run is invalid; end `FAILED` and enumerate the requirements that received no disposition |
| impacted REQ stability is `draft` or `deprecated` | skip that REQ |
| impacted REQ status is not `implemented` | skip that REQ. It is outside the denominator, so it enters neither `scoped` nor the accounting identity |

For each eligible REQ:

1. Call `add_verification_evidence` with `type="test"`, `reference` = the test file the test-sufficiency
   step cited for an acceptance criterion and `covers` = that criterion, once per cited criterion
   (`../_shared/kiwi/test-sufficiency.md` §4).
2. Call `check_acceptance_criteria` for those criteria. **For each acceptance criterion, the test
   identifier that passed it is the citation the test-sufficiency step returned for it** — a file path
   and test line; the agent does not name one itself, and step 1 registered that citation as the
   `reference` under `covers` for that same criterion. **Do not check a criterion for which no such
   identifier is named** — one the tool returned no citation for: leave it out of `acIds` and record
   the requirement as skipped. Checking is a mutation, so a
   criterion ticked without a named test satisfies the gate in form only.
3. Then call `update_status` to `verified`. `update-status.ts` requires every criterion checked AND
   evidence present, so a transition attempted without step 2 returns `MUTATION_DENIED`.
4. Log each call and result.
=== promotion section ===
.agents/skills/kiwi-review-fix-loop/references/extended-workflow.md
---
## Close Requirements

Before `--close-reqs` mutations (the test-sufficiency step runs steps 1-4 and applies the name table below first to build `eligible`, and the promotion reuses that set):

1. Call SpecKiwi MCP `get_active_target` to resolve this run's target, then call
   `list_requirements({ target, status: "implemented" })`. What it returns is the
   DENOMINATOR. Both are reads, so they sit outside the section-zero mutation
   prohibition and run without `--close-reqs`. If the target cannot be
   resolved, report that the denominator could not be built and stop; do not
   proceed on a guessed value. The skill does not build this set itself: while
   it does, extracting less is a way past any gate keyed on it, and a reporting
   duty laid on the same actor only produces a second self-declaration.
2. Build the trace-link index from the `list_requirements` records already in
   hand: each record carries `traceReferences`. Do not call `summarize_target`
   for it - that reader returns counts and identifier lists and carries no trace
   link at all, and called without a target it answers with the same active-target
   summary step 1 already received.
3. Build the SCOPED set by intersecting the denominator with this run's review
   scope, using trace links and high-confidence scope/path heuristics — unless
   the caller named the scope with `--sds` or `--req-filter`, in which case the
   intersection is taken with that ID set (see the `scoped` row).
4. Candidates below high confidence leave the intersection but are COUNTED AS
   EXCLUDED, not dropped.

Four names, used exactly:

| Name | What it is |
|---|---|
| `denominator` | what `list_requirements` returned; the skill does not build it |
| `scoped` | the denominator intersected with this run's review scope. When the caller named the scope with `--sds` or `--req-filter`, the intersection is taken with that ID set (for `--sds`, the SDS's `@req` requirements) and the heuristics of step 3 are not used — a named requirement the heuristics missed would stay unpromoted and keep the SDS alive after the run (`kiwi-sds` §3.2) |
| `eligible` | `scoped` minus prose-evidence requirements and those whose stability is `draft` or `deprecated`; a status other than `implemented` was already filtered by the denominator |
| `transitioned` | how many actually reached `verified` |
| `excluded` | the requirements in `scoped` that were not closed, enumerated one per requirement with a reason |

Accounting identity: `transitioned + excluded == scoped`. A run whose
dispositions do not account for the whole scoped set is INVALID — some
requirement received no disposition, and that is where under-extraction shows
up as a count that does not add up. Prose-evidence requirements and
`draft`/`deprecated` ones are excluded from eligibility but REMAIN IN THE
SCOPED SET carrying their reason; dropping them would make the identity blind
to exactly the requirements a person still has to act on.

Mutation order per REQ:

1. `add_verification_evidence` with `type="test"`, `reference` = the test
   file the test-sufficiency step cited for the acceptance criterion, and
   `covers` = that criterion (`../../_shared/kiwi/test-sufficiency.md` §4).
2. `check_acceptance_criteria` for those criteria. For each acceptance
   criterion, the test identifier that passed it is the citation the
   test-sufficiency step returned for it — the agent does not name one
   itself. Do not check a criterion for which no such identifier is
   named; leave it out of `acIds` and record the requirement as skipped.
3. `update_status` to `verified`.

If evidence fails for a REQ, skip its status update. Record every skipped and
failed candidate in `closed_reqs.json`.

Report the accounting by enumerating one row per requirement in `scoped`, each
carrying either its close or one exclusion reason. Do not summarise it into
counts or a sample: without the enumeration nobody can check the identity by
hand, and an identity nobody can check makes obtaining the denominator
externally pointless. When `scoped` is empty, report the DENOMINATOR'S SIZE and
why the intersection came out zero rather than reporting no candidates — a
denominator of zero is itself the signal (FR-NODE-198: a requirement written
with a status outside the enum never enters it).