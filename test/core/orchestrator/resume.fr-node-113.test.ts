import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeRoute } from "../../../src/core/orchestrator/route.js";
import { freezeRoute, frozenRouteEntry, routeLockDigest, type RouteGateRecord, type RouteLock } from "../../../src/core/orchestrator/route-lock.js";
import { computeResumeState } from "../../../src/core/orchestrator/resume.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { baseProbe, stepProbe } from "../../support/route-probe-fixture.js";
import { emptyDriftInputs, emptyGitFacts, frozenBlock, minimalCard } from "./resume-fixtures.js";
import { journalRoot, waveVerify, type Json } from "./waves-fixtures.js";

// @req FR-NODE-113 AC-5, AC-6 — the rung is read on resume and never recomputed, and a probe whose
// digest no longer matches the frozen entry raises `run-invariant-drift` instead of reclassifying.
//
// These are assertions about the RESUME SESSION, not about the predicates it is built from:
// `resumeRung` and `checkRouteDrift` can both be correct while nothing on the resume path calls
// either, which is exactly the state 09 §9.5's "read, never recomputed" clause exists to forbid.

const RESUME_SOURCE = path.join(process.cwd(), "src", "core", "orchestrator", "resume.ts");
const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;
const LOCK_PATH = "routing/route.lock.json";
const PROBE_DIGEST = "sha256:6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6a1f2c8bd6";

async function journalView(lines: Json[] = [waveVerify(V14)]) {
  const root = await journalRoot(lines);
  return parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
}

function gateRecord(): RouteGateRecord {
  return {
    schema_version: "1.0.0",
    run_id: "run-a",
    probe_path: "routing/probe.json",
    probe_digest: PROBE_DIGEST,
    decided_at: "2026-08-01T09:12:44.201Z",
    gates: [
      {
        gate_id: "route-proposal",
        severity: "business-decision",
        selected: "proposed",
        decided_by: null,
        resolution: { rule: "recommended-fastpath", committee_size: 0 }
      }
    ]
  };
}

/** The lock this run froze: `stepProbe` classifies `R-STEP`. */
function frozenLock(): RouteLock {
  const probe = stepProbe();
  return freezeRoute(probe, computeRoute(probe, { auto: false }), gateRecord());
}

function cardWithRoute(lock: RouteLock) {
  return minimalCard({ frozen: frozenBlock({ route: frozenRouteEntry(LOCK_PATH, lock) }) });
}

function observationsOf(lock: RouteLock) {
  return { probeDigest: lock.probe_digest, lockDigest: routeLockDigest(lock) };
}

describe("FR-NODE-113 AC-5 — the resume kernel cannot recompute the rung", () => {
  it("carries the drift check and never reaches the classifier", async () => {
    const source = await readFile(RESUME_SOURCE, "utf8");

    // Positive first, so the negative below cannot pass by the resume path carrying no route code at
    // all — which is the defect this file exists to close. `frozen.route` reaches the kernel, and the
    // classifier does not.
    expect(source).toContain("checkRouteDrift");
    expect(source).toContain("routeObserved");
    expect(source, "resume.ts must not reach the classifier").not.toContain("computeRoute");
    expect(source, "resume.ts must not import route.js").not.toContain('from "./route.js"');
  });

  it("keeps FR-NODE-150 AC-6's four-key state, so the rung is read off the card and not derived", async () => {
    const lock = frozenLock();
    const view = await journalView();

    const state = computeResumeState(view, cardWithRoute(lock), emptyGitFacts(), emptyDriftInputs({ routeObserved: observationsOf(lock) }));

    expect(Object.keys(state).sort()).toEqual(["blocking", "classification", "drift", "nextAction"]);
    expect(cardWithRoute(lock).frozen.route).toEqual({ rung: "R-STEP", lock: `${LOCK_PATH}@${routeLockDigest(lock)}`, probe_digest: PROBE_DIGEST });
    // The probe on disk today would classify the other rung; nothing above consulted it.
    expect(computeRoute(baseProbe(), { auto: false }).rung).toBe("R-PLAN");
  });
});

describe("FR-NODE-113 AC-6 — a probe digest that no longer matches raises run-invariant-drift", () => {
  it("blocks the resume and names the recorded and observed probe digests", async () => {
    const lock = frozenLock();
    const view = await journalView();
    const observed = `${PROBE_DIGEST.slice(0, -1)}0`;

    const state = computeResumeState(
      view,
      cardWithRoute(lock),
      emptyGitFacts(),
      emptyDriftInputs({ routeObserved: { probeDigest: observed, lockDigest: routeLockDigest(lock) } })
    );

    expect(state.blocking).toBe("run-invariant-drift");
    const digest = state.drift.digests.find((entry) => entry.index === 1);
    expect(digest?.outcome).toBe("drift");
    expect(digest?.gate).toBe("run-invariant-drift");
    expect(digest?.detail).toContain("probe_digest");
    expect(digest?.detail).toContain(PROBE_DIGEST);
    expect(digest?.detail).toContain(observed);
  });

  it("raises the same gate when route.lock.json itself moved after the freeze", async () => {
    const lock = frozenLock();
    const tampered: RouteLock = { ...lock, decided_at: "2026-08-02T00:00:00.000Z" };
    const view = await journalView();

    const state = computeResumeState(
      view,
      cardWithRoute(lock),
      emptyGitFacts(),
      emptyDriftInputs({ routeObserved: { probeDigest: PROBE_DIGEST, lockDigest: routeLockDigest(tampered) } })
    );

    expect(state.blocking).toBe("run-invariant-drift");
    expect(state.drift.digests.find((entry) => entry.index === 1)?.detail).toContain("lock");
  });

  it("does not block when both digests still match", async () => {
    const lock = frozenLock();
    const view = await journalView();

    const state = computeResumeState(view, cardWithRoute(lock), emptyGitFacts(), emptyDriftInputs({ routeObserved: observationsOf(lock) }));

    expect(state.blocking).toBeNull();
    expect(state.drift.digests.find((entry) => entry.index === 1)).toMatchObject({ outcome: "match", gate: null });
  });

  it("leaves digest 1 matching for a card that froze no route", async () => {
    const view = await journalView();

    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());

    expect(state.drift.digests.find((entry) => entry.index === 1)).toMatchObject({ outcome: "match", gate: null });
    expect(state.blocking).toBeNull();
  });
});
