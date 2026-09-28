// @req FR-NODE-150 — `computeResumeState(view, card, gitFacts, driftInputs)`.
//
// A resumed session has no conversation, so the next action is derived from artifacts alone. Every
// impure fact arrives injected: git observations as `gitFacts`, and the operands of §4.7's drift
// digests 2, 3 and 4 as `driftInputs`, because those read values no journal view, card or git fact
// carries. The signature is structurally incapable of accepting conversation state, and the module
// shells out to nothing.
import {
  CARD_PRECONDITIONS_RETIRED_IN_4_0_0,
  LANE_DISPOSITION_KINDS_RETIRED_IN_4_0_0,
  VERBS_RETIRED_IN_4_0_0,
  recoveryClassOf,
  writtenBefore400,
  type DriftOutcome,
  type LaneClassName,
  type ReconciliationOutcome,
  type RecoveryClass,
  type ResumeBlockingGate,
  type VerbName,
  type WavesEvent
} from "./journal-schema.js";
import { hasMergeWitness, readLaneDisposition, type OrchTrailerCommit } from "./lane-state.js";
import type { WaveSdsDigest } from "./freeze.js";
import { computeInvariantDigest, type ResumeCard } from "./resume-card.js";
// @req FR-NODE-113 — 09 §9.5 step 3's drift check, and deliberately not the classifier: the rung is
// read on resume, never re-judged, and a module that cannot reach the classifier cannot re-judge it
// even by accident.
import { checkRouteDrift } from "./route-lock.js";
import type { WavesJournalView } from "./waves-journal.js";

export interface GitFacts {
  branches: Array<{ name: string; sha: string; ancestorOfIntegration: boolean }>;
  worktrees: Array<{ path: string; branch: string | null; locked: boolean }>;
  /**
   * Phase 2's freshness conjunct (§P2 5.5.3). Phase 1 creates no worktree, so liveness here is decided
   * by the workspace lock and by the unattributed-workspace window alone — which is what keeps this
   * function free of a clock.
   */
  heartbeats: Array<{ lane: string; mtimeMs: number }>;
  integrationHead: string;
  hostStatusPaths: string[];
  /**
   * @req FR-NODE-160 — the commits reachable from the integration branch, with their `Orch-*`
   * trailers. This is the merge witness a phase-1 run actually leaves: the unit commits onto the
   * integration branch and creates no lane branch, so a lane-branch ancestry proof is structurally
   * always false here and a landed unit read as never dispatched. The caller supplies these for the
   * same reason it supplies every other fact in this bundle — the tool never invents them.
   */
  integrationCommits?: readonly OrchTrailerCommit[];
}

/** What `lanes.lock.json` records for `computeLanePlan`'s inputs (FR-NODE-138 AC-6). */
export interface RecordedLaneInputs {
  /** One SDS digest per wave, keyed by wave id — one per file for a wave made of several SDS files. */
  sdsDigests: Record<string, WaveSdsDigest>;
  depends: Record<string, string[]>;
  laneCap: number;
}

/**
 * The SDS digests re-read now. A wave whose close-out commit deleted its SDS (FR-FLOW-183 AC-3) is
 * named in `closedOutWaves` and is not recomputed; any other wave with no digest here has lost its SDS
 * under the run, which is drift rather than something to skip.
 */
export interface RecomputedLaneInputDigests {
  sdsDigests: Record<string, WaveSdsDigest>;
  closedOutWaves: string[];
}

export interface LockDigests {
  design: string;
  waves: string;
  lanes: string;
  /**
   * Digest 4's recorded side. @req FR-NODE-150 AC-4, FR-NODE-213 AC-6 — optional since 4.0.0, which
   * freezes no handoff lock; a run that did freeze one is refused as a pre-4.0.0 run before this is read.
   */
  handoff?: Record<string, string>;
  issues: string;
  postmortem: string;
}

export interface DriftInputs {
  lockDigests: LockDigests;
  /** What `lanes.lock.json` records, for digest 3. */
  recordedLaneInputs: RecordedLaneInputs;
  /** The recorded SDS digests re-read and re-digested now. */
  recomputedLaneInputDigests: RecomputedLaneInputDigests;
  /** Digest 2's comparand, keyed by the intent line's `verb|wave|stage|lane`. */
  freshIntentDigests: Record<string, string>;
  /** Digest 4's comparand, keyed by lane. Optional for the reason {@link LockDigests.handoff} gives. */
  handoffProseDigests?: Record<string, string>;
  /**
   * @req FR-NODE-113 AC-6 — `routing/probe.json` and `routing/route.lock.json` as they digest on disk
   * NOW, which is 09 §9.5 step 3's comparand. It rides here rather than being derived because both
   * values are file reads, and this module performs none. Absent for a run whose route is not frozen
   * yet; a card carrying `frozen.route` and observations carrying nothing is not an assertion that the
   * route still matches, so digest 1 stays silent on the route in that case.
   */
  routeObserved?: { probeDigest: string; lockDigest: string };
}

export interface LaneClass {
  lane: string;
  wave: number;
  stage: number;
  klass: LaneClassName;
  nextVerb: VerbName | null;
}

export interface NextAction {
  verb: VerbName | null;
  args: { wave?: number; stage?: number; lane?: string };
  recoveryClass: RecoveryClass | null;
  interrupted: boolean;
  reconciliation: ReconciliationOutcome;
}

export interface DriftReport {
  digests: Array<{
    index: 1 | 2 | 3 | 4;
    outcome: DriftOutcome;
    gate: "run-invariant-drift" | "lane-plan-drift" | null;
    detail: string;
  }>;
}

/**
 * @req FR-NODE-150 AC-6 — a CLOSED four-field record. The executed rung is deliberately not a fifth:
 * `frozen.route.rung` is read straight off the card by whoever holds it (09 §9.5 step 2), and routing
 * it through a derivation here would make a read look like a computation.
 */
export interface ResumeState {
  classification: LaneClass[];
  nextAction: NextAction;
  drift: DriftReport;
  blocking: ResumeBlockingGate | null;
}

// ---------------------------------------------------------------------------------------------
// §4.3's invariant — the last line for each (verb, wave, lane) key must be a result
// ---------------------------------------------------------------------------------------------

interface InterruptedVerb {
  key: string;
  event: WavesEvent;
}

function firstInterruptedVerb(view: WavesJournalView): InterruptedVerb | null {
  let earliest: InterruptedVerb | null = null;
  for (const [key, events] of view.byVerb) {
    const last = events[events.length - 1];
    if (!last || last.event !== "intent") continue;
    if (!earliest || last.journalLine < earliest.event.journalLine) earliest = { key, event: last };
  }
  return earliest;
}

// ---------------------------------------------------------------------------------------------
// §4.6 — the per-lane classification, reduced over the current (wave, stage)
// ---------------------------------------------------------------------------------------------

function laneKeyParts(key: string): { wave: number; stage: number; lane: string } | null {
  const match = /^wave-(\d+)\/s(\d+)\/(lane-[^/]+)$/.exec(key);
  if (!match) return null;
  return { wave: Number.parseInt(match[1] as string, 10), stage: Number.parseInt(match[2] as string, 10), lane: match[3] as string };
}

/** A branch belongs to lane k when its name's last segment is the lane id. */
function branchFor(gitFacts: GitFacts, lane: string) {
  return gitFacts.branches.find((branch) => branch.name === lane || branch.name.endsWith(`/${lane}`)) ?? null;
}

/**
 * §4.6's `L(k)`, reduced to what phase 1 can observe. `live` is a locked workspace on the lane's ref;
 * `unknown` is the pre-rename window — an unattributed workspace while some verb of the scope has an
 * unmatched externally-visible intent; everything else is `dead`. The function is TOTAL.
 */
function liveness(gitFacts: GitFacts, lane: string, hasUnmatchedExternalIntent: boolean): "live" | "unknown" | "dead" {
  const attributed = gitFacts.worktrees.find((tree) => tree.branch !== null && (tree.branch === lane || tree.branch.endsWith(`/${lane}`)));
  if (attributed?.locked === true) return "live";
  if (hasUnmatchedExternalIntent && gitFacts.worktrees.some((tree) => tree.branch === null)) return "unknown";
  return "dead";
}

function classifyLanes(
  view: WavesJournalView,
  card: ResumeCard,
  gitFacts: GitFacts,
  hasUnmatchedExternalIntent: boolean
): LaneClass[] {
  const wave = card.position?.wave ?? 0;
  const stage = card.position?.stage ?? 0;

  // The denominator is the journal, never the card: the card is derived, so including it in its own
  // denominator would make a card naming a lane nothing else knows about self-consistent, and
  // `card-stale` could not fire. Phase 1 creates no lane branch, so the journal is the only source
  // that names a lane of `(wave, stage)`.
  const lanes = new Set<string>();
  for (const event of view.lines) {
    if (typeof event.lane !== "string") continue;
    if (event.wave !== `wave-${wave}`) continue;
    if (typeof event.stage === "number" && event.stage !== stage) continue;
    lanes.add(event.lane);
  }

  return [...lanes].sort().map((lane) => {
    const events = view.lines.filter((event) => event.lane === lane && event.wave === `wave-${wave}`);
    // @req FR-NODE-107 — `D(k)` is a disposition whose `kind` is in the closed enum, not the mere
    // presence of a `lane_disposition` object. Classifying on presence let a mistyped kind read as
    // terminal, so a resumed session settled a lane on a value nothing recognised — and settling is
    // the direction that loses work. `readLaneDisposition` refuses an out-of-enum kind, and a refusal
    // is not a settlement. Nor is it a lane never dispatched: the journal says the lane left the run,
    // so dispatching it again repeats finished work. It classifies `divergent`, which halts the resume
    // on the disagreement (FR-NODE-213 AC-6).
    const read = readLaneDisposition(view.lines, { wave, stage, lane });
    const disposition = read.ok && read.disposition !== null;
    const branch = branchFor(gitFacts, lane);
    // @req FR-NODE-160 — a landed worker may leave no lane branch, only a trailered commit on the
    // integration branch, so `ancestorOfIntegration` alone read a landed wave as never dispatched with
    // nothing blocking. Either witness is a landing.
    const merged =
      branch?.ancestorOfIntegration === true ||
      hasMergeWitness(gitFacts.integrationCommits ?? [], view.runId, { wave, stage, lane });
    const integrated = events.some((event) => event.verb === "integrate-lane" && event.event === "result");
    const live = liveness(gitFacts, lane, hasUnmatchedExternalIntent);

    // First match wins, in §4.6's order.
    if (live !== "dead") return { lane, wave, stage, klass: "lane-possibly-live" as LaneClassName, nextVerb: null };
    if (!read.ok) return { lane, wave, stage, klass: "divergent" as LaneClassName, nextVerb: null };
    if (disposition && !merged) return { lane, wave, stage, klass: "lane-quarantined" as LaneClassName, nextVerb: null };
    if (merged && integrated) return { lane, wave, stage, klass: "lane-landed" as LaneClassName, nextVerb: null };
    if (merged && !integrated) return { lane, wave, stage, klass: "journal-behind-git" as LaneClassName, nextVerb: null };
    // @req FR-NODE-160 AC-4 — an un-landed wave's worker is dispatched again.
    return { lane, wave, stage, klass: "not-dispatched" as LaneClassName, nextVerb: "dispatch-lane" as VerbName };
  });
}

/**
 * §4.6's card-disagreement predicate, projected into the card's own vocabulary: phase 1 projects
 * `open[].state` as the single value `executing`, so a lane the card holds open that the
 * classification does not name, or names as settled, is a disagreement.
 */
function cardDisagrees(card: ResumeCard, classification: LaneClass[]): boolean {
  const wave = card.position?.wave ?? 0;
  const stage = card.position?.stage ?? 0;
  const settled = new Set(classification.filter((entry) => entry.nextVerb === null).map((entry) => entry.lane));
  const known = new Set(classification.map((entry) => entry.lane));

  for (const entry of card.open ?? []) {
    const parts = laneKeyParts(entry.key);
    if (!parts || parts.wave !== wave || parts.stage !== stage) continue;
    if (!known.has(parts.lane) || settled.has(parts.lane)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// §4.7 — the four drift digests
// ---------------------------------------------------------------------------------------------

/**
 * The SDS of `wave` that no longer digests as recorded: the wave itself for a one-file wave, and each
 * file by path for a wave made of several, so a drift names the file that moved. @req FR-NODE-213 AC-2
 */
function driftedSdsFiles(wave: string, recorded: WaveSdsDigest, now: WaveSdsDigest | undefined): string[] {
  if (typeof recorded === "string") return now === recorded ? [] : [wave];
  const nowFiles: Readonly<Record<string, string>> = typeof now === "object" ? now : {};
  return Object.entries(recorded)
    .filter(([file, digest]) => nowFiles[file] !== digest)
    .map(([file]) => `${wave} (${file})`);
}

function computeDrift(view: WavesJournalView, card: ResumeCard, driftInputs: DriftInputs): DriftReport {
  const digests: DriftReport["digests"] = [];

  const recomputed = computeInvariantDigest(card.frozen);
  const lockMoved =
    driftInputs.lockDigests.design !== card.frozen?.design_lock || driftInputs.lockDigests.waves !== card.frozen?.waves_lock;
  const digestHolds = card.invariant_digest === recomputed && !lockMoved;
  // @req FR-NODE-113 AC-6 — 09 §9.5 step 3 joins digest 1 rather than adding a fifth: a route whose
  // probe or lock no longer digests as recorded is the same fact digest 1 already reports, namely that
  // the frozen block no longer describes this run, and it carries the same `run-invariant-drift` gate.
  // The digest over `frozen` cannot catch it on its own — `probe.json` and `route.lock.json` are files
  // OUTSIDE the card, and the card's own copy of their digests recomputes happily against itself.
  const route = card.frozen?.route;
  const routeDrift = route !== undefined && driftInputs.routeObserved !== undefined ? checkRouteDrift(route, driftInputs.routeObserved) : null;
  const invariantMatches = digestHolds && routeDrift === null;
  digests.push({
    index: 1,
    outcome: invariantMatches ? "match" : "drift",
    gate: invariantMatches ? null : "run-invariant-drift",
    detail: !digestHolds
      ? "invariant_digest disagrees with the lock the card names"
      : routeDrift !== null
        ? `frozen.route ${routeDrift.field} recorded ${routeDrift.recorded}, observed ${routeDrift.observed}`
        : "invariant_digest recomputes over the frozen block"
  });

  // Digest 2 compares each intent line's recorded `inputs_digest` against the inputs as they are now.
  // A difference re-runs the verb rather than gating the run: the result was derived from something
  // that no longer exists, which is a reason to redo, not a reason to halt.
  const movedIntents: string[] = [];
  for (const [key, events] of view.byVerb) {
    const fresh = driftInputs.freshIntentDigests[key];
    if (fresh === undefined) continue;
    const intent = events.find((event) => event.event === "intent");
    if (intent && typeof intent.inputs_digest === "string" && intent.inputs_digest !== fresh) movedIntents.push(key);
  }
  digests.push({
    index: 2,
    outcome: movedIntents.length > 0 ? "drift" : "match",
    gate: null,
    detail: movedIntents.length > 0 ? `inputs changed between intent and result: ${movedIntents.join(", ")}` : "every intent's inputs still digest the same"
  });

  // @req FR-NODE-150 AC-5, FR-NODE-213 AC-2 — digest 3 is the SDS of every wave not yet closed out.
  // `stale-not-wrong` keeps its declared slot with no 4.0.0 input producing it: the existing paths and
  // prior postmortems that used to produce it are no longer lane-plan inputs.
  const now = driftInputs.recomputedLaneInputDigests;
  const closedOut = new Set(now.closedOutWaves);
  const driftedWaves = Object.entries(driftInputs.recordedLaneInputs.sdsDigests)
    .filter(([wave]) => !closedOut.has(wave))
    .flatMap(([wave, recorded]) => driftedSdsFiles(wave, recorded, now.sdsDigests[wave]))
    .sort();
  const planDrift = driftedWaves.length > 0;
  digests.push({
    index: 3,
    outcome: planDrift ? "drift" : "match",
    gate: planDrift ? "lane-plan-drift" : null,
    detail: planDrift
      ? `the SDS of ${driftedWaves.join(", ")} no longer digests as the lanes lock recorded`
      : "every recorded SDS of a wave not yet closed out still digests the same"
  });

  // A lane is compared only when both sides name it, so an absent side — the 4.0.0 shape — compares
  // nothing and is a match rather than drift.
  const lockedHandoffs = driftInputs.lockDigests.handoff ?? {};
  const editedHandoffs = Object.entries(driftInputs.handoffProseDigests ?? {}).filter(
    ([lane, digest]) => lockedHandoffs[lane] !== undefined && lockedHandoffs[lane] !== digest
  );
  digests.push({
    index: 4,
    outcome: editedHandoffs.length > 0 ? "drift" : "match",
    gate: null,
    detail:
      editedHandoffs.length > 0
        ? `handoff prose edited after verification: ${editedHandoffs.map(([lane]) => lane).join(", ")}`
        : "every handoff still matches its lock"
  });

  return { digests };
}

// ---------------------------------------------------------------------------------------------
// FR-NODE-213 AC-6 — a run written in the R-PLAN and handoff era
// ---------------------------------------------------------------------------------------------

function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

/**
 * What marks a run as written before 4.0.0 in a vocabulary 4.0.0 removed: a retired lane disposition
 * or verb on a line below 2.0.0, and a card whose next verb, precondition or frozen rung left with the
 * plan rung and the handoff documents. Empty for a run 4.0.0 can resume — including a 1.x run that
 * never used that vocabulary. The resume path refuses a run this names, and names the reasons.
 * @req FR-NODE-213 AC-6
 */
export function retiredRunMarkers(view: WavesJournalView, card: ResumeCard): string[] {
  const markers: string[] = [];
  for (const event of view.lines) {
    if (!writtenBefore400(event)) continue;
    const kind = (event.lane_disposition as { kind?: unknown } | undefined)?.kind;
    if (includes(LANE_DISPOSITION_KINDS_RETIRED_IN_4_0_0, kind)) markers.push(`journal line ${event.journalLine}: lane_disposition.kind ${String(kind)}`);
    if (includes(VERBS_RETIRED_IN_4_0_0, event.verb)) markers.push(`journal line ${event.journalLine}: verb ${String(event.verb)}`);
  }
  const verb: unknown = card.next_action?.verb;
  if (includes(VERBS_RETIRED_IN_4_0_0, verb)) markers.push(`card next_action.verb ${String(verb)}`);
  for (const precondition of card.next_action?.preconditions ?? []) {
    if (includes(CARD_PRECONDITIONS_RETIRED_IN_4_0_0, precondition)) markers.push(`card precondition ${precondition}`);
  }
  const rung: unknown = card.frozen?.route?.rung;
  if (rung === "R-PLAN") markers.push("card frozen.route.rung R-PLAN");
  return markers;
}

// ---------------------------------------------------------------------------------------------

export function computeResumeState(
  view: WavesJournalView,
  card: ResumeCard,
  gitFacts: GitFacts,
  driftInputs: DriftInputs
): ResumeState {
  const interrupted = firstInterruptedVerb(view);
  const interruptedVerb = interrupted ? (interrupted.event.verb as string) : null;
  const recoveryClass = interruptedVerb === null ? null : recoveryClassOf(interruptedVerb);
  const hasUnmatchedExternalIntent = recoveryClass === "externally-visible";

  const classification = classifyLanes(view, card, gitFacts, hasUnmatchedExternalIntent);
  const drift = computeDrift(view, card, driftInputs);

  const possiblyLive = classification.some((entry) => entry.klass === "lane-possibly-live");
  const divergent = classification.some((entry) => entry.klass === "journal-behind-git" || entry.klass === "divergent");
  const reconciliation: ReconciliationOutcome = possiblyLive
    ? "interrupted-external-action"
    : divergent
      ? "ledger-reconciliation-divergent"
      : cardDisagrees(card, classification)
        ? "card-stale"
        : "consistent";

  // The lowest-ranked lane's own next verb, tie-broken by ascending lane id (`classification` is
  // already sorted). An interrupted verb wins over it: the run is mid-verb, not mid-selection.
  const nextLane = classification.find((entry) => entry.nextVerb !== null) ?? null;
  const verb: VerbName | null = interruptedVerb !== null ? (interruptedVerb as VerbName) : (nextLane?.nextVerb ?? null);
  const args: NextAction["args"] = interrupted
    ? {
        ...(typeof interrupted.event.wave === "string" ? { wave: Number.parseInt(interrupted.event.wave.replace("wave-", ""), 10) } : {}),
        ...(typeof interrupted.event.stage === "number" ? { stage: interrupted.event.stage } : {}),
        ...(typeof interrupted.event.lane === "string" ? { lane: interrupted.event.lane } : {})
      }
    : nextLane
      ? { wave: nextLane.wave, stage: nextLane.stage, lane: nextLane.lane }
      : {};

  const driftGate = drift.digests.find((entry) => entry.gate !== null)?.gate ?? null;
  const reconciliationGate: ResumeBlockingGate | null =
    reconciliation === "interrupted-external-action" || reconciliation === "ledger-reconciliation-divergent" ? reconciliation : null;

  return {
    classification,
    nextAction: {
      verb,
      args,
      recoveryClass: verb === null ? null : recoveryClassOf(verb),
      interrupted: interrupted !== null,
      reconciliation
    },
    // A drift gate outranks a reconciliation gate: a run whose frozen block no longer recomputes must
    // not proceed on a classification computed from it.
    drift,
    blocking: driftGate ?? reconciliationGate
  };
}
