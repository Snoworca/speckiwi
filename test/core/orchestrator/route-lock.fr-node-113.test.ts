import { describe, expect, it } from "vitest";
import { computeRoute } from "../../../src/core/orchestrator/route.js";
import { checkRouteDrift, freezeRoute, frozenRouteEntry, resumeRung, routeLockDigest, serializeRouteLock, type RouteGateRecord, type RouteLock } from "../../../src/core/orchestrator/route-lock.js";
import { computeInvariantDigest, validateCard, type FrozenBlock, type ResumeCard } from "../../../src/core/orchestrator/resume-card.js";
import type { WavesJournalView } from "../../../src/core/orchestrator/waves-journal.js";
import { baseProbe, stepProbe } from "../../support/route-probe-fixture.js";

// FR-NODE-113 — `computeRoute` runs exactly once per run (09 §9.5). A resumed session has no
// conversation and no investigators, and several probe fields are subagent-derived and not reproducible
// across a compaction, so a recomputation could legally produce a different rung and switch ladders
// mid-run. The lock is content-addressed into `frozen.route` so a post-freeze byte change is drift.

const AUTO = { auto: false } as const;
const LOCK_PATH = "docs/research/v260-orchestrator/routing/route.lock.json";
const PROBE_DIGEST = "sha256:6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6";

function gateRecord(overrides: Partial<RouteGateRecord["gates"][number]> = {}, record: Partial<RouteGateRecord> = {}): RouteGateRecord {
  return {
    schema_version: "1.0.0",
    run_id: "2026-08-01.speckiwi.v260",
    probe_path: "docs/research/v260-orchestrator/routing/probe.json",
    probe_digest: PROBE_DIGEST,
    decided_at: "2026-08-01T09:12:44.201Z",
    gates: [{
      gate_id: "route-proposal",
      severity: "business-decision",
      selected: "proposed",
      decided_by: null,
      resolution: { rule: "recommended-fastpath", committee_size: 0, marked_by: "routing/route.lock.json#gate.recommended" },
      ...overrides
    }],
    ...record
  };
}

describe("FR-NODE-113 AC-1 — freezeRoute is deterministic and content-addressed", () => {
  const probe = stepProbe({ blockedStability: ["FR-NODE-007"] });
  const decision = computeRoute(probe, AUTO);

  it("produces byte-identical JSON on two calls over the same inputs", () => {
    const first = serializeRouteLock(freezeRoute(probe, decision, gateRecord()));
    const second = serializeRouteLock(freezeRoute(probe, decision, gateRecord()));

    expect(second).toBe(first);
    expect(routeLockDigest(freezeRoute(probe, decision, gateRecord()))).toBe(routeLockDigest(freezeRoute(probe, decision, gateRecord())));
  });

  it("changes the digest when any recorded value changes, so a redo is a no-op only on a real match", () => {
    const original = routeLockDigest(freezeRoute(probe, decision, gateRecord()));
    const different = routeLockDigest(freezeRoute(probe, decision, gateRecord({}, { probe_digest: `${PROBE_DIGEST.slice(0, -1)}0` })));

    expect(different).not.toBe(original);
  });

  it("carries the classifier's own outputs and the run identity", () => {
    const lock = freezeRoute(probe, decision, gateRecord());

    expect(lock).toMatchObject({
      schema_version: "1.0.0",
      classifier_version: "route-classifier@1.0.0",
      run_id: "2026-08-01.speckiwi.v260",
      removed: decision.removed,
      alternative: decision.alternative,
      decisive: decision.decisive,
      probe_path: "docs/research/v260-orchestrator/routing/probe.json",
      probe_digest: PROBE_DIGEST,
      decided_at: "2026-08-01T09:12:44.201Z"
    });
    expect(lock.gates[0]).toMatchObject({ gate_id: "route-proposal", options: ["R-STEP", "R-ORCH"], recommended: decision.recommended, withheld_because: decision.withheld_because });
  });

  it("records the work-mode value, its source and the §4.3 divergence", () => {
    const conforming = freezeRoute(baseProbe(), computeRoute(baseProbe(), AUTO), gateRecord());
    const stepShaped = freezeRoute(stepProbe({ mode: "vibe" }), computeRoute(stepProbe({ mode: "vibe" }), AUTO), gateRecord());

    expect(conforming.work_mode).toEqual({ value: "sdd", source: "mcp", divergence: null });
    expect(stepShaped.work_mode).toEqual({ value: "vibe", source: "mcp", divergence: "step-rung-requires-mode-switch" });
  });
});

describe("FR-NODE-113 AC-2 — a gate resolved to the proposed option", () => {
  it("records the classifier's rung as both rung and proposed_rung, with no override", () => {
    const probe = stepProbe();
    const decision = computeRoute(probe, AUTO);

    const lock = freezeRoute(probe, decision, gateRecord({ selected: "proposed" }));

    expect(decision.rung).toBe("R-STEP");
    expect({ rung: lock.rung, proposed_rung: lock.proposed_rung, overridden_by: lock.overridden_by }).toEqual({ rung: "R-STEP", proposed_rung: "R-STEP", overridden_by: null });
  });
});

describe("FR-NODE-113 AC-3 — a gate resolved to the alternative", () => {
  const probe = stepProbe();
  const decision = computeRoute(probe, AUTO);

  it.each(["user", "committee"] as const)("records the alternative as rung and %s as overridden_by", (decidedBy) => {
    const lock = freezeRoute(probe, decision, gateRecord({ selected: "alternative", decided_by: decidedBy }));

    expect(decision.alternative).toBe("R-ORCH");
    expect({ rung: lock.rung, proposed_rung: lock.proposed_rung, overridden_by: lock.overridden_by }).toEqual({ rung: "R-ORCH", proposed_rung: "R-STEP", overridden_by: decidedBy });
  });

  it("refuses to name an alternative the classifier did not produce", () => {
    const sole = stepProbe({ scopes: ["NODE", "CLI"] });
    const soleDecision = computeRoute(sole, AUTO);

    expect(soleDecision.alternative).toBeNull();
    expect(() => freezeRoute(sole, soleDecision, gateRecord({ selected: "alternative", decided_by: "user" }))).toThrow(/alternative/i);
  });
});

/** The journal is a parameter of `validateCard`; nothing in these fixtures depends on its contents. */
const EMPTY_JOURNAL: WavesJournalView = {
  runId: "2026-08-01.speckiwi.v260",
  engine: "kiwi-orchestrator",
  lines: [],
  byVerb: new Map(),
  latestPerWave: new Map(),
  schemaVersions: [],
  diagnostics: []
};

function frozenBlock(lock: RouteLock): FrozenBlock {
  return {
    engine: "kiwi-orchestrator",
    work_root: "docs/research/v260-orchestrator",
    journal: "kiwi/orchestrator/2026-08-01.speckiwi.v260/waves.jsonl",
    run_root: { git_toplevel: "C:/Work/git/_Snoworca/speckiwi", mcp_workspace_root: "C:/Work/git/_Snoworca/speckiwi" },
    isolation_profile: "in-place",
    base_branch: "main",
    integration_branch: "kiwi/orch/2026-08-01.speckiwi.v260/integration",
    lane_lock: {},
    route: frozenRouteEntry(LOCK_PATH, lock)
  };
}

function cardFor(lock: RouteLock): ResumeCard {
  const frozen = frozenBlock(lock);
  return {
    schema_version: "1.0.0",
    run_id: "2026-08-01.speckiwi.v260",
    run_contract: "1.0.0",
    position: { wave: 1, stage: 1, phase: "1.c-prime" },
    next_action: { verb: "freeze-route", args: {}, preconditions: [] },
    frozen,
    done: [],
    open: [],
    blocked_on: null,
    invariant_digest: computeInvariantDigest(frozen),
    written_at: "2026-08-01T09:12:44.201Z"
  };
}

describe("FR-NODE-113 AC-4 — the lock's digest is what frozen.route records", () => {
  const probe = stepProbe();
  const decision = computeRoute(probe, AUTO);
  const lock = freezeRoute(probe, decision, gateRecord());

  it("records the rung, the content-addressed lock reference and the probe digest", () => {
    expect(frozenRouteEntry(LOCK_PATH, lock)).toEqual({ rung: "R-STEP", lock: `${LOCK_PATH}@${routeLockDigest(lock)}`, probe_digest: PROBE_DIGEST });
  });

  it("puts frozen.route inside the run's invariant_digest", () => {
    const withRoute = computeInvariantDigest(frozenBlock(lock));
    const withoutRoute = { ...frozenBlock(lock) };
    delete (withoutRoute as Record<string, unknown>).route;

    expect(computeInvariantDigest(withoutRoute)).not.toBe(withRoute);
  });

  // `decided_at`, deliberately: it is a lock field that `frozen.route` does not copy, so the card's
  // digest can only move through the content address. Tampering with `rung` instead would move the
  // digest even if the `lock` reference carried no digest at all.
  it("makes a byte change to route.lock.json differ from the digest the card recorded", () => {
    const card = cardFor(lock);
    const tampered = { ...lock, decided_at: "2026-08-02T00:00:00.000Z" };

    expect(validateCard(card, EMPTY_JOURNAL)).toEqual({ ok: true, violations: [] });
    expect(frozenRouteEntry(LOCK_PATH, tampered).rung).toBe(frozenRouteEntry(LOCK_PATH, lock).rung);
    expect(frozenRouteEntry(LOCK_PATH, tampered).probe_digest).toBe(frozenRouteEntry(LOCK_PATH, lock).probe_digest);
    expect(computeInvariantDigest(frozenBlock(tampered))).not.toBe(card.invariant_digest);
    expect(validateCard({ ...card, frozen: frozenBlock(tampered) }, EMPTY_JOURNAL).violations).toContain("invariant-digest-mismatch");
    expect(checkRouteDrift(frozenRouteEntry(LOCK_PATH, lock), { probeDigest: PROBE_DIGEST, lockDigest: routeLockDigest(tampered) })).toMatchObject({ code: "run-invariant-drift", field: "lock" });
  });
});

describe("FR-NODE-113 AC-5 — a resumed session reads the rung and cannot recompute it", () => {
  it("resumes on the recorded rung even when the on-disk probe would classify a different one", () => {
    const frozenProbe = stepProbe();
    const lock = freezeRoute(frozenProbe, computeRoute(frozenProbe, AUTO), gateRecord());
    const frozen = frozenRouteEntry(LOCK_PATH, lock);
    const driftedProbe = baseProbe();

    expect(computeRoute(driftedProbe, AUTO).rung).toBe("R-PLAN");
    expect(resumeRung(frozen)).toBe("R-STEP");
  });

  it("takes the frozen entry alone, so no probe is in reach of the resume path", () => {
    expect(resumeRung.length).toBe(1);
    expect(Object.keys(frozenRouteEntry(LOCK_PATH, freezeRoute(stepProbe(), computeRoute(stepProbe(), AUTO), gateRecord()))).sort()).toEqual(["lock", "probe_digest", "rung"]);
  });
});

describe("FR-NODE-113 AC-6 — a probe digest that no longer matches raises run-invariant-drift", () => {
  const lock = freezeRoute(stepProbe(), computeRoute(stepProbe(), AUTO), gateRecord());
  const frozen = frozenRouteEntry(LOCK_PATH, lock);

  it("reports drift on the probe digest and names the recorded and observed values", () => {
    const observed = `${PROBE_DIGEST.slice(0, -1)}0`;

    expect(checkRouteDrift(frozen, { probeDigest: observed, lockDigest: routeLockDigest(lock) })).toEqual({
      code: "run-invariant-drift",
      field: "probe_digest",
      recorded: PROBE_DIGEST,
      observed
    });
  });

  it("reports no drift when both digests still match", () => {
    expect(checkRouteDrift(frozen, { probeDigest: PROBE_DIGEST, lockDigest: routeLockDigest(lock) })).toBeNull();
  });
});

describe("FR-NODE-113 AC-7 — the lock round-trips, and a mutated probe digest is reported as drift", () => {
  const probe = stepProbe({ blockedStability: ["FR-NODE-007"] });
  const lock = freezeRoute(probe, computeRoute(probe, AUTO), gateRecord());

  it("survives a JSON round-trip unchanged", () => {
    expect(JSON.parse(serializeRouteLock(lock))).toEqual(lock);
    expect(serializeRouteLock(JSON.parse(serializeRouteLock(lock)))).toBe(serializeRouteLock(lock));
  });

  it("round-trips through the resume-card validator", () => {
    expect(validateCard(cardFor(lock), EMPTY_JOURNAL)).toEqual({ ok: true, violations: [] });
  });

  it("is reported by that same validator when its probe_digest was mutated after the freeze", () => {
    const card = cardFor(lock);
    const mutated = { ...lock, probe_digest: `${PROBE_DIGEST.slice(0, -1)}0` };

    expect(validateCard({ ...card, frozen: frozenBlock(mutated) }, EMPTY_JOURNAL).violations).toContain("invariant-digest-mismatch");
    expect(checkRouteDrift(frozenRouteEntry(LOCK_PATH, lock), { probeDigest: mutated.probe_digest, lockDigest: routeLockDigest(mutated) })).toMatchObject({ code: "run-invariant-drift", field: "probe_digest" });
  });
});

describe("FR-NODE-113 — 09 §4.3's work-mode divergence, and the gate record's own defaults", () => {
  it("records conformance when mode is tdd and D1 through D4 removed the step rung", () => {
    const probe = stepProbe({ mode: "tdd", scopes: ["NODE", "CLI"] });
    const lock = freezeRoute(probe, computeRoute(probe, AUTO), gateRecord());

    expect(lock.rung).toBe("R-ORCH");
    expect(lock.work_mode.divergence).toBe("step-rung-removed");
  });

  it("records the overridden routing clause when mode is tdd and the step rung lost on order alone", () => {
    const probe = baseProbe({ mode: "tdd" });
    const lock = freezeRoute(probe, computeRoute(probe, AUTO), gateRecord());

    expect(lock.rung).toBe("R-PLAN");
    expect(lock.removed).toEqual([]);
    expect(lock.work_mode.divergence).toBe("plan-rung-won-on-order");
  });

  it("records no divergence when mode is tdd and the run dispatches the step rung", () => {
    const probe = stepProbe({ mode: "tdd" });

    expect(freezeRoute(probe, computeRoute(probe, AUTO), gateRecord()).work_mode.divergence).toBeNull();
  });

  it("takes the proposed rung when the record carries no route-proposal row", () => {
    const probe = stepProbe();
    const decision = computeRoute(probe, AUTO);
    const lock = freezeRoute(probe, decision, gateRecord({}, { gates: [] }));

    expect({ rung: lock.rung, proposed_rung: lock.proposed_rung, overridden_by: lock.overridden_by }).toEqual({ rung: "R-STEP", proposed_rung: "R-STEP", overridden_by: null });
  });

  it("records no override when the alternative was selected but no decider was named", () => {
    const probe = stepProbe();
    const decision = computeRoute(probe, AUTO);
    const lock = freezeRoute(probe, decision, gateRecord({ selected: "alternative" }));

    expect(lock.rung).toBe("R-ORCH");
    expect(lock.overridden_by).toBeNull();
  });
});
