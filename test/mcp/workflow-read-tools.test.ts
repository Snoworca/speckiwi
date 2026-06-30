import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function runCliJson(root: string, args: string[]): Promise<Record<string, unknown>> {
  const streams = io();
  expect(await main(["--root", root, ...args, "--json"], streams)).toBe(0);
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

describe("FR-MCP-023 workflow artifact read tools", () => {
  it("registers read-only workflow tools with compact diagnostics-preserving envelopes", async () => {
    const fixture = await createWorkflowFixture();
    const server = createTestMcpServer({ root: fixture.root });
    registerReadTools(server, { root: fixture.root });

    const expectedTools = [
      "workflow_workspace_info",
      "workflow_artifacts_list",
      "workflow_latest_artifact",
      "workflow_resolve_artifact",
      "workflow_plan_status",
      "workflow_plan_task",
      "workflow_next_plan_task",
      "workflow_doctor",
      "workflow_diff",
      "workflow_schema_check",
      "workflow_pipeline_status",
      "workflow_pipeline_tail",
      "workflow_pipeline_next",
      "workflow_pipeline_compact",
      "workflow_session_status",
      "workflow_resume_hint",
      "workflow_worklog_tail",
      "preview_legacy_workflow_migration"
    ];
    for (const name of expectedTools) {
      expect(server.tools[name], `${name} should be registered`).toBeDefined();
      expect(toolSchemas[name], `${name} should expose an MCP schema`).toBeDefined();
      expect(isReadOnlyTool(name), `${name} should be read-only`).toBe(true);
    }

    await expect(server.callTool("workflow_workspace_info", {})).resolves.toMatchObject({ ok: true, value: { activeTarget: "v1.0.0" }, diagnostics: expect.any(Array), diagnosticsSummary: expect.any(Object) });
    const artifactList = (await server.callTool("workflow_artifacts_list", {})) as { artifacts: Array<{ relativePath: string; legacy: boolean }> };
    expect(artifactList).toMatchObject({ ok: true, value: { artifacts: expect.any(Array) }, artifacts: expect.any(Array), cursor: expect.any(Object) });
    expect(artifactList.artifacts.some((item) => item.relativePath === "docs/plan/legacy.plan.md" && item.legacy)).toBe(true);
    await expect(server.callTool("workflow_latest_artifact", { kind: "plan", runId: fixture.runId })).resolves.toMatchObject({ ok: true, value: { selected: { relativePath: fixture.planPath } } });
    await expect(server.callTool("workflow_resolve_artifact", { path: fixture.planPath })).resolves.toMatchObject({ ok: true, value: { selected: { relativePath: fixture.planPath } } });
    await expect(server.callTool("workflow_plan_status", { path: fixture.planPath })).resolves.toMatchObject({ ok: true, value: { taskCount: 3 } });
    await expect(server.callTool("workflow_plan_task", { path: fixture.planPath, taskId: "T-002" })).resolves.toMatchObject({ ok: true, value: { task: { id: "T-002" } } });
    await expect(server.callTool("workflow_next_plan_task", { path: fixture.planPath })).resolves.toMatchObject({ ok: true, value: { outcome: "ok", blocking: false, nextTask: { id: "T-002" } } });
    await expect(server.callTool("workflow_doctor", { path: fixture.stalePlanPath })).resolves.toMatchObject({
      ok: true,
      value: { projectionKind: "workflow_doctor", outcomeCodes: expect.arrayContaining(["stale_artifact"]), blocking: true }
    });
    await expect(server.callTool("workflow_diff", { path: fixture.checkboxDriftPlanPath })).resolves.toMatchObject({
      ok: true,
      value: { projectionKind: "workflow_diff", diffs: expect.arrayContaining([expect.objectContaining({ class: "display_drift" })]) }
    });
    await expect(server.callTool("workflow_schema_check", { path: fixture.invalidSidecarPlanPath })).resolves.toMatchObject({
      ok: true,
      value: { projectionKind: "workflow_schema_check", outcomeCodes: expect.arrayContaining(["invalid_artifact"]), blocking: true }
    });
    await expect(server.callTool("workflow_pipeline_status", {})).resolves.toMatchObject({ ok: true, value: { total: 2 }, diagnosticsSummary: { byCode: { "SRS-W052": 1 } } });
    await expect(server.callTool("workflow_pipeline_tail", { limit: 1 })).resolves.toMatchObject({ ok: true, value: { events: [expect.objectContaining({ eventKey: "kiwi-planner|pipeline-a" })] }, cursor: { nextOffset: 1 } });
    await expect(server.callTool("workflow_pipeline_next", {})).resolves.toMatchObject({ ok: true, value: { nextHint: "kiwi-pm" } });
    await expect(server.callTool("workflow_pipeline_compact", {})).resolves.toMatchObject({ ok: true, value: { projectionKind: "pipeline_compact", latestStatus: "TASK_DONE", total: 2 } });
    await expect(server.callTool("workflow_session_status", { runId: fixture.runId })).resolves.toMatchObject({ ok: true, value: { stats: { done: 1, pending: 2 } } });
    await expect(server.callTool("workflow_resume_hint", { path: fixture.planPath })).resolves.toMatchObject({ ok: true, value: { resume: true, nextTask: { id: "T-002" } } });
    await expect(server.callTool("workflow_worklog_tail", { runId: fixture.runId, limit: 1 })).resolves.toMatchObject({ ok: true, value: { events: [expect.objectContaining({ eventKey: "kiwi-planner|worklog-a" })] } });
  });

  it("matches CLI workflow values for invalid JSONL, ambiguity, and dependency-blocked fixtures", async () => {
    const fixture = await createWorkflowFixture();
    const server = createTestMcpServer({ root: fixture.root });
    registerReadTools(server, { root: fixture.root });

    const cliTail = await runCliJson(fixture.root, ["workflow", "pipeline-tail", "--limit", "1"]);
    const mcpTail = (await server.callTool("workflow_pipeline_tail", { limit: 1 })) as Record<string, unknown>;
    expect(mcpTail).toMatchObject({
      value: cliTail.value,
      cursor: cliTail.cursor,
      diagnosticsSummary: cliTail.diagnosticsSummary
    });

    const cliAmbiguous = await runCliJson(fixture.root, ["workflow", "artifacts", "--kind", "sidecar", "--run-id", "tie-run"]);
    const mcpAmbiguous = (await server.callTool("workflow_artifacts_list", { kind: "sidecar", runId: "tie-run" })) as Record<string, unknown>;
    expect(mcpAmbiguous).toMatchObject({ value: { selected: null }, diagnosticsSummary: cliAmbiguous.diagnosticsSummary });

    const cliBlocked = await runCliJson(fixture.root, ["workflow", "next-task", "--path", fixture.blockedPlanPath]);
    const mcpBlocked = (await server.callTool("workflow_next_plan_task", { path: fixture.blockedPlanPath })) as Record<string, unknown>;
    expect(mcpBlocked).toMatchObject({ value: cliBlocked.value, diagnosticsSummary: cliBlocked.diagnosticsSummary });

    const cliIdOrder = await runCliJson(fixture.root, ["workflow", "next-task", "--path", fixture.idOrderPlanPath]);
    const mcpIdOrder = (await server.callTool("workflow_next_plan_task", { path: fixture.idOrderPlanPath })) as Record<string, unknown>;
    expect(mcpIdOrder).toMatchObject({ value: cliIdOrder.value, diagnosticsSummary: cliIdOrder.diagnosticsSummary });

    const cliStale = await runCliJson(fixture.root, ["workflow", "resume-hint", "--path", fixture.stalePlanPath]);
    const mcpStale = (await server.callTool("workflow_resume_hint", { path: fixture.stalePlanPath })) as Record<string, unknown>;
    expect(mcpStale).toMatchObject({ value: cliStale.value, diagnosticsSummary: cliStale.diagnosticsSummary });

    const cliCycle = await runCliJson(fixture.root, ["workflow", "next-task", "--path", fixture.cyclePlanPath]);
    const mcpCycle = (await server.callTool("workflow_next_plan_task", { path: fixture.cyclePlanPath })) as Record<string, unknown>;
    expect(mcpCycle).toMatchObject({
      value: cliCycle.value,
      diagnosticsSummary: cliCycle.diagnosticsSummary
    });

    const cliDoctor = await runCliJson(fixture.root, ["workflow", "doctor", "--path", fixture.stalePlanPath]);
    const mcpDoctor = (await server.callTool("workflow_doctor", { path: fixture.stalePlanPath })) as Record<string, unknown>;
    expect(mcpDoctor).toMatchObject({ value: cliDoctor.value, diagnosticsSummary: cliDoctor.diagnosticsSummary });

    const cliCompact = await runCliJson(fixture.root, ["workflow", "pipeline", "compact"]);
    const mcpCompact = (await server.callTool("workflow_pipeline_compact", {})) as Record<string, unknown>;
    expect(mcpCompact).toMatchObject({ value: cliCompact.value, diagnosticsSummary: cliCompact.diagnosticsSummary });
  });

  it("exposes includeDeleted for logical-delete pipeline inspection", async () => {
    const fixture = await createWorkflowFixture();
    await write(
      fixture.root,
      "kiwi/pipeline.jsonl",
      [
        workflowEvent("pipeline-a"),
        workflowEvent("delete-pipeline-a", "CORRECTION", { corrects_run_id: "pipeline-a", operation: { kind: "logical_delete", reason: "obsolete" } })
      ].join("\n") + "\n"
    );
    const server = createTestMcpServer({ root: fixture.root });
    registerReadTools(server, { root: fixture.root });

    await expect(server.callTool("workflow_pipeline_status", {})).resolves.toMatchObject({ ok: true, value: { latestEvent: null, total: 2 } });
    await expect(server.callTool("workflow_pipeline_tail", {})).resolves.toMatchObject({ ok: true, value: { events: [] } });
    await expect(server.callTool("workflow_pipeline_status", { includeDeleted: true })).resolves.toMatchObject({
      ok: true,
      value: { latestEvent: { event: { run_id: "delete-pipeline-a", status: "CORRECTION" } } }
    });
    await expect(server.callTool("workflow_pipeline_tail", { includeDeleted: true })).resolves.toMatchObject({
      ok: true,
      value: {
        events: [
          expect.objectContaining({ event: expect.objectContaining({ run_id: "pipeline-a" }) }),
          expect.objectContaining({ event: expect.objectContaining({ run_id: "delete-pipeline-a", status: "CORRECTION" }) })
        ]
      }
    });

    await write(
      fixture.root,
      ".kiwi/sessions/run-a/worklog.jsonl",
      [
        workflowEvent("worklog-a"),
        workflowEvent("delete-worklog-a", "CORRECTION", { corrects_run_id: "worklog-a", operation: { kind: "logical_delete", reason: "obsolete" } })
      ].join("\n") + "\n"
    );
    await expect(server.callTool("workflow_worklog_tail", { path: ".kiwi/sessions/run-a/worklog.jsonl" })).resolves.toMatchObject({ ok: true, value: { events: [] } });
    await expect(server.callTool("workflow_worklog_tail", { path: ".kiwi/sessions/run-a/worklog.jsonl", includeDeleted: true })).resolves.toMatchObject({
      ok: true,
      value: {
        events: [
          expect.objectContaining({ event: expect.objectContaining({ run_id: "worklog-a" }) }),
          expect.objectContaining({ event: expect.objectContaining({ run_id: "delete-worklog-a", status: "CORRECTION" }) })
        ]
      }
    });
  });
});
