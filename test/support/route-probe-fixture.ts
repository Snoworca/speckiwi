import type { RouteProbe } from "../../src/core/orchestrator/route.js";

/**
 * A schema-valid probe on which **no** disqualifier fires, so `computeRoute` selects `R-STEP` with an
 * empty `removed[]`. Every fixture in the routing suite is this baseline plus the one field the case is
 * about, so a firing is attributable to that field and nothing else.
 *
 * `anchoredReqs` is empty while coverage sits above 0.2: D1 stays clear, and 09 §8.2 clause 5 still
 * holds, which the `recommended` fixtures need.
 */
export function baseProbe(overrides: Partial<RouteProbe> = {}): RouteProbe {
  return {
    mode: "sdd",
    modeSource: "mcp",
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

/**
 * The baseline under the name the lock and resume suites use for "a probe that classifies `R-STEP`".
 * Since FR-NODE-212 removed the plan rung the baseline itself classifies `R-STEP`, so the two coincide.
 */
export function stepProbe(overrides: Partial<RouteProbe> = {}): RouteProbe {
  return baseProbe(overrides);
}
