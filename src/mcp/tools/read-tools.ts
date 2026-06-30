import { resolveProjectRoot } from "../../core/project-root.js";
import { parseWorkspace } from "../../core/parser/workspace-parser.js";
import { validateWorkspace } from "../../core/validator/validate-workspace.js";
import { getRequirement, listRequirements } from "../../core/query/lookup.js";
import { projectRequirementRecords, searchRequirementRecords } from "../../core/query/discovery.js";
import { buildReadEnvelope, summarizeTarget } from "../../core/query/summary.js";
import { completedWorkReadModel, type CompletedWorkFilter } from "../../core/query/completed-work.js";
import { splitDiagnostics, summarizeDiagnostics } from "../../core/diagnostic.js";
import type { Diagnostic, ParsedWorkspace } from "../../core/types.js";
import type { McpDependencies, McpServerHandle } from "../adapter.js";
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

async function workspace(deps: McpDependencies) {
  const root = await resolveProjectRoot(process.cwd(), deps.root);
  return parseWorkspace(root);
}

async function projectRoot(deps: McpDependencies) {
  return resolveProjectRoot(process.cwd(), deps.root);
}

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

export function registerReadTools(server: McpServerHandle, deps: McpDependencies): void {
  server.registerTool("mcp_workspace_info", async () => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    return mcpSuccess(
      buildReadEnvelope(
        parsed,
        {
          workspaceRoot: parsed.root.root,
          rootSource: deps.root ? "explicit" : "server-cwd-discovery",
          indexPath: "docs/spec/00.index.md",
          activeTarget: parsed.index.activeTarget
        },
        diagnostics
      ),
      diagnostics
    );
  }, { readOnlyHint: true });
  server.registerTool("list_requirements", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    return mcpSuccess(buildReadEnvelope(parsed, projectRequirementRecords(listRequirements(parsed, input), input), diagnostics), diagnostics);
  }, { readOnlyHint: true });
  server.registerTool("search_requirements", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    const query = typeof input.query === "string" ? input.query : "";
    return mcpSuccess(buildReadEnvelope(parsed, searchRequirementRecords(parsed.records, { ...input, query, filter: input }), diagnostics), diagnostics);
  }, { readOnlyHint: true });
  server.registerTool("get_requirement", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    try {
      return mcpSuccess(buildReadEnvelope(parsed, getRequirement(parsed, String(input.id), { includeMarkdown: Boolean(input.includeMarkdown) }), diagnostics), diagnostics);
    } catch (error) {
      return mcpFailure("NOT_FOUND", (error as Error).message, {
        diagnostics,
        recovery: { tool: "search_requirements", message: "Search for the requirement ID or title, then retry get_requirement with the exact ID." }
      });
    }
  }, { readOnlyHint: true });
  server.registerTool("validate_spec", async () => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    const result = splitDiagnostics(diagnostics);
    const diagnosticsSummary = summarizeDiagnostics(diagnostics);
    return mcpSuccess({ ...result, summary: diagnosticsSummary, diagnosticsSummary }, diagnostics);
  }, { readOnlyHint: true });
  server.registerTool("summarize_target", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    const target = typeof input.target === "string" ? input.target : undefined;
    const summary = typeof target === "string" ? summarizeTarget(parsed, { target, diagnostics }) : summarizeTarget(parsed, { diagnostics });
    return mcpSuccess(buildReadEnvelope(parsed, summary, diagnostics), diagnostics);
  }, { readOnlyHint: true });
  server.registerTool("get_active_target", async () => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    const activeTarget = parsed.index.activeTarget;
    const summary = summarizeTarget(parsed, { diagnostics });
    const goal = activeTarget && parsed.index.targetGoals[activeTarget] ? parsed.index.targetGoals[activeTarget] : null;
    return mcpSuccess(buildReadEnvelope(parsed, { activeTarget, summary, goal }, diagnostics), diagnostics);
  }, { readOnlyHint: true });
  server.registerTool("list_completed_work", async (input) => {
    const parsed = await workspace(deps);
    const diagnostics = readDiagnostics(parsed);
    return mcpSuccess(buildReadEnvelope(parsed, completedWorkReadModel(parsed, completedWorkFilter(input)), diagnostics), diagnostics);
  }, { readOnlyHint: true });
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
  server.registerTool("workflow_workspace_info", async () => workflowWorkspaceInfo(await projectRoot(deps)), { readOnlyHint: true });
  server.registerTool("workflow_artifacts_list", async (input) => workflowArtifacts(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_latest_artifact", async (input) => workflowArtifacts(await projectRoot(deps), { ...workflowOptions(input), limit: 1 }), { readOnlyHint: true });
  server.registerTool("workflow_resolve_artifact", async (input) => workflowArtifacts(await projectRoot(deps), { ...workflowOptions(input), limit: 1 }), { readOnlyHint: true });
  server.registerTool("workflow_plan_status", async (input) => workflowPlanStatus(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_plan_task", async (input) => workflowPlanTask(await projectRoot(deps), String(input.taskId), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_next_plan_task", async (input) => workflowNextPlanTask(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_doctor", async (input) => workflowDoctor(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_diff", async (input) => workflowDiff(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_schema_check", async (input) => workflowSchemaCheck(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_pipeline_status", async (input) => workflowPipelineStatus(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_pipeline_tail", async (input) => workflowPipelineTail(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_pipeline_next", async (input) => workflowPipelineNext(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_pipeline_compact", async (input) => workflowPipelineCompact(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_session_status", async (input) => workflowSessionStatus(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_resume_hint", async (input) => workflowResumeHint(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("workflow_worklog_tail", async (input) => workflowWorklogTail(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("preview_legacy_workflow_migration", async (input) => unsupportedWorkflowMigrationInput(input) ?? workflowMigrationPreview(await projectRoot(deps), workflowOptions(input)), { readOnlyHint: true });
  server.registerTool("get_next_work_order", async (input) => buildNextWorkOrder(await projectRoot(deps), workOrderOptions(input)), { readOnlyHint: true });
}
