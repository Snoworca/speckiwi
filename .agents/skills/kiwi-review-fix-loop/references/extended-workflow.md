# Extended Workflow Reference

Load this file only while executing `$kiwi-review-fix-loop`.

## Artifacts

Write under `docs/analysis/kiwi-review-fix-loop-{run-id}/`:

- `mode_decision.json`
- `review_inventory.json`
- `classified_findings.json`
- `fix_iter{N}.json`
- `prickly_recheck_iter{N}.json`
- `regression_run.jsonl`
- `rejected_findings.log`
- `pr_response.md` in PR mode when responding
- `test_sufficiency.json` when a requirement scope is known (SKILL.md Test Sufficiency section)
- `closed_reqs.json` and `mcp_call_log.jsonl` when `--close-reqs` is active
- `report.md`

Use `.kiwi/sessions/{run-id}/state.json` for resumable state. Record the clean-code skip answer in `state.json` as `clean_code_skip` (`true` when the user confirmed the skip or `--auto` skipped it, `false` when there was no signal or the user declined) in Phase 0, as soon as the answer is given and before any further phase runs; a resumed run follows the recorded value instead of asking again (SKILL.md 클린 코드 라운드 block). Record the clean-code round number in `state.json` as `clean_code_round` when each round starts, and each `dismissed` finding (principle, location, reason) in `clean_code_dismissed` as soon as the classifier marks it; a resumed run continues the count from the recorded round, never past 3, and still passes the recorded `dismissed` findings to the reviewer without counting them (SKILL.md 클린 코드 라운드 block).

At the start, record the guarantee scope of the code under review in `state.json` as `guarantee_scope`, and keep `declared_limits[]` (each `{ id, reason, evidence }`), `limits` (`round_cap`, the mode's default cap unless `--loops` sets it, and `token_budget`, a positive integer or null) and `rounds[]`. Each `rounds[]` entry holds `round`, `tree_sha`, `scope` (`since-prev` or `full`), `scope_widen_reason` (string or null), `files[]`, `tokens_used`, `residual_count`, `coverage_passed` and `findings[]` of `{ id, tier: block|record, family, introduced_by_round }` (FR-NODE-274 AC-1); this record is the input of `check_review_round`. A blocking kept finding an earlier round left unresolved is carried again into that round's `findings[]`, keeping its `id`, `family` and `introduced_by_round` as first recorded, so `check_review_round`, which reads only the latest round, counts every blocking finding that remains. A resumed run keeps `guarantee_scope`, `limits`, `declared_limits[]` and the `rounds[]` entries it already holds.

When each round's review starts (round 1 included), snapshot the working tree into a temporary index and record the tree as that round's `tree_sha`, without a commit; the real index, HEAD and refs are untouched, and `<tmp>` is deleted afterwards:

```
GIT_INDEX_FILE=<tmp> git read-tree HEAD
GIT_INDEX_FILE=<tmp> git add -A
GIT_INDEX_FILE=<tmp> git write-tree
```

## Mode And Scope

PR mode triggers:

- `--pr`, `-pr`, `--PR`, `-PR`
- `--pr=<url>`
- natural-language request to read or apply PR review comments

Self mode scope priority:

1. `--files`
2. `--commits`
3. `--since`
4. `--base` + `--head`
5. current working tree and staged diff
6. `HEAD~5..HEAD` only after a user confirmation gate

## Finding Schema

Normalize findings to:

```json
{
  "id": "FND-001",
  "axis": "intent|security|edge|concurrency|refactor|error-handling|test-quality|comment-claim",
  "verdict": "keep|drop|residual",
  "evidence": "failing test id, reproduction, or command output (required for keep)",
  "drop_reason": "why it was dropped (required for drop)",
  "title": "short",
  "location": { "file": "src/x.ts", "line_range": "45-67" },
  "description": "body",
  "suggested_fix": "optional",
  "is_behavioral": true,
  "tags": ["bug"]
}
```

The reviewer also returns `coverage_rows[]`, one row per file of
`review_denominator[]`, each carrying one anchor per hunk. The rule and the
three comparisons the loop runs over those anchors are in the SKILL.md
리뷰 커버리지 분모 section; do not restate them here.

The reviewer also returns `clean_code[]`, one entry per clean-code finding with `principle` and `location`; these entries are not findings of the keep/drop verdict (SKILL.md 클린 코드 라운드 block). Each later clean-code round passes the reviewer the findings already `dismissed`; a re-raised one (same principle, same location) is not a finding of that round, and a `dismissed` finding is never reported `unresolved` (same block).

Classification must account for every finding exactly once:

| Class | Action |
|---|---|
| `immediate_fix` | blocking kept findings (and record findings the user raised to blocking): fix automatically after TDD gate when applicable |
| `declared_limit` | record kept findings — proven by a failing test, but with no real call path or outside the guarantee scope, and not of a blocking kind: not fixed; listed with their evidence among `declared_limits[]`; the user may raise one to blocking, which moves it to `immediate_fix` |
| `discussion_needed` | ask the user unless `--auto` can safely reclassify it; a residual is never reclassified (critical gate `residual-finding-user-decision`) |
| `rejected` | record reason; include in PR response when applicable |

The lead (classifier), not the reviewer, records each kept finding's `tier`
(`block` or `record`), its `family`, and `introduced_by_round` (the round whose
fix introduced it, or null) in `classified_findings.json`; the four classes sum
to the inventory.

In `--auto`, blocking kept findings are fixed automatically, record kept findings are reported as declared limits without a fix, dropped findings are
reported with their reason, and residual findings go to user decision; `--auto`
never raises a record finding to blocking. Severity
labels are not used to route findings (FR-FLOW-203).

## Regression And Review Loop

Behavioral fixes require a regression test. Style-only, naming-only, formatting,
comment, and doc-only fixes may be TDD-exempt.
Clean-code round fixes are TDD-exempt as well, and each is kept only when the run's regression test command passes (SKILL.md 클린 코드 라운드 block).

Exit criteria:

- no blocking kept finding remains (SKILL.md Keep/Drop 종료 판정 section); a
  record (`declared_limit`) finding never blocks the pass, and no residual
  finding remains
- at every round end, call `check_review_round` (CLI `speckiwi review-round check`) and follow its verdict
  (`PASS`, `NEEDS_USER` or `CONTINUE`) for scope, the earlier-round-fix
  majority, pass, and the cap or budget stop
- the preservation scan over the fixer diff found no violation (SKILL.md
  보존 스캔 section); a detection is CRITICAL and halts through its gate
  (a clean-code fix that trips it is reverted and marked `unresolved` instead, without halting; SKILL.md 클린 코드 라운드 block)
- the review coverage comparison passed (SKILL.md 리뷰 커버리지 분모 section);
  a round whose anchors do not check out is invalid, spends the cap and
  records no pass, and two consecutive invalid rounds halt at
  `review-coverage-mismatch`
- regression has no new failures against the captured baseline (SKILL.md
  regression baseline section); pre-existing failures are reported, not
  attributed to this fix
- two consecutive rounds that resolve no blocking kept finding end the loop, and a run the guard ends while a blocking kept finding remains ends `NEEDS_USER`, not a pass (the convergence guard)
- the round cap reached or the token budget exceeded while a blocking kept finding remains ends the run `NEEDS_USER` with the blocking and record lists, not a pass (critical gate `round-cap-or-budget-needs-user`)
- blocking kept findings introduced by an earlier round's fix that outnumber half of a round's blocking findings end the run `NEEDS_USER` with the blocking and record lists (critical gate `fix-induced-defects-majority`); this is checked every round, independently of the convergence streak

Repeated failure gates:

| Condition | Gate |
|---|---|
| fixer retries reach 3 for one finding | user decision |
| same finding remains after 2 rechecks | user decision |
| same regression file fails twice | user decision |

A reverted clean-code fix does not count toward these gates (SKILL.md 클린 코드 라운드 block).

When a finding belongs to a family whose members were kept in at least two earlier rounds, the fixer applies the lead's recorded `family_action` (`standard-tool`, `single-rule` or `declare-limit`) instead of patching the member alone.

## PR Response

When PR mode applies at least one fix and `--no-respond` is absent, write one PR
comment with:

- applied fixes
- discussion-needed items
- declared limits (record findings) with their evidence
- rejected items with reasons
- regression command summary

Do not include tool signatures.

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

## Pipeline Event

Standalone events:

| Field | Value |
|---|---|
| `skill` | `kiwi-review-fix-loop` |
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN`. Under `--close-reqs`, `TASK_DONE` additionally requires the promotion result: if `eligible` is at least one and `transitioned` is zero, the run is `FAILED`, and so is one whose accounting identity does not hold. A run without `--close-reqs` is unaffected. `NEEDS_USER` also covers a stop the round check returns: the round cap, the token budget, the convergence guard with a blocking kept finding remaining, or the earlier-round-fix majority. Values come from the enum `_shared/kiwi/pipeline-event.md` declares; no new value is introduced |
| `next_hint` | `kiwi-commit-auto-push` for self-mode success, `null` for PR-mode success or unresolved gates |
| `artifacts.analysis_dir` | `docs/analysis/kiwi-review-fix-loop-{run-id}/` |

Event emission is best-effort.
