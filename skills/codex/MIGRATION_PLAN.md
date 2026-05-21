# Claude Kiwi to Codex Skills Migration Plan

Requirement ID: `MIG-FLOW-001`

## Current State

`skills/codex/` started as a byte-preserving working copy of `skills/claude/`. The Claude source tree remains the baseline and must not be edited during Codex migration unless the user asks for a source-side change. As of 2026-05-19, the Codex validation-improvement pass has normalized every copied skill to required `SKILL.md`, rewritten Claude-specific invocation/tool/model/path wording, moved long operational detail into per-skill extended workflow references, generated per-skill OpenAI UI metadata, and moved the planner validator to `kiwi-planner/scripts/validator.mjs`.

Inventory copied from `skills/claude/`:

| Source item | Target item | Notes |
|---|---|---|
| `kiwi-srs/skill.md` | `kiwi-srs/SKILL.md` | Anatomy normalized; still needs Codex semantics pass. |
| `kiwi-pm/skill.md` | `kiwi-pm/SKILL.md` | Anatomy normalized; large orchestrator; migrate after shared vocabulary is settled. |
| `kiwi-srs-sync/skill.md` | `kiwi-srs-sync/SKILL.md` | Anatomy normalized; needs Codex MCP and review terminology pass. |
| `kiwi-srs-research/skill.md` | `kiwi-srs-research/SKILL.md` | Anatomy normalized; needs sub-agent and model-role wording rewrite. |
| `kiwi-planner/skill.md` | `kiwi-planner/SKILL.md` | Anatomy normalized; validator resource placement still needs review. |
| `kiwi-planner/validator.mjs` | `kiwi-planner/scripts/validator.mjs` | Moved to the Codex skill `scripts/` resource directory. |
| `kiwi-coder/skill.md` | `kiwi-coder/SKILL.md` | Anatomy normalized; highest risk due implementation workflow and TDD/tool rules. |
| `kiwi-commit-auto-push/SKILL.md` | `kiwi-commit-auto-push/SKILL.md` | Already has uppercase skill file; still needs Codex terminology pass. |
| `kiwi-pipeline/SKILL.md` | `kiwi-pipeline/SKILL.md` | Already has uppercase skill file; shared path references need rewrite. |
| `kiwi-srs-from-code/skill.md` | `kiwi-srs-from-code/SKILL.md` | Anatomy normalized; needs model/sub-agent rewrite and progressive-disclosure split. |
| `kiwi-srs-feasibility/skill.md` | `kiwi-srs-feasibility/SKILL.md` | Anatomy normalized; needs MCP/status/stability wording review. |
| `_shared/kiwi/mini-option.md` | `_shared/kiwi/mini-option.md` | Shared reference rewritten to Codex-neutral model/cost language. |
| `_shared/kiwi/pipeline-event.md` | `_shared/kiwi/pipeline-event.md` | Shared reference rewritten to repository-local event paths and PowerShell/POSIX examples. |

## Migration Disposition List

Every original `skills/claude/` source item has the following current Codex disposition:

| Source item | Current Codex disposition | Rationale |
|---|---|---|
| `kiwi-srs/skill.md` | Renamed to `kiwi-srs/SKILL.md` | Codex requires uppercase `SKILL.md`. |
| `kiwi-pm/skill.md` | Renamed to `kiwi-pm/SKILL.md` | Codex requires uppercase `SKILL.md`. |
| `kiwi-srs-sync/skill.md` | Renamed to `kiwi-srs-sync/SKILL.md` | Codex requires uppercase `SKILL.md`. |
| `kiwi-srs-research/skill.md` | Renamed to `kiwi-srs-research/SKILL.md` | Codex requires uppercase `SKILL.md`. |
| `kiwi-planner/skill.md` | Renamed to `kiwi-planner/SKILL.md` | Codex requires uppercase `SKILL.md`; description changed from `Phase>Task` to `Phase-Task` to satisfy Codex validation. |
| `kiwi-planner/validator.mjs` | Moved to `kiwi-planner/scripts/validator.mjs` | Codex reusable scripts live under `scripts/`; all command examples were updated. |
| `kiwi-coder/skill.md` | Renamed to `kiwi-coder/SKILL.md` | Codex requires uppercase `SKILL.md`. |
| `kiwi-commit-auto-push/SKILL.md` | Copied unchanged at `kiwi-commit-auto-push/SKILL.md` | Already used Codex-required filename and two-field frontmatter. |
| `kiwi-pipeline/SKILL.md` | Copied unchanged at `kiwi-pipeline/SKILL.md` | Already used Codex-required filename and two-field frontmatter. |
| `kiwi-srs-from-code/skill.md` | Renamed to `kiwi-srs-from-code/SKILL.md` | Codex requires uppercase `SKILL.md`. |
| `kiwi-srs-feasibility/skill.md` | Renamed to `kiwi-srs-feasibility/SKILL.md` | Codex requires uppercase `SKILL.md`. |
| `_shared/kiwi/mini-option.md` | Rewritten in place at `_shared/kiwi/mini-option.md` | Claude/Snoworca-specific provider and missing shared-resource references were removed or converted to Codex-neutral language. |
| `_shared/kiwi/pipeline-event.md` | Rewritten in place at `_shared/kiwi/pipeline-event.md` | `~/.claude` paths and POSIX-only snippets were replaced with repository-local, cross-platform guidance. |
| n/a | Added `_shared/kiwi/pipeline-v1.md` | Codex-local shared reference added because migrated skills referenced the pipeline policy. |
| n/a | Added `_shared/kiwi/feasibility-policy-schema-v1.md` | Codex-local shared reference added because `kiwi-srs-feasibility` referenced the policy schema. |
| n/a | Added `kiwi-*/agents/openai.yaml` | Generated UI metadata for every migrated Codex skill with `skill-creator` tooling. |
| n/a | Added selected `kiwi-*/references/extended-workflow.md` | Progressive-disclosure split for long skill bodies; every `SKILL.md` is now under 500 lines. |

## Codex Target Shape

Each migrated skill folder must follow Codex skill anatomy:

- Required `SKILL.md` file in the skill folder root.
- YAML frontmatter contains only `name` and `description`.
- Folder name matches the `name` value.
- Optional per-skill OpenAI UI metadata is generated after the final `SKILL.md` text is stable.
- Reusable scripts live under `scripts/`.
- Long operational detail moves to `references/` and is linked from `SKILL.md` only when needed.
- Shared Kiwi references remain under `codex/_shared/kiwi/` unless a skill-specific copy is required.

## Global Rewrite Rules

Apply these rules to every copied skill before validating it as Codex-compatible:

| Claude-oriented pattern | Codex migration rule |
|---|---|
| `~/.claude/skills/...` | Replace with relative `skills/codex/...` or `codex/_shared/...` references. |
| Slash invocations such as `/kiwi-srs` | Replace with Codex skill-name wording such as `Use $kiwi-srs` or `run the kiwi-srs workflow`. |
| `AskUserQuestion` | Replace with Codex-appropriate user clarification guidance; mention `request_user_input` only for Plan mode when available. |
| `Read`, `Edit`, Claude tool names | Replace with Codex workspace terms: read/search files, use `apply_patch` for manual edits, use MCP tools when configured. |
| `Opus`, `Sonnet`, Claude model topology | Rewrite to model-neutral roles such as main agent, reviewer, worker, or lower-cost mode. |
| Claude `Agent` or `Task` spawning syntax | Rewrite to Codex-neutral sub-agent delegation wording; do not leave executable pseudo-tool syntax in skill docs. |
| `CLAUDE.md` as the only rule source | Prefer `AGENTS.md`; mention `CLAUDE.md` only as compatibility input when the repository uses it. |
| Pipeline event paths under `~/.claude` | Point to `codex/_shared/kiwi/pipeline-event.md` or repository-local pipeline docs. |

## Migration Phases

1. Baseline and inventory
   - Keep `skills/claude/` unchanged.
   - Record relative-path inventory for `claude/` and `codex/`.
   - Compare raw inventories only before anatomy changes; after file renames or moves, validate against the migration disposition list.

2. File anatomy normalization
   - Rename every lowercase `skill.md` in `codex/kiwi-*` folders to `SKILL.md`. Completed on 2026-05-19.
   - Move `codex/kiwi-planner/validator.mjs` to `codex/kiwi-planner/scripts/validator.mjs` if the validator remains part of the skill. Completed on 2026-05-19.
   - Keep existing `SKILL.md` files in place for `kiwi-pipeline` and `kiwi-commit-auto-push`.

3. Frontmatter and trigger descriptions
   - Keep only `name` and `description` in YAML.
   - Shorten descriptions so they trigger the skill without embedding the whole workflow.
   - Preserve Korean trigger phrases where useful.

4. Progressive disclosure split
   - Keep `SKILL.md` as the concise workflow entrypoint.
   - Move detailed phase gates, schemas, long tables, and examples into `references/`. Completed on 2026-05-19 for every `SKILL.md` over 500 lines.
   - Keep scripts executable without requiring the full reference text to be loaded.

5. Codex tool semantics pass
   - Rewrite Claude-specific tool names and sub-agent assumptions. Completed on 2026-05-19 for the migrated Codex tree.
   - Preserve SpecKiwi MCP-first behavior.
   - Preserve SRS governance, TDD, verification, and UTF-8 rules.

6. Shared Kiwi reference pass
   - Migrate `_shared/kiwi/mini-option.md` to Codex-neutral language. Completed on 2026-05-19.
   - Migrate `_shared/kiwi/pipeline-event.md` path references and event ownership language. Completed on 2026-05-19.
   - Update all skill links to shared references. Completed on 2026-05-19.

7. Interface metadata
   - Generate per-skill OpenAI UI metadata for each migrated skill only after `SKILL.md` content is stable. Completed on 2026-05-19.
   - Regenerate metadata when skill descriptions change.

8. Validation and SRS updates
   - Run inventory diff.
   - Run Codex skill validation for every skill folder.
   - Check path references and frontmatter.
   - Use a sub-agent reviewer for final validation.
   - Add verification evidence and check completed ACs on `MIG-FLOW-001`.

## Per-Skill Order

| Order | Skill | Reason |
|---:|---|---|
| 1 | `kiwi-pipeline` | Smallest uppercase baseline; establishes shared path rewrite. |
| 2 | `kiwi-commit-auto-push` | Already uppercase; validates frontmatter and metadata workflow. |
| 3 | `_shared/kiwi/*` | Shared language affects every other skill. |
| 4 | `kiwi-srs` | Core SRS authoring workflow; other SRS skills depend on vocabulary. |
| 5 | `kiwi-srs-from-code` | Similar SRS workflow with more discovery logic. |
| 6 | `kiwi-srs-feasibility` | Stability and status workflow depends on SRS vocabulary. |
| 7 | `kiwi-srs-research` | Research topology rewrite after sub-agent wording is settled. |
| 8 | `kiwi-srs-sync` | Uses SRS and research terminology. |
| 9 | `kiwi-planner` | Needs script placement and plan schema references. |
| 10 | `kiwi-coder` | Highest behavioral risk; migrate after planner vocabulary is stable. |
| 11 | `kiwi-pm` | Orchestrator should be last so it can reference final skill names and contracts. |

## Validation Commands

Use PowerShell from `C:\Work\git\_Snoworca\speckiwi\skills`.

The raw inventory diff below is a baseline-copy check only. Run it before Codex anatomy changes. After expected transformations such as `skill.md` to `SKILL.md`, generated per-skill UI metadata, reference files, or script moves, validate against a migration disposition list instead of raw path parity.

```powershell
$src = rg --files --encoding UTF-8 claude | ForEach-Object { $_ -replace '^claude\\','' } | Sort-Object
$dst = rg --files --encoding UTF-8 codex |
  Where-Object { $_ -ne 'codex\MIGRATION_PLAN.md' } |
  ForEach-Object { $_ -replace '^codex\\','' } |
  Sort-Object
Compare-Object $src $dst
```

```powershell
rg -n --encoding UTF-8 "^---$|^name:|^description:" codex
rg -n --encoding UTF-8 "spawn_agent|Skill\(|Skill 도구|\bAgent\b|subagent_type|description token|mcp__|claude mcp|claude CLI|claude-standard|opus_|opus_verdict|\bEdit\b|\bWrite\b|\bGlob\b|\bGrep\b" codex -g "!MIGRATION_PLAN.md" -g "!scripts/validator.mjs"
rg -n --encoding UTF-8 "~/.claude|\.claude|CLAUDE\.md|AskUserQuestion" codex -g "!MIGRATION_PLAN.md"
rg -n --pcre2 --encoding UTF-8 "(?<![A-Za-z0-9._-])/kiwi-[A-Za-z0-9-]+" codex -g "!MIGRATION_PLAN.md"
```

```powershell
python C:\Users\beom\.codex\skills\.system\skill-creator\scripts\quick_validate.py .\codex\<skill-name>
```

Run `quick_validate.py` once per migrated skill folder after each folder reaches the Codex target shape.

Current 2026-05-19 validation-improvement pass results:

- `quick_validate.py` passed for all 10 `codex/kiwi-*` skill folders with `PYTHONUTF8=1`.
- Every `codex/kiwi-*/SKILL.md` is under 500 lines.
- Per-skill OpenAI UI metadata exists for every migrated skill and has `display_name`, `short_description`, and a `$skill-name` default prompt.
- Backticked skill-resource paths for shared references, `validator.mjs`, per-skill extended workflow references, and per-skill UI metadata resolve from the file containing them.
- Disposition inventory check passed: 13 source files mapped; 35 Codex files accounted for, including expected generated metadata and reference files.
- Claude-residue scans for tool syntax, Claude paths, slash invocations, model/provider names, and internal MCP tool names returned no matches outside excluded migration notes and validator source.

## Risks and Deferred Decisions

| Risk | Mitigation |
|---|---|
| Large `SKILL.md` files may exceed practical progressive-disclosure size. | Split long phase details into `references/` before rewriting semantics. |
| Model-specific rules may encode useful quality gates. | Preserve the gate intent while replacing Claude model names with role-based wording. |
| Pipeline event shared paths may break if multiple skill roots are supported. | Keep shared path references relative to `codex/_shared/kiwi/` and document any external path as environment-specific. |
| `kiwi-planner/validator.mjs` may assume old path layout. | Move only after checking imports and command examples. |
| Automated validation may not catch semantic Claude references. | Add `rg` checks and sub-agent review as final gates. |

## Done Criteria for This Migration

- `skills/claude/` remains unchanged.
- All Codex skill folders expose `SKILL.md`.
- All Codex skill frontmatter contains only `name` and `description`.
- All intended shared references resolve from `skills/codex/`.
- Claude-only path/tool/model references are removed or explicitly documented as compatibility notes.
- Every original `skills/claude/` source item has a documented Codex disposition: copied unchanged, renamed, moved to `scripts/`, moved to `references/`, generated metadata, or intentionally retired with rationale.
- `quick_validate.py` passes for every skill.
- `MIG-FLOW-001` has evidence for the completed ACs and remains free of `draft` or `deprecated` stability blockers.
