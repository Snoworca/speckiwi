import { describe, expect, it } from "vitest";
import { computeRoute, predicateMargin, type RouteProbe } from "../../../src/core/orchestrator/route.js";
import { baseProbe } from "../../support/route-probe-fixture.js";

// FR-NODE-114 — `recommended` is the zero-deliberation path (09 §8.2): a gate offering it adopts it with
// no committee. It is auditable only because it is a pure function of the recorded probe, so every
// fixture here fails exactly one of the five clauses and asserts which clause `withheld_because[]` names.

const AUTO = { auto: false } as const;

/**
 * `R-STEP` selected with nothing removed. Clause 2 applies to an `R-ORCH` selection only
 * (FR-NODE-114 AC-3), so on this probe the clauses in play are 1, 3, 4 and 5.
 */
function recommendedProbe(overrides: Partial<RouteProbe> = {}): RouteProbe {
  return baseProbe(overrides);
}

/** `R-ORCH` selected by D3 at a margin of one, so every clause, clause 2 included, holds. */
function recommendedOrchProbe(overrides: Partial<RouteProbe> = {}): RouteProbe {
  return baseProbe({ scopes: ["NODE", "CLI", "FLOW"], ...overrides });
}

function clauses(probe: RouteProbe): string[] {
  return computeRoute(probe, AUTO).withheld_because.map((entry) => entry.split(":")[0] as string);
}

describe("FR-NODE-114 AC-1 — one fixture per clause, failing in isolation", () => {
  it("FR-NODE-114 AC-1: marks the route recommended when all five clauses hold, on either rung", () => {
    for (const [probe, rung] of [[recommendedProbe(), "R-STEP"], [recommendedOrchProbe(), "R-ORCH"]] as const) {
      const decision = computeRoute(probe, AUTO);

      expect(decision.rung).toBe(rung);
      expect(decision.recommended).toBe(true);
      expect(decision.withheld_because).toEqual([]);
    }
  });

  it("FR-NODE-114 AC-1: clause 1 fails on a non-empty unreadable[]", () => {
    const decision = computeRoute(recommendedProbe({ unreadable: ["S6"] }), AUTO);

    expect(decision.recommended).toBe(false);
    expect(clauses(recommendedProbe({ unreadable: ["S6"] }))).toEqual(["clause-1"]);
    expect(decision.withheld_because.join(" ")).toContain("S6");
  });

  it("FR-NODE-114 AC-1: clause 2 fails on an R-ORCH selection whose decisive count sits at its threshold", () => {
    const atThreshold = recommendedOrchProbe({ scopes: ["NODE", "CLI"] });
    const decision = computeRoute(atThreshold, AUTO);

    expect(decision.rung).toBe("R-ORCH");
    expect(decision.recommended).toBe(false);
    expect(clauses(atThreshold)).toEqual(["clause-2"]);
  });

  it("FR-NODE-114 AC-1: clause 3 fails while an ambiguity survives the QnA", () => {
    const decision = computeRoute(recommendedProbe({ ambiguities: 1 }), AUTO);

    expect(decision.recommended).toBe(false);
    expect(clauses(recommendedProbe({ ambiguities: 1 }))).toEqual(["clause-3"]);
  });

  it("FR-NODE-114 AC-1: clause 4 fails on an R-STEP selection whose mode could not be read", () => {
    const unread = recommendedProbe({ mode: "wait", modeSource: "default-wait" });
    const decision = computeRoute(unread, AUTO);

    expect(decision.rung).toBe("R-STEP");
    expect(decision.recommended).toBe(false);
    expect(clauses(unread)).toEqual(["clause-4"]);
  });

  it("FR-NODE-114 AC-1: clause 5 fails on an R-STEP selection whose anchor coverage is below 0.2", () => {
    const thin = recommendedProbe({ anchorCoverage: 0.19999999 });
    const decision = computeRoute(thin, AUTO);

    expect(decision.rung).toBe("R-STEP");
    expect(decision.recommended).toBe(false);
    expect(clauses(thin)).toEqual(["clause-5"]);
  });
});

describe("FR-NODE-114 AC-2 — decisive is the removal of the rung nearest above the selected one", () => {
  it("FR-NODE-114 AC-2: names the R-STEP removal when R-ORCH is selected", () => {
    const decision = computeRoute(baseProbe({ scopes: ["NODE", "CLI"] }), AUTO);

    expect(decision.rung).toBe("R-ORCH");
    expect(decision.decisive).toEqual({ predicate: "D3", rung: "R-STEP", observed: ["NODE", "CLI"] });
  });

  it("FR-NODE-114 AC-2: takes the lowest D-id when several predicates removed that rung", () => {
    const decision = computeRoute(baseProbe({ externalPaths: ["../sibling/x.ts"], scopes: ["NODE", "CLI"] }), AUTO);

    expect(decision.removed.filter((entry) => entry.rung === "R-STEP").map((entry) => entry.by)).toEqual(["D2", "D3"]);
    expect(decision.decisive?.predicate).toBe("D2");
  });
});

describe("FR-NODE-114 AC-3 — decisive is null on every R-STEP selection, and clause 2 does not apply there", () => {
  it("FR-NODE-114 AC-3: an R-STEP selection has no decisive removal and is still recommended", () => {
    const decision = computeRoute(baseProbe(), AUTO);

    expect(decision.rung).toBe("R-STEP");
    expect(decision.removed).toEqual([]);
    expect(decision.decisive).toBeNull();
    expect(decision.recommended).toBe(true);
    expect(decision.withheld_because).toEqual([]);
  });

  it("FR-NODE-114 AC-3: an R-STEP selection withheld for another clause never names clause 2", () => {
    for (const probe of [baseProbe({ ambiguities: 1 }), baseProbe({ modeSource: "default-wait" }), baseProbe({ anchorCoverage: 0 }), baseProbe({ unreadable: ["S6"] })]) {
      const decision = computeRoute(probe, AUTO);

      expect(decision.rung).toBe("R-STEP");
      expect(decision.decisive).toBeNull();
      expect(clauses(probe)).not.toContain("clause-2");
    }
  });
});

describe("FR-NODE-114 AC-4 — margin is computed per predicate in its own unit", () => {
  it("FR-NODE-114 AC-4: computes D3's margin as the scope count minus 2", () => {
    expect(predicateMargin("D3", baseProbe({ scopes: ["NODE", "CLI"] }))).toBe(0);
    expect(predicateMargin("D3", baseProbe({ scopes: ["NODE", "CLI", "FLOW"] }))).toBe(1);
    expect(predicateMargin("D3", baseProbe({ scopes: ["NODE", "CLI", "FLOW", "MCP"] }))).toBe(2);
  });

  it("FR-NODE-114 AC-4: computes D4's margin as the maximum of its three units", () => {
    expect(predicateMargin("D4", baseProbe({ orderedSections: 5, linkedSubIssues: 3, taskListGroups: 1 }))).toBe(3);
    expect(predicateMargin("D4", baseProbe({ orderedSections: 0, linkedSubIssues: 0, taskListGroups: 4 }))).toBe(3);
    expect(predicateMargin("D4", baseProbe({ orderedSections: 2, linkedSubIssues: 2, taskListGroups: 1 }))).toBe(0);
  });

  it("FR-NODE-114 AC-4: gives the boolean and set-non-empty predicates no numeric margin", () => {
    for (const predicate of ["D1", "D2", "D8"] as const) {
      expect(predicateMargin(predicate, baseProbe())).toBeNull();
    }
  });
});

describe("FR-NODE-114 AC-5 — a count predicate observed exactly at its threshold has margin 0", () => {
  it("FR-NODE-114 AC-5: withholds the marker on a two-scope D3 observation", () => {
    const atThreshold = baseProbe({ scopes: ["NODE", "CLI"] });
    const decision = computeRoute(atThreshold, AUTO);

    expect(decision.decisive?.predicate).toBe("D3");
    expect(predicateMargin("D3", atThreshold)).toBe(0);
    expect(decision.recommended).toBe(false);
    expect(clauses(atThreshold)).toEqual(["clause-2"]);
  });

  it("FR-NODE-114 AC-5: grants the marker once the same predicate carries a margin of one", () => {
    const decision = computeRoute(baseProbe({ scopes: ["NODE", "CLI", "FLOW"] }), AUTO);

    expect(decision.decisive?.predicate).toBe("D3");
    expect(decision.recommended).toBe(true);
  });
});

describe("FR-NODE-114 AC-6 — boolean predicates satisfy clause 2 only through corroboration", () => {
  it("FR-NODE-114 AC-6: withholds when the decisive boolean predicate is the only predicate that fired", () => {
    const alone = baseProbe({ externalPaths: ["../sibling/x.ts"] });
    const decision = computeRoute(alone, AUTO);

    expect(decision.rung).toBe("R-ORCH");
    expect(decision.removed.map((entry) => entry.by)).toEqual(["D2"]);
    expect(decision.recommended).toBe(false);
    expect(clauses(alone)).toEqual(["clause-2"]);
  });

  it("FR-NODE-114 AC-6: grants the marker when another predicate also fired", () => {
    const corroborated = baseProbe({ declaredExistingReqEdit: true, externalPaths: ["../sibling/x.ts"] });
    const decision = computeRoute(corroborated, AUTO);

    expect(decision.decisive?.predicate).toBe("D1");
    expect(decision.recommended).toBe(true);
  });
});

describe("FR-NODE-114 AC-7 — re-running over the recorded probe reproduces the marker", () => {
  it("FR-NODE-114 AC-7: returns the same recommended, decisive and withheld_because on a second run", () => {
    const probe = recommendedProbe({ ambiguities: 2, modeSource: "default-wait", unreadable: ["S1"] });

    const first = computeRoute(probe, AUTO);
    const second = computeRoute(JSON.parse(JSON.stringify(probe)) as RouteProbe, AUTO);

    expect(second.recommended).toBe(first.recommended);
    expect(second.decisive).toEqual(first.decisive);
    expect(second.withheld_because).toEqual(first.withheld_because);
    expect(first.withheld_because.map((entry) => entry.split(":")[0])).toEqual(["clause-1", "clause-3", "clause-4"]);
  });
});
