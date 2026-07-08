import { z } from "zod";
import { isReadOnlyTool, toolSchemas } from "./server.js";

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

/** A single command's full metadata. `mcpName` is present only for MCP-exposed commands. */
export interface ToolSpec {
  readonly cliName: string;
  readonly mcpName?: string | undefined;
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
 * A read-only command (kind "read"); pass mcpName=undefined for CLI-only commands. The mcpName key is
 * always present (value undefined for CLI-only) so every spec declares the field.
 */
function readSpec(cliName: string, mcpName: string | undefined, coreFn: string, extra: SpecExtra = {}): ToolSpec {
  return {
    cliName,
    mcpName,
    kind: "read",
    args: extra.args ?? {},
    options: extra.options ?? [],
    coreFn,
    resultExitMap: extra.resultExitMap ?? { ok: 0, fail: 1 }
  };
}

/**
 * A mutation command; pass mcpName=undefined for CLI-only mutation commands. The mcpName key is always
 * present (value undefined for CLI-only) so every spec declares the field.
 */
function mutationSpec(
  cliName: string,
  mcpName: string | undefined,
  kind: Exclude<ToolKind, "read">,
  coreFn: string,
  options: readonly ToolOptionSpec[] = []
): ToolSpec {
  return {
    cliName,
    mcpName,
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

export const toolSpecs: readonly ToolSpec[] = [
  // ---- read commands (registerReadCommands) ----
  readSpec("validate", "validate_spec", "validateWorkspace", {
    args: { strict: { type: "boolean", optional: true }, failOnWarning: { type: "boolean", optional: true } },
    resultExitMap: { ok: 0, fail: 1 }
  }),
  readSpec("extract", undefined, "extractRequirements"),
  readSpec("list", "list_requirements", "listRequirements"),
  readSpec("search", "search_requirements", "searchRequirements", { args: { query: { type: "string" } } }),
  readSpec("show", "get_requirement", "getRequirement", { args: { id: { type: "string" } } }),
  readSpec("targets", undefined, "listTargets"),
  readSpec("active-target", "get_active_target", "getActiveTarget"),
  readSpec("completed-work", "list_completed_work", "listCompletedWork"),
  readSpec("completed-work-migration-plan", undefined, "planCompletedWorkMigration"),
  // Container command with no own handler; hosts the MCP workspace-info probe (no dedicated CLI).
  readSpec("workflow", "mcp_workspace_info", "mcpWorkspaceInfo"),
  readSpec("workspace", "workflow_workspace_info", "workflowWorkspaceInfo"),
  readSpec("artifacts", "workflow_artifacts_list", "workflowArtifactsList"),
  readSpec("latest", "workflow_latest_artifact", "workflowLatestArtifact"),
  readSpec("resolve", "workflow_resolve_artifact", "workflowResolveArtifact"),
  readSpec("plan-status", "workflow_plan_status", "workflowPlanStatus"),
  readSpec("plan-task", "workflow_plan_task", "workflowPlanTask", { args: { taskId: { type: "string" } } }),
  readSpec("next-task", "workflow_next_plan_task", "workflowNextPlanTask"),
  readSpec("doctor", "workflow_doctor", "workflowDoctor"),
  readSpec("diff", "workflow_diff", "workflowDiff"),
  readSpec("schema-check", "workflow_schema_check", "workflowSchemaCheck"),
  readSpec("pipeline-status", "workflow_pipeline_status", "workflowPipelineStatus"),
  readSpec("pipeline-tail", "workflow_pipeline_tail", "workflowPipelineTail"),
  readSpec("pipeline-next", "workflow_pipeline_next", "workflowPipelineNext"),
  readSpec("pipeline-compact", "workflow_pipeline_compact", "workflowPipelineCompact"),
  // Container command with no own handler; hosts the collision-repair "plan" tool (CLI in repair.ts).
  readSpec("pipeline", "plan_requirement_id_collision_repair", "planRequirementIdCollisionRepair"),
  // `pipeline status/tail/compact` aliases: CLI-only reads, except `status`/`tail` also host the v3
  // compatibility-check refresh/revoke MCP tools (no dedicated CLI of their own).
  mutationSpec("status", "refresh_compatibility_check", "req-scoped", "refreshCompatibilityCheck", [DRY_RUN]),
  mutationSpec("tail", "revoke_compatibility_check", "req-scoped", "revokeCompatibilityCheck", [DRY_RUN]),
  readSpec("compact", undefined, "workflowPipelineCompactAlias"),
  readSpec("session-status", "workflow_session_status", "workflowSessionStatus"),
  readSpec("resume-hint", "workflow_resume_hint", "workflowResumeHint"),
  readSpec("worklog-tail", "workflow_worklog_tail", "workflowWorklogTail"),
  readSpec("migrate-preview", "preview_legacy_workflow_migration", "previewLegacyWorkflowMigration"),
  readSpec("next", "get_next_work_order", "getNextWorkOrder"),
  readSpec("scopes", undefined, "listScopes"),
  readSpec("summary", "summarize_target", "summarizeTarget"),
  readSpec("explain", undefined, "explainDiagnostic", { args: { code: { type: "string" } } }),
  readSpec("mode", undefined, "workMode", { args: { value: { type: "string", optional: true } } }),
  // Container command with no own handler; hosts the v3 add-compatibility-check MCP tool.
  mutationSpec("vibe-gate", "add_compatibility_check", "req-scoped", "addCompatibilityCheck", [DRY_RUN]),
  // vibe-gate check: CLI-only gate leaf (duplicate cliName "check" — see links check below).
  readSpec("check", undefined, "vibeGateCheck"),
  readSpec("changed-since", undefined, "changedSince", { args: { date: { type: "string" } } }),
  readSpec("stale", undefined, "staleRequirements"),
  readSpec("history", undefined, "requirementHistory", { args: { id: { type: "string" } } }),
  readSpec("attention", undefined, "attentionQueue"),
  readSpec("commands", undefined, "renderCommandCatalog"),
  // Container command with no own handler; hosts the collision-repair "diagnose" tool (CLI in repair.ts).
  readSpec("links", "diagnose_requirement_id_collisions", "diagnoseRequirementIdCollisions"),
  readSpec("check", undefined, "checkLinks"),
  // Container command with no own handler; hosts the v3 list-steps MCP tool. `step validate` (below) is
  // the second `validate` node and carries the validate_step MCP tool.
  readSpec("step", "list_steps", "listSteps"),
  readSpec("validate", "validate_step", "validateWorkspaceScoped", { args: { step: { type: "string" } } }),
  readSpec("release-readiness", undefined, "summarizeReleaseReadiness"),
  readSpec("coverage", "list_dirty_edges", "listDirtyEdges"),
  readSpec("rtm", "list_compat_edges", "listCompatEdges"),

  // ---- mutation commands (registerMutationCommands) ----
  mutationSpec("init", "init_project", "workspace", "initProject", [
    opt("--target <target>", "target"),
    opt("--scope <scope>", "scope"),
    opt("--force", "force"),
    IGNORE_LOCK
  ]),
  mutationSpec("sync-index", "sync_index", "workspace", "syncIndexRollups", [
    opt("--expected-sha256 <sha>", "expectedSha256"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("update-status", "update_status", "req-scoped", "updateStatus", [
    opt("--reason <text>", "reason"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("update-stability", "update_stability", "req-scoped", "updateStability", [
    opt("--reason <text>", "reason"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("append-note", "append_section_note", "req-scoped", "appendSectionNote", [
    opt("--section <section>", "section"),
    opt("--text <text>", "text"),
    opt("--mode <mode>", "mode"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("edit-requirement", "edit_requirement_fields", "req-scoped", "updateRequirementFields", [
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
  mutationSpec("replace-acceptance-criteria", "replace_acceptance_criteria", "req-scoped", "replaceAcceptanceCriteria", [
    opt("--items <json>", "items", { encoding: "json" }),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("edit-requirement-table-rows", "edit_requirement_table_rows", "req-scoped", "editRequirementTableRows", [
    opt("--section <section>", "section"),
    opt("--operations <json>", "operations", { encoding: "json" }),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("set-active-target", "set_active_target", "workspace", "setActiveTarget", [
    opt("--create", "create"),
    opt("--type <type>", "type"),
    opt("--description <text>", "description"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("set-target-goal", "set_target_goal", "workspace", "setTargetGoal", [
    opt("--goal <text>", "goal"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-completed-work", "add_completed_work", "log-append", "addCompletedWork", [
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
  mutationSpec("check-ac", "check_acceptance_criteria", "req-scoped", "setAcceptanceCriteriaChecked", [
    opt("--all", "all"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("uncheck-ac", undefined, "req-scoped", "setAcceptanceCriteriaChecked", [
    opt("--all", "all"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-evidence", "add_verification_evidence", "req-scoped", "addVerificationEvidence", [
    opt("--type <type>", "type"),
    opt("--reference <reference>", "reference"),
    opt("--covers <covers>", "covers"),
    opt("--notes <notes>", "notes"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-trace", "add_trace_link", "req-scoped", "addTraceLink", [
    opt("--type <type>", "type"),
    opt("--reference <reference>", "reference"),
    opt("--relation <relation>", "relation"),
    opt("--notes <notes>", "notes"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("add-requirement", "add_requirement", "workspace", "addRequirement", [
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
  mutationSpec("update-statement", "update_requirement_statement", "req-scoped", "updateRequirementStatement", [
    opt("--text <text>", "text"),
    DRY_RUN,
    IGNORE_LOCK
  ]),
  mutationSpec("edit-ac", "edit_acceptance_criteria", "req-scoped", "editAcceptanceCriteria", [
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
  mutationSpec("supersede", "supersede_requirement", "workspace", "supersedeRequirement", [
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
  // set-supersede: real CLI mutation; also hosts the v3 claim_step MCP tool (no dedicated CLI).
  mutationSpec("set-supersede", "claim_step", "workspace", "setSupersede", [
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
  mutationSpec("sync-counts", undefined, "workspace", "syncCounts", [
    opt("--apply", "apply"),
    opt("--check", "check")
  ]),
  // scaffold-scope: real CLI mutation; also hosts the v3 update_step_state MCP tool (no dedicated CLI).
  mutationSpec("scaffold-scope", "update_step_state", "workspace", "scaffoldScope", [
    opt("--apply", "apply"),
    DRY_RUN
  ]),
  // register-scopes: real CLI mutation; also hosts the v3 promote_step_requirement MCP tool.
  mutationSpec("register-scopes", "promote_step_requirement", "req-scoped", "registerScopes", [
    opt("--apply", "apply"),
    DRY_RUN
  ]),

  // ---- workflow mutation commands (registerReadCommands, under `workflow`) ----
  mutationSpec("task-check", "workflow_task_check", "workspace", "workflowTaskCheck"),
  mutationSpec("task-uncheck", "workflow_task_uncheck", "workspace", "workflowTaskUncheck"),
  mutationSpec("checklist-set", "workflow_checklist_set", "workspace", "workflowChecklistSet"),
  mutationSpec("task-status-set", "workflow_task_status_set", "workspace", "workflowTaskStatusSet"),
  mutationSpec("pipeline-emit", "workflow_pipeline_emit", "workspace", "workflowPipelineEmit"),
  mutationSpec("worklog-emit", "workflow_worklog_emit", "workspace", "workflowWorklogEmit"),
  mutationSpec("repair-record", "workflow_repair_record", "workspace", "workflowRepairRecord"),
  mutationSpec("logical-delete", "workflow_logical_delete", "workspace", "workflowLogicalDelete"),
  // Container command with no own handler; hosts the collision-repair "apply" tool (CLI in repair.ts).
  mutationSpec("work-order", "apply_requirement_id_collision_repair", "workspace", "applyRequirementIdCollisionRepair")
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

  for (const name of registryMcpNames) {
    if (!toolNames.includes(name)) {
      throw new Error(`zero-drift: toolNames is missing registry MCP tool '${name}'`);
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
