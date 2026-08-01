import { describe, expect, it } from "vitest";
import { computeLanePlan, type LanePlan } from "../../../src/core/orchestrator/lane-plan.js";
import type { ConvergencePoint, PriorPostmortemRow } from "../../../src/core/orchestrator/conflict.js";
import { buildCatalog, codeTask, laneInput, loadPinnedSidecars } from "./lane-plan-fixtures.js";

function laneOf(plan: LanePlan, taskId: string): string | null {
  return plan.lanes.find((lane) => lane.taskIds.includes(taskId))?.laneId ?? null;
}

/** A dependent keeps its predecessor out of the single-task fold, so lane placement is observable. */
function withDependent(id: string) {
  return codeTask(`${id}-NEXT`, { depends_on_task: [id] });
}

describe("FR-NODE-145 computeLanePlan purity and determinism", () => {
  // AC-1 — byte-identical output over the nine declared inputs.
  it("takes nine declared inputs and returns byte-identical output for two calls with equal inputs", () => {
    const input = laneInput(
      buildCatalog([
        codeTask("T-A", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-1"] }),
        codeTask("T-B", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-1"] }),
        codeTask("T-C", { depends_on_task: ["T-A"] }),
        codeTask("T-D", { depends_on_task: ["T-C"] })
      ]),
      { designItemMap: { "FR-1": ["D-002", "D-001"] } }
    );

    expect(Object.keys(input).sort()).toEqual([
      "catalog",
      "codeRoots",
      "designItemMap",
      "existingModules",
      "existingPaths",
      "laneCap",
      "priorPostmortems",
      "registry",
      "testRoots"
    ]);
    expect(Object.keys(input)).toHaveLength(9);

    const first = JSON.stringify(computeLanePlan(input));
    const second = JSON.stringify(computeLanePlan(input));

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("produces the same bytes whichever order equal tasks were declared in the same component", () => {
    const forward = computeLanePlan(
      laneInput(
        buildCatalog([
          codeTask("T-A", { files: [{ path: "src/shared.ts" }] }),
          codeTask("T-B", { files: [{ path: "src/shared.ts" }] })
        ])
      )
    );
    const reversed = computeLanePlan(
      laneInput(
        buildCatalog([
          codeTask("T-B", { files: [{ path: "src/shared.ts" }] }),
          codeTask("T-A", { files: [{ path: "src/shared.ts" }] })
        ])
      )
    );

    expect(forward.lanes.map((lane) => lane.taskIds)).toEqual(reversed.lanes.map((lane) => lane.taskIds));
  });

  // AC-2 — path existence is whatever the injected array says, never what the disk says.
  it("honours an injected existing-paths array that deliberately disagrees with this repository", () => {
    // `src/core/orchestrator` exists in this checkout; `src/no-such-directory` does not. The plan
    // follows the injected array in both directions, which the disk would refuse to reproduce.
    const real = buildCatalog([
      codeTask("T-DIR", { files: [{ path: "src/core/orchestrator" }] }),
      codeTask("T-FILE", { files: [{ path: "src/core/orchestrator/conflict.ts" }] }),
      withDependent("T-DIR"),
      withDependent("T-FILE")
    ]);
    const fictional = buildCatalog([
      codeTask("T-DIR", { files: [{ path: "src/no-such-directory" }] }),
      codeTask("T-FILE", { files: [{ path: "src/no-such-directory/invented.ts" }] }),
      withDependent("T-DIR"),
      withDependent("T-FILE")
    ]);

    const realDeniedByInput = computeLanePlan(laneInput(real, { existingPaths: [] }));
    const fictionalAssertedByInput = computeLanePlan(laneInput(fictional, { existingPaths: ["src/no-such-directory"] }));

    expect(laneOf(realDeniedByInput, "T-DIR")).not.toBe(laneOf(realDeniedByInput, "T-FILE"));
    expect(laneOf(fictionalAssertedByInput, "T-DIR")).toBe(laneOf(fictionalAssertedByInput, "T-FILE"));
    expect(laneOf(fictionalAssertedByInput, "T-DIR")).not.toBeNull();
  });

  // AC-3 — design items are the sorted, deduplicated union of the map over the lane's req ids.
  it("derives each lane's design items as the sorted deduplicated union over that lane's req ids", () => {
    const plan = computeLanePlan(
      laneInput(
        buildCatalog([
          codeTask("T-A", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-2"] }),
          codeTask("T-B", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-1"] })
        ]),
        { designItemMap: { "FR-1": ["D-003", "D-001"], "FR-2": ["D-002"] } }
      )
    );

    expect(plan.lanes).toHaveLength(1);
    expect(plan.lanes[0]?.reqIds).toEqual(["FR-1", "FR-2"]);
    expect(plan.lanes[0]?.designItems).toEqual(["D-001", "D-002", "D-003"]);
  });

  it("yields each design item once when two of a lane's requirements map to an overlapping item set", () => {
    const plan = computeLanePlan(
      laneInput(
        buildCatalog([
          codeTask("T-A", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-1"] }),
          codeTask("T-B", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-2"] })
        ]),
        { designItemMap: { "FR-1": ["D-001", "D-002"], "FR-2": ["D-002", "D-003"] } }
      )
    );

    expect(plan.lanes[0]?.designItems).toEqual(["D-001", "D-002", "D-003"]);
  });

  it("leaves a lane's design items empty when the map carries no entry for its req ids", () => {
    const plan = computeLanePlan(
      laneInput(
        buildCatalog([
          codeTask("T-A", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-9"] }),
          codeTask("T-B", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-9"] })
        ]),
        { designItemMap: { "FR-1": ["D-001"] } }
      )
    );

    expect(plan.lanes[0]?.designItems).toEqual([]);
  });

  // AC-4 — the prefix-directory clause is suppressed for a directory the input says does not exist.
  it("does not force two tasks into one lane over a shared parent directory absent from existing paths", () => {
    const catalog = buildCatalog([
      codeTask("T-DIR", { files: [{ path: "src/core/orchestrator" }] }),
      codeTask("T-FILE", { files: [{ path: "src/core/orchestrator/conflict.ts" }] }),
      withDependent("T-DIR"),
      withDependent("T-FILE")
    ]);

    const absent = computeLanePlan(laneInput(catalog, { existingPaths: [] }));
    const present = computeLanePlan(laneInput(catalog, { existingPaths: ["src/core/orchestrator"] }));

    expect(laneOf(absent, "T-DIR")).not.toBe(laneOf(absent, "T-FILE"));
    expect(laneOf(present, "T-DIR")).toBe(laneOf(present, "T-FILE"));
    expect(laneOf(present, "T-DIR")).not.toBeNull();
  });

  // AC-5 — the prior-postmortem projection, its three resolutions and its path fallback.
  it("couples a merge-into-one-lane row's two tasks into one lane under a learned-coupling edge", () => {
    const catalog = buildCatalog([codeTask("T-A"), codeTask("T-B"), withDependent("T-A"), withDependent("T-B")]);
    const row: PriorPostmortemRow = {
      fromTask: "T-A",
      toTask: "T-B",
      path: "src/T-A.ts",
      detectedAt: "2026-07-01T00:00:00Z",
      resolution: "merge-into-one-lane"
    };

    const coupled = computeLanePlan(laneInput(catalog, { priorPostmortems: [row] }));
    const uncoupled = computeLanePlan(laneInput(catalog));

    expect(laneOf(coupled, "T-A")).toBe(laneOf(coupled, "T-B"));
    expect(coupled.conflicts).toContainEqual({ a: "T-A", b: "T-B", reason: "learned-coupling" });
    expect(laneOf(uncoupled, "T-A")).not.toBe(laneOf(uncoupled, "T-B"));
  });

  it("emits no edge for a row resolved re-planned or accepted", () => {
    const catalog = buildCatalog([codeTask("T-A"), codeTask("T-B"), withDependent("T-A"), withDependent("T-B")]);
    const base = { fromTask: "T-A", toTask: "T-B", path: "src/T-A.ts", detectedAt: "2026-07-01T00:00:00Z" };

    for (const resolution of ["re-planned", "accepted"]) {
      const plan = computeLanePlan(laneInput(catalog, { priorPostmortems: [{ ...base, resolution }] }));
      expect(plan.conflicts.map((edge) => edge.reason)).not.toContain("learned-coupling");
      expect(laneOf(plan, "T-A")).not.toBe(laneOf(plan, "T-B"));
    }
  });

  it("falls back to the tasks whose declared files contain the row's path when the row's task ids are gone", () => {
    const catalog = buildCatalog([
      codeTask("T-NOW-A", { files: [{ path: "src/coupled.ts" }] }),
      codeTask("T-NOW-B", { files: [{ path: "src/coupled.ts" }] }),
      withDependent("T-NOW-A"),
      withDependent("T-NOW-B")
    ]);
    const row: PriorPostmortemRow = {
      fromTask: "T-VANISHED-1",
      toTask: "T-VANISHED-2",
      path: "src/coupled.ts",
      detectedAt: "2026-07-01T00:00:00Z",
      resolution: "merge-into-one-lane"
    };

    const resolved = computeLanePlan(laneInput(catalog, { priorPostmortems: [row] }));
    const unresolved = computeLanePlan(laneInput(catalog, { priorPostmortems: [{ ...row, path: "src/unrelated.ts" }] }));

    expect(resolved.conflicts).toContainEqual({ a: "T-NOW-A", b: "T-NOW-B", reason: "learned-coupling" });
    expect(laneOf(resolved, "T-NOW-A")).toBe(laneOf(resolved, "T-NOW-B"));
    expect(unresolved.conflicts.map((edge) => edge.reason)).not.toContain("learned-coupling");
  });

  // AC-6 — the per-stage lane cap, applied after layering.
  it("splits a stage holding more lanes than the cap into consecutive stages, longest first", () => {
    // Six independent components of descending size, all layered into stage 1 before the split.
    const catalog = buildCatalog([
      ...componentOf("A", 6),
      ...componentOf("B", 5),
      ...componentOf("C", 4),
      ...componentOf("D", 3),
      ...componentOf("E", 2),
      ...componentOf("F", 2)
    ]);

    const plan = computeLanePlan(laneInput(catalog, { laneCap: 2 }));

    expect(plan.lanes).toHaveLength(6);
    expect(plan.stageCount).toBe(3);
    for (const stage of plan.stages) expect(stage.laneIds.length).toBeLessThanOrEqual(2);

    const sizeByStage = plan.stages.map((stage) =>
      stage.laneIds
        .map((laneId) => plan.lanes.find((lane) => lane.laneId === laneId)?.taskIds.length ?? 0)
        .sort((a, b) => b - a)
    );
    expect(sizeByStage).toEqual([
      [6, 5],
      [4, 3],
      [2, 2]
    ]);
  });

  it("produces the same split for two calls, and a different split for a different lane cap", () => {
    const catalog = buildCatalog([
      ...componentOf("A", 6),
      ...componentOf("B", 5),
      ...componentOf("C", 4),
      ...componentOf("D", 3),
      ...componentOf("E", 2),
      ...componentOf("F", 2)
    ]);

    const capTwo = JSON.stringify(computeLanePlan(laneInput(catalog, { laneCap: 2 })));
    const capTwoAgain = JSON.stringify(computeLanePlan(laneInput(catalog, { laneCap: 2 })));
    const capThree = JSON.stringify(computeLanePlan(laneInput(catalog, { laneCap: 3 })));

    expect(capTwo).toBe(capTwoAgain);
    expect(capThree).not.toBe(capTwo);
    expect(JSON.parse(capThree).stageCount).toBe(2);
  });

  it("leaves a stage inside the cap untouched", () => {
    const catalog = buildCatalog([...componentOf("A", 3), ...componentOf("B", 2)]);

    const plan = computeLanePlan(laneInput(catalog, { laneCap: 4 }));

    expect(plan.stageCount).toBe(1);
    expect(plan.stages[0]?.laneIds).toHaveLength(2);
  });

  it("re-runs cycle detection over the catalogue and refuses a cyclic dependency graph", () => {
    const catalog = buildCatalog([
      codeTask("T-A", { depends_on_task: ["T-B"] }),
      codeTask("T-B", { depends_on_task: ["T-A"] })
    ]);

    expect(() => computeLanePlan(laneInput(catalog))).toThrowError(/schedule-cycle/);
  });

  // The pinned real sidecars exercise determinism against inputs no synthetic fixture reproduces.
  it("is byte-deterministic over every pinned real sidecar", () => {
    const sidecars = loadPinnedSidecars();

    expect(sidecars).toHaveLength(5);
    for (const { relativePath, catalog } of sidecars) {
      expect(catalog.length, relativePath).toBeGreaterThan(0);
      const input = laneInput(catalog);
      expect(JSON.stringify(computeLanePlan(input)), relativePath).toBe(JSON.stringify(computeLanePlan(input)));
    }
  });

  it("holds the registry, existing modules and convergence recipes as inputs rather than reading them", () => {
    const registry: ConvergencePoint[] = [
      { id: "CP-01", paths: ["src/generated/**"], recipe: { kind: "exclusive-lane" } }
    ];
    const catalog = buildCatalog([
      codeTask("T-GEN-A", { files: [{ path: "src/generated/a.ts" }] }),
      codeTask("T-GEN-B", { files: [{ path: "src/generated/b.ts" }] }),
      withDependent("T-GEN-A"),
      withDependent("T-GEN-B")
    ]);

    const withRegistry = computeLanePlan(laneInput(catalog, { registry }));
    const withoutRegistry = computeLanePlan(laneInput(catalog));

    expect(laneOf(withRegistry, "T-GEN-A")).toBe(laneOf(withRegistry, "T-GEN-B"));
    expect(laneOf(withoutRegistry, "T-GEN-A")).not.toBe(laneOf(withoutRegistry, "T-GEN-B"));
  });
});

/** `size` tasks pulled into one component by a shared declared file, so the lane has that size. */
function componentOf(label: string, size: number) {
  return Array.from({ length: size }, (_, index) =>
    codeTask(`T-${label}-${String(index).padStart(2, "0")}`, {
      files: [{ path: `src/${label}/shared.ts` }, { path: `src/${label}/${index}.ts` }]
    })
  );
}
