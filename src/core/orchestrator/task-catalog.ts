// @req FR-NODE-149 — the sidecar task catalogue, extended with the fields the lane-plan conflict
// classifier reads.
//
// `src/core/workflow/validate.ts` already parses a planner sidecar into a catalogue, and every
// conflict edge in §5.2 of the orchestrator design needs a field that catalogue does not carry:
// `files`, `test_files`, `covers_ac`, `type`, `action` and `tdd`. Until those are parsed, every edge
// is unreachable. The extension is additive: the seven fields an existing consumer reads keep their
// names, their values and their two diagnostics.
import { diagnostic } from "../diagnostic.js";
import type { Diagnostic } from "../types.js";
import type { WorkflowTaskCatalogEntry } from "../workflow/validate.js";

/** A declared file, with the optional line range and the estimation label the sidecar carries. */
export interface TaskFileEntry {
  /** Repo-relative, POSIX separators, no leading `./`, and with any `[INFERRED:…]` label removed. */
  path: string;
  lineRange?: string;
  /**
   * The declared path carried an `[INFERRED:level]` label (`kiwi-planner` §0.3). The label is split
   * off the path rather than left inside it, because a label-bearing string would silently defeat
   * both the write-set-overlap comparison and grounding — which is the exact hazard the
   * `unknown-write-set` barrier exists to raise. @req FR-NODE-147
   */
  inferred: boolean;
}

/** `kiwi-planner`'s `TaskTdd.phase`. Only `red` and `green` participate in the `tdd-pair` edge. */
export type TddPhase = "red" | "green" | "refactor" | "n/a";

/**
 * The catalogue entry the orchestrator reads: `WorkflowTaskCatalogEntry` plus the seven fields §5.2
 * needs. `phaseDependsOn` is lifted from the sidecar's `phases[]` here because `analyzeConflicts`
 * takes five arguments and none of them carries the phase graph, so `phase-dependency` would
 * otherwise be an unreachable member of a closed enum. @req FR-NODE-149, FR-NODE-147
 */
export interface TaskCatalogEntry extends WorkflowTaskCatalogEntry {
  type: string;
  action: string;
  files: TaskFileEntry[];
  testFiles: TaskFileEntry[];
  coversAc: string[];
  tdd: { phase: TddPhase } | null;
  phaseDependsOn: string[];
}

/** The sidecar task shape, as `kiwi-planner` writes it (`SKILL.md:741-759`). */
export interface SidecarTask {
  id?: string;
  task_id?: string;
  phase_id?: string;
  title?: string;
  type?: string;
  action?: string;
  depends_on_task?: string[];
  req_ids?: string[];
  files?: Array<{ path?: string; line_range?: string }>;
  test_files?: Array<{ path?: string; line_range?: string }>;
  covers_ac?: string[];
  tdd?: { applicable?: boolean; phase?: string };
  traces?: Array<{ req_id?: string; reqId?: string; reference?: string }>;
  status?: string;
}

/** The sidecar phase shape. Only `id` and `depends_on` are read here. */
export interface SidecarPhase {
  id?: string;
  depends_on?: string[];
  task_ids?: string[];
}

/** The `pm-state.json` projection `normalizeTasks` consults for a task's live status. */
export interface TaskStatusSource {
  tasks?: Array<{ task_id?: string; status?: string }>;
}

// Two spellings of one pattern: `test` on a global regex advances `lastIndex`, which would make the
// second call on an identical path answer differently.
const INFERRED_LABEL = /\[INFERRED:[^\]]*\]/i;
const INFERRED_LABEL_ALL = /\s*\[INFERRED:[^\]]*\]\s*/gi;
const TDD_PHASES: readonly string[] = ["red", "green", "refactor", "n/a"];

/**
 * Repo-relative POSIX form, used by every path comparison in the orchestrator so a path cannot
 * match one rule and miss another (§5.2, "Normalisation"). Case folding is deliberately **not**
 * done here — it belongs to the comparison, not to the recorded value.
 */
export function normalizeDeclaredPath(value: string): string {
  const posix = value.replace(/\\/g, "/").trim();
  const withoutPrefix = posix.startsWith("./") ? posix.slice(2) : posix;
  return withoutPrefix.replace(/\/+$/, "");
}

/**
 * UTF-16 code-unit order, which is what a bare `Array#sort()` uses. Every ordering in the
 * orchestrator goes through this rather than `localeCompare`, whose result depends on the host
 * locale and would make a byte-determinism contract untrue on a differently configured machine.
 * @req FR-NODE-145
 */
export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fileEntry(entry: { path?: string; line_range?: string } | undefined): TaskFileEntry | null {
  if (!entry || typeof entry.path !== "string") return null;
  const inferred = INFERRED_LABEL.test(entry.path);
  const path = normalizeDeclaredPath(entry.path.replace(INFERRED_LABEL_ALL, ""));
  if (path.length === 0) return null;
  return {
    path,
    ...(typeof entry.line_range === "string" ? { lineRange: entry.line_range } : {}),
    inferred
  };
}

function fileEntries(entries: SidecarTask["files"]): TaskFileEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map(fileEntry).filter((entry): entry is TaskFileEntry => entry !== null);
}

function strings(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
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

function pmStatuses(state: TaskStatusSource | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of state?.tasks ?? []) {
    if (typeof task.task_id === "string" && typeof task.status === "string") map.set(task.task_id, task.status);
  }
  return map;
}

function phaseDependencies(phases: readonly SidecarPhase[] | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const phase of phases ?? []) {
    if (typeof phase.id === "string") map.set(phase.id, strings(phase.depends_on));
  }
  return map;
}

function tddOf(task: SidecarTask): { phase: TddPhase } | null {
  const phase = task.tdd?.phase;
  if (typeof phase !== "string" || !TDD_PHASES.includes(phase)) return null;
  return { phase: phase as TddPhase };
}

/**
 * Parse a sidecar's `tasks[]` into the extended catalogue. The first four parameters and their
 * behaviour — including the `SRS-W061` legacy-trace and `SRS-W064` missing-req-id warnings, the
 * explicit-over-legacy req-id preference, the pm-state status override and the preserved
 * declaration order — are what `validate.ts` has always done; `phases` is the additive fifth.
 * @req FR-NODE-149
 */
export function normalizeTasks(
  tasks: readonly SidecarTask[],
  state: TaskStatusSource | null,
  diagnostics: Diagnostic[],
  sidecarPath?: string,
  phases?: readonly SidecarPhase[]
): TaskCatalogEntry[] {
  const statuses = pmStatuses(state);
  const phaseDeps = phaseDependencies(phases);
  return tasks.map((task) => {
    const id = taskId(task);
    const legacyIds = legacyReqIds(task);
    if (legacyIds.length > 0) {
      diagnostics.push(
        diagnostic(
          "SRS-W061",
          "warning",
          `Workflow legacy trace field: ${id}`,
          sidecarPath ? { filePath: sidecarPath } : {},
          { taskId: id, legacyReqIds: legacyIds }
        )
      );
    }
    const explicitReqIds = strings(task.req_ids);
    const reqIds = explicitReqIds.length > 0 ? explicitReqIds : legacyIds;
    if (reqIds.length === 0) {
      diagnostics.push(
        diagnostic("SRS-W064", "warning", "Workflow task missing req_ids", sidecarPath ? { filePath: sidecarPath } : {}, {
          taskId: id
        })
      );
    }
    return {
      id,
      ...(typeof task.phase_id === "string" ? { phase_id: task.phase_id } : {}),
      ...(typeof task.title === "string" ? { title: task.title } : {}),
      depends_on_task: strings(task.depends_on_task),
      req_ids: reqIds,
      legacyReqIds: legacyIds,
      status: statuses.get(id) ?? task.status ?? "pending",
      type: typeof task.type === "string" ? task.type : "",
      action: typeof task.action === "string" ? task.action : "",
      files: fileEntries(task.files),
      testFiles: fileEntries(task.test_files),
      coversAc: strings(task.covers_ac),
      tdd: tddOf(task),
      phaseDependsOn: (typeof task.phase_id === "string" ? phaseDeps.get(task.phase_id) : undefined) ?? []
    };
  });
}
