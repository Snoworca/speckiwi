# Extended Workflow Reference

Load this file only while executing `$kiwi-hot-fix`.

## Artifacts

Write under `docs/analysis/kiwi-hot-fix-{run-id}/`:

- `input_inventory.json`
- `bug_repro.json`
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

## Root Cause And Reproduction

This skill does not analyse root causes or write reproduction tests itself.
Both belong to `$kiwi-bug-repro`, which infers candidate causes by static
analysis and reproduces from the smallest scope outward.

Before the call:

1. With `TDD_EXEMPT_REASON` given from the start, skip only the reproduction test: call `$kiwi-bug-repro --analysis-only` for the ordered causes and take the most likely cause as the fix hypothesis; that mode runs no stage and writes no test.
2. With `BUG_REPRO_REPORT=<dir>`, or when the previous pipeline event is a `kiwi-bug-repro` run on the same input (its `artifacts.analysis_dir`), use that report instead of reproducing again. Compare its `input.md` with the detected input; when they differ, invoke the skill anew. When an existing report is used for a git-status input, the red check still needs a HEAD worktree: create and prepare it as below, place that report's reproduction test in it at the same path, and check red there.

Invoke it with the input detection found, unchanged — the issue (its link or
the body read), or the natural-language symptom — plus `--no-pipeline-emit`,
and propagate `--auto`, `--max`, `--model`, `--mini` / `--loops N`.

When the input is an issue or a symptom description and the working tree holds
uncommitted changes, stop and ask the user before reproducing
(`repro-dirty-tree`, also under `--auto`): those changes would mix with the
fix, so neither the green result nor the fix diff could be attributed. The changes that count are uncommitted changes to tracked files other than the
files a `$kiwi-bug-repro` run for this input recorded in its `state.json` whose current hash still matches the recorded one and which that run created or found unchanged from HEAD before its edit, and that run's report directory, and this check runs before the reproduction skill is called, `--analysis-only` included, and before an existing report is used. Go on
once the user has committed or set the changes aside, or treat the input as a
git-status input when the user says those changes are the fix for this bug.

For a git-status input, this skill never stashes, resets or checks out the
user's change. Reproduce in a temporary worktree of HEAD instead: create it with
`git worktree add <OS temp dir>/kiwi-hot-fix-{run-id} HEAD` and record its path
as `repro_worktree` and the sha of that HEAD as `repro_base` in `state.json`. `git worktree add` brings no ignored files
such as `node_modules`, so before invoking the skill, prepare the worktree's
dependencies from the repository's lockfile with an install command that runs no
lifecycle scripts (for example `npm ci --ignore-scripts`). An ecosystem with no
lockfile (Maven, Gradle and the like) uses its build tool's command that fetches
dependencies, and a project with no dependencies needs nothing. When the
dependencies cannot be prepared (the install fails, or the tests cannot run
without the lifecycle scripts), stop and ask the user
(`repro-worktree-unprepared`, also under `--auto`). Then invoke the skill
inside the worktree with the symptom the user confirmed; never invoke it in the
user's tree, where their change may hide the symptom. The reproduction test must
be red in that worktree. Copy the returned reproduction test and report
directory into the user's working tree when `$kiwi-bug-repro` created them (its
`state.json` lists the files it created), and only to paths where no file
exists. When the reproduction edited a file that already existed at HEAD, copy
it only when the user's copy is byte-for-byte the `repro_base` version, that
is, the user has not touched it. Compare in the user's working tree with
`git diff --quiet <repro_base> -- <path>`, which does not count a line-ending
conversion as a difference. In every other case (the user changed, moved or
deleted that file, or a path is already taken), do not copy it and do not merge
it by hand: stop and ask the user (`repro-path-occupied`, also under `--auto`),
because a copy would overwrite or undo their uncommitted work. When the user
answers that they moved the case in themselves, `--resume` finds the
reproduction test in the user's tree and goes on to the red check. When HEAD
differs from `repro_base` on a `--resume` that comes before the copy (the user
committed while the run waited), nothing is copied: stop and ask the user (`repro-base-moved`, also
under `--auto`). When the user answers to reproduce again, `--resume` removes
that worktree, recreates it from the current HEAD, records the new
`repro_base` and invokes `$kiwi-bug-repro` again. The user's
change is the fix candidate that this test must turn green; when it falls short,
the fixer completes that change and adds no second fix. While the run waits for
the user's answer (at `bug-not-reproduced`, `bug-input-insufficient`,
`repro-worktree-unprepared`, `repro-path-occupied` or `repro-base-moved`), keep
the worktree. `--resume` reuses the worktree named
by `repro_worktree`; when that path is missing, it runs `git worktree prune` to
drop the stale registration and recreates the worktree the same way. Before removing it, move each `$kiwi-bug-repro` report directory inside
it whose `state.json` records the run as finished, and that the user's tree does
not have yet, to the same path in the user's tree. An unfinished report is not
moved: the next `$kiwi-bug-repro` run would apply its undo records to the user's
files. When the run completes, ends at `bug-not-a-bug` or is abandoned,
remove it with `git worktree remove --force <path>` and clear `repro_worktree`.
An abandoned run does not delete or restore a reproduction test it copied
into the user's tree, because the user may have edited it since the copy; it
reports that path, and the files the fixer changed, instead of rolling anything
back.

| Outcome | Handling |
|---|---|
| reproduced (`reproduced`) | record it in `bug_repro.json`; the reproduction test is the regression test and the most likely cause is the fix hypothesis |
| reproduced without an automated test (`reproduced-no-test`) | when it was reproduced without an automated test, stop and apply no fix unless `TDD_EXEMPT_REASON` is given (`bug-not-reproduced`). When the user gives `TDD_EXEMPT_REASON` on `--resume` after this `reproduced-no-test` stop, do not call `--analysis-only` again, because the bug is already reproduced: run that reproduction's script before and after the fix instead. The reproduction script runs in an isolated temporary copy with credentials removed, as `kiwi-bug-repro` §0.2 says; for a git-status input its source is `repro_worktree` before the fix and the user's tree after it |
| not reproduced (`not-reproduced`) | stop with the skill's question to the user; it was not reproduced, so no fix is applied (`bug-not-reproduced`, also under `--auto`) |
| not a bug (`not-a-bug`) | stop and report the evidence; it is not a bug, so no fix is applied, and a requirement change goes to `$kiwi-srs` (`bug-not-a-bug`) |
| input insufficient (`input-insufficient`) | stop with the skill's question to the user; no fix is applied |

`$kiwi-bug-repro` returns one of these outcomes, not a pipeline status. On
`not-reproduced` or `input-insufficient` it stops and applies no fix, also under
`--auto`. When it stops with any other question (`repro-restore-conflict`,
say), this skill passes that question on and stops with no fix
(`bug-repro-question`, also under `--auto`). When the user answers a question, this skill adds the answer to the
input and invokes `$kiwi-bug-repro` again on `--resume` (inside `repro_worktree` for
a git-status input).

Then check the scope from that result without analysing again, and record in
`bug_repro.json`: affected files (from the most likely cause's `file:line`
and the reproduction test), candidate REQ IDs (the related requirements the root-cause
analysis of that skill returned; those cited on the reproduction test's title line get
`match_confidence` high, the rest medium), external module touch, and a
complexity estimate (`large` halts at `fix-complexity-large`).

If the fix later changes behaviour unrelated to the most likely cause, treat
that as `zero-tolerance-hypothesis-fix-mismatch`.

## TDD And Fix

For normal hot-fixes:

1. Take the reproduction test `$kiwi-bug-repro` returned as the regression test; do not write a second test for the same symptom. When an impacted requirement is mapped, its title line cites `<REQ-ID> AC-<n>` (citation convention in `../../_shared/kiwi/test-sufficiency.md` §1).
2. Run it and capture the red failure — in `repro_worktree` for a git-status input, because the user's tree may already be green with their change; when it is not red any more, stop and report instead of fixing.
3. Apply the smallest fix; for a git-status input, complete the user's change.
4. Run the same test and capture green.
5. Run affected tests or broader regression.

If `TDD_EXEMPT_REASON` is supplied, steps 1, 2 and 4 are skipped because
there is no reproduction test; the fix hypothesis and the scope check still
come from the `--analysis-only` result, before the fix. Store the reason and
make the reviewer evaluate whether the exception is acceptable. The exception
does not remove regression risk reporting.

## Review Loop

Formal review checks syntax/type, import/export, style consistency, and TDD
sequence. Prickly review checks root-cause fit, regression risk, security,
performance, concurrency, error handling, and hot-fix appropriateness.

Exit when CRITICAL=0 and HIGH=0. In `--max`, also require two consecutive
MEDIUM-zero rounds when practical.

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
Use $kiwi-srs-sync with --files=<changed-files>
```

Propagate:

| Hot-fix flag | Sync flag |
|---|---|
| `--model <name>` | `--model <name>` |
| `--auto` | `--auto` |
| `--mini` / `--loops N` | `--mini` / `--loops N` |
| user explicitly supplied `--auto-apply` or `--yes-all` | propagate the same explicit apply flag after hot-fix review and regression gates pass |
| `--dry-run` | `--dry-run-only` |

If delegation fails, write `pending_sync` into state and report the exact files
and suggested `$kiwi-srs-sync` invocation.

## Pipeline Event

Standalone events:

| Field | Value |
|---|---|
| `skill` | `kiwi-hot-fix` |
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN` |
| `next_hint` | `kiwi-commit-auto-push` after successful fix/sync, `kiwi-pipeline` when sync follow-up remains, otherwise `null` |
| `artifacts.analysis_dir` | `docs/analysis/kiwi-hot-fix-{run-id}/` |

Event emission is best-effort.
