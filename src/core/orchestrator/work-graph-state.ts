// @req FR-NODE-249 — whether each acceptance criterion of a work-graph node is done and which state
// each node is in, derived from the graph, the requirement records, the test citations and the run
// journal. Nothing here is stored in the graph: "was this work really completed" is answered by
// computation. The one derivation `wave status`, `wave show` and `wave actions` read.
//
// Pure: every input arrives as a value. Reading the SRS, scanning the tests and reading the journal
// stay in the command.
import type { AcceptanceCriterion, ExpiredAcceptanceCriterion, EvidenceRow, RequirementRecord } from "../types.js";
import type { TestSufficiencyReport } from "../testing/test-sufficiency.js";
import { coversAcceptanceCriterion } from "../workflow/release-readiness.js";
import { COMPLETION_STATUS, waveNumber, type EventStatus, type WavesEvent } from "./journal-schema.js";
import { waveReadiness, type WorkGraph, type WorkGraphNode } from "./wave-declaration.js";
import { isWaveStateLine } from "./waves-journal.js";

/** What the derivation reads of a requirement record. */
export type StateRecord = Pick<RequirementRecord, "id" | "status"> & {
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly expiredAcceptanceCriteria?: readonly ExpiredAcceptanceCriterion[];
  readonly verificationEvidence: readonly EvidenceRow[];
};

export interface WorkGraphStateInput {
  readonly graph: WorkGraph;
  readonly records: readonly StateRecord[];
  /** `<REQ-ID> AC-<n>` of every criterion some test cites (`citedAcsOf`), or `null` when the scan did not run. */
  readonly cited: ReadonlySet<string> | null;
  /** The lines of the run, in journal order. */
  readonly journal: readonly WavesEvent[];
}

/** One `acs` entry of a node and the four conditions its completion is the conjunction of. @req FR-NODE-249 AC-1 */
export interface AcState {
  /** `<REQ-ID> AC-<n>`, as the node lists it. */
  readonly ref: string;
  readonly checked: boolean;
  /** A Verification Evidence row of its requirement covers it. */
  readonly covered: boolean;
  /** `null` when the citation scan did not run: unchecked, not false. */
  readonly cited: boolean | null;
  readonly expired: boolean;
  readonly done: boolean;
}

/** Every state a node can be in, in the order a summary counts them. */
export const NODE_STATE_NAMES = ["done", "unverified", "running", "failed", "blocked", "ready", "waiting"] as const;
export type NodeStateName = (typeof NODE_STATE_NAMES)[number];

export interface NodeState {
  readonly wave: string;
  readonly state: NodeStateName;
  /** The `phase` of the latest wave-state line, or `null`. */
  readonly phase: string | null;
  readonly acs: readonly AcState[];
  readonly ac_total: number;
  readonly ac_done: number;
  /** The node's `done_when` ids the latest `complete` line does not confirm; empty unless that line is `complete`. */
  readonly done_when_unconfirmed: readonly string[];
  /** @req FR-NODE-249 AC-3 */
  readonly started_at: string | null;
  readonly completed_at: string | null;
}

export interface WorkGraphState {
  /** Whether the citation scan ran. Only a state computed with it decides a `due` action (FR-NODE-251 AC-4). */
  readonly cited_checked: boolean;
  /** In the graph's node order. */
  readonly nodes: readonly NodeState[];
}

/** The criteria `checkTestSufficiency` found cited, as `<REQ-ID> AC-<n>`. @req FR-NODE-249 AC-1 */
export function citedAcsOf(report: Pick<TestSufficiencyReport, "requirements">): Set<string> {
  return new Set(report.requirements.flatMap((requirement) => requirement.acs.filter((ac) => ac.cited).map((ac) => `${requirement.requirementId} ${ac.acId}`)));
}

/** `<REQ-ID> AC-<n>` split at its one space, the form the graph parse admits. */
export function splitRef(ref: string): { requirement: string; acId: string } {
  const at = ref.indexOf(" ");
  return { requirement: ref.slice(0, at), acId: ref.slice(at + 1) };
}

/** Each id's record, a non-discarded one preferred when a body and a step record share the id. */
export function recordsById<R extends Pick<RequirementRecord, "id" | "status">>(records: readonly R[]): Map<string, R> {
  const byId = new Map<string, R>();
  for (const record of records) {
    const known = byId.get(record.id);
    if (known === undefined || (known.status === "discarded" && record.status !== "discarded")) byId.set(record.id, record);
  }
  return byId;
}

/** @req FR-NODE-249 AC-1 */
function acState(ref: string, byId: ReadonlyMap<string, StateRecord>, cited: ReadonlySet<string> | null): AcState {
  const { requirement, acId } = splitRef(ref);
  const record = byId.get(requirement);
  const live = record?.acceptanceCriteria.find((criterion) => criterion.id === acId);
  const expiredCriterion = record?.expiredAcceptanceCriteria?.find((criterion) => criterion.id === acId);
  const checked = (live ?? expiredCriterion)?.checked === true;
  const covered = record !== undefined && record.verificationEvidence.some((row) => coversAcceptanceCriterion(row, acId));
  const expired = expiredCriterion !== undefined && live === undefined;
  const citedValue = cited === null ? null : cited.has(ref);
  const done = live !== undefined && checked && covered && citedValue !== false;
  return { ref, checked, covered, cited: citedValue, expired, done };
}

/** A wave's latest wave-state line and its times. @req FR-NODE-249 AC-2, AC-3 */
export interface NodeLines {
  latest: WavesEvent;
  startedAt: string | null;
  completedAt: string | null;
}

/** Each wave's {@link NodeLines}, by `n`, over the wave-state lines `latestPerWave` reads. */
export function linesByWave(journal: readonly WavesEvent[]): Map<number, NodeLines> {
  const byWave = new Map<number, NodeLines>();
  for (const event of journal) {
    const wave = waveNumber(event.wave);
    if (wave === null || !isWaveStateLine(event)) continue;
    const entry = byWave.get(wave) ?? { latest: event, startedAt: null, completedAt: null };
    entry.latest = event;
    const ts = typeof event.ts === "string" ? event.ts : null;
    if (event.status === "in_progress" && entry.startedAt === null) entry.startedAt = ts;
    if (event.status === COMPLETION_STATUS) entry.completedAt = ts;
    byWave.set(wave, entry);
  }
  return byWave;
}

/** Every node reachable backwards through `edges` from `wave`. */
export function ancestorsOf(wave: string, dependsOn: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const pending = [...(dependsOn.get(wave) ?? [])];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(dependsOn.get(next) ?? []));
  }
  return seen;
}

function confirmedIds(event: WavesEvent): string[] {
  const value = event.done_when_confirmed;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * The state of every node: `done` / `unverified` from a `complete` latest line and the AC and
 * `done_when` conditions, `running` / `failed` from the latest line, and for a node with no such line
 * `blocked` under a failed ancestor, `ready` by the `waveReadiness` predicate, `waiting` otherwise.
 * @req FR-NODE-249 AC-1, AC-2, AC-3, AC-4
 */
export function deriveWorkGraphState(input: WorkGraphStateInput): WorkGraphState {
  const byId = recordsById(input.records);
  const lines = linesByWave(input.journal);
  const statuses = new Map<number, EventStatus>();
  for (const [wave, entry] of lines) statuses.set(wave, entry.latest.status as EventStatus);
  const ready = new Set(waveReadiness(input.graph.declaration, statuses).ready.map((entry) => entry.wave));
  const dependsOn = new Map(input.graph.declaration.waves.map((entry) => [entry.wave, entry.dependsOn]));
  const statusOf = (wave: string): EventStatus | undefined => statuses.get(waveNumber(wave) as number);

  const nodeState = (node: WorkGraphNode): NodeState => {
    const acs = node.acs.map((ref) => acState(ref, byId, input.cited));
    const entry = lines.get(node.order);
    const latest = entry?.latest;
    const status = latest?.status;
    const confirmed = latest === undefined ? [] : confirmedIds(latest);
    const unconfirmed = status === COMPLETION_STATUS ? node.doneWhen.map((item) => item.id).filter((id) => !confirmed.includes(id)) : [];
    let state: NodeStateName;
    if (status === COMPLETION_STATUS) state = acs.every((ac) => ac.done) && unconfirmed.length === 0 ? "done" : "unverified";
    else if (status === "in_progress") state = "running";
    else if (status === "failed") state = "failed";
    else if ([...ancestorsOf(node.wave, dependsOn)].some((wave) => statusOf(wave) === "failed")) state = "blocked";
    else state = ready.has(node.wave) ? "ready" : "waiting";
    return {
      wave: node.wave,
      state,
      phase: typeof latest?.phase === "string" ? latest.phase : null,
      acs,
      ac_total: acs.length,
      ac_done: acs.filter((ac) => ac.done).length,
      done_when_unconfirmed: unconfirmed,
      started_at: entry?.startedAt ?? null,
      completed_at: entry?.completedAt ?? null
    };
  };

  return { cited_checked: input.cited !== null, nodes: input.graph.nodes.map(nodeState) };
}
