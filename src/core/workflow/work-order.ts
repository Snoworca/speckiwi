import { diagnostic, summarizeDiagnostics } from "../diagnostic.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { validateWorkspace } from "../validator/validate-workspace.js";
import { summarizeTarget } from "../query/summary.js";
import { checkSdsFile } from "../sds/check-sds.js";
import type { Diagnostic, DiagnosticsSummary, ParsedWorkspace, ProjectRoot } from "../types.js";
import { resolveWorkflowArtifacts, type WorkflowArtifactCandidate } from "./artifacts.js";
import { parseWorkflowJsonl } from "./jsonl.js";
import { PIPELINE_STOP_STATUSES, workflowSessionStatus } from "./read.js";

/** @req FR-NODE-211 AC-4 — the work order speaks SDS: a unit of work is one lite SDS and its kiwi-pm session. */
export type WorkOrderAction = "create-sds" | "execute-sds" | "resume-session" | "ask-user" | "fix-artifact" | "blocked" | "complete" | "no-action";

/** The open SDS a work order acts on, as the resolver and `sds check` saw it. */
export interface WorkOrderSds {
  relativePath: string;
  sdsId: string;
  status: string | null;
  target: string | null;
}

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
  sds: WorkOrderSds | null;
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

/**
 * The tool each action tells the agent to call next.
 *
 * A table rather than a switch because the names are a contract with the MCP registry — every value
 * here must be a tool that exists, or the work order sends the agent to a name nothing answers, and
 * that failure surfaces only when the action is first selected. The `Record<WorkOrderAction, …>`
 * type makes the table total, so a new action cannot be added without naming its tool.
 * @req FR-MCP-062 AC-6, FR-NODE-211 AC-4
 */
export const WORK_ORDER_ACTION_TOOLS: Readonly<Record<WorkOrderAction, string>> = Object.freeze({
  "create-sds": "list_requirements",
  "execute-sds": "check_sds",
  "resume-session": "workflow_session_status",
  "ask-user": "workflow_pipeline_status",
  "fix-artifact": "check_sds",
  blocked: "workflow_session_status",
  complete: "add_completed_work",
  "no-action": "summarize_target"
});

function actionTool(action: WorkOrderAction): string {
  return WORK_ORDER_ACTION_TOOLS[action];
}

function blockingDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((item) => item.severity === "error");
}

function baseOrder(input: {
  action: WorkOrderAction;
  target: string | null;
  targetSource: NextWorkOrder["targetSource"];
  requirementIds: string[];
  artifacts: NextWorkOrder["artifacts"];
  sds: WorkOrderSds | null;
  reason: string;
  blocking: boolean;
  diagnostics: Diagnostic[];
  pipeline?: NextWorkOrder["pipeline"];
  options?: Pick<NextWorkOrderOptions, "explain" | "profile" | "contextProfile">;
  /** Why the resolved target cannot be handed work, when that is the reason for the order. */
  targetUnavailable?: string;
}): NextWorkOrder {
  const blockers = blockingDiagnostics(input.diagnostics);
  const profile = input.options?.profile ?? (input.options?.explain ? "explain" : "default");
  const includeExplain = input.options?.explain === true || profile === "explain";
  const rejectedCandidates: Array<{ action: WorkOrderAction; reason: string }> = [
    ...(input.action !== "create-sds" ? [{ action: "create-sds" as const, reason: "not selected because the target's work already has an open SDS or nothing to design" }] : []),
    ...(input.action !== "execute-sds" ? [{ action: "execute-sds" as const, reason: "not selected because no agreed SDS is waiting for its first kiwi-pm run" }] : []),
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
    sds: input.sds,
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
            { step: "target", outcome: input.targetSource, reason: input.targetUnavailable ?? (input.target ? `target resolved as ${input.target}` : "no target resolved") },
            { step: "pipeline", outcome: input.pipeline?.latestStatus ?? "none", reason: input.pipeline?.latestStatus ? `latest pipeline status is ${input.pipeline.latestStatus}` : "no blocking pipeline status" },
            { step: "sds", outcome: input.sds?.status ?? "none", reason: input.sds ? `open SDS ${input.sds.relativePath}` : "no open SDS" },
            { step: "decision", outcome: input.action, reason: input.reason }
          ],
          rejectedCandidates,
          blockers
        }
      : {}),
    ...(input.pipeline ? { pipeline: input.pipeline } : {})
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

/** The validator's verdicts that leave the Active Target unregistered (SRS-E017) or ambiguous (SRS-E024). */
const ACTIVE_TARGET_CONFLICTS: ReadonlySet<string> = new Set(["SRS-E017", "SRS-E024"]);

/**
 * Why no work can be handed out for the resolved target, or null when it can. A target the Target Map
 * does not register is unavailable, and an Active Target the validator finds unregistered or ambiguous
 * is too; guessing at either would hand out work for a target nobody chose. The validator stays the one
 * owner of those Active Target rules.
 * @req FR-MCP-024 AC-3, FR-MCP-035 AC-3, IR-CLI-032 AC-3, IR-CLI-041 AC-3
 */
function targetUnavailableReason(workspace: ParsedWorkspace, target: string, targetSource: NextWorkOrder["targetSource"], diagnostics: Diagnostic[]): string | null {
  if (targetSource === "explicit") {
    return workspace.index.targets.some((entry) => entry.target === target) ? null : `target ${target} is not registered in the Target Map`;
  }
  const conflict = diagnostics.find((item) => ACTIVE_TARGET_CONFLICTS.has(item.code));
  return conflict ? `active target ${target} is unavailable (${conflict.code}: ${conflict.message})` : null;
}

function artifactRef(candidate: WorkflowArtifactCandidate): NextWorkOrder["artifacts"][number] {
  return { relativePath: candidate.relativePath, kind: candidate.kind, ...(candidate.sha256 ? { sha256: candidate.sha256 } : {}), mtimeMs: candidate.mtimeMs };
}

interface SdsDecision {
  action: WorkOrderAction;
  reason: string;
  blocking: boolean;
  sds: WorkOrderSds;
  requirementIds: string[];
  artifacts: NextWorkOrder["artifacts"];
}

// kiwi-pm records one run per SDS, `run.status` ∈ pending | running | done | failed | blocked (kiwi-pm SKILL.md §2.2).
const STOPPED_RUN_STATUSES = new Set(["failed", "blocked"]);
const LIVE_RUN_STATUSES = new Set(["pending", "running"]);

/**
 * The next action for one open SDS: its `sds check` errors first, then its lifecycle status, then the
 * kiwi-pm session keyed by its sds-id (SDS-MD-Rules §9.1, FR-NODE-126 AC-3).
 */
async function decideForSds(root: ProjectRoot, workspace: ParsedWorkspace, candidate: WorkflowArtifactCandidate, diagnostics: Diagnostic[]): Promise<SdsDecision> {
  const sdsId = candidate.runId ?? candidate.relativePath;
  const checked = await checkSdsFile(workspace, candidate.relativePath);
  const summary = checked.ok ? checked.value.summary : null;
  const sds: WorkOrderSds = { relativePath: candidate.relativePath, sdsId, status: summary?.status ?? null, target: summary?.target ?? candidate.target ?? null };
  const artifacts = [artifactRef(candidate)];
  const requirementIds = summary?.requirementIds ?? [];
  if (!checked.ok) return { action: "fix-artifact", reason: `sds check could not read ${candidate.relativePath}: ${checked.error.message}`, blocking: true, sds, requirementIds, artifacts };
  diagnostics.push(...checked.value.diagnostics);
  if (checked.value.errors.length > 0) {
    return { action: "fix-artifact", reason: `sds check reports ${checked.value.errors.length} error(s) in ${candidate.relativePath}`, blocking: true, sds, requirementIds, artifacts };
  }
  // @req FR-NODE-211 AC-4 — a `closed` SDS has had its decisions moved into the SRS and is never written
  // again (SDS-MD-Rules §9.1); what is left is its promotion and deletion, not authoring.
  if (sds.status === "closed") {
    return { action: "complete", reason: `SDS ${candidate.relativePath} is closed; its close-out deletes it after promotion`, blocking: false, sds, requirementIds, artifacts };
  }
  if (sds.status !== "agreed") {
    return { action: "create-sds", reason: `SDS ${candidate.relativePath} is ${sds.status ?? "without a status"}; kiwi-sds finishes it and marks it agreed`, blocking: false, sds, requirementIds, artifacts };
  }
  const session = await workflowSessionStatus(root, { runId: sdsId });
  const sessionArtifact = session.artifacts.find((artifact) => artifact.kind === "pm-state" && artifact.runId === sdsId);
  if (!sessionArtifact) return { action: "execute-sds", reason: `SDS ${candidate.relativePath} is agreed and has no kiwi-pm session`, blocking: false, sds, requirementIds, artifacts };
  artifacts.push({ relativePath: sessionArtifact.relativePath, kind: sessionArtifact.kind, ...(sessionArtifact.sha256 ? { sha256: sessionArtifact.sha256 } : {}), mtimeMs: sessionArtifact.mtimeMs });
  diagnostics.push(...session.diagnostics);
  if (session.value.state === null) return { action: "fix-artifact", reason: `kiwi-pm session state ${sessionArtifact.relativePath} cannot be read`, blocking: true, sds, requirementIds, artifacts };
  const runStatus = session.value.state.run?.status;
  // A status outside that vocabulary is neither live, finished nor stopped; reading it as live would
  // report a run nobody can resume as work in progress.
  if (typeof runStatus !== "string" || !(STOPPED_RUN_STATUSES.has(runStatus) || LIVE_RUN_STATUSES.has(runStatus) || runStatus === "done")) {
    return { action: "fix-artifact", reason: `kiwi-pm session ${sessionArtifact.relativePath} records no run status kiwi-pm writes`, blocking: true, sds, requirementIds, artifacts };
  }
  if (STOPPED_RUN_STATUSES.has(runStatus)) {
    return { action: "blocked", reason: `kiwi-pm run for ${sdsId} is ${runStatus}`, blocking: true, sds, requirementIds, artifacts };
  }
  if (runStatus === "done") {
    return { action: "complete", reason: `kiwi-pm session for ${sdsId} finished`, blocking: false, sds, requirementIds, artifacts };
  }
  return { action: "resume-session", reason: `kiwi-pm session for ${sdsId} is in progress`, blocking: false, sds, requirementIds, artifacts };
}

export async function buildNextWorkOrder(root: ProjectRoot, options: NextWorkOrderOptions = {}): Promise<NextWorkOrder> {
  const workspace = await parseWorkspace(root);
  const diagnostics: Diagnostic[] = [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
  // An empty explicit target names no target, so it falls back to the Active Target like an absent one.
  const target = options.target || workspace.index.activeTarget || null;
  const targetSource: NextWorkOrder["targetSource"] = options.target ? "explicit" : workspace.index.activeTarget ? "active-target" : "none";
  const targetRecords = target ? workspace.records.filter((record) => record.target === target) : [];
  const baselineValue = targetRecords.map((record) => ({ id: record.id, title: record.title, status: record.status, target: record.target, markdown: record.markdown }));

  const pipeline = await pipelineState(root, options, diagnostics);
  const pipelinePayload = { latestStatus: pipeline.latestStatus, latestEventKey: pipeline.latestEventKey };
  const unavailable = target ? targetUnavailableReason(workspace, target, targetSource, diagnostics) : null;
  if (!target || unavailable) {
    // An unregistered or ambiguous Active Target is already an SRS-E017 or SRS-E024 from the validator.
    if (targetSource !== "active-target") {
      diagnostics.push(diagnostic("SRS-W002", "warning", `Target is not registered: ${target ?? "<empty>"}`, {}, { kind: target ? "unregistered-target" : "missing-target" }));
    }
    const order = baseOrder({
      action: "blocked",
      target,
      targetSource,
      requirementIds: [],
      artifacts: pipeline.artifacts,
      sds: null,
      reason: unavailable ?? "no active target or explicit target is available",
      blocking: true,
      diagnostics,
      pipeline: pipelinePayload,
      options,
      ...(unavailable ? { targetUnavailable: unavailable } : {})
    });
    return options.measure ? withMeasurement(order, baselineValue) : order;
  }

  if (pipeline.latestStatus !== null && PIPELINE_STOP_STATUSES.has(pipeline.latestStatus)) {
    const action: WorkOrderAction = pipeline.latestStatus === "NEEDS_USER" ? "ask-user" : "blocked";
    const order = baseOrder({
      action,
      target,
      targetSource,
      requirementIds: targetRecords.map((record) => record.id),
      artifacts: pipeline.artifacts,
      sds: null,
      reason: `pipeline latest status is ${pipeline.latestStatus}`,
      blocking: true,
      diagnostics,
      pipeline: pipelinePayload,
      options
    });
    return options.measure ? withMeasurement(order, baselineValue) : order;
  }

  const sdsResolution = await resolveWorkflowArtifacts(root, {
    ...(options.path ? { explicitPath: options.path } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
    target,
    kind: "sds",
    allowAmbiguous: true
  });
  diagnostics.push(...sdsResolution.diagnostics);
  // Open SDS files of this target, in path order: the order is part of the answer, so it is not left
  // to modification times.
  const openSds = sdsResolution.candidates
    .filter((candidate) => options.path !== undefined || ((candidate.target ?? null) === target && (!options.runId || candidate.runId === options.runId)))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // A named SDS that is not there fails closed; widening to the whole target would answer a question
  // the caller did not ask.
  if ((options.path || options.runId) && openSds.length === 0) {
    const order = baseOrder({
      action: "fix-artifact",
      target,
      targetSource,
      requirementIds: [],
      artifacts: pipeline.artifacts,
      sds: null,
      reason: options.path
        ? `${options.path} is not an SDS; a work order reads docs/sds/<sds-id>.sds.md`
        : `no open SDS of target ${target} has the sds-id ${options.runId}`,
      blocking: true,
      diagnostics,
      pipeline: pipelinePayload,
      options
    });
    return options.measure ? withMeasurement(order, baselineValue) : order;
  }

  let finished: SdsDecision | undefined;
  const named = new Set<string>();
  for (const candidate of openSds) {
    const decision = await decideForSds(root, workspace, candidate, diagnostics);
    for (const id of decision.requirementIds) named.add(id);
    if (decision.action === "complete") {
      finished ??= decision;
      continue;
    }
    const order = baseOrder({ ...decision, target, targetSource, diagnostics, pipeline: { ...pipelinePayload }, options, artifacts: [...decision.artifacts, ...pipeline.artifacts] });
    return options.measure ? withMeasurement(order, baselineValue) : order;
  }
  const targetSummary = summarizeTarget(workspace, { target, diagnostics });
  const candidates = targetSummary.newWorkCandidates.length > 0 ? targetSummary.newWorkCandidates : targetRecords.map((record) => record.id);
  // Requirements a finished SDS already names are that SDS's work; the rest still need one.
  const requirementIds = candidates.filter((id) => !named.has(id));
  if (finished && (requirementIds.length === 0 || options.path || options.runId)) {
    const order = baseOrder({ ...finished, target, targetSource, diagnostics, pipeline: pipelinePayload, options, artifacts: [...finished.artifacts, ...pipeline.artifacts] });
    return options.measure ? withMeasurement(order, baselineValue) : order;
  }

  const action: WorkOrderAction = requirementIds.length > 0 ? "create-sds" : "no-action";
  const order = baseOrder({
    action,
    target,
    targetSource,
    requirementIds,
    artifacts: pipeline.artifacts,
    sds: null,
    reason: action === "create-sds" ? "target has active requirements but no open SDS" : "target has no active work candidates",
    blocking: false,
    diagnostics,
    pipeline: pipelinePayload,
    options
  });
  return options.measure ? withMeasurement(order, baselineValue) : order;
}
