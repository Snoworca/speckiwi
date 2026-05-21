# Next Work Plan: CLI Skill Install and Update

Date: 2026-05-20
Active Target: `v2.2.3`
Primary Requirements: `IR-CLI-027`, `FR-NODE-016`, `FR-FLOW-012`
Related Completed Requirement: `MIG-FLOW-002`
Workspace: `C:\Work\git\_Snoworca\speckiwi`

## Goal

Implement CLI-driven installation of repository-managed Kiwi skills for Codex, Claude, OpenCode, and Hermes.

The key product rule from the research pass is:

- Installing a missing skill is `operation=install`.
- Installing an already existing valid same-identity skill is `operation=update`.
- Reinstall/update must not require `--force`.
- Only unsafe paths, invalid source packages, unsupported targets, or existing non-skill destinations are conflicts.

Same-identity means the destination folder name matches the requested skill name, the destination entrypoint frontmatter `name` matches the source frontmatter `name`, and target-specific identity fields match. For Hermes, `category` is part of identity. A destination without a valid entrypoint or with a different frontmatter `name` is a `conflict`, not an update target.

All installed Kiwi skills must keep the `speckiwi mcp` normal-operation dependency visible in human output, JSON output, and validation behavior.

## Starting State

- `v2.2.3` active target has three planned implementation requirements:
  - `IR-CLI-027`: CLI skill add/install command.
  - `FR-NODE-016`: reusable core skill installation service.
  - `FR-FLOW-012`: Kiwi skills require SpecKiwi MCP for normal operation.
- `MIG-FLOW-002` is verified and provides the `skills/etc` source tree for OpenCode and Hermes local-LLM variants.
- `skills/codex`, `skills/claude`, and `skills/etc` exist as repository source trees.
- Current `package.json` `files` excludes `skills/**`; global CLI installation cannot work from a packed npm package until this is fixed.
- `FR-NODE-016 AC-6` currently says existing destination skills are refused unless force is explicit. This conflicts with the new install-as-update rule and must be revised before implementation.

## Target CLI Contract

Preferred command shape:

```powershell
speckiwi skills install <agent> <skill|all> [--global|-g] [--dry-run] [--json] [--category <name>]
speckiwi skills install <agent> <skill|all> --dest <dir> [--dry-run] [--json]
speckiwi skills add <agent> <skill|all> ...
```

Rules:

- `<agent>` is one of `codex`, `claude`, `opencode`, `hermes`.
- Avoid `--target` for agent selection because SpecKiwi already uses target for SRS version targets.
- `skills add` is an alias for `skills install`.
- `--dest` and `--global` are mutually exclusive.
- `--dest` means custom destination root, not the final skill directory. `all --dest <dir>` installs each selected skill under `<dir>/<skillName>`.
- `--dest` still requires safe-path/destructive-write validation.
- `--category` applies only to Hermes global installs and defaults to `kiwi`. Non-Hermes usage must fail with a usage error; Hermes project/custom installs must reject `--category` unless the final SRS contract explicitly supports it.
- `--json` output must include `operation`, `changed`, `requiresMcp`, `mcpPreflight`, source root, destination root, and validation findings.
- `mcpPreflight` is one of `satisfied`, `missing`, or `not_checked`, with remediation text when missing.
- Byte-identical destinations use `operation=skip` and `changed=false`.

## Destination Matrix

| Agent | Source Root | Project Destination | Global Destination | Notes |
| --- | --- | --- | --- | --- |
| Codex | `skills/codex` | `$REPO_ROOT/.agents/skills/<name>` | `${CODEX_HOME:-$HOME/.codex}/skills/<name>` | Use `$CODEX_HOME` parity as conservative global MVP; support `.agents/skills` through project scope or `--dest`. If both supported global roots already contain the skill, fail and ask for `--dest`. |
| Claude | `skills/claude` | `$REPO_ROOT/.claude/skills/<name>` | `$HOME/.claude/skills/<name>` | Claude requires `SKILL.md`. The source tree has lowercase `skill.md` for most skills, so Phase 0 must decide whether to normalize source or transform during install. |
| OpenCode | `skills/etc` | `$REPO_ROOT/.opencode/skills/<name>` | `$HOME/.config/opencode/skills/<name>` | Install to OpenCode native locations by default even though OpenCode can also discover `.claude/skills` and `.agents/skills`. |
| Hermes | `skills/etc` | unsupported unless `--dest` is supplied | `$HOME/.hermes/skills/<category>/<name>` | Default category is `kiwi`; category is part of the install identity. |

## Phase 0: SRS Contract Repair

Do this before code changes.

1. Update `FR-NODE-016 AC-6` to replace overwrite refusal with update semantics.
2. Clarify `IR-CLI-027 AC-6` so destination handling distinguishes `install`, `update`, `skip`, and `conflict`.
3. Add or clarify acceptance coverage for:
   - `--dest` custom scope and mutual exclusion with `--global`.
   - Hermes `--category` or fixed `kiwi` category behavior.
   - packaged CLI availability of bundled `skills/**`.
   - lowercase Claude source normalization decision.
4. Run `validate_spec`.

Exit gate:

- `validate_spec` returns 0 errors and 0 warnings.
- `FR-NODE-016` no longer contradicts reinstall-as-update.

## Phase 1: Core Type Contract and Test Fixtures

Create core skill install types before implementation.

Candidate files:

- `src/core/skills/types.ts`
- `src/core/skills/resolve-skill-destination.ts`
- `src/core/skills/validate-skill-package.ts`
- `src/core/skills/plan-skill-install.ts`
- `src/core/skills/install-skill.ts`

Core concepts:

- `SkillAgent = "codex" | "claude" | "opencode" | "hermes"`
- `SkillInstallScope = "project" | "global" | "custom"`
- `SkillInstallOperation = "install" | "update" | "skip" | "conflict"`
- `SkillInstallPlan`
- `SkillInstallResult`
- `SkillValidationFinding`
- `SkillSourceLocator`, which resolves bundled source roots from either a repository checkout or the installed npm package layout.

Write failing tests first for:

- Agent/source-root resolution.
- Skill name validation and path traversal rejection.
- `all` expansion excluding `_shared` and non-skill documents.
- MCP dependency surfaced in plan/result.
- `mcpPreflight` represented separately from static `requiresMcp`.
- Same-identity classification for valid existing destinations.

Exit gate:

- New tests fail for missing implementation.
- Type contracts are narrow enough that CLI and future MCP can share them.
- Source-root lookup does not assume repository checkout only.

## Phase 2: Destination Resolver

Implement table-driven destination resolution.

Required behavior:

- Project paths are rooted under the project root.
- Global paths are rooted under user home or target-specific env variables.
- Custom `--dest` does not combine with `--global`.
- Hermes global path includes category.
- Codex global resolver handles `${CODEX_HOME:-$HOME/.codex}/skills`.
- If multiple supported Codex global roots already contain the same skill, return a structured ambiguity error requiring `--dest`.
- Deprecated `skills/llm` references produce a clear compatibility error or warning, not a source root.
- `--category` is rejected outside Hermes global scope.
- `--dest` is always treated as a root that receives one child directory per installed skill.

Tests:

- Windows and POSIX-style path resolution.
- Unsafe names such as `../x`, absolute paths, path separators, empty names.
- Hermes category validation.
- Project/global/custom scope matrix.

Exit gate:

- Resolver tests pass.
- No filesystem mutation occurs in resolver tests.

## Phase 3: Source Package Validation and Planning

Implement source validation and dry-run planning.

Required behavior:

- Read all project files as UTF-8.
- Require a valid skill entrypoint.
- Prefer `SKILL.md`.
- For Claude lowercase `skill.md`, either:
  - normalize to `SKILL.md` during install and report `entrypointNormalized=true`, or
  - repair `skills/claude` source tree before this phase and keep validation strict.
- Frontmatter `name` must match the folder name.
- Relative `scripts`, `references`, and `assets` referenced by the skill package must remain reachable after install.
- All Kiwi skill plans include `requiresMcp: true`.

Planning output must identify:

- `sourceRoot`
- `destinationRoot`
- selected skill list
- `operation`
- conflicts
- files to copy
- files to remove when mirror-updating
- validation findings

Tests:

- Missing source root.
- Missing entrypoint.
- Invalid frontmatter.
- Existing valid destination yields `operation=update`.
- Existing byte-identical destination yields `operation=skip` and `changed=false`.
- Existing non-skill destination yields `operation=conflict`.
- MCP preflight state can be `satisfied`, `missing`, or `not_checked`, and missing state includes remediation guidance.

Exit gate:

- `--dry-run` can be implemented only from the plan object.
- No partial destination mutation is possible from planning code.

## Phase 4: Safe Install/Update Execution

Implement execution only after plan tests pass.

Required behavior:

1. Validate source and build plan.
2. If `dryRun`, return plan without mutation.
3. Copy files to a staging directory under the destination root.
4. Validate staged package before replacing live destination.
5. Replace/mirror the destination skill directory.
6. Preserve or restore the original destination if staging validation or replacement fails.
7. Post-copy validate live destination.

Windows caveat:

- Do not compose destructive filesystem commands across shells.
- Use Node `fs` APIs with resolved absolute paths.
- Check every recursive delete/replace target stays inside the intended destination root.
- Reject symlinks in source and destination skill trees for the MVP. A symlink that points outside the intended root must never be followed or copied.

Tests:

- Install into empty temp destination.
- Update existing valid skill.
- Mirror update removes stale files only inside the skill directory.
- Failed validation leaves existing destination intact.
- Conflict leaves destination untouched.

Exit gate:

- Core install/update tests pass on temp directories.
- No destructive operation can target outside the resolved destination root.

## Phase 5: CLI Command Integration

Add `src/cli/commands/skills.ts` and register it in `src/cli/index.ts`.

Required CLI behavior:

- `speckiwi skills install <agent> <skill|all>`
- `speckiwi skills add <agent> <skill|all>`
- `--global`, `-g`, `--dry-run`, `--json`, `--dest`, `--category`
- Inherited `--root` and global `--json` work consistently with existing commands.
- Human output names install/update/skip/conflict clearly.
- JSON output uses existing `ok/value/diagnostics` style.
- Commander usage errors such as unsupported options or invalid argument combinations return exit code `2`.
- Valid command requests that fail domain validation, conflict checks, or mutation safety checks return exit code `5`, consistent with current mutation command behavior.

Tests:

- CLI dry-run JSON for each agent.
- CLI global install/update behavior against temp home/config roots.
- CLI rejects unsupported agent.
- CLI rejects `--global --dest`.
- CLI rejects non-Hermes `--category`.
- CLI reports byte-identical destinations as `skip`.
- CLI aliases `skills add` to the same core service.
- Help text exposes inherited global options.

Exit gate:

- `npm run test -- test/cli` or equivalent focused Vitest run passes.
- `npm run build` passes.

## Phase 6: Package Distribution

Update package artifacts so a published/global CLI can find bundled skill sources.

Required behavior:

- Add `skills/codex`, `skills/claude`, and `skills/etc` to the npm package artifact list, or implement a structured `SKILL_SOURCE_UNAVAILABLE` error if the package intentionally remains source-checkout only.
- Preferred product behavior is to include bundled source roots.

Tests:

- `npm pack --dry-run` or equivalent inspection confirms `skills/**` is included.
- Packaged layout resolves source roots from installed package location, not only from repository checkout.

Exit gate:

- Published-package source lookup path is deterministic.

## Phase 7: End-to-End Validation and Evidence

Run focused validation first, then broader checks.

Suggested commands:

```powershell
npm run typecheck
npm run test -- test/core test/cli
npm run build
npm run test
npm pack --dry-run
```

SpecKiwi validation:

```powershell
speckiwi validate --root C:\Work\git\_Snoworca\speckiwi
```

SRS updates after passing:

1. Add verification evidence to `FR-NODE-016` for core tests.
2. Add verification evidence to `IR-CLI-027` for CLI tests and package dry-run.
3. Add verification evidence to `FR-FLOW-012` for MCP dependency output/scans.
4. Check covered acceptance criteria only after evidence is attached.
5. Move requirements through `implemented` to `verified` only when evidence exists.
6. Add completed-work log for `v2.2.3` when all relevant ACs are verified.

Exit gate:

- `IR-CLI-027`, `FR-NODE-016`, and `FR-FLOW-012` have evidence.
- `validate_spec` returns 0 errors and 0 warnings.
- Sub-agent validation has reviewed the final implementation and found no blocking issues.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Existing `FR-NODE-016 AC-6` contradicts update semantics | Implementation may satisfy old text but violate user intent | Repair SRS in Phase 0 before code. |
| Codex has two observed destination conventions | Duplicate installs or unclear global behavior | Use `${CODEX_HOME:-$HOME/.codex}/skills` as MVP global default, project `.agents/skills`, and require `--dest` if ambiguity exists. |
| Claude source tree has lowercase `skill.md` | Strict validation would fail Claude installs | Decide in Phase 0: source normalization or install-time normalization. |
| Package excludes `skills/**` | Global CLI cannot install bundled skills | Include skill roots in package artifacts and test packed layout. |
| Update operation can be destructive | User skill data could be lost | Stage, validate, mirror only within skill dir, and preserve/rollback on failure. |
| Hermes category affects identity | Updates may write a second copy under another category | Default `kiwi`, expose `--category`, and include category in JSON identity. |

## Requirement Mapping

| Requirement | Covered By |
| --- | --- |
| `IR-CLI-027 AC-1` | Phase 5 command group and alias. |
| `IR-CLI-027 AC-2` | Phase 2 destination resolver and Phase 5 CLI options. |
| `IR-CLI-027 AC-3` | Phase 2 source-root mapping. |
| `IR-CLI-027 AC-4` | Phase 2 deprecated `skills/llm` validation. |
| `IR-CLI-027 AC-5` | Phase 3 plan object and Phase 5 JSON dry-run. |
| `IR-CLI-027 AC-6` | Phase 0 contract repair, Phase 3 validation, Phase 4 no-partial-copy execution. |
| `IR-CLI-027 AC-7` | Phase 3/5 `requiresMcp` output. |
| `IR-CLI-027 AC-8` | Phase 1-4 shared core service. |
| `FR-NODE-016 AC-1` | Phase 1-2 agent/source-root model. |
| `FR-NODE-016 AC-2` | Phase 2 source-root mapping and no `skills/llm`. |
| `FR-NODE-016 AC-3` | Phase 2 project/global/custom destination resolver. |
| `FR-NODE-016 AC-4` | Phase 3 source package validation. |
| `FR-NODE-016 AC-5` | Phase 3 dry-run planning. |
| `FR-NODE-016 AC-6` | Phase 0 contract repair and Phase 4 update/conflict execution. |
| `FR-NODE-016 AC-7` | Phase 2 safe path validation. |
| `FR-NODE-016 AC-8` | Phase 4 copy/mirror without content rewrites except documented entrypoint normalization. |
| `FR-FLOW-012 AC-1..AC-6` | Phase 3/5 MCP output and Phase 7 scans/evidence. |

## First Commands for the Implementation Session

Start with the required SpecKiwi workflow:

```powershell
Get-Content -Encoding UTF8 docs/spec/00.index.md
```

Then use MCP:

1. `get_active_target`
2. `summarize_target` for `v2.2.3`
3. `list_requirements` for `status=in_progress`, `status=blocked`, and `status=implemented`
4. `get_requirement` for `IR-CLI-027`, `FR-NODE-016`, `FR-FLOW-012`

Do not start code until Phase 0 SRS contract repair is complete.
