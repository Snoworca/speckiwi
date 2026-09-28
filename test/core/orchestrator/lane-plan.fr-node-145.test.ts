import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeLanePlan, type LanePlanInput } from "../../../src/core/orchestrator/lane-plan.js";
import type { WaveInput } from "../../../src/core/orchestrator/conflict.js";

// FR-NODE-145 — computeLanePlan is pure and byte-deterministic over its three declared wave inputs:
// each wave's SDS write set, the waves' declared dependencies and the lane cap.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function wave(waveId: string, ...writeSet: string[]): WaveInput {
  return { waveId, writeSet };
}

function input(waves: WaveInput[], dependencies: LanePlanInput["dependencies"], laneCap = 4): LanePlanInput {
  return { waves, dependencies, laneCap };
}

function stagesOf(plan: ReturnType<typeof computeLanePlan>): string[][] {
  return plan.stages.map((stage) => stage.laneIds.map((laneId) => plan.lanes.find((lane) => lane.laneId === laneId)?.wave as string));
}

describe("FR-NODE-145 computeLanePlan purity and determinism", () => {
  it("FR-NODE-145 AC-1 returns byte-identical output over repeated calls on the same fixture", () => {
    const fixture = input(
      [wave("w1", "src/a.ts", "test/a.test.ts"), wave("w2", "src/b.ts"), wave("w3", "src/a.ts"), wave("w4", "src/d.ts")],
      { w2: [], w3: [], w4: ["w2"] },
      2
    );
    const first = JSON.stringify(computeLanePlan(fixture));
    for (let round = 0; round < 5; round += 1) expect(JSON.stringify(computeLanePlan(fixture))).toBe(first);
  });

  it("FR-NODE-145 AC-1 is insensitive to the order write-set paths and dependency keys arrive in", () => {
    const left = computeLanePlan(input([wave("w1", "src/b.ts", "src/a.ts"), wave("w2", "src/c.ts")], { w2: [] }));
    const right = computeLanePlan(input([wave("w1", "src/a.ts", "src/b.ts", "src/a.ts"), wave("w2", "src/c.ts")], { w2: [] }));
    expect(JSON.stringify(right)).toBe(JSON.stringify(left));
    expect(left.lanes[0]?.writeSet).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("FR-NODE-145 AC-2 plans from the injected write sets even where they disagree with the files on disk", () => {
    // This test file really exists and the lane-plan module really exists; the injected write sets
    // claim two waves write this test file only. A planner that consulted the repository — for
    // existence, for a parsed SDS, for anything — could not report exactly the injected sets back.
    const self = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join("/");
    expect(readFileSync(path.join(REPO_ROOT, self), "utf8").length).toBeGreaterThan(0);

    const plan = computeLanePlan(input([wave("w1", self), wave("w2", self), wave("w3", "does/not/exist.ts")], { w2: [], w3: [] }));
    expect(plan.lanes.map((lane) => [lane.wave, lane.writeSet])).toEqual([
      ["w1", [self]],
      ["w3", ["does/not/exist.ts"]],
      ["w2", [self]]
    ]);
    expect(stagesOf(plan)).toEqual([["w1", "w3"], ["w2"]]);
  });

  it("FR-NODE-145 AC-6 splits a layer holding more waves than the lane cap into consecutive stages", () => {
    const waves = [wave("w1", "src/1.ts"), wave("w2", "src/2.ts"), wave("w3", "src/3.ts"), wave("w4", "src/4.ts"), wave("w5", "src/5.ts")];
    const independent = { w2: [], w3: [], w4: [], w5: [] };

    const capped = computeLanePlan(input(waves, independent, 2));
    expect(stagesOf(capped)).toEqual([["w1", "w2"], ["w3", "w4"], ["w5"]]);
    expect(JSON.stringify(computeLanePlan(input(waves, independent, 2)))).toBe(JSON.stringify(capped));

    const wider = computeLanePlan(input(waves, independent, 3));
    expect(stagesOf(wider)).toEqual([["w1", "w2", "w3"], ["w4", "w5"]]);
    expect(JSON.stringify(wider)).not.toBe(JSON.stringify(capped));
  });

  it("FR-NODE-145 AC-6 leaves a layer inside the cap in one stage, and keeps later layers after the split ones", () => {
    const plan = computeLanePlan(
      input([wave("w1", "src/1.ts"), wave("w2", "src/2.ts"), wave("w3", "src/3.ts")], { w2: [], w3: ["w1", "w2"] }, 1)
    );
    expect(stagesOf(plan)).toEqual([["w1"], ["w2"], ["w3"]]);

    const roomy = computeLanePlan(
      input([wave("w1", "src/1.ts"), wave("w2", "src/2.ts"), wave("w3", "src/3.ts")], { w2: [], w3: ["w1", "w2"] }, 4)
    );
    expect(stagesOf(roomy)).toEqual([["w1", "w2"], ["w3"]]);
  });
});
