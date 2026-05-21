# Next Work Instructions: Codex Kiwi Skills Migration

Date: 2026-05-19
Primary Requirement: `MIG-FLOW-001`
Active Target: `v2.2.0`
Workspace: `C:\Work\git\_Snoworca\speckiwi\skills`

## Goal

This handoff now records the completed validation-improvement loop for the Claude Kiwi skills to Codex skills migration. The next session should not restart the migration; it should only review, commit, install, or perform any user-requested follow-up against the completed Codex skill artifacts.

## Current State

- `MIG-FLOW-001` is `Status=verified`, `Stability=evolving`.
- `skills/claude/` remains the source baseline.
- `skills/codex/` is a copied working tree.
- `skills/codex/MIGRATION_PLAN.md` contains the migration plan and per-skill order.
- `speckiwi validate_spec` returned `0` errors and `0` warnings after the latest SRS updates and completed-work log entry.
- `AC-3` was completed in the continuation session: every `codex/kiwi-*` folder now exposes `SKILL.md`, every `SKILL.md` frontmatter has only `name` and `description`, names match folder names, and `quick_validate.py` passed for all 10 skill folders with `PYTHONUTF8=1`.
- The validation-improvement loop completed `AC-4`, `AC-5`, and `AC-7` with command evidence and two read-only sub-agent validators.
- `skills/codex/MIGRATION_PLAN.md` has been updated with the final disposition, validation commands, and current pass results.

Completed acceptance criteria on `MIG-FLOW-001`:

- `AC-1`: Inventory created.
- `AC-2`: Claude-to-Codex copy completed and source preservation evidenced.
- `AC-3`: Codex skill file anatomy normalized and validated.
- `AC-4`: Claude-specific commands, paths, tool names, model names, and invocation syntax rewritten or isolated.
- `AC-5`: Shared references, scripts, and relative links resolve within `skills/codex/`.
- `AC-6`: Migration plan created.
- `AC-7`: Final validation includes inventory disposition, UTF-8 handling, Codex skill validation, and sub-agent reviewer validation.

Still open on `MIG-FLOW-001`: none.

## Files Already Added or Updated

- `skills/codex/` copied from `skills/claude/`.
- `skills/codex/MIGRATION_PLAN.md` added.
- Lowercase `skills/codex/kiwi-*/skill.md` files renamed to `SKILL.md`.
- `skills/codex/kiwi-planner/SKILL.md` frontmatter description changed from `Phase>Task` to `Phase-Task` because Codex validation rejects angle brackets in descriptions.
- `skills/codex/kiwi-planner/validator.mjs` moved to `skills/codex/kiwi-planner/scripts/validator.mjs`.
- Long `SKILL.md` bodies split into per-skill `references/extended-workflow.md`; all migrated `SKILL.md` files are now under 500 lines.
- `skills/codex/kiwi-*/agents/openai.yaml` generated for all 10 migrated skills.
- `skills/codex/_shared/kiwi/pipeline-v1.md` and `skills/codex/_shared/kiwi/feasibility-policy-schema-v1.md` added to satisfy migrated shared-reference links.
- Claude-specific path/tool/model/invocation residue was removed or isolated in migration notes.
- `docs/spec/60.workflow-release.srs.md` updated with `MIG-FLOW-001`.
- `docs/spec/00.index.md` updated for counts and `Last Updated`.

Do not revert unrelated existing worktree changes. At the previous handoff, unrelated dirty paths included:

- `AGENTS.md`
- `package-lock.json`
- `.claude/`

## First Commands for Next Session

Start with the required SpecKiwi current-work workflow before touching files:

1. Read `docs/spec/00.index.md`.
2. Use MCP `get_active_target`.
3. Inspect `summary.countsByStatus`, `summary.countsByStability`, `summary.stabilityBlockers`, `summary.stabilityWarnings`, and `summary.newWorkCandidates`.
4. Use MCP `list_requirements` for `status=in_progress`, `status=blocked`, and `status=implemented`.
5. Check missing verification evidence through the active target summary or MCP `summarize_target`.
6. Use MCP `list_completed_work`.
7. Read `MIG-FLOW-001` with MCP `get_requirement` and confirm `Status=verified`, `Stability=evolving`, all ACs checked, and evidence `VE-1` through `VE-6` present.

Then run local spot checks only if the user asks for review or regression validation. Raw `claude/` vs `codex/` inventory parity is no longer the right post-migration gate because expected Codex artifacts now include `SKILL.md` renames, generated metadata, reference splits, and script moves. Use the disposition inventory check in `skills/codex/MIGRATION_PLAN.md` instead.

Useful spot-check commands from `C:\Work\git\_Snoworca\speckiwi\skills`:

```powershell
Get-Content -Raw -Encoding UTF8 ..\docs\spec\00.index.md
```

```powershell
$env:PYTHONUTF8='1'
Get-ChildItem -Path codex -Directory -Filter 'kiwi-*' |
  ForEach-Object { python C:\Users\beom\.codex\skills\.system\skill-creator\scripts\quick_validate.py $_.FullName }
```

## Final Validation Performed

The validation-improvement loop completed these checks from `C:\Work\git\_Snoworca\speckiwi\skills`:

- `quick_validate.py` passed for all 10 `codex/kiwi-*` folders with UTF-8 mode.
- All migrated `SKILL.md` files are under 500 lines; highest observed was `codex/kiwi-pm/SKILL.md`.
- All 10 `agents/openai.yaml` files exist and include `display_name`, `short_description`, and `$skill-name` default prompts.
- Backticked skill-resource paths for shared references, validator scripts, extended workflow references, and metadata resolve from the file containing them.
- Claude-residue scans found no unintended `.claude`, `CLAUDE.md`, `AskUserQuestion`, `spawn_agent` pseudo-code, `Skill(...)`, internal `mcp__` names, Claude CLI/model names, or uppercase Claude tool invocation syntax in runtime skill artifacts.
- Disposition inventory check passed: 13 Claude source files mapped; 35 Codex files accounted for.
- Sub-agent reviewers Hegel and Kant performed read-only validation and reported no blockers in migrated `codex/kiwi-*` skill artifacts.

## Required Migration Steps

1. Rename lowercase `skill.md` files under `codex/kiwi-*` to `SKILL.md`. Completed on 2026-05-19.
2. Keep YAML frontmatter to exactly `name` and `description`. Completed on 2026-05-19 for the 10 copied `kiwi-*` skill folders.
3. Replace Claude-only paths such as `~/.claude/skills/...` with Codex-local or repository-relative references. Completed on 2026-05-19.
4. Replace slash invocation wording such as `/kiwi-srs` with Codex skill wording such as `Use $kiwi-srs`. Completed on 2026-05-19.
5. Replace `AskUserQuestion` with Codex-compatible clarification guidance. Completed on 2026-05-19.
6. Replace Claude model names (`Opus`, `Sonnet`) with role-based terms unless the text is explicitly documenting legacy source behavior. Completed on 2026-05-19.
7. Keep SpecKiwi MCP-first behavior and SRS governance intact. Completed on 2026-05-19.
8. Split very long `SKILL.md` files into `references/` where needed before final validation. Completed on 2026-05-19.
9. Move `kiwi-planner/validator.mjs` to `kiwi-planner/scripts/validator.mjs` only after checking command examples and path references. Completed on 2026-05-19.
10. Generate or update `agents/openai.yaml` only after each final `SKILL.md` is stable. Completed on 2026-05-19.

## Validation Record

These gates were used before checking the remaining `MIG-FLOW-001` ACs:

- Before Codex anatomy changes, raw inventory diff returns no source/target mismatch, excluding `codex/MIGRATION_PLAN.md`.
- After expected Codex anatomy changes, do not require raw inventory parity. Instead, maintain a migration disposition list that maps every `skills/claude/` source item to one of: copied unchanged, renamed, moved to `scripts/`, moved to `references/`, generated metadata, or intentionally retired with rationale.
- `speckiwi validate_spec` returns `0` errors and `0` warnings.
- `quick_validate.py` passes for each finalized Codex skill folder.
- `rg` checks show no unintended Claude-only paths, slash invocations, or model names remain.
- Shared links under `codex/_shared/kiwi/` resolve.
- Two sub-agent reviewers validated the migrated result before `AC-7` was checked.

## SRS Update Rules for Continuation

- Keep `MIG-FLOW-001` as the controlling Requirement ID.
- `MIG-FLOW-001` is already `verified`; do not reopen or alter it unless the user requests additional migration scope.
- Add verification evidence with SpecKiwi MCP tools, not by manually editing generated evidence tables.
- Use `check_acceptance_criteria` only for ACs that are actually completed.
- If migration discovers a larger product requirement outside `MIG-FLOW-001`, create or update SRS first.

## Completion Target for Next Session

No migration AC remains open. Reasonable next-session work is one of:

- Review the final diff and commit it.
- Install/copy selected `skills/codex/kiwi-*` folders into the active Codex skills home if requested.
- Run a smoke invocation of one or two migrated skills if the user wants runtime confidence beyond static validation.
- Keep `skills/claude/` unchanged unless the user explicitly requests source-side changes.
