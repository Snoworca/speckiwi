// @req IR-CLI-113 — what `orchestrate wave status` reports for a run with a 2.0.0 work graph: one row
// per node of the graph, small fixed fields only, and a run summary, so that a reader judges progress
// with one call and never opens the graph or the journal.
//
// Pure: the graph, the derived node states, the journal lines and the action states arrive as values.
// Every state is read from the one derivation (`deriveWorkGraphState`); nothing here computes one.
import type { EventStatus, WavesEvent } from "./journal-schema.js";
import { sameWave, waveNumber } from "./journal-schema.js";
import type { WorkGraph } from "./wave-declaration.js";
import { linesByWave, NODE_STATE_NAMES, type NodeState, type NodeStateName, type WorkGraphState } from "./work-graph-state.js";
import { actionCounts, type ActionRow, type NodeCompletionAction } from "./completion-actions.js";
import type { TestCitation } from "../testing/test-citations.js";

/** The shape version of the 2.0.0 `wave status` output, for a reader that parses it. @req IR-CLI-113 AC-3 */
export const WAVE_STATUS_REPORT_VERSION = "1.0.0";

/** The phase of the line that dispatches a node to its worker. @req IR-CLI-113 AC-1 */
const WORKER_PHASE = "worker";

export interface WaveStatusInput {
  readonly graph: WorkGraph;
  readonly state: WorkGraphState;
  /** The run's lines, in journal order. */
  readonly journal: readonly WavesEvent[];
  /** The latest wave-state line per wave number, as the run view holds it (IR-CLI-104). */
  readonly latestPerWave: ReadonlyMap<number, WavesEvent>;
  /** `computeRunProgress(view).waveStatuses`. */
  readonly waveStatuses: ReadonlyMap<number, EventStatus>;
  /** `completionActionsOf` over the same graph and journal. */
  readonly actions: readonly NodeCompletionAction[];
}

export interface WaveStatusRow {
  readonly wave: string;
  readonly status: EventStatus | null;
  readonly phase: string | null;
  readonly sds_id: string | null;
  readonly stage: number | null;
  readonly lane: string | null;
  readonly ts: string | null;
  /** `null` for a wave the graph does not hold. */
  readonly title: string | null;
  readonly state: NodeStateName;
  /** `null` for a wave the graph does not hold. */
  readonly depth: number | null;
  readonly ac_total: number;
  readonly ac_done: number;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly action_counts: Record<string, number>;
  readonly dispatched: boolean;
  /** The `isolation.base_sha` of the latest line naming the wave that carries one; `null` when none does. */
  readonly base_sha: string | null;
  /** False for a wave the journal names that the graph does not hold, as after a redecomposition dropped it. */
  readonly in_graph: boolean;
}

/**
 * The state of a wave the graph does not hold, from its latest wave-state line alone: what the
 * derivation gives a node with no acceptance criterion and no done_when for `complete`, `in_progress`
 * and `failed`. A `pending` wave waits, since no graph node will dispatch it. @req IR-CLI-113 AC-1, IR-CLI-104 AC-1
 */
const JOURNAL_ONLY_STATE: Readonly<Record<EventStatus, NodeStateName>> = { complete: "done", in_progress: "running", failed: "failed", pending: "waiting" };

/** The longest edge path from a node with no predecessor; 0 for such a node. @req IR-CLI-113 AC-1 */
export function nodeDepths(graph: WorkGraph): Map<string, number> {
  const dependsOn = new Map(graph.declaration.waves.map((entry) => [entry.wave, entry.dependsOn]));
  const depths = new Map<string, number>();
  const depthOf = (wave: string): number => {
    const known = depths.get(wave);
    if (known !== undefined) return known;
    // The parse refuses a cycle, so the recursion ends.
    const depth = Math.max(-1, ...(dependsOn.get(wave) ?? []).map(depthOf)) + 1;
    depths.set(wave, depth);
    return depth;
  };
  for (const node of graph.nodes) depthOf(node.wave);
  return depths;
}

/** Whether some line of the run naming `wave` carries `phase` `worker`. @req IR-CLI-113 AC-1 */
export function wasDispatched(journal: readonly WavesEvent[], wave: string): boolean {
  return journal.some((event) => event.phase === WORKER_PHASE && sameWave(event.wave, wave));
}

/**
 * The base the wave was last dispatched from: the `isolation.base_sha` of the latest line of the run
 * naming `wave` that carries one, so a re-entry's base replaces the first dispatch's. @req IR-CLI-113 AC-11
 */
export function latestBaseSha(journal: readonly WavesEvent[], wave: string): string | null {
  const carrying = journal.filter((event) => sameWave(event.wave, wave) && typeof event.isolation?.base_sha === "string");
  return (carrying[carrying.length - 1]?.isolation?.base_sha as string | undefined) ?? null;
}

function field<T extends "string" | "number">(value: unknown, type: T): (T extends "string" ? string : number) | null {
  return (typeof value === type ? value : null) as (T extends "string" ? string : number) | null;
}

/**
 * One row per node of the graph and per wave the journal names that the graph does not hold, in wave
 * order: with a graph "every wave of the run" stays listed, every node is added to it. @req IR-CLI-113 AC-1, IR-CLI-104 AC-1
 */
export function waveStatusRows(input: WaveStatusInput): WaveStatusRow[] {
  const depths = nodeDepths(input.graph);
  const common = (wave: string, n: number) => {
    const latest = input.latestPerWave.get(n);
    return {
      wave,
      status: input.waveStatuses.get(n) ?? null,
      phase: field(latest?.phase, "string"),
      sds_id: field(latest?.sds_id, "string"),
      stage: field(latest?.stage, "number"),
      lane: field(latest?.lane, "string"),
      ts: field(latest?.ts, "string")
    };
  };
  // The derivation lists the nodes in the graph's node order.
  const nodeRows = input.graph.nodes.map((node, index): WaveStatusRow => {
    const derived = input.state.nodes[index] as NodeState;
    return {
      ...common(node.wave, node.order),
      title: node.title,
      state: derived.state,
      depth: depths.get(node.wave) ?? 0,
      ac_total: derived.ac_total,
      ac_done: derived.ac_done,
      started_at: derived.started_at,
      completed_at: derived.completed_at,
      action_counts: actionCounts(input.actions.filter((entry) => entry.wave === node.wave), input.state),
      dispatched: wasDispatched(input.journal, node.wave),
      base_sha: latestBaseSha(input.journal, node.wave),
      in_graph: true
    };
  });
  const inGraph = new Set(input.graph.nodes.map((node) => node.order));
  const lines = linesByWave(input.journal);
  const journalRows = [...input.latestPerWave.keys()]
    .filter((n) => !inGraph.has(n))
    .map((n): WaveStatusRow => {
      const wave = `wave-${n}`;
      const status = input.waveStatuses.get(n);
      return {
        ...common(wave, n),
        title: null,
        state: status === undefined ? "waiting" : JOURNAL_ONLY_STATE[status],
        depth: null,
        ac_total: 0,
        ac_done: 0,
        started_at: lines.get(n)?.startedAt ?? null,
        completed_at: lines.get(n)?.completedAt ?? null,
        action_counts: actionCounts([], input.state),
        dispatched: wasDispatched(input.journal, wave),
        base_sha: latestBaseSha(input.journal, wave),
        in_graph: false
      };
    });
  return [...nodeRows, ...journalRows].sort((left, right) => (waveNumber(left.wave) as number) - (waveNumber(right.wave) as number));
}

export interface WaveStatusSummary {
  /** Node counts, one key per state. */
  readonly nodes: Record<NodeStateName, number>;
  readonly ac_total: number;
  readonly ac_done: number;
  readonly actions: Record<string, number>;
  readonly ready: string[];
  readonly running: string[];
  readonly attention: string[];
}

/**
 * Whether a row needs the reader's attention: it failed or is blocked, or holds a `failed` or
 * `interrupted` action; with the citation scan also when it is `unverified` or holds a
 * `held-unverified` action — one condition, since an action is held exactly when its node is
 * `unverified` (FR-NODE-251 AC-4). @req IR-CLI-113 AC-2, AC-4
 */
function needsAttention(row: WaveStatusRow, actions: readonly NodeCompletionAction[], scanned: boolean): boolean {
  if (row.state === "failed" || row.state === "blocked") return true;
  if (actions.some((entry) => entry.state === "failed" || entry.state === "interrupted")) return true;
  return scanned && row.state === "unverified";
}

/** The run summary over every row `waveStatusRows` lists. @req IR-CLI-113 AC-2, AC-4 */
export function waveStatusSummary(input: Pick<WaveStatusInput, "state" | "actions"> & { readonly rows: readonly WaveStatusRow[] }): WaveStatusSummary {
  const { rows } = input;
  const withState = (name: NodeStateName): string[] => rows.filter((row) => row.state === name).map((row) => row.wave);
  return {
    nodes: Object.fromEntries(NODE_STATE_NAMES.map((name) => [name, withState(name).length])) as Record<NodeStateName, number>,
    ac_total: rows.reduce((sum, row) => sum + row.ac_total, 0),
    ac_done: rows.reduce((sum, row) => sum + row.ac_done, 0),
    actions: actionCounts(input.actions, input.state),
    ready: withState("ready"),
    running: withState("running"),
    attention: rows
      .filter((row) => needsAttention(row, input.actions.filter((entry) => entry.wave === row.wave), input.state.cited_checked))
      .map((row) => row.wave)
  };
}

// @req IR-CLI-114 — what `orchestrate wave show` reports for one node: everything a reader would
// otherwise open the graph, the SRS and the journal for, within bounded lists.

/** How many of a node's journal lines `wave show` carries without `--full`. @req IR-CLI-114 AC-3 */
export const WAVE_SHOW_JOURNAL_LIMIT = 20;

/** Exactly one of the three selectors. @req IR-CLI-114 AC-1 */
export type NodeSelector = { readonly wave: string } | { readonly ac: string } | { readonly req: string };

/** The nodes a selector names: that node, or every node holding the criterion or a criterion of the requirement. @req IR-CLI-114 AC-1 */
export function selectNodes(graph: WorkGraph, selector: NodeSelector): WorkGraph["nodes"] {
  if ("wave" in selector) return graph.nodes.filter((node) => node.wave === selector.wave);
  if ("ac" in selector) return graph.nodes.filter((node) => node.acs.includes(selector.ac));
  return graph.nodes.filter((node) => node.requirements.includes(selector.req));
}

export interface WaveShowInput {
  readonly graph: WorkGraph;
  /** The scanned derivation. */
  readonly state: WorkGraphState;
  readonly journal: readonly WavesEvent[];
  /** `actionRows` over the same graph, journal and state. */
  readonly actionRows: readonly ActionRow[];
  /** The test lines citing each `<REQ-ID> AC-<n>`, as the scan found them. */
  readonly citations: ReadonlyMap<string, readonly TestCitation[]>;
  /** The PRD items the Rationales of these requirements cite. */
  readonly prdItems: (requirements: readonly string[]) => string[];
  readonly full: boolean;
}

/** A list cut to `limit` from its end, with the FR-NODE-231 descriptor when it was cut. */
function latest<T>(items: readonly T[], limit: number | null): { items: T[]; truncation?: { total: number; returned: number; limit: number } } {
  if (limit === null || items.length <= limit) return { items: [...items] };
  return { items: items.slice(items.length - limit), truncation: { total: items.length, returned: limit, limit } };
}

/** One selected node in full. @req IR-CLI-114 AC-2, AC-3 */
export function waveShowNode(input: WaveShowInput, wave: string): Record<string, unknown> {
  const index = input.graph.nodes.findIndex((node) => node.wave === wave);
  const node = input.graph.nodes[index] as WorkGraph["nodes"][number];
  const derived = input.state.nodes[index] as NodeState;
  const complete = derived.state === "done" || derived.state === "unverified";
  const lines = input.journal.filter((event) => sameWave(event.wave, wave)).map(({ journalLine, ...event }) => ({ line: journalLine, ...event }));
  const journal = latest(lines, input.full ? null : WAVE_SHOW_JOURNAL_LIMIT);
  return {
    wave,
    title: node.title,
    purpose: node.purpose,
    description: node.description ?? null,
    github_issues: node.githubIssues ?? [],
    cautions: node.cautions ?? [],
    files: node.files,
    sds: node.sds ?? [],
    requirements: node.requirements,
    prd_items: input.prdItems(node.requirements),
    acs: derived.acs.map((ac) => {
      const citations = input.citations.get(ac.ref) ?? [];
      return {
        ac: ac.ref,
        checked: ac.checked,
        covered: ac.covered,
        cited_count: citations.length,
        first_citation: citations[0] ?? null,
        expired: ac.expired,
        done: ac.done,
        ...(input.full ? { citations } : {})
      };
    }),
    done_when: node.doneWhen.map((item) => ({ id: item.id, text: item.text, confirmed: complete && !derived.done_when_unconfirmed.includes(item.id) })),
    actions: input.actionRows.filter((row) => row.wave === wave),
    state: derived.state,
    started_at: derived.started_at,
    completed_at: derived.completed_at,
    predecessors: input.graph.edges.filter((edge) => edge.to === wave).map((edge) => ({ wave: edge.from, reason: edge.reason ?? null })),
    successors: input.graph.edges.filter((edge) => edge.from === wave).map((edge) => ({ wave: edge.to, reason: edge.reason ?? null })),
    journal: journal.items,
    ...(journal.truncation === undefined ? {} : { journal_truncation: journal.truncation })
  };
}
