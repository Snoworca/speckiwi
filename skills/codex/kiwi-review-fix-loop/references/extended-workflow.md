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
  "axis": "intent|security|edge|concurrency|refactor|error-handling|test-quality",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "title": "short",
  "location": { "file": "src/x.ts", "line_range": "45-67" },
  "description": "body",
  "suggested_fix": "optional",
  "is_behavioral": true,
  "tags": ["bug"]
}
```

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
- regression tests pass
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

1. Call SpecKiwi MCP `get_active_target` and `summarize_target`.
2. Build candidate REQs from trace links and high-confidence scope/path
   heuristics.
3. Exclude candidates below high confidence.
4. Exclude non-`implemented`, `draft`, `deprecated`, and already-`verified`
   candidates.

Mutation order per REQ:

1. `add_verification_evidence` with `type="test"`, concrete reference, and
   optional `covers`.
2. `update_status` to `verified`.

If evidence fails for a REQ, skip its status update. Record every skipped and
failed candidate in `closed_reqs.json`.

## Pipeline Event

Standalone events:

| Field | Value |
|---|---|
| `skill` | `kiwi-review-fix-loop` |
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN` |
| `next_hint` | `kiwi-commit-auto-push` for self-mode success, `null` for PR-mode success or unresolved gates |
| `artifacts.analysis_dir` | `docs/analysis/kiwi-review-fix-loop-{run-id}/` |

Event emission is best-effort.
