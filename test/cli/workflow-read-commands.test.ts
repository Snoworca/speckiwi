import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function runJson(root: string, args: string[]): Promise<Record<string, unknown>> {
  const streams = io();
  const code = await main(["--root", root, ...args, "--json"], streams);
  expect(code).toBe(0);
  return JSON.parse(streams.stdout.read()?.toString() ?? "") as Record<string, unknown>;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function workflowEvent(runId: string, status = "TASK_DONE", extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-pm", run_id: runId, status, ...extra });
}

describe("IR-CLI-031 workflow artifact read commands", () => {
  it("exposes compact workflow reads without raw bodies by default", async () => {
    const fixture = await createWorkflowFixture();

    const workspace = await runJson(fixture.root, ["workflow", "workspace"]);
    expect(workspace).toMatchObject({ ok: true, value: { activeTarget: "v1.0.0" }, meta: { workspaceRoot: fixture.root }, diagnosticsSummary: expect.any(Object) });

    const artifacts = await runJson(fixture.root, ["workflow", "artifacts"]);
    expect(artifacts).toMatchObject({ ok: true, artifacts: expect.any(Array), cursor: { returned: expect.any(Number), total: expect.any(Number) } });
    expect(JSON.stringify(artifacts)).not.toContain("Workflow fixture plan");
    expect((artifacts.artifacts as Array<{ relativePath: string; legacy: boolean }>).some((item) => item.relativePath === "docs/plan/legacy.plan.md" && item.legacy)).toBe(true);

    const withBody = await runJson(fixture.root, ["workflow", "resolve", "--path", fixture.planPath, "--include-body"]);
    expect(JSON.stringify(withBody)).toContain("Workflow fixture plan");

    const latestPlan = await runJson(fixture.root, ["workflow", "latest", "--kind", "plan", "--run-id", fixture.runId]);
    expect(latestPlan).toMatchObject({ ok: true, value: { selected: { relativePath: fixture.planPath } } });

    const targetMatched = await runJson(fixture.root, ["workflow", "latest", "--kind", "plan", "--run-id", fixture.runId, "--target", "v1.0.0"]);
    expect(targetMatched).toMatchObject({ ok: true, value: { selected: { relativePath: fixture.planPath, target: "v1.0.0" } } });

    const planStatus = await runJson(fixture.root, ["workflow", "plan-status", "--path", fixture.planPath]);
    expect(planStatus).toMatchObject({ ok: true, value: { taskCount: 3, tasks: expect.arrayContaining([expect.objectContaining({ id: "T-002" })]) } });

    const planTask = await runJson(fixture.root, ["workflow", "plan-task", "T-002", "--path", fixture.planPath]);
    expect(planTask).toMatchObject({ ok: true, value: { task: { id: "T-002", title: "Next task" } } });

    const nextTask = await runJson(fixture.root, ["workflow", "next-task", "--path", fixture.planPath]);
    expect(nextTask).toMatchObject({ ok: true, value: { outcome: "ok", blocking: false, nextTask: { id: "T-002", status: "pending" }, blockedBy: [] } });

    const pipelineStatus = await runJson(fixture.root, ["workflow", "pipeline-status"]);
    expect(pipelineStatus).toMatchObject({ ok: true, value: { total: 2 }, diagnosticsSummary: { byCode: { "SRS-W052": 1 } } });

    const pipelineTail = await runJson(fixture.root, ["workflow", "pipeline-tail", "--limit", "1"]);
    expect(pipelineTail).toMatchObject({ ok: true, value: { events: [expect.objectContaining({ eventKey: "kiwi-planner|pipeline-a" })] }, cursor: { returned: 1, total: 2, nextOffset: 1 } });

    const nestedPipelineStatus = await runJson(fixture.root, ["workflow", "pipeline", "status"]);
    expect(nestedPipelineStatus.value).toEqual(pipelineStatus.value);

    const nestedPipelineTail = await runJson(fixture.root, ["workflow", "pipeline", "tail", "--limit", "1"]);
    expect(nestedPipelineTail.value).toEqual(pipelineTail.value);

    const pipelineCompact = await runJson(fixture.root, ["workflow", "pipeline", "compact"]);
    expect(pipelineCompact).toMatchObject({ ok: true, value: { projectionKind: "pipeline_compact", latestStatus: "TASK_DONE", total: 2 } });
    expect(JSON.stringify(pipelineCompact)).not.toContain("Workflow fixture plan");

    const pipelineNext = await runJson(fixture.root, ["workflow", "pipeline-next"]);
    expect(pipelineNext).toMatchObject({ ok: true, value: { nextHint: "kiwi-pm" } });

    const session = await runJson(fixture.root, ["workflow", "session-status", "--run-id", fixture.runId]);
    expect(session).toMatchObject({ ok: true, value: { stats: { done: 1, pending: 2 }, tasks: expect.any(Array) } });

    const resume = await runJson(fixture.root, ["workflow", "resume-hint", "--path", fixture.planPath]);
    expect(resume).toMatchObject({ ok: true, value: { resume: true, nextTask: { id: "T-002" } } });

    const worklog = await runJson(fixture.root, ["workflow", "worklog-tail", "--run-id", fixture.runId, "--limit", "1"]);
    expect(worklog).toMatchObject({ ok: true, value: { events: [expect.objectContaining({ eventKey: "kiwi-planner|worklog-a" })] } });
  });

  it("exposes read-only workflow projection aliases without raw bodies", async () => {
    const fixture = await createWorkflowFixture();

    const doctor = await runJson(fixture.root, ["workflow", "doctor", "--path", fixture.stalePlanPath]);
    expect(doctor).toMatchObject({
      ok: true,
      value: { projectionKind: "workflow_doctor", outcomeCodes: expect.arrayContaining(["stale_artifact"]), blocking: true },
      diagnosticsSummary: { byCode: { "SRS-W059": 2 } }
    });
    expect(JSON.stringify(doctor)).not.toContain("Workflow fixture plan");

    const diff = await runJson(fixture.root, ["workflow", "diff", "--path", fixture.checkboxDriftPlanPath]);
    expect(diff).toMatchObject({
      value: {
        projectionKind: "workflow_diff",
        outcomeCodes: expect.arrayContaining(["repairable_drift"]),
        diffs: expect.arrayContaining([expect.objectContaining({ class: "display_drift", code: "SRS-W060" })])
      }
    });

    const schema = await runJson(fixture.root, ["workflow", "schema-check", "--path", fixture.invalidSidecarPlanPath]);
    expect(schema).toMatchObject({ value: { projectionKind: "workflow_schema_check", outcomeCodes: expect.arrayContaining(["invalid_artifact"]), blocking: true } });
  });

  it("reports ambiguous artifacts and dependency cycles instead of guessing next work", async () => {
    const fixture = await createWorkflowFixture();

    const ambiguous = await runJson(fixture.root, ["workflow", "artifacts", "--kind", "sidecar", "--run-id", "tie-run"]);
    expect(ambiguous).toMatchObject({ ok: true, value: { selected: null }, diagnosticsSummary: { byCode: { "SRS-E051": 1 } } });

    const idOrder = await runJson(fixture.root, ["workflow", "next-task", "--path", fixture.idOrderPlanPath]);
    expect(idOrder).toMatchObject({ ok: true, value: { outcome: "ok", nextTask: { id: "T-PH001-10" } } });

    const blocked = await runJson(fixture.root, ["workflow", "next-task", "--path", fixture.blockedPlanPath]);
    expect(blocked).toMatchObject({ ok: true, value: { outcome: "blocked_dependency", blocking: true, nextTask: null, blockedBy: ["T-BLOCK-2"], blockedTask: { id: "T-BLOCK-1" } } });

    const cycle = await runJson(fixture.root, ["workflow", "next-task", "--path", fixture.cyclePlanPath]);
    expect(cycle).toMatchObject({
      ok: true,
      value: { outcome: "invalid_artifact", blocking: true, nextTask: null, dependencyIssues: expect.arrayContaining([expect.objectContaining({ issue: "dependency_cycle" })]) },
      diagnosticsSummary: { byCode: { "SRS-W057": expect.any(Number) } }
    });

    const stale = await runJson(fixture.root, ["workflow", "resume-hint", "--path", fixture.stalePlanPath]);
    expect(stale).toMatchObject({ ok: true, value: { resume: false, outcome: "stale_artifact", blocking: true, nextTask: null }, diagnosticsSummary: { byCode: { "SRS-W059": 2 } } });
  });

  it("treats logically deleted pipeline events as inactive unless include-deleted is requested", async () => {
    const fixture = await createWorkflowFixture();
    await write(
      fixture.root,
      "kiwi/pipeline.jsonl",
      [
        workflowEvent("pipeline-a"),
        workflowEvent("delete-pipeline-a", "CORRECTION", { corrects_run_id: "pipeline-a", operation: { kind: "logical_delete", reason: "obsolete" } })
      ].join("\n") + "\n"
    );

    const status = await runJson(fixture.root, ["workflow", "pipeline-status"]);
    expect(status).toMatchObject({ ok: true, value: { latestEvent: null, total: 2 } });

    const includeDeleted = await runJson(fixture.root, ["workflow", "pipeline-status", "--include-deleted"]);
    expect(includeDeleted).toMatchObject({ ok: true, value: { latestEvent: { event: { run_id: "delete-pipeline-a", status: "CORRECTION" } } } });
  });
});
