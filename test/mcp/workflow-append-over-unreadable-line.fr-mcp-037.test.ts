import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-037 AC-4 — for the pipeline, worklog and repair-record appends, an unreadable or unsupported
// line already in the journal does not deny the append: it is reported as a warning and the event is
// appended after it (FR-NODE-193). Each of the three tools is run over the same damaged journal.

/** One line the parser cannot read, and one written before `schema_version` existed. */
const DAMAGED = `{bad\n${JSON.stringify({ ts: "2026-07-10T00:00:00.000Z", run_id: "old", skill: "kiwi-pm", status: "TASK_DONE" })}\n`;

const TOOLS = [
  { tool: "workflow_pipeline_emit", kind: "pipeline_event_append", journal: "kiwi/pipeline.jsonl" },
  { tool: "workflow_worklog_emit", kind: "worklog_event_append", journal: ".kiwi/sessions/run-a/worklog.jsonl" },
  { tool: "workflow_repair_record", kind: "workflow_repair_record", journal: ".kiwi/sessions/run-a/worklog.jsonl" }
] as const;

interface ToolResult {
  ok: boolean;
  value?: { written?: boolean };
  mutation?: { kind?: string };
  diagnostics?: Array<{ code: string; severity: string }>;
}

describe("FR-MCP-037 AC-4 — an append over a journal that already holds an unreadable line", () => {
  it.each(TOOLS)("FR-MCP-037 AC-4: $tool reports the unreadable and the unsupported line as warnings and appends after them", async ({ tool, kind, journal }) => {
    const root = await copyFixtureWorkspace("valid-basic");
    const absolute = path.join(root, journal);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, DAMAGED, "utf8");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    const event = { schema_version: "1.0.0", skill: "kiwi-pm", run_id: `${tool}-event`, status: "TASK_DONE" };
    const result = (await server.callTool(tool, { runId: "run-a", event })) as ToolResult;

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, value: { written: true }, mutation: { kind } });
    const warnings = (result.diagnostics ?? []).filter((entry) => entry.severity === "warning").map((entry) => entry.code);
    expect(warnings).toEqual(expect.arrayContaining(["SRS-W052", "SRS-W055"]));

    const after = await readFile(absolute, "utf8");
    expect(after.startsWith(DAMAGED), "the lines the tool could not read are left as they were").toBe(true);
    const appended = after.slice(DAMAGED.length).trim().split("\n");
    expect(appended).toHaveLength(1);
    expect(JSON.parse(appended[0] as string)).toMatchObject({ run_id: `${tool}-event` });
  });
});
