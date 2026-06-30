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

async function addSearchMetadata(root: string): Promise<void> {
  const specPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  const text = await readFile(specPath, "utf8");
  await writeFile(
    specPath,
    text
      .replace("| Related Docs | [Index](./00.index.md) |", "| Related Docs | [Index](./00.index.md), [Research](../research/search.md) |")
      .replace(
        "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |",
        "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |\n| VE-1 | test | test/core/query/query-summary-links.test.ts; npm test | all | Search fixture. |"
      ),
    "utf8"
  );
}

async function writeExternalCompletedWork(root: string, rows = 1): Promise<void> {
  const tableRows = Array.from({ length: rows }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `| 2026-06-${day} | v1.0.0 | ARCH | FR-ARCH-001 | External MCP completed row ${day}. | docs/reports/external-${day}.md |`;
  });
  await writeFile(
    path.join(root, "docs", "spec", "05.completed-work.md"),
    [
      "# Completed Work",
      "",
      "## 1. Completed Work Log",
      "",
      "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
      "|---|---|---|---|---|---|",
      ...tableRows
    ].join("\n"),
    "utf8"
  );
}

function expectOk<T>(result: unknown): T {
  expect(result).toMatchObject({ ok: true });
  return (result as { ok: true; value: T }).value;
}

interface DuplicateValidationPayload {
  errors: Array<{
    code: string;
    details?: {
      duplicateId?: string;
      occurrences?: unknown[];
      nextAction?: { requiresSelectedOccurrence?: boolean };
    };
  }>;
  summary: { byCode: Record<string, number> };
  diagnosticsSummary: { byCode: Record<string, number> };
}

describe("MCP read tools and resources", () => {
  it("registers read tools and exact resource URI families", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const otherRoot = await copyFixtureWorkspace("duplicate-id");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    registerResources(server, { root });

    expect(await server.callTool("mcp_workspace_info", {})).toMatchObject({
      ok: true,
      value: {
        workspaceRoot: root,
        rootSource: "explicit",
        indexPath: "docs/spec/00.index.md",
        activeTarget: "v1.0.0"
      },
      mcpWorkspace: { workspaceRoot: root, rootSource: "explicit", indexPath: "docs/spec/00.index.md", packageVersion: expect.any(String) }
    });
    expect(await server.callTool("list_requirements", {})).toMatchObject({
      ok: true,
      value: expect.any(Object),
      diagnostics: expect.any(Array),
      diagnosticsSummary: expect.any(Object),
      mcpWorkspace: { workspaceRoot: root, rootSource: "explicit", indexPath: "docs/spec/00.index.md", packageVersion: expect.any(String) }
    });
    const ignoredRoot = await server.callTool("list_requirements", { root: otherRoot });
    expect(ignoredRoot).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED" },
      diagnosticsSummary: { errors: 1, warnings: 0, byCode: { "SRS-E075": 1 } },
      mcpWorkspace: { workspaceRoot: root }
    });
    const ignoredResourceRoot = await server.callTool("resource:speckiwi://completed-work", { root: otherRoot });
    expect(ignoredResourceRoot).toMatchObject({
      ok: false,
      error: { code: "MCP_WORKSPACE_ROOT_UNSUPPORTED" },
      diagnosticsSummary: { errors: 1, warnings: 0, byCode: { "SRS-E075": 1 } },
      mcpWorkspace: { workspaceRoot: root }
    });
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

  it("REL-PARSE-003 AC-5 preserves grouped duplicate diagnostics in MCP validate JSON", async () => {
    const root = await copyFixtureWorkspace("duplicate-id-three-occurrences");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const output = expectOk<DuplicateValidationPayload>(await server.callTool("validate_spec", {}));
    const duplicate = output.errors.find((diagnostic) => diagnostic.code === "SRS-E002");

    expect(output.summary.byCode["SRS-E002"]).toBe(1);
    expect(output.diagnosticsSummary.byCode["SRS-E002"]).toBe(1);
    expect(duplicate?.details).toMatchObject({
      duplicateId: "REL-PARSE-903",
      occurrences: expect.arrayContaining([expect.objectContaining({ filePath: expect.any(String), headingLine: expect.any(Number), blockHash: expect.any(String) })]),
      nextAction: expect.objectContaining({ requiresSelectedOccurrence: true })
    });
    expect(duplicate?.details?.occurrences).toHaveLength(3);
  });

  it("keeps the full problem-matrix diagnostics visible in MCP validate JSON", async () => {
    const root = await copyFixtureWorkspace("problem-matrix");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const output = expectOk<{
      errors: Array<{ code: string; filePath?: string; details?: unknown }>;
      warnings: Array<{ code: string; filePath?: string; details?: unknown }>;
      summary: { errors: number; warnings: number; byCode: Record<string, number> };
      diagnosticsSummary: { byCode: Record<string, number> };
    }>(await server.callTool("validate_spec", {}));

    expect(output.summary.errors).toBeGreaterThan(0);
    expect(output.summary.warnings).toBeGreaterThan(0);
    expect(output.summary.byCode).toMatchObject({
      "SRS-E002": expect.any(Number),
      "SRS-E015": expect.any(Number),
      "SRS-W024": expect.any(Number),
      "SRS-W041": expect.any(Number)
    });
    expect(output.diagnosticsSummary.byCode).toMatchObject(output.summary.byCode);
    expect(output.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-E002" }), expect.objectContaining({ code: "SRS-E015" })]));
    expect(output.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SRS-W024" }), expect.objectContaining({ code: "SRS-W041" })]));
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

  it("FR-PARSE-019 consumes normalized search fields in MCP list filters", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await addSearchMetadata(root);
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const listed = expectOk<{ records: Array<{ id: string; relatedDocs?: string[]; evidenceReferences?: string[]; traceReferences?: string[] }> }>(
      await server.callTool("list_requirements", {
        stability: "stable",
        priority: "high",
        relatedDoc: "docs/research/search.md",
        evidenceReference: "test/core/query/query-summary-links.test.ts",
        traceReference: "FR-ARCH-001",
        newWorkCandidate: true
      })
    );

    expect(listed.records).toEqual([
      expect.objectContaining({
        id: "FR-ARCH-001",
        relatedDocs: expect.arrayContaining(["docs/research/search.md"]),
        evidenceReferences: expect.arrayContaining(["test/core/query/query-summary-links.test.ts"]),
        traceReferences: expect.arrayContaining(["FR-ARCH-001"])
      })
    ]);
  });

  it("FR-MCP-021 exposes compact list projections and search_requirements", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendDeprecatedRequirement(root);
    await addSearchMetadata(root);
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const compact = expectOk<{ records: Array<{ id: string; markdown?: string }>; page: { total: number; returned: number; truncated: boolean } }>(
      await server.callTool("list_requirements", { limit: 1 })
    );
    expect(compact.records).toEqual([expect.objectContaining({ id: "FR-ARCH-001" })]);
    expect(compact.records[0]?.markdown).toBeUndefined();
    expect(compact.page).toMatchObject({ total: 2, returned: 1, truncated: true });

    const ids = expectOk<{ ids: string[]; page: { nextOffset: number | null } }>(await server.callTool("list_requirements", { projection: "ids", limit: 1 }));
    expect(ids.ids).toEqual(["FR-ARCH-001"]);
    expect(ids.page.nextOffset).toBe(1);

    const selected = expectOk<{ records: Array<Record<string, unknown>> }>(await server.callTool("list_requirements", { fields: ["id", "title", "stability"] }));
    expect(selected.records[0]).toEqual({ id: "FR-ARCH-001", title: "Fixture requirement", stability: "stable" });

    const full = expectOk<{ records: Array<{ id: string; markdown?: string }> }>(await server.callTool("list_requirements", { projection: "full", includeMarkdown: true }));
    expect(full.records[0]?.markdown).toContain("SpecKiwi must parse this fixture requirement.");

    const searched = expectOk<{ records: Array<{ id: string; snippets: Array<{ field: string; text: string }> }>; diagnosticsSummary: unknown }>(
      await server.callTool("search_requirements", { query: "small valid workspace", limit: 1 })
    );
    expect(searched.records).toEqual([
      expect.objectContaining({
        id: "FR-ARCH-001",
        snippets: [expect.objectContaining({ field: "rationale", text: expect.stringContaining("small valid workspace") })]
      })
    ]);
    expect(searched.diagnosticsSummary).toBeDefined();

    const filteredSearch = expectOk<{ records: Array<{ id: string }> }>(await server.callTool("search_requirements", { query: "deprecated", status: "blocked" }));
    expect(filteredSearch.records.map((record) => record.id)).toEqual(["FR-ARCH-002"]);
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
        diagnosticsSummary: { errors: 0, warnings: expect.any(Number), byCode: expect.any(Object) },
        mcpWorkspace: { workspaceRoot: root, rootSource: "explicit", indexPath: "docs/spec/00.index.md", packageVersion: expect.any(String) }
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

  it("FR-MCP-022 preserves diagnostics envelopes across read, resource, mutation, and workflow-log paths", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });
    registerMutationTools(server, { root });
    registerResources(server, { root });

    await expect(server.callTool("validate_spec", {})).resolves.toMatchObject({
      ok: true,
      value: { diagnostics: expect.any(Array), diagnosticsSummary: expect.any(Object) },
      diagnostics: expect.any(Array),
      diagnosticsSummary: expect.any(Object)
    });
    await expect(server.callTool("get_requirement", { id: "MISSING" })).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("Requirement not found") },
      diagnostics: expect.any(Array),
      diagnosticsSummary: { errors: 0, warnings: expect.any(Number), byCode: expect.any(Object) },
      recovery: { tool: "search_requirements" }
    });
    await expect(server.callTool("resource:speckiwi://requirements/{id}", { id: "MISSING" })).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("Requirement not found") },
      diagnostics: expect.any(Array),
      diagnosticsSummary: { errors: 0, warnings: expect.any(Number), byCode: expect.any(Object) },
      recovery: { tool: "search_requirements" }
    });
    await expect(server.callTool("list_completed_work", { target: "v1.0.0", limit: 1 })).resolves.toMatchObject({
      ok: true,
      value: { completedWork: expect.any(Array) },
      diagnostics: expect.any(Array),
      diagnosticsSummary: expect.any(Object)
    });
    await expect(server.callTool("add_completed_work", { date: "2026-05-10", requirementIds: ["FR-ARCH-001"], summary: "MCP incomplete denied." })).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W015" })]),
      diagnosticsSummary: { warnings: 1, byCode: { "SRS-W015": 1 } }
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

  it("FR-MCP-030 FR-MCP-031 returns external completed-work source metadata and bounded resources", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeExternalCompletedWork(root, 25);
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    registerReadTools(server, { root });
    registerResources(server, { root });

    await expect(server.callTool("list_completed_work", { target: "v1.0.0", limit: 1 })).resolves.toMatchObject({
      ok: true,
      value: {
        completedWork: [
          expect.objectContaining({
            summary: "External MCP completed row 25.",
            filePath: "docs/spec/05.completed-work.md",
            line: expect.any(Number)
          })
        ],
        completedWorkPage: { total: 27, returned: 1, limit: 1, hasMore: true, nextOffset: 1 },
        completedWorkSource: {
          mode: "external",
          authoritativeFilePath: "docs/spec/05.completed-work.md",
          duplicateSources: true,
          migrationRecommended: true
        },
        diagnosticsSummary: expect.objectContaining({ byCode: expect.objectContaining({ "SRS-W041": 1 }) })
      },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W041" })])
    });

    await expect(server.callTool("add_completed_work", { date: "2026-06-30", summary: "External MCP dry-run.", dryRun: true })).resolves.toMatchObject({
      ok: true,
      value: {
        written: false,
        completedWorkSource: {
          mode: "external",
          authoritativeFilePath: "docs/spec/05.completed-work.md"
        }
      },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W041" })]),
      mutation: { filePath: "docs/spec/05.completed-work.md", dryRun: true, written: false },
      patch: { filePath: "docs/spec/05.completed-work.md", dryRun: true }
    });

    await expect(server.callTool("resource:speckiwi://completed-work", {})).resolves.toMatchObject({
      ok: true,
      value: {
        completedWork: expect.any(Array),
        completedWorkPage: { total: 27, returned: 20, limit: 20, hasMore: true, nextOffset: 20 },
        completedWorkSource: {
          mode: "external",
          authoritativeFilePath: "docs/spec/05.completed-work.md",
          duplicateSources: true
        }
      },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W041" })])
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
