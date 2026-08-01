import { describe, expect, it } from "vitest";
import { CONFLICT_REASONS } from "../../../src/core/orchestrator/conflict.js";
import { planStageCoupling, type ParsedHandoff } from "../../../src/core/orchestrator/substrate.js";

function handoff(lane: string, writeSet: string[], readSet: string[]): ParsedHandoff {
  return {
    kind: "lane",
    lane,
    wave: 1,
    stage: 1,
    frontMatter: { write_set: writeSet, read_set: readSet },
    headings: ["## Tasks"],
    body: ""
  };
}

describe("FR-NODE-136 planStageCoupling over a stage's authored handoffs", () => {
  // AC-1
  it("emits exactly one record for a path in one lane's write_set and another lane's read_set", () => {
    const result = planStageCoupling([
      handoff("l1", ["src/core/orchestrator/conflict.ts"], []),
      handoff("l2", ["src/cli/commands/orchestrate.ts"], ["src/core/orchestrator/conflict.ts"])
    ]);

    expect(result.couplings).toEqual([
      { path: "src/core/orchestrator/conflict.ts", fromLane: "l1", toLane: "l2" }
    ]);
  });

  it("emits one record per reading lane when two lanes read one lane's written path", () => {
    const result = planStageCoupling([
      handoff("l1", ["src/core/orchestrator/conflict.ts"], []),
      handoff("l2", ["src/a.ts"], ["src/core/orchestrator/conflict.ts"]),
      handoff("l3", ["src/b.ts"], ["src/core/orchestrator/conflict.ts"])
    ]);

    expect(result.couplings).toEqual([
      { path: "src/core/orchestrator/conflict.ts", fromLane: "l1", toLane: "l2" },
      { path: "src/core/orchestrator/conflict.ts", fromLane: "l1", toLane: "l3" }
    ]);
  });

  it("does not couple a lane to itself when it both writes and reads one path", () => {
    const result = planStageCoupling([
      handoff("l1", ["src/shared.ts"], ["src/shared.ts"]),
      handoff("l2", ["src/other.ts"], [])
    ]);

    expect(result.couplings).toEqual([]);
  });

  // AC-2 — write ∩ write is not this function's subject; write-set-overlap already forced same-lane.
  it("emits no record for a path in two lanes' write_sets and in no lane's read_set", () => {
    const result = planStageCoupling([
      handoff("l1", ["src/core/orchestrator/lane-plan.ts"], []),
      handoff("l2", ["src/core/orchestrator/lane-plan.ts"], [])
    ]);

    expect(result.couplings).toEqual([]);
  });

  // AC-3 — the record shape is exactly three keys, and the return object carries nothing else.
  it("returns records of exactly path, fromLane and toLane, and a return object of exactly couplings", () => {
    const result = planStageCoupling([
      handoff("l1", ["src/written.ts"], []),
      handoff("l2", [], ["src/written.ts"])
    ]);

    expect(Object.keys(result)).toEqual(["couplings"]);
    expect(result.couplings).toHaveLength(1);
    for (const record of result.couplings) {
      expect(Object.keys(record).sort()).toEqual(["fromLane", "path", "toLane"]);
    }
  });

  // AC-4 — the declared parameter list is `handoffs` alone.
  it("declares exactly one parameter, so there is no existingPaths argument", () => {
    expect(planStageCoupling).toHaveLength(1);
  });

  // AC-5 — the withdrawn shared-substrate predicate leaves no trace in the conflict vocabulary.
  it("keeps shared-substrate out of the conflict_reason enum and returns no conflict edge", () => {
    expect(CONFLICT_REASONS).not.toContain("shared-substrate");
    expect([...CONFLICT_REASONS]).toEqual([
      "task-dependency",
      "phase-dependency",
      "write-set-overlap",
      "tdd-pair",
      "req-shared",
      "convergence-point",
      "module-barrier",
      "unknown-write-set",
      "srs-write",
      "non-code-write-set",
      "learned-coupling"
    ]);

    const result = planStageCoupling([
      handoff("l1", ["src/written.ts"], []),
      handoff("l2", [], ["src/written.ts"])
    ]);
    for (const record of result.couplings) {
      expect(record).not.toHaveProperty("reason");
    }
  });

  // AC-6
  it("returns byte-identical output for two calls over the same handoffs", () => {
    const handoffs = [
      handoff("l3", ["src/z.ts", "src/a.ts"], ["src/from-l1.ts"]),
      handoff("l1", ["src/from-l1.ts"], ["src/z.ts"]),
      handoff("l2", ["src/m.ts"], ["src/a.ts", "src/from-l1.ts"])
    ];

    const first = JSON.stringify(planStageCoupling(handoffs));
    const second = JSON.stringify(planStageCoupling(handoffs));

    expect(first).toBe(second);
    expect(JSON.parse(first)).toEqual({
      couplings: [
        { path: "src/a.ts", fromLane: "l3", toLane: "l2" },
        { path: "src/from-l1.ts", fromLane: "l1", toLane: "l2" },
        { path: "src/from-l1.ts", fromLane: "l1", toLane: "l3" },
        { path: "src/z.ts", fromLane: "l3", toLane: "l1" }
      ]
    });
  });

  it("orders records the same way whichever order the handoffs arrive in", () => {
    const a = handoff("l1", ["src/one.ts"], []);
    const b = handoff("l2", ["src/two.ts"], ["src/one.ts"]);
    const c = handoff("l3", [], ["src/one.ts", "src/two.ts"]);

    expect(planStageCoupling([a, b, c])).toEqual(planStageCoupling([c, b, a]));
  });

  it("returns no couplings for an empty stage", () => {
    expect(planStageCoupling([])).toEqual({ couplings: [] });
  });
});
