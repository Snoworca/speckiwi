import { readFile } from "node:fs/promises";
import { diagnostic } from "../diagnostic.js";
import { summarizeDiagnostics } from "../diagnostic.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type { Diagnostic, DiagnosticsSummary, ProjectRoot } from "../types.js";
import { resolveWorkflowArtifacts, type WorkflowArtifactCandidate, type WorkflowArtifactKind } from "./artifacts.js";
import { parseWorkflowJsonl, type WorkflowJsonlEntry } from "./jsonl.js";

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

interface PmStateTask {
  task_id?: string;
  status?: string;
}

interface PmState {
  run_id?: string;
  target_slug?: string;
  tasks?: PmStateTask[];
  stats?: Record<string, unknown>;
  /** The one kiwi-pm run of an SDS session (kiwi-pm SKILL.md §2.2). */
  run?: { status?: string };
}

/** @req REL-NODE-006 — the doctor, diff and schema-check projections left with their tools (FR-NODE-211 AC-1). */
export type WorkflowProjectionKind = "pipeline_compact";

/** @req REL-NODE-006 AC-2 */
export type WorkflowProjectionOutcomeCode = "unsupported_schema_version" | "invalid_artifact" | "deleted_record_filtered" | "no_actionable_drift";

export interface WorkflowProjectionValue {
  projectionKind: WorkflowProjectionKind;
  outcomeCodes: WorkflowProjectionOutcomeCode[];
  blocking: boolean;
  artifacts: Array<{ relativePath: string; kind: string; sha256?: string; mtimeMs: number }>;
}

/**
 * The pipeline statuses that stop automation until a person or a fix intervenes. The compact
 * projection reports them as blocking and the work order refuses to hand out work past them, from
 * this one set. @req FR-MCP-035 AC-3, IR-CLI-041 AC-3, IR-CLI-032 AC-3, FR-MCP-024 AC-3
 */
export const PIPELINE_STOP_STATUSES: ReadonlySet<string> = new Set(["FAILED", "NEEDS_USER"]);

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

function visibleWorkflowTail(
  parsed: Awaited<ReturnType<typeof parseWorkflowJsonl>> | null,
  includeDeleted: boolean
): WorkflowJsonlEntry[] {
  if (!parsed) return [];
  if (includeDeleted) return parsed.tail;
  const active = new Set(parsed.latestEntries);
  return parsed.tail.filter((entry) =>
    active.has(entry) || entry.effectiveRecordClass === "audit_note" || entry.event.event === "record_reclassification"
  );
}

function outcomeCodesFromDiagnostics(diagnostics: Diagnostic[]): WorkflowProjectionOutcomeCode[] {
  const codes = new Set<WorkflowProjectionOutcomeCode>();
  for (const item of diagnostics) {
    if (item.code === "SRS-W055") codes.add("unsupported_schema_version");
    if (item.code === "SRS-W050" || item.code === "SRS-W052" || item.code === "SRS-W056" || item.code === "SRS-W069" || item.severity === "error") {
      codes.add("invalid_artifact");
    }
  }
  return [...codes];
}

function projectionBlocking(codes: WorkflowProjectionOutcomeCode[], defaultBlocking: boolean): boolean {
  return defaultBlocking || codes.some((code) => code === "unsupported_schema_version" || code === "invalid_artifact");
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

export async function workflowPipelineCompact(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const resolved = await resolve(root, { ...options, kind: "pipeline", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const effective = resolved.selected ? await parseWorkflowJsonl(root, resolved.selected.relativePath) : null;
  const withDeleted = resolved.selected ? await parseWorkflowJsonl(root, resolved.selected.relativePath, { includeDeleted: true }) : null;
  const parsed = options.includeDeleted ? withDeleted : effective;
  if (parsed) diagnostics.push(...parsed.diagnostics);
  const artifacts = resolved.selected ? [await artifactRef(resolved.selected, false)] : [];
  const deletedFiltered = withDeleted?.latestEntries.filter((entry) => (entry.deletedBy ?? []).length > 0).length ?? 0;
  // Whether the pipeline has stopped is read from the effective state: `includeDeleted` changes what is
  // shown, and a display flag must not turn a live FAILED into an open gate. @req FR-MCP-035 AC-3
  const effectiveStatus = effective?.latestEntries.at(-1)?.event.status;
  const stopped = typeof effectiveStatus === "string" && PIPELINE_STOP_STATUSES.has(effectiveStatus);
  const outcomeCodes = new Set<WorkflowProjectionOutcomeCode>(outcomeCodesFromDiagnostics(diagnostics));
  if (deletedFiltered > 0) outcomeCodes.add("deleted_record_filtered");
  if (outcomeCodes.size === 0 && !stopped) outcomeCodes.add("no_actionable_drift");
  const latestEvent = parsed?.latestEntries.at(-1) ?? null;
  const latestStatus = typeof latestEvent?.event.status === "string" ? latestEvent.event.status : null;
  const codes = [...outcomeCodes];
  return envelope(
    resolved.workspaceRoot,
    {
      projectionKind: "pipeline_compact" as const,
      outcomeCodes: codes,
      blocking: projectionBlocking(codes, stopped),
      artifacts: artifacts.map((artifact) => ({
        relativePath: artifact.relativePath,
        kind: artifact.kind,
        ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
        mtimeMs: artifact.mtimeMs
      })),
      latestEvent,
      latestStatus,
      total: parsed?.entries.length ?? 0,
      active: parsed?.latestEntries.length ?? 0,
      deletedFiltered,
      invalidLines: parsed?.invalidLines ?? []
    },
    diagnostics,
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
  // @req FR-MCP-062 AC-2 — the hint the latest event carries travels with that event, so reading it
  // costs no second call and `workflowPipelineNext` has nothing left to compute.
  const nextHint = latestEvent?.event.next_hint ?? null;
  return envelope(resolved.workspaceRoot, { latestEvent, nextHint, total: parsed?.entries.length ?? 0, invalidLines: parsed?.invalidLines ?? [] }, diagnostics, artifacts);
}

export async function workflowPipelineTail(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const status = await workflowPipelineStatus(root, options);
  const artifact = status.artifacts[0];
  const parsed = artifact ? await parseWorkflowJsonl(root, artifact.relativePath, { ...(options.includeDeleted ? { includeDeleted: true } : {}) }) : null;
  const tail = visibleWorkflowTail(parsed, options.includeDeleted ?? false);
  const { sliced, cursor: cursorValue } = cursor(tail, options.limit ?? 20, options.offset);
  return envelope(status.meta.workspaceRoot, { events: sliced }, status.diagnostics, status.artifacts, cursorValue);
}

/**
 * The pipeline status under the name `get_next_work_order` hands the agent. It delegates rather than
 * derives: the hint is computed once, in `workflowPipelineStatus`. @req FR-MCP-062 AC-4 / AC-5
 */
export async function workflowPipelineNext(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  return workflowPipelineStatus(root, options);
}

export async function workflowSessionStatus(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const resolved = await resolve(root, { ...options, kind: "pm-state", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const state = resolved.selected ? await parseJsonFile<PmState>(resolved.selected, diagnostics) : null;
  const artifacts = resolved.selected ? [await artifactRef(resolved.selected, options.includeBody)] : [];
  return envelope(resolved.workspaceRoot, { state, stats: state?.stats ?? null, tasks: state?.tasks ?? [] }, diagnostics, artifacts);
}

export async function workflowWorklogTail(root: ProjectRoot, options: WorkflowReadOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const resolved = await resolve(root, { ...options, kind: "worklog", allowAmbiguous: true });
  diagnostics.push(...resolved.diagnostics);
  const parsed = resolved.selected ? await parseWorkflowJsonl(root, resolved.selected.relativePath, { ...(options.includeDeleted ? { includeDeleted: true } : {}) }) : null;
  if (parsed) diagnostics.push(...parsed.diagnostics);
  const tail = visibleWorkflowTail(parsed, options.includeDeleted ?? false);
  const { sliced, cursor: cursorValue } = cursor(tail, options.limit ?? 20, options.offset);
  const artifacts = resolved.selected ? [await artifactRef(resolved.selected, false)] : [];
  return envelope(resolved.workspaceRoot, { events: sliced }, diagnostics, artifacts, cursorValue);
}
