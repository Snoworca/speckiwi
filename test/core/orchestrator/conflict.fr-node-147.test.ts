import { describe, expect, it } from "vitest";
import { computeLanePlan, type LanePlan } from "../../../src/core/orchestrator/lane-plan.js";
import {
  CONFLICT_REASONS,
  RECIPE_KINDS,
  analyzeConflicts,
  matchesGlob,
  resolveRecipeKind,
  type ConflictConstraints,
  type ConflictEdge,
  type ConflictReason,
  type ConvergencePoint,
  type PriorPostmortemRow
} from "../../../src/core/orchestrator/conflict.js";
import { normalizeTasks, type SidecarPhase, type SidecarTask } from "../../../src/core/orchestrator/task-catalog.js";
import { laneInput } from "./lane-plan-fixtures.js";

const DEFAULT_CONSTRAINTS: ConflictConstraints = {
  codeRoots: ["src/**"],
  testRoots: ["test/**"],
  existingPaths: []
};

function catalog(tasks: SidecarTask[], phases?: SidecarPhase[]) {
  return normalizeTasks(tasks, null, [], undefined, phases);
}

/** A `type: code` task inside the default roots, so nothing but the rule under test fires. */
function codeTask(id: string, extra: Partial<SidecarTask> = {}): SidecarTask {
  return { id, type: "code", action: "", files: [{ path: `src/${id}.ts` }], ...extra };
}

function reasons(edges: ConflictEdge[]): ConflictReason[] {
  return [...new Set(edges.map((edge) => edge.reason))].sort();
}

function edgesFor(edges: ConflictEdge[], reason: ConflictReason): ConflictEdge[] {
  return edges.filter((edge) => edge.reason === reason);
}

describe("FR-NODE-147 the closed conflict_reason enum", () => {
  // AC-1
  it("declares exactly five arguments", () => {
    expect(analyzeConflicts).toHaveLength(5);
  });

  it("derives learned-coupling only from the fourth argument", () => {
    const tasks = catalog([codeTask("T-A"), codeTask("T-B")]);
    const row: PriorPostmortemRow = {
      fromTask: "T-A",
      toTask: "T-B",
      path: "src/T-A.ts",
      detectedAt: "2026-07-01T00:00:00Z",
      resolution: "merge-into-one-lane"
    };

    const without = analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS);
    const with_ = analyzeConflicts(tasks, [], [], [row], DEFAULT_CONSTRAINTS);

    expect(reasons(without)).not.toContain("learned-coupling");
    expect(edgesFor(with_, "learned-coupling")).toEqual([{ a: "T-A", b: "T-B", reason: "learned-coupling" }]);
  });

  it("derives non-code-write-set only from the fifth argument", () => {
    const tasks = catalog([{ id: "T-A", type: "code", files: [{ path: "tools/build.ts" }] }]);

    const outside = analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS);
    const inside = analyzeConflicts(tasks, [], [], [], { codeRoots: ["src/**", "tools/**"], testRoots: ["test/**"], existingPaths: [] });

    expect(edgesFor(outside, "non-code-write-set")).toEqual([{ a: "T-A", reason: "non-code-write-set" }]);
    expect(reasons(inside)).not.toContain("non-code-write-set");
  });

  // AC-2 — every enum member is produced by an input the declared types admit.
  it("declares eleven conflict reasons and reaches every one of them", () => {
    expect([...CONFLICT_REASONS]).toHaveLength(11);

    const phases: SidecarPhase[] = [
      { id: "PH-001", depends_on: [], task_ids: ["T-DEP"] },
      { id: "PH-002", depends_on: ["PH-001"], task_ids: ["T-PHASE"] }
    ];
    const tasks = catalog(
      [
        codeTask("T-DEP", { phase_id: "PH-001" }),
        codeTask("T-PHASE", { phase_id: "PH-002", depends_on_task: ["T-DEP"] }),
        codeTask("T-OVERLAP-A", { files: [{ path: "src/shared.ts" }] }),
        codeTask("T-OVERLAP-B", { files: [{ path: "src/shared.ts" }] }),
        codeTask("T-RED", { covers_ac: ["AC-1"], tdd: { applicable: true, phase: "red" } }),
        codeTask("T-GREEN", { covers_ac: ["AC-1"], tdd: { applicable: true, phase: "green" } }),
        codeTask("T-REQ-A", { req_ids: ["FR-NODE-145"] }),
        codeTask("T-REQ-B", { req_ids: ["FR-NODE-145"] }),
        codeTask("T-CONVERGE", { files: [{ path: "docs/spec/00.index.md" }] }),
        codeTask("T-BARRIER", { action: "Rename src/core/workflow/validate.ts and update its callers" }),
        codeTask("T-UNKNOWN", { files: [] }),
        codeTask("T-SRS", { action: "call add_requirement for the new scope" }),
        { id: "T-NONCODE", type: "infra", files: [{ path: "vitest.config.ts" }] },
        codeTask("T-LEARNED-A"),
        codeTask("T-LEARNED-B")
      ],
      phases
    );
    const registry: ConvergencePoint[] = [
      { id: "CP-02", paths: ["docs/spec/**"], recipe: { kind: "orchestrator-only" } }
    ];
    const postmortems: PriorPostmortemRow[] = [
      {
        fromTask: "T-LEARNED-A",
        toTask: "T-LEARNED-B",
        path: "src/T-LEARNED-A.ts",
        detectedAt: "2026-07-01T00:00:00Z",
        resolution: "merge-into-one-lane"
      }
    ];

    const edges = analyzeConflicts(tasks, registry, ["src/core/workflow/validate.ts"], postmortems, DEFAULT_CONSTRAINTS);

    expect(reasons(edges).sort()).toEqual([...CONFLICT_REASONS].sort());
  });

  it("produces the task-dependency edge over the transitive closure, not only direct dependencies", () => {
    const tasks = catalog([
      codeTask("T-A"),
      codeTask("T-B", { depends_on_task: ["T-A"] }),
      codeTask("T-C", { depends_on_task: ["T-B"] })
    ]);

    const edges = edgesFor(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS), "task-dependency");

    expect(edges).toEqual([
      { a: "T-B", b: "T-A", reason: "task-dependency" },
      { a: "T-C", b: "T-A", reason: "task-dependency" },
      { a: "T-C", b: "T-B", reason: "task-dependency" }
    ]);
  });

  it("lifts a phase depends_on to an edge between every task of the two phases", () => {
    const phases: SidecarPhase[] = [
      { id: "PH-001", depends_on: [], task_ids: ["T-1", "T-2"] },
      { id: "PH-002", depends_on: ["PH-001"], task_ids: ["T-3"] }
    ];
    const tasks = catalog(
      [codeTask("T-1", { phase_id: "PH-001" }), codeTask("T-2", { phase_id: "PH-001" }), codeTask("T-3", { phase_id: "PH-002" })],
      phases
    );

    const edges = edgesFor(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS), "phase-dependency");

    expect(edges).toEqual([
      { a: "T-3", b: "T-1", reason: "phase-dependency" },
      { a: "T-3", b: "T-2", reason: "phase-dependency" }
    ]);
  });

  it("pairs a red task with a green task over the same covers_ac and does not pair two reds", () => {
    const paired = catalog([
      codeTask("T-RED", { covers_ac: ["AC-1"], tdd: { applicable: true, phase: "red" } }),
      codeTask("T-GREEN", { covers_ac: ["AC-1"], tdd: { applicable: true, phase: "green" } })
    ]);
    const unpaired = catalog([
      codeTask("T-RED-1", { covers_ac: ["AC-1"], tdd: { applicable: true, phase: "red" } }),
      codeTask("T-RED-2", { covers_ac: ["AC-1"], tdd: { applicable: true, phase: "red" } })
    ]);

    expect(edgesFor(analyzeConflicts(paired, [], [], [], DEFAULT_CONSTRAINTS), "tdd-pair")).toEqual([
      { a: "T-GREEN", b: "T-RED", reason: "tdd-pair" }
    ]);
    expect(reasons(analyzeConflicts(unpaired, [], [], [], DEFAULT_CONSTRAINTS))).not.toContain("tdd-pair");
  });

  it("treats a declared test file as part of the write set for the overlap rule", () => {
    const tasks = catalog([
      codeTask("T-A", { files: [{ path: "src/a.ts" }], test_files: [{ path: "test/shared.test.ts" }] }),
      codeTask("T-B", { files: [{ path: "src/b.ts" }], test_files: [{ path: "test/shared.test.ts" }] })
    ]);

    expect(edgesFor(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS), "write-set-overlap")).toEqual([
      { a: "T-A", b: "T-B", reason: "write-set-overlap" }
    ]);
  });

  it("applies the prefix-directory clause of write-set-overlap only to a directory the existing-paths input carries", () => {
    const tasks = catalog([
      codeTask("T-DIR", { files: [{ path: "src/core/orchestrator" }] }),
      codeTask("T-FILE", { files: [{ path: "src/core/orchestrator/conflict.ts" }] })
    ]);

    const absent = analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS);
    const present = analyzeConflicts(tasks, [], [], [], { ...DEFAULT_CONSTRAINTS, existingPaths: ["src/core/orchestrator"] });

    expect(reasons(absent)).not.toContain("write-set-overlap");
    expect(edgesFor(present, "write-set-overlap")).toEqual([
      { a: "T-DIR", b: "T-FILE", reason: "write-set-overlap" }
    ]);
  });

  it("ignores a postmortem row resolved re-planned or accepted, and falls back to path when the task ids are gone", () => {
    const tasks = catalog([
      codeTask("T-NOW-A", { files: [{ path: "src/coupled.ts" }] }),
      codeTask("T-NOW-B", { files: [{ path: "src/coupled.ts" }], test_files: [{ path: "test/b.test.ts" }] })
    ]);
    const base = { path: "src/coupled.ts", detectedAt: "2026-07-01T00:00:00Z" };

    const replanned = analyzeConflicts(
      tasks,
      [],
      [],
      [{ ...base, fromTask: "T-NOW-A", toTask: "T-NOW-B", resolution: "re-planned" }],
      DEFAULT_CONSTRAINTS
    );
    const accepted = analyzeConflicts(
      tasks,
      [],
      [],
      [{ ...base, fromTask: "T-NOW-A", toTask: "T-NOW-B", resolution: "accepted" }],
      DEFAULT_CONSTRAINTS
    );
    const stale = analyzeConflicts(
      tasks,
      [],
      [],
      [{ ...base, fromTask: "T-GONE-1", toTask: "T-GONE-2", resolution: "merge-into-one-lane" }],
      DEFAULT_CONSTRAINTS
    );

    expect(reasons(replanned)).not.toContain("learned-coupling");
    expect(reasons(accepted)).not.toContain("learned-coupling");
    expect(edgesFor(stale, "learned-coupling")).toEqual([
      { a: "T-NOW-A", b: "T-NOW-B", reason: "learned-coupling" }
    ]);
  });

  // AC-3 / AC-4 — the recipe-kind rule and its precedence order.
  it("declares four recipe kinds and reaches every one of them from a registry match", () => {
    expect([...RECIPE_KINDS]).toEqual(["orchestrator-only", "replay", "regenerate", "exclusive-lane"]);

    const tasks = catalog([
      codeTask("T-EXCL-A", { files: [{ path: "src/generated/unit.ts" }] }),
      codeTask("T-EXCL-B", { files: [{ path: "src/generated/unit.ts" }], test_files: [{ path: "test/unit.test.ts" }] }),
      codeTask("T-ORCH", { files: [{ path: "docs/spec/00.index.md" }] }),
      codeTask("T-REGEN", { files: [{ path: "src/generated/index.json" }] }),
      codeTask("T-REPLAY", { files: [{ path: "src/replayed/queue.ts" }] })
    ]);
    const registry: ConvergencePoint[] = [
      { id: "CP-EXCL", paths: ["src/generated/unit.ts"], recipe: { kind: "exclusive-lane" } },
      { id: "CP-ORCH", paths: ["docs/spec/**"], recipe: { kind: "orchestrator-only" } },
      { id: "CP-REGEN", paths: ["src/generated/*.json"], recipe: { kind: "regenerate" } },
      { id: "CP-REPLAY", paths: ["src/replayed/**"], recipe: { kind: "replay" } }
    ];

    const edges = edgesFor(analyzeConflicts(tasks, registry, [], [], DEFAULT_CONSTRAINTS), "convergence-point");

    // exclusive-lane is same-lane and binary; the other three are unary serial-epilogue assignments.
    expect(edges).toEqual([
      { a: "T-EXCL-A", b: "T-EXCL-B", reason: "convergence-point", pointId: "CP-EXCL", recipeKind: "exclusive-lane" },
      { a: "T-ORCH", reason: "convergence-point", pointId: "CP-ORCH", recipeKind: "orchestrator-only" },
      { a: "T-REGEN", reason: "convergence-point", pointId: "CP-REGEN", recipeKind: "regenerate" },
      { a: "T-REPLAY", reason: "convergence-point", pointId: "CP-REPLAY", recipeKind: "replay" }
    ]);
  });

  it("resolves a path matching two points to the most restrictive kind under the stated order", () => {
    expect(resolveRecipeKind(["regenerate", "orchestrator-only"])).toBe("orchestrator-only");
    expect(resolveRecipeKind(["exclusive-lane", "regenerate"])).toBe("regenerate");
    expect(resolveRecipeKind(["exclusive-lane", "replay"])).toBe("replay");
    expect(resolveRecipeKind(["replay", "orchestrator-only"])).toBe("orchestrator-only");
    expect(resolveRecipeKind(["exclusive-lane"])).toBe("exclusive-lane");

    const tasks = catalog([codeTask("T-INDEX", { files: [{ path: "docs/spec/00.index.md" }] })]);
    const registry: ConvergencePoint[] = [
      { id: "CP-01", paths: ["docs/spec/00.index.md"], recipe: { kind: "regenerate" } },
      { id: "CP-02", paths: ["docs/spec/**"], recipe: { kind: "orchestrator-only" } }
    ];

    expect(edgesFor(analyzeConflicts(tasks, registry, [], [], DEFAULT_CONSTRAINTS), "convergence-point")).toEqual([
      { a: "T-INDEX", reason: "convergence-point", pointId: "CP-02", recipeKind: "orchestrator-only" }
    ]);
  });

  it("matches registry globs with ** crossing segments and * confined to one", () => {
    expect(matchesGlob("docs/spec/00.index.md", "docs/spec/**")).toBe(true);
    expect(matchesGlob("docs/spec/a/b.md", "docs/spec/**")).toBe(true);
    expect(matchesGlob("docs/spec", "docs/spec/**")).toBe(true);
    expect(matchesGlob("docs/specification/a.md", "docs/spec/**")).toBe(false);
    expect(matchesGlob("src/cli/commands/read.ts", "src/cli/commands/*.ts")).toBe(true);
    expect(matchesGlob("src/cli/commands/sub/read.ts", "src/cli/commands/*.ts")).toBe(false);
    expect(matchesGlob("src/cli/commands/read.ts", "src/cli/commands/read.ts")).toBe(true);
    expect(matchesGlob("src/cli/commands/read.tsx", "src/cli/commands/read.ts")).toBe(false);
  });

  // AC-5 — the module-barrier lexical predicate, both its firing forms and its declared false negative.
  it("fires module-barrier for an action naming an existing module by full path and again by basename", () => {
    const existingModules = ["src/core/workflow/validate.ts"];
    const byPath = catalog([codeTask("T-A", { action: "Move src/core/workflow/validate.ts under orchestrator/" })]);
    const byBasename = catalog([codeTask("T-B", { action: "Change the SIGNATURE exported from validate.ts" })]);

    expect(edgesFor(analyzeConflicts(byPath, [], existingModules, [], DEFAULT_CONSTRAINTS), "module-barrier")).toEqual([
      { a: "T-A", reason: "module-barrier" }
    ]);
    expect(edgesFor(analyzeConflicts(byBasename, [], existingModules, [], DEFAULT_CONSTRAINTS), "module-barrier")).toEqual([
      { a: "T-B", reason: "module-barrier" }
    ]);
  });

  it("does not fire module-barrier when the action omits a marker, which is declared behaviour rather than completeness", () => {
    const existingModules = ["src/core/workflow/validate.ts"];
    const tasks = catalog([codeTask("T-A", { action: "Add a field to src/core/workflow/validate.ts" })]);

    expect(reasons(analyzeConflicts(tasks, [], existingModules, [], DEFAULT_CONSTRAINTS))).not.toContain("module-barrier");
  });

  it("does not fire module-barrier for a marker with no existing-module mention", () => {
    const tasks = catalog([codeTask("T-A", { action: "Rename a local variable inside this new file" })]);

    expect(reasons(analyzeConflicts(tasks, [], ["src/core/workflow/validate.ts"], [], DEFAULT_CONSTRAINTS))).not.toContain(
      "module-barrier"
    );
  });

  // AC-6 — the srs-write lexical predicate against the four inline coder calls.
  it("fires srs-write for a mutation verb outside kiwi-coder's four inline calls", () => {
    for (const verb of [
      "add_requirement",
      "edit_requirement_fields",
      "replace_acceptance_criteria",
      "edit_requirement_table_rows",
      "supersede_requirement",
      "update_stability",
      "register_scopes",
      "scaffold_scope",
      "append_section_note",
      "promote_step_requirement",
      "synthesize_step_srs"
    ]) {
      const tasks = catalog([codeTask("T-A", { action: `Then call ${verb} on the target` })]);
      expect(edgesFor(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS), "srs-write")).toEqual([
        { a: "T-A", reason: "srs-write" }
      ]);
    }
  });

  it("does not fire srs-write for an action naming only the four calls the coder already makes inline", () => {
    const tasks = catalog([
      codeTask("T-A", {
        action: "call add_trace_link, add_verification_evidence, update_status and add_completed_work as usual"
      })
    ]);

    expect(reasons(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS))).not.toContain("srs-write");
  });

  // AC-7 — charter C1's first clause, both of its disjuncts and the lane-eligible case.
  it("routes a task whose type is outside code and perf_test to the serial epilogue", () => {
    for (const type of ["doc", "file_op", "issue", "pr", "review", "infra"]) {
      const tasks = catalog([{ id: "T-A", type, files: [{ path: "src/a.ts" }] }]);
      expect(edgesFor(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS), "non-code-write-set")).toEqual([
        { a: "T-A", reason: "non-code-write-set" }
      ]);
    }
  });

  it("routes a task whose declared test file falls outside the declared roots", () => {
    const tasks = catalog([codeTask("T-A", { files: [{ path: "src/a.ts" }], test_files: [{ path: "scripts/smoke.mjs" }] })]);

    expect(edgesFor(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS), "non-code-write-set")).toEqual([
      { a: "T-A", reason: "non-code-write-set" }
    ]);
  });

  it("leaves a code or perf_test task inside the roots lane-eligible", () => {
    for (const type of ["code", "perf_test"]) {
      const tasks = catalog([{ id: "T-A", type, files: [{ path: "src/a.ts" }], test_files: [{ path: "test/a.test.ts" }] }]);
      expect(reasons(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS))).toEqual([]);
    }
  });

  // AC-8
  it("raises unknown-write-set for an empty files list and for an inferred entry", () => {
    const empty = catalog([{ id: "T-A", type: "code", files: [] }]);
    const inferred = catalog([{ id: "T-B", type: "code", files: [{ path: "src/[INFERRED:high] guess.ts" }] }]);

    expect(edgesFor(analyzeConflicts(empty, [], [], [], DEFAULT_CONSTRAINTS), "unknown-write-set")).toEqual([
      { a: "T-A", reason: "unknown-write-set" }
    ]);
    expect(edgesFor(analyzeConflicts(inferred, [], [], [], DEFAULT_CONSTRAINTS), "unknown-write-set")).toEqual([
      { a: "T-B", reason: "unknown-write-set" }
    ]);
  });

  it("returns byte-identical edges for two calls over the same inputs, whatever order the tasks arrive in", () => {
    const tasks = catalog([
      codeTask("T-C", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-1"] }),
      codeTask("T-A", { files: [{ path: "src/shared.ts" }], req_ids: ["FR-1"] }),
      codeTask("T-B", { depends_on_task: ["T-A"] })
    ]);

    const first = JSON.stringify(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS));
    const second = JSON.stringify(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS));

    // Edges are grouped by the enum's own order, then by `a`, then by `b`.
    expect(first).toBe(second);
    expect(JSON.parse(first)).toEqual([
      { a: "T-B", b: "T-A", reason: "task-dependency" },
      { a: "T-A", b: "T-C", reason: "write-set-overlap" },
      { a: "T-A", b: "T-C", reason: "req-shared" }
    ]);
  });

  it("reads nothing from the filesystem: a real repository path absent from existingPaths gets no prefix treatment", () => {
    const tasks = catalog([
      codeTask("T-DIR", { files: [{ path: "src/core" }] }),
      codeTask("T-FILE", { files: [{ path: "src/core/types.ts" }] })
    ]);

    expect(reasons(analyzeConflicts(tasks, [], [], [], DEFAULT_CONSTRAINTS))).not.toContain("write-set-overlap");
  });
});

// AC-3's assignment half. The edges above say what the classifier found; only the plan says where a
// task went, and `exclusive-lane` is the member an earlier partitioner left dead precisely because
// the edge existed and the assignment did not follow it.
describe("FR-NODE-147 AC-3 the four recipe kinds reach their declared assignments", () => {
  const registry: ConvergencePoint[] = [
    { id: "CP-EXCL", paths: ["src/generated/**"], recipe: { kind: "exclusive-lane" } },
    { id: "CP-ORCH", paths: ["docs/spec/**"], recipe: { kind: "orchestrator-only" } },
    { id: "CP-REGEN", paths: ["src/regen/**"], recipe: { kind: "regenerate" } },
    { id: "CP-REPLAY", paths: ["src/replayed/**"], recipe: { kind: "replay" } }
  ];

  function lanesOwning(plan: LanePlan, taskIds: readonly string[]): string[] {
    return [...new Set(plan.lanes.filter((lane) => lane.taskIds.some((id) => taskIds.includes(id))).map((l) => l.laneId))];
  }

  it("places every task touching an exclusive-lane unit in one lane, and no other lane owns it", () => {
    const unitTasks = ["T-EXCL-A", "T-EXCL-B", "T-EXCL-C"];
    const tasks = catalog([
      codeTask("T-EXCL-A", { files: [{ path: "src/generated/a.ts" }] }),
      codeTask("T-EXCL-B", { files: [{ path: "src/generated/b.ts" }] }),
      codeTask("T-EXCL-C", { files: [{ path: "src/generated/c.ts" }] }),
      codeTask("T-OTHER", { files: [{ path: "src/unrelated.ts" }] }),
      codeTask("T-OTHER-NEXT", { depends_on_task: ["T-OTHER"] })
    ]);

    const plan = computeLanePlan(laneInput(tasks, { registry }));
    const owning = lanesOwning(plan, unitTasks);

    expect(owning).toHaveLength(1);
    const lane = plan.lanes.find((candidate) => candidate.laneId === owning[0]);
    expect(lane?.taskIds).toEqual(unitTasks);
    expect(plan.serialEpilogue).not.toContain("T-EXCL-A");
    // The unit's lane is a different lane from the unrelated work, so "one lane owns it" is a
    // constraint the fixture could have violated rather than one it cannot express.
    expect(owning[0]).not.toBe(lanesOwning(plan, ["T-OTHER"])[0]);
  });

  it("sends orchestrator-only, regenerate and replay matches to the serial epilogue", () => {
    const tasks = catalog([
      codeTask("T-ORCH", { files: [{ path: "docs/spec/00.index.md" }] }),
      codeTask("T-REGEN", { files: [{ path: "src/regen/index.ts" }] }),
      codeTask("T-REPLAY", { files: [{ path: "src/replayed/queue.ts" }] })
    ]);

    const plan = computeLanePlan(laneInput(tasks, { registry }));

    expect(plan.serialEpilogue).toEqual(["T-ORCH", "T-REGEN", "T-REPLAY"]);
    expect(plan.lanes).toHaveLength(0);
  });

  // The single-task fold and `exclusive-lane` lane-eligibility interact, and the interaction is
  // stated rather than hidden: §5.3's fold has no exemption for a registry-owned unit, so a unit
  // touched by exactly one task that nothing depends on produces no lane at all. Uniqueness is not
  // violated — zero lanes own it and the epilogue is serial — but a fixture asserting AC-3's
  // lane-eligible assignment must use a unit that is not single-and-dependentless.
  it("folds a single-task exclusive-lane unit that nothing depends on into the serial epilogue", () => {
    const alone = catalog([codeTask("T-ONLY", { files: [{ path: "src/generated/only.ts" }] })]);
    const withDependent = catalog([
      codeTask("T-ONLY", { files: [{ path: "src/generated/only.ts" }] }),
      codeTask("T-ONLY-NEXT", { depends_on_task: ["T-ONLY"] })
    ]);

    const foldedPlan = computeLanePlan(laneInput(alone, { registry }));
    const lanedPlan = computeLanePlan(laneInput(withDependent, { registry }));

    expect(foldedPlan.lanes).toHaveLength(0);
    expect(foldedPlan.serialEpilogue).toEqual(["T-ONLY"]);
    expect(lanedPlan.lanes.map((lane) => lane.taskIds)).toEqual([["T-ONLY"]]);
    expect(lanedPlan.serialEpilogue).toEqual(["T-ONLY-NEXT"]);
  });
});

// The vocabulary this module owns is registered on `journal-schema.ts` by import, not by
// restatement. `journal-schema.ts`'s own comment on `REASON_CLASSES` records why: that one was
// restated, drifted to six values against the shipped contract's eight, and the two the
// orchestrator's own stops write were being diagnosed as invalid. `CONFLICT_REASONS` and
// `RECIPE_KINDS` were the two left restated, and both had drifted the same way — the copy carried
// ten reasons against eleven here, and the recipe order, which `resolveRecipeKind` ranks on, was
// different. Identity by `toBe`, because `toEqual` accepts a restated literal and that is the
// failure being closed.
describe("FR-NODE-147 — the conflict vocabularies are registered by import, not restated", () => {
  it("journal-schema registers this module's CONFLICT_REASONS array itself", async () => {
    const journalSchema = await import("../../../src/core/orchestrator/journal-schema.js");
    expect(journalSchema.CONFLICT_REASONS).toBe(CONFLICT_REASONS);
  });

  it("journal-schema registers this module's RECIPE_KINDS array itself, order included", async () => {
    const journalSchema = await import("../../../src/core/orchestrator/journal-schema.js");
    expect(journalSchema.RECIPE_KINDS).toBe(RECIPE_KINDS);
  });
});
