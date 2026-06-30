import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("CLI MCP parity surface", () => {
  it("shares mutation dry-run envelope and no-write behavior", async () => {
    const cliRoot = await copyFixtureWorkspace("mutation-target");
    const mcpRoot = await copyFixtureWorkspace("mutation-target");
    const cliScopePath = path.join(cliRoot, "docs", "spec", "10.product-architecture.srs.md");
    const mcpScopePath = path.join(mcpRoot, "docs", "spec", "10.product-architecture.srs.md");
    const cliBefore = await readFile(cliScopePath, "utf8");
    const mcpBefore = await readFile(mcpScopePath, "utf8");

    const streams = io();
    expect(
      await main(
        [
          "--root",
          cliRoot,
          "add-evidence",
          "FR-ARCH-001",
          "--type",
          "test",
          "--reference",
          "test/integration/cli-mcp-parity.test.ts",
          "--notes",
          "parity note",
          "--dry-run",
          "--json"
        ],
        streams
      )
    ).toBe(0);
    const cliMutation = JSON.parse(streams.stdout.read()?.toString() ?? "");

    const server = createTestMcpServer({ root: mcpRoot });
    registerMutationTools(server, { root: mcpRoot });
    const mcpMutation = await server.callTool("add_verification_evidence", {
      id: "FR-ARCH-001",
      type: "test",
      reference: "test/integration/cli-mcp-parity.test.ts",
      notes: "parity note",
      dryRun: true
    });

    expect(cliMutation).toMatchObject({
      ok: true,
      value: { id: "FR-ARCH-001", written: false },
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      mutation: {
        kind: "add_verification_evidence",
        dryRun: true,
        written: false,
        filePath: "docs/spec/10.product-architecture.srs.md"
      }
    });
    expect(mcpMutation).toMatchObject({
      ok: true,
      value: { id: "FR-ARCH-001", written: false },
      diagnosticsSummary: cliMutation.diagnosticsSummary,
      mutation: {
        kind: cliMutation.mutation.kind,
        dryRun: cliMutation.mutation.dryRun,
        written: cliMutation.mutation.written,
        filePath: cliMutation.mutation.filePath,
        preview: cliMutation.mutation.preview
      }
    });
    await expect(readFile(cliScopePath, "utf8")).resolves.toBe(cliBefore);
    await expect(readFile(mcpScopePath, "utf8")).resolves.toBe(mcpBefore);
  });

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

  it("shares compact requirement search results between CLI and MCP", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    await writeFile(
      specPath,
      (await readFile(specPath, "utf8")).replace("The parser needs a small valid workspace.", "The parser needs a small valid workspace with parity search coverage."),
      "utf8"
    );
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const streams = io();
    expect(await main(["--root", root, "search", "parity search coverage", "--json"], streams)).toBe(0);
    const cliSearch = JSON.parse(streams.stdout.read()?.toString() ?? "");
    const mcpSearch = await server.callTool("search_requirements", { query: "parity search coverage" });

    expect(mcpSearch).toMatchObject({ ok: true });
    if (mcpSearch.ok) {
      expect(mcpSearch.value.records.map((record: { id: string }) => record.id)).toEqual(cliSearch.records.map((record: { id: string }) => record.id));
      expect(mcpSearch.value.records[0].snippets).toEqual(cliSearch.records[0].snippets);
      expect(mcpSearch.value.page).toEqual(cliSearch.page);
    }
  });

  it("preserves structured missing-requirement failures across CLI and MCP reads", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const streams = io();
    expect(await main(["--root", root, "show", "MISSING", "--json"], streams)).not.toBe(0);
    const cliFailure = JSON.parse(streams.stdout.read()?.toString() ?? "");
    const mcpFailure = await server.callTool("get_requirement", { id: "MISSING" });

    expect(cliFailure).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("Requirement not found") },
      diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} },
      recovery: { command: "search" }
    });
    expect(mcpFailure).toMatchObject({
      ok: false,
      error: { code: cliFailure.error.code, message: expect.stringContaining("Requirement not found") },
      diagnostics: expect.any(Array),
      diagnosticsSummary: { errors: 0, warnings: expect.any(Number), byCode: expect.any(Object) },
      recovery: { tool: "search_requirements" }
    });
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
