import { describe, expect, it } from "vitest";
import { assertLanePlanPartition, computeLanePlan, type LanePlan, type LanePlanInput } from "../../../src/core/orchestrator/lane-plan.js";
import type { WaveInput } from "../../../src/core/orchestrator/conflict.js";

// FR-NODE-146 — the lane plan is a checkable partition of the scheduled waves: every input wave lands
// in exactly one lane, and a violation fails the call rather than riding on the plan as a warning.

function wave(waveId: string, ...writeSet: string[]): WaveInput {
  return { waveId, writeSet };
}

const FIXTURES: ReadonlyArray<{ label: string; input: LanePlanInput }> = [
  { label: "one wave", input: { waves: [wave("w1", "src/a.ts")], dependencies: {}, laneCap: 4 } },
  {
    label: "a serial chain by default",
    input: { waves: [wave("w1", "src/a.ts"), wave("w2", "src/b.ts"), wave("w3", "src/c.ts")], dependencies: {}, laneCap: 4 }
  },
  {
    label: "independent waves with overlaps under a tight cap",
    input: {
      waves: [wave("w1", "src/a.ts"), wave("w2", "src/a.ts"), wave("w3", "src/b.ts"), wave("w4", "src/c.ts"), wave("w5", "src/a.ts")],
      dependencies: { w2: [], w3: [], w4: [], w5: [] },
      laneCap: 2
    }
  },
  {
    label: "a diamond",
    input: {
      waves: [wave("w1", "src/a.ts"), wave("w2", "src/b.ts"), wave("w3", "src/c.ts"), wave("w4", "src/a.ts", "src/b.ts")],
      dependencies: { w2: ["w1"], w3: ["w1"], w4: ["w2", "w3"] },
      laneCap: 4
    }
  },
  { label: "no waves", input: { waves: [], dependencies: {}, laneCap: 4 } }
];

describe("FR-NODE-146 the lane plan partitions the scheduled waves", () => {
  for (const { label, input } of FIXTURES) {
    it(`FR-NODE-146 AC-1 carries every input wave exactly once across the lanes: ${label}`, () => {
      const plan = computeLanePlan(input);
      const carried = plan.lanes.map((lane) => lane.wave);
      expect([...carried].sort()).toEqual(input.waves.map((entry) => entry.waveId).sort());
      expect(new Set(carried).size).toBe(carried.length);
      expect(plan.laneCount).toBe(input.waves.length);
      expect(plan.stages.flatMap((stage) => stage.laneIds).sort()).toEqual(plan.lanes.map((lane) => lane.laneId).sort());
    });
  }

  it("FR-NODE-146 AC-4 fails the call with an internal error when a wave is missing from the lanes", () => {
    const waves = [wave("w1", "src/a.ts"), wave("w-missing", "src/b.ts")];
    const dropped: LanePlan = {
      lanes: [{ laneId: "l1", stage: 1, wave: "w1", writeSet: ["src/a.ts"] }],
      stages: [{ index: 1, laneIds: ["l1"] }],
      laneCount: 1,
      stageCount: 1,
      conflicts: []
    };
    expect(() => assertLanePlanPartition(waves, dropped)).toThrowError(/lane-plan-incomplete/);
    expect(() => assertLanePlanPartition(waves, dropped)).toThrowError(/w-missing/);
  });

  it("FR-NODE-146 AC-4 fails the call when a wave is placed twice or a lane carries an unknown wave", () => {
    const waves = [wave("w1", "src/a.ts")];
    const twice: LanePlan = {
      lanes: [
        { laneId: "l1", stage: 1, wave: "w1", writeSet: [] },
        { laneId: "l2", stage: 2, wave: "w1", writeSet: [] }
      ],
      stages: [
        { index: 1, laneIds: ["l1"] },
        { index: 2, laneIds: ["l2"] }
      ],
      laneCount: 2,
      stageCount: 2,
      conflicts: []
    };
    expect(() => assertLanePlanPartition(waves, twice)).toThrowError(/lane-plan-incomplete/);

    const unknown: LanePlan = { ...twice, lanes: [{ laneId: "l1", stage: 1, wave: "w-ghost", writeSet: [] }], laneCount: 1 };
    expect(() => assertLanePlanPartition([], unknown)).toThrowError(/w-ghost/);
  });

  it("FR-NODE-146 AC-4 accepts a plan that carries every wave exactly once", () => {
    const waves = [wave("w1", "src/a.ts"), wave("w2", "src/b.ts")];
    expect(() => assertLanePlanPartition(waves, computeLanePlan({ waves, dependencies: {}, laneCap: 4 }))).not.toThrow();
  });

  it("FR-NODE-146 AC-4 returns no warnings channel on the plan, so a violation cannot be downgraded to one", () => {
    const plan = computeLanePlan({ waves: [wave("w1", "src/a.ts")], dependencies: {}, laneCap: 4 });
    expect(Object.keys(plan).sort()).toEqual(["conflicts", "laneCount", "lanes", "stageCount", "stages"]);
  });
});
