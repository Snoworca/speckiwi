import { describe, expect, it } from "vitest";
import {
  ALLOCATION_CONJUNCTS,
  checkWaveAllocation,
  deriveAllocationSet,
  resolveAllocationOnResume,
  type WaveAllocationInput
} from "../../../src/core/orchestrator/allocation.js";

// @req FR-NODE-133 — Phase 3.c′'s allocation check: four conjuncts, refusing with
// `unallocated-req-id`, over an allocation set derived mechanically from the two `list_requirements`
// snapshots that bracket the `/kiwi-srs` hop.

function input(overrides: Partial<WaveAllocationInput> = {}): WaveAllocationInput {
  return {
    allocation: { requirementIds: ["FR-NODE-001", "FR-NODE-002"], preSnapshotDigest: "sha-pre" },
    tasks: [
      { id: "T-PH001-01", reqIds: ["FR-NODE-001"] },
      { id: "T-PH001-02", reqIds: ["FR-NODE-002"] }
    ],
    designItemMap: { "FR-NODE-001": ["D-001"], "FR-NODE-002": ["D-002", "D-003"] },
    waveDesignItems: ["D-001", "D-002", "D-003"],
    ...overrides
  };
}

function refusal(result: ReturnType<typeof checkWaveAllocation>) {
  if (result.ok) throw new Error("expected a refusal, got a pass");
  return result;
}

describe("FR-NODE-133 AC-5 — the passing case", () => {
  it("passes a sidecar for which all four conjuncts hold", () => {
    expect(checkWaveAllocation(input())).toEqual({ ok: true });
  });

  it("declares exactly the four conjuncts the requirement names", () => {
    expect([...ALLOCATION_CONJUNCTS]).toEqual([
      "req-id-outside-allocation",
      "empty-req-ids",
      "allocated-req-id-without-design-item",
      "design-item-against-no-req-id"
    ]);
    expect(ALLOCATION_CONJUNCTS).toHaveLength(4);
  });
});

describe("FR-NODE-133 AC-1 — a req_id outside the 3.b allocation set", () => {
  it("refuses with unallocated-req-id, naming the offending id", () => {
    const result = refusal(checkWaveAllocation(input({ tasks: [{ id: "T-1", reqIds: ["FR-NODE-001", "FR-NODE-999"] }] })));
    expect(result.code).toBe("unallocated-req-id");
    expect(result.violations.map((violation) => violation.conjunct)).toContain("req-id-outside-allocation");
    expect(result.violations.some((violation) => violation.detail.includes("FR-NODE-999"))).toBe(true);
    expect(result.violations.some((violation) => violation.detail.includes("T-1"))).toBe(true);
  });

  it("names every offending id, not only the first", () => {
    const result = refusal(
      checkWaveAllocation(
        input({
          tasks: [
            { id: "T-1", reqIds: ["FR-NODE-900"] },
            { id: "T-2", reqIds: ["FR-NODE-901"] }
          ]
        })
      )
    );
    const detail = result.violations.map((violation) => violation.detail).join(" ");
    expect(detail).toContain("FR-NODE-900");
    expect(detail).toContain("FR-NODE-901");
  });

  it("does not refuse an allocated id merely because no task claims it", () => {
    expect(checkWaveAllocation(input({ tasks: [{ id: "T-1", reqIds: ["FR-NODE-001", "FR-NODE-002"] }] }))).toEqual({ ok: true });
  });
});

describe("FR-NODE-133 AC-2 — a task whose req_ids is empty", () => {
  it("refuses with unallocated-req-id, naming that task", () => {
    const result = refusal(checkWaveAllocation(input({ tasks: [{ id: "T-1", reqIds: ["FR-NODE-001"] }, { id: "T-EMPTY", reqIds: [] }] })));
    expect(result.code).toBe("unallocated-req-id");
    expect(result.violations.map((violation) => violation.conjunct)).toContain("empty-req-ids");
    expect(result.violations.some((violation) => violation.detail.includes("T-EMPTY"))).toBe(true);
  });

  it("catches the case handoff resolvability cannot: an empty array resolves to nothing and so resolves cleanly", () => {
    // Charter C2 as a plan property. Every id present resolves; the task simply carries none.
    const result = refusal(checkWaveAllocation(input({ tasks: [{ id: "T-ONLY", reqIds: [] }] })));
    expect(result.violations.map((violation) => violation.conjunct)).toEqual(["empty-req-ids"]);
  });
});

describe("FR-NODE-133 AC-3 — an allocated req_id with no design item", () => {
  it("refuses when the design_item_map has no entry for an allocated id", () => {
    const result = refusal(checkWaveAllocation(input({ designItemMap: { "FR-NODE-001": ["D-001"] }, waveDesignItems: ["D-001"] })));
    expect(result.code).toBe("unallocated-req-id");
    expect(result.violations.map((violation) => violation.conjunct)).toContain("allocated-req-id-without-design-item");
    expect(result.violations.some((violation) => violation.detail.includes("FR-NODE-002"))).toBe(true);
  });

  it("refuses when the entry exists but is empty, because an empty list carries no design item", () => {
    const result = refusal(
      checkWaveAllocation(input({ designItemMap: { "FR-NODE-001": ["D-001"], "FR-NODE-002": [] }, waveDesignItems: ["D-001"] }))
    );
    expect(result.violations.map((violation) => violation.conjunct)).toContain("allocated-req-id-without-design-item");
  });
});

describe("FR-NODE-133 AC-4 — a wave design item claimed by no req_id", () => {
  it("refuses, so the map is checked total in both directions", () => {
    const result = refusal(checkWaveAllocation(input({ waveDesignItems: ["D-001", "D-002", "D-003", "D-004"] })));
    expect(result.code).toBe("unallocated-req-id");
    expect(result.violations.map((violation) => violation.conjunct)).toContain("design-item-against-no-req-id");
    expect(result.violations.some((violation) => violation.detail.includes("D-004"))).toBe(true);
  });

  it("ignores a design item mapped from an id outside the allocation set — that id is not this wave's", () => {
    const result = refusal(
      checkWaveAllocation(
        input({ designItemMap: { "FR-NODE-001": ["D-001"], "FR-NODE-002": ["D-002", "D-003"], "FR-NODE-777": ["D-004"] }, waveDesignItems: ["D-001", "D-002", "D-003", "D-004"] })
      )
    );
    expect(result.violations.map((violation) => violation.conjunct)).toContain("design-item-against-no-req-id");
    expect(result.violations.some((violation) => violation.detail.includes("D-004"))).toBe(true);
  });

  it("reports all four conjuncts at once rather than stopping at the first", () => {
    const result = refusal(
      checkWaveAllocation(
        input({
          tasks: [{ id: "T-1", reqIds: ["FR-NODE-999"] }, { id: "T-2", reqIds: [] }],
          designItemMap: { "FR-NODE-001": ["D-001"] },
          waveDesignItems: ["D-001", "D-009"]
        })
      )
    );
    expect(new Set(result.violations.map((violation) => violation.conjunct))).toEqual(new Set(ALLOCATION_CONJUNCTS));
  });
});

describe("FR-NODE-133 AC-6 — deriving the allocation set, and refusing to re-derive it on resume", () => {
  it("is the sorted set difference of the pre-hop and post-hop snapshots", () => {
    expect(deriveAllocationSet(["FR-NODE-001"], ["FR-NODE-003", "FR-NODE-001", "FR-NODE-002"])).toEqual(["FR-NODE-002", "FR-NODE-003"]);
  });

  it("is empty when the hop registered nothing, rather than falling back to the whole snapshot", () => {
    expect(deriveAllocationSet(["FR-NODE-001"], ["FR-NODE-001"])).toEqual([]);
  });

  it("drops a requirement the hop removed rather than reporting it as allocated", () => {
    expect(deriveAllocationSet(["FR-NODE-001", "FR-NODE-002"], ["FR-NODE-002", "FR-NODE-004"])).toEqual(["FR-NODE-004"]);
  });

  it("deduplicates, so a snapshot listing an id twice does not allocate it twice", () => {
    expect(deriveAllocationSet([], ["FR-NODE-002", "FR-NODE-002"])).toEqual(["FR-NODE-002"]);
  });

  it("returns the recorded set on resume when the recomputed pre-snapshot digest still matches", () => {
    const result = resolveAllocationOnResume({ requirementIds: ["FR-NODE-001"], preSnapshotDigest: "sha-pre" }, "sha-pre");
    expect(result).toEqual({ ok: true, requirementIds: ["FR-NODE-001"] });
  });

  it("refuses rather than re-deriving the set when the recomputed digest differs", () => {
    const result = resolveAllocationOnResume({ requirementIds: ["FR-NODE-001"], preSnapshotDigest: "sha-pre" }, "sha-something-else");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("allocation-pre-snapshot-drift");
    expect(result.detail).toContain("sha-pre");
    expect(result.detail).toContain("sha-something-else");
  });
});
