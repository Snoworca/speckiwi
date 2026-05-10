import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
    expect(await server.callTool("validate_spec", {})).toMatchObject({ ok: true, value: { diagnostics: expect.any(Array), errors: [], warnings: expect.any(Array), summary: expect.any(Object) } });
    expect(await server.callTool("summarize_target", {})).toMatchObject({ ok: true, value: { diagnosticsSummary: expect.any(Object) } });
    expect(await server.callTool("get_active_target", {})).toMatchObject({ ok: true, value: { activeTarget: "v1.0.0", diagnosticsSummary: expect.any(Object) } });
    expect(await server.callTool("list_completed_work", { target: "v1.0.0" })).toMatchObject({ ok: true, value: { completedWork: expect.any(Array), diagnosticsSummary: expect.any(Object) } });
    expect(await server.callTool("summarize_target", { target: "v1.0.0" })).toMatchObject({ ok: true, value: { completedWork: expect.any(Array), diagnosticsSummary: expect.any(Object) } });
    expect(server.resourceTemplates).toEqual([
      "speckiwi://index",
      "speckiwi://active-target",
      "speckiwi://completed-work",
      "speckiwi://completed-work/{target}",
      "speckiwi://requirements/{id}",
      "speckiwi://targets/{target}",
      "speckiwi://scopes/{scope}"
    ]);
  });

  it("wraps every resource with the v1.2.0 diagnostics envelope", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root });
    registerResources(server, { root });

    for (const [uri, input] of [
      ["speckiwi://index", {}],
      ["speckiwi://active-target", {}],
      ["speckiwi://completed-work", {}],
      ["speckiwi://completed-work/{target}", { target: "v1.0.0" }],
      ["speckiwi://requirements/{id}", { id: "FR-ARCH-001" }],
      ["speckiwi://targets/{target}", { target: "v1.0.0" }],
      ["speckiwi://scopes/{scope}", { scope: "ARCH" }]
    ] as const) {
      await expect(server.callTool(`resource:${uri}`, input)).resolves.toMatchObject({
        ok: true,
        value: expect.anything(),
        diagnostics: expect.any(Array),
        diagnosticsSummary: { errors: 0, warnings: expect.any(Number), byCode: expect.any(Object) }
      });
    }
  });

  it("reports an empty active target without fallback through MCP", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    await writeFile(indexPath, (await readFile(indexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target |  |"), "utf8");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const result = await server.callTool("get_active_target", {});
    expect(result).toMatchObject({ ok: true, value: { activeTarget: "", summary: { target: "", completedWork: [] } } });
  });
});
