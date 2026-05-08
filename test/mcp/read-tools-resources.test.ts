import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerResources } from "../../src/mcp/resources.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("MCP read tools and resources", () => {
  it("registers read tools and exact resource URI families", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const otherRoot = await copyFixtureWorkspace("duplicate-id");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    registerResources(server, { root });

    expect(await server.callTool("list_requirements", {})).toMatchObject({ ok: true });
    const ignoredRoot = await server.callTool("list_requirements", { root: otherRoot });
    expect(ignoredRoot).toMatchObject({ ok: true });
    if ((ignoredRoot as { ok: boolean }).ok) {
      expect((ignoredRoot as { value: { records: Array<{ id: string }> } }).value.records).toHaveLength(1);
    }
    expect(await server.callTool("get_requirement", { id: "FR-ARCH-001", includeMarkdown: true })).toMatchObject({ ok: true });
    expect(await server.callTool("validate_spec", {})).toMatchObject({ ok: true });
    expect(await server.callTool("summarize_target", {})).toMatchObject({ ok: true });
    expect(server.resourceTemplates).toEqual([
      "speckiwi://index",
      "speckiwi://requirements/{id}",
      "speckiwi://targets/{target}",
      "speckiwi://scopes/{scope}"
    ]);
  });
});
