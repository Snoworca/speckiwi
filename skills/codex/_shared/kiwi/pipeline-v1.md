# kiwi pipeline v1 reference

This Codex-local reference is the shared contract for the `kiwi-*` pipeline.
Load it when a skill needs pipeline ownership, next-step routing, end-to-end
cycle orchestration, or final event emission rules.

## Responsibilities

| Skill | Primary responsibility | May update SRS status | May update stability |
|---|---|---:|---:|
| `kiwi-srs` | Create or update SRS requirements | yes | no |
| `kiwi-srs-feasibility` | Assess implementability and update requirement stability | no | yes |
| `kiwi-sds` | Only when the user asks (`/kiwi-sds`, `--sds`): author one lite SDS for the requirements in scope, and close it out after implementation | no | no |
| `kiwi-coder` | Implement a requirement-ID set (or, under `--sds <path>`, an agreed SDS) test-first, with verification | yes | no |
| `kiwi-pm` | Run a requirement-ID set (or, under `--sds <path>`, an agreed SDS) as one kiwi-coder run and finalize completed work | yes | no |
| `kiwi-srs-research` | Produce research evidence for requirements | no | no |
| `kiwi-srs-sync` | Sync already-implemented code changes back to SRS | yes | no |
| `kiwi-commit-auto-push` | Commit and push verified changes with issue/SRS trailers | no | no |
| `kiwi-commit-auto-pr` | Commit, push, and create or update a GitHub PR with issue/SRS trailers | no | no |
| `kiwi-hot-fix` | Urgent TDD bug fix with review and delegated SRS sync | no | no |
| `kiwi-review-fix-loop` | Review, fix, re-review, and optionally close implemented REQs with evidence | yes | no |
| `kiwi-pipeline` | Orchestrate the end-to-end cycle by default; recommend a single next step under `--none-cycle` | transitive, via its children | transitive, via `kiwi-srs-feasibility` |

## Routing

Use `pipeline-event.md` for the event schema and emit rules. The routing summary is:

| Last skill | Success status | Next hint |
|---|---|---|
| `kiwi-srs` | `TASK_DONE` | `kiwi-srs-feasibility` |
| `kiwi-srs-from-code` | `TASK_DONE` | `kiwi-srs-feasibility` |
| `kiwi-srs-feasibility` | `TASK_DONE` | `kiwi-pm` when stability has reached `evolving` (`kiwi-sds` when the current kiwi-pipeline invocation carries `--sds`), otherwise `kiwi-srs-research` |
| `kiwi-sds` | `TASK_DONE` | `kiwi-pm` (a `--close` run sets its own next hint) |
| `kiwi-coder` | `TASK_DONE` | `kiwi-review-fix-loop --req-filter <the run's requirement IDs>`; when the event's `artifacts.sds_files` is non-empty, first `kiwi-sds --close <sds-id>` (the move before promotion, when the run is close-safe), whose close event hints `kiwi-review-fix-loop --close-reqs`, otherwise `kiwi-review-fix-loop` without `--close-reqs` |
| `kiwi-pm` | `TASK_DONE` | `kiwi-review-fix-loop --close-reqs --req-filter <the run's req_ids>`; when the event's `artifacts.sds_files` is non-empty, first `kiwi-sds --close <sds-id>` (the move before promotion, when the run is close-safe), whose close event hints `kiwi-review-fix-loop --close-reqs`, otherwise `kiwi-review-fix-loop` without `--close-reqs` |
| `kiwi-review-fix-loop` | `TASK_DONE` | `kiwi-commit-auto-push` or none for PR mode |
| `kiwi-hot-fix` | `TASK_DONE` | `kiwi-commit-auto-push` or `kiwi-pipeline` |
| `kiwi-commit-auto-push` | `TASK_DONE` | `kiwi-pipeline` |
| `kiwi-commit-auto-pr` | `TASK_DONE` | `kiwi-pipeline` |
| any | `NEEDS_USER` or `FAILED` | none |

## End-to-end cycle

By default `kiwi-pipeline` chains the full research-to-implementation sequence
rather than stopping after one next hint. `--none-cycle` is the single opt-out and
restores single-next-step recommendation; `--cycle` is still accepted and changes
nothing. The chain only executes when the invocation carries a work input:

`kiwi-srs -> (conditional) kiwi-srs-feasibility -> kiwi-pm --req-filter <cycle requirement IDs> --review-hop-owned-by-parent -> kiwi-review-fix-loop --close-reqs --req-filter <cycle requirement IDs>`

The cycle ends with the test-sufficiency check of `test-sufficiency.md` (`kiwi-pipeline` §2.5.4).
The default cycle calls no `kiwi-sds` and reads no SDS, even when one sits in `docs/sds/`.

Under `--sds` (a user-given `--from=sds` or `--sds-id` counts as `--sds`) the cycle is

`kiwi-srs -> (conditional) kiwi-srs-feasibility -> kiwi-sds -> kiwi-pm -> kiwi-review-fix-loop --close-reqs`

followed by the test-sufficiency check and the SDS close-out `kiwi-sds --close <sds-id>`: the
close-out's move runs before the `--close-reqs` hop promotes, and its delete runs after the check
(`kiwi-pipeline` §2.5.5).

- Conditional feasibility: run `kiwi-srs-feasibility` only when the just-authored
  requirements carry `draft` stability or unverified implementability; otherwise
  skip it and proceed to `kiwi-pm` (`kiwi-sds` under `--sds`).
- `--auto`: the decision committee in `auto-option.md` auto-decides every
  inter-stage gate and the cycle runs to the end; a sub-skill `NEEDS_USER` /
  `FAILED` or a critical gate still halts for the user.
- `--max`: propagate to every spawned sub-skill.
- Research documents supplied by the user are passed through to `kiwi-srs`.
- A skip-authoring / resume-from-stage entry lets a caller whose SRS is already
  authored enter the cycle at feasibility, or at SDS authoring under `--sds`.

## Guardrails

- Normal target-scoped SRS operations require SpecKiwi MCP. CLI may diagnose or
  help remediate MCP setup, but is not the normal mutation fallback.
- Ask the user directly for business decisions in Default mode; use `request_user_input` only in Plan mode when available.
- Keep event emission best-effort. A failed pipeline event must not hide the primary task result.
- Do not call Snoworca skills from Kiwi skills; route through the Kiwi skill set only.
