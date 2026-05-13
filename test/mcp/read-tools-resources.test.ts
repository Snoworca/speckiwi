import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerResources } from "../../src/mcp/resources.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

async function appendDeprecatedRequirement(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  const blockStart = text.indexOf("### FR-ARCH-001");
  if (blockStart < 0) throw new Error("fixture requirement block not found");
  const deprecatedBlock = text
    .slice(blockStart)
    .replaceAll("FR-ARCH-001", "FR-ARCH-002")
    .replace("Fixture requirement", "Deprecated fixture requirement")
    .replace("| Status | planned |", "| Status | blocked |")
    .replace("| Stability | stable |", "| Stability | deprecated |");
  await writeFile(specPath, `${text.trimEnd()}\n\n${deprecatedBlock}\n`, "utf8");
}

function expectOk<T>(result: unknown): T {
  expect(result).toMatchObject({ ok: true });
  return (result as { ok: true; value: T }).value;
}

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
    expect(await server.callTool("summarize_target", {})).toMatchObject({
      ok: true,
      value: {
        countsByStability: { stable: 1 },
        newWorkCandidates: ["FR-ARCH-001"],
        stabilityBlockers: [],
        stabilityWarnings: [],
        diagnosticsSummary: expect.any(Object)
      }
    });
    expect(await server.callTool("get_active_target", {})).toMatchObject({
      ok: true,
      value: {
        activeTarget: "v1.0.0",
        summary: {
          countsByStability: { stable: 1 },
          newWorkCandidates: ["FR-ARCH-001"],
          stabilityBlockers: [],
          stabilityWarnings: []
        },
        diagnosticsSummary: expect.any(Object)
      }
    });
    expect(await server.callTool("list_completed_work", { target: "v1.0.0" })).toMatchObject({
      ok: true,
      value: { completedWork: [expect.objectContaining({ reportPaths: [] }), expect.objectContaining({ reportPaths: [] })], diagnosticsSummary: expect.any(Object) }
    });
    expect(await server.callTool("summarize_target", { target: "v1.0.0" })).toMatchObject({
      ok: true,
      value: {
        completedWork: expect.any(Array),
        countsByStability: { stable: 1 },
        draftRequirements: [],
        deprecatedRequirements: [],
        newWorkCandidates: ["FR-ARCH-001"],
        stabilityBlockers: [],
        stabilityWarnings: [],
        diagnosticsSummary: expect.any(Object)
      }
    });
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

  it("keeps deprecated requirements explicitly searchable while excluding them from default new-work candidates", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendDeprecatedRequirement(root);
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const listed = expectOk<{ records: Array<{ id: string }> }>(await server.callTool("list_requirements", { status: "blocked" }));
    expect(listed.records.map((record) => record.id)).toEqual(["FR-ARCH-002"]);

    const shown = expectOk<{ id: string; stability: string }>(await server.callTool("get_requirement", { id: "FR-ARCH-002" }));
    expect(shown).toMatchObject({ id: "FR-ARCH-002", stability: "deprecated" });

    const summary = expectOk<{ deprecatedRequirements: string[]; newWorkCandidates: string[] }>(await server.callTool("summarize_target", {}));
    expect(summary.deprecatedRequirements).toContain("FR-ARCH-002");
    expect(summary.newWorkCandidates).not.toContain("FR-ARCH-002");
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

    await expect(server.callTool("resource:speckiwi://active-target", {})).resolves.toMatchObject({
      ok: true,
      value: {
        summary: {
          countsByStability: { stable: 1 },
          newWorkCandidates: ["FR-ARCH-001"],
          stabilityBlockers: [],
          stabilityWarnings: []
        }
      }
    });
    await expect(server.callTool("resource:speckiwi://targets/{target}", { target: "v1.0.0" })).resolves.toMatchObject({
      ok: true,
      value: {
        countsByStability: { stable: 1 },
        newWorkCandidates: ["FR-ARCH-001"],
        stabilityBlockers: [],
        stabilityWarnings: []
      }
    });
    await expect(server.callTool("resource:speckiwi://completed-work", {})).resolves.toMatchObject({
      ok: true,
      value: { completedWork: [expect.objectContaining({ reportPaths: [] }), expect.objectContaining({ reportPaths: [] })] }
    });
  });

  it("returns non-empty report paths through MCP read tools and resources", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    registerReadTools(server, { root });
    registerResources(server, { root });

    await expect(
      server.callTool("add_completed_work", {
        date: "2026-05-11",
        target: "v1.0.0",
        scope: "ARCH",
        summary: "MCP read report paths.",
        reportPaths: ["docs/reports/mcp-read.md"]
      })
    ).resolves.toMatchObject({ ok: true });

    await expect(server.callTool("list_completed_work", { target: "v1.0.0", limit: 1 })).resolves.toMatchObject({
      ok: true,
      value: { completedWork: [expect.objectContaining({ reportPaths: ["docs/reports/mcp-read.md"] })] }
    });
    await expect(server.callTool("summarize_target", { target: "v1.0.0" })).resolves.toMatchObject({
      ok: true,
      value: { completedWork: expect.arrayContaining([expect.objectContaining({ reportPaths: ["docs/reports/mcp-read.md"] })]) }
    });
    await expect(server.callTool("resource:speckiwi://completed-work", {})).resolves.toMatchObject({
      ok: true,
      value: { completedWork: expect.arrayContaining([expect.objectContaining({ reportPaths: ["docs/reports/mcp-read.md"] })]) }
    });
    await expect(server.callTool("resource:speckiwi://targets/{target}", { target: "v1.0.0" })).resolves.toMatchObject({
      ok: true,
      value: { completedWork: expect.arrayContaining([expect.objectContaining({ reportPaths: ["docs/reports/mcp-read.md"] })]) }
    });
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
