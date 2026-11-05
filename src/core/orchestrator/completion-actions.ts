// @req FR-NODE-251 — the completion actions of finished work-graph nodes: which are due, under which
// idempotency key, read from the graph and the run journal. Nothing here sends anything; the host
// agent sends a due action and records it with an intent line and a result line, which is what makes
// every action run at most once.
//
// Pure: the graph, the journal lines and the node states arrive as values. A node's state is read from
// the shared derivation (`deriveWorkGraphState`); this table never computes one of its own.
import { COMPLETION_STATUS, CURRENT_WAVES_SCHEMA_VERSION, NODE_COMPLETE_ACTION_VERB, sameWave, type WavesEvent } from "./journal-schema.js";
import { MESSAGE_PLACEHOLDERS } from "./wave-check.js";
import type { CompletionAction, WorkGraph, WorkGraphNode } from "./wave-declaration.js";
import { linesByWave, type NodeState, type NodeStateName, type WorkGraphState } from "./work-graph-state.js";

/** What the journal alone says of an action. @req FR-NODE-251 AC-3 */
export const ACTION_JOURNAL_STATES = ["sent", "waived", "failed", "interrupted", "pending"] as const;
export type ActionJournalState = (typeof ACTION_JOURNAL_STATES)[number];

/** A `pending` action split by its node's scanned state. @req FR-NODE-251 AC-4 */
export const ACTION_SCANNED_STATES = ["due", "held-unverified"] as const;
export type ActionReportedState = Exclude<ActionJournalState, "pending"> | (typeof ACTION_SCANNED_STATES)[number];

export interface NodeCompletionAction {
  readonly wave: string;
  readonly action: CompletionAction;
  /** `L{n}`, `n` the journal line of the node's latest `complete` line. */
  readonly completionRef: string;
  /** `{run_id}:{wave}:{action_id}:L{n}`. @req FR-NODE-251 AC-2 */
  readonly key: string;
  readonly state: ActionJournalState;
}

/** @req FR-NODE-251 AC-2 */
export function completionActionKey(runId: string, wave: string, actionId: string, completionLine: number): string {
  return `${runId}:${wave}:${actionId}:L${completionLine}`;
}

/** The journal state of an action from the `node-complete-action` lines carrying its key. @req FR-NODE-251 AC-3 */
function journalState(lines: readonly WavesEvent[]): ActionJournalState {
  const latest = lines[lines.length - 1];
  if (latest === undefined) return "pending";
  if (latest.result === "sent" || latest.result === "waived" || latest.result === "failed") return latest.result;
  return "interrupted";
}

/**
 * Every action of every node whose latest wave-state line is `complete` — the node's `on_complete`, or
 * `defaults.on_complete` when it declares none — with its key and its journal state. No test-citation
 * scan is needed: the journal decides. @req FR-NODE-251 AC-2, AC-3
 */
export function completionActionsOf(input: { readonly graph: WorkGraph; readonly runId: string; readonly journal: readonly WavesEvent[] }): NodeCompletionAction[] {
  const latest = linesByWave(input.journal);
  const actionLines = input.journal.filter((event) => event.verb === NODE_COMPLETE_ACTION_VERB);
  return input.graph.nodes.flatMap((node) => {
    const completion = latest.get(node.order)?.latest;
    if (completion?.status !== COMPLETION_STATUS) return [];
    const completionRef = `L${completion.journalLine}`;
    return (node.onComplete ?? input.graph.defaultOnComplete ?? []).map((action) => ({
      wave: node.wave,
      action,
      completionRef,
      key: completionActionKey(input.runId, node.wave, action.id, completion.journalLine),
      state: journalState(actionLines.filter((event) => sameWave(event.wave, node.wave) && event.action_id === action.id && event.completion_ref === completionRef))
    }));
  });
}

/**
 * The state the readers report: a `pending` action is `due` when its node's scanned state is `done` and
 * `held-unverified` when it is `unverified`; every other journal state is reported as it is.
 * @req FR-NODE-251 AC-3, AC-4
 */
export function reportedActionState(state: ActionJournalState, scannedNodeState: NodeStateName): ActionReportedState {
  if (state !== "pending") return state;
  return scannedNodeState === "done" ? "due" : "held-unverified";
}

/**
 * The action counts of `actions`: the five journal states, and — only when `state` was computed with
 * the citation scan — `due` and `held-unverified`, which split `pending`. @req FR-NODE-251 AC-3, AC-4, IR-CLI-113 AC-2, AC-4
 */
export function actionCounts(actions: readonly NodeCompletionAction[], state: WorkGraphState): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(ACTION_JOURNAL_STATES.map((name) => [name, 0]));
  if (state.cited_checked) for (const name of ACTION_SCANNED_STATES) counts[name] = 0;
  const nodeStates = new Map(state.nodes.map((node) => [node.wave, node.state]));
  for (const entry of actions) {
    counts[entry.state] = (counts[entry.state] as number) + 1;
    if (!state.cited_checked || entry.state !== "pending") continue;
    const reported = reportedActionState(entry.state, nodeStates.get(entry.wave) as NodeStateName);
    counts[reported] = (counts[reported] as number) + 1;
  }
  return counts;
}

/** The text a due action carries when it declares no `message`. @req FR-NODE-251 AC-5 */
export const DEFAULT_ACTION_MESSAGE = "{wave} {title} is complete in run {run_id}: {acs_done} of {acs_total} acceptance criteria done.";

/** Any one of the closed placeholders. */
const PLACEHOLDER_PATTERN = new RegExp(MESSAGE_PLACEHOLDERS.map((placeholder) => placeholder.replace(/[{}]/g, "\\$&")).join("|"), "g");

/** The closed placeholders of a message, substituted from the node and its scanned state. @req FR-NODE-251 AC-5 */
export function renderActionMessage(template: string, runId: string, node: WorkGraphNode, state: NodeState): string {
  const values: Record<(typeof MESSAGE_PLACEHOLDERS)[number], string> = {
    "{run_id}": runId,
    "{wave}": node.wave,
    "{title}": node.title,
    "{purpose}": node.purpose,
    "{acs_done}": String(state.ac_done),
    "{acs_total}": String(state.ac_total),
    "{github_issues}": (node.githubIssues ?? []).map(String).join(", "),
    "{completed_at}": state.completed_at ?? ""
  };
  // One left-to-right scan of the template: a substituted value is never scanned again, so a title
  // holding `{purpose}` stays as written.
  return template.replace(PLACEHOLDER_PATTERN, (placeholder) => values[placeholder as (typeof MESSAGE_PLACEHOLDERS)[number]]);
}

/** One action as `wave actions` reports it; only a due action carries the message and the lines. */
export interface ActionRow {
  readonly wave: string;
  readonly action_id: string;
  readonly kind: CompletionAction["kind"];
  readonly key: string;
  readonly state: ActionReportedState;
  readonly blocking: boolean;
  readonly channel?: string;
  readonly text?: string;
  readonly message?: string;
  /** The intent line to append before acting, and the result line after (`result` set to the outcome). */
  readonly append?: { readonly intent: Record<string, unknown>; readonly result: Record<string, unknown> };
}

export interface ActionRowsInput {
  readonly graph: WorkGraph;
  readonly runId: string;
  readonly engine: string;
  readonly actions: readonly NodeCompletionAction[];
  /** The scanned derivation: only a state computed with the citation scan decides `due`. */
  readonly state: WorkGraphState;
}

/**
 * Every action of every finished node in its reported state; a due one carries its key, kind, alias or
 * instruction text, `blocking`, the rendered message and the intent and result lines to append. The
 * alias is never resolved to an address. @req FR-NODE-251 AC-4, AC-5, AC-7
 */
export function actionRows(input: ActionRowsInput): ActionRow[] {
  const nodes = new Map(input.graph.nodes.map((node) => [node.wave, node]));
  const states = new Map(input.state.nodes.map((node) => [node.wave, node]));
  return input.actions.map((entry) => {
    const node = nodes.get(entry.wave) as WorkGraphNode;
    const nodeState = states.get(entry.wave) as NodeState;
    const state = reportedActionState(entry.state, nodeState.state);
    const { action } = entry;
    const row = {
      wave: entry.wave,
      action_id: action.id,
      kind: action.kind,
      key: entry.key,
      state,
      blocking: action.blocking,
      ...(action.kind === "notify" ? { channel: action.channel } : { text: action.text })
    };
    if (state !== "due") return row;
    const intent = {
      schema_version: CURRENT_WAVES_SCHEMA_VERSION,
      run_id: input.runId,
      engine: input.engine,
      verb: NODE_COMPLETE_ACTION_VERB,
      wave: entry.wave,
      action_id: action.id,
      completion_ref: entry.completionRef,
      attempt: 1
    };
    const template = action.kind === "notify" && action.message !== undefined ? action.message : DEFAULT_ACTION_MESSAGE;
    return { ...row, message: renderActionMessage(template, input.runId, node, nodeState), append: { intent, result: { ...intent, result: "sent" } } };
  });
}
