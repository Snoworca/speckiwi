import { LANE_DISPOSITION_KINDS, waveNumber, type LaneDispositionKind, type WavesEvent } from "./journal-schema.js";

/**
 * Lane disposition and stage settlement — 05 §4.6's `lane-quarantined` class and §4.1's
 * `P-PRIOR-STAGES-INTEGRATED`.
 *
 * @req FR-NODE-107
 *
 * Both live here rather than inside the resume reducer because they are the same predicate read two
 * ways: a lane is *settled* when it merged or when the journal says it left the run on purpose, and
 * an unmerged settled lane is `lane-quarantined`. §4.6's own text says so — "the same predicate as
 * `P-PRIOR-STAGES-INTEGRATED`, §4.1" — and stating it twice is how a resumed session ends up
 * integrating work one of the two copies had discarded.
 *
 * Phase 1 note: the merge witness is the `git-trailer` proof kind, not `git-ancestor`. §5.14's
 * executor commits **onto** `frozen.integration_branch` and creates no lane branch, so there is no
 * second ref for an ancestry proof to relate (§4.1).
 */

export interface LaneKey {
  readonly wave: number;
  readonly stage: number;
  readonly lane: string;
}

/** §4.2's `lane_disposition` object. Every kind is terminal — the field exists only for lanes that left. */
export interface LaneDisposition {
  readonly kind: LaneDispositionKind;
  readonly reason?: string;
  readonly at?: string;
}

export type LaneDispositionRefusal = { readonly ok: false; readonly code: "lane-disposition-kind-invalid"; readonly detail: string };

export type LaneDispositionRead = { readonly ok: true; readonly disposition: LaneDisposition | null } | LaneDispositionRefusal;

function isLaneDispositionKind(value: unknown): value is LaneDispositionKind {
  return typeof value === "string" && (LANE_DISPOSITION_KINDS as readonly string[]).includes(value);
}

function matchesKey(event: WavesEvent, key: LaneKey): boolean {
  return waveNumber(event.wave) === key.wave && event.stage === key.stage && event.lane === key.lane;
}

/**
 * §4.6's `D(k)`: the `lane_disposition` recorded on **any** result line for `(wave, stage, lane)`.
 *
 * @req FR-NODE-107 AC-3 — no verb filter. In phase 1 the carrier is `execute-unit`; in phase 2 it is
 * `verify-lane` or `collect-lane`. A reader keyed on the phase-2 verbs reads a phase-1 refutation as
 * absent, and §4.6 finding 5's resumed session then integrates the refuted unit.
 *
 * Intent lines are excluded: an intent is a declaration of what is about to be attempted, and a lane
 * that left the run is a fact, which only a result line records (§4.3).
 */
export function readLaneDisposition(events: readonly WavesEvent[], key: LaneKey): LaneDispositionRead {
  let latest: LaneDisposition | null = null;
  for (const event of events) {
    if (event.event !== "result" || event.lane_disposition === undefined || !matchesKey(event, key)) continue;
    const raw = event.lane_disposition as Record<string, unknown>;
    if (!isLaneDispositionKind(raw.kind)) {
      return {
        ok: false,
        code: "lane-disposition-kind-invalid",
        detail: `lane_disposition.kind ${JSON.stringify(raw.kind)} at journal line ${event.journalLine} is outside the closed enum: ${LANE_DISPOSITION_KINDS.join(" | ")}`
      };
    }
    latest = {
      kind: raw.kind,
      ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
      ...(typeof raw.at === "string" ? { at: raw.at } : {})
    };
  }
  return { ok: true, disposition: latest };
}

// ---------------------------------------------------------------------------------------------
// §4.6 — the `lane-quarantined` class
// ---------------------------------------------------------------------------------------------

export interface LaneDispositionClassInput {
  readonly key: LaneKey;
  readonly events: readonly WavesEvent[];
  /** §4.6's `A(k)`. In phase 1 this is `hasMergeWitness`, not an ancestry relation between two refs. */
  readonly merged: boolean;
}

export type LaneDispositionVerdict =
  | { readonly ok: true; readonly applies: true; readonly klass: "lane-quarantined"; readonly nextVerb: null; readonly disposition: LaneDisposition }
  | { readonly ok: true; readonly applies: false }
  | LaneDispositionRefusal;

/**
 * @req FR-NODE-107 AC-1/AC-4 — `D(k)` present and `A(k)` false is `lane-quarantined`, and it is
 * settled: `nextVerb` is `null`, so the stage reduction emits nothing for this lane.
 *
 * `applies: false` means *some other class decides this lane*, not that the lane is fine. The caller
 * must consult this class **before** `not-dispatched`: a refuted phase-1 unit produced no commit and
 * no action line, so `not-dispatched` matches it too, and matching it there re-enters `/kiwi-pm` for
 * the Tasks the run refuted.
 */
export function classifyLaneDisposition(input: LaneDispositionClassInput): LaneDispositionVerdict {
  const read = readLaneDisposition(input.events, input.key);
  if (!read.ok) return read;
  if (read.disposition === null || input.merged) return { ok: true, applies: false };
  return { ok: true, applies: true, klass: "lane-quarantined", nextVerb: null, disposition: read.disposition };
}

// ---------------------------------------------------------------------------------------------
// §4.1 — P-PRIOR-STAGES-INTEGRATED
// ---------------------------------------------------------------------------------------------

/** The four trailers §5.14 difference 5 puts on every unit commit, and X-02 keeps out of the subject. */
export const MERGE_WITNESS_TRAILERS = ["Orch-Run", "Orch-Wave", "Orch-Stage", "Orch-Lane"] as const;

/** One commit on `frozen.integration_branch`, with its git trailers already parsed by the caller. */
export interface OrchTrailerCommit {
  readonly commit: string;
  readonly trailers: Readonly<Record<string, string>>;
}

/**
 * @req FR-NODE-107 AC-7 — the phase-1 merge witness. All four trailers must name this unit; a commit
 * carrying three of them belongs to a different unit of the same run and proves nothing about this one.
 */
export function hasMergeWitness(commits: readonly OrchTrailerCommit[], runId: string, key: LaneKey): boolean {
  const expected: Record<(typeof MERGE_WITNESS_TRAILERS)[number], string> = {
    "Orch-Run": runId,
    "Orch-Wave": String(key.wave),
    "Orch-Stage": String(key.stage),
    "Orch-Lane": key.lane
  };
  return commits.some((commit) => MERGE_WITNESS_TRAILERS.every((trailer) => commit.trailers[trailer] === expected[trailer]));
}

export interface PriorStagesInput {
  readonly runId: string;
  readonly wave: number;
  /** The stage `s` whose precondition is being evaluated. Only stages strictly below it are prior. */
  readonly stage: number;
  /** `lanes.lock.json`'s lane rows for this wave. */
  readonly waveLanes: readonly { readonly lane: string; readonly stage: number }[];
  /** Commits on `frozen.integration_branch`, with their `Orch-*` trailers. */
  readonly integrationCommits: readonly OrchTrailerCommit[];
  readonly events: readonly WavesEvent[];
}

export type PriorStagesResult =
  | { readonly ok: true; readonly satisfied: boolean; readonly unsettled: ReadonlyArray<{ readonly stage: number; readonly lane: string }> }
  | LaneDispositionRefusal;

/**
 * @req FR-NODE-107 AC-5/AC-6 — every lane of every stage `< s` is settled: it carries a merge witness,
 * **or** the journal carries a terminal `lane_disposition` for it.
 *
 * The disposition disjunct is a correction, not a loosening (§4.1). Requiring a merge for every prior
 * lane makes one legally demoted stage-1 lane read false forever, and the wave is then unresumable for
 * the rest of its life.
 *
 * An out-of-enum kind refuses rather than reading the lane as unsettled: silently unsettling it would
 * halt the wave with a message about the wrong lane.
 */
export function evaluatePriorStagesIntegrated(input: PriorStagesInput): PriorStagesResult {
  const unsettled: Array<{ stage: number; lane: string }> = [];
  for (const row of input.waveLanes) {
    if (row.stage >= input.stage) continue;
    const key: LaneKey = { wave: input.wave, stage: row.stage, lane: row.lane };
    if (hasMergeWitness(input.integrationCommits, input.runId, key)) continue;
    const read = readLaneDisposition(input.events, key);
    if (!read.ok) return read;
    if (read.disposition === null) unsettled.push({ stage: row.stage, lane: row.lane });
  }
  return { ok: true, satisfied: unsettled.length === 0, unsettled };
}
