import { describe, expect, it } from "vitest";
import { computeRoute, PROBE_FIELD_IDS, type ProbeFieldId } from "../../../src/core/orchestrator/route.js";
import { MALFORMED_FIELD_ID, parseRouteProbe } from "../../../src/core/orchestrator/route-probe.js";
import { probeDocument } from "../../support/route-probe-document.js";
import { baseProbe } from "../../support/route-probe-fixture.js";

// FR-NODE-111 — the parser's whole job is the distinction D8 rests on: a field it could not read versus
// a value a producer legitimately returned (09 §3.2, §3.3 D8). Failing open on the anchored-requirement
// field yields an empty anchor set, which *enables* the step rung — fail-open in the dangerous direction.

const AUTO = { auto: false } as const;

describe("FR-NODE-111 — the on-disk projection", () => {
  it("parses a complete probe document into the flat RouteProbe projection", () => {
    expect(parseRouteProbe(probeDocument())).toEqual(baseProbe());
  });

  it("honours an unreadable id the producer recorded on S11 even when the envelope is present", () => {
    const probe = parseRouteProbe(probeDocument({}, { unreadable: ["S5"] }));

    expect(probe.unreadable).toEqual(["S5"]);
  });
});

describe("FR-NODE-111 AC-1 — one fixture per probe field id", () => {
  it.each(PROBE_FIELD_IDS)("records %s in unreadable[] when the probe cannot supply it", (field) => {
    const probe = parseRouteProbe(probeDocument({}, { omit: [field] }));

    expect(probe.unreadable).toContain(field);
  });

  it.each(PROBE_FIELD_IDS)("records %s in unreadable[] when its envelope carries a null value", (field) => {
    const probe = parseRouteProbe(probeDocument({ [field]: null } as Partial<Record<ProbeFieldId, unknown>>));

    expect(probe.unreadable).toContain(field);
  });

  it("records a field whose value is present but structurally wrong", () => {
    expect(parseRouteProbe(probeDocument({ S3c: { anchor_coverage: "half" } })).unreadable).toContain("S3c");
  });

  it.each([
    ["S3c", { anchor_coverage: Number.POSITIVE_INFINITY }],
    ["S6", { ambiguities: "3", key_entities: [] }],
    ["S1", { mode: "SDD", source: "mcp" }],
    ["S1", { mode: "sdd", source: "http" }],
    ["S3", { anchored_reqs: "FR-NODE-001" }],
    ["S10", { blocked_stability: [1, 2] }],
    ["S12", { declared_existing_req_edit: "yes" }]
  ] as const)("records %s when its value is outside the field's own vocabulary", (field, value) => {
    expect(parseRouteProbe(probeDocument({ [field]: value } as Partial<Record<ProbeFieldId, unknown>>)).unreadable).toContain(field);
  });

  it("preserves an unreadable id it does not recognise instead of dropping it", () => {
    const probe = parseRouteProbe(probeDocument({}, { unreadable: ["S11"] }));

    expect(probe.unreadable).toContain("S11");
  });

  it("never lets an unrecognised id be read as a fully readable probe", () => {
    const probe = parseRouteProbe(probeDocument({}, { unreadable: ["S11"] }));
    const decision = computeRoute(probe, AUTO);

    expect(decision.rung).toBe("R-ORCH");
    expect(decision.recommended).toBe(false);
  });

  it("keeps the readable declarations when one unreadable[] member has the wrong type", () => {
    const document = probeDocument({}, { unreadable: ["S3"] }) as { unreadable: unknown[] };
    document.unreadable.push(7);

    const probe = parseRouteProbe(document);

    expect(probe.unreadable).toContain("S3");
    expect(probe.unreadable).toContain(MALFORMED_FIELD_ID);
  });

  it("fails closed when unreadable[] is not an array at all", () => {
    const probe = parseRouteProbe({ ...(probeDocument() as Record<string, unknown>), unreadable: "S3" });

    expect(probe.unreadable).toEqual([MALFORMED_FIELD_ID]);
    expect(computeRoute(probe, AUTO).rung).toBe("R-ORCH");
  });

  it("orders unreadable[] by the fixed field order, so the projection is deterministic", () => {
    const probe = parseRouteProbe(probeDocument({}, { omit: ["S9", "S3", "S12"] }));

    expect(probe.unreadable).toEqual(["S3", "S9", "S12"]);
  });
});

describe("FR-NODE-111 AC-2 — no unreadable field becomes a permissive default", () => {
  it.each([
    ["S3c", "anchorCoverage"],
    ["S7", "orderedSections"],
    ["S8", "linkedSubIssues"],
    ["S8", "taskListGroups"],
    ["S2", "planOpenTasks"]
  ] as const)("does not read an unreadable %s as 0 on %s", (field, property) => {
    const probe = parseRouteProbe(probeDocument({}, { omit: [field] }));

    expect(probe[property]).not.toBe(0);
    expect(Number.isNaN(probe[property])).toBe(true);
  });

  it.each([
    ["S3", "anchoredReqs"],
    ["S4", "scopes"],
    ["S4", "scopeReqIds"],
    ["S5", "externalPaths"],
    ["S2", "planReqIds"],
    ["S10", "blockedStability"]
  ] as const)("does not read an unreadable %s as [] on %s", (field, property) => {
    const probe = parseRouteProbe(probeDocument({}, { omit: [field] }));

    expect(probe[property]).not.toEqual([]);
    expect(probe[property].length).toBeGreaterThan(0);
  });

  // D8 masks every one of these today: it removes the rung the unreadable field protects whatever the
  // fallback holds. That is exactly why each fallback is pinned here rather than through a rung —
  // otherwise the day D8's map changes, a fallback flipped to its permissive value passes unnoticed.
  it("takes the fail-closed value for every non-array field S2 carries", () => {
    const probe = parseRouteProbe(probeDocument({}, { omit: ["S2"] }));

    expect(probe.planContractOk).toBe(false);
    expect(probe.planRejectReason).toBe("probe field S2 is unreadable");
    expect(probe.planTarget).toBeNull();
    expect(probe.planTarget).not.toBe(probe.activeTarget);
  });

  it("does not read an unreadable S12 as a declared existing-requirement edit", () => {
    const probe = parseRouteProbe(probeDocument({}, { omit: ["S12"] }));

    expect(probe.declaredExistingReqEdit).toBe(false);
    expect(computeRoute(probe, AUTO).removed).toEqual([{ rung: "R-STEP", by: "D8", observed: "S12" }]);
  });

  it("lands an unreadable S1 on wait/default-wait, which §8.2 clause 4 then reads", () => {
    const probe = parseRouteProbe(probeDocument({}, { omit: ["S1"] }));

    expect({ mode: probe.mode, modeSource: probe.modeSource }).toEqual({ mode: "wait", modeSource: "default-wait" });
    expect(computeRoute({ ...probe, planContractOk: false, blockedStability: ["FR-NODE-007"], unreadable: [] }, AUTO).withheld_because.map((entry) => entry.split(":")[0])).toEqual(["clause-4"]);
  });

  it("keeps the unreadable placeholder out of every real intersection, so D6 stays fail-closed", () => {
    const probe = parseRouteProbe(probeDocument({}, { omit: ["S4"] }));

    expect(computeRoute(probe, AUTO).removed).toContainEqual(expect.objectContaining({ rung: "R-PLAN", by: "D6" }));
    expect(computeRoute(probe, AUTO).rung).toBe("R-ORCH");
  });
});

describe("FR-NODE-111 AC-3 — an unreadable S3 fails closed through D8, not open through D1", () => {
  it("removes R-STEP by D8 rather than clearing it by reading an empty anchor set", () => {
    const probe = parseRouteProbe(probeDocument({}, { omit: ["S3"] }));
    const decision = computeRoute(probe, AUTO);

    expect(probe.unreadable).toContain("S3");
    expect(decision.removed).toContainEqual({ rung: "R-STEP", by: "D8", observed: "S3" });
    expect(decision.rung).not.toBe("R-STEP");
  });

  it("contrasts with a readable empty anchor set, which leaves R-STEP standing", () => {
    const probe = parseRouteProbe(probeDocument({ S3: { anchored_reqs: [] } }));

    expect(probe.unreadable).not.toContain("S3");
    expect(probe.anchoredReqs).toEqual([]);
    expect(computeRoute(probe, AUTO).removed).toEqual([]);
  });
});

describe("FR-NODE-111 AC-4 — a value a producer legitimately returned is not an unreadable field", () => {
  it("reads a non-issue input as zero task-list groups and zero linked sub-issues", () => {
    const probe = parseRouteProbe(probeDocument({ S8: { issue: null, task_list_groups: 0, linked_sub_issues: 0 } }));

    expect(probe.unreadable).not.toContain("S8");
    expect({ taskListGroups: probe.taskListGroups, linkedSubIssues: probe.linkedSubIssues }).toEqual({ taskListGroups: 0, linkedSubIssues: 0 });
  });
});

describe("FR-NODE-111 AC-5 — an unregistered target is a value get_active_target returned", () => {
  const emptyTarget = probeDocument(
    { S9: { activeTarget: "", summary: {} }, S4: { scopes: ["NODE"], unresolved: [] } },
    { omit: ["S3c", "S10"] }
  );

  it("takes the empty-denominator value for anchor coverage, blocked stability and scope req ids", () => {
    const probe = parseRouteProbe(emptyTarget);

    expect(probe.anchorCoverage).toBe(0);
    expect(probe.blockedStability).toEqual([]);
    expect(probe.scopeReqIds).toEqual([]);
  });

  it("enters none of S3c, S10 or S4 in unreadable[]", () => {
    const probe = parseRouteProbe(emptyTarget);

    expect(probe.unreadable).toEqual([]);
  });

  it("still records an absent S3c as unreadable when a target is registered", () => {
    const probe = parseRouteProbe(probeDocument({}, { omit: ["S3c"] }));

    expect(probe.unreadable).toEqual(["S3c"]);
    expect(probe.anchorCoverage).not.toBe(0);
  });
});
