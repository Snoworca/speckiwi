import { describe, expect, it } from "vitest";
import { LanePlanError, computeLanePlan, type LanePlan, type LanePlanInput } from "../../../src/core/orchestrator/lane-plan.js";
import type { WaveInput } from "../../../src/core/orchestrator/conflict.js";

// FR-NODE-213 AC-1, the kernel half — one lane per wave, and stages in which every wave's
// dependencies sit in earlier stages and the waves of one stage have pairwise disjoint SDS write sets,
// at most `laneCap` lanes per stage. The CLI half (`orchestrate schedule waves`) is tested in
// test/cli/orchestrate-schedule-waves.fr-node-213.test.ts.

function wave(waveId: string, ...writeSet: string[]): WaveInput {
  return { waveId, writeSet };
}

function stageOf(plan: LanePlan, waveId: string): number {
  const lane = plan.lanes.find((entry) => entry.wave === waveId);
  expect(lane, `wave ${waveId} has a lane`).toBeDefined();
  return (lane as { stage: number }).stage;
}

/** Every property AC-1 states, checked over one plan. */
function expectScheduleProperties(input: LanePlanInput, plan: LanePlan): void {
  expect(plan.lanes).toHaveLength(input.waves.length);
  const byWave = new Map(input.waves.map((entry, index) => [entry.waveId, { entry, index }]));
  for (const lane of plan.lanes) {
    const { entry, index } = byWave.get(lane.wave) as { entry: WaveInput; index: number };
    const declared = input.dependencies[lane.wave] ?? input.waves.slice(0, index).map((earlier) => earlier.waveId);
    for (const dependency of declared) expect(stageOf(plan, dependency), `${lane.wave} after ${dependency}`).toBeLessThan(lane.stage);
    expect([...lane.writeSet].sort()).toEqual([...new Set(entry.writeSet)].sort());
  }
  for (const stage of plan.stages) {
    expect(stage.laneIds.length).toBeLessThanOrEqual(input.laneCap);
    const paths = stage.laneIds.flatMap((laneId) => plan.lanes.find((lane) => lane.laneId === laneId)?.writeSet ?? []);
    expect(new Set(paths).size, `stage ${stage.index} write sets are pairwise disjoint`).toBe(paths.length);
  }
}

describe("FR-NODE-213 AC-1 the wave scheduler plans one lane per wave", () => {
  it("FR-NODE-213 AC-1 gives every wave its own lane, named from the wave", () => {
    const plan = computeLanePlan({ waves: [wave("run-wave-1", "src/a.ts"), wave("run-wave-2", "src/b.ts")], dependencies: { "run-wave-2": [] }, laneCap: 4 });
    expect(plan.lanes.map((lane) => [lane.laneId, lane.wave])).toEqual([
      ["lane-run-wave-1", "run-wave-1"],
      ["lane-run-wave-2", "run-wave-2"]
    ]);
    expect(plan.stageCount).toBe(1);
  });

  it("FR-NODE-213 AC-1 runs waves without a declared dependency serially, each after every earlier wave", () => {
    const input: LanePlanInput = { waves: [wave("w1", "src/a.ts"), wave("w2", "src/b.ts"), wave("w3", "src/c.ts")], dependencies: {}, laneCap: 4 };
    const plan = computeLanePlan(input);
    expect(plan.stages.map((stage) => stage.laneIds)).toEqual([["lane-w1"], ["lane-w2"], ["lane-w3"]]);
    expectScheduleProperties(input, plan);
  });

  it("FR-NODE-213 AC-1 puts independent waves with disjoint write sets in one stage", () => {
    const input: LanePlanInput = {
      waves: [wave("w1", "src/a.ts", "test/a.test.ts"), wave("w2", "src/b.ts", "test/b.test.ts"), wave("w3", "src/c.ts")],
      dependencies: { w2: [], w3: [] },
      laneCap: 4
    };
    const plan = computeLanePlan(input);
    expect(plan.stages.map((stage) => stage.laneIds)).toEqual([["lane-w1", "lane-w2", "lane-w3"]]);
    expectScheduleProperties(input, plan);
  });

  it("FR-NODE-213 AC-1 separates independent waves whose SDS write sets overlap into different stages", () => {
    const input: LanePlanInput = {
      waves: [wave("w1", "src/a.ts"), wave("w2", "src/shared.ts", "src/b.ts"), wave("w3", "src/shared.ts")],
      dependencies: { w2: [], w3: [] },
      laneCap: 4
    };
    const plan = computeLanePlan(input);
    expect(stageOf(plan, "w2")).not.toBe(stageOf(plan, "w3"));
    expect(plan.stages.map((stage) => stage.laneIds)).toEqual([["lane-w1", "lane-w2"], ["lane-w3"]]);
    expectScheduleProperties(input, plan);
  });

  it("FR-NODE-213 AC-1 places a dependent wave in a stage after the one it depends on, even when declared first", () => {
    const input: LanePlanInput = {
      waves: [wave("w-late", "src/late.ts"), wave("w-early", "src/early.ts")],
      dependencies: { "w-late": ["w-early"], "w-early": [] },
      laneCap: 4
    };
    const plan = computeLanePlan(input);
    expect(stageOf(plan, "w-early")).toBe(1);
    expect(stageOf(plan, "w-late")).toBe(2);
    expectScheduleProperties(input, plan);
  });

  it("FR-NODE-213 AC-1 holds every property over a mixed fixture under a tight cap", () => {
    const input: LanePlanInput = {
      waves: [
        wave("w1", "src/a.ts"),
        wave("w2", "src/b.ts"),
        wave("w3", "src/a.ts"),
        wave("w4", "src/c.ts"),
        wave("w5", "src/d.ts"),
        wave("w6", "src/b.ts", "src/d.ts")
      ],
      dependencies: { w2: [], w3: [], w4: ["w1"], w5: [], w6: ["w4"] },
      laneCap: 2
    };
    expectScheduleProperties(input, computeLanePlan(input));
  });

  it("FR-NODE-213 AC-1 records the edges it placed on as wave-dependency and write-set-overlap conflicts", () => {
    const plan = computeLanePlan({ waves: [wave("w1", "src/a.ts"), wave("w2", "src/a.ts"), wave("w3", "src/c.ts")], dependencies: { w2: [], w3: ["w2"] }, laneCap: 4 });
    expect(plan.conflicts).toEqual([
      { a: "w3", b: "w2", reason: "wave-dependency" },
      { a: "w1", b: "w2", reason: "write-set-overlap", paths: ["src/a.ts"] }
    ]);
  });

  it("FR-NODE-213 AC-1 refuses a dependency cycle with schedule-cycle", () => {
    const run = () => computeLanePlan({ waves: [wave("w1", "src/a.ts"), wave("w2", "src/b.ts")], dependencies: { w1: ["w2"], w2: ["w1"] }, laneCap: 4 });
    expect(run).toThrowError(LanePlanError);
    expect(run).toThrowError(/schedule-cycle/);
  });

  it("FR-NODE-213 AC-1 refuses a dependency on a wave outside the scheduled set rather than dropping it", () => {
    expect(() => computeLanePlan({ waves: [wave("w1", "src/a.ts")], dependencies: { w1: ["w-typo"] }, laneCap: 4 })).toThrowError(/w-typo/);
  });

  it("FR-NODE-213 AC-1 refuses two waves under one id as lane-plan-incomplete, since neither can be placed exactly once", () => {
    const run = () => computeLanePlan({ waves: [wave("w1", "src/a.ts"), wave("w1", "src/b.ts")], dependencies: {}, laneCap: 4 });
    expect(run).toThrowError(LanePlanError);
    expect(run).toThrowError(/lane-plan-incomplete.*w1/);
  });
});
