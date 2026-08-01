import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../../src/core/types.js";
import { normalizeTasks, type SidecarPhase, type SidecarTask } from "../../../src/core/orchestrator/task-catalog.js";

/** The seven fields `WorkflowTaskCatalogEntry` has carried since before this extension. */
const EXISTING_FIELDS = ["id", "phase_id", "title", "depends_on_task", "req_ids", "legacyReqIds", "status"] as const;

function existingView(entry: object): Record<string, unknown> {
  const record: Record<string, unknown> = { ...entry };
  const view: Record<string, unknown> = {};
  for (const key of EXISTING_FIELDS) {
    if (key in record) view[key] = record[key];
  }
  return view;
}

describe("FR-NODE-149 sidecar task catalogue extension", () => {
  // AC-1
  it("exposes files with their line ranges, test files, covered ACs, type and action from the sidecar", () => {
    const diagnostics: Diagnostic[] = [];
    const tasks: SidecarTask[] = [
      {
        id: "T-PH001-01",
        phase_id: "PH-001",
        title: "Write the failing lane-plan tests",
        type: "code",
        action: "Create src/core/orchestrator/lane-plan.ts and its test",
        req_ids: ["FR-NODE-145"],
        files: [
          { path: "src/core/orchestrator/lane-plan.ts", line_range: "1-40" },
          { path: "src/core/orchestrator/conflict.ts" }
        ],
        test_files: [{ path: "test/core/orchestrator/lane-plan.fr-node-145.test.ts", line_range: "1-200" }],
        covers_ac: ["AC-1", "AC-4"],
        depends_on_task: ["T-PH001-00"],
        tdd: { applicable: true, phase: "red" }
      }
    ];

    const [entry] = normalizeTasks(tasks, null, diagnostics);

    expect(entry?.type).toBe("code");
    expect(entry?.action).toBe("Create src/core/orchestrator/lane-plan.ts and its test");
    expect(entry?.files).toEqual([
      { path: "src/core/orchestrator/lane-plan.ts", lineRange: "1-40", inferred: false },
      { path: "src/core/orchestrator/conflict.ts", inferred: false }
    ]);
    expect(entry?.testFiles).toEqual([
      { path: "test/core/orchestrator/lane-plan.fr-node-145.test.ts", lineRange: "1-200", inferred: false }
    ]);
    expect(entry?.coversAc).toEqual(["AC-1", "AC-4"]);
    expect(entry?.tdd).toEqual({ phase: "red" });
  });

  it("carries the sidecar's declared tdd phase verbatim, including the two non-pairing values", () => {
    const green = normalizeTasks([{ id: "T-1", tdd: { applicable: true, phase: "green" } }], null, []);
    const exempt = normalizeTasks([{ id: "T-2", tdd: { applicable: false, phase: "n/a" } }], null, []);

    expect(green[0]?.tdd).toEqual({ phase: "green" });
    expect(exempt[0]?.tdd).toEqual({ phase: "n/a" });
  });

  it("strips an [INFERRED:level] label off a declared path and records it as an inferred write set", () => {
    const [entry] = normalizeTasks(
      [{ id: "T-1", files: [{ path: "src/core/orchestrator/[INFERRED:medium] resume.ts" }] }],
      null,
      []
    );

    expect(entry?.files).toEqual([{ path: "src/core/orchestrator/resume.ts", inferred: true }]);
  });

  it("normalises declared paths to repo-relative POSIX form without a leading ./", () => {
    const [entry] = normalizeTasks(
      [{ id: "T-1", files: [{ path: ".\\src\\core\\orchestrator\\conflict.ts" }], test_files: [{ path: "./test/a.test.ts" }] }],
      null,
      []
    );

    expect(entry?.files).toEqual([{ path: "src/core/orchestrator/conflict.ts", inferred: false }]);
    expect(entry?.testFiles).toEqual([{ path: "test/a.test.ts", inferred: false }]);
  });

  it("lifts the owning phase's depends_on onto the entry, which is the only route phase-dependency has", () => {
    const phases: SidecarPhase[] = [
      { id: "PH-001", depends_on: [], task_ids: ["T-PH001-01"] },
      { id: "PH-002", depends_on: ["PH-001"], task_ids: ["T-PH002-01"] }
    ];

    const catalog = normalizeTasks(
      [
        { id: "T-PH001-01", phase_id: "PH-001" },
        { id: "T-PH002-01", phase_id: "PH-002" }
      ],
      null,
      [],
      undefined,
      phases
    );

    expect(catalog[0]?.phaseDependsOn).toEqual([]);
    expect(catalog[1]?.phaseDependsOn).toEqual(["PH-001"]);
  });

  // AC-2 — the extension is parse-additive.
  it("parses a sidecar that omits every new field and yields the catalogue an existing consumer reads today", () => {
    const diagnostics: Diagnostic[] = [];
    const catalog = normalizeTasks(
      [
        { id: "T-001", phase_id: "PH-001", title: "First", depends_on_task: [], req_ids: ["FR-ARCH-001"], status: "done" },
        { task_id: "T-002", depends_on_task: ["T-001"], req_ids: ["FR-ARCH-002"] }
      ],
      null,
      diagnostics
    );

    expect(catalog.map(existingView)).toEqual([
      {
        id: "T-001",
        phase_id: "PH-001",
        title: "First",
        depends_on_task: [],
        req_ids: ["FR-ARCH-001"],
        legacyReqIds: [],
        status: "done"
      },
      {
        id: "T-002",
        depends_on_task: ["T-001"],
        req_ids: ["FR-ARCH-002"],
        legacyReqIds: [],
        status: "pending"
      }
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("defaults every new field conservatively when the sidecar omits it", () => {
    const [entry] = normalizeTasks([{ id: "T-001" }], null, []);

    expect(entry?.type).toBe("");
    expect(entry?.action).toBe("");
    expect(entry?.files).toEqual([]);
    expect(entry?.testFiles).toEqual([]);
    expect(entry?.coversAc).toEqual([]);
    expect(entry?.tdd).toBeNull();
    expect(entry?.phaseDependsOn).toEqual([]);
  });

  // AC-3 — the behaviours the existing workflow validator suite pins, preserved by the extension.
  it("preserves the legacy trace-field and missing-req-id diagnostics the existing suite asserts", () => {
    const legacy: Diagnostic[] = [];
    normalizeTasks([{ id: "T-001", traces: [{ req_id: "FR-ARCH-001" }] }], null, legacy, "docs/plans/x.sidecar.json");

    const missing: Diagnostic[] = [];
    normalizeTasks([{ id: "T-002" }], null, missing, "docs/plans/x.sidecar.json");

    expect(legacy.map((item) => item.code)).toEqual(["SRS-W061"]);
    expect(legacy[0]?.filePath).toBe("docs/plans/x.sidecar.json");
    expect(missing.map((item) => item.code)).toEqual(["SRS-W064"]);
  });

  it("prefers explicit req_ids over legacy trace ids, and falls back to the legacy ids when req_ids is absent", () => {
    const explicit = normalizeTasks(
      [{ id: "T-001", req_ids: ["FR-ARCH-001"], traces: [{ req_id: "FR-LEGACY-001" }] }],
      null,
      []
    );
    const fallback = normalizeTasks([{ id: "T-002", traces: [{ reference: "FR-LEGACY-002" }] }], null, []);

    expect(explicit[0]?.req_ids).toEqual(["FR-ARCH-001"]);
    expect(explicit[0]?.legacyReqIds).toEqual(["FR-LEGACY-001"]);
    expect(fallback[0]?.req_ids).toEqual(["FR-LEGACY-002"]);
  });

  it("takes the pm state's status over the sidecar's, and preserves sidecar declaration order", () => {
    const catalog = normalizeTasks(
      [
        { id: "T-PH001-10", title: "Declared first", status: "pending" },
        { id: "T-PH001-02", title: "Declared second", status: "pending" }
      ],
      { tasks: [{ task_id: "T-PH001-10", status: "done" }] },
      []
    );

    expect(catalog.map((entry) => [entry.id, entry.status])).toEqual([
      ["T-PH001-10", "done"],
      ["T-PH001-02", "pending"]
    ]);
  });
});
