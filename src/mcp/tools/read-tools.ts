import { resolveProjectRoot } from "../../core/project-root.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { validateWorkspace } from "../../core/validator/validate-workspace.js";
import { loadStepDesign, loadStepIntent, validateWorkspaceScoped } from "../../core/validator/validate-scoped.js";
import { getWorkMode } from "../../core/mutation/work-mode.js";
import { evaluateVibeGate } from "../../core/query/vibe-gate.js";
import { getRequirement, listRequirements } from "../../core/query/lookup.js";
import { projectRequirementRecords, searchRequirementRecords } from "../../core/query/discovery.js";
import { buildReadEnvelope, listDirtyEdges, summarizeTarget } from "../../core/query/summary.js";
import { listSteps } from "../../core/query/list-steps.js";
import { completedWorkReadModel, type CompletedWorkFilter } from "../../core/query/completed-work.js";
import { splitDiagnostics, summarizeDiagnostics } from "../../core/diagnostic.js";
import type { Diagnostic, ParsedWorkspace } from "../../core/types.js";
import type { McpCallContext, McpDependencies, McpServerHandle, McpToolMetadata } from "../adapter.js";
import { isWorkspaceScope, type WorkspaceRootReason } from "../workspace-root.js";
import { mcpFailure, mcpSuccess } from "../errors.js";
import {
  workflowArtifacts,
  workflowDiff,
  workflowDoctor,
  workflowNextPlanTask,
  workflowPipelineCompact,
  workflowPipelineNext,
  workflowPipelineStatus,
  workflowPipelineTail,
  workflowPlanStatus,
  workflowPlanTask,
  workflowMigrationPreview,
  workflowResumeHint,
  workflowSchemaCheck,
  workflowSessionStatus,
  workflowWorklogTail,
  workflowWorkspaceInfo,
  type WorkflowReadOptions
} from "../../core/workflow/read.js";
import { buildNextWorkOrder, type NextWorkOrderOptions } from "../../core/workflow/work-order.js";
import type { WorkflowArtifactKind } from "../../core/workflow/artifacts.js";
import {
  diagnoseRequirementIdCollisions,
  planRequirementIdCollisionRepair,
  type RequirementIdCollisionRepairPlanInput,
  type RequirementOccurrenceIdentity
} from "../../core/mutation/repair-requirement-id.js";
import { resultToMcp } from "../errors.js";
import { ORCHESTRATE_TOOL_BINDINGS, orchestrateArgv, type OrchestrateToolBinding } from "../../cli/commands/orchestrate.js";

/**
 * The parsed SRS one read answers from. Like {@link projectRoot}, it takes the per-call root from
 * `context` rather than from `input`, so which tools may name a checkout stays a registration fact.
 * @req FR-MCP-064 AC-3
 */
async function workspace(deps: McpDependencies, context?: McpCallContext) {
  const root = await resolveProjectRoot(process.cwd(), context?.root ?? deps.root);
  return parseWorkspace(root);
}

/**
 * The root one read answers from. Like {@link workspace}, it takes the per-call root from `context`
 * rather than from `input`, so which tools may name a checkout stays a registration fact: a caller
 * that hands it no `context` is one this gate holds to the startup root. @req REL-MCP-005 AC-3
 */
async function projectRoot(deps: McpDependencies, context?: McpCallContext) {
  return resolveProjectRoot(process.cwd(), context?.root ?? deps.root);
}

/** @req FR-MCP-058 AC-1 — the `workflow_*` read family declares itself worktree-local. */
const WORKTREE_LOCAL_READ = { readOnlyHint: true, workspaceScope: "worktree-local" } as const;

function workflowOptions(input: Record<string, unknown>): WorkflowReadOptions {
  return {
    ...(typeof input.path === "string" ? { path: input.path } : {}),
    ...(typeof input.runId === "string" ? { runId: input.runId } : {}),
    ...(typeof input.target === "string" ? { target: input.target } : {}),
    ...(typeof input.kind === "string" ? { kind: input.kind as WorkflowArtifactKind } : {}),
    ...(input.includeBody === true ? { includeBody: true } : {}),
    ...(input.includeDeleted === true ? { includeDeleted: true } : {}),
    ...(input.allowAmbiguous === true ? { allowAmbiguous: true } : {}),
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    ...(typeof input.offset === "number" ? { offset: input.offset } : {})
  };
}

function workOrderOptions(input: Record<string, unknown>): NextWorkOrderOptions {
  return {
    ...workflowOptions(input),
    ...(input.measure === true ? { measure: true } : {}),
    ...(typeof input.pipelinePath === "string" ? { pipelinePath: input.pipelinePath } : {}),
    ...(input.explain === true ? { explain: true } : {}),
    ...(input.profile === "compact" || input.profile === "explain" || input.profile === "default" ? { profile: input.profile } : {}),
    ...(input.contextProfile === "compact" || input.contextProfile === "default" ? { contextProfile: input.contextProfile } : {})
  };
}

function unsupportedWorkflowMigrationInput(input: Record<string, unknown>) {
  const flag = ["apply", "write", "fix", "normalize", "migrate"].find((name) => input[name] === true);
  if (!flag) return null;
  const message = `preview_legacy_workflow_migration is read-only; ${flag} is unsupported`;
  const diagnostic: Diagnostic = { code: "UNSUPPORTED_OPERATION", severity: "error", message, details: { flag, tool: "preview_legacy_workflow_migration" } };
  return mcpFailure("UNSUPPORTED_OPERATION", message, {
    diagnostics: [diagnostic],
    metadata: { written: false, diagnosticsSummary: summarizeDiagnostics([diagnostic]) }
  });
}

function readDiagnostics(workspace: ParsedWorkspace): Diagnostic[] {
  return [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
}

function completedWorkFilter(input: Record<string, unknown>): CompletedWorkFilter {
  return {
    ...(typeof input.target === "string" ? { target: input.target } : {}),
    ...(typeof input.scope === "string" ? { scope: input.scope } : {}),
    ...(typeof input.since === "string" ? { since: input.since } : {}),
    ...(typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit > 0 ? { limit: input.limit } : {}),
    ...(typeof input.offset === "number" && Number.isInteger(input.offset) && input.offset >= 0 ? { offset: input.offset } : {}),
    ...(input.order === "file" ? { order: "file" as const } : {})
  };
}

function occurrenceInput(value: unknown): RequirementOccurrenceIdentity | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Partial<RequirementOccurrenceIdentity>;
  if (typeof record.filePath !== "string" || typeof record.headingLine !== "number" || typeof record.blockHash !== "string") return null;
  return { filePath: record.filePath, headingLine: record.headingLine, blockHash: record.blockHash };
}

function referenceEditsInput(value: unknown): Array<{ filePath: string; line: number; from: string; to: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Partial<{ filePath: string; line: number; from: string; to: string }>;
    if (typeof record.filePath !== "string" || typeof record.line !== "number" || typeof record.from !== "string" || typeof record.to !== "string") return [];
    return [{ filePath: record.filePath, line: record.line, from: record.from, to: record.to }];
  });
}

function repairPlanInput(input: Record<string, unknown>): RequirementIdCollisionRepairPlanInput | null {
  const keep = occurrenceInput(input.keep);
  const rename = occurrenceInput(input.rename);
  if (typeof input.duplicateId !== "string" || !keep || !rename) return null;
  if (typeof input.replacementId !== "string" && input.allocationStrategy !== "next_available") return null;
  return {
    duplicateId: input.duplicateId,
    keep,
    rename,
    ...(typeof input.replacementId === "string" ? { replacementId: input.replacementId } : { allocationStrategy: "next_available" as const }),
    referenceEdits: referenceEditsInput(input.referenceEdits)
  };
}


// @req IR-MCP-003 — the `orchestrate_*` family. Each tool re-encodes its input as the argv of the
// CLI leaf it mirrors and runs the CLI, so there is exactly one implementation of every verb and the
// two surfaces cannot diverge. The CLI's exit code is carried through: 2 is a gate refusal, 1 an
// operational error, 0 success (FR-NODE-137), and the payload is the CLI's own envelope.
export async function callOrchestrateTool(
  binding: OrchestrateToolBinding,
  input: Record<string, unknown>,
  deps: McpDependencies,
  context?: McpCallContext
): Promise<unknown> {
  const { main } = await import("../../cli/index.js");
  const chunks: string[] = [];
  const sink = () => ({ write: (text: string) => { chunks.push(text); return true; } }) as unknown as NodeJS.WriteStream;
  let argv: string[];
  try {
    // @req FR-MCP-059 AC-1 — an accepted per-call root becomes the CLI's own `--root`, which the
    // leaf already takes as a global option; omitting it leaves the argv exactly as it is today.
    argv = orchestrateArgv(binding, input, context?.root ?? deps.root);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const exitCode = await main(argv, { stdout: sink(), stderr: sink() });
  const text = chunks.join("");
  try {
    return { ...(JSON.parse(text) as Record<string, unknown>), exitCode };
  } catch {
    return { ok: false, error: text.trim().length > 0 ? text.trim() : `orchestrate ${binding.path.join(" ")} produced no output`, exitCode };
  }
}

/**
 * Registers every `orchestrate_*` binding of the given kind onto the server.
 *
 * Two rows stay host-fixed: `orchestrate_replay_apply`, because replaying a deferred SRS mutation
 * anywhere but the host root is what the deferral exists to prevent, and `orchestrate_preflight`,
 * because it already takes both roots it judges as required arguments. @req FR-MCP-059 AC-3 / AC-4
 */
export function registerOrchestrateTools(server: McpServerHandle, deps: McpDependencies, kind: "read" | "mutation"): void {
  for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
    if (binding.kind !== kind) continue;
    server.registerTool(
      binding.tool,
      async (input, context) => callOrchestrateTool(binding, input, deps, context),
      { ...(kind === "read" ? { readOnlyHint: true } : { kind: "workspace" as const }), ...ORCHESTRATE_WORKSPACE_METADATA[binding.tool] }
    );
  }
}

/** What each `orchestrate_*` row declares about the per-call root. Absence is refusal. */
const ORCHESTRATE_WORKSPACE_METADATA: Readonly<Record<string, {
  workspaceScope?: "worktree-local";
  workspaceRootRefusal?: { reason: WorkspaceRootReason; message: string };
}>> = Object.freeze(
  Object.fromEntries(
    ORCHESTRATE_TOOL_BINDINGS.map((binding) => [
      binding.tool,
      binding.tool === "orchestrate_replay_apply"
        ? {
          workspaceRootRefusal: {
            reason: "workspace-root-forbidden-for-replay-apply" as const,
            message:
              "orchestrate_replay_apply refuses workspaceRoot: a deferred SRS mutation replays only at the host root, which is the rule the deferral exists to enforce."
          }
        }
        : binding.tool === "orchestrate_preflight"
          ? {}
          : { workspaceScope: "worktree-local" as const }
    ])
  )
);

/**
 * The SRS query tools that answer from a per-call checkout, named because the requirement names them.
 *
 * Reading is the whole of it. A write is not here and cannot be: a Requirement ID is allocated from a
 * counter file that `.gitignore` keeps out of git, and the SRS mutation lock is per-root as well, so
 * two roots would mint colliding ids while excluding neither. That is also why the two
 * requirement-id repair readers are absent — both allocate an id, whether or not they write it.
 * @req FR-MCP-064 AC-1
 */
export const SRS_READ_WORKSPACE_SCOPED: readonly string[] = [
  "list_requirements",
  "search_requirements",
  "get_requirement",
  "validate_spec",
  "summarize_target",
  "get_active_target",
  "list_completed_work",
  "validate_step",
  "get_work_mode",
  "check_vibe_gate",
  "list_dirty_edges",
  "list_compat_edges",
  "list_steps"
];

/**
 * What each of those thirteen declares. `callerPathKeys: []` says the tool takes no caller-supplied
 * path, which is what lets `relatedDoc` and `evidenceReference` carry the `docs/spec` reference they
 * were designed to carry; a tool declaring nothing still has every argument scanned.
 * @req FR-MCP-064 AC-7
 */
const SRS_READ_WORKSPACE_METADATA: Readonly<Record<string, McpToolMetadata>> = Object.freeze(
  Object.fromEntries(
    SRS_READ_WORKSPACE_SCOPED.map((tool) => [
      tool,
      Object.freeze({ readOnlyHint: true, workspaceScope: "srs-read-only" as const, callerPathKeys: Object.freeze([]) })
    ])
  )
);

/**
 * The metadata one of the thirteen is registered with.
 *
 * Throws on a name outside the set rather than falling back to a plain read metadata, because the
 * silent fallback is a refusal — the tool would advertise nothing, accept nothing, and look correct.
 */
function srsReadMetadata(tool: string): McpToolMetadata {
  const declared = SRS_READ_WORKSPACE_METADATA[tool];
  if (!declared) throw new Error(`MCP tool '${tool}' is not one of the SRS query tools FR-MCP-064 names`);
  return declared;
}

/** Every tool registered here that declares a workspace scope, orchestrate rows and SRS queries alike. */
const WORKSPACE_SCOPED_METADATA: Readonly<Record<string, McpToolMetadata>> = Object.freeze({
  ...ORCHESTRATE_WORKSPACE_METADATA,
  ...SRS_READ_WORKSPACE_METADATA
});

/**
 * Whether a tool takes the per-call root. The registration gate reads the same declaration through
 * `McpToolMetadata`, so the advertised schema and the honoured argument cannot disagree — the one
 * disagreement that survives is named by FR-MCP-063 AC-4 and it is a tool declaring no scope at all.
 * @req FR-MCP-059 @req FR-MCP-064 AC-1
 */
export function acceptsPerCallWorkspaceRoot(tool: string): boolean {
  return isWorkspaceScope(WORKSPACE_SCOPED_METADATA[tool]?.workspaceScope);
}

/** The names {@link acceptsPerCallWorkspaceRoot} answers true for, for deriving the input schemas. */
export function perCallWorkspaceRootTools(): string[] {
  return Object.keys(WORKSPACE_SCOPED_METADATA).filter((tool) => acceptsPerCallWorkspaceRoot(tool));
}

export function registerReadTools(server: McpServerHandle, deps: McpDependencies): void {
  registerOrchestrateTools(server, deps, "read");
  server.registerTool("mcp_workspace_info", async (_input, context) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    return mcpSuccess(
      buildReadEnvelope(
        parsed,
        {
          workspaceRoot: parsed.root.root,
          // @req REL-MCP-005 AC-2 — the reported source is the one that decided this call's root,
          // never a constant; this tool declares no workspace scope, so `context` is always the
          // startup one. @req FR-MCP-064 AC-5 — a tool whose own answer is which root replied cannot
          // take that root as an argument without making the comparison FR-FLOW-042 requires read
          // one source twice.
          rootSource: context?.rootSource ?? deps.rootSource ?? "server-cwd-discovery",
          indexPath: "docs/spec/00.index.md",
          activeTarget: parsed.index.activeTarget
        },
        diagnostics
      ),
      diagnostics
    );
  }, { readOnlyHint: true });
  server.registerTool("list_requirements", async (input, context) => {
    const parsed = await workspace(deps, context);
    const diagnostics = readDiagnostics(parsed);
    return mcpSuccess(buildReadEnvelope(parsed, projectRequirementRecords(listRequirements(parsed, input), input), diagnostics), diagnostics);
  }, srsReadMetadata("list_requirements"));
  server.registerTool("search_requirements", async (input, context) => {
    const parsed = await workspace(deps, context);
    const diagnostics = readDiagnostics(parsed);
    const query = typeof input.query === "string" ? input.query : "";
    return mcpSuccess(buildReadEnvelope(parsed, searchRequirementRecords(parsed.records, { ...input, query, filter: input }), diagnostics), diagnostics);
  }, srsReadMetadata("search_requirements"));
  server.registerTool("get_requirement", async (input, context) => {
    const parsed = await workspace(deps, context);
    const diagnostics = readDiagnostics(parsed);
    try {
      return mcpSuccess(buildReadEnvelope(parsed, getRequirement(parsed, String(input.id), { includeMarkdown: Boolean(input.includeMarkdown) }), diagnostics), diagnostics);
    } catch (error) {
      return mcpFailure("NOT_FOUND", (error as Error).message, {
        diagnostics,
        recovery: { tool: "search_requirements", message: "Search for the requirement ID or title, then retry get_requirement with the exact ID." }
      });
    }
  }, srsReadMetadata("get_requirement"));
  server.registerTool("validate_spec", async (_input, context) => {
    const parsed = await workspace(deps, context);
    const diagnostics = readDiagnostics(parsed);
    const result = splitDiagnostics(diagnostics);
    const diagnosticsSummary = summarizeDiagnostics(diagnostics);
    return mcpSuccess({ ...result, summary: diagnosticsSummary, diagnosticsSummary }, diagnostics);
  }, srsReadMetadata("validate_spec"));
  server.registerTool("summarize_target", async (input, context) => {
    const parsed = await workspace(deps, context);
    const diagnostics = readDiagnostics(parsed);
    const target = typeof input.target === "string" ? input.target : undefined;
    const summary = typeof target === "string" ? summarizeTarget(parsed, { target, diagnostics }) : summarizeTarget(parsed, { diagnostics });
    return mcpSuccess(buildReadEnvelope(parsed, summary, diagnostics), diagnostics);
  }, srsReadMetadata("summarize_target"));
  server.registerTool("get_active_target", async (_input, context) => {
    const parsed = await workspace(deps, context);
    const diagnostics = readDiagnostics(parsed);
    const activeTarget = parsed.index.activeTarget;
    const summary = summarizeTarget(parsed, { diagnostics });
    const goal = activeTarget && parsed.index.targetGoals[activeTarget] ? parsed.index.targetGoals[activeTarget] : null;
    return mcpSuccess(buildReadEnvelope(parsed, { activeTarget, summary, goal }, diagnostics), diagnostics);
  }, srsReadMetadata("get_active_target"));
  server.registerTool("list_completed_work", async (input, context) => {
    const parsed = await workspace(deps, context);
    const diagnostics = readDiagnostics(parsed);
    return mcpSuccess(buildReadEnvelope(parsed, completedWorkReadModel(parsed, completedWorkFilter(input)), diagnostics), diagnostics);
  }, srsReadMetadata("list_completed_work"));
  server.registerTool("diagnose_requirement_id_collisions", async (input) => {
    if ("ignoreLock" in input) {
      return mcpFailure("USAGE", "diagnose_requirement_id_collisions is read-only and does not accept ignoreLock", {
        recovery: { tool: "apply_requirement_id_collision_repair", message: "Use ignoreLock only with the apply mutation when deliberately bypassing an SRS lock." }
      });
    }
    return diagnoseRequirementIdCollisions(await projectRoot(deps));
  }, { readOnlyHint: true });
  server.registerTool("plan_requirement_id_collision_repair", async (input) => {
    if ("ignoreLock" in input) {
      return mcpFailure("USAGE", "plan_requirement_id_collision_repair is read-only and does not accept ignoreLock", {
        recovery: { tool: "apply_requirement_id_collision_repair", message: "Use ignoreLock only with the apply mutation when deliberately bypassing an SRS lock." }
      });
    }
    const parsed = repairPlanInput(input);
    if (!parsed) {
      return mcpFailure("USAGE", "plan_requirement_id_collision_repair requires duplicateId, keep, rename, and replacementId or allocationStrategy=next_available", {
        recovery: { tool: "diagnose_requirement_id_collisions", message: "Run diagnose first and pass exact occurrence identities to plan." }
      });
    }
    return resultToMcp(await planRequirementIdCollisionRepair(await projectRoot(deps), parsed));
  }, { readOnlyHint: true });
  // FR-MCP-052 — get_work_mode mirrors the argument-less `speckiwi mode` read (fail-open to wait).
  server.registerTool("get_work_mode", async (_input, context) => mcpSuccess(await getWorkMode(await projectRoot(deps, context))), srsReadMetadata("get_work_mode"));
  // FR-MCP-054 — check_vibe_gate mirrors `speckiwi vibe-gate check` (shared core, read-only probe).
  server.registerTool("check_vibe_gate", async (_input, context) => mcpSuccess(await evaluateVibeGate(await projectRoot(deps, context))), srsReadMetadata("check_vibe_gate"));
  server.registerTool("workflow_workspace_info", async (_input, context) => workflowWorkspaceInfo(await projectRoot(deps, context)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_artifacts_list", async (input, context) => workflowArtifacts(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_latest_artifact", async (input, context) => workflowArtifacts(await projectRoot(deps, context), { ...workflowOptions(input), limit: 1 }), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_resolve_artifact", async (input, context) => workflowArtifacts(await projectRoot(deps, context), { ...workflowOptions(input), limit: 1 }), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_plan_status", async (input, context) => workflowPlanStatus(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_plan_task", async (input, context) => workflowPlanTask(await projectRoot(deps, context), String(input.taskId), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_next_plan_task", async (input, context) => workflowNextPlanTask(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_doctor", async (input, context) => workflowDoctor(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_diff", async (input, context) => workflowDiff(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_schema_check", async (input, context) => workflowSchemaCheck(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_pipeline_status", async (input, context) => workflowPipelineStatus(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_pipeline_tail", async (input, context) => workflowPipelineTail(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_pipeline_next", async (input, context) => workflowPipelineNext(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_pipeline_compact", async (input, context) => workflowPipelineCompact(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_session_status", async (input, context) => workflowSessionStatus(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_resume_hint", async (input, context) => workflowResumeHint(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("workflow_worklog_tail", async (input, context) => workflowWorklogTail(await projectRoot(deps, context), workflowOptions(input)), WORKTREE_LOCAL_READ);
  server.registerTool("preview_legacy_workflow_migration", async (input) => unsupportedWorkflowMigrationInput(input) ?? workflowMigrationPreview(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("get_next_work_order", async (input) => buildNextWorkOrder(await projectRoot(deps), workOrderOptions(input)), { readOnlyHint: true });
  // FR-MCP-040 — validate_step runs the step-local validation pass (W044/W045/STEP_* advisories,
  // plus the FR-PARSE-033 SDS-W05x advisories in tdd mode), scoped to a named step so a
  // body-scope error never leaks into the step diagnostics.
  server.registerTool("validate_step", async (input, context) => {
    const parsed = await workspace(deps, context);
    const stepName = String(input.step);
    // @req FR-PARSE-040 — intent.md carries the skip record, so this surface loads it beside
    // design.md. Loading only design.md here would let the MCP caller see a warning where the CLI
    // sees SDS-E054, and the two surfaces would disagree about whether the step may proceed.
    const root = await projectRoot(deps, context);
    const design = await loadStepDesign(root, stepName);
    const intent = await loadStepIntent(root, stepName);
    const result = validateWorkspaceScoped(parsed, { step: stepName, design, intent });
    const diagnosticsSummary = summarizeDiagnostics(result.diagnostics);
    return mcpSuccess({ ...result, summary: diagnosticsSummary, diagnosticsSummary }, result.diagnostics);
  }, srsReadMetadata("validate_step"));
  // FR-MCP-041 — compatibility edge read tools. listDirtyEdges enumerates every checked_compatible
  // edge with its clean/dirty/orphaned/missing classification; both readers project it.
  server.registerTool("list_dirty_edges", async (input, context) =>
    mcpSuccess(await listDirtyEdges(await projectRoot(deps, context), typeof input.target === "string" ? { target: input.target } : {})),
    srsReadMetadata("list_dirty_edges")
  );
  server.registerTool("list_compat_edges", async (input, context) =>
    mcpSuccess(await listDirtyEdges(await projectRoot(deps, context), typeof input.target === "string" ? { target: input.target } : {})),
    srsReadMetadata("list_compat_edges")
  );
  // FR-MCP-042 — list_steps returns the Kahn topological order of docs/spec/steps/state.md with
  // cycle detection and advisory-only diagnostics.
  server.registerTool("list_steps", async (input, context) =>
    mcpSuccess(await listSteps(await projectRoot(deps, context), typeof input.target === "string" ? { target: input.target } : {})),
    srsReadMetadata("list_steps")
  );
}
