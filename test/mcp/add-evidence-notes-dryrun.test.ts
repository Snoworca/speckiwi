import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-029: the MCP add_verification_evidence handler must forward notes and dryRun
// to core addVerificationEvidence (previously dropped, mirroring the FR-MCP-020 add_trace_link defect).
describe("FR-MCP-029 add_verification_evidence forwards notes and dryRun", () => {
  it("records the provided notes in the Verification Evidence Notes column", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    const result = await server.callTool("add_verification_evidence", {
      id: "FR-ARCH-001",
      type: "test",
      reference: "test/example-evidence.ts",
      covers: "all",
      notes: "kiwi-evidence-marker"
    });
    expect(result).toMatchObject({ ok: true, value: { written: true } });

    const srs = await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(srs).toContain("| test | test/example-evidence.ts | all | kiwi-evidence-marker |");
  });

  it("honors dryRun by previewing without modifying the file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });

    const result = await server.callTool("add_verification_evidence", {
      id: "FR-ARCH-001",
      type: "test",
      reference: "test/dryrun-evidence-marker.ts",
      covers: "all",
      notes: "n",
      dryRun: true
    });
    expect(result).toMatchObject({ ok: true, value: { written: false } });

    const srs = await readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
    expect(srs).not.toContain("test/dryrun-evidence-marker.ts");
  });
});
