# Extended Workflow Reference

Load this file only while executing `kiwi-hot-fix`.

## Artifacts

Write under `docs/analysis/kiwi-hot-fix-{run-id}/`:

- `input_inventory.json`
- `root_cause.json`
- `regression_test.json`
- `fix_summary.json`
- `formal_review_iter{N}.json`
- `prickly_review_iter{N}.json`
- `regression_run.jsonl`
- `test_sufficiency.json`
- `sync_delegation.json`
- `report.md`

Use `.kiwi/sessions/{run-id}/state.json` for resumable phase state and
`worklog.jsonl` for append-only events.

## Input Detection

Priority:

1. Explicit `ISSUE_URL=...`
2. GitHub issue URL in the user prompt
3. Natural-language bug symptom of at least 20 characters
4. Existing git status changes, after a user confirmation gate

No source means halt and ask for the bug symptom or issue URL.

## Root-Cause Review

Run these passes sequentially:

| Pass | Output |
|---|---|
| symptom analysis | reproduction steps, likely root causes, complexity estimate |
| scope analysis | affected files/modules, candidate REQ IDs each with `match_confidence` (high / medium / low), external module touch, coverage status |

Adopt the highest-confidence hypothesis that has code evidence. If the fix later
changes unrelated behavior, treat that as
`zero-tolerance-hypothesis-fix-mismatch`.

## TDD And Fix

For normal hot-fixes:

1. Write a regression test. When an impacted requirement is mapped, its title line cites `<REQ-ID> AC-<n>` (citation convention in `../../_shared/kiwi/test-sufficiency.md` §1).
2. Run it and capture red failure.
3. Apply the smallest fix.
4. Run the same test and capture green.
5. Run affected tests or broader regression.

If `TDD_EXEMPT_REASON` is supplied, store it and make the reviewer evaluate
whether the exception is acceptable. The exception does not remove regression
risk reporting.

## Review Loop

Formal review checks syntax/type, import/export, style consistency, and TDD
sequence. Prickly review checks root-cause fit, regression risk, security,
performance, concurrency, error handling, and hot-fix appropriateness.

Exit when:

- CRITICAL=0
- HIGH=0
- regression tests pass
- the single evaluator returns three consecutive no-actionable-improvement
  evaluations

Repeated failure gates:

| Condition | Gate |
|---|---|
| fixer retries reach 3 | user decision |
| same prickly finding remains after 2 review retries | user decision |
| same regression test fails twice after attempted fix | user decision |

## Sync Delegation

Right before delegating, run the test-sufficiency check of
`../../_shared/kiwi/test-sufficiency.md` over the scope `--ids <the
candidate_req_ids root-cause mapped with match_confidence=high>` and record the
result as `test_sufficiency.json`. When gaps remain, halt at
`test-sufficiency-gap` and do not delegate. An empty scope records `no-scope`
and the delegation proceeds — `kiwi-srs-sync` reruns the same check right
before it writes `verified`. A run that does not delegate (`--no-sync`,
dry-run-only, or a blocking gate) does not run it. Under `--dry-run` it reports the
first result without a fill, as contract §3 says.

After fix + regression success and the test-sufficiency check, delegate:

```text
Use the kiwi-srs-sync skill with --files=<changed-files>
```

Propagate:

| Hot-fix flag | Sync flag |
|---|---|
| `--auto` | `--auto` |
| `--mini` / `--loops N` | `--mini` / `--loops N` |
| user explicitly supplied `--auto-apply` or `--yes-all` | propagate the same explicit apply flag after hot-fix review and regression gates pass |
| `--dry-run` | `--dry-run-only` |

If delegation fails, write `pending_sync` into state and report the exact files
and suggested `kiwi-srs-sync` invocation.

## Pipeline Event

Standalone events:

| Field | Value |
|---|---|
| `skill` | `kiwi-hot-fix` |
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN` |
| `next_hint` | `kiwi-commit-auto-push` after successful fix/sync, `kiwi-pipeline` when sync follow-up remains, otherwise `null` |
| `artifacts.analysis_dir` | `docs/analysis/kiwi-hot-fix-{run-id}/` |

Event emission is best-effort.
