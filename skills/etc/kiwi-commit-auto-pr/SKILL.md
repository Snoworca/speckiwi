---
name: kiwi-commit-auto-pr
description: "OpenCode/Hermes local-LLM variant for committing, pushing, and creating or updating a GitHub Pull Request with SpecKiwi traceability. Requires speckiwi mcp for normal PR trace/evidence updates. Defaults to --max, uses one evaluator/worker at a time, and supports three-clean review loops. Triggers: kiwi commit PR, kiwi PR open, commit and PR, automatic PR creation."
---

# kiwi-commit-auto-pr

> etc local-LLM profile: read `../_shared/kiwi/local-llm-profile.md` before executing. It requires working `speckiwi mcp`, treats `--max` as the default, disables multi-worker fanout, uses one delegated worker/evaluator at a time, and advances only after three consecutive no-improvement evaluations.

**etc override:** If any legacy section appears to allow CLI mutation fallback or
direct normal SRS Markdown mutation, the shared etc local-LLM profile wins:
normal SRS operations require `speckiwi mcp`; CLI is diagnostic/remediation only.

Use this skill to commit current changes, push a branch, and create or update a
GitHub Pull Request. It inherits the commit message, issue matching, signature
ban, and SpecKiwi trailer behavior of `kiwi-commit-auto-push`, then adds
PR-aware branching, PR body review, PR comments, and PR evidence registration.

Use `kiwi-commit-auto-push` when the user only wants commit + push.

## Core Rules

| Key | Rule |
|---|---|
| §0.1 | Use Git and GitHub CLI state as evidence: `git status`, `git diff`, current branch, remote tracking, and `gh pr list/view/create/edit/comment`. |
| §0.2 | Reuse `kiwi-commit-auto-push` semantics for staging, sensitive-file filtering, message generation, issue matching, `Closes`/`Refs`, `REQ`, `Task`, and `STABILITY-OVERRIDE` trailers. |
| §0.3 | Never use force push. Protected branch direct push requires explicit user approval and is a critical gate under `--auto`. |
| §0.4 | If current branch is protected and `--allow-direct` is absent, create a feature branch before push and restore the local protected branch pointer to its remote tracking branch when safe. |
| §0.5 | Keep PR body and PR comments free of AI signatures, tool signatures, bot labels, and co-author trailers. |
| §0.6 | If REQ trailers exist and `--no-speckiwi` is absent, SpecKiwi MCP PR trace/evidence mutations are required per REQ. Missing MCP or failed per-REQ evidence returns `FAILED` or `NEEDS_USER`, not `TASK_DONE` with warnings. |
| §0.7 | `--auto` follows `../_shared/kiwi/auto-option.md`. Child mode returns `NEEDS_USER`/`FAILED` payloads to the parent instead of asking directly. |
| §0.8 | Emit pipeline events through `../_shared/kiwi/pipeline-event.md` when running standalone. In child mode, let the parent emit the integrated event. |

### `--auto` critical_gates[]

| gate_id | reason | location |
|---|---|---|
| `stability-frozen-violation` | frozen REQ change needs explicit override reason | stability guard |
| `push-conflict-rebase-merge-choice` | rebase/merge conflict choice is high-risk | push failure handling |
| `fork-repo-pr-create` | fork PR target affects an external repository boundary | PR target selection |
| `protected-branch-direct-push` | protected branch direct push is irreversible policy risk | branch handling |
| `protected-branch-push-rejected` | protected branch push rejection requires branch strategy choice | push failure handling |
| `issue-candidate-ambiguous` | wrong issue trailer can close or reference the wrong GitHub issue | issue matching |
| `force-push-forbidden` | force push is never allowed | push |
| `pr-evidence-mcp-unavailable` | REQ trailers require MCP PR trace/evidence unless `--no-speckiwi` was explicit | PR evidence |
| `mcp-unavailable` | normal SRS trace/evidence operations require `speckiwi mcp` | preflight |

## Inputs

| Signal | Argument | Default |
|---|---|---|
| "all", "everything" | `--all` | staged files if present; otherwise safe changed files |
| path hints | `<path>` | all safe changes |
| issue number | `--issue=N` | auto-detect |
| no issue handling | `--no-issue` | off |
| explicit branch | `--branch=<name>` | auto |
| allow protected branch direct push | `--allow-direct` | off |
| PR base | `--base=<branch>` | default branch |
| update existing PR body | `--update-pr-body` | preserve body, comment summary |
| draft PR | `--draft` | off |
| skip existing PR comment | `--no-pr-comment` | off |
| skip SpecKiwi mutations | `--no-speckiwi` | off |
| skip all trailers | `--no-trailer` | off |
| explicit REQ or task | `--req=FR-X`, `--task=T-PH001-01` | auto-detect |
| auto gates | `--auto` | off |
| precision | `--max` | default on |

## Workflow

1. Collect git state and diff, then reject empty change sets.
2. Run `kiwi-commit-auto-push` compatible staging, issue/REQ/task matching,
   message generation, evaluation, commit, and signature verification.
3. Determine branch strategy. On protected branches, create or use a feature
   branch unless the user explicitly chooses direct push.
4. Push the selected branch without force.
5. Detect an existing open PR for the branch.
6. For a new PR or `--update-pr-body`, draft a PR body with Summary, Test plan,
   linked issue/REQ/task trailers, and a concise risk note.
7. Use a single local evaluator loop until the PR body is accurate,
   non-overstated, signature-free, and consistent with trailers for three
   consecutive clean evaluations.
8. Create the PR, update the PR body, or add a PR comment.
9. If REQ trailers exist and `--no-speckiwi` is absent, use SpecKiwi MCP to add
   PR trace links and PR verification evidence per REQ.
10. Emit a pipeline event and report commit hash, branch, PR URL, issue
    closure/reference, REQ links, warnings, and any skipped MCP calls.

## Child Mode Payloads

When delegated by `kiwi-pm` or another Kiwi parent, return a compact JSON-like
status to the parent:

- `TASK_DONE`: commit hash, branch, PR URL/action, trailers, MCP call results,
  warnings. Not allowed when REQ trailers exist, `--no-speckiwi` is absent, and
  PR trace/evidence failed.
- `NEEDS_USER`: reason, severity, context, and explicit decision options.
- `FAILED`: unrecoverable git, GitHub CLI, authentication, or signature failure.

## Extended References

- Read `references/extended-workflow.md` when executing branch restoration,
  PR body/comment details, MCP PR evidence calls, child-mode payloads, or
  pipeline event fields.
