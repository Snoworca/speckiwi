import { readFile } from "node:fs/promises";
import { diagnostic } from "../diagnostic.js";
import { summarizeDiagnostics } from "../diagnostic.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type { Diagnostic, DiagnosticsSummary, ProjectRoot } from "../types.js";
import { resolveWorkflowArtifacts, type WorkflowArtifactCandidate, type WorkflowArtifactKind } from "./artifacts.js";
import { parseWorkflowJsonl, type WorkflowJsonlEntry } from "./jsonl.js";
import { validateWorkflowArtifacts, type WorkflowValidationResult } from "./validate.js";
import { parseWavesJournal } from "../orchestrator/waves-journal.js";
import { validateWavesJournal } from "../orchestrator/waves-validate.js";

export interface WorkflowArtifactRef {
  relativePath: string;
  kind: WorkflowArtifactKind;
  legacy: boolean;
  confidence: number;
  score: number;
  runId?: string;
  target?: string;
  generatedAt?: string;
  mtimeMs: number;
  sha256?: string;
  companion?: WorkflowArtifactCandidate["companion"];
  body?: string;
}

export interface WorkflowReadEnvelope<T> {
  ok: true;
  value: T;
  meta: {
    workspaceRoot: string;
    generatedAt: string;
  };
  artifacts: WorkflowArtifactRef[];
  cursor?: {
    limit?: number;
    returned: number;
    total: number;
    nextOffset: number | null;
  };
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
}

export interface WorkflowReadOptions {
  path?: string;
  runId?: string;
  target?: string;
  kind?: WorkflowArtifactKind;
  includeBody?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  allowAmbiguous?: boolean;
}

interface SidecarTask {
  id?: string;
  task_id?: string;
  phase_id?: string;
  title?: string;
  depends_on_task?: string[];
  req_ids?: string[];
  status?: string;
}

interface SidecarPlan {
  run_id?: string;
  target?: string;
  generated_at?: string;
  tasks?: SidecarTask[];
}

interface PmStateTask {
  task_id?: string;
  status?: string;
}

interface PmState {
  run_id?: string;
  target_slug?: string;
  tasks?: PmStateTask[];
  stats?: Record<string, unknown>;
}

export interface WorkflowMigrationPreviewItem {
  source: WorkflowArtifactRef;
  proposedDestination: string | null;
  unsupportedFields: string[];
  lossyTransforms: string[];
  dataLossRisks: string[];
  targetMismatch: boolean;
  pathDrift: boolean;
  schemaMismatch: boolean;
  contractMismatch: boolean;
  requiredManualDecisions: string[];
}

export type WorkflowProjectionKind = "workflow_doctor" | "workflow_diff" | "workflow_schema_check" | "pipeline_compact";

export type WorkflowProjectionOutcomeCode =
  | "invalid_plan_contract"
  | "unsupported_schema_version"
  | "task_state_conflict"
  | "repairable_drift"
  | "stale_artifact"
  | "blocked_dependency"
  | "invalid_artifact"
  | "deleted_record_filtered"
  | "no_actionable_drift";

export interface WorkflowProjectionValue {
  projectionKind: WorkflowProjectionKind;
  outcomeCodes: WorkflowProjectionOutcomeCode[];
  blocking: boolean;
  artifacts: Array<{ relativePath: string; kind: string; sha256?: string; mtimeMs: number }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function cursor<T>(items: T[], limit?: number, offset = 0): { sliced: T[]; cursor: WorkflowReadEnvelope<unknown>["cursor"] } {
  const start = Math.max(0, offset);
  const end = limit === undefined ? items.length : start + Math.max(0, limit);
  const sliced = items.slice(start, end);
  return {
    sliced,
    cursor: {
      ...(limit !== undefined ? { limit } : {}),
      returned: sliced.length,
      total: items.length,
      nextOffset: end < items.length ? end : null
    }
  };
}

function validationArtifacts(validation: WorkflowValidationResult): WorkflowArtifactRef[] {
  return validation.artifacts.map((item) => ({
    relativePath: item.relativePath,
    kind: item.kind as WorkflowArtifactKind,
    legacy: item.relativePath.startsWith("docs/plan/") || item.relativePath.startsWith(".snoworca/"),
    confidence: 100,
    score: 0,
    mtimeMs: item.mtimeMs,
    ...(item.sha256 ? { sha256: item.sha256 } : {})
  }));
}

function outcomeCodesFromDiagnostics(diagnostics: Diagnostic[]): WorkflowProjectionOutcomeCode[] {
  const codes = new Set<WorkflowProjectionOutcomeCode>();
  for (const item of diagnostics) {
    if (item.code === "SRS-W055") codes.add("unsupported_schema_version");
    if (item.code === "SRS-W058" || item.code === "SRS-W063") codes.add("task_state_conflict");
    if (item.code === "SRS-W060") codes.add("repairable_drift");
    if (item.code === "SRS-W059" || item.code === "SRS-E032") codes.add("stale_artifact");
    if (item.code === "SRS-W057" || item.code === "SRS-E074") codes.add("blocked_dependency");
    if (item.code === "SRS-W050" || item.code === "SRS-W051" || item.code === "SRS-W052" || item.code === "SRS-W056" || item.code === "SRS-W069" || item.severity === "error") {
      codes.add("invalid_artifact");
    }
  }
  return [...codes];
}

function outcomeCodesFromValidation(validation: WorkflowValidationResult): WorkflowProjectionOutcomeCode[] {
  const codes = new Set(outcomeCodesFromDiagnostics(validation.diagnostics));
  if (validation.outcome === "repairable_drift") codes.add("repairable_drift");
  if (validation.outcome === "stale_artifact") codes.add("stale_artifact");
  if (validation.outcome === "blocked_dependency") codes.add("blocked_dependency");
  if (validation.outcome === "invalid_artifact") codes.add("invalid_artifact");
  if (validation.outcome === "resume-blocked") codes.add("task_state_conflict");
  if (validation.outcome === "confirmed_done" || (validation.outcome === "ok" && !validation.nextTask)) codes.add("no_actionable_drift");
  return [...codes];
}

function projectionBlocking(codes: WorkflowProjectionOutcomeCode[], defaultBlocking: boolean): boolean {
  return defaultBlocking || codes.some((code) => ["invalid_plan_contract", "unsupported_schema_version", "stale_artifact", "blocked_dependency", "invalid_artifact"].includes(code));
}

function diffClassFor(code: string): string {
  if (code === "SRS-W050" || code === "SRS-W051" || code === "SRS-W055") return "schema";
  if (code === "SRS-W052" || code === "SRS-W054" || code === "SRS-W056" || code === "SRS-W069") return "jsonl";
  if (code === "SRS-W057" || code === "SRS-E074") return "dependency";
  if (code === "SRS-W058") return "task_state";
  if (code === "SRS-W059" || code === "SRS-E032") return "stale_hash";
  if (code === "SRS-W060") return "display_drift";
  if (code === "SRS-W061") return "legacy_trace";
  if (code === "SRS-W062") return "lock";
  if (code === "SRS-W063") return "audit";
  if (code === "SRS-W064") return "missing_req_ids";
  return "diagnostic";
}

async function artifactRef(candidate: WorkflowArtifactCandidate, includeBody = false): Promise<WorkflowArtifactRef> {
  const body = includeBody ? await readFile(candidate.absolutePath, "utf8").catch(() => undefined) : undefined;
  return {
    relativePath: candidate.relativePath,
    kind: candidate.kind,
    legacy: candidate.legacy,
    confidence: candidate.confidence,
    score: candidate.score,
    mtimeMs: candidate.mtimeMs,
    ...(candidate.runId ? { runId: candidate.runId } : {}),
    ...(candidate.target ? { target: candidate.target } : {}),
    ...(candidate.generatedAt ? { generatedAt: candidate.generatedAt } : {}),
    ...(candidate.sha256 ? { sha256: candidate.sha256 } : {}),
    ...(candidate.companion ? { companion: candidate.companion } : {}),
    ...(body !== undefined ? { body } : {})
  };
}

function envelope<T>(root: string, value: T, diagnostics: Diagnostic[], artifacts: WorkflowArtifactRef[], cursorValue?: WorkflowReadEnvelope<T>["cursor"]): WorkflowReadEnvelope<T> {
  return {
    ok: true,
    value,
    meta: { workspaceRoot: root, generatedAt: nowIso() },
    artifacts,
    ...(cursorValue ? { cursor: cursorValue } : {}),
    diagnostics,
    diagnosticsSummary: summarizeDiagnostics(diagnostics)
  };
}

async function resolve(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  return resolveWorkflowArtifacts(root, {
    ...(options.path ? { explicitPath: options.path } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.allowAmbiguous !== undefined ? { allowAmbiguous: options.allowAmbiguous } : {})
  });
}

async function parseJsonFile<T>(candidate: WorkflowArtifactCandidate, diagnostics: Diagnostic[]): Promise<T | null> {
  try {
    return JSON.parse(await readFile(candidate.absolutePath, "utf8")) as T;
  } catch (error) {
    diagnostics.push(diagnostic("SRS-W050", "warning", `Workflow artifact parse warning: ${candidate.relativePath}`, { filePath: candidate.relativePath }, { message: (error as Error).message }));
    return null;
  }
}

async function parseJsonValue(candidate: WorkflowArtifactCandidate): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(candidate.absolutePath, "utf8")) as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function legacyDestination(relativePath: string): string | null {
  if (relativePath.startsWith("docs/plan/")) return relativePath.replace(/^docs\/plan\//, "docs/plans/");
  if (relativePath.startsWith(".snoworca/sessions/")) return relativePath.replace(/^\.snoworca\/sessions\//, ".kiwi/sessions/");
  return null;
}

function unsupportedLegacyFields(candidate: WorkflowArtifactCandidate, value: Record<string, unknown> | null): string[] {
  const fields = new Set<string>();
  if (!value) return [];
  const allowed = new Set(["schema_version", "plan_contract", "run_id", "target", "target_slug", "generated_at", "tasks", "stats", "plan_sha256", "sidecar_sha256", "current_task_id", "completed_task_ids", "failed_task_ids"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fields.add(key);
  }
  const tasks = Array.isArray(value.tasks) ? value.tasks : [];
  for (const task of tasks) {
    if (typeof task === "object" && task !== null && Array.isArray((task as { traces?: unknown }).traces)) fields.add("tasks[].traces");
  }
  if (candidate.relativePath.endsWith(".jsonl")) {
    fields.add("jsonl-line-shape");
  }
  return [...fields].sort();
}

function lossyTransformsFor(unsupportedFields: string[], targetMismatch: boolean, contractMismatch: boolean): string[] {
  const transforms: string[] = [];
  if (unsupportedFields.includes("tasks[].traces")) transforms.push("legacy traces[] require manual req_ids mapping");
  if (unsupportedFields.length > 0) transforms.push("unsupported legacy fields cannot be mapped automatically");
  if (targetMismatch) transforms.push("legacy target differs from requested target");
  if (contractMismatch) transforms.push("missing run_id or target requires manual workflow identity decision");
  return [...new Set(transforms)];
}

function manualDecisionsFor(item: Pick<WorkflowMigrationPreviewItem, "unsupportedFields" | "lossyTransforms" | "targetMismatch" | "pathDrift" | "schemaMismatch" | "contractMismatch">): string[] {
  const decisions: string[] = [];
  if (item.unsupportedFields.length > 0) decisions.push("review unsupported legacy fields");
  if (item.lossyTransforms.length > 0) decisions.push("approve or reject lossy transforms");
  if (item.targetMismatch) decisions.push("choose target mapping");
  if (item.pathDrift) decisions.push("confirm proposed destination path");
  if (item.schemaMismatch) decisions.push("repair malformed legacy artifact before migration");
  if (item.contractMismatch) decisions.push("choose workflow run identity");
  return decisions;
}

async function sidecarForPlan(root: ProjectRoot, plan: WorkflowArtifactCandidate | null, diagnostics: Diagnostic[]): Promise<{ sidecar: SidecarPlan | null; sidecarArtifact: WorkflowArtifactCandidate | null }> {
  if (!plan?.companion?.sidecarPath) return { sidecar: null, sidecarArtifact: null };
  const resolved = await resolveWorkflowArtifacts(root, { explicitPath: plan.companion.sidecarPath, kind: "sidecar", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const sidecarArtifact = resolved.selected;
  return { sidecar: sidecarArtifact ? await parseJsonFile<SidecarPlan>(sidecarArtifact, diagnostics) : null, sidecarArtifact };
}

function taskId(task: SidecarTask): string {
  return String(task.id ?? task.task_id ?? "");
}

export async function workflowWorkspaceInfo(root: ProjectRoot): Promise<WorkflowReadEnvelope<{ workspaceRoot: string; activeTarget: string }>> {
  const workspace = await parseWorkspace(root);
  return envelope(root.root, { workspaceRoot: root.root, activeTarget: workspace.index.activeTarget }, workspace.diagnostics, []);
}

export async function workflowArtifacts(root: ProjectRoot, options: WorkflowReadOptions = {}): Promise<WorkflowReadEnvelope<{ artifacts: WorkflowArtifactRef[]; selected: WorkflowArtifactRef | null }>> {
  const resolved = await resolve(root, options);
  const refs = await Promise.all(resolved.candidates.map((candidate) => artifactRef(candidate, options.includeBody)));
  const selected = resolved.selected ? await artifactRef(resolved.selected, options.includeBody) : null;
  const { sliced, cursor: cursorValue } = cursor(refs, options.limit, options.offset);
  return envelope(resolved.workspaceRoot, { artifacts: sliced, selected }, resolved.diagnostics, refs, cursorValue);
}

export async function workflowMigrationPreview(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const resolved = await resolveWorkflowArtifacts(root, {
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.target ? { target: options.target } : {}),
    allowAmbiguous: true
  });
  const diagnostics = [...resolved.diagnostics];
  const legacy = resolved.candidates.filter((candidate) => candidate.legacy);
  const current = resolved.candidates.filter((candidate) => !candidate.legacy);
  const previews: WorkflowMigrationPreviewItem[] = [];
  for (const candidate of legacy) {
    const source = await artifactRef(candidate, options.includeBody);
    const proposedDestination = legacyDestination(candidate.relativePath);
    const value = await parseJsonValue(candidate);
    const unsupportedFields = unsupportedLegacyFields(candidate, value);
    const targetMismatch = Boolean(options.target && candidate.target && candidate.target !== options.target);
    const pathDrift = proposedDestination !== null && proposedDestination !== candidate.relativePath;
    const schemaMismatch = candidate.parseErrors.length > 0;
    const contractMismatch = !candidate.runId || (candidate.kind === "legacy" && candidate.relativePath.endsWith(".plan.md") && !candidate.target);
    const lossyTransforms = lossyTransformsFor(unsupportedFields, targetMismatch, contractMismatch);
    const dataLossRisks = [...lossyTransforms, ...(schemaMismatch ? ["malformed legacy artifact cannot be mapped automatically"] : [])];
    const previewBase = {
      source,
      proposedDestination,
      unsupportedFields,
      lossyTransforms,
      dataLossRisks,
      targetMismatch,
      pathDrift,
      schemaMismatch,
      contractMismatch
    };
    previews.push({ ...previewBase, requiredManualDecisions: manualDecisionsFor(previewBase) });
  }
  const legacyRefs = previews.map((item) => item.source);
  const currentRefs = await Promise.all(current.map((candidate) => artifactRef(candidate, false)));
  return envelope(
    resolved.workspaceRoot,
    {
      written: false,
      legacyArtifacts: previews,
      currentArtifacts: currentRefs,
      manualDecisionCount: previews.reduce((sum, item) => sum + item.requiredManualDecisions.length, 0)
    },
    diagnostics,
    [...legacyRefs, ...currentRefs]
  );
}

/**
 * The run journal's own diagnostics, offered here as a convenience surface only.
 *
 * @req FR-NODE-127 AC-5 — enforcement lives at `orchestrate journal append` and `orchestrate
 * resume`; the doctor is on-demand, so calling it is a choice and it is not the enforcement path.
 * Scoped to a named run and skipped when no journal exists, so no existing caller's diagnostics
 * change.
 */
async function wavesJournalDiagnostics(root: ProjectRoot, runId: string | undefined): Promise<Diagnostic[]> {
  if (!runId) return [];
  try {
    const view = await parseWavesJournal(root, { runId, engine: "kiwi-orchestrator" });
    return view.lines.length === 0 ? [] : validateWavesJournal(view);
  } catch {
    return [];
  }
}

export async function workflowDoctor(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const validation = await validateWorkflowArtifacts(root, {
    ...(options.path ? { path: options.path } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.allowAmbiguous !== undefined ? { allowAmbiguous: options.allowAmbiguous } : {})
  });
  const outcomeCodes = outcomeCodesFromValidation(validation);
  const artifacts = validationArtifacts(validation);
  const journalDiagnostics = await wavesJournalDiagnostics(root, options.runId);
  return envelope(
    root.root,
    {
      projectionKind: "workflow_doctor" as const,
      outcomeCodes,
      blocking: projectionBlocking(outcomeCodes, validation.blocking),
      artifacts: validation.artifacts,
      validation: {
        outcome: validation.outcome,
        blocking: validation.blocking,
        nextTask: validation.nextTask,
        blockedBy: validation.blockedBy,
        dependencyIssues: validation.dependencyIssues
      }
    },
    [...validation.diagnostics, ...journalDiagnostics],
    artifacts
  );
}

export async function workflowDiff(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const doctor = await workflowDoctor(root, options);
  const diffs = doctor.diagnostics.map((item) => ({
    class: diffClassFor(item.code),
    code: item.code,
    severity: item.severity,
    ...(item.filePath ? { filePath: item.filePath } : {}),
    ...(typeof item.line === "number" ? { line: item.line } : {}),
    ...(item.details !== undefined ? { details: item.details } : {})
  }));
  return envelope(
    doctor.meta.workspaceRoot,
    {
      projectionKind: "workflow_diff" as const,
      outcomeCodes: doctor.value.outcomeCodes,
      blocking: doctor.value.blocking,
      artifacts: doctor.value.artifacts,
      diffs,
      noActionableDrift: diffs.length === 0
    },
    doctor.diagnostics,
    doctor.artifacts
  );
}

export async function workflowSchemaCheck(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const validation = await validateWorkflowArtifacts(root, {
    ...(options.path ? { path: options.path } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.allowAmbiguous !== undefined ? { allowAmbiguous: options.allowAmbiguous } : {})
  });
  const outcomeCodes = outcomeCodesFromValidation(validation);
  const schemaCodes = outcomeCodes.filter((code) => ["invalid_plan_contract", "unsupported_schema_version", "invalid_artifact", "stale_artifact"].includes(code));
  const artifacts = validationArtifacts(validation);
  return envelope(
    root.root,
    {
      projectionKind: "workflow_schema_check" as const,
      outcomeCodes: schemaCodes.length > 0 ? schemaCodes : ["no_actionable_drift" as const],
      blocking: projectionBlocking(schemaCodes, validation.blocking),
      artifacts: validation.artifacts,
      validation: {
        outcome: validation.outcome,
        blocking: validation.blocking
      }
    },
    validation.diagnostics,
    artifacts
  );
}

export async function workflowPipelineCompact(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const resolved = await resolve(root, { ...options, kind: "pipeline", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const parsed = resolved.selected ? await parseWorkflowJsonl(root, resolved.selected.relativePath, { ...(options.includeDeleted ? { includeDeleted: true } : {}) }) : null;
  const parsedWithDeleted = resolved.selected && !options.includeDeleted ? await parseWorkflowJsonl(root, resolved.selected.relativePath, { includeDeleted: true }) : parsed;
  if (parsed) diagnostics.push(...parsed.diagnostics);
  const artifacts = resolved.selected ? [await artifactRef(resolved.selected, false)] : [];
  const deletedFiltered = parsedWithDeleted?.latestEntries.filter((entry) => (entry.deletedBy ?? []).length > 0).length ?? 0;
  const outcomeCodes = new Set<WorkflowProjectionOutcomeCode>(outcomeCodesFromDiagnostics(diagnostics));
  if (deletedFiltered > 0) outcomeCodes.add("deleted_record_filtered");
  if (outcomeCodes.size === 0) outcomeCodes.add("no_actionable_drift");
  const latestEvent = parsed?.latestEntries.at(-1) ?? null;
  const codes = [...outcomeCodes];
  return envelope(
    resolved.workspaceRoot,
    {
      projectionKind: "pipeline_compact" as const,
      outcomeCodes: codes,
      blocking: projectionBlocking(codes, false),
      artifacts: artifacts.map((artifact) => ({
        relativePath: artifact.relativePath,
        kind: artifact.kind,
        ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
        mtimeMs: artifact.mtimeMs
      })),
      latestEvent,
      latestStatus: typeof latestEvent?.event.status === "string" ? latestEvent.event.status : null,
      total: parsed?.entries.length ?? 0,
      active: parsed?.latestEntries.length ?? 0,
      deletedFiltered,
      invalidLines: parsed?.invalidLines ?? []
    },
    diagnostics,
    artifacts
  );
}

export async function workflowPlanStatus(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const resolved = await resolve(root, { ...options, kind: "plan" });
  diagnostics.push(...resolved.diagnostics);
  const { sidecar, sidecarArtifact } = await sidecarForPlan(root, resolved.selected, diagnostics);
  const artifacts = await Promise.all([resolved.selected, sidecarArtifact].filter((item): item is WorkflowArtifactCandidate => item !== null).map((item) => artifactRef(item, options.includeBody)));
  const tasks = sidecar?.tasks ?? [];
  return envelope(
    resolved.workspaceRoot,
    {
      plan: resolved.selected ? await artifactRef(resolved.selected, false) : null,
      sidecar: sidecarArtifact ? await artifactRef(sidecarArtifact, false) : null,
      taskCount: tasks.length,
      tasks: tasks.map((task) => ({ id: taskId(task), phase_id: task.phase_id, title: task.title, depends_on_task: task.depends_on_task ?? [], req_ids: task.req_ids ?? [] }))
    },
    diagnostics,
    artifacts
  );
}

export async function workflowPlanTask(root: ProjectRoot, taskIdValue: string, options: WorkflowReadOptions = {}) {
  const status = await workflowPlanStatus(root, options);
  const tasks = status.value.tasks as Array<Record<string, unknown>>;
  const task = tasks.find((item) => item.id === taskIdValue) ?? null;
  return envelope(status.meta.workspaceRoot, { task }, status.diagnostics, status.artifacts);
}

export async function workflowNextPlanTask(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const validation = await validateWorkflowArtifacts(root, {
    ...(options.path ? { path: options.path } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(options.allowAmbiguous !== undefined ? { allowAmbiguous: options.allowAmbiguous } : {})
  });
  const artifacts: WorkflowArtifactRef[] = validation.artifacts.map((item) => ({
    relativePath: item.relativePath,
    kind: item.kind as WorkflowArtifactKind,
    legacy: item.relativePath.startsWith("docs/plan/") || item.relativePath.startsWith(".snoworca/"),
    confidence: 100,
    score: 0,
    mtimeMs: item.mtimeMs,
    ...(item.sha256 ? { sha256: item.sha256 } : {})
  }));
  return envelope(
    root.root,
    {
      nextTask: validation.nextTask,
      blockedBy: validation.blockedBy,
      ...(validation.blockedTask ? { blockedTask: validation.blockedTask } : {}),
      dependencyIssues: validation.dependencyIssues,
      outcome: validation.outcome,
      blocking: validation.blocking,
      validation: {
        outcome: validation.outcome,
        blocking: validation.blocking,
        taskCatalog: validation.taskCatalog,
        ...(validation.pipeline ? { pipeline: validation.pipeline } : {}),
        ...(validation.worklog ? { worklog: validation.worklog } : {})
      }
    },
    validation.diagnostics,
    artifacts
  );
}

export async function workflowPipelineStatus(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const resolved = await resolve(root, { ...options, kind: "pipeline", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const parsed = resolved.selected ? await parseWorkflowJsonl(root, resolved.selected.relativePath, { ...(options.includeDeleted ? { includeDeleted: true } : {}) }) : null;
  if (parsed) diagnostics.push(...parsed.diagnostics);
  const latestEvent = parsed?.latestEntries.at(-1) ?? null;
  const artifacts = resolved.selected ? [await artifactRef(resolved.selected, false)] : [];
  return envelope(resolved.workspaceRoot, { latestEvent, total: parsed?.entries.length ?? 0, invalidLines: parsed?.invalidLines ?? [] }, diagnostics, artifacts);
}

export async function workflowPipelineTail(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const status = await workflowPipelineStatus(root, options);
  const artifact = status.artifacts[0];
  const parsed = artifact ? await parseWorkflowJsonl(root, artifact.relativePath, { ...(options.includeDeleted ? { includeDeleted: true } : {}) }) : null;
  const tail = parsed?.latestEntries ?? [];
  const { sliced, cursor: cursorValue } = cursor(tail, options.limit ?? 20, options.offset);
  return envelope(status.meta.workspaceRoot, { events: sliced }, status.diagnostics, status.artifacts, cursorValue);
}

export async function workflowPipelineNext(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const status = await workflowPipelineStatus(root, options);
  const latest = status.value.latestEvent as WorkflowJsonlEntry | null;
  return envelope(status.meta.workspaceRoot, { nextHint: latest?.event.next_hint ?? null, latestEvent: latest }, status.diagnostics, status.artifacts);
}

export async function workflowSessionStatus(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const resolved = await resolve(root, { ...options, kind: "pm-state", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const state = resolved.selected ? await parseJsonFile<PmState>(resolved.selected, diagnostics) : null;
  const artifacts = resolved.selected ? [await artifactRef(resolved.selected, options.includeBody)] : [];
  return envelope(resolved.workspaceRoot, { state, stats: state?.stats ?? null, tasks: state?.tasks ?? [] }, diagnostics, artifacts);
}

export async function workflowResumeHint(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const next = await workflowNextPlanTask(root, options);
  const value = next.value as { nextTask: unknown; blocking?: boolean };
  return envelope(next.meta.workspaceRoot, { resume: value.blocking !== true && value.nextTask !== null, ...next.value }, next.diagnostics, next.artifacts);
}

export async function workflowWorklogTail(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const resolved = await resolve(root, { ...options, kind: "worklog", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const parsed = resolved.selected ? await parseWorkflowJsonl(root, resolved.selected.relativePath, { ...(options.includeDeleted ? { includeDeleted: true } : {}) }) : null;
  if (parsed) diagnostics.push(...parsed.diagnostics);
  const tail = parsed?.latestEntries ?? [];
  const { sliced, cursor: cursorValue } = cursor(tail, options.limit ?? 20, options.offset);
  const artifacts = resolved.selected ? [await artifactRef(resolved.selected, false)] : [];
  return envelope(resolved.workspaceRoot, { events: sliced }, diagnostics, artifacts, cursorValue);
}
