import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function runCliJson(root: string, args: string[]): Promise<Record<string, unknown>> {
  const streams = io();
  expect(await main(["--root", root, ...args, "--json"], streams)).toBe(0);
  return JSON.parse(streams.stdout.read()?.toString() ?? "") as Record<string, unknown>;
}

describe("FR-MCP-024 get_next_work_order tool", () => {
  it("registers a read-only compact MCP tool with CLI-equivalent work-order decisions", async () => {
    const fixture = await createWorkflowFixture();
    const server = createTestMcpServer({ root: fixture.root });
    registerReadTools(server, { root: fixture.root });

    expect(server.tools.get_next_work_order).toBeDefined();
    expect(toolSchemas.get_next_work_order).toBeDefined();
    expect(isReadOnlyTool("get_next_work_order")).toBe(true);

    const scenarios = [
      { path: fixture.idOrderPlanPath, action: "execute-task" },
      { path: fixture.planPath, action: "resume-session" },
      { path: fixture.stalePlanPath, action: "fix-artifact" },
      { path: fixture.blockedPlanPath, action: "blocked" },
      { path: fixture.completePlanPath, action: "complete" }
    ];

    for (const scenario of scenarios) {
      const cli = await runCliJson(fixture.root, ["workflow", "work-order", "next", "--path", scenario.path]);
      const mcp = (await server.callTool("get_next_work_order", { path: scenario.path })) as Record<string, unknown>;
      expect(mcp).toMatchObject({ action: scenario.action, nextAction: (cli.nextAction as Record<string, unknown>), diagnosticsSummary: cli.diagnosticsSummary });
      expect(JSON.stringify(mcp)).not.toContain("#### Requirement");
    }

    const measured = (await server.callTool("get_next_work_order", { path: fixture.idOrderPlanPath, measure: true })) as Record<string, unknown>;
    expect(measured).toMatchObject({
      action: "execute-task",
      measurement: { baselineBytes: expect.any(Number), compactBytes: expect.any(Number), requiredFieldsPresent: true }
    });

    const explained = (await server.callTool("get_next_work_order", { path: fixture.planPath, explain: true, contextProfile: "compact" })) as Record<string, unknown>;
    expect(explained).toMatchObject({
      action: "resume-session",
      profile: "explain",
      contextProfile: "compact",
      decisionTrace: expect.arrayContaining([expect.objectContaining({ step: "decision", outcome: "resume-session" })]),
      rejectedCandidates: expect.arrayContaining([expect.objectContaining({ action: "execute-task" })])
    });

    const compact = (await server.callTool("get_next_work_order", { path: fixture.idOrderPlanPath, profile: "compact" })) as Record<string, unknown>;
    expect(compact).toMatchObject({ action: "execute-task", profile: "compact" });
  });
});
