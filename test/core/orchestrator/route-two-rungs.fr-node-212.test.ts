import { describe, expect, it } from "vitest";
import { GATE_IDS } from "../../../src/core/orchestrator/auto-gate.js";
import * as routeModule from "../../../src/core/orchestrator/route.js";
import * as routeProbeModule from "../../../src/core/orchestrator/route-probe.js";
import { CLASSIFIER_VERSION, computeRoute, DISQUALIFIERS, GATED_BY, PROBE_FIELD_IDS, RUNGS, SELECTION_ORDER } from "../../../src/core/orchestrator/route.js";
import { parseRouteProbe } from "../../../src/core/orchestrator/route-probe.js";
import { baseProbe } from "../../support/route-probe-fixture.js";
import { probeDocument } from "../../support/route-probe-document.js";

// @req FR-NODE-212 — the route classifier has two rungs, R-STEP and then R-ORCH. The plan rung, its probe
// field S2, the plan-only disqualifiers D5–D7 and the plan close-out gate leave with plan mode.

const AUTO = { auto: false } as const;

describe("FR-NODE-212 AC-1 — two rungs, no plan probe field, no plan-only disqualifier, no plan close-out gate", () => {
  it("FR-NODE-212 AC-1: RUNGS and the selection order are exactly R-STEP then R-ORCH", () => {
    expect([...RUNGS]).toEqual(["R-STEP", "R-ORCH"]);
    expect([...SELECTION_ORDER]).toEqual(["R-STEP", "R-ORCH"]);
  });

  it("FR-NODE-212 AC-1: probe field S2 is gone from the field ids and from the D8 map", () => {
    expect(PROBE_FIELD_IDS as readonly string[]).not.toContain("S2");
    expect(Object.keys(GATED_BY)).not.toContain("S2");
  });

  it("FR-NODE-212 AC-1: the parsed probe carries no plan field, even when the on-disk probe still writes S2", () => {
    const legacy = probeDocument() as { fields: Record<string, unknown> };
    legacy.fields.S2 = {
      producer: "mcp",
      call: "workflow_next_plan_task",
      value: { contract_ok: true, reject_reason: null, open_tasks: 3, req_ids: ["FR-NODE-001"], target: "v2.6.0" },
      read_at: "2026-08-01T09:00:00.000Z"
    };

    const parsed = parseRouteProbe(legacy);

    expect(Object.keys(parsed).filter((key) => key.startsWith("plan"))).toEqual([]);
    expect(parsed.unreadable).toEqual([]);
    expect(computeRoute(parsed, AUTO).rung).toBe("R-STEP");
  });

  it("FR-NODE-212 AC-1: D5, D6 and D7 are not members of the disqualifier enum", () => {
    expect([...DISQUALIFIERS]).toEqual(["D1", "D2", "D3", "D4", "D8"]);
  });

  it("FR-NODE-212 AC-1: the plan-candidate and plan-contract producers are no longer exported", () => {
    expect(Object.keys(routeProbeModule)).not.toContain("selectPlanCandidate");
    expect(Object.keys(routeProbeModule)).not.toContain("derivePlanProbe");
    expect(Object.keys(routeModule).filter((name) => /plan/i.test(name))).toEqual([]);
  });

  it("FR-NODE-212 AC-1: plan-coverage-unclosed is not a gate id", () => {
    expect(GATE_IDS as readonly string[]).not.toContain("plan-coverage-unclosed");
  });

  it("FR-NODE-212 AC-1: the classifier version is raised from the three-rung route-classifier@1.0.0", () => {
    const match = /^route-classifier@(\d+)\.(\d+)\.(\d+)$/.exec(CLASSIFIER_VERSION);

    expect(match, `unexpected classifier version ${CLASSIFIER_VERSION}`).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThan(1);
  });
});

describe("FR-NODE-212 AC-2 — S9 and S10 are still recorded and remove no rung", () => {
  it("FR-NODE-212 AC-2: the parser still reads S9 and S10, and an unreadable one is still declared", () => {
    const read = parseRouteProbe(probeDocument({ S9: { activeTarget: "4.0.0", summary: {} }, S10: { blocked_stability: ["FR-NODE-007"] } }));
    expect(read.activeTarget).toBe("4.0.0");
    expect(read.blockedStability).toEqual(["FR-NODE-007"]);

    const missing = parseRouteProbe(probeDocument({}, { omit: ["S9", "S10"] }));
    expect(missing.unreadable).toEqual(expect.arrayContaining(["S9", "S10"]));
  });

  it("FR-NODE-212 AC-2: an empty active target, a blocked requirement and an unreadable S9 or S10 remove nothing", () => {
    expect(GATED_BY.S9).toEqual([]);
    expect(GATED_BY.S10).toEqual([]);

    for (const probe of [
      baseProbe({ activeTarget: "" }),
      baseProbe({ activeTarget: null }),
      baseProbe({ blockedStability: ["FR-NODE-007", "FR-NODE-008"] }),
      baseProbe({ unreadable: ["S9"] }),
      baseProbe({ unreadable: ["S10"] })
    ]) {
      const decision = computeRoute(probe, AUTO);
      expect(decision.removed).toEqual([]);
      expect(decision.rung).toBe("R-STEP");
    }
  });
});

describe("FR-NODE-212 AC-3 — an R-STEP selection can still be marked recommended", () => {
  it("FR-NODE-212 AC-3: a clean R-STEP probe is recommended with nothing withheld", () => {
    const decision = computeRoute(baseProbe(), AUTO);

    expect(decision.rung).toBe("R-STEP");
    expect(decision.decisive).toBeNull();
    expect(decision.recommended).toBe(true);
    expect(decision.withheld_because).toEqual([]);
  });
});
