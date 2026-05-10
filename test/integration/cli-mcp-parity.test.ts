import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("CLI MCP parity surface", () => {
  it("returns equivalent IDs for list through MCP core path", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    const result = await server.callTool("list_requirements", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.records.map((record: { id: string }) => record.id)).toContain("FR-ARCH-001");
    }
  });

  it("shares target summary diagnostics shape between CLI and MCP summary paths", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const streams = io();
    expect(await main(["--root", root, "summary", "--json"], streams)).toBe(0);
    const cliSummary = JSON.parse(streams.stdout.read()?.toString() ?? "");
    const mcpSummary = await server.callTool("summarize_target", {});

    expect(mcpSummary.ok).toBe(true);
    if (mcpSummary.ok) {
      expect(cliSummary).toMatchObject({
        target: mcpSummary.value.target,
        targetSource: mcpSummary.value.targetSource,
        countsByStatus: mcpSummary.value.countsByStatus,
        countsByType: mcpSummary.value.countsByType,
        blocked: mcpSummary.value.blocked,
        implementedNotVerified: mcpSummary.value.implementedNotVerified,
        missingEvidence: mcpSummary.value.missingEvidence
      });
      expect(cliSummary.diagnosticsSummary).toMatchObject({ errors: 0, warnings: expect.any(Number), byCode: expect.any(Object) });
      expect(mcpSummary.value.diagnosticsSummary).toMatchObject({ errors: 0, warnings: expect.any(Number), byCode: expect.any(Object) });
    }
  });

  it("shares validation, active-target, and completed-work read semantics", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const validateStreams = io();
    expect(await main(["--root", root, "validate", "--json"], validateStreams)).toBe(0);
    const cliValidate = JSON.parse(validateStreams.stdout.read()?.toString() ?? "");
    const mcpValidate = await server.callTool("validate_spec", {});
    expect(mcpValidate).toMatchObject({ ok: true, value: { summary: cliValidate.summary } });

    const activeStreams = io();
    expect(await main(["--root", root, "active-target", "--json"], activeStreams)).toBe(0);
    const cliActive = JSON.parse(activeStreams.stdout.read()?.toString() ?? "");
    const mcpActive = await server.callTool("get_active_target", {});
    expect(mcpActive).toMatchObject({
      ok: true,
      value: {
        activeTarget: cliActive.activeTarget,
        summary: {
          target: cliActive.summary.target,
          countsByStatus: cliActive.summary.countsByStatus,
          countsByType: cliActive.summary.countsByType
        },
        diagnosticsSummary: cliActive.diagnosticsSummary
      }
    });

    const completedStreams = io();
    expect(await main(["--root", root, "completed-work", "--target", "v1.0.0", "--json"], completedStreams)).toBe(0);
    const cliCompleted = JSON.parse(completedStreams.stdout.read()?.toString() ?? "");
    const mcpCompleted = await server.callTool("list_completed_work", { target: "v1.0.0" });
    expect(mcpCompleted).toMatchObject({ ok: true, value: { completedWork: cliCompleted.completedWork } });
  });
});
