import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

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
});
