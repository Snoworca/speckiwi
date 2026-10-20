import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";
import { renderToolDescriptions } from "../../src/mcp/schemas.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";
import { workflowMcp, writeText } from "../support/workflow-harness.js";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
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
      { path: fixture.freshSdsPath, action: "execute-sds" },
      { path: fixture.sdsPath, action: "resume-session" },
      { path: fixture.draftSdsPath, action: "create-sds" },
      { path: fixture.invalidSdsPath, action: "fix-artifact" },
      { path: fixture.blockedSdsPath, action: "blocked" },
      { path: fixture.completeSdsPath, action: "complete" }
    ];

    for (const scenario of scenarios) {
      const cli = await runCliJson(fixture.root, ["workflow", "work-order", "next", "--path", scenario.path]);
      const mcp = (await server.callTool("get_next_work_order", { path: scenario.path })) as Record<string, unknown>;
      expect(mcp).toMatchObject({ action: scenario.action, nextAction: (cli.nextAction as Record<string, unknown>), diagnosticsSummary: cli.diagnosticsSummary });
      expect(JSON.stringify(mcp)).not.toContain("#### Requirement");
    }

    const measured = (await server.callTool("get_next_work_order", { path: fixture.freshSdsPath, measure: true })) as Record<string, unknown>;
    expect(measured).toMatchObject({
      action: "execute-sds",
      measurement: { baselineBytes: expect.any(Number), compactBytes: expect.any(Number), requiredFieldsPresent: true }
    });

    const explained = (await server.callTool("get_next_work_order", { path: fixture.sdsPath, explain: true, contextProfile: "compact" })) as Record<string, unknown>;
    expect(explained).toMatchObject({
      action: "resume-session",
      profile: "explain",
      contextProfile: "compact",
      decisionTrace: expect.arrayContaining([expect.objectContaining({ step: "decision", outcome: "resume-session" })]),
      rejectedCandidates: expect.arrayContaining([expect.objectContaining({ action: "execute-sds" })])
    });

    const compact = (await server.callTool("get_next_work_order", { path: fixture.freshSdsPath, profile: "compact" })) as Record<string, unknown>;
    expect(compact).toMatchObject({ action: "execute-sds", profile: "compact" });
  });
});

// FR-NODE-211 AC-4 (as amended in 4.1.0), read through the tool the AC names.
describe("FR-NODE-211 AC-4 — get_next_work_order answers requirement-ID work units without an SDS argument", () => {
  it("FR-NODE-211 AC-4: open SDS files are listed as information and the action is implement-requirements", async () => {
    const fixture = await createWorkflowFixture();
    const order = await workflowMcp(fixture.root).call("get_next_work_order", {});
    expect(order).toMatchObject({
      action: "implement-requirements",
      nextAction: { kind: "implement-requirements", tool: "list_requirements" },
      sds: null,
      blocking: false
    });
    expect(order.openSds).toEqual(expect.arrayContaining([fixture.freshSdsPath, fixture.draftSdsPath, fixture.blockedSdsPath]));
  });

  it("FR-NODE-211 AC-4: an unfinished kiwi-pm session over an open requirement resumes; a NEEDS_USER or FAILED one blocks", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const { call } = workflowMcp(root);
    const session = (status: string): string => JSON.stringify({ run_id: "req-run", req_ids: ["FR-ARCH-001"], run: { status } });

    await writeText(root, ".kiwi/sessions/req-run/pm-state.json", session("running"));
    expect(await call("get_next_work_order", {})).toMatchObject({ action: "resume-session", requirementIds: ["FR-ARCH-001"], blocking: false });

    // kiwi-pm records NEEDS_USER as run.status "blocked" and FAILED as "failed" (kiwi-pm SKILL.md §2.2).
    for (const stopped of ["blocked", "failed"]) {
      await writeText(root, ".kiwi/sessions/req-run/pm-state.json", session(stopped));
      expect(await call("get_next_work_order", {}), stopped).toMatchObject({ action: "blocked", blocking: true });
    }

    await writeText(root, ".kiwi/sessions/req-run/pm-state.json", session("done"));
    const done = await call("get_next_work_order", {});
    expect(done.requirementIds).not.toContain("FR-ARCH-001");
  });

  it("FR-NODE-211 AC-4: the tool description presents implement-requirements as the default and SDS actions only for a named SDS", () => {
    const description = renderToolDescriptions().get_next_work_order ?? "";
    expect(description).toContain("implement-requirements");
    expect(description).toMatch(/only (?:when|for) (?:the caller names|a named) (?:an )?SDS/);
    // The SDS actions must not lead the list of answers, which an MCP client reads as the default.
    expect(description.indexOf("implement-requirements")).toBeLessThan(description.indexOf("SDS"));
  });

  it("FR-NODE-211 AC-4: with an explicit SDS argument the 4.0.0 SDS answers stay", async () => {
    const fixture = await createWorkflowFixture();
    const { call } = workflowMcp(fixture.root);
    expect(await call("get_next_work_order", { path: fixture.draftSdsPath })).toMatchObject({ action: "create-sds" });
    expect(await call("get_next_work_order", { path: fixture.freshSdsPath })).toMatchObject({ action: "execute-sds" });
    expect(await call("get_next_work_order", { runId: "fresh-run" })).toMatchObject({ action: "execute-sds" });
  });
});
