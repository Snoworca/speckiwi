// @req FR-NODE-246 — `orchestrate wave check`: a 2.0.0 work graph checked against the SRS and the run
// journal, each defect under a named code, so a graph whose acceptance-criteria partition, order or
// content is wrong is caught before any worker is dispatched. The WG-03 partition is the only
// allocation check; the old pre/post snapshot kernel is gone.
//
// Pure: the graph document, the requirement records and the run's journal lines arrive as values.
// Reading the file, the SRS, the SDS write sets and the journal stays in the command, and nothing
// here writes a lock or a journal line.
import type { AcceptanceCriterion, Diagnostic, DiagnosticsSummary, ExpiredAcceptanceCriterion, RequirementRecord, TraceLink } from "../types.js";
import { boundDiagnostics, type DiagnosticsTruncation } from "../query/summary.js";
import { requirementDependencyIds } from "../requirement-dependency.js";
import { redactSecrets } from "../secret-patterns.js";
import { compareStrings } from "./conflict.js";
import { sameWave, waveNumber, type WavesEvent } from "./journal-schema.js";
import { computeLanePlan, DEFAULT_LANE_CAP } from "./lane-plan.js";
import { parseWorkGraph, type CompletionAction, type WorkGraph } from "./wave-declaration.js";
import { ancestorsOf, recordsById, splitRef } from "./work-graph-state.js";

/** Diagnostics returned without `allDiagnostics`. @req FR-NODE-246 AC-12 */
export const WAVE_CHECK_DIAGNOSTICS_LIMIT = 50;

/** The closed placeholder list of a `notify` message. @req FR-NODE-246 AC-8 */
export const MESSAGE_PLACEHOLDERS = ["{run_id}", "{wave}", "{title}", "{purpose}", "{acs_done}", "{acs_total}", "{github_issues}", "{completed_at}"] as const;

/** What the check reads of a requirement record. */
export type CheckRecord = Pick<RequirementRecord, "id" | "target" | "status" | "stability"> & {
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly expiredAcceptanceCriteria?: readonly ExpiredAcceptanceCriterion[];
  readonly traceLinks: readonly TraceLink[];
};

export interface WaveCheckInput {
  /** The graph file's JSON value. */
  readonly graph: unknown;
  readonly records: readonly CheckRecord[];
  /** The run's journal lines, or `null` when no run was named, which skips WG-08. */
  readonly journal: readonly WavesEvent[] | null;
  /** The write sets of the SDS files a node names, by wave, as `schedule waves --waves` adds them to `files`. */
  readonly sdsWriteSets?: ReadonlyMap<string, readonly string[]>;
  /** Defaults to {@link DEFAULT_LANE_CAP}. */
  readonly laneCap?: number;
  /** Return every diagnostic rather than the first {@link WAVE_CHECK_DIAGNOSTICS_LIMIT}. */
  readonly allDiagnostics?: boolean;
}

/** One stage of the preview: the nodes `computeLanePlan` would run together. @req FR-NODE-246 AC-11 */
export interface PreviewStage {
  readonly stage: number;
  readonly waves: readonly string[];
}

export interface WaveCheckReport {
  /** No error diagnostic: what the command's exit code 0 reports. Warnings leave it true. */
  readonly ok: boolean;
  /** Whether WG-08 ran against a run's journal. @req FR-NODE-246 AC-9 */
  readonly journal_checked: boolean;
  /** `null` when the graph does not parse. */
  readonly stages: readonly PreviewStage[] | null;
  /** Errors before warnings. */
  readonly diagnostics: readonly Diagnostic[];
  readonly diagnosticsTruncation?: DiagnosticsTruncation;
  readonly diagnosticsSummary: DiagnosticsSummary;
}

/** The code of a WG-01 refusal that names no gate. */
const INVALID_GRAPH = "work-graph-invalid";

function finding(code: string, severity: Diagnostic["severity"], message: string, details: Record<string, unknown>, requirementId?: string): Diagnostic {
  return { code, severity, message, ...(requirementId === undefined ? {} : { requirementId }), details };
}

/** The node a `nodes[i]…` field belongs to, by its declared `wave`, or `null`. */
function nodeOfField(graph: unknown, field: string): string | null {
  const match = /^nodes\[(\d+)\]/.exec(field);
  if (match === null) return null;
  const nodes = (graph as { nodes?: unknown }).nodes;
  const item = Array.isArray(nodes) ? (nodes[Number(match[1])] as { wave?: unknown } | undefined) : undefined;
  return typeof item?.wave === "string" ? item.wave : null;
}

/** Every string value of `value`, with the path that reaches it. */
function stringFields(value: unknown, field: string, visit: (field: string, text: string) => void): void {
  if (typeof value === "string") visit(field, value);
  else if (Array.isArray(value)) value.forEach((item, index) => stringFields(item, `${field}[${index}]`, visit));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) stringFields(item, field === "" ? key : `${field}.${key}`, visit);
  }
}

const ACTION_FIELD = /(?:^|\.)on_complete\[\d+\]/;
const URL = /https?:\/\//i;

/**
 * WG-06 over the document as written, so a graph the parse refuses is still checked: a string a shared
 * secret pattern matches, and a URL in a completion action. @req FR-NODE-246 AC-7
 */
function contentDiagnostics(graph: unknown): Diagnostic[] {
  const found: Diagnostic[] = [];
  stringFields(graph, "", (field, text) => {
    const node = nodeOfField(graph, field);
    if (redactSecrets(text).count > 0) found.push(finding("secret-in-graph", "error", `${field} holds text a secret pattern matches`, { node, field }));
    if (ACTION_FIELD.test(field) && URL.test(text)) {
      found.push(finding("url-in-action", "error", `${field} holds a URL; a completion action names a channel alias, never an address`, { node, field }));
    }
  });
  return found;
}

/** The nodes holding each value, in node order. */
function holdersOf(graph: WorkGraph, valuesOf: (node: WorkGraph["nodes"][number]) => readonly string[]): Map<string, string[]> {
  const holders = new Map<string, string[]>();
  for (const node of graph.nodes) {
    for (const value of valuesOf(node)) {
      const list = holders.get(value) ?? [];
      if (!list.includes(node.wave)) list.push(node.wave);
      holders.set(value, list);
    }
  }
  return holders;
}

/** The live ACs of the scope, as `<REQ-ID> AC-<n>`. @req FR-NODE-246 AC-4 */
function scopeAcs(graph: WorkGraph, byId: ReadonlyMap<string, CheckRecord>): string[] {
  const inScope =
    "target" in graph.scope
      ? [...byId.values()].filter((record) => record.target === (graph.scope as { target: string }).target)
      : graph.scope.requirements.flatMap((id) => byId.get(id) ?? []);
  return inScope.filter((record) => record.status !== "discarded").flatMap((record) => record.acceptanceCriteria.map((criterion) => `${record.id} ${criterion.id}`));
}

/** WG-02 and WG-03: every scope ID and `acs` entry against the SRS, and the partition of the scope's live ACs. @req FR-NODE-246 AC-3, AC-4, AC-14 */
function partitionDiagnostics(graph: WorkGraph, byId: ReadonlyMap<string, CheckRecord>): Diagnostic[] {
  // @req FR-NODE-246 AC-14 — an unknown ID would make the partition silently smaller than the scope.
  const found: Diagnostic[] =
    "target" in graph.scope
      ? []
      : graph.scope.requirements
          .filter((id) => !byId.has(id))
          .map((id) => finding("requirement-missing", "error", `the graph's scope names ${id}, which is not a requirement of the SRS`, { scope: id }, id));
  const scope = scopeAcs(graph, byId);
  const inScope = new Set(scope);
  for (const node of graph.nodes) {
    for (const ac of node.acs) {
      const { requirement, acId } = splitRef(ac);
      const record = byId.get(requirement);
      const at = { node: node.wave, ac };
      if (record === undefined) {
        found.push(finding("requirement-missing", "error", `${node.wave} lists ${ac}, but ${requirement} does not exist`, at, requirement));
      } else if (record.status === "discarded") {
        found.push(finding("requirement-discarded", "error", `${node.wave} lists ${ac}, but ${requirement} is discarded`, at, requirement));
      } else if (record.acceptanceCriteria.some((criterion) => criterion.id === acId)) {
        if (!inScope.has(ac)) found.push(finding("ac-out-of-scope", "error", `${node.wave} lists ${ac}, which is outside the graph's scope`, at, requirement));
      } else {
        const expired = record.expiredAcceptanceCriteria?.find((criterion) => criterion.id === acId);
        if (expired === undefined) found.push(finding("ac-missing", "error", `${node.wave} lists ${ac}, which ${requirement} does not have`, at, requirement));
        else {
          const successor = expired.successor === undefined ? "" : `; its successor is ${expired.successor}`;
          found.push(
            finding("ac-expired", "error", `${node.wave} lists ${ac}, which is expired${successor}`, { ...at, ...(expired.successor === undefined ? {} : { successor: expired.successor }) }, requirement)
          );
        }
      }
    }
  }
  const holders = holdersOf(graph, (node) => node.acs);
  for (const ac of scope) {
    const nodes = holders.get(ac) ?? [];
    const requirement = splitRef(ac).requirement;
    if (nodes.length === 0) found.push(finding("ac-unassigned", "error", `${ac} is in the scope but in no node`, { ac }, requirement));
    else if (nodes.length > 1) found.push(finding("ac-assigned-twice", "error", `${ac} is in ${nodes.join(", ")}`, { ac, nodes }, requirement));
  }
  return found;
}

/** WG-04, WG-05 and WG-09: per requirement of the graph. @req FR-NODE-246 AC-5, AC-6, AC-10 */
function requirementDiagnostics(graph: WorkGraph, byId: ReadonlyMap<string, CheckRecord>): Diagnostic[] {
  const found: Diagnostic[] = [];
  const holders = holdersOf(graph, (node) => node.requirements);
  const requirementsInGraph = new Set(holders.keys());
  const dependsOn = new Map(graph.declaration.waves.map((entry) => [entry.wave, entry.dependsOn]));
  const ancestors = new Map(graph.nodes.map((node) => [node.wave, ancestorsOf(node.wave, dependsOn)]));
  for (const [requirement, nodes] of holders) {
    if (nodes.length > 1) found.push(finding("ac-split", "warning", `the ACs of ${requirement} sit in ${nodes.join(", ")}`, { nodes }, requirement));
    const record = byId.get(requirement);
    if (record === undefined) continue;
    for (const dependency of requirementDependencyIds(record, requirementsInGraph)) {
      for (const node of nodes) {
        for (const dependencyNode of holders.get(dependency) ?? []) {
          if (dependencyNode === node || ancestors.get(node)?.has(dependencyNode) === true) continue;
          found.push(
            finding(
              "dependency-order",
              "error",
              `${requirement} in ${node} depends on ${dependency}, which ${dependencyNode} holds but no edge path runs from ${dependencyNode} to ${node}`,
              { dependency, node, dependencyNode },
              requirement
            )
          );
        }
      }
    }
    if (record.stability === "draft") {
      found.push(finding("requirement-draft", "warning", `${requirement} is draft; schedule waves refuses it at dispatch`, { nodes }, requirement));
    }
  }
  return found;
}

const PLACEHOLDER = /\{[^{}]*\}/g;

/** Placeholders of one declared action list that the closed list does not hold. */
function placeholderDiagnostics(actions: readonly CompletionAction[], node: string | null): Diagnostic[] {
  return actions.flatMap((action) =>
    action.kind !== "notify" || action.message === undefined
      ? []
      : [...action.message.matchAll(PLACEHOLDER)]
          .map((match) => match[0])
          .filter((placeholder) => !(MESSAGE_PLACEHOLDERS as readonly string[]).includes(placeholder))
          .map((placeholder) => finding(
              "message-placeholder-unknown",
              "error",
              // The owner is in the message: the shared dedup keys on it, so two nodes declaring the same action stay two diagnostics.
              `${node ?? "defaults"}.on_complete action ${action.id} uses ${placeholder}, which is not one of ${MESSAGE_PLACEHOLDERS.join(", ")}`,
              { node, action: action.id, placeholder }
            ))
  );
}

/** WG-07: a repeated action id once the defaults apply, and an unknown message placeholder. @req FR-NODE-246 AC-8 */
function actionDiagnostics(graph: WorkGraph): Diagnostic[] {
  const found = placeholderDiagnostics(graph.defaultOnComplete ?? [], null);
  for (const node of graph.nodes) {
    found.push(...placeholderDiagnostics(node.onComplete ?? [], node.wave));
    const ids = (node.onComplete ?? graph.defaultOnComplete ?? []).map((action) => action.id);
    for (const id of new Set(ids.filter((value, index) => ids.indexOf(value) !== index))) {
      found.push(finding("action-id-duplicate", "error", `${node.wave} has two completion actions with id ${id}`, { node: node.wave, action: id }));
    }
  }
  return found;
}

/**
 * WG-08: a wave the run's journal names that is not a node. @req FR-NODE-246 AC-9
 *
 * @req FR-NODE-286 AC-3 — an intake line is left out: intake runs before the graph exists, and 5.3.7
 * let a run journal its intake decisions under `wave-0`, which no node can carry. Counting those
 * lines would block such a run's dispatch for good, since the journal is append-only.
 */
function journalDiagnostics(graph: WorkGraph, journal: readonly WavesEvent[]): Diagnostic[] {
  const named = [
    ...new Set(journal.flatMap((event) => (event.phase !== "intake" && typeof event.wave === "string" && waveNumber(event.wave) !== null ? [event.wave] : [])))
  ];
  return named
    .filter((wave) => !graph.nodes.some((node) => sameWave(node.wave, wave)))
    .map((wave) => finding("journal-wave-missing", "error", `the run's journal names ${wave}, which is not a node of the graph`, { wave }));
}

/** Every node placed in a stage by the planner `schedule waves --waves` calls, with no lock written. @req FR-NODE-246 AC-11 */
function stagePreview(graph: WorkGraph, sdsWriteSets: ReadonlyMap<string, readonly string[]> | undefined, laneCap: number): PreviewStage[] {
  const entries = graph.declaration.waves;
  const plan = computeLanePlan({
    waves: entries.map((entry) => ({
      waveId: entry.wave,
      writeSet: [...new Set([...entry.files, ...(sdsWriteSets?.get(entry.wave) ?? [])])].sort(compareStrings),
      ...(entry.files.length === 0 && (entry.sds ?? []).length === 0 ? { declared: false } : {})
    })),
    dependencies: Object.fromEntries(entries.map((entry) => [entry.wave, [...entry.dependsOn]])),
    laneCap
  });
  return plan.stages.map((stage) => ({ stage: stage.index, waves: plan.lanes.filter((lane) => lane.stage === stage.index).map((lane) => lane.wave) }));
}

/**
 * Checks a work graph: WG-01 the parse, WG-02..WG-05 and WG-09 against the requirement records, WG-06
 * the content, WG-07 the completion actions, WG-08 the run's journal, and a stage preview.
 * @req FR-NODE-246 AC-1 .. AC-12
 */
export function checkWorkGraph(input: WaveCheckInput): WaveCheckReport {
  const found: Diagnostic[] = [];
  const parsed = parseWorkGraph(input.graph);
  // @req FR-NODE-246 AC-2 — a refused parse skips every check that needs the graph's structure.
  if (!parsed.ok) found.push(finding(parsed.gate ?? INVALID_GRAPH, "error", parsed.message, {}));
  found.push(...contentDiagnostics(input.graph));
  let stages: PreviewStage[] | null = null;
  if (parsed.ok) {
    const graph = parsed.graph;
    const byId = recordsById(input.records);
    found.push(...partitionDiagnostics(graph, byId), ...requirementDiagnostics(graph, byId), ...actionDiagnostics(graph));
    if (input.journal !== null) found.push(...journalDiagnostics(graph, input.journal));
    stages = stagePreview(graph, input.sdsWriteSets, input.laneCap ?? DEFAULT_LANE_CAP);
  }
  const ordered = [...found.filter((item) => item.severity === "error"), ...found.filter((item) => item.severity !== "error")];
  const bounded = boundDiagnostics(ordered, input.allDiagnostics === true ? undefined : WAVE_CHECK_DIAGNOSTICS_LIMIT);
  return {
    ok: bounded.diagnosticsSummary.errors === 0,
    journal_checked: input.journal !== null,
    stages,
    diagnostics: bounded.diagnostics,
    ...(bounded.diagnosticsTruncation === undefined ? {} : { diagnosticsTruncation: bounded.diagnosticsTruncation }),
    diagnosticsSummary: bounded.diagnosticsSummary
  };
}
