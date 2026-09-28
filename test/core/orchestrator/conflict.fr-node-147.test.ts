import { describe, expect, it } from "vitest";
import {
  CONFLICT_REASONS,
  RECIPE_KINDS,
  analyzeConflicts,
  type ConflictEdge,
  type ConflictReason,
  type WaveInput
} from "../../../src/core/orchestrator/conflict.js";

// FR-NODE-147 — the lane-plan conflict model over waves: a closed enum of wave-level reasons, each
// produced by some input the declared argument types admit.

function wave(waveId: string, ...writeSet: string[]): WaveInput {
  return { waveId, writeSet };
}

function edgesFor(edges: readonly ConflictEdge[], reason: ConflictReason): ConflictEdge[] {
  return edges.filter((edge) => edge.reason === reason);
}

describe("FR-NODE-147 AC-1 analyzeConflicts takes only the wave-level arguments", () => {
  it("FR-NODE-147 AC-1 declares exactly two arguments: the waves' write sets and their declared dependencies", () => {
    expect(analyzeConflicts).toHaveLength(2);
  });

  it("FR-NODE-147 AC-1 reads the write sets it is given and no task field, so a wave object with only an id and a write set suffices", () => {
    const edges = analyzeConflicts([wave("w1", "src/a.ts"), wave("w2", "src/a.ts")], { w2: [] });
    expect(edgesFor(edges, "write-set-overlap")).toEqual([{ a: "w1", b: "w2", reason: "write-set-overlap", paths: ["src/a.ts"] }]);
  });
});

describe("FR-NODE-147 AC-2 every conflict_reason member is reachable", () => {
  it("FR-NODE-147 AC-2 declares only the wave-level reasons, none of the task-level ones", () => {
    expect([...CONFLICT_REASONS].sort()).toEqual(["wave-dependency", "write-set-overlap"]);
    for (const retired of [
      "task-dependency",
      "phase-dependency",
      "tdd-pair",
      "req-shared",
      "module-barrier",
      "unknown-write-set",
      "srs-write",
      "non-code-write-set",
      "learned-coupling",
      "convergence-point"
    ]) {
      expect(CONFLICT_REASONS as readonly string[]).not.toContain(retired);
    }
  });

  it("FR-NODE-147 AC-2 produces every declared reason from one fixture", () => {
    const edges = analyzeConflicts([wave("w1", "src/a.ts"), wave("w2", "src/a.ts"), wave("w3", "src/c.ts")], { w2: [], w3: ["w1"] });
    expect([...new Set(edges.map((edge) => edge.reason))].sort()).toEqual([...CONFLICT_REASONS].sort());
  });

  it("FR-NODE-147 AC-2 records a declared dependency as a wave-dependency edge from the dependent wave to the one it depends on", () => {
    const edges = analyzeConflicts([wave("w1", "src/a.ts"), wave("w2", "src/b.ts")], { w2: ["w1"] });
    expect(edgesFor(edges, "wave-dependency")).toEqual([{ a: "w2", b: "w1", reason: "wave-dependency" }]);
  });

  it("FR-NODE-147 AC-2 makes a wave with no declared dependencies depend on every earlier wave, in input order", () => {
    const edges = analyzeConflicts([wave("w1", "src/a.ts"), wave("w2", "src/b.ts"), wave("w3", "src/c.ts")], {});
    expect(edgesFor(edges, "wave-dependency").map((edge) => `${edge.a}->${edge.b}`)).toEqual(["w2->w1", "w3->w1", "w3->w2"]);
  });

  it("FR-NODE-147 AC-2 lets an empty declared list mean no dependency at all", () => {
    const edges = analyzeConflicts([wave("w1", "src/a.ts"), wave("w2", "src/b.ts")], { w2: [] });
    expect(edgesFor(edges, "wave-dependency")).toEqual([]);
  });

  it("FR-NODE-147 AC-2 raises no overlap edge for disjoint write sets and names every shared path for overlapping ones", () => {
    const disjoint = analyzeConflicts([wave("w1", "src/a.ts"), wave("w2", "src/b.ts")], { w2: [] });
    expect(edgesFor(disjoint, "write-set-overlap")).toEqual([]);

    const shared = analyzeConflicts(
      [wave("w1", "test/a.test.ts", "src/a.ts", "src/z.ts"), wave("w2", "src/z.ts", "src/a.ts", "src/b.ts")],
      { w2: [] }
    );
    expect(edgesFor(shared, "write-set-overlap")).toEqual([{ a: "w1", b: "w2", reason: "write-set-overlap", paths: ["src/a.ts", "src/z.ts"] }]);
  });

  it("FR-NODE-147 AC-2 compares a test file of the write set on the same rule as a Files path", () => {
    const edges = analyzeConflicts([wave("w1", "test/shared.test.ts"), wave("w2", "test/shared.test.ts")], { w2: [] });
    expect(edgesFor(edges, "write-set-overlap")).toHaveLength(1);
  });
});

describe("FR-NODE-147 determinism and registration", () => {
  it("FR-NODE-147 AC-2 returns byte-identical edges for two calls, whatever key order the dependency map was built in", () => {
    const waves = [wave("w1", "src/a.ts"), wave("w2", "src/a.ts"), wave("w3", "src/b.ts")];
    const first = JSON.stringify(analyzeConflicts(waves, { w3: ["w1", "w2"], w2: [] }));
    const second = JSON.stringify(analyzeConflicts(waves, { w2: [], w3: ["w2", "w1"] }));
    expect(second).toBe(first);
  });

  it("FR-NODE-147 journal-schema registers this module's CONFLICT_REASONS array itself", async () => {
    const journalSchema = await import("../../../src/core/orchestrator/journal-schema.js");
    expect(journalSchema.CONFLICT_REASONS).toBe(CONFLICT_REASONS);
  });

  it("FR-NODE-147 journal-schema registers this module's RECIPE_KINDS array itself, order included", async () => {
    const journalSchema = await import("../../../src/core/orchestrator/journal-schema.js");
    expect(journalSchema.RECIPE_KINDS).toBe(RECIPE_KINDS);
    expect([...RECIPE_KINDS]).toEqual(["orchestrator-only", "replay", "regenerate", "exclusive-lane"]);
  });
});
