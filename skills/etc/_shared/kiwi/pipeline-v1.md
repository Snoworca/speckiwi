# kiwi pipeline v1 reference

This etc-local reference is the shared contract for the `kiwi-*` pipeline.
Load it when a skill needs pipeline ownership, next-step routing, or final event
emission rules.

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
| `kiwi-pipeline` | file read pipeline events and recommend the next skill | no | no |

## Routing

Use `pipeline-event.md` for the event schema and emit rules. The routing summary is:

| Last skill | Success status | Next hint |
|---|---|---|
| `kiwi-srs` | `TASK_DONE` | `kiwi-srs-feasibility` |
| `kiwi-srs-from-code` | `TASK_DONE` | `kiwi-srs-feasibility` |
| `kiwi-srs-feasibility` | `TASK_DONE` | `kiwi-planner` |
| `kiwi-planner` | `TASK_DONE` | `kiwi-pm` or `kiwi-coder` |
| `kiwi-coder` | `TASK_DONE` | `kiwi-commit-auto-push` |
| `kiwi-pm` | `TASK_DONE` | `kiwi-commit-auto-push` |
| `kiwi-commit-auto-push` | `TASK_DONE` | `kiwi-pipeline` |
| any | `NEEDS_USER` or `FAILED` | none |

## Guardrails

- Prefer SpecKiwi MCP tools; use CLI only for diagnostics and remediation guidance when MCP is unavailable; do not perform normal SRS mutation without MCP.
- Ask the user directly for business decisions in Default mode; use `direct user prompt` only in Plan mode when available.
- Keep event emission best-effort. A failed pipeline event must not hide the primary task result.
- Do not call Snoworca skills from Kiwi skills; route through the Kiwi skill set only.
