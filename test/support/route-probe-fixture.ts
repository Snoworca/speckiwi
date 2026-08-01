import type { RouteProbe } from "../../src/core/orchestrator/route.js";

/**
 * A schema-valid probe on which **no** disqualifier fires, so `computeRoute` selects `R-PLAN` with an
 * empty `removed[]`. Every fixture in the routing suite is this baseline plus the one field the case is
 * about, so a firing is attributable to that field and nothing else.
 *
 * `anchoredReqs` is empty and the plan's `req_ids` meet `scopeReqIds` instead, which is D6's substitute
 * link branch (09 §3.3 D6): the anchored branch would need D1 to be cleared by a coverage below 0.2,
 * and that in turn withholds the `recommended` marker (09 §8.2 clause 5), which several fixtures need.
 */
export function baseProbe(overrides: Partial<RouteProbe> = {}): RouteProbe {
  return {
    mode: "sdd",
    modeSource: "mcp",
    planContractOk: true,
    planRejectReason: null,
    planOpenTasks: 3,
    planReqIds: ["FR-NODE-001"],
    planTarget: "v2.6.0",
    anchoredReqs: [],
    anchorCoverage: 0.5,
    scopes: ["NODE"],
    scopeReqIds: ["FR-NODE-001"],
    externalPaths: [],
    ambiguities: 0,
    orderedSections: 0,
    linkedSubIssues: 0,
    taskListGroups: 0,
    declaredExistingReqEdit: false,
    activeTarget: "v2.6.0",
    blockedStability: [],
    unreadable: [],
    ...overrides
  };
}

/** The baseline with `R-PLAN` removed by D5 alone, so the selected rung is `R-STEP`. */
export function stepProbe(overrides: Partial<RouteProbe> = {}): RouteProbe {
  return baseProbe({ planContractOk: false, planRejectReason: "plan_contract must be 1.2.0", ...overrides });
}
