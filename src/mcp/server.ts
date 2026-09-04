import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { access, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { TARGET_TYPES } from "../core/target-types.js";
import { initProject } from "../core/bootstrap/init-project.js";
import { REPORT_PATH_TOKEN_REGEX } from "../core/completed-work/report-paths.js";
import type { ProjectRoot } from "../core/types.js";
import { createTestMcpServer, type McpDependencies, type McpRootSource, type McpServerHandle } from "./adapter.js";
import { getServerMetadata, type PackageInfo } from "./metadata.js";
// @req FR-MCP-060 — imported for its side-effect-free projection only, and read inside a function
// body: `schemas.ts` imports this module back for `toolSchemas` and `isReadOnlyTool`, so a top-level
// read here would run against a half-initialised module.
import { renderToolDescriptions } from "./schemas.js";
import { orchestrateAcceptsWorkspaceRoot, registerReadTools } from "./tools/read-tools.js";
import { registerMutationTools } from "./tools/mutation-tools.js";
import { registerResources } from "./resources.js";
import { ORCHESTRATE_TOOL_BINDINGS } from "../cli/commands/orchestrate.js";

// IR-CLI-045 / REL-MCP-004: MCP 서버 기동 표면은 root 파라미터를 노출하지 않는다 (cwd discovery 전용).
export interface McpServerOptions {
  transport?: "stdio";
}

const requirePackage = createRequire(import.meta.url);
const MCP_SERVER_METADATA = getServerMetadata(requirePackage("../../package.json") as PackageInfo);

export function createMcpServer(deps: McpDependencies): McpServerHandle {
  const server = createTestMcpServer(deps);
  registerReadTools(server, deps);
  registerMutationTools(server, deps);
  registerResources(server, deps);
  return server;
}

/**
 * The per-call workspace root. Optional everywhere it appears: omitting it reproduces the startup
 * root behaviour exactly, so the argument is additive. @req REL-MCP-005 / FR-MCP-058 AC-1
 */
const WORKSPACE_ROOT_SCHEMA = z
  .string()
  .describe("absolute path of a git top level that is a worktree of the MCP server's own repository")
  .optional();

const reportPathSchema = z
  .string()
  .trim()
  .min(1)
  .regex(REPORT_PATH_TOKEN_REGEX, { message: "invalid report path" })
  .describe("repository-relative POSIX report path; no absolute paths, traversal, URL schemes, backslash, pipe, comma, newline, or #");

/**
 * The `orchestrate_*` input schemas, derived from the CLI bindings so a tool cannot declare a field
 * the command does not accept. A `selector` becomes a closed enum over the leaves the row admits.
 * @req IR-MCP-003
 */
function orchestrateToolSchemas(): Record<string, Record<string, z.ZodTypeAny>> {
  const out: Record<string, Record<string, z.ZodTypeAny>> = {};
  for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
    const shape: Record<string, z.ZodTypeAny> = {};
    // @req FR-MCP-059 — derived from the same declaration the registration gate reads, so the
    // schema and the gate cannot disagree about which rows take a per-call root.
    if (orchestrateAcceptsWorkspaceRoot(binding.tool)) shape.workspaceRoot = WORKSPACE_ROOT_SCHEMA;
    if (binding.selector) {
      shape[binding.selector.dest] = z.enum(binding.selector.values as [string, ...string[]]).optional();
    }
    for (const option of binding.options) {
      const base =
        option.encoding === "boolean" ? z.boolean()
          : option.encoding === "array" ? z.array(z.string())
            : option.encoding === "json" ? z.union([z.string(), z.record(z.string(), z.unknown())])
              : z.string();
      shape[option.dest] = option.required ? base : base.optional();
    }
    out[binding.tool] = shape;
  }
  return out;
}

export const toolSchemas: Record<string, Record<string, z.ZodTypeAny>> = {
  mcp_workspace_info: {},
  list_requirements: {
    target: z.string().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    scope: z.string().optional(),
    tag: z.string().optional(),
    stability: z.string().optional(),
    priority: z.string().optional(),
    missingEvidence: z.boolean().optional(),
    relatedDoc: z.string().optional(),
    evidenceReference: z.string().optional(),
    traceReference: z.string().optional(),
    newWorkCandidate: z.boolean().optional(),
    projection: z.enum(["ids", "compact", "full"]).optional(),
    fields: z.array(z.string()).or(z.string()).optional(),
    includeMarkdown: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional()
  },
  search_requirements: {
    query: z.string(),
    target: z.string().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    scope: z.string().optional(),
    tag: z.string().optional(),
    stability: z.string().optional(),
    priority: z.string().optional(),
    missingEvidence: z.boolean().optional(),
    relatedDoc: z.string().optional(),
    evidenceReference: z.string().optional(),
    traceReference: z.string().optional(),
    newWorkCandidate: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional()
  },
  get_requirement: { id: z.string(), includeMarkdown: z.boolean().optional() },
  validate_spec: { strict: z.boolean().optional(), failOnWarning: z.boolean().optional() },
  summarize_target: { target: z.string().optional() },
  get_active_target: {},
  list_completed_work: {
    target: z.string().optional(),
    scope: z.string().optional(),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    order: z.enum(["latest", "file"]).optional()
  },
  diagnose_requirement_id_collisions: { dryRun: z.boolean().optional() },
  plan_requirement_id_collision_repair: {
    duplicateId: z.string(),
    keep: z.object({ filePath: z.string(), headingLine: z.number().int().positive(), blockHash: z.string() }),
    rename: z.object({ filePath: z.string(), headingLine: z.number().int().positive(), blockHash: z.string() }),
    replacementId: z.string().optional(),
    allocationStrategy: z.enum(["next_available"]).optional(),
    referenceEdits: z.array(z.object({ filePath: z.string(), line: z.number().int().positive(), from: z.string(), to: z.string() })).optional(),
    dryRun: z.boolean().optional()
  },
  workflow_workspace_info: { workspaceRoot: WORKSPACE_ROOT_SCHEMA },
  workflow_artifacts_list: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    kind: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_latest_artifact: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    kind: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_resolve_artifact: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    kind: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_plan_status: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_plan_task: {
    taskId: z.string(),
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_next_plan_task: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_doctor: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    allowAmbiguous: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_diff: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    allowAmbiguous: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_schema_check: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    allowAmbiguous: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_pipeline_status: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional(), workspaceRoot: WORKSPACE_ROOT_SCHEMA },
  workflow_pipeline_tail: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional(), workspaceRoot: WORKSPACE_ROOT_SCHEMA },
  workflow_pipeline_next: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional(), workspaceRoot: WORKSPACE_ROOT_SCHEMA },
  workflow_pipeline_compact: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional(), workspaceRoot: WORKSPACE_ROOT_SCHEMA },
  workflow_session_status: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeBody: z.boolean().optional(), workspaceRoot: WORKSPACE_ROOT_SCHEMA },
  workflow_resume_hint: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), workspaceRoot: WORKSPACE_ROOT_SCHEMA },
  workflow_worklog_tail: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional(), workspaceRoot: WORKSPACE_ROOT_SCHEMA },
  preview_legacy_workflow_migration: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    includeBody: z.boolean().optional(),
    apply: z.boolean().optional(),
    write: z.boolean().optional(),
    fix: z.boolean().optional(),
    normalize: z.boolean().optional(),
    migrate: z.boolean().optional(),
    // @req FR-MCP-063 AC-4 — this declaration is the one place the advertised schema and the
    // registration gate disagree: the tool is registered without `workspaceScope`, so the gate
    // refuses what this line advertises. It stays, and the reason is recorded rather than fixed
    // here. Removing it drops the declared-argument total from 564 to 563, and 564 is a floor in
    // FR-FLOW-162 AC-1 and in that verified requirement's own text. Giving the tool the argument
    // for real is the other repair and it moves the accepting family from 51 to 52, which this
    // requirement does not decide. FR-MCP-063 AC-4 holds the difference set to exactly this name,
    // so a second disagreement reddens.
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  get_next_work_order: {
    target: z.string().optional(),
    path: z.string().optional(),
    runId: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional(),
    measure: z.boolean().optional(),
    pipelinePath: z.string().optional(),
    explain: z.boolean().optional(),
    profile: z.enum(["default", "compact", "explain"]).optional(),
    contextProfile: z.enum(["default", "compact"]).optional()
  },
  sync_index: { expectedSha256: z.string().optional(), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() },
  // FR-MCP-056 — scope creation and registration over MCP.
  scaffold_scope: {
    name: z.string(),
    prefix: z.string(),
    apply: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  register_scopes: { apply: z.boolean().optional(), dryRun: z.boolean().optional() },
  update_status: { id: z.string(), status: z.string(), reason: z.string().max(500).optional(), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() },
  update_stability: {
    id: z.string(),
    stability: z.enum(["draft", "evolving", "stable", "frozen", "deprecated"]),
    reason: z.string().max(500).optional(),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  append_section_note: {
    id: z.string(),
    section: z.string(),
    text: z.string().max(500),
    mode: z.enum(["append", "replace"]).optional(),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  edit_requirement_fields: {
    id: z.string(),
    title: z.string().optional(),
    statement: z.string().optional(),
    priority: z.string().optional(),
    risk: z.string().optional(),
    tags: z.array(z.string()).optional(),
    relatedDocs: z.array(z.string()).optional(),
    verificationMethod: z.string().optional(),
    githubIssue: z.string().optional(),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  replace_acceptance_criteria: {
    id: z.string(),
    items: z.array(z.object({ text: z.string(), checked: z.boolean().optional() })),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  edit_requirement_table_rows: {
    id: z.string(),
    section: z.enum(["verification_evidence", "trace_links"]),
    operations: z.array(z.object({ kind: z.enum(["update", "delete"]), rowId: z.string().optional(), rowIndex: z.number().int().nonnegative().optional(), values: z.record(z.string(), z.string()).optional() })),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  check_acceptance_criteria: { id: z.string(), acIds: z.array(z.string()), checked: z.boolean(), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() },
  add_verification_evidence: { id: z.string(), type: z.string(), reference: z.string(), covers: z.string().optional(), notes: z.string().optional(), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() },
  add_trace_link: { id: z.string(), type: z.string(), reference: z.string(), relation: z.string(), notes: z.string().optional(), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() },
  set_active_target: {
    target: z.string(),
    create: z.boolean().optional(),
    type: z.enum(TARGET_TYPES).optional(),
    description: z.string().optional(),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  set_target_goal: { target: z.string(), goal: z.string().min(1).max(500), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() },
  add_completed_work: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    summary: z.string(),
    target: z.string().optional(),
    scope: z.string().optional(),
    requirementIds: z.array(z.string()).optional(),
    reportPaths: z.array(reportPathSchema).optional(),
    allowIncomplete: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  add_requirement: {
    type: z.string(),
    scope: z.string(),
    target: z.string().optional(),
    title: z.string(),
    requirement: z.string(),
    statement: z.string().optional(),
    acceptanceCriteria: z.array(z.string()),
    checkedAcceptanceCriteria: z.array(z.string()).optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    tags: z.array(z.string()).optional(),
    risk: z.string().optional(),
    stability: z.string().optional(),
    verificationMethod: z.string().optional(),
    githubIssue: z.string().optional(),
    relatedDocs: z.array(z.string()).optional(),
    rationale: z.string().optional(),
    implementationNotes: z.string().optional(),
    research: z.string().optional(),
    changeNotes: z.string().optional(),
    evidence: z.array(z.record(z.string(), z.unknown())).optional(),
    trace: z.array(z.record(z.string(), z.unknown())).optional(),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  init_project: {
    target: z.string().optional(),
    scope: z.string().optional(),
    force: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  workflow_task_check: {
    runId: z.string(),
    taskId: z.string(),
    path: z.string(),
    owner: z.string().optional(),
    reqId: z.string().optional(),
    reason: z.string().optional(),
    expectedSha256: z.string().optional(),
    idempotencyKey: z.string().optional(),
    dryRun: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_task_uncheck: {
    runId: z.string(),
    taskId: z.string(),
    path: z.string(),
    owner: z.string().optional(),
    reqId: z.string().optional(),
    reason: z.string().optional(),
    expectedSha256: z.string().optional(),
    idempotencyKey: z.string().optional(),
    dryRun: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_checklist_set: {
    runId: z.string(),
    taskId: z.string(),
    path: z.string(),
    checked: z.boolean(),
    owner: z.string().optional(),
    reqId: z.string().optional(),
    reason: z.string().optional(),
    expectedSha256: z.string().optional(),
    idempotencyKey: z.string().optional(),
    dryRun: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_task_status_set: {
    runId: z.string(),
    taskId: z.string(),
    pmStatePath: z.string(),
    status: z.string(),
    owner: z.string().optional(),
    reqId: z.string().optional(),
    reason: z.string().optional(),
    expectedSha256: z.string().optional(),
    idempotencyKey: z.string().optional(),
    dryRun: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_pipeline_emit: {
    runId: z.string(),
    path: z.string().optional(),
    event: z.record(z.string(), z.unknown()),
    owner: z.string().optional(),
    reqId: z.string().optional(),
    reason: z.string().optional(),
    expectedSha256: z.string().optional(),
    idempotencyKey: z.string().optional(),
    dryRun: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_worklog_emit: {
    runId: z.string(),
    path: z.string().optional(),
    event: z.record(z.string(), z.unknown()),
    owner: z.string().optional(),
    taskId: z.string().optional(),
    reqId: z.string().optional(),
    reason: z.string().optional(),
    expectedSha256: z.string().optional(),
    idempotencyKey: z.string().optional(),
    dryRun: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_repair_record: {
    runId: z.string(),
    path: z.string().optional(),
    event: z.record(z.string(), z.unknown()),
    owner: z.string().optional(),
    taskId: z.string().optional(),
    reqId: z.string().optional(),
    reason: z.string().optional(),
    expectedSha256: z.string().optional(),
    idempotencyKey: z.string().optional(),
    dryRun: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_record_reclassification: {
    runId: z.string().refine((value) => value.trim().length > 0, { message: "runId must not be blank" }),
    path: z.string().refine((value) => value.trim().length > 0, { message: "path must not be blank" }).optional(),
    recordType: z.enum(["pipeline", "worklog"]),
    line: z.number().int().positive(),
    byteOffset: z.number().int().nonnegative(),
    rawSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    eventKey: z.string().min(1),
    targetRunId: z.string().min(1),
    preimagePrefixSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    owner: z.string().refine((value) => value.trim().length > 0, { message: "owner must not be blank" }),
    reason: z.string().refine((value) => value.trim().length > 0, { message: "reason must not be blank" }),
    taskId: z.string().min(1).optional(),
    reqId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
    repairToken: z.string().min(1).optional(),
    dryRun: z.boolean(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  workflow_logical_delete: {
    runId: z.string(),
    path: z.string().optional(),
    recordType: z.string(),
    recordId: z.string(),
    owner: z.string().optional(),
    taskId: z.string().optional(),
    reqId: z.string().optional(),
    reason: z.string(),
    expectedSha256: z.string().optional(),
    idempotencyKey: z.string().optional(),
    dryRun: z.boolean().optional(),
    workspaceRoot: WORKSPACE_ROOT_SCHEMA
  },
  apply_requirement_id_collision_repair: {
    duplicateId: z.string(),
    keep: z.object({ filePath: z.string(), headingLine: z.number().int().positive(), blockHash: z.string() }),
    rename: z.object({ filePath: z.string(), headingLine: z.number().int().positive(), blockHash: z.string() }),
    replacementId: z.string().optional(),
    allocationStrategy: z.enum(["next_available"]).optional(),
    referenceEdits: z.array(z.object({ filePath: z.string(), line: z.number().int().positive(), from: z.string(), to: z.string() })).optional(),
    dryRun: z.boolean().optional(),
    ignoreLock: z.boolean().optional()
  },
  // FR-MCP-040 — step-scoped validation read tool.
  validate_step: { step: z.string() },
  // FR-MCP-041 — compatibility-check mutation tools and edge read tools.
  add_compatibility_check: { aReqId: z.string(), bReqId: z.string(), dryRun: z.boolean().optional() },
  refresh_compatibility_check: { aReqId: z.string(), bReqId: z.string(), dryRun: z.boolean().optional() },
  revoke_compatibility_check: { aReqId: z.string(), bReqId: z.string(), dryRun: z.boolean().optional() },
  list_dirty_edges: { target: z.string().optional() },
  list_compat_edges: { target: z.string().optional() },
  // FR-MCP-023 — statement and acceptance-criteria gap mutation tools.
  // FR-MCP-042 — step-state tools (claim/update are mutations, list_steps is read-only).
  claim_step: {
    step: z.string(),
    touchesScope: z.string(),
    touchesReq: z.array(z.string()),
    force: z.boolean().optional(),
    supersede: z.string().optional(),
    dryRun: z.boolean().optional()
  },
  update_step_state: { step: z.string(), status: z.string().optional(), dependsOn: z.string().optional(), acknowledged: z.boolean().optional(), dryRun: z.boolean().optional() },
  list_steps: { step: z.string().optional(), target: z.string().optional() },
  // FR-MCP-053 — step SRS synthesis mutation tool (forwards to the FR-NODE-041/073 core engine).
  synthesize_step_srs: { task: z.string(), dryRun: z.boolean().optional() },
  // FR-NODE-080/FR-NODE-081 — SDS stub scaffold and lifecycle-status mutation tools.
  scaffold_step: { task: z.string(), target: z.string().optional(), dryRun: z.boolean().optional() },
  set_sds_status: { task: z.string(), status: z.string(), dryRun: z.boolean().optional() },
  // FR-MCP-052 — work-mode tools (get_work_mode is read-only; set_work_mode is a workspace mutation).
  get_work_mode: {},
  set_work_mode: { mode: z.string(), activeTask: z.string().optional(), dryRun: z.boolean().optional() },
  // FR-MCP-054 — read-only synthesis-presence gate probe (mirrors `speckiwi vibe-gate check`).
  check_vibe_gate: {},
  // FR-MCP-043 — supersede and promote mutation tools.
  supersede_requirement: {
    oldId: z.string(),
    scope: z.string(),
    target: z.string(),
    title: z.string(),
    statement: z.string(),
    acceptanceCriteria: z.array(z.string()),
    // FR-NODE-176 — the successor's type decides its ID prefix; optional so an existing caller that
    // sends none keeps minting the `functional` successor it always did.
    type: z.string().optional(),
    successorId: z.string().optional(),
    reason: z.string().optional(),
    dryRun: z.boolean().optional()
  },
  promote_step_requirement: { id: z.string(), fromStep: z.string(), toScope: z.string(), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() },
  ...orchestrateToolSchemas()
};

/**
 * The two keys the registration gate in `adapter.ts` decides by.
 *
 * Neither is a tool argument — no handler reads either — so neither appears in any tool's declared
 * shape, and a zod object deletes what its shape does not declare. That deletion is what made the
 * gate unreachable over the protocol: it tests `"workspaceRoot" in input`, and the SDK had already
 * removed the key by the time the wrapper ran. @req FR-MCP-063
 */
const GATE_PATH_KEYS: ReadonlySet<string> = new Set(["root", "workspaceRoot"]);

/**
 * The schema the SDK validates one tool's arguments with.
 *
 * The catchall is the whole difference: `toolSchemas[name]` handed over as a raw shape becomes a
 * stripping object, and with the catchall the gate's keys survive to the gate instead. What the
 * catchall additionally lets through is dropped again by {@link narrowToDeclaredAndGateKeys}, so a
 * handler is handed exactly what it was handed before plus the two keys the gate judges.
 * @req FR-MCP-063 AC-5
 */
export function sdkToolInputSchema(name: string): z.ZodTypeAny {
  return z.object(toolSchemas[name] ?? {}).catchall(z.unknown());
}

/**
 * Whether one tool's shape declares this argument.
 *
 * `hasOwnProperty.call`, not `key in declared`: a shape is an ordinary object literal, so `in` walks
 * `Object.prototype` and answers true for each of the eleven data properties it carries —
 * `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `constructor`,
 * `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString` and
 * `valueOf`. All eleven would then pass the narrow and reach the handler — a widening this seam
 * introduces and the old wiring did not have, because the stripping object deleted them. Measured:
 * with `in`, `list_requirements` was handed `["limit","toString","constructor","hasOwnProperty"]`
 * where the old wiring handed `["limit"]`.
 * `route.ts` guards the same map lookup the same way for the same reason, as do eight other sites.
 * @req FR-MCP-063 AC-3
 */
function declaresArgument(declared: Record<string, z.ZodTypeAny>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(declared, key);
}

/**
 * The arguments one tool is handed: what its own shape declares, plus the gate's keys when the
 * caller sent them. @req FR-MCP-063 AC-3
 */
function narrowToDeclaredAndGateKeys(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const declared = toolSchemas[name] ?? {};
  const narrowed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (declaresArgument(declared, key) || GATE_PATH_KEYS.has(key)) narrowed[key] = value;
  }
  return narrowed;
}

const ORCHESTRATE_READ_TOOLS: readonly string[] = ORCHESTRATE_TOOL_BINDINGS
  .filter((binding) => binding.kind === "read")
  .map((binding) => binding.tool);

export function isReadOnlyTool(name: string): boolean {
  if (ORCHESTRATE_READ_TOOLS.includes(name)) return true;
  return [
    "list_requirements",
    "mcp_workspace_info",
    "search_requirements",
    "get_requirement",
    "validate_spec",
    "summarize_target",
    "get_active_target",
    "list_completed_work",
    "diagnose_requirement_id_collisions",
    "plan_requirement_id_collision_repair",
    "workflow_workspace_info",
    "workflow_artifacts_list",
    "workflow_latest_artifact",
    "workflow_resolve_artifact",
    "workflow_plan_status",
    "workflow_plan_task",
    "workflow_next_plan_task",
    "workflow_doctor",
    "workflow_diff",
    "workflow_schema_check",
    "workflow_pipeline_status",
    "workflow_pipeline_tail",
    "workflow_pipeline_next",
    "workflow_pipeline_compact",
    "workflow_session_status",
    "workflow_resume_hint",
    "workflow_worklog_tail",
    "preview_legacy_workflow_migration",
    "get_next_work_order",
    "validate_step",
    "list_dirty_edges",
    "list_compat_edges",
    "list_steps",
    "get_work_mode",
    "check_vibe_gate"
  ].includes(name);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSrsRootFrom(start: string): Promise<string | null> {
  const home = await realpath(os.homedir()).catch(() => path.resolve(os.homedir()));
  let current = path.resolve(start);
  for (;;) {
    const resolvedCurrent = await realpath(current).catch(() => current);
    if (resolvedCurrent === home) return null;
    const indexPath = path.join(current, "docs", "spec", "00.index.md");
    const hasIndex = await access(indexPath).then(() => true).catch(() => false);
    if (hasIndex) {
      return resolvedCurrent;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function resolveMcpStartupRoot(): Promise<ProjectRoot> {
  const cwd = await realpath(process.cwd()).catch(() => path.resolve(process.cwd()));
  const srsRoot = await findSrsRootFrom(process.cwd());
  return { root: srsRoot ?? cwd };
}

/**
 * The startup root, plus how it came to exist. @req REL-MCP-005 AC-2 — `auto-init` is a source a
 * caller may be told about, so it has to be carried rather than inferred by the reader.
 */
export async function ensureMcpStartupWorkspace(): Promise<ProjectRoot & { rootSource: McpRootSource }> {
  const root = await resolveMcpStartupRoot();
  const indexPath = path.join(root.root, "docs", "spec", "00.index.md");
  if (await exists(indexPath)) return { ...root, rootSource: "server-cwd-discovery" };
  const result = await initProject(root, {});
  if (!result.ok) {
    throw new Error(result.error?.message ?? "MCP workspace initialization failed");
  }
  return { ...root, rootSource: "auto-init" };
}

/**
 * Builds the SDK server the stdio entry point connects, with every tool and resource registered.
 *
 * Split out of {@link startMcpServer} so the registered surface can be listed over the protocol
 * without spawning a process: what `tools/list` returns is decided here, and a check that reads the
 * registry instead would not notice this loop dropping a field. @req FR-MCP-060
 *
 * Each tool's description is projected from the `ToolSpec` registry, and a registered name the
 * registry does not describe throws rather than registering undescribed — an agent choosing between
 * two tools reads the description, and a missing one is invisible until the wrong one is called.
 *
 * `title` is deliberately not passed: the MCP specification uses `name` for display when `title` is
 * absent, which the SDK's own `getDisplayName` implements, so a title equal to the name is a hundred
 * repetitions of a value the client already holds.
 */
export function createSdkServer(local: McpServerHandle): McpServer {
  const sdk = new McpServer(MCP_SERVER_METADATA);
  const descriptions = renderToolDescriptions();
  for (const [name, handler] of Object.entries(local.tools).filter(([name]) => !name.startsWith("resource:"))) {
    const description = descriptions[name];
    if (description === undefined || description.trim().length === 0) {
      throw new Error(`MCP tool '${name}' is not described by the ToolSpec registry, so it cannot be registered`);
    }
    sdk.registerTool(name, {
      description,
      inputSchema: sdkToolInputSchema(name),
      annotations: { readOnlyHint: isReadOnlyTool(name) }
    }, async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await handler(narrowToDeclaredAndGateKeys(name, input as Record<string, unknown>))) }]
    }));
  }
  registerSdkResources(sdk, local);
  return sdk;
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  if (options.transport && options.transport !== "stdio") {
    throw new Error(`Unsupported MCP transport: ${String(options.transport)}`);
  }
  const root = await ensureMcpStartupWorkspace();
  const local = createMcpServer({ root: root.root, rootSource: root.rootSource });
  const sdk = createSdkServer(local);
  await sdk.connect(new StdioServerTransport());
}

function registerSdkResources(sdk: McpServer, local: McpServerHandle): void {
  sdk.registerResource("speckiwi-index", "speckiwi://index", { title: "SpecKiwi SRS Index", mimeType: "application/json" }, async (uri) => {
    const value = await local.tools["resource:speckiwi://index"]?.({});
    return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
  });
  sdk.registerResource("speckiwi-active-target", "speckiwi://active-target", { title: "SpecKiwi Active Target", mimeType: "application/json" }, async (uri) => {
    const value = await local.tools["resource:speckiwi://active-target"]?.({});
    return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
  });
  sdk.registerResource("speckiwi-completed-work", "speckiwi://completed-work", { title: "SpecKiwi Completed Work", mimeType: "application/json" }, async (uri) => {
    const value = await local.tools["resource:speckiwi://completed-work"]?.({});
    return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
  });
  sdk.registerResource(
    "speckiwi-completed-work-target",
    new ResourceTemplate("speckiwi://completed-work/{target}", { list: undefined }),
    { title: "SpecKiwi Completed Work by Target", mimeType: "application/json" },
    async (uri, variables) => {
      const value = await local.tools["resource:speckiwi://completed-work/{target}"]?.({ target: variables.target });
      return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
    }
  );
  sdk.registerResource(
    "speckiwi-requirements",
    new ResourceTemplate("speckiwi://requirements/{id}", { list: undefined }),
    { title: "SpecKiwi Requirement", mimeType: "application/json" },
    async (uri, variables) => {
      const value = await local.tools["resource:speckiwi://requirements/{id}"]?.({ id: variables.id });
      return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
    }
  );
  sdk.registerResource(
    "speckiwi-targets",
    new ResourceTemplate("speckiwi://targets/{target}", { list: undefined }),
    { title: "SpecKiwi Target Summary", mimeType: "application/json" },
    async (uri, variables) => {
      const value = await local.tools["resource:speckiwi://targets/{target}"]?.({ target: variables.target });
      return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
    }
  );
  sdk.registerResource(
    "speckiwi-scopes",
    new ResourceTemplate("speckiwi://scopes/{scope}", { list: undefined }),
    { title: "SpecKiwi Scope Requirements", mimeType: "application/json" },
    async (uri, variables) => {
      const value = await local.tools["resource:speckiwi://scopes/{scope}"]?.({ scope: variables.scope });
      return { contents: [{ uri: uri.href, text: JSON.stringify(value), mimeType: "application/json" }] };
    }
  );
}
