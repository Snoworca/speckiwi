import { describe, expect, it } from "vitest";
import { compareReqId, computeBlastRadius } from "../../../src/core/mutation/records.js";
import type { RequirementRecord, TraceLink } from "../../../src/core/types.js";

// FR-NODE-037 — compareReqId raw-byte ordering and computeBlastRadius closure utility.
//
// Red-phase suite (T-PH003-09): one test case per acceptance criterion
// (AC-1..AC-4). These cases describe the contract of two pure exports of
// src/core/mutation/records.ts before they exist, so the whole suite fails
// (the named exports are missing) until the green task (T-PH003-10)
// introduces them.
//
// Contract under test (from the requirement body):
//   compareReqId orders two REQ-IDs by raw byte comparison to select the
//   min-side block for single-row normalization, and computeBlastRadius is a
//   pure exported function returning the transitive depends_on closure limited
//   to at most 2 hops from the seed set, cutting traversal at frozen/stable
//   requirements.

/**
 * Builds a minimal RequirementRecord. Only the fields exercised by
 * computeBlastRadius (id, stability, and depends_on trace links) carry
 * meaning; the rest are sensible defaults so the record type-checks.
 */
function makeRecord(
  id: string,
  dependsOn: string[],
  stability: RequirementRecord["stability"] = "evolving"
): RequirementRecord {
  const traceLinks: TraceLink[] = dependsOn.map((reference) => ({
    type: "Requirement",
    reference,
    relation: "depends_on",
    notes: "-"
  }));
  return {
    id,
    title: `requirement ${id}`,
    type: "functional",
    target: "v3.0.0",
    status: "planned",
    scope: "NODE",
    filePath: "docs/spec/50.nodejs-implementation.srs.md",
    headingLine: 1,
    metadata: { Type: "functional", Target: "v3.0.0", Stability: stability ?? "evolving", Scope: "NODE" },
    acceptanceCriteria: [],
    verificationEvidence: [],
    traceLinks,
    changeNotes: [],
    tags: [],
    requirement: `requirement ${id} body`,
    stability
  };
}

/** Normalizes the closure return value (Set or array) into a sorted string[]. */
function asSortedArray(closure: Iterable<string>): string[] {
  return Array.from(closure).sort();
}

describe("FR-NODE-037 compareReqId raw-byte ordering and computeBlastRadius closure utility", () => {
  // AC-1: compareReqId returns a stable ordering based on raw byte comparison of
  // the two REQ-IDs. The sign of the result is determined by raw byte (code
  // unit) comparison: a < b yields a negative number, a > b a positive number,
  // and equal IDs yield zero. The ordering is antisymmetric (swapping the
  // operands flips the sign) and self-consistent for the same input.
  it("FR-NODE-037 AC-1: compareReqId orders REQ-IDs by raw byte comparison", () => {
    // FR-ARCH-001 < FR-ARCH-002 by raw byte comparison of the trailing digit.
    expect(compareReqId("FR-ARCH-001", "FR-ARCH-002")).toBeLessThan(0);
    expect(compareReqId("FR-ARCH-002", "FR-ARCH-001")).toBeGreaterThan(0);

    // Identical IDs compare equal.
    expect(compareReqId("FR-NODE-037", "FR-NODE-037")).toBe(0);

    // Raw byte ordering: uppercase 'A' (0x41) sorts before lowercase 'a' (0x61),
    // which a locale-aware comparison would not necessarily guarantee.
    expect(compareReqId("FR-ARCH-001", "FR-arch-001")).toBeLessThan(0);

    // Stable / antisymmetric: the sign flips when operands swap.
    const forward = compareReqId("FR-CLI-010", "FR-NODE-037");
    const reverse = compareReqId("FR-NODE-037", "FR-CLI-010");
    expect(Math.sign(forward)).toBe(-Math.sign(reverse));
  });

  // AC-2: computeBlastRadius returns the transitive depends_on closure bounded
  // to at most 2 hops from the seed set. Hop-1 and hop-2 dependencies are
  // included; a hop-3 dependency is excluded by the 2-hop bound. The seed
  // itself is part of its own blast radius.
  it("FR-NODE-037 AC-2: computeBlastRadius returns the depends_on closure bounded to 2 hops", () => {
    const records = [
      makeRecord("FR-NODE-100", ["FR-NODE-101"]), // seed -> hop1
      makeRecord("FR-NODE-101", ["FR-NODE-102"]), // hop1 -> hop2
      makeRecord("FR-NODE-102", ["FR-NODE-103"]), // hop2 -> hop3 (must be cut)
      makeRecord("FR-NODE-103", [])
    ];

    const closure = asSortedArray(computeBlastRadius(["FR-NODE-100"], records));

    // Seed plus hop-1 and hop-2 dependencies are inside the blast radius.
    expect(closure).toContain("FR-NODE-100");
    expect(closure).toContain("FR-NODE-101");
    expect(closure).toContain("FR-NODE-102");

    // The hop-3 dependency is beyond the 2-hop bound and must be excluded.
    expect(closure).not.toContain("FR-NODE-103");
  });

  // AC-3: computeBlastRadius stops traversal at requirements whose stability is
  // frozen or stable. A frozen/stable node is itself reachable (it is the edge
  // we stop at), but its outgoing depends_on edges are not traversed.
  it("FR-NODE-037 AC-3: computeBlastRadius cuts traversal at frozen/stable edges", () => {
    const records = [
      makeRecord("FR-NODE-200", ["FR-NODE-201", "FR-NODE-202"]),
      makeRecord("FR-NODE-201", ["FR-NODE-210"], "frozen"), // frozen: do not traverse past
      makeRecord("FR-NODE-202", ["FR-NODE-220"], "stable"), // stable: do not traverse past
      makeRecord("FR-NODE-210", []),
      makeRecord("FR-NODE-220", [])
    ];

    const closure = asSortedArray(computeBlastRadius(["FR-NODE-200"], records));

    // The frozen and stable hop-1 nodes are reached.
    expect(closure).toContain("FR-NODE-201");
    expect(closure).toContain("FR-NODE-202");

    // Their dependencies are not traversed because traversal stops at
    // frozen/stable nodes.
    expect(closure).not.toContain("FR-NODE-210");
    expect(closure).not.toContain("FR-NODE-220");
  });

  // AC-4: computeBlastRadius is a pure function with no I/O side effects. Given
  // the same inputs it returns an equal result on repeated calls, and it does
  // not mutate the records array or any record's trace links it receives.
  it("FR-NODE-037 AC-4: computeBlastRadius is pure with no side effects", () => {
    const records = [
      makeRecord("FR-NODE-300", ["FR-NODE-301"]),
      makeRecord("FR-NODE-301", [])
    ];
    const recordsSnapshot = JSON.stringify(records);

    const first = asSortedArray(computeBlastRadius(["FR-NODE-300"], records));
    const second = asSortedArray(computeBlastRadius(["FR-NODE-300"], records));

    // Deterministic: same inputs yield an equal closure on every call.
    expect(second).toEqual(first);

    // No side effects: the input records (including nested trace links) are
    // left unmodified.
    expect(JSON.stringify(records)).toBe(recordsSnapshot);
  });
});
