<p align="center">
  <a href="#english-version"><strong>📖 View English documentation</strong></a>
  &nbsp;·&nbsp;
  <a href="#korean-version"><strong>📖 한국어 문서 보기</strong></a>
</p>

---

<a id="english-version"></a>

# SpecKiwi

SpecKiwi is a local-first workflow tool that treats Markdown SRS (Software Requirements Specification) documents inside a Git repository as the canonical source of requirements. It gives people and coding agents a single shared view of the same requirements through a **CLI** and a **stdio MCP server**.

**Kiwi skills** are coding-agent skills built on top of SpecKiwi. They connect requirement authoring, feasibility review, implementation planning, TDD-based coding, SRS synchronization, commit, and push into one pipeline.

- Requirements live in `docs/spec/**/*.srs.md` (GitHub-Flavored Markdown). No YAML, no database, no requirements server.
- The CLI and the MCP server share the same core parser, validator, query, and mutation engine.
- Everything is a normal Git-tracked file, so requirements are reviewed and versioned like code.

**Key terms.** A **Target** (e.g. `v0.1.0`) groups requirements for a release; the **Active Target** is the one new work defaults to. A **Scope** is a functional area with an ID prefix (`App:APP` → `FR-APP-001`). Each requirement carries two independent lifecycle fields — **Status** (implementation/verification progress) and **Stability** (change-control maturity).

## Table of Contents

1. [Requirements](#en-requirements)
2. [Install SpecKiwi](#en-install)
3. [Initialize a project — and what `init` does](#en-init)
4. [Install Kiwi Skills (standalone)](#en-skills)
5. [Connect the MCP server](#en-mcp) — ends with [your first run](#en-first-run)
6. [Kiwi skill types](#en-skill-types)
7. [Skill pipeline](#en-pipeline)
8. [Command reference](#en-commands)
9. [SRS working principles](#en-principles)
10. [Package development](#en-dev)
11. [Related requirements](#en-reqs)

<a id="en-requirements"></a>

## 1. Requirements

- **Node.js 22 or newer** (`engines.node` is `>=22`)
- **npm**
- **Git** (SpecKiwi resolves the project root by searching upward for a Git repository). **Keep `docs/spec/` at the git top level** — three things follow the top level and not the resolved root: the pre-commit hook `init` installs, the `kiwi/` pipeline journal the agent skills pin, and the `.claude` / `.codex` skill install destinations. `speckiwi doctor` checks this as *project root is the git top level*.
- One supported coding agent: `codex`, `claude`, `opencode`, or `hermes`

<a id="en-install"></a>

## 2. Install SpecKiwi

Install SpecKiwi in your project:

```sh
npm install speckiwi@latest
```

After a local install, run it with `npx`:

```sh
npx speckiwi --version   # -> 2.10.0
npx speckiwi --help
```

To put `speckiwi` on your PATH directly, install it globally:

```sh
npm install -g speckiwi@latest
speckiwi --version
```

The examples below use the short `speckiwi` form. If you installed locally only, prefix each command with `npx`.

**Global options** available on every command:

| Option | Description |
| --- | --- |
| `--root <path>` | Project root to operate on — every command **except** `mcp` (see §5). Default: search upward from the current directory. |
| `--json` | Emit machine-readable JSON to stdout. |
| `--no-color` | Disable ANSI color. |
| `--quiet` | Suppress non-essential human output. |
| `-V, --version` | Print the version. |
| `-h, --help` | Print help for the command. |

<a id="en-init"></a>

## 3. Initialize a project — and what `init` does

Run `init` once at the Git project root to create (or top up) a SpecKiwi SRS workspace **and** onboard your coding agents in a single step:

```sh
speckiwi init --target v0.1.0 --scope "App:APP"
```

### What `speckiwi init` performs

The whole operation runs under an SRS mutation lock and is **idempotent** — existing files are reported as `skipped` (never overwritten unless you pass `--force`), and the agent-instruction block is replaced in place whenever its content differs from the shipped text, whatever version it declares.

| # | Step | Result |
| --- | --- | --- |
| 1 | **SRS scaffold** | `docs/spec/00.index.md` (Target Map, Scope Map, Completed Work Log center), `docs/spec/90.appendix.md`, and, only when the project has no scope document yet, an empty scope document derived from `--scope` — `docs/spec/01.<scope>.srs.md` on a fresh init; the number itself comes from the allocator, not from `--scope`, and is the lowest one not already taken by a `.md` file in `docs/spec/`. A project that already has scope documents gets none, and its documents are registered under their own scope names. |
| 2 | **Step state** | `docs/spec/steps/state.md` with a `Mode: wait` metadata block and an empty step-state table. |
| 3 | **Authoring rules** | `docs/rule/SRS-MD-Rules-v2.5.0.md` and `docs/rule/SDS-MD-Rules-v2.5.0.md` (the bundled SRS-MD and SDS-MD authoring rules). |
| 4 | **Agent instructions** | Inserts/updates the *SpecKiwi SRS workflow* block in both `AGENTS.md` and `CLAUDE.md`. A block whose content differs from the shipped text is replaced in place, whatever version it declares; a block that already matches is left untouched. |
| 5 | **Hooks** | `docs/.kiwi/hooks/{pre-commit.mjs,trace.mjs}` + `docs/.kiwi/trace/`; a Git `.git/hooks/pre-commit` gate that delegates to the runner; `.claude/settings.json` (PostToolUse trace hook); `.codex/hooks.json` (apply_patch trace hook). An existing `.git/hooks/pre-commit` is never overwritten: it is reported as `skipped` if it already delegates to the runner, and otherwise left as-is with a warning telling you how to wire it up. The two agent hook files are reported as `skipped` when they already exist — and are overwritten by `--force`, like every other scaffolded file. |
| 6 | **MCP registration** | Registers the SpecKiwi stdio MCP server in `.mcp.json` (idempotent; `skipped` if already present). Disable with `--no-mcp`. |
| 7 | **Skill provisioning** | Installs the bundled Kiwi skills for **Claude** (`.claude/skills`) and **Codex** (`.agents/skills`), then prunes orphaned `kiwi-*` skill directories that SpecKiwi previously managed. Disable with `--no-skills`. |

The result is reported as an envelope of five arrays: **`created` / `updated` / `skipped` / `removed` / `warnings`** (add `--json` for the machine-readable form).

Typical layout after a first run:

```text
AGENTS.md                     # SpecKiwi SRS workflow block
CLAUDE.md                     # SpecKiwi SRS workflow block
.mcp.json                     # speckiwi MCP server registration
.claude/skills/kiwi-*         # Claude Kiwi skills
.claude/skills/_shared/kiwi/  # contracts the skills share
.agents/skills/kiwi-*         # Codex Kiwi skills
.agents/skills/_shared/kiwi/  # the same, for Codex
.claude/settings.json         # PostToolUse trace hook
.codex/hooks.json             # apply_patch trace hook
.git/hooks/pre-commit         # delegates to docs/.kiwi/hooks/pre-commit.mjs
docs/
├─ .kiwi/hooks/               # bundled hook runners
├─ .kiwi/trace/               # trace output trace.mjs writes
├─ rule/
│  ├─ SRS-MD-Rules-v2.5.0.md
│  └─ SDS-MD-Rules-v2.5.0.md
└─ spec/
   ├─ 00.index.md             # targets, scopes, completed work log
   ├─ 01.app.srs.md           # your first scope document
   ├─ 90.appendix.md
   └─ steps/state.md
```

`docs/spec/00.index.md` is the hub for targets, scopes, and the completed work log. Requirement bodies live in `docs/spec/**/*.srs.md`, which remains the **canonical source of truth**.

### `init` options

| Option | Description |
| --- | --- |
| `--target <target>` | Initial Active Target to register (e.g. `v0.1.0`). |
| `--scope "Name:PREFIX"` | Initial scope, used only when the project has no scope document yet (e.g. `"App:APP"` → `FR-APP-001`). To add a scope to a project that already has documents, use `speckiwi scaffold-scope <Name>:<PREFIX> --apply`, which allocates the next document number and registers both index rows. |
| `--no-mcp` | Skip registering the MCP server in `.mcp.json`. |
| `--no-skills` | Skip installing the bundled Kiwi skills (and the orphan prune). |
| `-g, --global` | Also install/update the bundled Kiwi skills into each **present** agent's global skills dir (Claude `~/.claude/skills`, Codex `${CODEX_HOME:-~/.codex}/skills`); an agent whose home directory is absent is skipped with a warning. The project-scope install still runs, and no orphan prune is performed at global scope (the shared home may hold skills from other projects). |
| `--dry-run` | Preview every step (populates `created`/… ) without writing anything to disk. |
| `--force` | Overwrite existing scaffolded files instead of skipping them. It rewrites author-owned files and their content is lost: `00.index.md` (Target Map, Scope Map and the Completed Work Log), `90.appendix.md`, `docs/spec/steps/state.md` (work mode and step state), and — the one most likely to hurt — the two agent hook files `.claude/settings.json` and `.codex/hooks.json`, which is where your own permissions, hooks and env live. It also restores the two bundled hook runners under `docs/.kiwi/hooks/`, so local edits to those are lost too. An **existing** scope document is never rewritten, with or without `--force`. The bundled rules documents are refreshed without it. |
| `--ignore-lock` | Bypass a stale SRS mutation lock. |
| `--json` | Emit the result envelope as JSON. |

**Exit codes:** `0` success · `2` usage error (e.g. unknown flag) · `5` init failure (e.g. a held mutation lock).

> **MCP parity note.** The MCP `init_project` tool only scaffolds the SRS files — it never registers the MCP server or installs skills. Those two steps are CLI defaults, so running `init` through an agent's MCP connection can never self-install skills or edit `.mcp.json`.

<a id="en-skills"></a>

## 4. Install Kiwi Skills (standalone)

`speckiwi init` already provisions Claude + Codex project skills. Use the standalone installer when you want a **different agent** (OpenCode, Hermes), a **global** install, or a **custom destination**:

```sh
speckiwi skills install <agent> <skill|all>
```

Supported `<agent>` values: `codex`, `claude`, `opencode`, `hermes`.

```sh
speckiwi skills install codex all
speckiwi skills install claude all
speckiwi skills install opencode all
speckiwi skills install hermes all --global
```

Preview the plan before copying files:

```sh
speckiwi skills install codex all --dry-run --json
```

### Agents and destinations

| Agent | Package source root | Default project destination | Global destination |
| --- | --- | --- | --- |
| Codex | `skills/codex` | `.agents/skills/<skill>` | `${CODEX_HOME:-$HOME/.codex}/skills/<skill>` |
| Claude | `skills/claude` | `.claude/skills/<skill>` | `$HOME/.claude/skills/<skill>` |
| OpenCode | `skills/etc` | `.opencode/skills/<skill>` | `$HOME/.config/opencode/skills/<skill>` |
| Hermes | `skills/etc` | requires `--dest <dir>` | `$HOME/.hermes/skills/<category>/<skill>` |

### Other `skills` subcommands

```sh
speckiwi skills add <agent> <skill>    # alias of `skills install`
speckiwi skills mirror --check         # verify .agents/skills/** against skills/codex/**
speckiwi skills mirror --write         # regenerate it
```

`mirror` matters only when you maintain the skill sources themselves — the `.agents/skills/**` tree is a generated copy of `skills/codex/**` and must never be hand-edited.

### Options

| Option | Description |
| --- | --- |
| `--global`, `-g` | Install into the user-level skill directory. |
| `--dest <dir>` | Install into a custom destination root; each skill lands under `<dir>/<skill>`. |
| `--category <name>` | Hermes global-install category (default `kiwi`; Hermes global only). |
| `--dry-run` | Print the install plan without copying files. |
| `--json` | Print machine-readable JSON output. |

`--global` and `--dest` are mutually exclusive. Per-skill operations are reported as **`install` / `update` / `skip` / `conflict`**. A `conflict` (an unsafe path or a destination that is not a valid skill) aborts without a partial install.

<a id="en-mcp"></a>

## 5. Connect the MCP server

Normal Kiwi skill workflows expect a connected SpecKiwi MCP server:

```sh
speckiwi mcp
```

The server speaks **stdio** and does **not** accept `--root`. It resolves the project root from the server process's current working directory by searching upward, so set the client's working directory (cwd) to the project root. Running the server with `--root` exits with an error instead of starting.

**Git worktrees.** The root is bound to the server process, so a session cannot move it: a server already running does not follow a mid-session worktree switch — restart the agent inside the worktree instead. A worktree-rooted session must also **not allocate new Requirement IDs**, and cannot edit the host repository's `docs/spec/`; take both back to the host root.

`speckiwi init` writes this registration into `.mcp.json` (inside a checkout of SpecKiwi itself it registers the local `bin/speckiwi` instead, so the checkout tests its own build):

```json
{
  "mcpServers": {
    "speckiwi": {
      "command": "npx",
      "args": ["-y", "speckiwi", "mcp"]
    }
  }
}
```

After `init` writes `.mcp.json`, reload or restart your agent so it launches the server. Run `speckiwi mcp` by hand only for debugging — it blocks on stdio and can look like it is hanging.

### MCP tools

Kiwi skills use MCP tools for all reads and safe SRS mutations. CLI equivalents exist as a fallback for diagnostics and manual operation — they are not the normal mutation path.

| Category | Tools |
| --- | --- |
| Target & goal | `get_active_target`, `set_active_target`, `set_target_goal`, `summarize_target` |
| Read | `list_requirements`, `get_requirement`, `list_completed_work`, `search_requirements`, `get_next_work_order` |
| Status & stability | `update_status`, `update_stability` |
| Evidence & trace | `check_acceptance_criteria`, `add_verification_evidence`, `add_trace_link` |
| Authoring & editing | `add_requirement`, `append_section_note`, `add_completed_work`, `edit_requirement_fields`, `edit_requirement_table_rows`, `replace_acceptance_criteria`, `supersede_requirement` |
| Work mode | `get_work_mode`, `set_work_mode` |
| Steps & TDD First | `claim_step`, `scaffold_step`, `validate_step`, `synthesize_step_srs`, `promote_step_requirement`, `update_step_state`, `set_sds_status`, `list_steps`, `check_vibe_gate` |
| Duplicate-ID repair | `diagnose_requirement_id_collisions`, `plan_requirement_id_collision_repair`, `apply_requirement_id_collision_repair` |
| Workspace | `validate_spec`, `sync_index`, `init_project`, `register_scopes`, `scaffold_scope`, `mcp_workspace_info`, `preview_legacy_workflow_migration` |
| Compatibility | `add_compatibility_check`, `refresh_compatibility_check`, `revoke_compatibility_check`, `list_compat_edges`, `list_dirty_edges` |
| Orchestrator run surface | 27 `orchestrate_*` tools — the run lock and journal, routing probe/freeze, lane schedule and handoff, verification rounds, wave close, resume and replay, and the `--auto` gate decision. |
| Workflow & pipeline | 26 `workflow_*` tools — plan tasks and checklists, pipeline emit/status/tail, worklog, artifacts, and the workflow doctor. |

**100 tools ship in total.** The rows above name the ones a skill calls directly; the two grouped rows are large families whose members are documented in the skill that drives them. After an upgrade, trust the count `speckiwi doctor` reports — it is what the server actually registered.

#### Per-call `workspaceRoot`

The MCP server resolves its own root from the directory it was started in, and that root is the only place SRS is read or written. A session whose server is fixed to the host checkout can still address run state that lives in a linked worktree by passing an optional absolute `workspaceRoot` on each call.

| Family | `workspaceRoot` |
| --- | --- |
| `workflow_*` (all 26) | accepted |
| `orchestrate_*` | accepted, except `orchestrate_replay_apply` (a deferred SRS mutation replays only at the host root) and `orchestrate_preflight` (it already takes `--mcp-root` and `--git-root`) |
| Every SRS-facing tool — `add_requirement`, `update_status`, `supersede_requirement`, `validate_spec`, `sync_index`, `mcp_workspace_info` and the rest | refused |

Refusal is the default: a tool that does not declare itself worktree-local refuses the argument, so a newly added SRS tool is safe without being listed anywhere. An accepted root must be an absolute path, an existing directory, a git top level rather than a subdirectory of one, and a worktree sharing the startup root's git common directory; each failure is refused with its own `workspace-root-*` reason before the tool runs, so a path that does not exist is refused rather than created. A path argument that lands under `docs/spec` is refused even on a tool that accepts the root.

**Confirm workspace identity from the envelope before any target-scoped read or mutation.** Every result carries `mcpWorkspace` with `workspaceRoot`, `rootSource`, `indexPath` and `packageVersion`. `rootSource` is `server-cwd-discovery`, `auto-init`, or `per-call-workspace-root` — and it is `per-call-workspace-root` exactly when the call supplied a `workspaceRoot` that passed every gate, so the answer always names the root it came from.

<a id="en-first-run"></a>

### Your first run

With the MCP server connected, drive the work in natural language — the Kiwi skills trigger on intent (or invoke one by name, e.g. `/kiwi-srs`). For example, ask your agent:

> *Use kiwi-srs to capture a requirement: a user can reset their password by email.*

`kiwi-srs` allocates a Requirement ID and writes it into a scope document such as `docs/spec/01.<scope>.srs.md`; from there `kiwi-srs-feasibility` → `kiwi-planner` → `kiwi-pm` / `kiwi-coder` carry it to implementation. The pipeline in §7 shows the full flow.

<a id="en-skill-types"></a>

## 6. Kiwi skill types

| Skill | Main purpose |
| --- | --- |
| `kiwi-srs` | Analyze a new request or change request and register/align SpecKiwi SRS requirements. |
| `kiwi-srs-from-code` | Reverse-analyze an existing codebase and generate scope-level SRS drafts. |
| `kiwi-srs-feasibility` | Evaluate active-target requirements for feasibility, risk, and stability. |
| `kiwi-srs-research` | Research ambiguous requirements, blockers, external constraints, and risks. |
| `kiwi-planner` | Decompose active-target requirements into phases and tasks, producing `plan.md` + sidecar JSON. |
| `kiwi-coder` | Execute task-level TDD, implementation, verification, and MCP evidence recording. |
| `kiwi-pm` | Run a `kiwi-planner` plan by dispatching each task to `kiwi-coder` sequentially. |
| `kiwi-srs-sync` | Analyze `git diff` after code-first work and synchronize the SRS afterward. |
| `kiwi-commit-auto-push` | Connect Git changes to requirement evidence, then commit and push. |
| `kiwi-commit-auto-pr` | Commit and push, then create/update a GitHub PR with PR evidence links. |
| `kiwi-hot-fix` | Handle urgent bugs with TDD, regression checks, and post-fix SRS sync. |
| `kiwi-review-fix-loop` | Run review/fix/re-review over local changes or PR comments; optionally verify REQs. |
| `kiwi-pipeline` | Read `kiwi/pipeline.jsonl` and run the next Kiwi skill step. Since 2.9.0 the **default is the full research-to-implementation cycle** (`kiwi-srs` -> ... -> `kiwi-review-fix-loop`); pass `--none-cycle` for a single next-step recommendation. The cycle runs only when the invocation carries a work input, so a status question stays a status question. |
| `kiwi-step` | Author step-local requirement drafts under `docs/spec/steps/<name>/` — claim a step, write only inside it (no body-scope SRS edits), then validate it locally. The lightweight counterpart of `kiwi-srs`. |
| `kiwi-tdd` | Drive one step through the `tdd` work-mode's TDD First cycle: author the SDS (`design.md`), turn its EARS acceptance contracts into failing tests (red), implement to green, run regression, then synthesize and promote the step requirement with mandatory evidence. |
| `kiwi-orchestrator` | Drive one run end to end from a single entry point: probe the work, route it to the rung it actually needs (step / plan / orchestrated), and run that rung to a recorded close. Owns the run journal (`kiwi/waves.jsonl`), the `--auto` gate table, resume, and — since 2.10.0 — the terminal review-loop obligation every rung's close must discharge. On the orchestrated rung a stage's lanes are partitioned and the parallelisability analysis is published for review, but the shipped skill executes them **serially** on the run's integration branch — concurrent lane execution and the per-lane merge gate are declared future work, which the skill says of itself. Options: `--auto`, `--max`, `--mini` / `--loops N`, `--work`, `--base-branch`, `--lanes N`. |
| `kiwi-wave-master` | Split a large task (epic/roadmap/long research) into ordered waves, register a dedicated target per wave, and run each wave's pipeline sequentially. Resumable via `kiwi/waves.jsonl`. Options: `--auto`, `--max`, `--mini` / `--loops N`, and `--drive` — the flag that also opens the integration-test and cost gates `--auto` alone stops at. |

The same skill set ships in agent-specific source trees: **`skills/codex`** (Codex invocation + clarification-gate wording), **`skills/claude`** (Claude skill environment), and **`skills/etc`** (Agent Skills format for OpenCode / Hermes and local-LLM usage; defaults to a single evaluator/sub-agent profile).

<a id="en-pipeline"></a>

## 7. Skill pipeline

A new feature or change request usually flows like this:

```mermaid
flowchart TD
    A["User requirement or work idea"] --> B{"Choose starting point"}
    B -->|New requirement| C["kiwi-srs: Write/update SRS requirement"]
    B -->|Reverse from existing code| D["kiwi-srs-from-code: Generate SRS from code"]
    B -->|Code changed first| E["kiwi-srs-sync: Sync SRS from git diff"]
    B -->|Urgent bug| Q["kiwi-hot-fix: Urgent TDD fix"]

    C --> F["kiwi-srs-feasibility: Evaluate feasibility/stability"]
    D --> F
    E --> F
    Q --> M

    F --> G{"Blocker or ambiguity?"}
    G -->|Yes| H["kiwi-srs-research: Research risk/blocker"]
    H --> F
    G -->|No| I["kiwi-planner: Create plan.md + sidecar JSON"]

    I --> J["kiwi-pm: Orchestrate task execution"]
    J --> K["kiwi-coder: Task-level TDD/implementation/verification"]
    K --> L{"More tasks?"}
    L -->|Yes| J
    L -->|No| R["kiwi-review-fix-loop: Review/fix/re-review"]
    R --> M["SpecKiwi MCP: Record evidence/status/completed-work"]
    M --> S{"PR needed?"}
    S -->|No| N["kiwi-commit-auto-push: Commit + push"]
    S -->|Yes| T["kiwi-commit-auto-pr: Commit + push + PR"]
    N --> O["Done"]
    T --> O

    P["kiwi-pipeline: Run the next step (full cycle by default)"] -.-> B
    P -.-> F
    P -.-> I
    P -.-> J
    P -.-> N
```

Inside `kiwi-coder`, each task runs a TDD loop:

```mermaid
flowchart TD
    A["kiwi-planner output: plan.md + sidecar JSON"] --> B["kiwi-coder selects a task"]
    B --> C["Read related REQ/AC: speckiwi MCP"]
    C --> D["Write failing test"]
    D --> E["Confirm red"]
    E --> F["Implement the smallest change"]
    F --> G["Confirm green"]
    G --> H["Review/formal validation/regression tests"]
    H --> I{"Issues?"}
    I -->|Yes| F
    I -->|No| J["Add MCP evidence"]
    J --> K["Check AC / update status"]
    K --> L["Update kiwi/ state and worklog"]
```

This is the per-task loop inside `kiwi-coder` on the main pipeline. For **step-scoped** work the `tdd` work-mode runs an alternative **TDD First** cycle via `kiwi-tdd` — SDS → red → green → regression → `promote_step_requirement` — instead of routing through `kiwi-planner` / `kiwi-pm` (see §8, *Work modes and steps*).

### Choosing an entry point

The flow above is what a single feature looks like. Three entry points sit above it — one runs that flow, two decide which flow the work needs:

| Entry point | Use it when | What it does |
| --- | --- | --- |
| `kiwi-pipeline` | You are working through one feature and want the next step taken. | Runs the full research-to-implementation cycle by default; `--none-cycle` recommends a single next step instead. |
| `kiwi-orchestrator` | You have one work item but do not want to decide which rung it needs. | Probes the work, routes it to the **step**, **plan**, or **orchestrated** rung, and runs that rung to a recorded close in `kiwi/waves.jsonl`. Resumable. |
| `kiwi-wave-master` | The work is an epic, a roadmap, or long research that will not fit one target. | Splits it into ordered waves, registers a target per wave, and runs each wave's pipeline in sequence. Resumable. |

**Every boundary that records a pass owes a review.** Since 2.10.0 both orchestrating skills must run `kiwi-review-fix-loop` over the commit window the boundary judges — exactly once, no rung exempt — and record the result on the run-closing journal line. A close that reports completion without a discharging review is refused by `speckiwi orchestrate validate`, so the guarantee is checkable rather than merely written down.

<a id="en-commands"></a>

## 8. Command reference

### Validate the workspace

```sh
speckiwi validate                    # exit 0 = ok, 1 = validation failed
speckiwi validate --fail-on-warning  # treat warnings as failures
speckiwi validate --json
speckiwi explain SRS-E002            # explain a diagnostic code
```

### Read requirements and status

```sh
speckiwi active-target                        # resolve the Active Target
speckiwi targets                              # list registered targets
speckiwi summary --target v0.1.0              # status/stability/type rollups + blockers
speckiwi list --target v0.1.0                 # list requirements (JSON via --json)
speckiwi show FR-APP-001 --markdown           # a single requirement
speckiwi search "login timeout"               # full-text search
speckiwi scopes                               # registered scopes
speckiwi completed-work --target v0.1.0 --order latest
speckiwi doctor                               # 11 checks: spec parseability, agent block currency, rules drift and reference,
#            SDS rules install, skill mirror and install drift, git-top-level root,
#            Active Target, scope/target consistency, Node version
```

### Maintain the index

```sh
speckiwi sync-index            # recompute the §5/§6 rollup summaries in 00.index.md
speckiwi sync-index --dry-run
```

<a id="en-upgrade"></a>

### Bring an older project up to date

`speckiwi init` refreshes everything the tool owns — the rules documents, the agent workflow block, the skills, the index `Rules` row when there is one. By contract it never edits author-owned content, so two things survive it in a project set up by an older version:

- a link or a sentence still naming a rules document this release no longer ships, and
- an index whose metadata table has no `Rules` row at all (the refresh only ever *replaces* an existing row).

`speckiwi upgrade` closes both. It **performs the migration**, like the `init` it delegates to; pass `--dry-run` to read the plan first:

```sh
speckiwi upgrade                  # perform it
speckiwi upgrade --dry-run        # print the plan; the workspace is untouched
speckiwi upgrade --json           # the standard mutation result envelope
```

`--apply` is still accepted and asks for the same performed run, so a script written before this default flipped keeps working. Passing `--apply` and `--dry-run` together is refused rather than resolved by precedence.

Each repaired reference is reported as `file:line`, in both spellings — the path form (`SRS-MD-Rules-v1.0.0.md`) and the prose form (`SRS-MD Authoring Rules v1.0.0`).

What it deliberately does **not** do, and says so in its own report: it never renumbers a scope document, never edits a requirement body under `docs/spec/` (that is a governance mutation, not a migration), and never overwrites an existing hook. A dangling mention anywhere else under `docs/` is **reported, not rewritten** — a note recording which rules version a project used to follow is a record, not a defect.

`speckiwi doctor` reports the same dangling references under **Rules reference presence**, so you find out even if you never run `upgrade`. The command is CLI-only: no MCP tool exposes it, because it rewrites author-owned files.

| Option | Description |
| --- | --- |
| `--dry-run` | Print the plan and write nothing. |
| `--apply` | Perform the plan. This is the default; the flag is accepted for callers that predate it. |
| `--no-skills` / `--no-mcp` | Skip the corresponding `init` step during the refresh. |
| `--ignore-lock` | Bypass a stale SRS mutation lock. |
| `--json` | Emit the result envelope as JSON. |

**Exit codes:** `0` success · `5` failure (e.g. a held mutation lock, or `--apply` and `--dry-run` together — nothing is written).

### Resolve duplicate Requirement IDs after a merge

When two branches each add requirements, a merge can produce duplicate IDs (`SRS-E002`) and `validate` fails. Do not hand-edit IDs — use the guided repair workflow (also available as MCP tools). Select the keep/rename occurrences explicitly by `file:line:blockHash`:

```sh
speckiwi repair requirement-id-collisions diagnose --json
speckiwi repair requirement-id-collisions plan --duplicate-id <id> \
  --keep <file:line:blockHash> --rename <file:line:blockHash> --allocate-next \
  --write-plan .kiwi/id-repair.json --json
speckiwi repair requirement-id-collisions apply --plan .kiwi/id-repair.json --json
```

### Track progress and traceability

```sh
speckiwi release-readiness --target v0.1.0   # release gate rollup
speckiwi coverage --target v0.1.0            # acceptance-criteria coverage
speckiwi rtm --target v0.1.0                 # requirements traceability matrix
speckiwi history FR-APP-001                  # change history of one requirement
speckiwi changed-since 2026-07-01            # requirements changed since a date
speckiwi stale                               # requirements with no recent activity
speckiwi attention                           # requirements needing attention
speckiwi links check                         # trace-link integrity (workflow gate)
```

### Work modes and steps

The work mode is persisted in `docs/spec/steps/state.md`; a fresh project starts in `wait`.

- **`wait`** — default; no Active Task, the SRS-first rules apply.
- **`sdd`** — spec-driven body work (author/adjust body-scope requirements first, then implement).
- **`vibe`** — code-first: write code against an Active Task, then synthesize the SRS afterward (`vibe-gate` blocks unsynthesized commits).
- **`tdd`** — step-scoped **TDD First** cycle via `kiwi-tdd`: author an SDS (Software Design Specification, `design.md`) with EARS-style acceptance contracts, turn them into failing tests (red), implement to green, run regression, then synthesize and promote the step requirement.

```sh
speckiwi mode                                    # show the current work mode (sdd | vibe | wait | tdd)
speckiwi mode tdd                                # switch mode (sdd, vibe, wait, or tdd)
speckiwi step claim <name> --touches-scope APP   # claim a step before authoring it
speckiwi step scaffold <name>                    # create design.md + intent.md stubs
speckiwi step validate <name>                    # validate a step-local draft under docs/spec/steps/<name>/
speckiwi step sds-status <name> agreed           # advance the SDS lifecycle (draft -> agreed -> superseded)
speckiwi step synthesize <name>                  # synthesize the step SRS from design.md
speckiwi step promote <id> --from-step <name> --to-scope APP   # promote into a body scope (evidence required in tdd)
speckiwi step update-state <name> --status merged              # transition the step through the completion gate
speckiwi vibe-gate check                         # CI gate that blocks unsynthesized vibe/tdd commits
```

### Mutations (MCP is the normal path; CLI is for manual operation and diagnostics)

`--reason` records a Change Notes row; `--dry-run` previews the result before applying.

```sh
speckiwi update-status FR-APP-001 implemented --reason "AC met, regression passed"
speckiwi update-stability FR-APP-001 stable --reason "interface finalized"
speckiwi check-ac FR-APP-001 AC-1 AC-2
speckiwi add-evidence FR-APP-001 --type command --reference "npm test" --covers all --notes "regression passed"
speckiwi add-trace FR-APP-001 --type code --reference "src/app.ts:42" --relation implements
speckiwi append-note FR-APP-001 --section rationale --text "record decision background"
speckiwi set-target-goal v0.1.0 --goal "first usable release"
speckiwi set-active-target v0.2.0
speckiwi set-target-status v0.1.0 completed   # planned|active|frozen|completed|released|archived
speckiwi add-completed-work --date 2026-07-13 --target v0.1.0 --scope APP --summary "..."
```

Most mutation commands accept `--json`, `--dry-run`, and `--ignore-lock`. A mutation failure exits with `5`.

### Inspect an orchestrated run

`kiwi-orchestrator` keeps its state in `kiwi/waves.jsonl`. These read-only commands let you check a run without driving it:

```sh
speckiwi orchestrate validate --run-id <id> --json          # refuse a journal that breaks a run invariant
speckiwi orchestrate validate --run-id <id> --strict        # also fail an unstamped or downgraded line
speckiwi orchestrate validate --run-id <id> \
  --engine kiwi-wave-master                                 # read the other producer's lines
speckiwi orchestrate resume --run-id <id> --json            # what a resume would pick up
```

`--engine` selects which producer's lines are read — the two engines share one file and a reader sees only its own. An unrecognised value is refused rather than defaulted, because a silent fallback validates a journal it never opened and reports it clean.

The remaining `orchestrate` subcommands (`route`, `schedule`, `handoff`, `wave`, `round`, `issue`, `replay`, `auto-gate`, …) are driven by the skill, not by hand; `speckiwi orchestrate --help` lists them.

Three directories are easy to confuse, and none is edited by hand. **`docs/.kiwi/`** is tool-owned and created by `init` — it holds the bundled hook runners. **`kiwi/`** is skill-owned run state that appears after your first skill run — `pipeline.jsonl`, `waves.jsonl`, and the resume card. **`.kiwi/`** at the project root holds per-run session state — locks, plan and coder state, worklog — that the executing skills write under `sessions/<run-id>/`.

`speckiwi workflow` is the same shape — a group of subcommands (`plan-status`, `plan-task`, `next-task`, `pipeline-status`, `pipeline-tail`, `worklog-tail`, `task-check`, `doctor`, …) that the Kiwi skills call to keep `kiwi/pipeline.jsonl` and plan state consistent. They are diagnostic and skill-facing rather than part of a normal hand-run workflow; `speckiwi workflow --help` lists them.

<a id="en-principles"></a>

## 9. SRS working principles

- Before any change, read `docs/spec/00.index.md`, find the relevant Requirement ID, and cite it in your work summary. If no matching requirement exists, stop and ask whether to author one first.
- `docs/spec/**/*.srs.md` is the only canonical requirements source. Never create an alternate source of truth or edit generated JSON as if it were canonical.
- **Do not invent requirement IDs by hand** — allocate them with SpecKiwi mutation tools.
- Requirement metadata has two independent lifecycle fields:
  - **`Status`** tracks implementation and verification progress — `planned`, `in_progress`, `blocked`, `implemented`, `verified`, `discarded`.
  - **`Stability`** tracks requirement maturity and change control — `draft` → `evolving` → `stable` → `frozen`, plus `deprecated`. Do not implement a `draft` or `deprecated` requirement without explicit approval.
- When `Status` is `discarded` or `Stability` is `draft`, the requirement heading is automatically decorated with a `[DISCARDED]` / `[DRAFT — pending decision]` marker; the marker is removed on revival.
- Use `verified` only after acceptance criteria are checked **and** verification evidence is linked. Bulk mutations that flip many requirements to `verified` at once or empty the Active Target are blocked at the tool level.
- Follow TDD for behavior changes: write a failing test for the target Requirement ID first, make the smallest change to pass, then refactor.
- Kiwi skills never use raw Markdown edits as the normal mutation path — MCP tools come first.

<a id="en-dev"></a>

## 10. Package development

From a source checkout:

```sh
npm ci
npm run build
node bin/speckiwi --help
```

Validation commands:

```sh
npm run typecheck
npm run lint
npm test                  # vitest, --no-file-parallelism
npm run test:coverage
npm run test:integration
npm run release:check
```

Release baseline tag example:

```sh
git tag srs-v1.0.0-baseline
```

The npm package distributes:

```text
bin/
dist/
docs/rule/SRS-MD-Rules-v2.5.0.md
docs/rule/SDS-MD-Rules-v2.5.0.md
docs/.kiwi/hooks
skills/codex/
skills/claude/
skills/etc/
```

<a id="en-reqs"></a>

## 11. Related requirements

The onboarding, skill-installation, mutation, and workflow behavior documented above maps to these SpecKiwi requirements:

- `FR-NODE-067` / `FR-NODE-068` / `FR-NODE-069` / `FR-NODE-070` / `IR-CLI-070`: `speckiwi init` MCP registration, Claude/Codex skill provisioning, orphan `kiwi-*` prune, and the unified dry-run/report envelope.
- `IR-CLI-027` / `FR-NODE-016`: `speckiwi skills install <agent> <skill|all>` CLI and its core service.
- `FR-FLOW-012`: Kiwi skills require the SpecKiwi MCP for normal operation.
- `FR-PARSE-032` / `FR-FLOW-036` / `FR-FLOW-037` / `FR-MCP-052`: the `tdd` work-mode, the SDS-MD authoring standard (`design.md`), the `kiwi-tdd` skill, and the `get_work_mode` / `set_work_mode` MCP tools (TDD First mode).
- `MIG-FLOW-002`: `skills/etc` variant for OpenCode and Hermes.
- `FR-PARSE-017` / `FR-MCP-017` / `IR-CLI-026`: Stability lifecycle and `update_stability`.
- `FR-MCP-018`: `append_section_note` mutation.
- `FR-PARSE-018` / `FR-MCP-019`: Target Goal meta block and `set_target_goal`.
- `FR-ARCH-005`: Mutation tool-kind classification (bulk-mutation governance).
- `FR-PARSE-016` / `FR-NODE-015` / `IR-CLI-024` / `FR-MCP-016`: Completed Work Log report paths.
- `FR-FLOW-124` … `FR-FLOW-130`: the `kiwi-pipeline` default cycle and its single `--none-cycle` opt-out (2.9.0).
- `FR-FLOW-131` … `FR-FLOW-135` / `FR-NODE-188`: the terminal review-loop obligation on every rung, and the `terminal_review` journal record a run-close validator refuses a completion without (2.10.0).
- `FR-NODE-179`: the run-root invariant — `docs/spec/` must sit at the git top level, with a doctor check that says so (2.7.1).
- Targets `2.5.2-phase1-target-lifecycle`, `2.6.0-phase2-parallel-lanes` and the `kiwi-orchestrator` requirement set: target status lifecycle, the lane partition and worktree contract, and the orchestrator run surface. (The 2.6.0 target's stated goal reaches further than what ships today — see the orchestrator row in §6.) See the Target Map in `docs/spec/00.index.md` for the full list.

---

<a id="korean-version"></a>

# SpecKiwi (한국어)

[English](#english-version) · 목차는 [아래](#ko-toc)에 있습니다.

SpecKiwi는 Git 저장소 안의 Markdown SRS(Software Requirements Specification) 문서를 요구사항의 **유일한 원본(canonical source)**으로 사용하고, **CLI**와 **stdio MCP 서버**를 통해 사람과 코딩 에이전트가 같은 요구사항 데이터를 함께 다루게 해 주는 local-first workflow 도구입니다.

**Kiwi skills**는 SpecKiwi 위에서 동작하는 코딩 에이전트용 작업 스킬 모음으로, 요구사항 작성 · 구현 가능성 검토 · 계획 수립 · TDD 기반 코딩 · SRS 동기화 · 커밋 · push를 하나의 파이프라인으로 연결합니다.

- 요구사항은 `docs/spec/**/*.srs.md`(GitHub-Flavored Markdown)에 저장됩니다. YAML도, 데이터베이스도, 별도 요구사항 서버도 없습니다.
- CLI와 MCP 서버는 동일한 core parser · validator · query · mutation 엔진을 공유합니다.
- 모든 것이 Git으로 추적되는 일반 파일이므로 요구사항을 코드처럼 리뷰하고 버전 관리합니다.

**핵심 용어.** **Target**(예: `v0.1.0`)은 릴리스 단위로 요구사항을 묶고, **Active Target**은 새 작업이 기본으로 향하는 target입니다. **Scope**는 ID 접두사를 가진 기능 영역입니다(`App:APP` → `FR-APP-001`). 각 요구사항은 독립된 두 lifecycle 필드 — **Status**(구현·검증 진행)와 **Stability**(변경 통제 성숙도) — 를 가집니다.

<a id="ko-toc"></a>

## 목차

1. [요구 사항](#ko-requirements)
2. [SpecKiwi 설치](#ko-install)
3. [프로젝트 초기화 — `init`이 하는 일](#ko-init)
4. [Kiwi Skills 개별 설치](#ko-skills)
5. [MCP 서버 연결](#ko-mcp) — 마지막에 [첫 실행](#ko-first-run)
6. [Kiwi skill 종류](#ko-skill-types)
7. [Skill 파이프라인](#ko-pipeline)
8. [명령 레퍼런스](#ko-commands)
9. [SRS 작업 원칙](#ko-principles)
10. [패키지 개발](#ko-dev)
11. [관련 요구사항](#ko-reqs)

<a id="ko-requirements"></a>

## 1. 요구 사항

- **Node.js 22 이상** (`engines.node`는 `>=22`)
- **npm**
- **Git** (SpecKiwi는 상위 디렉터리로 올라가며 Git 저장소를 찾아 project root를 해석합니다). **`docs/spec/`는 git 최상위에 두십시오** — 세 가지가 결정된 루트가 아니라 git 최상위를 따릅니다: `init`이 설치하는 pre-commit 훅, 에이전트 skill이 고정하는 `kiwi/` 파이프라인 저널, `.claude` / `.codex` skill 설치 위치. `speckiwi doctor`가 *project root is the git top level* 항목으로 검사합니다.
- 지원 코딩 에이전트 하나: `codex`, `claude`, `opencode`, `hermes` 중 하나

<a id="ko-install"></a>

## 2. SpecKiwi 설치

프로젝트에 SpecKiwi를 설치합니다.

```sh
npm install speckiwi@latest
```

로컬 설치 후에는 `npx`로 실행합니다.

```sh
npx speckiwi --version   # -> 2.10.0
npx speckiwi --help
```

`speckiwi` 명령을 PATH에서 바로 쓰려면 전역 설치합니다.

```sh
npm install -g speckiwi@latest
speckiwi --version
```

이 README의 예시는 짧게 `speckiwi`로 표기합니다. 로컬 설치만 했다면 각 명령 앞에 `npx`를 붙이세요.

모든 명령에서 쓸 수 있는 **전역 옵션**:

| 옵션 | 설명 |
| --- | --- |
| `--root <path>` | 대상 project root (`mcp`를 **제외한** 모든 명령, §5 참조). 기본: 현재 디렉터리에서 상위 탐색. |
| `--json` | 자동화용 JSON을 stdout으로 출력합니다. |
| `--no-color` | ANSI 색상을 끕니다. |
| `--quiet` | 비필수 사람용 출력을 억제합니다. |
| `-V, --version` | 버전을 출력합니다. |
| `-h, --help` | 명령 도움말을 출력합니다. |

<a id="ko-init"></a>

## 3. 프로젝트 초기화 — `init`이 하는 일

Git 프로젝트 루트에서 `init`을 한 번 실행하면 SpecKiwi SRS workspace를 생성(또는 보강)하고 **코딩 에이전트 온보딩까지 한 번에** 수행합니다.

```sh
speckiwi init --target v0.1.0 --scope "App:APP"
```

### `speckiwi init`이 수행하는 작업

전체 동작은 SRS mutation lock 하에서 실행되며 **멱등(idempotent)**합니다. 이미 존재하는 파일은 `skipped`로 보고되고(`--force` 없이는 절대 덮어쓰지 않음), 에이전트 지시 블록은 선언된 버전과 무관하게 배포 텍스트와 내용이 다르면 제자리에서 교체됩니다.

| # | 단계 | 결과 |
| --- | --- | --- |
| 1 | **SRS scaffold** | `docs/spec/00.index.md`(Target Map · Scope Map · Completed Work Log의 중심), `docs/spec/90.appendix.md`, 그리고 프로젝트에 scope 문서가 하나도 없을 때에 한해 `--scope`에서 파생된 빈 scope 문서 — 새 프로젝트에서는 `docs/spec/01.<scope>.srs.md` 이고, 번호는 `--scope` 가 아니라 할당기가 정하며 `docs/spec/` 의 `.md` 파일이 아직 쓰지 않은 가장 낮은 번호다. 이미 scope 문서가 있으면 새로 만들지 않고 기존 문서를 각자의 scope 이름으로 등록한다. |
| 2 | **Step state** | `docs/spec/steps/state.md` — `Mode: wait` 메타 블록과 빈 step-state 표. |
| 3 | **저작 규칙** | `docs/rule/SRS-MD-Rules-v2.5.0.md`와 `docs/rule/SDS-MD-Rules-v2.5.0.md` (번들된 SRS-MD · SDS-MD 저작 규칙). |
| 4 | **에이전트 지시문** | `AGENTS.md`와 `CLAUDE.md`에 *SpecKiwi SRS workflow* 블록을 삽입/갱신. 배포 텍스트와 내용이 다른 블록은 선언된 버전과 무관하게 제자리에서 교체되고, 동일한 블록은 그대로 둡니다. |
| 5 | **Hooks** | `docs/.kiwi/hooks/{pre-commit.mjs,trace.mjs}` + `docs/.kiwi/trace/`; 러너에 위임하는 Git `.git/hooks/pre-commit` 게이트; `.claude/settings.json`(PostToolUse trace hook); `.codex/hooks.json`(apply_patch trace hook). 이미 있는 `.git/hooks/pre-commit`은 어떤 경우에도 덮어쓰지 않습니다 — 이미 러너에 위임하고 있으면 `skipped`로 보고하고, 그렇지 않으면 연결 방법을 안내하는 경고와 함께 그대로 둡니다. 에이전트 훅 파일 둘은 이미 있으면 `skipped`로 보고되며, 다른 scaffold 파일과 마찬가지로 `--force`로는 덮어써집니다. |
| 6 | **MCP 등록** | SpecKiwi stdio MCP 서버를 `.mcp.json`에 등록(멱등; 이미 있으면 `skipped`). `--no-mcp`로 비활성화. |
| 7 | **Skill 설치** | 번들된 Kiwi skills를 **Claude**(`.claude/skills`) · **Codex**(`.agents/skills`)에 설치한 뒤, SpecKiwi가 관리하던 orphan `kiwi-*` skill 디렉터리를 정리(prune). `--no-skills`로 비활성화. |

결과는 다섯 배열의 envelope로 보고됩니다 — **`created` / `updated` / `skipped` / `removed` / `warnings`** (`--json`으로 기계가 읽는 형태).

첫 실행 후 대략적인 구조:

```text
AGENTS.md                     # SpecKiwi SRS workflow 블록
CLAUDE.md                     # SpecKiwi SRS workflow 블록
.mcp.json                     # speckiwi MCP 서버 등록
.claude/skills/kiwi-*         # Claude Kiwi skills
.claude/skills/_shared/kiwi/  # contracts the skills share
.agents/skills/kiwi-*         # Codex Kiwi skills
.agents/skills/_shared/kiwi/  # the same, for Codex
.claude/settings.json         # PostToolUse trace hook
.codex/hooks.json             # apply_patch trace hook
.git/hooks/pre-commit         # docs/.kiwi/hooks/pre-commit.mjs로 위임
docs/
├─ .kiwi/hooks/               # 번들 hook 러너
├─ .kiwi/trace/               # trace.mjs 가 쓰는 trace 출력
├─ rule/
│  ├─ SRS-MD-Rules-v2.5.0.md
│  └─ SDS-MD-Rules-v2.5.0.md
└─ spec/
   ├─ 00.index.md             # targets, scopes, completed work log
   ├─ 01.app.srs.md           # 첫 scope 문서
   ├─ 90.appendix.md
   └─ steps/state.md
```

`docs/spec/00.index.md`는 target · scope · completed work log의 허브입니다. 요구사항 본문은 `docs/spec/**/*.srs.md`에 있으며 이것이 **canonical source of truth**입니다.

### `init` 옵션

| 옵션 | 설명 |
| --- | --- |
| `--target <target>` | 등록할 초기 Active Target (예: `v0.1.0`). |
| `--scope "Name:PREFIX"` | 초기 scope. 프로젝트에 scope 문서가 없을 때만 사용된다 (예: `"App:APP"` → `FR-APP-001`). 이미 문서가 있는 프로젝트에 scope 를 추가하려면 `speckiwi scaffold-scope <Name>:<PREFIX> --apply` 를 쓴다 — 다음 문서 번호를 배정하고 인덱스 두 행을 함께 등록한다. |
| `--no-mcp` | `.mcp.json`에 MCP 서버 등록을 건너뜁니다. |
| `--no-skills` | 번들 Kiwi skills 설치(및 orphan prune)를 건너뜁니다. |
| `-g, --global` | 번들 Kiwi skills를 **설치된** 각 에이전트의 전역 skills 디렉터리(Claude `~/.claude/skills`, Codex `${CODEX_HOME:-~/.codex}/skills`)에도 설치/갱신합니다. 홈 디렉터리가 없는 에이전트는 경고와 함께 건너뜁니다. 프로젝트 스코프 설치는 그대로 수행하며, 전역에서는 orphan prune을 하지 않습니다(공유 홈에는 다른 프로젝트의 skills가 있을 수 있음). |
| `--dry-run` | 디스크에 아무것도 쓰지 않고 모든 단계를 미리보기(`created`/… 채워짐). |
| `--force` | 이미 있는 scaffold 파일을 건너뛰지 않고 덮어씁니다. **author 소유 파일을 다시 쓰며 그 내용은 사라집니다** — `00.index.md`(Target Map · Scope Map · Completed Work Log), `90.appendix.md`, `docs/spec/steps/state.md`(작업 모드 · step 상태), 그리고 가장 아플 수 있는 에이전트 훅 파일 둘 `.claude/settings.json` · `.codex/hooks.json` — 직접 설정한 권한 · 훅 · 환경변수가 여기에 있습니다. `docs/.kiwi/hooks/` 아래 번들 훅 러너 둘도 원본으로 되돌리므로 그 파일을 손봤다면 그 수정도 사라집니다. **이미 있는** scope 문서는 `--force` 로도 덮어쓰지 않습니다. 번들 규칙 문서 갱신에는 이 옵션이 필요하지 않습니다. |
| `--ignore-lock` | 잔여 SRS mutation lock을 우회합니다. |
| `--json` | 결과 envelope를 JSON으로 출력합니다. |

**Exit code:** `0` 성공 · `2` 사용법 오류(예: 알 수 없는 플래그) · `5` init 실패(예: 점유된 mutation lock).

> **MCP parity 주의.** MCP `init_project` 도구는 SRS 파일 scaffold만 수행하고 MCP 등록·skill 설치는 하지 않습니다. 이 두 단계는 CLI 기본값이므로, 에이전트의 MCP 연결을 통해 `init`을 실행해도 스스로 skill을 깔거나 `.mcp.json`을 편집하는 일은 없습니다.

<a id="ko-skills"></a>

## 4. Kiwi Skills 개별 설치

`speckiwi init`은 이미 Claude + Codex 프로젝트 skill을 설치합니다. **다른 에이전트**(OpenCode, Hermes), **전역 설치**, **사용자 지정 경로**가 필요할 때 개별 설치 명령을 사용합니다.

```sh
speckiwi skills install <agent> <skill|all>
```

지원 `<agent>`: `codex`, `claude`, `opencode`, `hermes`.

```sh
speckiwi skills install codex all
speckiwi skills install claude all
speckiwi skills install opencode all
speckiwi skills install hermes all --global
```

파일 복사 전 계획 미리보기:

```sh
speckiwi skills install codex all --dry-run --json
```

### 에이전트와 설치 위치

| Agent | 패키지 source root | 기본 프로젝트 설치 위치 | 전역 설치 위치 |
| --- | --- | --- | --- |
| Codex | `skills/codex` | `.agents/skills/<skill>` | `${CODEX_HOME:-$HOME/.codex}/skills/<skill>` |
| Claude | `skills/claude` | `.claude/skills/<skill>` | `$HOME/.claude/skills/<skill>` |
| OpenCode | `skills/etc` | `.opencode/skills/<skill>` | `$HOME/.config/opencode/skills/<skill>` |
| Hermes | `skills/etc` | `--dest <dir>` 필요 | `$HOME/.hermes/skills/<category>/<skill>` |

### 그 밖의 `skills` 하위 명령

```sh
speckiwi skills add <agent> <skill>    # `skills install` 의 별칭
speckiwi skills mirror --check         # .agents/skills/** 를 skills/codex/** 와 대조
speckiwi skills mirror --write         # 재생성
```

`mirror`는 skill 소스 자체를 관리할 때만 필요합니다 — `.agents/skills/**`는 `skills/codex/**`의 생성물이며 손으로 편집해서는 안 됩니다.

### 옵션

| 옵션 | 설명 |
| --- | --- |
| `--global`, `-g` | 사용자 전역 skill 디렉터리에 설치합니다. |
| `--dest <dir>` | 사용자 지정 destination root에 설치; 각 skill은 `<dir>/<skill>` 아래에 들어갑니다. |
| `--category <name>` | Hermes 전역 설치 category (기본 `kiwi`; Hermes global 전용). |
| `--dry-run` | 파일을 복사하지 않고 설치 계획만 출력합니다. |
| `--json` | 자동화용 JSON을 출력합니다. |

`--global`과 `--dest`는 함께 쓸 수 없습니다. skill별 처리 결과는 **`install` / `update` / `skip` / `conflict`**로 보고됩니다. `conflict`(안전하지 않은 경로 또는 유효한 skill이 아닌 대상)가 있으면 부분 설치 없이 중단합니다.

<a id="ko-mcp"></a>

## 5. MCP 서버 연결

Kiwi skills의 정상 작업 흐름은 연결된 SpecKiwi MCP 서버를 전제로 합니다.

```sh
speckiwi mcp
```

이 서버는 **stdio**로 통신하며 `--root`를 **받지 않습니다**. 서버 프로세스의 현재 작업 디렉터리에서 상위 탐색으로 project root를 해석하므로, MCP 클라이언트 설정에서 실행 디렉터리(cwd)를 프로젝트 루트로 지정하세요. `--root`와 함께 실행하면 서버를 시작하지 않고 오류로 종료합니다.

**Git worktree.** 루트는 서버 프로세스에 묶이므로 세션이 도중에 옮길 수 없습니다 — 이미 떠 있는 서버는 세션 중간의 worktree 전환을 따라가지 않으니, 에이전트를 worktree 안에서 다시 시작하십시오. worktree 를 루트로 삼은 세션은 **새 Requirement ID를 할당해서도 안 되고**, 호스트 저장소의 `docs/spec/`를 편집할 수도 없습니다. 둘 다 호스트 루트에서 수행하십시오.

`speckiwi init`은 아래 등록을 `.mcp.json`에 기록합니다. (SpecKiwi 저장소 자체를 체크아웃한 경우에는 로컬 `bin/speckiwi`를 대신 등록합니다 — 체크아웃이 자기 빌드를 테스트하도록.)

```json
{
  "mcpServers": {
    "speckiwi": {
      "command": "npx",
      "args": ["-y", "speckiwi", "mcp"]
    }
  }
}
```

`speckiwi init`이 `.mcp.json`을 쓴 뒤에는 에이전트를 reload/재시작해야 서버가 로드됩니다. `speckiwi mcp`를 손으로 실행하는 것은 디버깅용입니다 — stdio에서 블록되어 멈춘 것처럼 보입니다.

### MCP 도구

Kiwi skills는 모든 조회와 안전한 SRS mutation을 MCP 도구로 수행합니다. 동일 기능의 CLI는 진단·수동 운영용 fallback이며 정상 mutation 경로가 아닙니다.

| 구분 | 도구 |
| --- | --- |
| Target & goal | `get_active_target`, `set_active_target`, `set_target_goal`, `summarize_target` |
| 조회 | `list_requirements`, `get_requirement`, `list_completed_work`, `search_requirements`, `get_next_work_order` |
| Status & stability | `update_status`, `update_stability` |
| Evidence & trace | `check_acceptance_criteria`, `add_verification_evidence`, `add_trace_link` |
| 저작·편집 | `add_requirement`, `append_section_note`, `add_completed_work`, `edit_requirement_fields`, `edit_requirement_table_rows`, `replace_acceptance_criteria`, `supersede_requirement` |
| 작업 모드 | `get_work_mode`, `set_work_mode` |
| Step & TDD First | `claim_step`, `scaffold_step`, `validate_step`, `synthesize_step_srs`, `promote_step_requirement`, `update_step_state`, `set_sds_status`, `list_steps`, `check_vibe_gate` |
| 중복 ID repair | `diagnose_requirement_id_collisions`, `plan_requirement_id_collision_repair`, `apply_requirement_id_collision_repair` |
| 워크스페이스 | `validate_spec`, `sync_index`, `init_project`, `register_scopes`, `scaffold_scope`, `mcp_workspace_info`, `preview_legacy_workflow_migration` |
| 호환성 | `add_compatibility_check`, `refresh_compatibility_check`, `revoke_compatibility_check`, `list_compat_edges`, `list_dirty_edges` |
| 오케스트레이터 run 표면 | `orchestrate_*` 27개 — run lock과 저널, 라우팅 probe/freeze, lane 스케줄·handoff, 검증 라운드, wave 종료, resume·replay, `--auto` 게이트 결정. |
| 워크플로·파이프라인 | `workflow_*` 26개 — plan task와 체크리스트, pipeline emit/status/tail, worklog, 산출물, workflow doctor. |

**총 100개 도구가 배포됩니다.** 위 표는 skill이 직접 호출하는 것들을 이름으로 싣고, 묶음 두 행은 각각을 구동하는 skill 문서가 개별 멤버를 설명합니다. 업그레이드 후 신뢰할 수치는 `speckiwi doctor`가 보고하는 값입니다 — 서버가 실제로 등록한 개수입니다.

#### 호출 단위 `workspaceRoot`

MCP 서버는 자신이 기동된 디렉터리에서 root를 해석하며, SRS를 읽고 쓰는 곳은 그 root뿐입니다. 서버가 호스트 체크아웃에 고정된 세션도, 호출마다 절대 경로 `workspaceRoot`를 선택적으로 넘겨 linked worktree에 있는 run 상태를 다룰 수 있습니다.

| 계열 | `workspaceRoot` |
| --- | --- |
| `workflow_*` (26개 전부) | 수용 |
| `orchestrate_*` | 수용. 단 `orchestrate_replay_apply`(유예된 SRS mutation은 호스트 root에서만 재생됩니다)와 `orchestrate_preflight`(이미 `--mcp-root`·`--git-root`를 받습니다)는 제외 |
| SRS를 다루는 모든 도구 — `add_requirement`, `update_status`, `supersede_requirement`, `validate_spec`, `sync_index`, `mcp_workspace_info` 등 | 거부 |

거부가 기본값입니다: worktree-local임을 스스로 선언하지 않은 도구는 이 인자를 거부하므로, 새로 추가된 SRS 도구는 어디에도 등재하지 않아도 안전합니다. 수용되는 root는 절대 경로이고, 존재하는 디렉터리이며, 하위 디렉터리가 아닌 git 최상위이고, 기동 root와 git common dir을 공유하는 worktree여야 합니다. 각 실패는 도구가 실행되기 전에 고유한 `workspace-root-*` 사유로 거부되므로, 존재하지 않는 경로는 생성되지 않고 거부됩니다. 수용된 root의 도구라도 `docs/spec` 아래로 떨어지는 경로 인자는 거부됩니다.

**target 범위의 조회·mutation 전에 envelope에서 워크스페이스 정체를 확인하십시오.** 모든 결과는 `workspaceRoot`, `rootSource`, `indexPath`, `packageVersion`을 담은 `mcpWorkspace`를 함께 반환합니다. `rootSource`는 `server-cwd-discovery`, `auto-init`, `per-call-workspace-root` 중 하나이며, 모든 게이트를 통과한 `workspaceRoot`를 넘긴 호출에 한해 정확히 `per-call-workspace-root`입니다 — 답이 어느 root에서 왔는지 항상 이름으로 알 수 있습니다.

<a id="ko-first-run"></a>

### 첫 실행

MCP 서버가 연결되면 자연어로 작업을 지시합니다 — Kiwi skills는 의도(intent)로 트리거됩니다(또는 `/kiwi-srs`처럼 이름으로 직접 호출). 예를 들어 에이전트에게:

> *kiwi-srs로 요구사항을 등록해줘: 사용자가 이메일로 비밀번호를 재설정할 수 있다.*

`kiwi-srs`가 Requirement ID를 발급해 `docs/spec/01.<scope>.srs.md` 같은 scope 문서에 기록하고, 이후 `kiwi-srs-feasibility` → `kiwi-planner` → `kiwi-pm` / `kiwi-coder`가 구현까지 이어갑니다. 전체 흐름은 §7 파이프라인을 참고하세요.

<a id="ko-skill-types"></a>

## 6. Kiwi skill 종류

| Skill | 주 용도 |
| --- | --- |
| `kiwi-srs` | 신규 요청/변경 요청을 분석해 SpecKiwi SRS requirement로 등록하거나 정합성을 맞춥니다. |
| `kiwi-srs-from-code` | 기존 코드베이스를 역분석해 scope별 SRS 초안을 생성합니다. |
| `kiwi-srs-feasibility` | 활성 target의 SRS를 구현 가능성 · risk · stability 관점에서 평가합니다. |
| `kiwi-srs-research` | 모호한 requirement · blocker · 외부 제약 · risk를 별도 research 단계로 분석합니다. |
| `kiwi-planner` | 활성 target requirement를 Phase/Task로 분해하고 `plan.md` + sidecar JSON을 생성합니다. |
| `kiwi-coder` | Task 단위 TDD · 구현 · 검증 · MCP evidence 기록을 수행합니다. |
| `kiwi-pm` | `kiwi-planner` 계획을 읽고 각 Task를 `kiwi-coder`로 순차 실행합니다. |
| `kiwi-srs-sync` | code-first 작업 후 `git diff`를 분석해 SRS를 사후 동기화합니다. |
| `kiwi-commit-auto-push` | Git 변경을 requirement evidence와 연결해 commit + push합니다. |
| `kiwi-commit-auto-pr` | commit + push 후 GitHub PR을 생성/갱신하고 PR evidence를 연결합니다. |
| `kiwi-hot-fix` | 긴급 버그를 TDD · 회귀 검증 · 사후 SRS sync로 처리합니다. |
| `kiwi-review-fix-loop` | 로컬 변경 또는 PR 코멘트를 review/fix/re-review 루프로 정리하고 선택적으로 REQ를 verified 전이합니다. |
| `kiwi-pipeline` | `kiwi/pipeline.jsonl`을 읽어 다음 Kiwi skill 단계를 실행합니다. 2.9.0부터 **기본 동작이 전체 연구→구현 사이클**(`kiwi-srs` → … → `kiwi-review-fix-loop`)이며, 단일 다음-단계 추천만 원하면 `--none-cycle`을 명시합니다. 사이클은 호출이 작업 입력을 실을 때만 돌아가므로 상태 질문은 상태 질문으로 남습니다. |
| `kiwi-step` | `docs/spec/steps/<name>/` 아래 step-local 요구 초안을 저작 — step을 선점(claim)하고 그 안에만 작성(body-scope SRS 미수정) 후 step 국소 검증. `kiwi-srs`의 경량 대응물. |
| `kiwi-tdd` | 하나의 step을 `tdd` work-mode의 TDD First 사이클로 진행 — SDS(`design.md`) 저작 → EARS acceptance contract를 실패 테스트(red)로 변환 → green 구현 → 회귀 → step SRS 합성 및 evidence 필수 승격(promote). |
| `kiwi-orchestrator` | 단일 진입점에서 run 하나를 끝까지 구동합니다 — 작업을 probe 하고 실제로 필요한 rung(step / plan / orchestrated)으로 라우팅한 뒤 그 rung을 기록된 종료까지 실행합니다. run 저널(`kiwi/waves.jsonl`), `--auto` 게이트 표, 재개(resume), 그리고 2.10.0부터는 각 rung의 종료가 반드시 이행해야 하는 종료 리뷰 루프 의무를 소유합니다. orchestrated rung 에서는 한 stage 의 lane 을 분할하고 병렬화 분석을 공개해 검토받지만, 배포된 skill 은 이들을 run 의 통합 브랜치 위에서 **직렬로** 실행합니다 — 동시 lane 실행과 lane 별 병합 게이트는 skill 자신이 밝히는 대로 향후 작업입니다. 옵션 — `--auto` · `--max` · `--mini` / `--loops N` · `--work` · `--base-branch` · `--lanes N`. |
| `kiwi-wave-master` | 대형 작업(에픽/로드맵/장기 연구)을 순서 있는 wave로 분해하고 wave마다 전용 target을 등록한 뒤 wave별 파이프라인을 순차 실행. `kiwi/waves.jsonl`로 재개 가능. 옵션 — `--auto` · `--max` · `--mini` / `--loops N`, 그리고 `--drive`(`--auto` 만으로는 멈추는 통합 테스트·비용 게이트까지 함께 여는 플래그). |

같은 skill set은 에이전트별 source tree로 배포됩니다 — **`skills/codex`**(Codex 호출 + clarification gate 용어), **`skills/claude`**(Claude skill 환경), **`skills/etc`**(OpenCode/Hermes 및 local-LLM용 Agent Skills 형식; 기본 단일 evaluator/sub-agent profile).

<a id="ko-pipeline"></a>

## 7. Skill 파이프라인

신규 기능/변경 요청은 보통 다음 순서로 진행합니다.

```mermaid
flowchart TD
    A["사용자 요구사항 또는 작업 아이디어"] --> B{"출발점 선택"}
    B -->|새 요구사항| C["kiwi-srs: SRS requirement 작성/갱신"]
    B -->|기존 코드에서 역추출| D["kiwi-srs-from-code: 코드 기반 SRS 생성"]
    B -->|코드 먼저 수정됨| E["kiwi-srs-sync: git diff 기반 SRS 동기화"]
    B -->|긴급 버그| Q["kiwi-hot-fix: 긴급 TDD 수정"]

    C --> F["kiwi-srs-feasibility: 구현 가능성/stability 평가"]
    D --> F
    E --> F
    Q --> M

    F --> G{"블로커 또는 모호성?"}
    G -->|있음| H["kiwi-srs-research: risk/blocker 연구"]
    H --> F
    G -->|없음| I["kiwi-planner: plan.md + sidecar JSON 생성"]

    I --> J["kiwi-pm: Task 실행 오케스트레이션"]
    J --> K["kiwi-coder: Task 단위 TDD/구현/검증"]
    K --> L{"남은 Task?"}
    L -->|있음| J
    L -->|없음| R["kiwi-review-fix-loop: review/fix/re-review"]
    R --> M["SpecKiwi MCP: evidence/status/completed-work 기록"]
    M --> S{"PR 필요?"}
    S -->|아니오| N["kiwi-commit-auto-push: commit + push"]
    S -->|예| T["kiwi-commit-auto-pr: commit + push + PR"]
    N --> O["완료"]
    T --> O

    P["kiwi-pipeline: 다음 단계 실행 (기본은 전체 사이클)"] -.-> B
    P -.-> F
    P -.-> I
    P -.-> J
    P -.-> N
```

kiwi-coder 내부에서 각 Task는 TDD 루프로 진행됩니다.

```mermaid
flowchart TD
    A["kiwi-planner 산출물: plan.md + sidecar JSON"] --> B["kiwi-coder Task 선택"]
    B --> C["관련 REQ/AC 조회: speckiwi MCP"]
    C --> D["Failing test 작성"]
    D --> E["Red 확인"]
    E --> F["최소 구현"]
    F --> G["Green 확인"]
    G --> H["리뷰/정형 검증/회귀 테스트"]
    H --> I{"문제 있음?"}
    I -->|있음| F
    I -->|없음| J["MCP evidence 추가"]
    J --> K["AC check / status update"]
    K --> L["kiwi/ 상태와 worklog 갱신"]
```

이는 메인 파이프라인의 `kiwi-coder` 내부 per-task 루프입니다. **step 단위** 작업에서는 `tdd` work-mode가 `kiwi-planner` / `kiwi-pm`를 거치지 않고 `kiwi-tdd`로 이를 **대체하는 TDD First** 사이클 — SDS → red → green → 회귀 → `promote_step_requirement` — 을 진행합니다(§8 *작업 모드와 step* 참조).

### 진입점 선택

위 흐름은 기능 하나의 모습입니다. 그 위에 진입점 셋이 있습니다 — 하나는 이 흐름을 실행하고, 둘은 작업에 어느 흐름이 필요한지를 대신 정합니다.

| 진입점 | 이럴 때 | 하는 일 |
| --- | --- | --- |
| `kiwi-pipeline` | 기능 하나를 진행 중이고 다음 단계를 실행하고 싶을 때. | 기본으로 전체 연구→구현 사이클을 실행합니다. `--none-cycle`이면 단일 다음 단계만 추천합니다. |
| `kiwi-orchestrator` | 작업 하나가 있는데 어느 rung이 필요한지 직접 정하고 싶지 않을 때. | 작업을 probe 해 **step** · **plan** · **orchestrated** 중 맞는 rung으로 라우팅하고, 그 rung을 `kiwi/waves.jsonl`에 기록된 종료까지 실행합니다. 재개 가능. |
| `kiwi-wave-master` | 에픽·로드맵·장기 연구처럼 target 하나에 담기지 않는 작업일 때. | 순서 있는 wave로 분해하고 wave마다 target을 등록한 뒤 wave별 파이프라인을 순차 실행합니다. 재개 가능. |

**통과 판정을 기록하는 모든 경계는 리뷰를 빚집니다.** 2.10.0부터 두 오케스트레이션 skill은 그 경계가 심판하는 커밋 창에 대해 `kiwi-review-fix-loop`을 **정확히 한 번** 실행해야 하며(어느 rung도 예외 없음), 결과를 run 종료 저널 줄에 기록합니다. 리뷰 기록 없이 완료를 보고하는 종료 줄은 `speckiwi orchestrate validate`가 거부하므로, 이 보장은 문서에만 적힌 것이 아니라 검사 가능합니다.

<a id="ko-commands"></a>

## 8. 명령 레퍼런스

### workspace 검증

```sh
speckiwi validate                    # exit 0 = 정상, 1 = 검증 실패
speckiwi validate --fail-on-warning  # 경고를 실패로 취급
speckiwi validate --json
speckiwi explain SRS-E002            # 진단 코드 설명
```

### 요구사항·상태 조회

```sh
speckiwi active-target                        # Active Target 해석
speckiwi targets                              # 등록된 target 목록
speckiwi summary --target v0.1.0              # status/stability/type 집계 + blocker
speckiwi list --target v0.1.0                 # 요구사항 목록 (--json)
speckiwi show FR-APP-001 --markdown           # 단일 요구사항
speckiwi search "login timeout"               # 전문 검색
speckiwi scopes                               # 등록된 scope
speckiwi completed-work --target v0.1.0 --order latest
speckiwi doctor                               # 11개 검사: spec 파싱, agent 블록 최신성, rules drift·참조, SDS 규칙 설치,
#            skill 미러·설치 drift, git 최상위 루트, Active Target, scope/target 정합, Node 버전
```

### 인덱스 유지보수

```sh
speckiwi sync-index            # 00.index.md의 §5/§6 롤업 요약 재계산
speckiwi sync-index --dry-run
```

<a id="ko-upgrade"></a>

### 구버전 프로젝트를 최신 상태로 올리기

`speckiwi init` 은 도구가 소유한 것 — 규칙 문서, 에이전트 워크플로 블록, 스킬, 이미 존재하는 인덱스 `Rules` 행 — 을 모두 갱신합니다. 다만 작성자 소유 내용은 계약상 절대 수정하지 않으므로, 구버전으로 만든 프로젝트에는 두 가지가 남습니다.

- 이번 릴리스가 더 이상 배포하지 않는 규칙 문서를 여전히 가리키는 링크 또는 문장,
- `Rules` 행이 아예 없는 인덱스 메타데이터 표 (갱신은 **기존 행 교체**만 합니다).

`speckiwi upgrade` 가 둘 다 해소합니다. 위임 대상인 `init` 과 마찬가지로 **실제로 수행**하며, 먼저 계획만 보려면 `--dry-run` 을 줍니다.

```sh
speckiwi upgrade                  # 실제 수행
speckiwi upgrade --dry-run        # 계획 출력, 워크스페이스 무변경
speckiwi upgrade --json           # 표준 mutation 결과 envelope
```

`--apply` 도 계속 받아들이며 같은 수행 실행을 요청합니다 — 기본값이 뒤집히기 전에 작성된 스크립트가 그대로 동작합니다. `--apply` 와 `--dry-run` 을 함께 주면 우선순위로 해석하지 않고 거부합니다.

수정된 참조는 각각 `file:line` 로 보고되며, 두 표기 모두 대상입니다 — 경로 형태(`SRS-MD-Rules-v1.0.0.md`)와 산문 형태(`SRS-MD Authoring Rules v1.0.0`).

의도적으로 **하지 않는 것**(보고서 본문에도 명시됩니다): scope 문서 번호를 다시 매기지 않고, `docs/spec/` 아래 요구사항 본문을 수정하지 않으며(그것은 마이그레이션이 아니라 거버넌스 mutation 입니다), 기존 hook 을 덮어쓰지 않습니다. `docs/` 아래 그 밖의 위치에서 발견된 끊어진 언급은 **수정하지 않고 보고만** 합니다 — 과거에 어떤 규칙 버전을 따랐는지 적어둔 기록은 결함이 아니기 때문입니다.

`speckiwi doctor` 도 같은 끊어진 참조를 **Rules reference presence** 로 보고하므로 `upgrade` 를 쓰지 않아도 발견됩니다. 이 명령은 CLI 전용이며 MCP 도구로 노출되지 않습니다 — 작성자 소유 파일을 수정하기 때문입니다.

| 옵션 | 설명 |
| --- | --- |
| `--dry-run` | 계획만 출력하고 아무것도 쓰지 않음. |
| `--apply` | 계획을 실제로 수행. 기본 동작이며, 이전 계약으로 작성된 호출자를 위해 계속 받아들임. |
| `--no-skills` / `--no-mcp` | 갱신 단계에서 해당 `init` 단계를 건너뜀. |
| `--ignore-lock` | stale SRS mutation lock 우회. |
| `--json` | 결과 envelope 을 JSON 으로 출력. |

**Exit code:** `0` 성공 · `5` 실패 (예: lock 점유, 또는 `--apply` 와 `--dry-run` 동시 지정 — 아무것도 쓰이지 않음).

### 병합 후 중복 Requirement ID 해소

두 브랜치가 각각 요구사항을 추가하면 병합 시 중복 ID(`SRS-E002`)가 생겨 `validate`가 실패할 수 있습니다. ID를 손으로 고치지 말고 가이드 repair 워크플로(동일 MCP 도구 존재)를 사용하세요. keep/rename 대상은 `file:line:blockHash`로 명시 선택합니다.

```sh
speckiwi repair requirement-id-collisions diagnose --json
speckiwi repair requirement-id-collisions plan --duplicate-id <id> \
  --keep <file:line:blockHash> --rename <file:line:blockHash> --allocate-next \
  --write-plan .kiwi/id-repair.json --json
speckiwi repair requirement-id-collisions apply --plan .kiwi/id-repair.json --json
```

### 진행·추적성 조회

```sh
speckiwi release-readiness --target v0.1.0   # 릴리스 게이트 집계
speckiwi coverage --target v0.1.0            # acceptance criteria 커버리지
speckiwi rtm --target v0.1.0                 # 요구사항 추적성 매트릭스(RTM)
speckiwi history FR-APP-001                  # 단일 요구사항 변경 이력
speckiwi changed-since 2026-07-01            # 특정 날짜 이후 변경된 요구사항
speckiwi stale                               # 최근 활동이 없는 요구사항
speckiwi attention                           # 주의가 필요한 요구사항
speckiwi links check                         # trace-link 무결성(workflow gate)
```

### 작업 모드와 step

작업 모드는 `docs/spec/steps/state.md`에 저장되며, 새 프로젝트는 `wait`로 시작합니다.

- **`wait`** — 기본값; Active Task 없음, SRS-first 규칙 적용.
- **`sdd`** — 스펙 주도 body 작업(body-scope 요구사항을 먼저 작성·조정한 뒤 구현).
- **`vibe`** — code-first: Active Task에 대해 코드를 먼저 쓴 뒤 SRS를 사후 합성(`vibe-gate`가 미합성 커밋 차단).
- **`tdd`** — `kiwi-tdd`로 진행하는 step 단위 **TDD First** 사이클: SDS(Software Design Specification, `design.md`)를 EARS 형식 acceptance contract로 저작 → 실패 테스트(red)로 변환 → green 구현 → 회귀 → step 요구 합성·승격.

```sh
speckiwi mode                                    # 현재 작업 모드 표시 (sdd | vibe | wait | tdd)
speckiwi mode tdd                                # 작업 모드 전환 (sdd, vibe, wait, tdd)
speckiwi step claim <name> --touches-scope APP   # 저작 전 step 선점(claim)
speckiwi step scaffold <name>                    # design.md + intent.md 스텁 생성
speckiwi step validate <name>                    # docs/spec/steps/<name>/ 의 step-local 초안 검증
speckiwi step sds-status <name> agreed           # SDS 라이프사이클 진행 (draft -> agreed -> superseded)
speckiwi step synthesize <name>                  # design.md에서 step SRS 합성
speckiwi step promote <id> --from-step <name> --to-scope APP   # body scope로 승격 (tdd에서는 evidence 필수)
speckiwi step update-state <name> --status merged              # 완료 게이트를 거쳐 step 전이
speckiwi vibe-gate check                         # vibe/tdd 미합성 커밋을 막는 CI 게이트
```

### Mutation (MCP가 정상 경로; CLI는 수동 운영·진단용)

`--reason`은 Change Notes 행을 남기고, `--dry-run`으로 적용 전 결과를 미리 봅니다.

```sh
speckiwi update-status FR-APP-001 implemented --reason "AC 충족, 회귀 통과"
speckiwi update-stability FR-APP-001 stable --reason "인터페이스 확정"
speckiwi check-ac FR-APP-001 AC-1 AC-2
speckiwi add-evidence FR-APP-001 --type command --reference "npm test" --covers all --notes "회귀 통과"
speckiwi add-trace FR-APP-001 --type code --reference "src/app.ts:42" --relation implements
speckiwi append-note FR-APP-001 --section rationale --text "결정 배경 기록"
speckiwi set-target-goal v0.1.0 --goal "첫 사용 가능 릴리스"
speckiwi set-active-target v0.2.0
speckiwi set-target-status v0.1.0 completed   # planned|active|frozen|completed|released|archived
speckiwi add-completed-work --date 2026-07-13 --target v0.1.0 --scope APP --summary "..."
```

대부분의 mutation 명령은 `--json` · `--dry-run` · `--ignore-lock`을 받습니다. mutation 실패 시 `5`로 종료합니다.

### 오케스트레이션 run 조회

`kiwi-orchestrator`는 상태를 `kiwi/waves.jsonl`에 둡니다. 아래 읽기 전용 명령으로 run을 구동하지 않고 확인할 수 있습니다.

```sh
speckiwi orchestrate validate --run-id <id> --json          # run 불변식을 깨는 저널을 거부
speckiwi orchestrate validate --run-id <id> --strict        # 스탬프 누락·버전 하강도 실패 처리
speckiwi orchestrate validate --run-id <id> \
  --engine kiwi-wave-master                                 # 다른 생산자의 줄을 읽기
speckiwi orchestrate resume --run-id <id> --json            # 재개 시 이어받을 지점
```

`--engine`은 어느 생산자의 줄을 읽을지 고릅니다 — 두 엔진이 파일 하나를 공유하며 리더는 자기 줄만 봅니다. 열거값 밖의 값은 기본값으로 강등하지 않고 거부합니다. 조용히 폴백하면 열지도 않은 저널을 검증하고 깨끗하다고 보고하기 때문입니다.

나머지 `orchestrate` 하위 명령(`route` · `schedule` · `handoff` · `wave` · `round` · `issue` · `replay` · `auto-gate` 등)은 손으로 쓰는 것이 아니라 skill이 구동합니다. 목록은 `speckiwi orchestrate --help`에 있습니다.

헷갈리기 쉬운 디렉터리가 셋 있고, 어느 것도 손으로 편집하지 않습니다. **`docs/.kiwi/`**는 도구 소유이며 `init`이 만듭니다 — 번들 훅 러너가 들어갑니다. **`kiwi/`**는 skill 소유의 run 상태로 첫 skill 실행 후에 생깁니다 — `pipeline.jsonl` · `waves.jsonl` · 재개 카드. 프로젝트 루트의 **`.kiwi/`**에는 실행 계열 skill 이 쓰는 run 별 세션 상태 — lock, plan·coder 상태, worklog — 가 `sessions/<run-id>/` 아래에 놓입니다.

`speckiwi workflow`도 같은 성격입니다 — Kiwi skill이 `kiwi/pipeline.jsonl`과 plan 상태를 일관되게 유지하기 위해 호출하는 하위 명령 그룹(`plan-status` · `plan-task` · `next-task` · `pipeline-status` · `pipeline-tail` · `worklog-tail` · `task-check` · `doctor` 등)입니다. 손으로 돌리는 일반 워크플로가 아니라 진단·skill 전용이며, 목록은 `speckiwi workflow --help`에 있습니다.

<a id="ko-principles"></a>

## 9. SRS 작업 원칙

- 변경 전에 `docs/spec/00.index.md`를 먼저 읽고 관련 Requirement ID를 찾아 작업 요약에 명시합니다. 해당 요구사항이 없으면 멈추고 먼저 작성할지 확인합니다.
- `docs/spec/**/*.srs.md`가 요구사항의 유일한 원본입니다. 대체 원본을 만들거나 생성된 JSON을 canonical처럼 편집하지 마세요.
- **요구사항 ID를 손으로 만들지 마세요** — SpecKiwi mutation 도구로 발급합니다.
- 요구사항 메타데이터에는 독립된 두 lifecycle 필드가 있습니다.
  - **`Status`**: 구현·검증 진행 상태 — `planned`, `in_progress`, `blocked`, `implemented`, `verified`, `discarded`.
  - **`Stability`**: 요구사항 문구의 성숙도와 변경 통제 수준 — `draft` → `evolving` → `stable` → `frozen`, 그리고 `deprecated`. `draft`·`deprecated` 요구사항은 명시적 승인 없이 구현하지 않습니다.
- `Status`가 `discarded`이거나 `Stability`가 `draft`이면 heading에 `[DISCARDED]` / `[DRAFT — pending decision]` 마커가 자동으로 붙고, 되살아나면 제거됩니다.
- `verified`는 acceptance criteria 체크 **및** verification evidence 연결 후에만 사용합니다. 여러 요구사항을 한 번에 `verified`로 바꾸거나 Active Target을 일괄로 비우는 bulk mutation은 도구 수준에서 차단됩니다.
- 동작 변경은 TDD를 따릅니다 — 대상 Requirement ID의 실패 테스트를 먼저 작성하고, 최소 변경으로 통과시킨 뒤 리팩터합니다.
- Kiwi skills는 정상 작업에서 raw Markdown 수정을 mutation 경로로 쓰지 않습니다. MCP 도구가 우선입니다.

<a id="ko-dev"></a>

## 10. 패키지 개발

소스 체크아웃에서:

```sh
npm ci
npm run build
node bin/speckiwi --help
```

검증 명령:

```sh
npm run typecheck
npm run lint
npm test                  # vitest, --no-file-parallelism
npm run test:coverage
npm run test:integration
npm run release:check
```

릴리스 baseline tag 예시:

```sh
git tag srs-v1.0.0-baseline
```

npm 패키지가 배포하는 주요 항목:

```text
bin/
dist/
docs/rule/SRS-MD-Rules-v2.5.0.md
docs/rule/SDS-MD-Rules-v2.5.0.md
docs/.kiwi/hooks
skills/codex/
skills/claude/
skills/etc/
```

<a id="ko-reqs"></a>

## 11. 관련 요구사항

위에서 설명한 온보딩 · skill 설치 · mutation · workflow 동작은 다음 SpecKiwi 요구사항에 대응합니다.

- `FR-NODE-067` / `FR-NODE-068` / `FR-NODE-069` / `FR-NODE-070` / `IR-CLI-070`: `speckiwi init`의 MCP 등록, Claude/Codex skill 설치, orphan `kiwi-*` prune, 통합 dry-run/report envelope.
- `IR-CLI-027` / `FR-NODE-016`: `speckiwi skills install <agent> <skill|all>` CLI와 core service.
- `FR-FLOW-012`: Kiwi skills는 정상 작업에 SpecKiwi MCP가 필요합니다.
- `FR-PARSE-032` / `FR-FLOW-036` / `FR-FLOW-037` / `FR-MCP-052`: `tdd` work-mode, SDS-MD 저작 표준(`design.md`), `kiwi-tdd` skill, `get_work_mode` / `set_work_mode` MCP 도구 (TDD First mode).
- `MIG-FLOW-002`: OpenCode/Hermes용 `skills/etc` variant.
- `FR-PARSE-017` / `FR-MCP-017` / `IR-CLI-026`: Stability lifecycle과 `update_stability`.
- `FR-MCP-018`: `append_section_note` mutation.
- `FR-PARSE-018` / `FR-MCP-019`: Target Goal meta block과 `set_target_goal`.
- `FR-ARCH-005`: Mutation tool kind 분류 (bulk mutation 거버넌스).
- `FR-PARSE-016` / `FR-NODE-015` / `IR-CLI-024` / `FR-MCP-016`: Completed Work Log 보고서 경로.
- `FR-FLOW-124` … `FR-FLOW-130`: `kiwi-pipeline` 기본 사이클과 단일 opt-out `--none-cycle` (2.9.0).
- `FR-FLOW-131` … `FR-FLOW-135` / `FR-NODE-188`: 모든 rung의 종료 리뷰 루프 의무와, 리뷰 기록 없는 완료를 run-close 검증기가 거부하게 만드는 `terminal_review` 저널 기록 (2.10.0).
- `FR-NODE-179`: run-root 불변식 — `docs/spec/`는 git 최상위에 있어야 하며 doctor가 이를 검사합니다 (2.7.1).
- target `2.5.2-phase1-target-lifecycle` · `2.6.0-phase2-parallel-lanes` 및 `kiwi-orchestrator` 요구 집합: target status lifecycle, lane 분할과 worktree 계약, 오케스트레이터 run 표면. (2.6.0 target 의 선언된 목표는 현재 배포물보다 앞서 있습니다 — §6 의 오케스트레이터 행을 보십시오.) 전체 목록은 `docs/spec/00.index.md`의 Target Map을 보십시오.
