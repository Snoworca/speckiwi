import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function read(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

function event(runId: string): Record<string, unknown> {
  return { schema_version: "1.0.0", skill: "kiwi-pm", run_id: runId, status: "TASK_DONE" };
}

describe("FR-MCP-037 / FR-MCP-038 workflow mutation tools", () => {
  it("registers workflow mutation tools and preserves mutation envelopes", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await write(root, "docs/plans/run-a.plan.md", "# Plan\n\n- [ ] **T-PH001-01** Implement task\n");
    await write(root, "kiwi/pipeline.jsonl", `${JSON.stringify(event("event-a"))}\n`);
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    for (const name of [
      "workflow_task_check",
      "workflow_task_uncheck",
      "workflow_checklist_set",
      "workflow_task_status_set",
      "workflow_pipeline_emit",
      "workflow_worklog_emit",
      "workflow_repair_record",
      "workflow_logical_delete"
    ]) {
      expect(server.tools[name], `${name} should be registered`).toBeDefined();
      expect(toolSchemas[name], `${name} should expose a schema`).toBeDefined();
    }

    await expect(server.callTool("workflow_task_check", { runId: "run-a", taskId: "T-PH001-01", path: "docs/plans/run-a.plan.md", dryRun: true })).resolves.toMatchObject({
      ok: true,
      value: { written: false, journalState: "skipped_dry_run" },
      mutation: { kind: "plan_checkbox_check", written: false }
    });
    expect(await read(root, "docs/plans/run-a.plan.md")).toContain("- [ ] **T-PH001-01**");

    await expect(server.callTool("workflow_task_check", { runId: "run-a", taskId: "T-PH001-01", path: "docs/plans/run-a.plan.md" })).resolves.toMatchObject({
      ok: true,
      value: { written: true, journalKey: expect.any(String) },
      mutation: { journalState: "confirmed" }
    });
    expect(await read(root, "docs/plans/run-a.plan.md")).toContain("- [x] **T-PH001-01**");

    await expect(server.callTool("workflow_checklist_set", { runId: "run-a", taskId: "T-PH001-01", path: "docs/plans/run-a.plan.md", checked: false })).resolves.toMatchObject({
      ok: true,
      value: { written: true },
      mutation: { kind: "plan_checklist_item_update" }
    });
    expect(await read(root, "docs/plans/run-a.plan.md")).toContain("- [ ] **T-PH001-01**");

    await write(root, ".kiwi/sessions/run-a/pm-state.json", JSON.stringify({ run_id: "run-a", tasks: [{ task_id: "T-PH001-01", status: "pending" }] }, null, 2));
    await expect(server.callTool("workflow_task_status_set", { runId: "run-a", taskId: "T-PH001-01", pmStatePath: ".kiwi/sessions/run-a/pm-state.json", status: "done" })).resolves.toMatchObject({
      ok: true,
      value: { written: true },
      mutation: { kind: "pm_task_status_update" }
    });
    expect(JSON.parse(await read(root, ".kiwi/sessions/run-a/pm-state.json")).tasks[0].status).toBe("done");

    await expect(server.callTool("workflow_task_uncheck", { runId: "run-a", taskId: "T-PH001-01", path: "docs/plans/run-a.plan.md", owner: "kiwi-coder" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnosticsSummary: { byCode: { "SRS-E070": 1 } }
    });

    await expect(server.callTool("workflow_pipeline_emit", { runId: "run-a", event: event("event-b") })).resolves.toMatchObject({
      ok: true,
      value: { written: true },
      mutation: { kind: "pipeline_event_append" }
    });
    await expect(server.callTool("workflow_pipeline_emit", { runId: "run-a", event: event("event-b") })).resolves.toMatchObject({
      ok: true,
      value: { written: false },
      mutation: { operations: [] }
    });

    await write(root, ".kiwi/sessions/run-a/worklog.jsonl", "{bad\n");
    await expect(server.callTool("workflow_worklog_emit", { runId: "run-a", event: event("worklog-a") })).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnosticsSummary: { byCode: { "SRS-W052": 1 } }
    });

    await write(root, ".kiwi/sessions/run-a/worklog.jsonl", "");
    await expect(server.callTool("workflow_repair_record", { runId: "run-a", event: event("repair-a") })).resolves.toMatchObject({
      ok: true,
      value: { written: true },
      mutation: { kind: "workflow_repair_record" }
    });

    await expect(server.callTool("workflow_logical_delete", { runId: "run-a", recordType: "pipeline_event", recordId: "event-a", reason: "obsolete" })).resolves.toMatchObject({
      ok: true,
      value: { written: true, targetRecord: { desiredState: "deleted", recordId: "event-a" } }
    });
    expect(await read(root, "kiwi/pipeline.jsonl")).toContain('"kind":"logical_delete"');
  });
});
