/**
 * Phase 3.c′'s allocation check — 05 §5.11 check 1.
 *
 * @req FR-NODE-133
 *
 * Charter C2 says every requirement a wave's SDS designs for was allocated at 3.b: the SDS `@req` set
 * (FR-NODE-209 AC-4) is a subset of the 3.b allocation set. `speckiwi sds check` resolves each id
 * against the SRS but cannot tell an id allocated somewhere other than 3.b. This module is C2 as a
 * checked design property. @req FR-FLOW-187 AC-3
 *
 * Pure: the two `list_requirements` snapshots and the recomputed digest arrive as parameters, so the
 * check runs with no MCP transport and no filesystem.
 */

/** The three conjuncts, in the order §5.11 check 1 states them. */
export const ALLOCATION_CONJUNCTS = [
  "req-id-outside-allocation",
  "allocated-req-id-without-design-item",
  "design-item-against-no-req-id"
] as const;
export type AllocationConjunct = (typeof ALLOCATION_CONJUNCTS)[number];

/** What the `register-wave-srs` result line records. */
export interface AllocationRecord {
  /** The 3.b allocation set: the sorted set difference of the two snapshots. */
  readonly requirementIds: readonly string[];
  /** The pre-hop snapshot's sha256, recorded on the `register-wave-srs` **intent** line. */
  readonly preSnapshotDigest: string;
}

export interface WaveAllocationInput {
  readonly allocation: AllocationRecord;
  /** The wave SDS's `@req` set, as the lite SDS parser exposes it. */
  readonly sdsReqIds: readonly string[];
  /** `{req_id -> [D-nnn]}`, authored by the orchestrator and materialised at `design-item-map.json`. */
  readonly designItemMap: Readonly<Record<string, readonly string[]>>;
  /** `waves.lock.json`'s per-wave `design_items[]` slice. */
  readonly waveDesignItems: readonly string[];
}

export interface AllocationViolation {
  readonly conjunct: AllocationConjunct;
  readonly detail: string;
}

export type AllocationCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "unallocated-req-id"; readonly violations: readonly AllocationViolation[] };

/**
 * @req FR-NODE-133 — every conjunct, evaluated together. Every violation is reported rather than the
 * first, because the operator re-authors once against a complete list and the conjuncts have
 * independent causes.
 */
export function checkWaveAllocation(input: WaveAllocationInput): AllocationCheckResult {
  const allocated = new Set(input.allocation.requirementIds);
  const violations: AllocationViolation[] = [];

  for (const reqId of [...new Set(input.sdsReqIds)].sort()) {
    if (allocated.has(reqId)) continue;
    violations.push({
      conjunct: "req-id-outside-allocation",
      detail: `the wave SDS names @req ${reqId}, which is outside allocation.requirement_ids[]`
    });
  }

  // The second and third conjuncts make the design item map a checked operand rather than an
  // assumption: the map must be total in both directions over this wave.
  const claimedDesignItems = new Set<string>();
  for (const reqId of input.allocation.requirementIds) {
    const items = input.designItemMap[reqId] ?? [];
    if (items.length === 0) {
      violations.push({
        conjunct: "allocated-req-id-without-design-item",
        detail: `allocated req_id ${reqId} carries no design item in the wave's design_item_map`
      });
      continue;
    }
    for (const item of items) claimedDesignItems.add(item);
  }

  for (const item of input.waveDesignItems) {
    if (claimedDesignItems.has(item)) continue;
    violations.push({
      conjunct: "design-item-against-no-req-id",
      detail: `wave design item ${item} appears against no allocated req_id in the design_item_map`
    });
  }

  if (violations.length === 0) return { ok: true };
  return { ok: false, code: "unallocated-req-id", violations };
}

// ---------------------------------------------------------------------------------------------
// Where the allocation set comes from — §5.11's derivation
// ---------------------------------------------------------------------------------------------

/**
 * The 3.b allocation set: the sorted set difference between the `list_requirements` snapshots for the
 * wave target captured **before** and **after** the `/kiwi-srs` hop.
 *
 * @req FR-NODE-133 AC-6 — mechanical and recomputable. Revision 2 named no producer at all, which
 * left the comparison in `checkWaveAllocation` testing against a value nothing wrote.
 */
export function deriveAllocationSet(preSnapshot: readonly string[], postSnapshot: readonly string[]): string[] {
  const before = new Set(preSnapshot);
  return [...new Set(postSnapshot.filter((id) => !before.has(id)))].sort();
}

export type AllocationResumeResult =
  | { readonly ok: true; readonly requirementIds: readonly string[] }
  | { readonly ok: false; readonly code: "allocation-pre-snapshot-drift"; readonly detail: string };

/**
 * @req FR-NODE-133 AC-6 — a resumed session whose recomputed pre-snapshot digest no longer matches the
 * recorded one **refuses**; it does not re-derive the set. Re-deriving against a snapshot that moved
 * would allocate every requirement authored since, silently widening the wave.
 */
export function resolveAllocationOnResume(recorded: AllocationRecord, recomputedPreSnapshotDigest: string): AllocationResumeResult {
  if (recomputedPreSnapshotDigest !== recorded.preSnapshotDigest) {
    return {
      ok: false,
      code: "allocation-pre-snapshot-drift",
      detail: `allocation.pre_snapshot_digest recorded ${recorded.preSnapshotDigest} but the snapshot now digests to ${recomputedPreSnapshotDigest}; the allocation set cannot be re-derived`
    };
  }
  return { ok: true, requirementIds: recorded.requirementIds };
}
