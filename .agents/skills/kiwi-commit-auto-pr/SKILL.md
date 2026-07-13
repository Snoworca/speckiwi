---
name: kiwi-commit-auto-pr
description: "Kiwi Git workflow that commits, pushes, and creates or updates a GitHub Pull Request while preserving SpecKiwi traceability. Use when the user asks for Kiwi commit PR, kiwi PR open, commit and PR, or automatic PR creation with issue/REQ trailers. Extends kiwi-commit-auto-push with protected-branch feature-branch creation, PR body/review quality gates, GitHub CLI checks, and speckiwi MCP evidence/trace links. Supports --auto, --model, --draft, --update-pr-body, --no-pr-comment, --req, --task, and --issue."
---
> Kiwi MCP rule: normal target-scoped SRS reads, mutations, validation, status/stability updates, acceptance-criteria changes, evidence, trace links, and completed-work logging require working `speckiwi mcp`. CLI is diagnostic/remediation only and is not a normal replacement for MCP mutations.

# kiwi-commit-auto-pr

> Codex clarification gate means: ask the user directly in Default mode; use `request_user_input` only in Plan mode when that tool is available.
> Model tier terms are role guidance, not provider names: `high-reasoning`, `standard`, and `lightweight` map to the current Codex model and effort options available in the session.

Commit the current changes, push them, then create or update a GitHub Pull
Request. This skill inherits the commit message, issue matching, signature-ban,
and SpecKiwi trailer behavior of `$kiwi-commit-auto-push`, then adds PR-aware
branching, PR body quality review, PR comments, and PR evidence registration.

Use `$kiwi-commit-auto-push` when the user only wants commit + push.

## Core Rules

| Key | Rule |
|---|---|
| §0.1 | Use Git and GitHub CLI state as evidence: `git status`, `git diff`, current branch, remote tracking, `gh pr list/view/create/edit/comment`. |
| §0.2 | Reuse `$kiwi-commit-auto-push` semantics for staging, sensitive-file filtering, commit message generation, issue matching, `Closes`/`Refs`, `REQ`, `Task`, and `STABILITY-OVERRIDE` trailers. |
| §0.3 | Never use force push. Protected branch direct push requires explicit user approval and is a critical gate under `--auto`. |
| §0.4 | If current branch is protected and `--allow-direct` is absent, create a feature branch before push and restore the local protected branch pointer to its remote tracking branch when safe. |
| §0.5 | Keep PR body and PR comments free of AI signatures, tool signatures, bot labels, or co-author trailers. |
| §0.6 | If REQ trailers exist and `--no-speckiwi` is absent, SpecKiwi MCP PR trace/evidence mutations are required. Missing MCP or failed per-REQ evidence returns `FAILED` or `NEEDS_USER`, not `TASK_DONE` with warnings. Do not manually edit `docs/spec/**` to compensate. |
| §0.7 | `--auto` follows `../_shared/kiwi/auto-option.md`. Child mode returns `NEEDS_USER`/`FAILED` payloads to the parent instead of asking directly. |
| §0.8 | Emit pipeline events through `../_shared/kiwi/pipeline-event.md` when running standalone. In child mode, let the parent emit the integrated event. |
| §0.9 | **`--mini` / `--loops N` option SSOT**. This skill follows `_shared/kiwi/loop-option.md` v1.0. `--mini` = verify/improve loop round cap 3; `--loops N` = round cap N (integer ≥1). If both are given, **`--loops` wins (warn)**. Orthogonal to `--max` (compose). On reaching the cap, report residual findings (no safety-gate bypass). |

### `--auto` critical_gates[]

The following gates always halt for user input when matched:

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
| verification model | `--model <name>` | current session model |
| "mini mode", "quick mode", "3 rounds" | `--mini` | off (skill default cap) |
| "loop N times", "N rounds" | `--loops N` | off (skill default cap) |

## Workflow

1. Collect git state and diff, then reject empty change sets.
2. Run `$kiwi-commit-auto-push` compatible staging, issue/REQ/task matching, message generation, evaluation, commit, and signature verification.
3. Determine branch strategy. On protected branches, create or use a feature branch unless the user explicitly chooses direct push.
4. Push the selected branch without force.
5. Detect an existing open PR for the branch.
6. For a new PR or `--update-pr-body`, draft a PR body with Summary, Test plan, linked issue/REQ/task trailers, and a concise risk note.
7. Use a lightweight reviewer loop until the PR body is accurate, non-overstated, signature-free, and consistent with trailers.
8. Create the PR, update the PR body, or add a PR comment.
9. If REQ trailers exist and `--no-speckiwi` is absent, use SpecKiwi MCP to add PR trace links and PR verification evidence per REQ. If MCP is unavailable or any per-REQ evidence mutation fails, return `FAILED` or `NEEDS_USER`.
10. Emit a pipeline event and report commit hash, branch, PR URL, issue closure/reference, REQ links, warnings, and any skipped MCP calls.

## Child Mode Payloads

When delegated by `$kiwi-pm` or another Kiwi parent, return a compact JSON-like
status to the parent:

- `TASK_DONE`: commit hash, branch, PR URL/action, trailers, MCP call results, warnings. Not allowed when REQ trailers exist, `--no-speckiwi` is absent, and PR trace/evidence failed.
- `NEEDS_USER`: reason, severity, context, and explicit decision options.
- `FAILED`: unrecoverable git, GitHub CLI, authentication, or signature failure.

Child-mode `NEEDS_USER` reasons include `stability_frozen`,
`push_conflict_non_fast_forward`, `push_conflict_rebase`, `push_conflict_merge`,
`pr_target_ambiguous_fork`, `protected_branch_push_rejected`,
`protected_branch_direct_push_requested`, and `issue_candidate_ambiguous`.

## Extended References

- Read `references/extended-workflow.md` when executing branch restoration,
  PR body/comment details, MCP PR evidence calls, child-mode payloads, or
  pipeline event fields.
