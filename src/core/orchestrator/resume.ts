// @req FR-NODE-150 — `computeResumeState(view, card, gitFacts, driftInputs)`.
//
// A resumed session has no conversation, so the next action is derived from artifacts alone. Every
// impure fact arrives injected: git observations as `gitFacts`, and the operands of §4.7's drift
// digests 2, 3 and 4 as `driftInputs`, because those read values no journal view, card or git fact
// carries. The signature is structurally incapable of accepting conversation state, and the module
// shells out to nothing.
import {
  recoveryClassOf,
  type DriftOutcome,
  type LaneClassName,
  type ReconciliationOutcome,
  type RecoveryClass,
  type ResumeBlockingGate,
  type VerbName,
  type WavesEvent
} from "./journal-schema.js";
import { hasMergeWitness, readLaneDisposition, type OrchTrailerCommit } from "./lane-state.js";
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

export interface RecordedLaneInputs {
  sidecarDigest: string;
  registryDigest: string;
  existingPathsDigest: string;
  designItemMapDigest: string;
  priorPostmortemDigests: string[];
  laneCap: number;
  codeRoots: string[];
  testRoots: string[];
}

export interface LockDigests {
  design: string;
  waves: string;
  lanes: string;
  handoff: Record<string, string>;
  issues: string;
  postmortem: string;
}

export interface DriftInputs {
  lockDigests: LockDigests;
  /** What `lanes.lock.json` records, for digest 3. */
  recordedLaneInputs: RecordedLaneInputs;
  /** The same five inputs re-read and re-digested now. */
  recomputedLaneInputDigests: {
    sidecarDigest: string;
    registryDigest: string;
    existingPathsDigest: string;
    designItemMapDigest: string;
    priorPostmortemDigests: string[];
  };
  /** Digest 2's comparand, keyed by the intent line's `verb|wave|stage|lane`. */
  freshIntentDigests: Record<string, string>;
  /** Digest 4's comparand, keyed by lane. */
  handoffProseDigests: Record<string, string>;
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
    // is not a settlement: the lane falls through to the classes below.
    const read = readLaneDisposition(view.lines, { wave, stage, lane });
    const disposition = read.ok && read.disposition !== null;
    const branch = branchFor(gitFacts, lane);
    // @req FR-NODE-160 — the witness a phase-1 run leaves is a trailered commit on the integration
    // branch, not a lane branch: the unit commits onto integration and creates no branch of its own,
    // so `ancestorOfIntegration` was always false here and a landed unit fell through to
    // `not-dispatched` with `execute-unit` next and nothing blocking. The lane-branch form is kept
    // because phase 2 does create one; either witness is a landing.
    const merged =
      branch?.ancestorOfIntegration === true ||
      hasMergeWitness(gitFacts.integrationCommits ?? [], view.runId, { wave, stage, lane });
    const integrated = events.some((event) => event.verb === "integrate-lane" && event.event === "result");
    const live = liveness(gitFacts, lane, hasUnmatchedExternalIntent);

    // First match wins, in §4.6's order.
    if (live !== "dead") return { lane, wave, stage, klass: "lane-possibly-live" as LaneClassName, nextVerb: null };
    if (disposition && !merged) return { lane, wave, stage, klass: "lane-quarantined" as LaneClassName, nextVerb: null };
    if (merged && integrated) return { lane, wave, stage, klass: "lane-landed" as LaneClassName, nextVerb: null };
    if (merged && !integrated) return { lane, wave, stage, klass: "journal-behind-git" as LaneClassName, nextVerb: null };
    // Phase 1 creates no lane branch, so `lane-collectable` and `lane-integrable` are unreachable and
    // an un-landed unit resolves to the one executor phase 1 has (§4.6, §5.14).
    return { lane, wave, stage, klass: "not-dispatched" as LaneClassName, nextVerb: "execute-unit" as VerbName };
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

  const recorded = driftInputs.recordedLaneInputs;
  const now = driftInputs.recomputedLaneInputDigests;
  const planDrift =
    recorded.sidecarDigest !== now.sidecarDigest ||
    recorded.registryDigest !== now.registryDigest ||
    recorded.designItemMapDigest !== now.designItemMapDigest;
  // A file a lane created or a postmortem a wave wrote is normal progress: the plan is stale but not
  // wrong, and the lock is NOT recomputed mid-wave.
  const staleNotWrong =
    recorded.existingPathsDigest !== now.existingPathsDigest ||
    recorded.priorPostmortemDigests.join(" ") !== now.priorPostmortemDigests.join(" ");
  digests.push({
    index: 3,
    outcome: planDrift ? "drift" : staleNotWrong ? "stale-not-wrong" : "match",
    gate: planDrift ? "lane-plan-drift" : null,
    detail: planDrift
      ? "a lane-plan input the lock pins changed under the run"
      : staleNotWrong
        ? "existing paths or prior postmortems moved; the plan is stale but not wrong"
        : "every recorded lane-plan input still digests the same"
  });

  const editedHandoffs = Object.entries(driftInputs.handoffProseDigests).filter(
    ([lane, digest]) => driftInputs.lockDigests.handoff[lane] !== undefined && driftInputs.lockDigests.handoff[lane] !== digest
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
