import { describe, expect, it } from "vitest";
import { selectNextTask, type WorkflowTaskCatalogEntry } from "../../../src/core/workflow/validate.js";
import { computeLanePlan } from "../../../src/core/orchestrator/lane-plan.js";
import { buildCatalog, codeTask, laneInput, loadPinnedSidecars } from "./lane-plan-fixtures.js";

/**
 * The oracle is `selectNextTask` itself — the shipped serial cursor `kiwi-pm` runs — driven to
 * exhaustion with each returned task marked done. FR-NODE-148 AC-3 forbids reimplementing its
 * ordering here, so this helper only turns the crank.
 */
function driveSerialSelector(catalog: WorkflowTaskCatalogEntry[]): string[] {
  const working = catalog.map((task) => ({ ...task }));
  const order: string[] = [];

  for (let guard = 0; guard <= working.length; guard += 1) {
    const { nextTask } = selectNextTask(working);
    if (!nextTask) return order;
    order.push(nextTask.id);
    nextTask.status = "done";
  }
  throw new Error("the serial selector did not terminate over this catalogue");
}

describe("FR-NODE-148 lane plan serialized ordering equals the serial selector's", () => {
  // AC-1 / AC-3 — the differential assertion, against the implementation rather than a copy of it.
  it("matches the serial selector element-wise over a straight declaration-order catalogue", () => {
    const catalog = buildCatalog([codeTask("T-003"), codeTask("T-001"), codeTask("T-002")]);

    const plan = computeLanePlan(laneInput(catalog));

    expect(plan.serialized).toEqual(driveSerialSelector(catalog));
    expect(plan.serialized).toEqual(["T-003", "T-001", "T-002"]);
  });

  it("matches the serial selector's walk over a dependency chain declared in order", () => {
    const catalog = buildCatalog([
      codeTask("T-B"),
      codeTask("T-A", { depends_on_task: ["T-B"] }),
      codeTask("T-C", { depends_on_task: ["T-A"] })
    ]);

    const plan = computeLanePlan(laneInput(catalog));

    expect(plan.serialized).toEqual(driveSerialSelector(catalog));
    expect(plan.serialized).toEqual(["T-B", "T-A", "T-C"]);
  });

  it("matches the selector's stall when a dependency is declared after its dependent", () => {
    // The selector is a serial cursor: it walks in declaration order and, if the first not-done task
    // is blocked, returns nothing at all. It never reorders the walk to satisfy a dependency.
    const catalog = buildCatalog([
      codeTask("T-A", { depends_on_task: ["T-B"] }),
      codeTask("T-B"),
      codeTask("T-C", { depends_on_task: ["T-A"] })
    ]);

    const plan = computeLanePlan(laneInput(catalog));

    expect(driveSerialSelector(catalog)).toEqual([]);
    expect(plan.serialized).toEqual([]);
  });

  it("matches the serial selector's head-of-line blocking, including the tasks it never reaches", () => {
    // T-A depends on a task that is not in the catalogue, so the cursor stalls and returns nothing.
    const catalog = buildCatalog([codeTask("T-A", { depends_on_task: ["T-ABSENT"] }), codeTask("T-B")]);

    const plan = computeLanePlan(laneInput(catalog));

    expect(driveSerialSelector(catalog)).toEqual([]);
    expect(plan.serialized).toEqual([]);
  });

  it("matches the serial selector when the catalogue already carries done and skipped statuses", () => {
    const catalog = buildCatalog([
      codeTask("T-A", { status: "done" }),
      codeTask("T-B", { status: "skipped" }),
      codeTask("T-C", { depends_on_task: ["T-A", "T-B"] }),
      codeTask("T-D")
    ]);

    const plan = computeLanePlan(laneInput(catalog));

    expect(plan.serialized).toEqual(driveSerialSelector(catalog));
    expect(plan.serialized).toEqual(["T-C", "T-D"]);
  });

  it("matches the serial selector over a catalogue whose tasks are all routed to the serial epilogue", () => {
    const catalog = buildCatalog([
      { id: "T-DOC", type: "doc", files: [{ path: "docs/a.md" }] },
      { id: "T-INFRA", type: "infra", files: [{ path: "vitest.config.ts" }], depends_on_task: ["T-DOC"] }
    ]);

    const plan = computeLanePlan(laneInput(catalog));

    expect(plan.serialized).toEqual(driveSerialSelector(catalog));
    expect(plan.serialized).toEqual(["T-DOC", "T-INFRA"]);
  });

  it("returns an empty serialized sequence for an empty catalogue, as the selector does", () => {
    expect(computeLanePlan(laneInput([])).serialized).toEqual(driveSerialSelector([]));
  });

  // AC-2 — the same differential over the pinned real-sidecar characterization fixtures.
  it("matches the serial selector element-wise over every pinned real sidecar", () => {
    const sidecars = loadPinnedSidecars();

    expect(sidecars).toHaveLength(5);
    for (const { relativePath, catalog } of sidecars) {
      const expected = driveSerialSelector(catalog);

      expect(expected.length, relativePath).toBeGreaterThan(0);
      expect(computeLanePlan(laneInput(catalog)).serialized, relativePath).toEqual(expected);
    }
  });

  it("keeps the serialized sequence independent of the lane cap and the registry, which reorder lanes only", () => {
    const catalog = buildCatalog([
      codeTask("T-A", { files: [{ path: "src/a.ts" }] }),
      codeTask("T-B", { files: [{ path: "src/a.ts" }] }),
      codeTask("T-C", { files: [{ path: "src/c.ts" }] }),
      codeTask("T-D", { files: [{ path: "src/c.ts" }] })
    ]);
    const expected = driveSerialSelector(catalog);

    expect(computeLanePlan(laneInput(catalog, { laneCap: 1 })).serialized).toEqual(expected);
    expect(computeLanePlan(laneInput(catalog, { laneCap: 8 })).serialized).toEqual(expected);
  });
});
