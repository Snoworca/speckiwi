import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { access, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { initProject } from "../core/bootstrap/init-project.js";
import { REPORT_PATH_TOKEN_REGEX } from "../core/completed-work/report-paths.js";
import type { ProjectRoot } from "../core/types.js";
import { createTestMcpServer, type McpDependencies, type McpServerHandle } from "./adapter.js";
import { getServerMetadata, type PackageInfo } from "./metadata.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerMutationTools } from "./tools/mutation-tools.js";
import { registerResources } from "./resources.js";

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

const reportPathSchema = z
  .string()
  .trim()
  .min(1)
  .regex(REPORT_PATH_TOKEN_REGEX, { message: "invalid report path" })
  .describe("repository-relative POSIX report path; no absolute paths, traversal, URL schemes, backslash, pipe, comma, newline, or #");

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
  workflow_workspace_info: {},
  workflow_artifacts_list: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    kind: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional()
  },
  workflow_latest_artifact: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    kind: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional()
  },
  workflow_resolve_artifact: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    kind: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional()
  },
  workflow_plan_status: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    includeBody: z.boolean().optional(),
    allowAmbiguous: z.boolean().optional()
  },
  workflow_plan_task: {
    taskId: z.string(),
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional()
  },
  workflow_next_plan_task: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional()
  },
  workflow_doctor: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    allowAmbiguous: z.boolean().optional()
  },
  workflow_diff: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    allowAmbiguous: z.boolean().optional()
  },
  workflow_schema_check: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    allowAmbiguous: z.boolean().optional()
  },
  workflow_pipeline_status: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional() },
  workflow_pipeline_tail: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional() },
  workflow_pipeline_next: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional() },
  workflow_pipeline_compact: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional() },
  workflow_session_status: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeBody: z.boolean().optional() },
  workflow_resume_hint: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional() },
  workflow_worklog_tail: { path: z.string().optional(), runId: z.string().optional(), target: z.string().optional(), includeDeleted: z.boolean().optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional() },
  preview_legacy_workflow_migration: {
    path: z.string().optional(),
    runId: z.string().optional(),
    target: z.string().optional(),
    includeBody: z.boolean().optional(),
    apply: z.boolean().optional(),
    write: z.boolean().optional(),
    fix: z.boolean().optional(),
    normalize: z.boolean().optional(),
    migrate: z.boolean().optional()
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
    type: z.enum(["version", "release", "milestone"]).optional(),
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
    dryRun: z.boolean().optional()
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
    dryRun: z.boolean().optional()
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
    dryRun: z.boolean().optional()
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
    dryRun: z.boolean().optional()
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
    dryRun: z.boolean().optional()
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
    dryRun: z.boolean().optional()
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
    dryRun: z.boolean().optional()
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
    dryRun: z.boolean().optional()
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
  // FR-MCP-021 — step-scoped validation read tool.
  validate_step: { step: z.string() },
  // FR-MCP-022 — compatibility-check mutation tools and edge read tools.
  add_compatibility_check: { aReqId: z.string(), bReqId: z.string(), dryRun: z.boolean().optional() },
  refresh_compatibility_check: { aReqId: z.string(), bReqId: z.string(), dryRun: z.boolean().optional() },
  revoke_compatibility_check: { aReqId: z.string(), bReqId: z.string(), dryRun: z.boolean().optional() },
  list_dirty_edges: { target: z.string().optional() },
  list_compat_edges: { target: z.string().optional() },
  // FR-MCP-023 — statement and acceptance-criteria gap mutation tools.
  update_requirement_statement: { id: z.string(), text: z.string(), dryRun: z.boolean().optional() },
  edit_acceptance_criteria: { id: z.string(), acId: z.string(), text: z.string(), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() },
  // FR-MCP-024 — step-state tools (claim/update are mutations, list_steps is read-only).
  claim_step: {
    step: z.string(),
    touchesScope: z.string(),
    touchesReq: z.array(z.string()),
    force: z.boolean().optional(),
    supersede: z.string().optional(),
    dryRun: z.boolean().optional()
  },
  update_step_state: { step: z.string(), status: z.string().optional(), dependsOn: z.string().optional(), dryRun: z.boolean().optional() },
  list_steps: { step: z.string().optional(), target: z.string().optional() },
  // FR-MCP-025 — supersede and promote mutation tools.
  supersede_requirement: {
    oldId: z.string(),
    scope: z.string(),
    target: z.string(),
    title: z.string(),
    statement: z.string(),
    acceptanceCriteria: z.array(z.string()),
    successorId: z.string().optional(),
    reason: z.string().optional(),
    dryRun: z.boolean().optional()
  },
  promote_step_requirement: { id: z.string(), fromStep: z.string(), toScope: z.string(), dryRun: z.boolean().optional(), ignoreLock: z.boolean().optional() }
};

export function isReadOnlyTool(name: string): boolean {
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
    "list_steps"
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

async function ensureMcpStartupWorkspace(): Promise<ProjectRoot> {
  const root = await resolveMcpStartupRoot();
  const indexPath = path.join(root.root, "docs", "spec", "00.index.md");
  if (!(await exists(indexPath))) {
    const result = await initProject(root, {});
    if (!result.ok) {
      throw new Error(result.error?.message ?? "MCP workspace initialization failed");
    }
  }
  return root;
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  if (options.transport && options.transport !== "stdio") {
    throw new Error(`Unsupported MCP transport: ${String(options.transport)}`);
  }
  const sdk = new McpServer(MCP_SERVER_METADATA);
  const root = await ensureMcpStartupWorkspace();
  const local = createMcpServer({ root: root.root });
  for (const [name, handler] of Object.entries(local.tools).filter(([name]) => !name.startsWith("resource:"))) {
    sdk.registerTool(name, {
      title: name,
      inputSchema: toolSchemas[name] ?? {},
      annotations: { readOnlyHint: isReadOnlyTool(name) }
    }, async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await handler(input as Record<string, unknown>)) }]
    }));
  }
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
  await sdk.connect(new StdioServerTransport());
}
