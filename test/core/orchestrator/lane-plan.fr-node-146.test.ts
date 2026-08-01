import { describe, expect, it } from "vitest";
import {
  assertLanePlanPartition,
  computeLanePlan,
  type LanePlan,
  type LanePlanInput
} from "../../../src/core/orchestrator/lane-plan.js";
import type { ConvergencePoint } from "../../../src/core/orchestrator/conflict.js";
import { buildCatalog, codeTask, laneInput, loadPinnedSidecars } from "./lane-plan-fixtures.js";

function placements(plan: LanePlan): string[] {
  return [...plan.lanes.flatMap((lane) => lane.taskIds), ...plan.serialEpilogue, ...plan.unassigned];
}

function expectPartitionOf(input: LanePlanInput, plan: LanePlan, label: string): void {
  const placed = placements(plan);
  const declared = input.catalog.map((task) => task.id);

  expect(placed.length, `${label}: no task placed twice and none missing`).toBe(declared.length);
  expect([...placed].sort(), label).toEqual([...declared].sort());
  expect(new Set(placed).size, `${label}: no duplicate placement`).toBe(placed.length);
}

describe("FR-NODE-146 the lane plan is a checkable partition of the catalogue", () => {
  // AC-1 — over the synthetic fixtures, including the degenerate groupings.
  it("places every catalogue task exactly once across lanes, the serial epilogue and unassigned", () => {
    const registry: ConvergencePoint[] = [
      { id: "CP-ORCH", paths: ["docs/spec/**"], recipe: { kind: "orchestrator-only" } },
      { id: "CP-EXCL", paths: ["src/generated/**"], recipe: { kind: "exclusive-lane" } }
    ];
    const fixtures: Array<[string, LanePlanInput]> = [
      ["empty catalogue", laneInput([])],
      ["one lane-eligible task", laneInput(buildCatalog([codeTask("T-A"), codeTask("T-A-NEXT", { depends_on_task: ["T-A"] })]))],
      [
        "everything routed to the epilogue",
        laneInput(
          buildCatalog([
            { id: "T-DOC", type: "doc", files: [{ path: "docs/a.md" }] },
            codeTask("T-SRS", { action: "call add_requirement afterwards" }),
            codeTask("T-CP", { files: [{ path: "docs/spec/00.index.md" }] })
          ]),
          { registry }
        )
      ],
      [
        "one component holding every task",
        laneInput(
          buildCatalog([
            codeTask("T-A", { files: [{ path: "src/shared.ts" }] }),
            codeTask("T-B", { files: [{ path: "src/shared.ts" }] }),
            codeTask("T-C", { files: [{ path: "src/shared.ts" }] })
          ])
        )
      ],
      [
        "every task its own singleton, all folded",
        laneInput(buildCatalog([codeTask("T-A"), codeTask("T-B"), codeTask("T-C")]))
      ],
      [
        "barriers, epilogue routing and lanes mixed in one wave",
        laneInput(
          buildCatalog([
            codeTask("T-BARRIER", { files: [] }),
            codeTask("T-LANE-A", { files: [{ path: "src/shared.ts" }] }),
            codeTask("T-LANE-B", { files: [{ path: "src/shared.ts" }] }),
            { id: "T-INFRA", type: "infra", files: [{ path: "vitest.config.ts" }] },
            codeTask("T-EXCL-A", { files: [{ path: "src/generated/x.ts" }] }),
            codeTask("T-EXCL-B", { files: [{ path: "src/generated/y.ts" }] })
          ]),
          { registry }
        )
      ],
      [
        "a stage split by the lane cap",
        laneInput(
          buildCatalog([
            codeTask("T-A1", { files: [{ path: "src/a.ts" }] }),
            codeTask("T-A2", { files: [{ path: "src/a.ts" }] }),
            codeTask("T-B1", { files: [{ path: "src/b.ts" }] }),
            codeTask("T-B2", { files: [{ path: "src/b.ts" }] }),
            codeTask("T-C1", { files: [{ path: "src/c.ts" }] }),
            codeTask("T-C2", { files: [{ path: "src/c.ts" }] })
          ]),
          { laneCap: 2 }
        )
      ]
    ];

    for (const [label, input] of fixtures) {
      expectPartitionOf(input, computeLanePlan(input), label);
    }
  });

  // AC-2 — `unassigned` is present even when empty.
  it("returns the unassigned field on every plan, empty rather than absent", () => {
    const plan = computeLanePlan(laneInput(buildCatalog([codeTask("T-A")])));

    expect(Object.keys(plan)).toContain("unassigned");
    expect(plan.unassigned).toEqual([]);
    expect(JSON.parse(JSON.stringify(plan))).toHaveProperty("unassigned", []);
  });

  it("returns unassigned as an empty array for an empty catalogue as well", () => {
    const plan = computeLanePlan(laneInput([]));

    expect(plan).toMatchObject({ lanes: [], stages: [], serialEpilogue: [], unassigned: [], serialized: [] });
    expect(plan.laneCount).toBe(0);
    expect(plan.stageCount).toBe(0);
  });

  // AC-3 — the same assertion over the characterization fixtures built from the pinned real sidecars.
  it("holds the partition over every pinned real sidecar, not only the synthetic fixtures", () => {
    const sidecars = loadPinnedSidecars();

    expect(sidecars).toHaveLength(5);
    for (const { relativePath, catalog } of sidecars) {
      const input = laneInput(catalog);
      expect(catalog.length, relativePath).toBeGreaterThan(0);
      expectPartitionOf(input, computeLanePlan(input), relativePath);
    }

    // The largest fixture is a 206-task plan whose `req-shared` edges collapse 188 of them into one
    // lane beside an 18-task epilogue. Asserted so the partition above cannot be satisfied by a plan
    // that routed everything to the epilogue and formed no lane at all.
    const largest = sidecars.find((entry) => entry.catalog.length > 100);
    const plan = computeLanePlan(laneInput(largest?.catalog ?? []));
    expect(plan.laneCount).toBeGreaterThan(0);
    expect(plan.lanes.reduce((total, lane) => total + lane.taskIds.length, 0)).toBeGreaterThan(100);
    expect(plan.serialEpilogue.length).toBeGreaterThan(0);
  });

  it("holds the partition over the pinned sidecars under a registry, a tight cap and narrow roots", () => {
    const registry: ConvergencePoint[] = [
      { id: "CP-01", paths: ["docs/spec/**"], recipe: { kind: "orchestrator-only" } },
      { id: "CP-02", paths: ["skills/**"], recipe: { kind: "regenerate" } },
      { id: "CP-03", paths: ["src/core/**"], recipe: { kind: "exclusive-lane" } }
    ];

    for (const { relativePath, catalog } of loadPinnedSidecars()) {
      const input = laneInput(catalog, { registry, laneCap: 2, codeRoots: ["src/**"], testRoots: ["test/**"] });
      expectPartitionOf(input, computeLanePlan(input), `${relativePath} under a registry`);
    }
  });

  // AC-4 — a violation fails the call; it is never a warning riding on a returned plan.
  it("fails the call with an internal error when the partition does not cover the catalogue", () => {
    const catalog = buildCatalog([codeTask("T-A"), codeTask("T-B")]);
    const dropped: LanePlan = {
      lanes: [],
      stages: [],
      laneCount: 0,
      stageCount: 0,
      serialEpilogue: ["T-A"],
      unassigned: [],
      serialized: ["T-A", "T-B"],
      conflicts: []
    };

    expect(() => assertLanePlanPartition(catalog, dropped)).toThrowError(/lane-plan-incomplete/);
  });

  it("fails the call when a task is placed twice", () => {
    const catalog = buildCatalog([codeTask("T-A")]);
    const duplicated: LanePlan = {
      lanes: [{ laneId: "l1", stage: 1, taskIds: ["T-A"], writeSet: [], readSet: [], reqIds: [], designItems: [] }],
      stages: [{ index: 1, laneIds: ["l1"] }],
      laneCount: 1,
      stageCount: 1,
      serialEpilogue: ["T-A"],
      unassigned: [],
      serialized: ["T-A"],
      conflicts: []
    };

    expect(() => assertLanePlanPartition(catalog, duplicated)).toThrowError(/lane-plan-incomplete/);
  });

  it("names the offending task ids in the internal error rather than failing anonymously", () => {
    const catalog = buildCatalog([codeTask("T-A"), codeTask("T-MISSING")]);
    const dropped: LanePlan = {
      lanes: [],
      stages: [],
      laneCount: 0,
      stageCount: 0,
      serialEpilogue: ["T-A"],
      unassigned: [],
      serialized: [],
      conflicts: []
    };

    expect(() => assertLanePlanPartition(catalog, dropped)).toThrowError(/T-MISSING/);
  });

  it("accepts a plan that does cover the catalogue exactly once", () => {
    const catalog = buildCatalog([codeTask("T-A"), codeTask("T-B")]);
    const complete: LanePlan = {
      lanes: [{ laneId: "l1", stage: 1, taskIds: ["T-A"], writeSet: [], readSet: [], reqIds: [], designItems: [] }],
      stages: [{ index: 1, laneIds: ["l1"] }],
      laneCount: 1,
      stageCount: 1,
      serialEpilogue: ["T-B"],
      unassigned: [],
      serialized: ["T-A", "T-B"],
      conflicts: []
    };

    expect(() => assertLanePlanPartition(catalog, complete)).not.toThrow();
  });

  it("returns no warnings channel on the plan, so a violation cannot be downgraded to one", () => {
    const plan = computeLanePlan(laneInput(buildCatalog([codeTask("T-A")])));

    expect(plan).not.toHaveProperty("warnings");
    expect(plan).not.toHaveProperty("diagnostics");
    expect(Object.keys(plan).sort()).toEqual([
      "conflicts",
      "laneCount",
      "lanes",
      "serialEpilogue",
      "serialized",
      "stageCount",
      "stages",
      "unassigned"
    ]);
  });
});
