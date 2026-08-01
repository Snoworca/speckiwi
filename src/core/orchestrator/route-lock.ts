// @req FR-NODE-113 — `routing/route.lock.json`, the decision of record
// (`docs/research/kiwi-orchestrator/09.routing-design.md` §9.2, §9.3, §9.5).
//
// `computeRoute` runs exactly once per run. A resumed session has no conversation and no investigators,
// and several probe fields are subagent-derived and not reproducible across a compaction, so a
// recomputation could legally produce a different rung and switch ladders mid-run. The lock is
// content-addressed into the resume card's `frozen.route`, and hence into `invariant_digest`, so a
// post-freeze byte change surfaces as `run-invariant-drift` rather than as a silent second rung.
//
// Writing the lock to disk is the orchestrator's job; this module only builds and addresses it.

import { createHash } from "node:crypto";
import { CLASSIFIER_VERSION, type RouteDecision, type RouteDecisive, type RouteProbe, type RouteRemoval, type Rung } from "./route.js";

export const ROUTE_LOCK_SCHEMA_VERSION = "1.0.0";

/** The gate whose ballot decides which of the classifier's two survivors executes (09 §8.1, §8.3). */
export const ROUTE_PROPOSAL_GATE = "route-proposal";

export interface RouteGateResolution {
  rule: string;
  committee_size: number;
  split?: string;
  marked_by?: string;
}

export interface RouteGateRow {
  gate_id: string;
  severity: string;
  /**
   * 09 §8.3 rule 1: the record names a **selection**, never a rung. `freezeRoute` resolves it against
   * the decision, so no surface can introduce a rung the classifier did not produce.
   */
  selected: "proposed" | "alternative";
  decided_by?: "user" | "committee" | null;
  options?: string[];
  recommended?: boolean;
  withheld_because?: string[];
  resolution: RouteGateResolution;
}

/**
 * `routing/route-gate.json` (09 §8.3, §9.1) — the one input `computeRoute` cannot produce.
 *
 * `run_id`, `probe_path` and `decided_at` ride here rather than being derived: `freezeRoute` is pure, so
 * it has no clock to read `decided_at` from and no filesystem to learn where the probe was written, and
 * a lock that is not reproducible from its inputs cannot be the no-op redo §9.4 promises.
 */
export interface RouteGateRecord {
  schema_version: string;
  run_id: string;
  probe_path: string;
  probe_digest: string;
  decided_at: string;
  gates: RouteGateRow[];
}

export interface RouteLockGate {
  gate_id: string;
  severity: string;
  options: string[];
  recommended: boolean;
  withheld_because: string[];
  resolution: RouteGateResolution;
}

export interface RouteLock {
  schema_version: string;
  classifier_version: string;
  run_id: string;
  rung: Rung;
  proposed_rung: Rung;
  overridden_by: "user" | "committee" | null;
  decisive: RouteDecisive | null;
  removed: RouteRemoval[];
  alternative: Rung | null;
  work_mode: { value: string; source: string; divergence: string | null };
  gates: RouteLockGate[];
  probe_path: string;
  probe_digest: string;
  decided_at: string;
}

/** The `frozen.route` block of the resume card (09 §9.3). */
export interface FrozenRoute {
  rung: Rung;
  lock: string;
  probe_digest: string;
}

export interface RouteDrift {
  code: "run-invariant-drift";
  field: "probe_digest" | "lock";
  recorded: string;
  observed: string;
}

/**
 * 09 §4.3. The work-mode is never neutralised and never mutated by the router; where the executed rung
 * and the persisted mode disagree, the lock records which of the four cases this run is.
 */
function modeDivergence(probe: RouteProbe, rung: Rung, removed: readonly RouteRemoval[]): string | null {
  if (rung === "R-STEP") return probe.mode === "tdd" ? null : "step-rung-requires-mode-switch";
  if (probe.mode !== "tdd") return null;
  // Mode `tdd` on a non-step rung: conformance when D1–D4 removed the step rung
  // (`kiwi-pipeline/SKILL.md:194-195` keeps those on the sdd chain regardless of mode), an override of
  // its routing clause when the step rung survived and lost on §3.4's order.
  return removed.some((entry) => entry.rung === "R-STEP") ? "step-rung-removed" : "plan-rung-won-on-order";
}

/**
 * @req FR-NODE-113 — the lock, from the classifier's outputs plus the gate-resolution record.
 *
 * `RouteDecision` is a closed field set and carries none of `proposed_rung`, `overridden_by` or
 * `gates[].resolution`, which is why the gate record is a separate argument rather than a wider decision.
 */
export function freezeRoute(probe: RouteProbe, decision: RouteDecision, gate: RouteGateRecord): RouteLock {
  const proposal = gate.gates.find((row) => row.gate_id === ROUTE_PROPOSAL_GATE);
  const selected = proposal?.selected ?? "proposed";
  if (selected === "alternative" && decision.alternative === null) {
    throw new Error(`${ROUTE_PROPOSAL_GATE} selected the alternative, but the classifier produced no alternative rung`);
  }
  const rung = selected === "alternative" ? (decision.alternative as Rung) : decision.rung;
  const ballot = [decision.rung, decision.alternative ?? "abort"];

  return {
    schema_version: ROUTE_LOCK_SCHEMA_VERSION,
    classifier_version: CLASSIFIER_VERSION,
    run_id: gate.run_id,
    rung,
    proposed_rung: decision.rung,
    overridden_by: selected === "alternative" ? (proposal?.decided_by ?? null) : null,
    decisive: decision.decisive,
    removed: decision.removed,
    alternative: decision.alternative,
    work_mode: { value: probe.mode, source: probe.modeSource, divergence: modeDivergence(probe, rung, decision.removed) },
    gates: gate.gates.map((row) => ({
      gate_id: row.gate_id,
      severity: row.severity,
      options: row.options ?? (row.gate_id === ROUTE_PROPOSAL_GATE ? ballot : []),
      recommended: row.gate_id === ROUTE_PROPOSAL_GATE ? decision.recommended : (row.recommended ?? false),
      withheld_because: row.gate_id === ROUTE_PROPOSAL_GATE ? decision.withheld_because : (row.withheld_because ?? []),
      resolution: row.resolution
    })),
    probe_path: gate.probe_path,
    probe_digest: gate.probe_digest,
    decided_at: gate.decided_at
  };
}

/** The lock's bytes. One function, so the digest and the file can never be taken over different text. */
export function serializeRouteLock(lock: RouteLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function routeLockDigest(lock: RouteLock): string {
  return `sha256:${createHash("sha256").update(serializeRouteLock(lock), "utf8").digest("hex")}`;
}

/** @req FR-NODE-113 — what the resume card records, so `invariant_digest` covers the route (09 §9.3). */
export function frozenRouteEntry(lockPath: string, lock: RouteLock): FrozenRoute {
  return { rung: lock.rung, lock: `${lockPath}@${routeLockDigest(lock)}`, probe_digest: lock.probe_digest };
}

/**
 * @req FR-NODE-113 — 09 §9.5 step 2: **the rung is read, never recomputed.** The frozen entry is the
 * whole input, so the resume path has no probe in reach and cannot re-judge even by accident.
 */
export function resumeRung(frozen: FrozenRoute): Rung {
  return frozen.rung;
}

/** @req FR-NODE-113 — 09 §9.5 step 3. A digest that no longer matches is drift, not a reclassification. */
export function checkRouteDrift(frozen: FrozenRoute, observed: { probeDigest: string; lockDigest: string }): RouteDrift | null {
  if (frozen.probe_digest !== observed.probeDigest) {
    return { code: "run-invariant-drift", field: "probe_digest", recorded: frozen.probe_digest, observed: observed.probeDigest };
  }
  const recordedLock = frozen.lock.slice(frozen.lock.lastIndexOf("@") + 1);
  if (recordedLock !== observed.lockDigest) {
    return { code: "run-invariant-drift", field: "lock", recorded: recordedLock, observed: observed.lockDigest };
  }
  return null;
}
