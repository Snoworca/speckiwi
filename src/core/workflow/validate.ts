import { readFile, stat } from "node:fs/promises";
import { diagnostic } from "../diagnostic.js";
import { summarizeDiagnostics } from "../diagnostic.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import type { Diagnostic, DiagnosticsSummary, ProjectRoot } from "../types.js";
import { resolveWorkflowArtifacts, type ResolveWorkflowArtifactOptions, type WorkflowArtifactCandidate, type WorkflowArtifactKind } from "./artifacts.js";
import { parseWorkflowJsonl, type WorkflowJsonlParseResult } from "./jsonl.js";

export type WorkflowValidationOutcome = "ok" | "confirmed_done" | "repairable_drift" | "stale_artifact" | "blocked_dependency" | "needs_user" | "invalid_artifact" | "resume-blocked";

export interface WorkflowValidationOptions extends ResolveWorkflowArtifactOptions {
  path?: string;
  staleLockMs?: number;
}

export interface WorkflowTaskCatalogEntry {
  id: string;
  phase_id?: string;
  title?: string;
  depends_on_task: string[];
  req_ids: string[];
  legacyReqIds: string[];
  status: string;
}

export interface WorkflowValidationResult {
  outcome: WorkflowValidationOutcome;
  blocking: boolean;
  nextTask: WorkflowTaskCatalogEntry | null;
  blockedBy: string[];
  blockedTask?: WorkflowTaskCatalogEntry;
  taskCatalog: WorkflowTaskCatalogEntry[];
  dependencyIssues: Array<{ taskId: string; issue: string; path?: string[] }>;
  diagnostics: Diagnostic[];
  diagnosticsSummary: DiagnosticsSummary;
  artifacts: Array<{ relativePath: string; kind: string; sha256?: string; mtimeMs: number }>;
  pipeline?: { total: number; invalidLines: WorkflowJsonlParseResult["invalidLines"] };
  worklog?: { total: number; invalidLines: WorkflowJsonlParseResult["invalidLines"] };
}

interface SidecarTask {
  id?: string;
  task_id?: string;
  phase_id?: string;
  title?: string;
  depends_on_task?: string[];
  req_ids?: string[];
  traces?: Array<{ req_id?: string; reqId?: string; reference?: string }>;
  status?: string;
}

interface SidecarPlan {
  run_id?: string;
  target?: string;
  tasks?: SidecarTask[];
}

interface PmStateTask {
  task_id?: string;
  status?: string;
}

interface PmState {
  run_id?: string;
  plan_sha256?: string;
  sidecar_sha256?: string;
  tasks?: PmStateTask[];
}

interface CoderState {
  current_task_id?: string | null;
  completed_task_ids?: string[];
  skipped_task_ids?: string[];
  failed_task_ids?: string[];
}

interface LockState {
  started_at?: string;
  acquiredAt?: string;
}

const DEFAULT_STALE_LOCK_MS = 30 * 60 * 1000;

function artifactSummary(candidate: WorkflowArtifactCandidate | null): WorkflowValidationResult["artifacts"][number] | null {
  if (!candidate) return null;
  return {
    relativePath: candidate.relativePath,
    kind: candidate.kind,
    ...(candidate.sha256 ? { sha256: candidate.sha256 } : {}),
    mtimeMs: candidate.mtimeMs
  };
}

async function parseJson<T>(candidate: WorkflowArtifactCandidate, diagnostics: Diagnostic[]): Promise<T | null> {
  try {
    return JSON.parse(await readFile(candidate.absolutePath, "utf8")) as T;
  } catch (error) {
    diagnostics.push(diagnostic("SRS-W050", "warning", `Workflow artifact parse warning: ${candidate.relativePath}`, { filePath: candidate.relativePath }, { message: (error as Error).message }));
    return null;
  }
}

async function optionalJson<T>(root: ProjectRoot, relativePath: string, kind: WorkflowArtifactKind, diagnostics: Diagnostic[]): Promise<{ value: T | null; artifact: WorkflowArtifactCandidate | null }> {
  const absolutePath = await resolveInsideRoot(root.root, relativePath);
  try {
    await stat(absolutePath);
  } catch {
    return { value: null, artifact: null };
  }
  const resolved = await resolveWorkflowArtifacts(root, { explicitPath: relativePath, kind, allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const artifact = resolved.selected;
  return { value: artifact ? await parseJson<T>(artifact, diagnostics) : null, artifact };
}

async function sidecarForPlan(root: ProjectRoot, plan: WorkflowArtifactCandidate | null, diagnostics: Diagnostic[]): Promise<{ sidecar: SidecarPlan | null; artifact: WorkflowArtifactCandidate | null }> {
  if (!plan?.companion?.sidecarPath) return { sidecar: null, artifact: null };
  const resolved = await resolveWorkflowArtifacts(root, { explicitPath: plan.companion.sidecarPath, kind: "sidecar", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const artifact = resolved.selected;
  return { sidecar: artifact ? await parseJson<SidecarPlan>(artifact, diagnostics) : null, artifact };
}

function taskId(task: SidecarTask): string {
  return String(task.id ?? task.task_id ?? "");
}

function legacyReqIds(task: SidecarTask): string[] {
  const ids = new Set<string>();
  for (const trace of task.traces ?? []) {
    const value = trace.req_id ?? trace.reqId ?? trace.reference;
    if (typeof value === "string" && value.length > 0) ids.add(value);
  }
  return [...ids];
}

function pmStatuses(state: PmState | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of state?.tasks ?? []) {
    if (typeof task.task_id === "string" && typeof task.status === "string") map.set(task.task_id, task.status);
  }
  return map;
}

function doneLike(status: string | undefined): boolean {
  return status === "done" || status === "skipped";
}

function normalizeTasks(tasks: SidecarTask[], state: PmState | null, diagnostics: Diagnostic[], sidecarPath?: string): WorkflowTaskCatalogEntry[] {
  const statuses = pmStatuses(state);
  return tasks.map((task) => {
    const id = taskId(task);
    const legacyIds = legacyReqIds(task);
    if (legacyIds.length > 0) {
      diagnostics.push(diagnostic("SRS-W061", "warning", `Workflow legacy trace field: ${id}`, sidecarPath ? { filePath: sidecarPath } : {}, { taskId: id, legacyReqIds: legacyIds }));
    }
    const explicitReqIds = Array.isArray(task.req_ids) ? task.req_ids.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
    const reqIds = explicitReqIds.length > 0 ? explicitReqIds : legacyIds;
    if (reqIds.length === 0) {
      diagnostics.push(diagnostic("SRS-W064", "warning", "Workflow task missing req_ids", sidecarPath ? { filePath: sidecarPath } : {}, { taskId: id }));
    }
    return {
      id,
      ...(typeof task.phase_id === "string" ? { phase_id: task.phase_id } : {}),
      ...(typeof task.title === "string" ? { title: task.title } : {}),
      depends_on_task: Array.isArray(task.depends_on_task) ? task.depends_on_task.filter((item): item is string => typeof item === "string") : [],
      req_ids: reqIds,
      legacyReqIds: legacyIds,
      status: statuses.get(id) ?? task.status ?? "pending"
    };
  });
}

function dependencyIssues(tasks: WorkflowTaskCatalogEntry[]): Array<{ taskId: string; issue: string; path?: string[] }> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const issues: Array<{ taskId: string; issue: string; path?: string[] }> = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      issues.push({ taskId: id, issue: "dependency_cycle", path: [...stack, id] });
      return;
    }
    const task = byId.get(id);
    if (!task) return;
    visiting.add(id);
    for (const dep of task.depends_on_task) {
      if (!byId.has(dep)) issues.push({ taskId: id, issue: "missing_dependency", path: [id, dep] });
      else visit(dep, [...stack, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id, []);
  return issues;
}

function selectNextTask(tasks: WorkflowTaskCatalogEntry[]): { nextTask: WorkflowTaskCatalogEntry | null; blockedBy: string[]; blockedTask?: WorkflowTaskCatalogEntry } {
  for (const task of tasks) {
    if (doneLike(task.status)) continue;
    const blockedBy = task.depends_on_task.filter((dep) => {
      const dependency = tasks.find((item) => item.id === dep);
      return !doneLike(dependency?.status);
    });
    if (blockedBy.length > 0) return { nextTask: null, blockedBy, blockedTask: task };
    return { nextTask: task, blockedBy: [] };
  }
  return { nextTask: null, blockedBy: [] };
}

function planCheckboxes(text: string): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[-*]\s+\[([ xX])\]\s+.*?\b(T-[A-Za-z0-9-]+)\b/.exec(line);
    if (!match) continue;
    map.set(match[2] ?? "", (match[1] ?? " ") !== " ");
  }
  return map;
}

async function checkCheckboxDrift(plan: WorkflowArtifactCandidate | null, tasks: WorkflowTaskCatalogEntry[], state: PmState | null, diagnostics: Diagnostic[]): Promise<void> {
  if (!plan || !state) return;
  const checkboxes = planCheckboxes(await readFile(plan.absolutePath, "utf8"));
  if (checkboxes.size === 0) return;
  for (const task of tasks) {
    if (!checkboxes.has(task.id)) continue;
    const checked = checkboxes.get(task.id) ?? false;
    if (checked !== doneLike(task.status)) {
      diagnostics.push(diagnostic("SRS-W060", "warning", "Workflow plan checkbox drift", { filePath: plan.relativePath }, { taskId: task.id, checkboxChecked: checked, pmStatus: task.status }));
    }
  }
}

function checkStaleHashes(plan: WorkflowArtifactCandidate | null, sidecar: WorkflowArtifactCandidate | null, state: PmState | null, diagnostics: Diagnostic[]): void {
  if (!state) return;
  if (state.plan_sha256 && plan?.sha256 && state.plan_sha256 !== plan.sha256) {
    diagnostics.push(diagnostic("SRS-W059", "warning", "Workflow artifact hash is stale", plan ? { filePath: plan.relativePath } : {}, { kind: "plan", expected: state.plan_sha256, actual: plan.sha256 }));
  }
  if (state.sidecar_sha256 && sidecar?.sha256 && state.sidecar_sha256 !== sidecar.sha256) {
    diagnostics.push(diagnostic("SRS-W059", "warning", "Workflow artifact hash is stale", sidecar ? { filePath: sidecar.relativePath } : {}, { kind: "sidecar", expected: state.sidecar_sha256, actual: sidecar.sha256 }));
  }
}

function checkCoderConflicts(tasks: WorkflowTaskCatalogEntry[], coder: CoderState | null, diagnostics: Diagnostic[], filePath?: string): void {
  if (!coder) return;
  const completed = new Set(coder.completed_task_ids ?? []);
  const skipped = new Set(coder.skipped_task_ids ?? []);
  const failed = new Set(coder.failed_task_ids ?? []);
  for (const task of tasks) {
    const pmDone = doneLike(task.status);
    if (pmDone && coder.current_task_id === task.id) {
      diagnostics.push(diagnostic("SRS-W058", "warning", "Workflow PM and coder state conflict", filePath ? { filePath } : {}, { taskId: task.id, pmStatus: task.status, coderStatus: "current" }));
    }
    if (!pmDone && (completed.has(task.id) || skipped.has(task.id))) {
      diagnostics.push(diagnostic("SRS-W058", "warning", "Workflow PM and coder state conflict", filePath ? { filePath } : {}, { taskId: task.id, pmStatus: task.status, coderStatus: completed.has(task.id) ? "completed" : "skipped" }));
    }
    if (pmDone && failed.has(task.id)) {
      diagnostics.push(diagnostic("SRS-W058", "warning", "Workflow PM and coder state conflict", filePath ? { filePath } : {}, { taskId: task.id, pmStatus: task.status, coderStatus: "failed" }));
    }
  }
}

function checkWorklogAudit(tasks: WorkflowTaskCatalogEntry[], worklog: WorkflowJsonlParseResult | null, diagnostics: Diagnostic[], filePath?: string): void {
  if (!worklog) return;
  const audited = new Set(worklog.entries.map((entry) => entry.event.task_id).filter((item): item is string => typeof item === "string"));
  for (const task of tasks) {
    if (doneLike(task.status) && !audited.has(task.id)) {
      diagnostics.push(diagnostic("SRS-W063", "warning", "Workflow worklog audit mismatch", filePath ? { filePath } : {}, { taskId: task.id, pmStatus: task.status }));
    }
  }
}

async function checkLock(root: ProjectRoot, runId: string | undefined, maxAgeMs: number, diagnostics: Diagnostic[]): Promise<void> {
  if (!runId) return;
  const relativePath = `.kiwi/sessions/${runId}/pm.lock`;
  const { value } = await optionalJson<LockState>(root, relativePath, "lock", diagnostics);
  const startedAt = value?.started_at ?? value?.acquiredAt;
  if (!startedAt) return;
  const timestamp = Date.parse(startedAt);
  if (Number.isFinite(timestamp) && Date.now() - timestamp > maxAgeMs) {
    diagnostics.push(diagnostic("SRS-W062", "warning", "Workflow stale lock", { filePath: relativePath }, { runId, startedAt, maxAgeMs }));
  }
}

function chooseOutcome(
  diagnostics: Diagnostic[],
  selection: ReturnType<typeof selectNextTask>,
  dependencyIssueList: Array<{ taskId: string; issue: string; path?: string[] }>
): { outcome: WorkflowValidationOutcome; blocking: boolean } {
  if (diagnostics.some((item) => item.severity === "error") || dependencyIssueList.some((item) => item.issue === "dependency_cycle" || item.issue === "missing_dependency")) return { outcome: "invalid_artifact", blocking: true };
  if (diagnostics.some((item) => item.code === "SRS-W059")) return { outcome: "stale_artifact", blocking: true };
  if (diagnostics.some((item) => item.code === "SRS-W058" || item.code === "SRS-W063")) return { outcome: "resume-blocked", blocking: true };
  if (selection.blockedBy.length > 0) return { outcome: "blocked_dependency", blocking: true };
  if (diagnostics.some((item) => item.code === "SRS-W060")) return { outcome: "repairable_drift", blocking: false };
  if (diagnostics.some((item) => item.code === "SRS-W064")) return { outcome: "needs_user", blocking: false };
  if (!selection.nextTask) return { outcome: "confirmed_done", blocking: false };
  return { outcome: "ok", blocking: false };
}

export async function validateWorkflowArtifacts(root: ProjectRoot, options: WorkflowValidationOptions = {}): Promise<WorkflowValidationResult> {
  const resolveOptions: ResolveWorkflowArtifactOptions = {
    ...(options.path ? { explicitPath: options.path } : options.explicitPath ? { explicitPath: options.explicitPath } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.target ? { target: options.target } : {}),
    kind: "plan",
    ...(options.allowAmbiguous !== undefined ? { allowAmbiguous: options.allowAmbiguous } : {})
  };
  const resolved = await resolveWorkflowArtifacts(root, resolveOptions);
  const diagnostics = [...resolved.diagnostics];
  const plan = resolved.selected;
  const { sidecar, artifact: sidecarArtifact } = await sidecarForPlan(root, plan, diagnostics);
  if (!plan || !sidecar || !sidecarArtifact) {
    const summary = summarizeDiagnostics(diagnostics);
    return {
      outcome: "invalid_artifact",
      blocking: true,
      nextTask: null,
      blockedBy: [],
      taskCatalog: [],
      dependencyIssues: [],
      diagnostics,
      diagnosticsSummary: summary,
      artifacts: [artifactSummary(plan), artifactSummary(sidecarArtifact)].filter((item): item is WorkflowValidationResult["artifacts"][number] => item !== null)
    };
  }

  const runId = sidecar.run_id ?? plan.runId ?? options.runId;
  const pm = runId ? await optionalJson<PmState>(root, `.kiwi/sessions/${runId}/pm-state.json`, "pm-state", diagnostics) : { value: null, artifact: null };
  const coder = runId ? await optionalJson<CoderState>(root, `.kiwi/sessions/${runId}/state.json`, "coder-state", diagnostics) : { value: null, artifact: null };
  const taskCatalog = normalizeTasks(sidecar.tasks ?? [], pm.value, diagnostics, sidecarArtifact.relativePath);
  const issues = dependencyIssues(taskCatalog);
  for (const issue of issues) {
    diagnostics.push(diagnostic("SRS-W057", "warning", "Workflow task dependency issue", { filePath: sidecarArtifact.relativePath }, issue));
  }
  await checkCheckboxDrift(plan, taskCatalog, pm.value, diagnostics);
  checkStaleHashes(plan, sidecarArtifact, pm.value, diagnostics);
  checkCoderConflicts(taskCatalog, coder.value, diagnostics, coder.artifact?.relativePath);
  await checkLock(root, runId, options.staleLockMs ?? DEFAULT_STALE_LOCK_MS, diagnostics);

  const pipelineResolved = await resolveWorkflowArtifacts(root, { kind: "pipeline", allowAmbiguous: true });
  diagnostics.push(...pipelineResolved.diagnostics);
  const pipeline = pipelineResolved.selected ? await parseWorkflowJsonl(root, pipelineResolved.selected.relativePath) : null;
  if (pipeline) diagnostics.push(...pipeline.diagnostics);
  const worklog = runId ? await parseWorkflowJsonl(root, `.kiwi/sessions/${runId}/worklog.jsonl`) : null;
  if (worklog) diagnostics.push(...worklog.diagnostics);
  checkWorklogAudit(taskCatalog, worklog, diagnostics, worklog?.relativePath);

  const selection = selectNextTask(taskCatalog);
  const { outcome, blocking } = chooseOutcome(diagnostics, selection, issues);
  const nextTask = blocking ? null : selection.nextTask;
  const artifacts = [artifactSummary(plan), artifactSummary(sidecarArtifact), artifactSummary(pm.artifact), artifactSummary(coder.artifact), artifactSummary(pipelineResolved.selected)].filter(
    (item): item is WorkflowValidationResult["artifacts"][number] => item !== null
  );

  return {
    outcome,
    blocking,
    nextTask,
    blockedBy: selection.blockedBy,
    ...(selection.blockedTask ? { blockedTask: selection.blockedTask } : {}),
    taskCatalog,
    dependencyIssues: issues,
    diagnostics,
    diagnosticsSummary: summarizeDiagnostics(diagnostics),
    artifacts,
    ...(pipeline ? { pipeline: { total: pipeline.entries.length, invalidLines: pipeline.invalidLines } } : {}),
    ...(worklog ? { worklog: { total: worklog.entries.length, invalidLines: worklog.invalidLines } } : {})
  };
}
