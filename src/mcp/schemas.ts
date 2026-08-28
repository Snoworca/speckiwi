import { z } from "zod";
import { isReadOnlyTool, toolSchemas } from "./server.js";
import {
  ORCHESTRATE_TOOL_BINDINGS,
  ORCHESTRATE_CONTAINER_PATHS,
  ORCHESTRATE_LEAF_PATHS,
  orchestrateVerbKind
} from "../cli/commands/orchestrate.js";

// @req FR-ARCH-006 / REL-ARCH-002
// FR-ARCH-006 — ToolSpec command metadata registry as the single source of truth (SSOT) for every
// speckiwi command. One `toolSpecs` array enumerates the FULL CLI command surface (the commands
// registered by registerReadCommands + registerMutationCommands, walked recursively). Each entry
// carries cliName (required), an optional mcpName (only for commands exposed as MCP tools), kind,
// args, options, coreFn, and resultExitMap. Every derived view — CLI command names, MCP toolNames /
// toolSchemas keys / toolKinds, and the read-only set — is projected FROM this registry so the
// surfaces cannot silently drift (REL-ARCH-002 zero-drift contract).
//
// The registry mirrors the CURRENT runtime surface: its cliName multiset equals the read+mutation
// CLI command tree, and its mcpName set equals the MCP tool set registered by the server (== the
// keys of server.ts `toolSchemas`, which supplies the schema VALUES). Commands whose CLI lives
// outside the read/mutation registrars (the requirement-id collision-repair trio and the MCP
// workspace-info probe) have no dedicated CLI command in this tree; they are attached to the
// structural container commands (workflow / links / pipeline / work-order) that themselves carry no
// own handler, so the mcpName ⇔ toolSchemas set-equality holds without inventing CLI commands. When
// a later target registers a real CLI command for those (repair.ts / mcp.ts) or adds a new tool
// (e.g. validate_step), this registry and the runtime surface must be extended together.

/** One declared positional/argument of a command, keyed by name in {@link ToolSpec.args}. */
export interface ToolArgSpec {
  readonly type: string;
  readonly optional?: boolean;
}

/** How a CLI option value is encoded when rewriting `--input-json` into discrete argv. */
export type ToolOptionEncoding = "boolean" | "string" | "number" | "json";

/**
 * One CLI option of a command. `flag` is the raw commander flag string (its first whitespace token
 * is the long flag), `dest` is the JSON input key (the field name used by `--input-json` and the MCP
 * schema), `encoding` drives argv rewriting (`boolean` flags emit only the flag; others emit
 * flag+value), and `repeatable` marks array-valued options that emit the flag once per element.
 */
export interface ToolOptionSpec {
  readonly flag: string;
  readonly dest: string;
  readonly zod: z.ZodTypeAny;
  readonly repeatable: boolean;
  readonly encoding: ToolOptionEncoding;
  readonly oneOfGroup: string | null;
}

/** Command classification: `read` for read-only commands, or a mutation kind for mutation commands. */
export type ToolKind = "read" | "req-scoped" | "log-append" | "workspace";

/**
 * A command's MCP exposure: the tool name an agent calls and the description it reads when choosing.
 *
 * One value, because they are one decision. @req FR-MCP-060 — a tool the registry names is a tool an
 * agent has to choose, and until this pair existed the choosing was done from the argument list
 * alone. Passing them separately would leave the description optional in practice, which is how the
 * next tool arrives undescribed.
 */
export interface McpExposure {
  readonly name: string;
  readonly description: string;
}

/**
 * Declares a command's MCP exposure. CLI-only commands pass `undefined` to the spec builder instead.
 *
 * The description says three things: what the tool answers, why to pick it over the neighbour whose
 * name is next to it, and what it changes — `Read-only.` for a read, `Writes …` for a mutation.
 */
function mcp(name: string, description: string): McpExposure {
  return { name, description };
}

/** A single command's full metadata. `mcpName` is present only for MCP-exposed commands. */
export interface ToolSpec {
  readonly cliName: string;
  readonly mcpName?: string | undefined;
  /** The MCP tool description, present exactly when `mcpName` is. @req FR-MCP-060 */
  readonly description?: string | undefined;
  readonly kind: ToolKind;
  readonly args: Record<string, ToolArgSpec>;
  readonly options: readonly ToolOptionSpec[];
  /** Canonical core-function identifier this command dispatches to (SSOT descriptor). */
  readonly coreFn: string;
  /** Maps a result outcome name to the process exit code the CLI returns for it. */
  readonly resultExitMap: Record<string, number>;
}

// --- option builders -------------------------------------------------------------------------------

/** Builds a {@link ToolOptionSpec}. Encoding defaults to boolean for value-less flags, else string. */
function opt(flag: string, dest: string, extra: Partial<ToolOptionSpec> = {}): ToolOptionSpec {
  const encoding: ToolOptionEncoding =
    extra.encoding ?? (flag.includes("<") || flag.includes("[") ? "string" : "boolean");
  const repeatable = extra.repeatable ?? false;
  const zod =
    extra.zod ?? (encoding === "boolean" ? z.boolean() : repeatable ? z.array(z.string()) : z.string());
  return { flag, dest, zod, repeatable, encoding, oneOfGroup: extra.oneOfGroup ?? null };
}

const DRY_RUN = opt("--dry-run", "dryRun");
const IGNORE_LOCK = opt("--ignore-lock", "ignoreLock");

// --- spec builders ---------------------------------------------------------------------------------

interface SpecExtra {
  readonly args?: Record<string, ToolArgSpec>;
  readonly options?: readonly ToolOptionSpec[];
  readonly resultExitMap?: Record<string, number>;
}

/**
 * A read-only command (kind "read"); pass `undefined` for CLI-only commands. The mcpName and
 * description keys are always present (value undefined for CLI-only) so every spec declares them.
 */
function readSpec(cliName: string, exposure: McpExposure | undefined, coreFn: string, extra: SpecExtra = {}): ToolSpec {
  return {
    cliName,
    mcpName: exposure?.name,
    description: exposure?.description,
    kind: "read",
    args: extra.args ?? {},
    options: extra.options ?? [],
    coreFn,
    resultExitMap: extra.resultExitMap ?? { ok: 0, fail: 1 }
  };
}

/**
 * A mutation command; pass `undefined` for CLI-only mutation commands. The mcpName and description
 * keys are always present (value undefined for CLI-only) so every spec declares them.
 */
function mutationSpec(
  cliName: string,
  exposure: McpExposure | undefined,
  kind: Exclude<ToolKind, "read">,
  coreFn: string,
  options: readonly ToolOptionSpec[] = []
): ToolSpec {
  return {
    cliName,
    mcpName: exposure?.name,
    description: exposure?.description,
    kind,
    args: {},
    options,
    coreFn,
    resultExitMap: { ok: 0, error: 5 }
  };
}

// --- the registry ----------------------------------------------------------------------------------
//
// Order-preserving array (the `commands` catalog is a 1:1 render of this order). Every cliName below is
// one node of the read+mutation CLI command tree (walked recursively: registerReadCommands +
// registerMutationCommands), so the cliName MULTISET equals the live tree exactly — including the two
// `validate` nodes (top-level `validate` and `step validate`) and the two `check` nodes (`links check`
// and `vibe-gate check`). The entries that carry an mcpName reproduce exactly the server's registered
// MCP tools (== the keys of `toolSchemas`).
//
// A handful of MCP tools have NO dedicated CLI command of their own (the requirement-id collision-repair
// trio, the MCP workspace-info probe, and the v3 step/compatibility read+mutation services). The
// registry still needs every spec to declare a cliName, so those MCP-only tools are mirrored onto CLI
// nodes that otherwise carry no MCP surface — container commands with no own handler (workflow /
// pipeline / links / work-order / vibe-gate / step) first, then a few leaf/alias CLI nodes. Only the
// mcpName ⇔ toolSchemas set-equality and the per-mcpName kind are load-bearing for those; the cliName is
// just the host node the tool is attached to so the registry can enumerate a single flat command set.


/**
 * The `orchestrate` namespace's registry slice, projected from the CLI vocabulary rather than
 * retyped: every container node and every leaf of the built tree gets one spec, and the twenty-five
 * `orchestrate_*` tools attach to the leaf each mirrors. Retyping forty-seven rows by hand is exactly
 * the drift this registry exists to prevent. @req IR-CLI-082 / IR-MCP-003
 */
function orchestrateSpecs(): ToolSpec[] {
  const toolByLeaf = new Map<string, (typeof ORCHESTRATE_TOOL_BINDINGS)[number]>();
  for (const binding of ORCHESTRATE_TOOL_BINDINGS) toolByLeaf.set(binding.path.join(" "), binding);

  const specs: ToolSpec[] = [];
  for (const container of ORCHESTRATE_CONTAINER_PATHS) {
    // Container commands carry no own handler; they exist so the registry enumerates the whole tree.
    specs.push(readSpec(container[container.length - 1] as string, undefined, `orchestrate:${container.join(" ")}`));
  }
  for (const leaf of ORCHESTRATE_LEAF_PATHS) {
    const name = leaf[leaf.length - 1] as string;
    const binding = toolByLeaf.get(leaf.join(" "));
    const coreFn = `orchestrate:${leaf.join(" ")}`;
    const options = (binding?.options ?? []).map((option) =>
      opt(option.encoding === "boolean" ? option.flag : `${option.flag} <value>`, option.dest, {
        encoding: option.encoding === "array" ? "string" : option.encoding === "json" ? "json" : option.encoding,
        repeatable: option.encoding === "array"
      })
    );
    // The binding carries the description beside the tool name it declares, for the same reason the
    // options are read off it rather than retyped: a description keyed by name in a second table
    // outlives the tool it describes. @req FR-MCP-060
    const exposure = binding ? mcp(binding.tool, binding.description) : undefined;
    if (orchestrateVerbKind(leaf) === "mutation") {
      specs.push(mutationSpec(name, exposure, "workspace", coreFn, options));
    } else {
      specs.push(readSpec(name, exposure, coreFn, { options }));
    }
  }
  return specs;
}

export const toolSpecs: readonly ToolSpec[] = [
  // ---- read commands (registerReadCommands) ----
  readSpec("validate", mcp("validate_spec", "Runs the SRS-MD rule set over every document under `docs/spec` and returns each diagnostic with its code, severity, file and line. Ask it before trusting any rollup; a target summary counts blocks and never re-parses them for rule violations. Read-only."), "validateWorkspace", {
    args: { strict: { type: "boolean", optional: true }, failOnWarning: { type: "boolean", optional: true } },
    resultExitMap: { ok: 0, fail: 1 }
  }),
  readSpec("extract", undefined, "extractRequirements"),
  readSpec("list", mcp("list_requirements", "Enumerates requirement records filtered structurally — by target, status, type, scope, tag, stability, priority, missing evidence, related document, evidence or trace reference, or new-work candidacy — in identifier order, with paging and field projection. Reach for it when the filter is metadata; free text belongs to the query reader beside it. Read-only."), "listRequirements"),
  readSpec("search", mcp("search_requirements", "Finds requirement records whose text matches a free-text query, over the subset those same structural filters admit, and answers in a fixed shape: identifier, title, matching snippets and location, never the block body and never a projection you choose. Reach for it when you remember a phrase but no identifier. Read-only."), "searchRequirements", { args: { query: { type: "string" } } }),
  readSpec("show", mcp("get_requirement", "Returns one requirement block by identifier — metadata, statement, acceptance criteria, evidence and trace rows — optionally with its raw Markdown. Ask it once you hold an id; the enumerating readers answer which ones exist, this answers what one of them says. Read-only."), "getRequirement", { args: { id: { type: "string" } } }),
  readSpec("targets", undefined, "listTargets"),
  readSpec("active-target", mcp("get_active_target", "Names the Active Target the SRS index records, together with its goal, its status and stability rollups, its blockers and the workspace diagnostics as they stand — those are counted over every document, not narrowed to this target. Ask it when you do not yet know which target is current. Read-only."), "getActiveTarget"),
  readSpec("completed-work", mcp("list_completed_work", "Pages the Completed Work Log — date, target, scope, requirement ids, summary and report paths — newest first by default and filterable by target, scope or a since date. This log is a derived summary; requirement blocks remain the authority on completion. Read-only."), "listCompletedWork"),
  readSpec("completed-work-migration-plan", undefined, "planCompletedWorkMigration"),
  // Container command with no own handler; hosts the MCP workspace-info probe (no dedicated CLI).
  readSpec("workflow", mcp("mcp_workspace_info", "Reports which repository this MCP server bound to at startup — the root, how that root was discovered, the index path and the package version. Ask it when a call answered about somewhere unexpected. Read-only."), "mcpWorkspaceInfo"),
  readSpec("workspace", mcp("workflow_workspace_info", "Reports the run workspace for the root you pass and the Active Target it carries, so a session inside a linked worktree can address its own tree. Read-only."), "workflowWorkspaceInfo"),
  readSpec("artifacts", mcp("workflow_artifacts_list", "Lists every run artifact a selector admits — plan, sidecar, pipeline, pm-state, worklog, waves, resume-card, handoff and the remaining run-artifact kinds — with paging and an optional body, and reports an ambiguous selection as a diagnostic instead of choosing for you. Read-only."), "workflowArtifactsList"),
  readSpec("latest", mcp("workflow_latest_artifact", "Returns the single run artifact a selector best matches, breaking ties by generation time and then by file time. This spelling and the resolve reader run one lookup and reach the same row; which name you use says only which reading you meant. Read-only."), "workflowLatestArtifact"),
  readSpec("resolve", mcp("workflow_resolve_artifact", "Answers which one run artifact a path, run id, target and kind pick out, surfacing an unbroken tie as a diagnostic rather than choosing between the two. Behaviourally the same lookup as the best-match spelling beside it. Read-only."), "workflowResolveArtifact"),
  readSpec("plan-status", mcp("workflow_plan_status", "Reads the plan artifact for a run and reports its companion sidecar's whole task list: identifier, phase, title, dependencies and requirement ids. Which tasks are ticked is not among them — the plan document's checkboxes are opened only by the drift comparison, and per-task progress lives in the pm-state artifact the session reader returns. Read-only."), "workflowPlanStatus"),
  readSpec("plan-task", mcp("workflow_plan_task", "Returns one task of the plan sidecar by its identifier, projected onto the same five fields the phase-wide reader gives, and answers with a null task rather than an error when nothing carries that identifier. Read-only."), "workflowPlanTask", { args: { taskId: { type: "string" } } }),
  readSpec("next-task", mcp("workflow_next_plan_task", "Returns the next plan task whose pm-state status is not yet done or skipped, or names the unfinished dependency blocking it. The plan document's own checkboxes decide nothing here; they are weighed against pm-state only as a drift warning. Read-only."), "workflowNextPlanTask"),
  readSpec("doctor", mcp("workflow_doctor", "Validates the run artifacts a selector reaches and returns every structural problem it found as one flat list, beside the outcome classes those problems fall into. Read-only."), "workflowDoctor"),
  readSpec("diff", mcp("workflow_diff", "Classifies the same run-artifact problems into repair classes, so a caller can see what kind of fix each one needs rather than the raw diagnostic list. Read-only."), "workflowDiff"),
  readSpec("schema-check", mcp("workflow_schema_check", "Checks the run artifacts against the schema version they declare and reports which schema-level outcomes they reached — an invalid plan contract, an unsupported schema version, an invalid artifact, a stale one — rather than the individual rows behind those outcomes. Read-only."), "workflowSchemaCheck"),
  readSpec("pipeline-status", mcp("workflow_pipeline_status", "Reports the state of the pipeline journal for a run — where it lives, how many events it holds and the latest one. Read-only."), "workflowPipelineStatus"),
  readSpec("pipeline-tail", mcp("workflow_pipeline_tail", "Pages the pipeline journal's events in append order, oldest first, with an offset and a limit that defaults to twenty, so the most recent handoffs sit at the far end rather than the near one. Read-only."), "workflowPipelineTail"),
  readSpec("pipeline-next", mcp("workflow_pipeline_next", "Reads the `next_hint` the latest pipeline event carries and returns it beside that event, so a session knows which skill to run next. Read-only."), "workflowPipelineNext"),
  readSpec("pipeline-compact", mcp("workflow_pipeline_compact", "Reports what compacting the pipeline journal would leave behind, as counts rather than as rows: how many entries it holds, how many survive supersession, and how many logically deleted ones were filtered out. Nothing is rewritten. Read-only."), "workflowPipelineCompact"),
  // Container command with no own handler; hosts the collision-repair "plan" tool (CLI in repair.ts).
  readSpec("pipeline", mcp("plan_requirement_id_collision_repair", "Produces the repair plan for one duplicate Requirement ID: which occurrence keeps the id, which is renamed, what replacement it takes and which references move with it. Nothing is applied here. Read-only."), "planRequirementIdCollisionRepair"),
  // `pipeline status/tail/compact` aliases: CLI-only reads, except `status`/`tail` also host the v3
  // compatibility-check refresh/revoke MCP tools (no dedicated CLI of their own).
  mutationSpec("status", mcp("refresh_compatibility_check", "Recomputes the verdict on an existing checked-compatible edge between two requirements and stamps it clean again. Writes the trace-link row on the holding requirement block."), "req-scoped", "refreshCompatibilityCheck", [DRY_RUN]),
  mutationSpec("tail", mcp("revoke_compatibility_check", "Removes the compatibility claim between two requirements, leaving that edge unchecked. Writes the holding requirement block, deleting that trace-link row out of it rather than restating it."), "req-scoped", "revokeCompatibilityCheck", [DRY_RUN]),
  readSpec("compact", undefined, "workflowPipelineCompactAlias"),
  readSpec("session-status", mcp("workflow_session_status", "Reads the pm-state artifact for a run and returns it whole, with its stats and its task list. Read-only."), "workflowSessionStatus"),
  readSpec("resume-hint", mcp("workflow_resume_hint", "Answers whether a run can be resumed and which task it would resume into, folding the next-task lookup and its blocking reason into one reply. Read-only."), "workflowResumeHint"),
  readSpec("worklog-tail", mcp("workflow_worklog_tail", "Pages the worklog entries a run appended, which are per-task progress notes and not skill handoffs, in append order from the offset given, twenty at a time by default. Read-only."), "workflowWorklogTail"),
  readSpec("migrate-preview", mcp("preview_legacy_workflow_migration", "Shows what migrating pre-3.0 workflow artifacts into the current layout would change, file by file. It refuses `apply`, `write`, `fix`, `normalize` and `migrate`; there is no execute mode behind it. Read-only."), "previewLegacyWorkflowMigration"),
  readSpec("next", mcp("get_next_work_order", "Names the action a run should take next — create a plan, execute a task, resume a session, ask the user, repair an artifact, or stop — beside the requirements that action covers, the plan task behind it and the context it needs. Read-only."), "getNextWorkOrder"),
  readSpec("scopes", undefined, "listScopes"),
  readSpec("summary", mcp("summarize_target", "Rolls up one named release or milestone: counts by status and stability, blockers and warnings, requirements whose evidence is missing, new-work candidates and the completed-work rows attached. Ask it when the name is already known and the detail behind the counts is what you need. Read-only."), "summarizeTarget"),
  readSpec("explain", undefined, "explainDiagnostic", { args: { code: { type: "string" } } }),
  // FR-MCP-052 — the mode node hosts the get_work_mode read tool (the argument-less CLI read).
  readSpec("mode", mcp("get_work_mode", "Reports the persisted work mode (`sdd`, `vibe`, `tdd` or `wait`) and the Active Task recorded beside it, falling open to `wait` when the state document is absent or unreadable rather than failing the call. Read-only."), "workMode", { args: { value: { type: "string", optional: true } } }),
  // Container command with no own handler; hosts the v3 add-compatibility-check MCP tool.
  mutationSpec("vibe-gate", mcp("add_compatibility_check", "Records a first compatibility claim between two requirements, creating the edge on whichever of the two sorts lower, and refuses a requirement paired with itself, a discarded or deprecated endpoint, a frozen holding block, and a pair already recorded. Writes a trace-link row into the holding requirement block."), "req-scoped", "addCompatibilityCheck", [DRY_RUN]),
  // vibe-gate check: CLI-only gate leaf (duplicate cliName "check" — see links check below); hosts the
  // FR-MCP-052 set_work_mode workspace mutation (no dedicated CLI of its own — `mode <value>` is the CLI).
  mutationSpec("check", mcp("set_work_mode", "Switches the persisted work mode and, for `vibe` and `tdd`, the Active Task; a stale Active Task line is dropped by a move to `sdd` or `wait`, and equally by a move to `vibe` or `tdd` that names no task, while a value outside the four is refused. Writes `docs/spec/steps/state.md`."), "workspace", "setWorkMode", [DRY_RUN]),
  readSpec("changed-since", undefined, "changedSince", { args: { date: { type: "string" } } }),
  readSpec("stale", undefined, "staleRequirements"),
  readSpec("history", undefined, "requirementHistory", { args: { id: { type: "string" } } }),
  readSpec("attention", undefined, "attentionQueue"),
  readSpec("commands", undefined, "renderCommandCatalog"),
  // Container command with no own handler; hosts the collision-repair "diagnose" tool (CLI in repair.ts).
  readSpec("links", mcp("diagnose_requirement_id_collisions", "Finds every duplicate Requirement ID in the workspace and, for each, the occurrences that carry it with their file, heading line and block hash — the three coordinates a repair plan must name. Read-only."), "diagnoseRequirementIdCollisions"),
  readSpec("check", undefined, "checkLinks"),
  // Container command with no own handler; hosts the v3 list-steps MCP tool. `step validate` (below) is
  // the second `validate` node and carries the validate_step MCP tool.
  readSpec("step", mcp("list_steps", "Returns the rows of `docs/spec/steps/state.md` in dependency order, each with its status, its dependencies, and whether its SDS design document exists and what status that document carries, and reports cycles, orphan dependencies and supersede conflicts as advisories rather than errors. It enumerates that table, never the directories on disk, so the two can disagree. Read-only."), "listSteps"),
  readSpec("validate", mcp("validate_step", "Runs the step-local validation pass for one named step — its step and SDS advisories — so a body-scope error does not leak into that step's diagnostics. Read-only."), "validateWorkspaceScoped", { args: { step: { type: "string" } } }),
  // IR-CLI-073/IR-CLI-074 — dedicated step mutation leaves under the `step` container. They carry the
  // step MCP tools that used to be hosted on unrelated CLI mutation rows (set-supersede /
  // scaffold-scope / register-scopes) before the CLI mirrors existed.
  mutationSpec("synthesize", mcp("synthesize_step_srs", "Turns a finished step's design and evidence into a step SRS document under the step directory, and quietly does nothing at all when that document already exists, so a second run is not a refresh. Writes `docs/spec/steps/<task>/<task>.srs.md`."), "workspace", "synthesizeStepSrs", [DRY_RUN]),
  mutationSpec("claim", mcp("claim_step", "Opens a step and declares what it will touch — one scope and any number of requirement ids — so a second session cannot claim overlapping ground; naming a supersede target that is verified or frozen is refused outright. Writes `docs/spec/steps/state.md`."), "workspace", "claimStep", [
    opt("--touches-scope <scope>", "touchesScope"),
    opt("--touches-req <id>", "touchesReq", { repeatable: true }),
    opt("--force", "force"),
    opt("--supersede <id>", "supersede"),
    DRY_RUN
  ]),
  mutationSpec("update-state", mcp("update_step_state", "Moves a step through its own lifecycle — `active`, `merging`, `merged` or `abandoned` — and records the steps it depends on. Under the vibe and tdd work modes the `merged` transition is completion-gated on the requirement closure that step touches, and needs `acknowledged` to pass over an edge that is not clean. Writes `docs/spec/steps/state.md`."), "workspace", "updateStepState", [
    opt("--status <status>", "status"),
    opt("--depends-on <steps>", "dependsOn"),
    opt("--acknowledged", "acknowledged"),
    DRY_RUN
  ]),
  mutationSpec("promote", mcp("promote_step_requirement", "Copies a step requirement out of `docs/spec/steps` into a body scope, evidence and all, which is the post-hoc half of TDD-First mode; the step block itself stays where it is. Writes the target scope document and re-syncs the index rollups."), "req-scoped", "promoteStepRequirement", [
    opt("--from-step <step>", "fromStep"),
    opt("--to-scope <scope>", "toScope"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  // FR-NODE-080/FR-NODE-081 — SDS stub scaffold and lifecycle-status leaves under `step`.
  mutationSpec("scaffold", mcp("scaffold_step", "Creates the SDS stub for a step under `docs/spec/steps/<task>/design.md`, which TDD-First mode requires before any test may be written. Writes the step directory, that design document and an intent stub beside it, never overwriting either one that already exists."), "workspace", "scaffoldStep", [
    opt("--target <target>", "target"),
    DRY_RUN
  ]),
  mutationSpec("sds-status", mcp("set_sds_status", "Sets the SDS lifecycle status of a step's design document — draft, agreed, superseded — which the TDD-First gates consult before allowing tests. That order runs one way only, so a move backwards or onto the status already recorded is refused. Writes the design document's status line."), "workspace", "setSdsStatus", [DRY_RUN]),
  // release-readiness: real CLI read; also hosts the FR-MCP-054 check_vibe_gate read tool (its CLI
  // counterpart is `vibe-gate check`, whose registry row already hosts set_work_mode).
  readSpec("release-readiness", mcp("check_vibe_gate", "Answers whether the vibe/tdd synthesis gate passes: an active vibe or tdd task with no synthesized step directory, or a tdd task with no design document, fails it. Read-only."), "evaluateVibeGate"),
  readSpec("coverage", mcp("list_dirty_edges", "Enumerates every `checked_compatible` edge with its classification — clean, dirty, orphaned or missing — optionally narrowed to one target. Read-only."), "listDirtyEdges"),
  readSpec("rtm", mcp("list_compat_edges", "Projects the same `checked_compatible` edge set as the dirty-edge reader and returns identical rows; the two spellings exist so a caller can name the traceability reading instead of the staleness one. Read-only."), "listCompatEdges"),

  // ---- mutation commands (registerMutationCommands) ----
  mutationSpec("init", mcp("init_project", "Lays down the SRS scaffold a project needs — index, first scope document, appendix, step state — skipping each one that already exists, while the tool-owned files are rewritten on every run: the bundled rules documents, whose stale versioned copies are deleted, and the managed block inside `AGENTS.md` and `CLAUDE.md`. Passing `force` turns that skip off and overwrites the author-owned files with fresh templates, discarding whatever requirements they held. Over MCP it provisions files only: registering the server and installing the agent skills are CLI-side opt-ins this tool never sets. Writes the scaffold files."), "workspace", "initProject", [
    opt("--target <target>", "target"),
    opt("--scope <scope>", "scope"),
    opt("--force", "force"),
    IGNORE_LOCK
  ]),
  // IR-CLI-076 — upgrade is CLI-only on purpose: init_project is exposed over MCP because it touches
  // only tool-owned artifacts, and that reasoning does not extend to a command that rewrites author
  // files. No agent drives this migration unattended.
  mutationSpec("upgrade", undefined, "workspace", "upgradeProject", [
    // IR-CLI-088 — the command performs by default; `--dry-run` selects the plan. `--apply` stays
    // declared because callers written against IR-CLI-076 still pass it.
    DRY_RUN,
    opt("--apply", "apply"),
    opt("--no-skills", "skills"),
    opt("--no-mcp", "mcp"),
    // IR-CLI-095 — spelled as `init` spells it, and additive as init's is: the project migration still
    // runs. The destructive counterpart is where that symmetry stops (IR-CLI-096).
    opt("-g, --global", "installSkillsGlobal"),
    IGNORE_LOCK
  ]),
  // IR-CLI-096 — CLI-only for the same reason `upgrade` is, only more so: this one deletes. No agent
  // drives it unattended.
  mutationSpec("remove", undefined, "workspace", "removeProject", [
    DRY_RUN,
    opt("--apply", "apply"),
    opt("-g, --global", "global"),
    IGNORE_LOCK
  ]),
  mutationSpec("sync-index", mcp("sync_index", "Recomputes the rollup tables in `docs/spec/00.index.md` from the requirement blocks, optionally guarded by the sha256 you expect that file to still carry. Writes the index document."), "workspace", "syncIndexRollups", [
    opt("--expected-sha256 <sha>", "expectedSha256"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("update-status", mcp("update_status", "Moves one requirement's Status through the implementation lifecycle — planned, in_progress, blocked, implemented, verified, discarded — and appends a dated Change Note whenever a `reason` comes with it. Reaching `verified` needs acceptance criteria, every one of them ticked, and an evidence row whose reference resolves on disk. Discarding a verified, frozen, stable or evidence-backed requirement is refused here with no override; `supersede_requirement` is the way to it. Writes the requirement block."), "req-scoped", "updateStatus", [
    opt("--reason <text>", "reason"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("update-stability", mcp("update_stability", "Moves one requirement's Stability — draft, evolving, stable, frozen, deprecated — and appends a dated Change Note whenever a `reason` comes with it, which the `frozen` transition refuses to run without; a verified requirement may not go back to draft. Stability governs whether a requirement may be worked on at all, which the lifecycle field does not. Writes the requirement block."), "req-scoped", "updateStability", [
    opt("--reason <text>", "reason"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("append-note", mcp("append_section_note", "Appends text to one narrative section of a requirement, or replaces that section's body outright. The section arrives as a key rather than as its heading — `rationale`, `research`, `implementation_notes` — no table is reachable from here, the text is capped at 500 characters, and an appended note is rendered as a dated bullet, so carrying your own date doubles it. Writes the requirement block."), "req-scoped", "appendSectionNote", [
    opt("--section <section>", "section"),
    opt("--text <text>", "text"),
    opt("--mode <mode>", "mode"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("edit-requirement", mcp("edit_requirement_fields", "Edits the scalar fields of one requirement — title, statement, priority, risk, tags, related documents, verification method, GitHub issue — leaving criteria and table rows alone. Refused while the requirement's Status is `verified`, unlike the two `add_*` tools beside it, which append to a verified block. Writes the requirement block."), "req-scoped", "updateRequirementFields", [
    opt("--title <title>", "title"),
    opt("--statement <statement>", "statement"),
    opt("--priority <priority>", "priority"),
    opt("--risk <risk>", "risk"),
    opt("--tags <csv>", "tags"),
    opt("--related-docs <csv>", "relatedDocs"),
    opt("--verification-method <method>", "verificationMethod"),
    opt("--github-issue <url>", "githubIssue"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("replace-acceptance-criteria", mcp("replace_acceptance_criteria", "Replaces one requirement's whole Acceptance Criteria list with the items you supply, each carrying its checked state; the identifiers are reassigned by position, AC-1 upward, so a reorder silently repoints any evidence row that names one. Partial edits are impossible here, the list arrives complete and may not be empty, and the call is refused while the requirement's Status is `verified`. Writes the requirement block."), "req-scoped", "replaceAcceptanceCriteria", [
    opt("--items <json>", "items", { encoding: "json" }),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("edit-requirement-table-rows", mcp("edit_requirement_table_rows", "Updates or deletes rows of one requirement's Verification Evidence or Trace Links table through an explicit operation list; no other table is reachable from here, and appending a row belongs to the two `add_*` tools beside it rather than to this one. Refused while the requirement's Status is `verified`. Writes the requirement block."), "req-scoped", "editRequirementTableRows", [
    opt("--section <section>", "section"),
    opt("--operations <json>", "operations", { encoding: "json" }),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("set-active-target", mcp("set_active_target", "Points the Active Target at a named target, creating its row when asked, and moves the previous holder off active to a standing derived from its own requirements: completed once every live one is verified, planned otherwise. Writes the target map and the Active Target line."), "workspace", "setActiveTarget", [
    opt("--create", "create"),
    opt("--type <type>", "type"),
    opt("--description <text>", "description"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  // IR-CLI-081 — CLI-only on the precedent `upgrade` set. `set_active_target` is exposed over MCP
  // because moving the active target is ordinary agent work; recording a target as released is a
  // release decision, and no agent makes that unattended.
  mutationSpec("set-target-status", undefined, "workspace", "setTargetStatus", [DRY_RUN, IGNORE_LOCK]),
  mutationSpec("set-target-goal", mcp("set_target_goal", "Records the goal sentence for a target, which every later reader of that target sees, folding any line break in it down to a single space so the index table it lands in survives. Writes that target's Goal line."), "workspace", "setTargetGoal", [
    opt("--goal <text>", "goal"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-completed-work", mcp("add_completed_work", "Appends one dated row to the Completed Work Log — target, scope, requirement ids, summary and report paths — refusing the whole write when a name it carries does not resolve: an unregistered target or scope, a requirement id no block holds, or a requirement not yet implemented, which `allowIncomplete` waives on its own. Writes `docs/spec/05.completed-work.md` when that log exists, otherwise the split history file `docs/spec/91.completed-work-log.md`."), "log-append", "addCompletedWork", [
    opt("--date <date>", "date"),
    opt("--summary <summary>", "summary"),
    opt("--target <target>", "target"),
    opt("--scope <scope>", "scope"),
    opt("--requirements <ids>", "requirementIds"),
    opt("--report <path>", "reportPaths", { repeatable: true }),
    opt("--allow-incomplete", "allowIncomplete"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("check-ac", mcp("check_acceptance_criteria", "Ticks or unticks acceptance criteria of one requirement, leaving their wording untouched. Name the ids to set, or pass the single id `all` to set every criterion the block carries. Writes the requirement block."), "req-scoped", "setAcceptanceCriteriaChecked", [
    opt("--all", "all"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("uncheck-ac", undefined, "req-scoped", "setAcceptanceCriteriaChecked", [
    opt("--all", "all"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-evidence", mcp("add_verification_evidence", "Adds one Verification Evidence row to a requirement — type, reference, the criteria it covers, notes — which is what makes a `verified` status defensible. Writes the requirement block."), "req-scoped", "addVerificationEvidence", [
    opt("--type <type>", "type"),
    opt("--reference <reference>", "reference"),
    opt("--covers <covers>", "covers"),
    opt("--notes <notes>", "notes"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-trace", mcp("add_trace_link", "Adds one Trace Link row to a requirement — type, reference, relation, notes — recording what the requirement connects to rather than what proves it; a row of type Requirement whose reference names no known block is refused. Writes the requirement block."), "req-scoped", "addTraceLink", [
    opt("--type <type>", "type"),
    opt("--reference <reference>", "reference"),
    opt("--relation <relation>", "relation"),
    opt("--notes <notes>", "notes"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-requirement", mcp("add_requirement", "Creates a new requirement block in the scope document, allocating the next id in the series that the type prefix and the scope prefix share, and can seed criteria, evidence and trace rows in the same call. Writes the scope SRS document and the index rollups."), "workspace", "addRequirement", [
    opt("--type <type>", "type"),
    opt("--scope <scope>", "scope"),
    opt("--target <target>", "target"),
    opt("--title <title>", "title"),
    opt("--statement <statement>", "statement"),
    opt("--requirement <requirement>", "requirement"),
    opt("--ac <criterion>", "acceptanceCriteria", { repeatable: true }),
    opt("--checked-ac <criterion>", "checkedAcceptanceCriteria", { repeatable: true }),
    opt("--status <status>", "status"),
    opt("--priority <priority>", "priority"),
    opt("--tags <tags>", "tags"),
    opt("--risk <risk>", "risk"),
    opt("--stability <stability>", "stability"),
    opt("--verification-method <method>", "verificationMethod"),
    opt("--github-issue <issue>", "githubIssue"),
    opt("--related-docs <doc>", "relatedDocs", { repeatable: true }),
    opt("--rationale <text>", "rationale"),
    opt("--implementation-notes <text>", "implementationNotes"),
    opt("--research <text>", "research"),
    opt("--change-notes <text>", "changeNotes"),
    opt("--evidence <row>", "evidence", { repeatable: true }),
    opt("--trace <row>", "trace", { repeatable: true }),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("edit-ac", undefined, "req-scoped", "editAcceptanceCriteria", [
    opt("--text <text>", "text"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-related-doc", undefined, "req-scoped", "addRelatedDoc", [
    opt("--link <link>", "link"),
    DRY_RUN
  ]),
  mutationSpec("add-change-note", undefined, "req-scoped", "addChangeNote", [
    opt("--change <change>", "change"),
    opt("--reason <reason>", "reason"),
    opt("--date <date>", "date"),
    DRY_RUN
  ]),
  mutationSpec("update-field", undefined, "workspace", "updateField", [
    opt("--field <field>", "field"),
    opt("--value <value>", "value"),
    opt("--apply", "apply"),
    opt("--confirm", "confirm"),
    DRY_RUN
  ]),
  mutationSpec("retarget", undefined, "workspace", "retarget", [
    opt("--from <target>", "from"),
    opt("--to <target>", "to"),
    opt("--reason <text>", "reason"),
    opt("--scope <scope>", "scope"),
    opt("--status <status>", "status"),
    opt("--type <type>", "type"),
    opt("--id <id>", "id", { repeatable: true }),
    opt("--exclude <id>", "exclude", { repeatable: true }),
    opt("--apply", "apply")
  ]),
  mutationSpec("supersede", mcp("supersede_requirement", "Creates the successor of one requirement carrying a `supersedes` trace link back to it, then moves the original to `discarded`, overriding the guard that protects a verified, frozen or stable requirement from discard — an override this surface hard-codes and no argument can switch off. Every `checked_compatible` edge touching the original is revoked in the same call. Writes the new requirement block, the original's status row, and the block holding each revoked edge."), "workspace", "supersedeRequirement", [
    opt("--old <id>", "old"),
    opt("--new-title <title>", "newTitle"),
    opt("--new-statement <statement>", "newStatement"),
    opt("--scope <scope>", "scope"),
    opt("--type <type>", "type"),
    opt("--target <target>", "target"),
    opt("--successor <id>", "successor"),
    opt("--ac <criterion>", "ac", { repeatable: true }),
    opt("--reason <text>", "reason"),
    opt("--apply", "apply"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  // set-supersede: real CLI mutation (claim_step moved to its dedicated `step claim` leaf, IR-CLI-074).
  mutationSpec("set-supersede", undefined, "workspace", "setSupersede", [
    opt("--supersedes <id>", "supersedes"),
    opt("--superseded-by <id>", "supersededBy"),
    opt("--sync-trace", "syncTrace"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("restore", undefined, "req-scoped", "restore", [
    opt("--to <status>", "to"),
    opt("--reason <text>", "reason"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  // scaffold-scope: real CLI mutation (update_step_state moved to `step update-state`, IR-CLI-074).
  // FR-MCP-056 — exposed over MCP so an MCP-only agent can create a scope through a sanctioned
  // mutation instead of hand-writing the document and both index rows.
  mutationSpec("scaffold-scope", mcp("scaffold_scope", "Creates a new scope SRS document with the next two-digit number and registers it in both index sections, so the number is allocated rather than guessed. It previews by default and changes nothing on disk until `apply` is passed. Writes the new document and the index."), "workspace", "scaffoldScope", [
    opt("--apply", "apply"),
    DRY_RUN,
    // IR-CLI-078 — the mutation takes the SRS lock since v2.5.0, so it needs the bypass every
    // comparable mutation exposes.
    IGNORE_LOCK
  ]),
  // register-scopes: real CLI mutation (promote_step_requirement moved to `step promote`, IR-CLI-074).
  mutationSpec("register-scopes", mcp("register_scopes", "Registers scope documents that exist on disk but are missing from the index's Scope Map, creating no document and adding no SRS Documents row. It previews by default and changes nothing on disk until `apply` is passed. Writes the index."), "workspace", "registerScopes", [
    opt("--apply", "apply"),
    DRY_RUN
  ]),

  // ---- workflow mutation commands (registerReadCommands, under `workflow`) ----
  mutationSpec("task-check", mcp("workflow_task_check", "Ticks one plan task as done in the plan artifact. Only that checkbox line changes: `owner`, `reqId` and `reason` come back in the reply and land nowhere in the document. `owner` is a gate rather than a record — it defaults to `kiwi-pm`, any other value but `pm` is refused, and so is a tick while a dependency of that task is unfinished. Writes the plan document."), "workspace", "workflowTaskCheck"),
  mutationSpec("task-uncheck", mcp("workflow_task_uncheck", "Unticks one plan task, returning it to open. Only that checkbox line changes: `owner`, `reqId` and `reason` come back in the reply and land nowhere in the document. `owner` is a gate rather than a record — it defaults to `kiwi-pm`, any other value but `pm` is refused, and so is an untick while a dependency of that task is unfinished. Writes the plan document."), "workspace", "workflowTaskUncheck"),
  mutationSpec("checklist-set", mcp("workflow_checklist_set", "Sets a plan task's checkbox to an explicit true or false, taking that value as a parameter instead of baking it into the tool name, so one call site can set either. It carries the same `owner` gate as the tick and untick spellings beside it: `kiwi-pm` or `pm`, and no other value. Writes the plan document."), "workspace", "workflowChecklistSet"),
  mutationSpec("task-status-set", mcp("workflow_task_status_set", "Sets the status field a pm-state artifact records for one task, which is separate from the plan's checkbox and is the field the next-task selector actually consults. `owner` must be `kiwi-pm` or `pm`, or the call is refused. Writes the pm-state document."), "workspace", "workflowTaskStatusSet"),
  mutationSpec("pipeline-emit", mcp("workflow_pipeline_emit", "Appends one event to the pipeline journal, recording which kiwi skill ran, how it ended and what it hands onward. Writes the pipeline journal file."), "workspace", "workflowPipelineEmit"),
  mutationSpec("worklog-emit", mcp("workflow_worklog_emit", "Appends one worklog entry for a task — progress, not a skill handoff. Writes the worklog journal file."), "workspace", "workflowWorklogEmit"),
  mutationSpec("repair-record", mcp("workflow_repair_record", "Appends a repair record to a run journal, naming what was repaired and why. Writes the journal file `path` names, or the run's own worklog journal when `path` is left out."), "workspace", "workflowRepairRecord"),
  mutationSpec("reclassify-record", mcp("workflow_record_reclassification", "Reclassifies one journal line written under the wrong record type. It takes that line's whole typed identity — record type, line number, byte offset, raw hash, event key, target run id, preimage prefix hash and the file's expected hash — beside an owner and a reason, so the line cannot be guessed at, and it applies only in a second pass: run it once with `dryRun` and hand back the `repairToken` that run returns. Writes a reclassification record into the journal."), "workspace", "workflowRecordReclassification"),
  mutationSpec("logical-delete", mcp("workflow_logical_delete", "Marks one journal record deleted without removing the line, so the history stays append-only and readers can still see what was withdrawn; `owner` must be `kiwi-pm` or `pm`, or the call is refused. Writes a deletion record into the journal `path` names, or into `kiwi/pipeline.jsonl` when `path` is left out."), "workspace", "workflowLogicalDelete"),
  // @req FR-FLOW-136 — the verification-ledger namespace: a container with no own handler plus two
  // leaves. Both leaves append to `kiwi/verification-ledger.jsonl` (`plan` writes the orphan-prune
  // record), so they carry the same "workspace" kind as the neighbouring pipeline/worklog appends.
  // CLI-only: no mcpName, so neither appears in toolNames, toolSchemas or the forwarding contract.
  readSpec("verification-ledger", undefined, "workflowVerificationLedger"),
  mutationSpec("plan", undefined, "workspace", "planVerificationRound"),
  mutationSpec("record", undefined, "workspace", "recordSectionVerified"),
  // Container command with no own handler; hosts the collision-repair "apply" tool (CLI in repair.ts).
  mutationSpec("work-order", mcp("apply_requirement_id_collision_repair", "Carries out an explicit keep/rename mapping for one duplicate Requirement ID, refusing anything the mapping does not name, and never renumbering, beautifying or bulk-editing. Writes the affected SRS documents and the reference sites the mapping lists."), "workspace", "applyRequirementIdCollisionRepair"),

  // ---- orchestrate namespace (registerOrchestrateCommands) ----
  ...orchestrateSpecs()
];

// --- derived views (projected from the registry) ---------------------------------------------------

/** Every registry spec that declares an mcpName, in registry order. */
function mcpSpecs(): ToolSpec[] {
  return toolSpecs.filter((spec): spec is ToolSpec & { mcpName: string } => typeof spec.mcpName === "string" && spec.mcpName.length > 0);
}

/** MCP tool names (the registry's mcpName subset) — the SSOT for server toolNames. */
export function renderToolNames(): string[] {
  return mcpSpecs().map((spec) => spec.mcpName as string);
}

/**
 * MCP tool input schemas keyed by mcpName. Keys are the registry's mcpName subset; the schema VALUES
 * come from server.ts `toolSchemas` (the schema SSOT), so the rendered key set always equals both the
 * registry mcpNames and the server's `toolSchemas` keys.
 */
export function renderToolSchemas(): Record<string, Record<string, z.ZodTypeAny>> {
  const out: Record<string, Record<string, z.ZodTypeAny>> = {};
  for (const spec of mcpSpecs()) {
    out[spec.mcpName as string] = (toolSchemas[spec.mcpName as string] ?? {}) as Record<string, z.ZodTypeAny>;
  }
  return out;
}

/**
 * MCP tool descriptions keyed by mcpName — the SSOT for what the server hands the SDK.
 *
 * @req FR-MCP-060. Projected from the same registry rows that supply the names and the schemas, so a
 * tool removed from the registry takes its description with it and cannot linger as an entry
 * describing something no longer registered.
 */
export function renderToolDescriptions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of mcpSpecs()) out[spec.mcpName as string] = spec.description ?? "";
  return out;
}

/** MCP tool names classified read-only, derived from the authoritative server predicate. */
export function renderReadOnlyToolNames(): string[] {
  return renderToolNames().filter((name) => isReadOnlyTool(name));
}

/** MCP tool kind keyed by mcpName, taken from each spec's kind. */
export function renderToolKinds(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of mcpSpecs()) out[spec.mcpName as string] = spec.kind;
  return out;
}

/** Full CLI command-name multiset (every registry cliName, in registry order). */
export function renderCliCommandNames(): string[] {
  return toolSpecs.map((spec) => spec.cliName);
}

/** The registry spec for a CLI command name, or undefined when the name is not registered. */
export function findSpecByCliName(cliName: string): ToolSpec | undefined {
  return toolSpecs.find((spec) => spec.cliName === cliName);
}

/** Long option name for help output: first flag token with leading dashes stripped (e.g. "dry-run"). */
function optionParamName(flag: string): string {
  const first = flag.split(/\s+/)[0] ?? flag;
  return first.replace(/^-+/, "");
}

/** A single parameter entry in a command's machine-readable help description. */
export interface CommandHelpParameter {
  readonly name: string;
  readonly kind: "positional" | "option";
}

/** A command's machine-readable help description, derived from its ToolSpec. */
export interface CommandHelpDescription {
  readonly name: string;
  readonly kind: string;
  readonly parameters: CommandHelpParameter[];
}

/**
 * Registry-derived machine-readable help for a CLI command (name + kind + parameters), or undefined
 * when the command is not in the registry. Parameters are the declared positionals (from
 * {@link ToolSpec.args}) followed by one entry per declared option and the common `--input-json`
 * option that every mutation command accepts.
 */
export function describeCommandForHelp(cliName: string): CommandHelpDescription | undefined {
  const spec = findSpecByCliName(cliName);
  if (!spec) return undefined;
  const positionals: CommandHelpParameter[] = Object.keys(spec.args).map((name) => ({ name, kind: "positional" }));
  const options: CommandHelpParameter[] = spec.options.map((option) => ({
    name: optionParamName(option.flag),
    kind: "option"
  }));
  options.push({ name: "input-json", kind: "option" });
  return { name: spec.cliName, kind: spec.kind, parameters: [...positionals, ...options] };
}

/**
 * For each MCP-exposed command, the option dests its handler forwards to its core function. Derived
 * from the registry's declared option dests, this is the authority the zero-drift forwarding contract
 * (REL-ARCH-002 AC-3/AC-4) compares against — a handler that drops a declared dest (e.g. notes/dryRun
 * for add_trace_link / add_verification_evidence) fails the contract.
 */
export function forwardedDestsByTool(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const spec of mcpSpecs()) out[spec.mcpName as string] = spec.options.map((option) => option.dest);
  return out;
}

const MUTATION_KINDS: ReadonlySet<string> = new Set(["req-scoped", "log-append", "workspace"]);

/** Optional surface overrides for {@link assertZeroDriftToolSurface}; omitted surfaces use the real ones. */
export interface ZeroDriftSurfaceOverrides {
  readonly registryMcpNames?: readonly string[];
  readonly registryCliNames?: readonly string[];
  readonly toolNames?: readonly string[];
  readonly toolSchemas?: Record<string, unknown>;
  readonly toolKinds?: Record<string, unknown>;
  readonly cliCommandNames?: readonly string[];
  readonly forwardedDests?: Record<string, readonly string[]>;
}

/**
 * Asserts the CLI/MCP command surfaces are drift-free against the ToolSpec registry authority:
 *   - every registry MCP name appears in toolNames, toolSchemas keys, and toolKinds keys,
 *   - every registry CLI name appears in the CLI registration set,
 *   - every mutation handler forwards each dest its ToolSpec declares.
 * Throws an Error naming the offending surface and command when any of these fail. Overrides inject a
 * mutated surface (or an augmented registry view) so callers can prove the check catches drift.
 */
export function assertZeroDriftToolSurface(overrides: ZeroDriftSurfaceOverrides = {}): void {
  const registryMcpNames = overrides.registryMcpNames ?? renderToolNames();
  const registryCliNames = overrides.registryCliNames ?? renderCliCommandNames();
  const toolNames = overrides.toolNames ?? renderToolNames();
  const toolSchemaKeys = Object.keys(overrides.toolSchemas ?? renderToolSchemas());
  const toolKindKeys = Object.keys(overrides.toolKinds ?? renderToolKinds());
  const cliCommandNames = overrides.cliCommandNames ?? renderCliCommandNames();
  const forwarded: Record<string, readonly string[]> = { ...forwardedDestsByTool(), ...(overrides.forwardedDests ?? {}) };

  // @req FR-MCP-060 — the description is part of the surface the zero-drift contract covers, so a
  // tool that reaches the registry without one fails here rather than at the moment an agent picks
  // the wrong neighbour because neither of them said anything.
  const descriptions = renderToolDescriptions();

  for (const name of registryMcpNames) {
    if (!toolNames.includes(name)) {
      throw new Error(`zero-drift: toolNames is missing registry MCP tool '${name}'`);
    }
    if ((descriptions[name] ?? "").trim().length === 0) {
      throw new Error(`zero-drift: registry MCP tool '${name}' has no description`);
    }
    if (!toolSchemaKeys.includes(name)) {
      throw new Error(`zero-drift: toolSchemas is missing registry MCP tool '${name}'`);
    }
    if (!toolKindKeys.includes(name)) {
      throw new Error(`zero-drift: toolKinds is missing registry MCP tool '${name}'`);
    }
  }

  for (const name of registryCliNames) {
    if (!cliCommandNames.includes(name)) {
      throw new Error(`zero-drift: CLI registration (cliCommandNames) is missing registry command '${name}'`);
    }
  }

  for (const spec of toolSpecs) {
    if (!spec.mcpName || !MUTATION_KINDS.has(spec.kind)) continue;
    const declaredDests = spec.options.map((option) => option.dest);
    const forwardedDests = forwarded[spec.mcpName] ?? [];
    for (const dest of declaredDests) {
      if (!forwardedDests.includes(dest)) {
        throw new Error(
          `zero-drift: mutation handler '${spec.mcpName}' drops declared option dest '${dest}' (option-forwarding contract)`
        );
      }
    }
  }
}

export const toolNames = [
  "list_requirements",
  "get_requirement",
  "validate_spec",
  "summarize_target",
  "get_active_target",
  "list_completed_work",
  "update_status",
  "check_acceptance_criteria",
  "add_verification_evidence",
  "add_trace_link",
  "set_active_target",
  "add_completed_work",
  "add_requirement",
  "init_project"
] as const;
