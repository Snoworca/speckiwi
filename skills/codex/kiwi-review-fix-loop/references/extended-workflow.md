# Extended Workflow Reference

Load this file only while executing `$kiwi-review-fix-loop`.

## Artifacts

Write under `docs/analysis/kiwi-review-fix-loop-{run-id}/`:

- `preflight.json`
- `mode_decision.json`
- `review_inventory.json`
- `classified_findings.json`
- `fix_iter{N}.json`
- `prickly_recheck_iter{N}.json`
- `regression_run.jsonl`
- `rejected_findings.log`
- `pr_response.md` in PR mode when responding
- `closed_reqs.json` and `mcp_call_log.jsonl` when `--close-reqs` is active
- `report.md`

Use `.kiwi/sessions/{run-id}/state.json` for resumable state.

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
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
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

Classification must account for every finding exactly once:

| Class | Action |
|---|---|
| `immediate_fix` | fix automatically after TDD gate when applicable |
| `discussion_needed` | ask the user unless `--auto` can safely reclassify |
| `rejected` | record reason; include in PR response when applicable |

In `--auto`, CRITICAL/HIGH/MEDIUM discussion findings may be converted to
`immediate_fix` only when the classifier supplies a concrete fix hypothesis.
LOW discussion findings may be rejected with a reason.

## Regression And Review Loop

Behavioral fixes require a regression test. Style-only, naming-only, formatting,
comment, and doc-only fixes may be TDD-exempt.

Exit criteria:

- CRITICAL=0
- HIGH=0
- the preservation scan over the fixer diff found no violation (SKILL.md
  보존 스캔 section); a detection is CRITICAL and halts through its gate
- the review coverage comparison passed (SKILL.md 리뷰 커버리지 분모 section);
  a round whose anchors do not check out is invalid, spends the cap and
  records no pass, and two consecutive invalid rounds halt at
  `review-coverage-mismatch`
- regression has no new failures against the captured baseline (SKILL.md
  regression baseline section); pre-existing failures are reported, not
  attributed to this fix
- in `--max`, two consecutive MEDIUM-zero rechecks when practical

Repeated failure gates:

| Condition | Gate |
|---|---|
| fixer retries reach 3 for one finding | user decision |
| same finding remains after 2 rechecks | user decision |
| same regression file fails twice | user decision |

## PR Response

When PR mode applies at least one fix and `--no-respond` is absent, write one PR
comment with:

- applied fixes
- discussion-needed items
- rejected items with reasons
- regression command summary

Do not include tool signatures.

## Close Requirements

Before `--close-reqs` mutations:

1. Call SpecKiwi MCP `get_active_target` to resolve this run's target, then call
   `list_requirements({ target, status: "implemented" })`. What it returns is the
   DENOMINATOR. Both are reads, so they sit outside the section-zero mutation
   prohibition and run without `--close-reqs`. If the target cannot be
   resolved, report that the denominator could not be built and stop; do not
   proceed on a guessed value. The skill does not build this set itself: while
   it does, extracting less is a way past any gate keyed on it, and a reporting
   duty laid on the same actor only produces a second self-declaration.
2. Call `summarize_target` for the trace-link index.
3. Build the SCOPED set by intersecting the denominator with this run's review
   scope, using trace links and high-confidence scope/path heuristics.
4. Candidates below high confidence leave the intersection but are COUNTED AS
   EXCLUDED, not dropped.

Four names, used exactly:

| Name | What it is |
|---|---|
| `denominator` | what `list_requirements` returned; the skill does not build it |
| `scoped` | the denominator intersected with this run's review scope |
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

1. `add_verification_evidence` with `type="test"`, a concrete reference, and
   `covers` naming the acceptance criterion that reference proves.
2. `check_acceptance_criteria` for those criteria. For each acceptance
   criterion, name the test identifier that passed it first — a file path and
   test name, or the `reference` step 1 registered under `covers` for that
   same criterion. Do not check a criterion for which no such identifier is
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
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN`. Under `--close-reqs`, `TASK_DONE` additionally requires the promotion result: if `eligible` is at least one and `transitioned` is zero, the run is `FAILED`, and so is one whose accounting identity does not hold. A run without `--close-reqs` is unaffected. Values come from the enum `_shared/kiwi/pipeline-event.md` declares; no new value is introduced |
| `next_hint` | `kiwi-commit-auto-push` for self-mode success, `null` for PR-mode success or unresolved gates |
| `artifacts.analysis_dir` | `docs/analysis/kiwi-review-fix-loop-{run-id}/` |

Event emission is best-effort.
