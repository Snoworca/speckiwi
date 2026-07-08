import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-020: the MCP add_trace_link handler must forward the input notes and dryRun flag
// to the core addTraceLink call.
describe("FR-MCP-020 add_trace_link forwards notes and dryRun", () => {
  it("records the provided notes in the Trace Links Notes column", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    const result = await server.callTool("add_trace_link", {
      id: "FR-ARCH-001",
      type: "Code",
      reference: "src/example.ts:10-20",
      relation: "verifies",
      notes: "kiwi-notes-marker"
    });
    expect(result).toMatchObject({ ok: true, value: { written: true } });

    const srs = await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(srs).toContain("| Code | src/example.ts:10-20 | verifies | kiwi-notes-marker |");
  });

  it("honors dryRun by previewing without modifying the file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    const result = await server.callTool("add_trace_link", {
      id: "FR-ARCH-001",
      type: "Code",
      reference: "src/dryrun-marker.ts:1",
      relation: "verifies",
      notes: "n",
      dryRun: true
    });
    expect(result).toMatchObject({ ok: true, value: { written: false } });

    const srs = await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(srs).not.toContain("src/dryrun-marker.ts:1");
  });
});
