// @req FR-NODE-110, FR-NODE-114 — the routing classifier of `docs/research/kiwi-orchestrator/09.routing-design.md`.
//
// The module is pure: no filesystem, no git, no network, no clock. It imports nothing, which is the
// enforcement of that claim rather than a comment about it. `probe.json` is read by `parseRouteProbe`
// (`route-probe.ts`) and the lock is written by `freezeRoute` (`route-lock.ts`); this file only decides.
//
// It is **disqualifier-first**: every predicate *removes* rungs and none selects one. That buys the
// property the whole design exists for — a wrong route always traces to one named predicate and one
// recorded value.

/** 09 §3.6. The closed rung vocabulary, in no particular order; `SELECTION_ORDER` is the ordered one. */
export const RUNGS = ["R-STEP", "R-PLAN", "R-ORCH"] as const;

export type Rung = (typeof RUNGS)[number];

/** 09 §3.4. First surviving rung wins. `R-ORCH` is last because no predicate may remove it. */
export const SELECTION_ORDER: readonly Rung[] = ["R-PLAN", "R-STEP", "R-ORCH"];

export const DISQUALIFIERS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"] as const;

export type DisqualifierId = (typeof DISQUALIFIERS)[number];

/**
 * 09 §3.2. The S-rows a predicate reads. `S11` is the `unreadable[]` list itself and so is not a member,
 * and there is no `S13`: the probe's field set is closed (§4.6).
 */
export const PROBE_FIELD_IDS = ["S1", "S2", "S3", "S3c", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S12"] as const;

export type ProbeFieldId = (typeof PROBE_FIELD_IDS)[number];

/**
 * 09 §3.3 D8. The rung each probe field protects, as a **total** map: a field carrying no protected rung
 * maps to the empty list, never to `undefined`, so the loop below is defined for every member.
 *
 * `S1`'s fail-open lands on `wait` and is §4's business; `S6` feeds only §8.2 clause 3. `R-ORCH` is
 * never removed by anything, here or elsewhere.
 */
export const GATED_BY: Record<ProbeFieldId, readonly Rung[]> = {
  S1: [],
  S2: ["R-PLAN"],
  S3: ["R-STEP"],
  S3c: ["R-STEP"],
  S4: ["R-STEP"],
  S5: ["R-STEP"],
  S6: [],
  S7: ["R-STEP"],
  S8: ["R-STEP"],
  S9: ["R-PLAN"],
  S10: ["R-PLAN"],
  S12: ["R-STEP"]
};

/**
 * The rungs D8 removes for an `unreadable[]` member outside `PROBE_FIELD_IDS`.
 *
 * `unreadable[]` arrives from a JSON document a producer wrote, so no type stops a thirteenth id — and
 * `S11` is the likeliest of all, because 09 §3.2 names S11 as the unreadable list itself. Dropping such
 * an id would read "a field could not be read" as "every field was read", which is the fail-open
 * direction FR-NODE-111 exists to close; removing only one rung would need knowledge the id does not
 * carry. Both cheap rungs go, `R-ORCH` survives as always, and §8.2 clause 1 withholds the marker.
 */
export const UNRECOGNISED_FIELD_GATES: readonly Rung[] = ["R-PLAN", "R-STEP"];

/** Total over every string, which is what makes `computeRoute` total over every probe (09 §3.3 D8). */
export function gatedRungsFor(field: string): readonly Rung[] {
  // `hasOwnProperty`, not `GATED_BY[field] ?? …`: an inherited key such as `constructor` resolves to a
  // function rather than to `undefined`, and the `??` form would then iterate it and throw.
  return Object.prototype.hasOwnProperty.call(GATED_BY, field) ? GATED_BY[field as ProbeFieldId] : UNRECOGNISED_FIELD_GATES;
}

export const CLASSIFIER_VERSION = "route-classifier@1.0.0";

// 09 §3.3. Every threshold is stated once, in its own unit, and read by both the predicate that fires on
// it and the margin §8.2 clause 2 computes from it. Two copies would let a predicate and its margin
// disagree, and the margin is what decides whether the gate takes the zero-deliberation path.
const ANCHOR_COVERAGE_FLOOR = 0.2;
const MULTI_SCOPE_THRESHOLD = 2;
const ORDERED_SECTIONS_THRESHOLD = 2;
const LINKED_SUB_ISSUES_THRESHOLD = 2;
const TASK_LIST_GROUPS_THRESHOLD = 1;

/** `parseRouteProbe`'s parsed projection of `routing/probe.json` (09 §3.6). */
export interface RouteProbe {
  mode: "sdd" | "vibe" | "wait" | "tdd";        // S1.mode
  modeSource: "mcp" | "cli" | "default-wait";   // S1.source
  planContractOk: boolean;                      // S2.contract_ok
  planRejectReason: string | null;              // S2.reject_reason
  planOpenTasks: number;                        // S2.open_tasks
  planReqIds: string[];                         // S2.req_ids (open Tasks)
  planTarget: string | null;                    // S2.target
  anchoredReqs: string[];                       // S3.anchored_reqs[]
  anchorCoverage: number;                       // S3c.anchor_coverage
  scopes: string[];                             // S4.scopes[]
  scopeReqIds: string[];                        // S4.scope_req_ids[]
  externalPaths: string[];                      // S5.external_paths[]
  ambiguities: number;                          // S6.ambiguities
  orderedSections: number;                      // S7.ordered_sections
  linkedSubIssues: number;                      // S8.linked_sub_issues
  taskListGroups: number;                       // S8.task_list_groups
  declaredExistingReqEdit: boolean;             // S12.declared_existing_req_edit
  activeTarget: string | null;                  // S9.activeTarget
  blockedStability: string[];                   // S10.blocked_stability[]
  /**
   * S11.unreadable[]. The vocabulary is `PROBE_FIELD_IDS`, but the type is `string[]` because the list
   * is parsed from a producer's JSON: an id outside the vocabulary is a reachable input, and it is
   * handled fail-closed by `UNRECOGNISED_FIELD_GATES` rather than narrowed away by a type that never
   * held at the boundary.
   */
  unreadable: string[];
}

export interface RouteRemoval {
  rung: Rung;
  by: DisqualifierId;
  observed: unknown;
}

export interface RouteDecisive {
  predicate: DisqualifierId;
  rung: Rung;
  observed: unknown;
}

/**
 * 09 §3.6. A closed six-field record. It deliberately cannot express `proposed_rung`, `overridden_by` or
 * a gate resolution: those are the gate's outputs, they reach the lock through `route-gate.json`
 * (§8.3), and a classifier that could write them could introduce a rung it never computed.
 */
export interface RouteDecision {
  rung: Rung;
  removed: RouteRemoval[];
  alternative: Rung | null;
  decisive: RouteDecisive | null;
  recommended: boolean;
  withheld_because: string[];
}

export interface RouteOptions {
  auto: boolean;
}

/** 09 §3.3 D6. Which branch of the coverage test ran, and what it observed. */
interface CoverageDiff {
  branch: "anchored" | "substitute";
  open_tasks: number;
  plan_target: string | null;
  active_target: string | null;
  intersection: string[];
}

function intersect(left: readonly string[], right: readonly string[]): string[] {
  const other = new Set(right);
  return left.filter((value) => other.has(value));
}

/**
 * 09 §3.2 S3c. The anchor set carries signal only above the coverage floor: in a repository whose
 * requirements were never implemented through `kiwi-coder`, S3 is empty everywhere and would clear the
 * step rung vacuously, so coverage is the guard that stops it.
 */
function anchorSetCarriesSignal(probe: RouteProbe): boolean {
  return probe.anchoredReqs.length > 0 && probe.anchorCoverage >= ANCHOR_COVERAGE_FLOOR;
}

function coverageDiff(probe: RouteProbe): CoverageDiff {
  const anchored = anchorSetCarriesSignal(probe);
  return {
    branch: anchored ? "anchored" : "substitute",
    open_tasks: probe.planOpenTasks,
    plan_target: probe.planTarget,
    active_target: probe.activeTarget,
    intersection: anchored ? intersect(probe.anchoredReqs, probe.planReqIds) : intersect(probe.planReqIds, probe.scopeReqIds)
  };
}

function coversThisWork(diff: CoverageDiff): boolean {
  return diff.plan_target === diff.active_target && diff.intersection.length > 0;
}

/**
 * 09 §3.3 D4's three disjuncts, and which of them fired.
 *
 * The design's §3.6 code block records `p.orderedSections` whichever disjunct fired, so a removal
 * caused by a task-list group is written into the lock and into the gate's committee evidence table as
 * *"D4 observed 0"*. FR-NODE-110 AC-3 requires `observed` to record the value the predicate fired on,
 * so the requirement is followed here and the design's code block is not.
 */
function stagedInput(probe: RouteProbe): { ordered_sections: number; linked_sub_issues: number; task_list_groups: number; fired: string[] } {
  const fired: string[] = [];
  if (probe.orderedSections >= ORDERED_SECTIONS_THRESHOLD) fired.push("ordered_sections");
  if (probe.linkedSubIssues >= LINKED_SUB_ISSUES_THRESHOLD) fired.push("linked_sub_issues");
  if (probe.taskListGroups >= TASK_LIST_GROUPS_THRESHOLD) fired.push("task_list_groups");
  return { ordered_sections: probe.orderedSections, linked_sub_issues: probe.linkedSubIssues, task_list_groups: probe.taskListGroups, fired };
}

/**
 * @req FR-NODE-114 — 09 §8.2. Margin, per predicate, in its own unit. A count predicate observed exactly
 * at its threshold has margin 0 and does not satisfy clause 2's numeric branch. The boolean and
 * set-non-empty predicates carry no numeric margin at all and take the corroboration branch instead,
 * which is what `null` says here.
 */
export function predicateMargin(predicate: DisqualifierId, probe: RouteProbe): number | null {
  if (predicate === "D3") return probe.scopes.length - MULTI_SCOPE_THRESHOLD;
  if (predicate === "D4") {
    return Math.max(
      probe.orderedSections - ORDERED_SECTIONS_THRESHOLD,
      probe.linkedSubIssues - LINKED_SUB_ISSUES_THRESHOLD,
      probe.taskListGroups - TASK_LIST_GROUPS_THRESHOLD
    );
  }
  return null;
}

/**
 * 09 §8.2. The removal of the rung **nearest above** the selected one in the fixed order — the removal
 * that made the selected rung first-surviving. When several predicates removed that rung the lowest
 * D-id wins. `R-PLAN` is first in the order, so an `R-PLAN` selection always yields `null`, and clause 2
 * then fails rather than passing vacuously: a run with nothing removed has no measured discrimination
 * to fast-path on.
 */
function decisiveRemoval(rung: Rung, removed: readonly RouteRemoval[]): RouteDecisive | null {
  const above = SELECTION_ORDER[SELECTION_ORDER.indexOf(rung) - 1];
  if (!above) return null;
  const candidates = removed.filter((entry) => entry.rung === above);
  const first = candidates[0];
  if (!first) return null;
  const lowest = candidates.reduce((best, entry) => (best.by <= entry.by ? best : entry), first);
  return { predicate: lowest.by, rung: lowest.rung, observed: lowest.observed };
}

function marginClause(decisive: RouteDecisive, probe: RouteProbe, removed: readonly RouteRemoval[]): string | null {
  const margin = predicateMargin(decisive.predicate, probe);
  if (margin === null) {
    if (removed.some((entry) => entry.by !== decisive.predicate)) return null;
    return `clause-2: ${decisive.predicate} is a boolean predicate and no other predicate fired`;
  }
  if (margin >= 1) return null;
  if (decisive.predicate === "D3") return `clause-2: D3 observed ${probe.scopes.length} scopes at threshold ${MULTI_SCOPE_THRESHOLD}, margin ${margin}`;
  return `clause-2: D4 observed ${probe.orderedSections} ordered sections, ${probe.linkedSubIssues} linked sub-issues and ${probe.taskListGroups} task-list groups, margin ${margin}`;
}

/**
 * 09 §8.2's five clauses. A gate offering a recommended option adopts it immediately with no committee,
 * so the marker is the zero-deliberation path; it is auditable only because it is a pure function of the
 * recorded probe, and `withheld_because[]` names the clause that failed.
 */
function withheldBecause(probe: RouteProbe, rung: Rung, removed: readonly RouteRemoval[], decisive: RouteDecisive | null): string[] {
  const withheld: string[] = [];
  if (probe.unreadable.length > 0) withheld.push(`clause-1: probe fields unreadable: ${probe.unreadable.join(", ")}`);
  if (!decisive) withheld.push(`clause-2: no rung above ${rung} was removed, so nothing discriminated`);
  else {
    const failure = marginClause(decisive, probe, removed);
    if (failure) withheld.push(failure);
  }
  if (!(probe.ambiguities === 0)) withheld.push(`clause-3: ${probe.ambiguities} ambiguities survive the intake QnA`);
  if (rung === "R-STEP" && probe.modeSource === "default-wait") withheld.push("clause-4: the work-mode could not be read, so its source is default-wait");
  if (rung === "R-STEP" && !(probe.anchorCoverage >= ANCHOR_COVERAGE_FLOOR)) {
    withheld.push(`clause-5: anchor coverage ${probe.anchorCoverage} is below ${ANCHOR_COVERAGE_FLOOR}, so D1 cleared R-STEP on a low-confidence measurement`);
  }
  return withheld;
}

/**
 * @req FR-NODE-110 — 09 §3.6. Pure and total: every input yields exactly one member of `Rung`, because
 * no predicate removes `R-ORCH` and `R-ORCH` is last in the selection order.
 *
 * `opts` is declared because 09 §3.6 declares it and every caller passes it, and it is read by nothing:
 * §4.4 settles that `--auto` is not a disqualifier, and none of §8.2's five clauses mentions it. The
 * unattended-dispatch question it would otherwise answer is asked at the `tdd-route-unattended` gate,
 * after this function has returned.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function computeRoute(probe: RouteProbe, opts: RouteOptions): RouteDecision {
  const removed: RouteRemoval[] = [];
  const kill = (rung: Rung, by: DisqualifierId, observed: unknown): void => {
    removed.push({ rung, by, observed });
  };

  if (anchorSetCarriesSignal(probe)) kill("R-STEP", "D1", probe.anchoredReqs);
  if (probe.declaredExistingReqEdit) kill("R-STEP", "D1", "declared");
  if (probe.externalPaths.length > 0) kill("R-STEP", "D2", probe.externalPaths);
  if (probe.scopes.length >= MULTI_SCOPE_THRESHOLD) kill("R-STEP", "D3", probe.scopes);
  const staged = stagedInput(probe);
  if (staged.fired.length > 0) kill("R-STEP", "D4", staged);
  if (!probe.planContractOk) kill("R-PLAN", "D5", probe.planRejectReason);
  const diff = coverageDiff(probe);
  if (probe.planOpenTasks === 0 || !coversThisWork(diff)) kill("R-PLAN", "D6", diff);
  if (!probe.activeTarget || probe.blockedStability.length > 0) kill("R-PLAN", "D7", probe.blockedStability);
  for (const field of probe.unreadable) for (const rung of gatedRungsFor(field)) kill(rung, "D8", field);

  const dead = new Set(removed.map((entry) => entry.rung));
  const surviving = SELECTION_ORDER.filter((rung) => !dead.has(rung));
  const rung = surviving[0] as Rung; // `R-ORCH` is never in `dead`, so the ladder always terminates.
  const decisive = decisiveRemoval(rung, removed);
  const withheld = withheldBecause(probe, rung, removed, decisive);

  return {
    rung,
    removed,
    alternative: surviving[1] ?? null,
    decisive,
    recommended: withheld.length === 0,
    withheld_because: withheld
  };
}
