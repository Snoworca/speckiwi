import { diagnostic, summarizeDiagnostics } from "../diagnostic.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { validateWorkspace } from "../validator/validate-workspace.js";
import { summarizeTarget } from "../query/summary.js";
import type { Diagnostic, DiagnosticsSummary, ProjectRoot } from "../types.js";
import { resolveWorkflowArtifacts } from "./artifacts.js";
import { parseWorkflowJsonl } from "./jsonl.js";
import { validateWorkflowArtifacts, type WorkflowTaskCatalogEntry, type WorkflowValidationResult } from "./validate.js";

export type WorkOrderAction = "create-plan" | "execute-task" | "resume-session" | "ask-user" | "fix-artifact" | "blocked" | "complete" | "no-action";

export interface NextWorkOrderOptions {
  target?: string;
  path?: string;
  runId?: string;
  allowAmbiguous?: boolean;
  includeBody?: boolean;
  measure?: boolean;
  pipelinePath?: string;
  explain?: boolean;
  profile?: "default" | "compact" | "explain";
  contextProfile?: "default" | "compact";
}

export interface WorkOrderMeasurement {
  baselineBytes: number;
  baselineApproxTokens: number;
  compactBytes: number;
  compactApproxTokens: number;
  requiredFieldsPresent: boolean;
  reductionRatio: number;
}

export interface NextWorkOrder {
  action: WorkOrderAction;
  target: string | null;
  targetSource: "explicit" | "active-target" | "none";
  requirementIds: string[];
  artifacts: Array<{ relativePath: string; kind: string; sha256?: string; mtimeMs: number }>;
  task: WorkflowTaskCatalogEntry | null;
  nextAction: {
    kind: WorkOrderAction;
    tool: string;
    reason: string;
  };
  reason: string;
  blocking: boolean;
  blockingDiagnostics: Diagnostic[];
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
  pipeline?: {
    latestStatus: string | null;
    latestEventKey: string | null;
  };
  validation?: {
    outcome: WorkflowValidationResult["outcome"];
    blocking: boolean;
  };
  measurement?: WorkOrderMeasurement;
  profile?: "default" | "compact" | "explain";
  contextProfile?: "default" | "compact";
  decisionTrace?: Array<{ step: string; outcome: string; reason: string }>;
  rejectedCandidates?: Array<{ action: WorkOrderAction; reason: string }>;
  blockers?: Diagnostic[];
}

function approxTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((item) => item.length > 0))];
}

function actionTool(action: WorkOrderAction): string {
  switch (action) {
    case "create-plan":
      return "workflow_plan_status";
    case "execute-task":
      return "workflow_next_plan_task";
    case "resume-session":
      return "workflow_resume_hint";
    case "ask-user":
      return "workflow_pipeline_status";
    case "fix-artifact":
      return "workflow_resume_hint";
    case "blocked":
      return "workflow_next_plan_task";
    case "complete":
      return "add_completed_work";
    case "no-action":
      return "summarize_target";
  }
}

function blockingDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const blockingCodes = new Set(["SRS-E050", "SRS-E051", "SRS-W057", "SRS-W058", "SRS-W059", "SRS-W063"]);
  return diagnostics.filter((item) => item.severity === "error" || blockingCodes.has(item.code));
}

function baseOrder(input: {
  action: WorkOrderAction;
  target: string | null;
  targetSource: NextWorkOrder["targetSource"];
  requirementIds: string[];
  artifacts: NextWorkOrder["artifacts"];
  task: WorkflowTaskCatalogEntry | null;
  reason: string;
  blocking: boolean;
  diagnostics: Diagnostic[];
  pipeline?: NextWorkOrder["pipeline"];
  validation?: NextWorkOrder["validation"];
  options?: Pick<NextWorkOrderOptions, "explain" | "profile" | "contextProfile">;
}): NextWorkOrder {
  const blockers = blockingDiagnostics(input.diagnostics);
  const profile = input.options?.profile ?? (input.options?.explain ? "explain" : "default");
  const includeExplain = input.options?.explain === true || profile === "explain";
  const rejectedCandidates: Array<{ action: WorkOrderAction; reason: string }> = [
    ...(input.action !== "create-plan" ? [{ action: "create-plan" as const, reason: "not selected by current target/plan state" }] : []),
    ...(input.action !== "execute-task" ? [{ action: "execute-task" as const, reason: "not selected by current workflow validation state" }] : []),
    ...(input.action !== "resume-session" ? [{ action: "resume-session" as const, reason: "not selected because PM state is absent or unsafe" }] : []),
    ...(input.action !== "ask-user" ? [{ action: "ask-user" as const, reason: "not selected because latest pipeline state does not require user input" }] : []),
    ...(input.action !== "fix-artifact" ? [{ action: "fix-artifact" as const, reason: "not selected because blocking artifact diagnostics are absent" }] : []),
    ...(input.action !== "blocked" ? [{ action: "blocked" as const, reason: "not selected because hard blockers are absent or a more specific action applies" }] : [])
  ];
  return {
    action: input.action,
    target: input.target,
    targetSource: input.targetSource,
    requirementIds: unique(input.requirementIds),
    artifacts: input.artifacts,
    task: input.task,
    nextAction: {
      kind: input.action,
      tool: actionTool(input.action),
      reason: input.reason
    },
    reason: input.reason,
    blocking: input.blocking,
    blockingDiagnostics: blockers,
    diagnostics: input.diagnostics,
    diagnosticsSummary: summarizeDiagnostics(input.diagnostics),
    ...(profile !== "default" ? { profile } : {}),
    ...(input.options?.contextProfile && input.options.contextProfile !== "default" ? { contextProfile: input.options.contextProfile } : {}),
    ...(includeExplain
      ? {
          decisionTrace: [
            { step: "target", outcome: input.targetSource, reason: input.target ? `target resolved as ${input.target}` : "no target resolved" },
            { step: "pipeline", outcome: input.pipeline?.latestStatus ?? "none", reason: input.pipeline?.latestStatus ? `latest pipeline status is ${input.pipeline.latestStatus}` : "no blocking pipeline status" },
            { step: "validation", outcome: input.validation?.outcome ?? "not-run", reason: input.reason },
            { step: "decision", outcome: input.action, reason: input.reason }
          ],
          rejectedCandidates,
          blockers
        }
      : {}),
    ...(input.pipeline ? { pipeline: input.pipeline } : {}),
    ...(input.validation ? { validation: input.validation } : {})
  };
}

function withMeasurement(order: NextWorkOrder, baselineValue: unknown): NextWorkOrder {
  const compactWithoutMeasurement = { ...order };
  delete compactWithoutMeasurement.measurement;
  const baselineBytes = Buffer.byteLength(JSON.stringify(baselineValue));
  const compactBytes = Buffer.byteLength(JSON.stringify(compactWithoutMeasurement));
  return {
    ...order,
    measurement: {
      baselineBytes,
      baselineApproxTokens: approxTokens(baselineBytes),
      compactBytes,
      compactApproxTokens: approxTokens(compactBytes),
      requiredFieldsPresent: Boolean(order.action && order.targetSource && order.nextAction && order.diagnosticsSummary),
      reductionRatio: baselineBytes === 0 ? 1 : compactBytes / baselineBytes
    }
  };
}

async function pipelineState(root: ProjectRoot, options: NextWorkOrderOptions, diagnostics: Diagnostic[]): Promise<{ latestStatus: string | null; latestEventKey: string | null; artifacts: NextWorkOrder["artifacts"] }> {
  const resolved = await resolveWorkflowArtifacts(root, {
    ...(options.pipelinePath ? { explicitPath: options.pipelinePath } : {}),
    kind: "pipeline",
    allowAmbiguous: true
  });
  diagnostics.push(...resolved.diagnostics);
  if (!resolved.selected) return { latestStatus: null, latestEventKey: null, artifacts: [] };
  const parsed = await parseWorkflowJsonl(root, resolved.selected.relativePath);
  diagnostics.push(...parsed.diagnostics);
  const latest = parsed.latestEntries.at(-1) ?? null;
  return {
    latestStatus: typeof latest?.event.status === "string" ? latest.event.status : null,
    latestEventKey: latest?.eventKey ?? null,
    artifacts: [
      {
        relativePath: resolved.selected.relativePath,
        kind: resolved.selected.kind,
        ...(resolved.selected.sha256 ? { sha256: resolved.selected.sha256 } : {}),
        mtimeMs: resolved.selected.mtimeMs
      }
    ]
  };
}

function actionFromValidation(validation: WorkflowValidationResult): { action: WorkOrderAction; reason: string; blocking: boolean } {
  if (validation.outcome === "stale_artifact" || validation.outcome === "invalid_artifact") return { action: "fix-artifact", reason: `workflow validator reported ${validation.outcome}`, blocking: true };
  if (validation.outcome === "blocked_dependency") return { action: "blocked", reason: "workflow task is blocked by dependency state", blocking: true };
  if (validation.outcome === "resume-blocked") return { action: "blocked", reason: "workflow resume is blocked by conflicting state or missing audit evidence", blocking: true };
  if (validation.outcome === "confirmed_done") return { action: "complete", reason: "all workflow tasks are completed", blocking: false };
  if (validation.nextTask) {
    const hasPmState = validation.artifacts.some((artifact) => artifact.kind === "pm-state");
    return hasPmState ? { action: "resume-session", reason: "PM session exists and has a safe next task", blocking: false } : { action: "execute-task", reason: "plan has a safe next task and no PM session state", blocking: false };
  }
  return { action: "no-action", reason: "no actionable workflow task was found", blocking: false };
}

export async function buildNextWorkOrder(root: ProjectRoot, options: NextWorkOrderOptions = {}): Promise<NextWorkOrder> {
  const workspace = await parseWorkspace(root);
  const diagnostics: Diagnostic[] = [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
  const target = options.target ?? workspace.index.activeTarget ?? null;
  const targetSource: NextWorkOrder["targetSource"] = options.target ? "explicit" : workspace.index.activeTarget ? "active-target" : "none";
  const targetRecords = target ? workspace.records.filter((record) => record.target === target) : [];
  const baselineValue = targetRecords.map((record) => ({ id: record.id, title: record.title, status: record.status, target: record.target, markdown: record.markdown }));

  const pipeline = await pipelineState(root, options, diagnostics);
  const pipelinePayload = { latestStatus: pipeline.latestStatus, latestEventKey: pipeline.latestEventKey };
  if (!target) {
    diagnostics.push(diagnostic("SRS-W002", "warning", "Target is not registered: <empty>", {}, { kind: "missing-target" }));
    const order = baseOrder({
      action: "blocked",
      target,
      targetSource,
      requirementIds: [],
      artifacts: pipeline.artifacts,
      task: null,
      reason: "no active target or explicit target is available",
      blocking: true,
      diagnostics,
      pipeline: pipelinePayload,
      options
    });
    return options.measure ? withMeasurement(order, baselineValue) : order;
  }

  if (pipeline.latestStatus === "NEEDS_USER" || pipeline.latestStatus === "FAILED") {
    const action: WorkOrderAction = pipeline.latestStatus === "NEEDS_USER" ? "ask-user" : "blocked";
    const order = baseOrder({
      action,
      target,
      targetSource,
      requirementIds: targetRecords.map((record) => record.id),
      artifacts: pipeline.artifacts,
      task: null,
      reason: `pipeline latest status is ${pipeline.latestStatus}`,
      blocking: true,
      diagnostics,
      pipeline: pipelinePayload,
      options
    });
    return options.measure ? withMeasurement(order, baselineValue) : order;
  }

  const planResolution = await resolveWorkflowArtifacts(root, {
    ...(options.path ? { explicitPath: options.path } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
    target,
    kind: "plan",
    allowAmbiguous: options.allowAmbiguous ?? true
  });
  diagnostics.push(...planResolution.diagnostics);

  if (options.path || planResolution.selected) {
    const validation = await validateWorkflowArtifacts(root, {
      ...(options.path ? { path: options.path } : planResolution.selected ? { path: planResolution.selected.relativePath } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
      target,
      allowAmbiguous: options.allowAmbiguous ?? true
    });
    diagnostics.push(...validation.diagnostics);
    const decision = actionFromValidation(validation);
    const order = baseOrder({
      action: decision.action,
      target,
      targetSource,
      requirementIds: validation.nextTask ? validation.nextTask.req_ids : validation.taskCatalog.flatMap((task) => task.req_ids),
      artifacts: [...validation.artifacts, ...pipeline.artifacts],
      task: validation.nextTask,
      reason: decision.reason,
      blocking: decision.blocking,
      diagnostics,
      pipeline: pipelinePayload,
      validation: { outcome: validation.outcome, blocking: validation.blocking },
      options
    });
    return options.measure ? withMeasurement(order, baselineValue) : order;
  }

  const targetSummary = summarizeTarget(workspace, { target, diagnostics });
  const requirementIds = targetSummary.newWorkCandidates.length > 0 ? targetSummary.newWorkCandidates : targetRecords.map((record) => record.id);
  const action: WorkOrderAction = requirementIds.length > 0 ? "create-plan" : "no-action";
  const order = baseOrder({
    action,
    target,
    targetSource,
    requirementIds,
    artifacts: pipeline.artifacts,
    task: null,
    reason: action === "create-plan" ? "target has active requirements but no workflow plan artifact" : "target has no active work candidates",
    blocking: false,
    diagnostics,
    pipeline: pipelinePayload,
    options
  });
  return options.measure ? withMeasurement(order, baselineValue) : order;
}
