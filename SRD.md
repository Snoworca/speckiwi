# SRD

## SpecKiwi Agent Instruction Versioning

### Goal

Replace the current weak `AGENTS.md` / `CLAUDE.md` guidance with a stronger SRS-enforcement instruction block. The block must be versioned so future prompt changes can update existing agent files deterministically instead of appending duplicate instructions.

### Required Agent Instruction Block

The current instruction block version is `v1.1`.

```md
# SpecKiwi SRS 워크플로 v1.1

This repository uses `docs/spec/` as the required source of truth for requirements.

Before making any code, test, CLI, MCP, or documentation change, agents MUST:
1. Read `docs/spec/00.index.md`.
2. Find the relevant Requirement ID in the scope SRS files.
3. Mention the Requirement ID in the work summary.
4. If no matching requirement exists, stop and ask whether to create/update an SRS requirement first.

Agents MUST NOT:
- Implement behavior that is not covered by an SRS requirement.
- Create an alternate requirements source outside `docs/spec/`.
- Change requirement IDs manually.
- Mark requirements as verified without evidence.

When SpecKiwi MCP tools are available, agents MUST use them for requirement lookup and safe SRS updates. If MCP is unavailable, use the `speckiwi` CLI.

Current work status workflow:
1. Read the active target with MCP `get_active_target`, or CLI `speckiwi active-target --json` if MCP is unavailable.
2. If `activeTarget` is empty, report that no active target is set and ask which target to use before making target-scoped changes.
3. Read open work with MCP `list_requirements` for `status=in_progress`, `status=blocked`, and `status=implemented`; CLI fallback is `speckiwi list --status <status> --json`.
4. Check missing verification evidence through `summary` or MCP `summarize_target` before saying work is complete.
5. Read recent completed work with MCP `list_completed_work`; CLI fallback is `speckiwi completed-work --json`.

Completed Work Log is a read-only summary for agents. Requirement Block status, Acceptance Criteria, Verification Evidence, and Change Notes remain the source of truth for completion.

<!-- /SpecKiwi SRS 워크플로 -->
```

### Detection Rules

- Detect a managed SpecKiwi instruction block with a regular expression that matches the heading:

```regex
^# SpecKiwi SRS 워크플로 v(?<version>[0-9]+(?:\.[0-9]+)*)$
```

- The block starts at the matched heading.
- The block ends at the suffix marker:

```md
<!-- /SpecKiwi SRS 워크플로 -->
```

- The suffix marker is required so the updater can safely determine the sentence/block range to replace.
- If a versioned heading is found without the suffix marker, do not treat it as a managed block; leave that text intact and append the current block.
- A suffix marker belongs to a versioned heading only when it appears before the next top-level Markdown heading.

### Update Rules

- If no managed block exists, append the current `v1.1` block to the end of the target file.
- If a managed block exists and its version equals the current version, leave the file unchanged.
- If a managed block exists and its version differs from the current version, replace the entire block from heading through suffix marker with the current block.
- If a legacy unversioned SpecKiwi block exists, such as `# SpecKiwi SRS workflow`, treat it as an outdated managed block and replace it with the current versioned block.

### Scope

- Apply the same logic to both root-level `AGENTS.md` and `CLAUDE.md`.
- `speckiwi init`, MCP `init_project`, and MCP startup auto-init must all use the same shared upsert logic.
- Do not restore an `--agent-file` or `agentFile(s)` selector. SpecKiwi manages both agent instruction files consistently.

## Active Target Tracking

### Goal

`docs/spec/00.index.md` must record the target version that agents should treat as the active work target when one has been selected. The value is exposed explicitly as `Active Target` in the index metadata table so humans and agents can read it without scanning the whole map.

### Requirements

- The index metadata table must include `| Active Target | <target-or-empty> |`.
- New workspaces created by `speckiwi init`, MCP `init_project`, or MCP startup auto-init must create `| Active Target |  |` with an empty value.
- `init --target` may create a Target Map row with `Status` = `planned`, but it must not set the Active Target value.
- Parsing `00.index.md` must expose `activeTarget`. If the metadata row exists and is empty, `activeTarget` is the empty string and no fallback is allowed. If the metadata row is missing in an older index, fall back to the first Target Map row with `Status` = `active`, then the first target.
- CLI must provide a read command for the active target and a mutation command to update it.
- MCP must provide a read tool/resource for the active target and a mutation tool to update it.
- Updating the active target must validate that the target exists in Target Map, update the `Active Target` metadata row, set that target row to `active`, and move any previous `active` row back to `planned`.
- The active target is used as the default target for target summaries only when it is non-empty. If it is empty, agents must report that no active target is selected before making target-scoped changes.

## Completed Work Log

### Goal

`docs/spec/00.index.md` must include a concise Completed Work Log so humans and agents can answer current-work status requests with both active work and recently completed work.

### Requirements

- The index should contain a `Completed Work Log` section with this table header:

```md
| Date | Target | Scope | Requirement IDs | Summary |
|---|---|---|---|---|
```

- Completed Work Log rows are a summary only. Requirement Block `Status`, Acceptance Criteria, Verification Evidence, and Change Notes remain the source of truth.
- `Date` must use `YYYY-MM-DD`; mutation commands must reject invalid dates.
- `Target` may be empty for cross-target or targetless work. Target-filtered reads must include rows whose Target cell is empty.
- `Scope` may contain comma-separated scope prefixes or names.
- `Requirement IDs` may contain comma-separated IDs.
- Parser and validator must expose inconsistent historical rows as warnings, not release-blocking errors.
- CLI must provide `speckiwi completed-work` and `speckiwi add-completed-work`.
- MCP must provide `list_completed_work`, `add_completed_work`, `speckiwi://completed-work`, and `speckiwi://completed-work/{target}`.
