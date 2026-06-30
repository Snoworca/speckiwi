# Extended Workflow Reference

Load this file only when executing or validating `$kiwi-commit-auto-pr`.

## Branch Strategy

Protected branch patterns:

```text
main
master
develop
release/*
hotfix/*
<default branch reported by gh repo view>
```

Decision table:

| Current branch | Flags | Action |
|---|---|---|
| non-protected | no `--branch` | keep branch and push |
| non-protected | `--branch=<name>` | rename or create the named branch, then push with upstream |
| protected | no `--allow-direct`, no `--branch` | create a feature branch from current HEAD |
| protected | no `--allow-direct`, `--branch=<name>` | create/use the named feature branch |
| protected | `--allow-direct` | critical user gate; direct push is not auto-approved |

When creating a feature branch after a commit on a protected branch:

1. Verify `origin/<protected>` exists.
2. Create the feature branch at current HEAD.
3. Restore local protected branch pointer to `origin/<protected>` if safe.
4. Keep HEAD on the feature branch.

If remote tracking is missing, do not move the protected branch pointer; warn and
continue on the feature branch.

Branch naming priority:

| Source | Pattern |
|---|---|
| REQ match | `<type>/<req-id-lower>-<slug>` |
| Issue match | `<type>/<issue-number>-<slug>` |
| Neither | `<type>/<slug>-<yyyymmdd>` |

Collision handling checks local and remote branch names. Try the base name, then
`-2` through `-9`, then append the short commit hash.

## PR Handling

Find an existing PR with `gh pr list --head <branch> --state open --json`.

| Result | Action |
|---|---|
| no existing PR | create PR |
| existing PR + no `--update-pr-body` | preserve body and add a change-summary comment unless `--no-pr-comment` |
| existing PR + `--update-pr-body` | replace body after review loop |
| existing PR + `--no-pr-comment` | report existing PR and skip PR mutation |

For forks, new PR target selection is a critical gate. Options are upstream PR,
fork-local PR, skip PR creation, or halt.

## PR Body Template

Use concise Markdown:

```markdown
## Summary

<2-5 sentences focused on why the change exists and what changed>

## Test plan

- <command or verification>
- <command or verification>

## Risk

<short compatibility/risk note>

Closes #N
REQ: FR-X-001
Task: T-PH001-01
```

Use `Refs #N` instead of `Closes #N` when the change does not fully close an
issue. Do not include both for the same issue.

## SpecKiwi MCP PR Evidence

When a PR URL exists and REQ trailers exist:

1. Add commit trace/evidence only if this skill owns the commit stage for this
   run.
2. Add a PR trace link with `type="PullRequest"`, `relation="implements"`, and
   `reference=<PR URL>`.
3. Add PR verification evidence with `type="pr"` and `reference=<PR URL>`.
4. Repeat per REQ. If REQ trailers exist and `--no-speckiwi` is absent, missing
   MCP or failed per-REQ PR trace/evidence returns `FAILED` or `NEEDS_USER`;
   it is not a warning-only `TASK_DONE` condition.

Do not use CLI or raw Markdown edits as the normal mutation fallback.

## Pipeline Event

Standalone events:

| Field | Value |
|---|---|
| `skill` | `kiwi-commit-auto-pr` |
| `status` | `TASK_DONE`, `NEEDS_USER`, `FAILED`, or `DRY_RUN` |
| `next_hint` | `kiwi-pipeline` on success, `null` on user/failure, `kiwi-commit-auto-pr` for dry-run |
| `artifacts` | no local PR artifact; keep standard empty artifact object |

Child mode should not emit its own event when the parent emits an integrated
event.
