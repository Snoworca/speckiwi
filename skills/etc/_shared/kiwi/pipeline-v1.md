# kiwi pipeline v1 reference

This etc-local reference is the shared contract for the `kiwi-*` pipeline.
Load it when a skill needs pipeline ownership, next-step routing, end-to-end
cycle orchestration, or final event emission rules.

## Responsibilities

| Skill | Primary responsibility | May update SRS status | May update stability |
|---|---|---:|---:|
| `kiwi-srs` | Create or update SRS requirements | yes | no |
| `kiwi-srs-feasibility` | Assess implementability and update requirement stability | no | yes |
| `kiwi-planner` | Produce implementation plans from active target requirements | no | no |
| `kiwi-coder` | Implement planned tasks with TDD and verification | yes | no |
| `kiwi-pm` | Run planned tasks and finalize completed work | yes | no |
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
| `kiwi-srs-feasibility` | `TASK_DONE` | `kiwi-planner` |
| `kiwi-planner` | `TASK_DONE` | `kiwi-pm` or `kiwi-coder` |
| `kiwi-coder` | `TASK_DONE` | `kiwi-review-fix-loop` or `kiwi-commit-auto-push` |
| `kiwi-pm` | `TASK_DONE` | `kiwi-review-fix-loop --close-reqs` |
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

`kiwi-srs -> (conditional) kiwi-srs-feasibility -> kiwi-planner -> kiwi-pm -> kiwi-review-fix-loop`

- Conditional feasibility: run `kiwi-srs-feasibility` only when the just-authored
  requirements carry `draft` stability or unverified implementability; otherwise
  skip it and proceed to `kiwi-planner`.
- `--auto`: the decision committee in `auto-option.md` auto-decides every
  inter-stage gate and the cycle runs to the end; a sub-skill `NEEDS_USER` /
  `FAILED` or a critical gate still halts for the user.
- `--max`: propagate to every spawned sub-skill.
- Research documents supplied by the user are passed through to `kiwi-srs`.
- A skip-authoring / resume-from-stage entry lets a caller whose SRS is already
  authored enter the cycle at feasibility or planning (consumed by
  `kiwi-wave-master`, FR-FLOW-029).

## Guardrails

- Normal target-scoped SRS operations require SpecKiwi MCP. CLI may diagnose or help remediate MCP setup, but is not the normal mutation fallback.
- Ask the user directly for business decisions in Default mode; use `direct user prompt` only in Plan mode when available.
- Keep event emission best-effort. A failed pipeline event must not hide the primary task result.
- Do not call Snoworca skills from Kiwi skills; route through the Kiwi skill set only.
