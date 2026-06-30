import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { copyFixtureWorkspace } from "./fixture-utils.js";

export interface WorkflowFixture {
  root: string;
  runId: string;
  planPath: string;
  cyclePlanPath: string;
  blockedPlanPath: string;
  checkboxDriftPlanPath: string;
  conflictPlanPath: string;
  completePlanPath: string;
  idOrderPlanPath: string;
  invalidSidecarPlanPath: string;
  legacyTracePlanPath: string;
  missingReqIdsPlanPath: string;
  missingSidecarPlanPath: string;
  stalePlanPath: string;
  staleLockPlanPath: string;
  worklogMismatchPlanPath: string;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function plan(runId: string, target: string, sidecarPath = `./${runId}.sidecar.json`, bodyLines: string[] = ["# Workflow fixture plan"]): string {
  return [
    "---",
    `run_id: ${runId}`,
    `target: ${target}`,
    "plan_contract: \"1.2.0\"",
    "generated_at: 2026-06-29T08:05:04.654Z",
    `sidecar_path: ${sidecarPath}`,
    "---",
    ...bodyLines,
    ""
  ].join("\n");
}

function sidecar(runId: string, tasks: unknown[], target = "v1.0.0"): string {
  return JSON.stringify({ schema_version: "1.1.0", plan_contract: "1.2.0", run_id: runId, target, generated_at: "2026-06-29T08:05:04.654Z", tasks }, null, 2);
}

function event(runId: string, nextHint: string | null, taskId?: string): string {
  return JSON.stringify({
    ts: `2026-06-29T00:00:0${runId.length}.000Z`,
    schema_version: "1.0.0",
    skill: "kiwi-planner",
    run_id: runId,
    target: "v1.0.0",
    status: "TASK_DONE",
    summary: runId,
    next_hint: nextHint,
    ...(taskId ? { task_id: taskId } : {}),
    artifacts: { spec_files: [], plan_file: null, sidecar_file: null, analysis_dir: null },
    dry_run: false
  });
}

function srsBlock(index: number): string {
  const id = `FR-ARCH-${String(index + 10).padStart(3, "0")}`;
  return [
    `### ${id} — Workflow corpus requirement ${index}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "| Priority | medium |",
    "| Tags | workflow, fixture, corpus |",
    "| Risk | low |",
    "| Stability | stable |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    "The workflow fixture corpus must include a realistic generated SRS requirement.",
    "",
    "#### Rationale",
    "",
    "Agent workflow tests need enough requirement content to make compact reads meaningful.",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: The generated fixture requirement is present.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    "",
    "#### Research / Analysis",
    "",
    "- Fixture generated for REL-NODE-002.",
    "",
    "#### Implementation Notes",
    "",
    "- Generated in a temporary test workspace.",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-06-29 | Generated | Workflow fixture corpus |"
  ].join("\n");
}

async function writeSrsCorpus(root: string): Promise<void> {
  await write(root, "docs/spec/70.workflow-corpus.srs.md", ["# Workflow Corpus", "", "## 4. Requirements", "", ...Array.from({ length: 16 }, (_, index) => srsBlock(index + 1))].join("\n\n"));
}

export async function createWorkflowFixture(): Promise<WorkflowFixture> {
  const root = await copyFixtureWorkspace("valid-basic");
  await writeSrsCorpus(root);
  const runId = "workflow-run";
  const tasks = [
    { id: "T-001", phase_id: "PH-001", title: "Done task", depends_on_task: [], req_ids: ["FR-ARCH-001"] },
    { id: "T-002", phase_id: "PH-001", title: "Next task", depends_on_task: ["T-001"], req_ids: ["FR-ARCH-001"] },
    { id: "T-003", phase_id: "PH-001", title: "Later task", depends_on_task: ["T-002"], req_ids: ["FR-ARCH-001"] }
  ];
  const cycleTasks = [
    { id: "T-CYCLE-1", phase_id: "PH-002", title: "Cycle one", depends_on_task: ["T-CYCLE-2"], req_ids: ["FR-ARCH-001"] },
    { id: "T-CYCLE-2", phase_id: "PH-002", title: "Cycle two", depends_on_task: ["T-CYCLE-1"], req_ids: ["FR-ARCH-001"] }
  ];
  const blockedTasks = [
    { id: "T-BLOCK-1", phase_id: "PH-003", title: "Blocked one", depends_on_task: ["T-BLOCK-2"], req_ids: ["FR-ARCH-001"] },
    { id: "T-BLOCK-2", phase_id: "PH-003", title: "Dependency", depends_on_task: [], req_ids: ["FR-ARCH-001"] }
  ];
  const planPath = `docs/plans/${runId}.plan.md`;
  const cyclePlanPath = "docs/plans/cycle.plan.md";
  const blockedPlanPath = "docs/plans/blocked.plan.md";
  const checkboxDriftPlanPath = "docs/plans/checkbox-drift.plan.md";
  const conflictPlanPath = "docs/plans/conflict.plan.md";
  const completePlanPath = "docs/plans/complete.plan.md";
  const idOrderPlanPath = "docs/plans/id-order.plan.md";
  const invalidSidecarPlanPath = "docs/plans/invalid-sidecar.plan.md";
  const legacyTracePlanPath = "docs/plans/legacy-trace.plan.md";
  const missingReqIdsPlanPath = "docs/plans/missing-req-ids.plan.md";
  const missingSidecarPlanPath = "docs/plans/missing-sidecar.plan.md";
  const stalePlanPath = "docs/plans/stale.plan.md";
  const staleLockPlanPath = "docs/plans/stale-lock.plan.md";
  const worklogMismatchPlanPath = "docs/plans/worklog-mismatch.plan.md";
  await write(root, planPath, plan(runId, "v1.0.0"));
  await write(root, `docs/plans/${runId}.sidecar.json`, sidecar(runId, tasks));
  await write(root, cyclePlanPath, plan("cycle-run", "v1.0.0", "./cycle.sidecar.json"));
  await write(root, "docs/plans/cycle.sidecar.json", sidecar("cycle-run", cycleTasks));
  await write(root, blockedPlanPath, plan("blocked-run", "v1.0.0", "./blocked.sidecar.json"));
  await write(root, "docs/plans/blocked.sidecar.json", sidecar("blocked-run", blockedTasks));
  await write(root, "docs/plans/wrong-target.plan.md", plan("wrong-target", "v9.9.9", "./wrong-target.sidecar.json"));
  await write(root, "docs/plans/wrong-target.sidecar.json", sidecar("wrong-target", [], "v9.9.9"));
  await write(root, "docs/plan/legacy.plan.md", plan("legacy-run", "v1.0.0"));
  await write(root, ".kiwi/sessions/workflow-run/pm-state.json", JSON.stringify({ run_id: runId, target_slug: "v1.0.0", tasks: [{ task_id: "T-001", status: "done" }, { task_id: "T-002", status: "pending" }, { task_id: "T-003", status: "pending" }], stats: { done: 1, pending: 2 } }, null, 2));
  await write(root, ".kiwi/sessions/workflow-run/worklog.jsonl", `${event("worklog-a", null, "T-001")}\n${event("worklog-b", null)}\n`);
  await write(root, checkboxDriftPlanPath, plan("checkbox-drift", "v1.0.0", "./checkbox-drift.sidecar.json", ["# Checkbox drift", "", "- [ ] T-CHECK-1 Done in PM", "- [ ] T-CHECK-2 Pending"]));
  await write(root, "docs/plans/checkbox-drift.sidecar.json", sidecar("checkbox-drift", [
    { id: "T-CHECK-1", phase_id: "PH-004", title: "Checked by state", depends_on_task: [], req_ids: ["FR-ARCH-001"] },
    { id: "T-CHECK-2", phase_id: "PH-004", title: "Next after drift", depends_on_task: ["T-CHECK-1"], req_ids: ["FR-ARCH-001"] }
  ]));
  await write(root, ".kiwi/sessions/checkbox-drift/pm-state.json", JSON.stringify({ run_id: "checkbox-drift", tasks: [{ task_id: "T-CHECK-1", status: "done" }, { task_id: "T-CHECK-2", status: "pending" }] }, null, 2));
  await write(root, ".kiwi/sessions/checkbox-drift/worklog.jsonl", `${event("checkbox-drift-a", null, "T-CHECK-1")}\n`);

  await write(root, conflictPlanPath, plan("conflict-run", "v1.0.0", "./conflict.sidecar.json"));
  await write(root, "docs/plans/conflict.sidecar.json", sidecar("conflict-run", [{ id: "T-CONFLICT-1", phase_id: "PH-005", title: "Conflict", depends_on_task: [], req_ids: ["FR-ARCH-001"] }]));
  await write(root, ".kiwi/sessions/conflict-run/pm-state.json", JSON.stringify({ run_id: "conflict-run", tasks: [{ task_id: "T-CONFLICT-1", status: "done" }] }, null, 2));
  await write(root, ".kiwi/sessions/conflict-run/state.json", JSON.stringify({ run_id: "coder-conflict", plan_run_id: "conflict-run", current_task_id: "T-CONFLICT-1", completed_task_ids: [], failed_task_ids: [] }, null, 2));
  await write(root, ".kiwi/sessions/conflict-run/worklog.jsonl", `${event("conflict-a", null, "T-CONFLICT-1")}\n`);

  await write(root, completePlanPath, plan("complete-run", "v1.0.0", "./complete.sidecar.json"));
  await write(root, "docs/plans/complete.sidecar.json", sidecar("complete-run", [
    { id: "T-COMPLETE-1", phase_id: "PH-006", title: "Complete one", depends_on_task: [], req_ids: ["FR-ARCH-001"] },
    { id: "T-COMPLETE-2", phase_id: "PH-006", title: "Complete two", depends_on_task: ["T-COMPLETE-1"], req_ids: ["FR-ARCH-001"] }
  ]));
  await write(root, ".kiwi/sessions/complete-run/pm-state.json", JSON.stringify({ run_id: "complete-run", tasks: [{ task_id: "T-COMPLETE-1", status: "done" }, { task_id: "T-COMPLETE-2", status: "done" }] }, null, 2));
  await write(root, ".kiwi/sessions/complete-run/worklog.jsonl", `${event("complete-a", null, "T-COMPLETE-1")}\n${event("complete-b", null, "T-COMPLETE-2")}\n`);

  await write(root, idOrderPlanPath, plan("id-order", "v1.0.0", "./id-order.sidecar.json"));
  await write(root, "docs/plans/id-order.sidecar.json", sidecar("id-order", [
    { id: "T-PH001-10", phase_id: "PH-006", title: "Declared first", depends_on_task: [], req_ids: ["FR-ARCH-001"] },
    { id: "T-PH001-02", phase_id: "PH-006", title: "Lexically earlier", depends_on_task: [], req_ids: ["FR-ARCH-001"] }
  ]));

  await write(root, invalidSidecarPlanPath, plan("invalid-sidecar", "v1.0.0", "./invalid-sidecar.sidecar.json"));
  await write(root, "docs/plans/invalid-sidecar.sidecar.json", "{not valid json\n");

  await write(root, missingSidecarPlanPath, plan("missing-sidecar", "v1.0.0", "./missing-sidecar.sidecar.json"));

  await write(root, legacyTracePlanPath, plan("legacy-trace", "v1.0.0", "./legacy-trace.sidecar.json"));
  await write(root, "docs/plans/legacy-trace.sidecar.json", sidecar("legacy-trace", [
    { id: "T-LEGACY-1", phase_id: "PH-007", title: "Legacy trace only", depends_on_task: [], traces: [{ req_id: "FR-ARCH-001" }] },
    { id: "T-LEGACY-2", phase_id: "PH-007", title: "Both fields", depends_on_task: ["T-LEGACY-1"], req_ids: ["FR-ARCH-001"], traces: [{ req_id: "FR-ARCH-999" }] }
  ]));

  await write(root, missingReqIdsPlanPath, plan("missing-req-ids", "v1.0.0", "./missing-req-ids.sidecar.json"));
  await write(root, "docs/plans/missing-req-ids.sidecar.json", sidecar("missing-req-ids", [{ id: "T-MISSING-REQ-1", phase_id: "PH-008", title: "Missing reqs", depends_on_task: [] }]));

  await write(root, stalePlanPath, plan("stale-run", "v1.0.0", "./stale.sidecar.json"));
  await write(root, "docs/plans/stale.sidecar.json", sidecar("stale-run", [{ id: "T-STALE-1", phase_id: "PH-009", title: "Stale hash", depends_on_task: [], req_ids: ["FR-ARCH-001"] }]));
  await write(root, ".kiwi/sessions/stale-run/pm-state.json", JSON.stringify({ run_id: "stale-run", plan_sha256: "not-the-current-plan", sidecar_sha256: "not-the-current-sidecar", tasks: [{ task_id: "T-STALE-1", status: "pending" }] }, null, 2));

  await write(root, staleLockPlanPath, plan("stale-lock", "v1.0.0", "./stale-lock.sidecar.json"));
  await write(root, "docs/plans/stale-lock.sidecar.json", sidecar("stale-lock", [{ id: "T-LOCK-1", phase_id: "PH-009", title: "Stale lock", depends_on_task: [], req_ids: ["FR-ARCH-001"] }]));
  await write(root, ".kiwi/sessions/stale-lock/pm.lock", JSON.stringify({ pid: 12345, started_at: "2000-01-01T00:00:00.000Z", host: "fixture" }, null, 2));

  await write(root, worklogMismatchPlanPath, plan("worklog-mismatch", "v1.0.0", "./worklog-mismatch.sidecar.json"));
  await write(root, "docs/plans/worklog-mismatch.sidecar.json", sidecar("worklog-mismatch", [{ id: "T-WORKLOG-1", phase_id: "PH-010", title: "Missing audit event", depends_on_task: [], req_ids: ["FR-ARCH-001"] }]));
  await write(root, ".kiwi/sessions/worklog-mismatch/pm-state.json", JSON.stringify({ run_id: "worklog-mismatch", tasks: [{ task_id: "T-WORKLOG-1", status: "done" }] }, null, 2));
  await write(root, ".kiwi/sessions/worklog-mismatch/worklog.jsonl", `${event("worklog-mismatch-a", null)}\n`);

  await write(root, "kiwi/pipeline.jsonl", `${event("pipeline-a", "kiwi-planner")}\n{bad json\n${event("pipeline-b", "kiwi-pm")}\n`);
  await write(root, "docs/plans/tie-a.sidecar.json", sidecar("tie-run", []));
  await write(root, "docs/plans/tie-b.sidecar.json", sidecar("tie-run", []));
  const mtime = new Date("2026-06-29T00:00:00Z");
  await utimes(path.join(root, "docs/plans/tie-a.sidecar.json"), mtime, mtime);
  await utimes(path.join(root, "docs/plans/tie-b.sidecar.json"), mtime, mtime);
  return {
    root,
    runId,
    planPath,
    cyclePlanPath,
    blockedPlanPath,
    checkboxDriftPlanPath,
    conflictPlanPath,
    completePlanPath,
    idOrderPlanPath,
    invalidSidecarPlanPath,
    legacyTracePlanPath,
    missingReqIdsPlanPath,
    missingSidecarPlanPath,
    stalePlanPath,
    staleLockPlanPath,
    worklogMismatchPlanPath
  };
}
