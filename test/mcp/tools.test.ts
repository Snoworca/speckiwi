import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rebuildCache, cleanCache } from "../../src/core/cache.js";
import { createSpecKiwiCore } from "../../src/core/api.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { registerMcpTools } from "../../src/mcp/tools.js";
import { machineErrorOutputSchema, machineResultOutputSchema, toolOutputSchemaFor } from "../../src/mcp/structured-content.js";
import { getReadModelMemoStats, resetReadModelMemoStats, clearReadModelMemo } from "../../src/core/read-model.js";
import { createDiagnosticBag } from "../../src/core/result.js";

const root = resolve(import.meta.dirname, "../..");
const validRoot = resolve(root, "test/fixtures/workspaces/valid-basic");
const tempRoots: string[] = [];

const requiredTools = [
  "speckiwi_apply_change",
  "speckiwi_get_requirement",
  "speckiwi_graph",
  "speckiwi_impact",
  "speckiwi_list_documents",
  "speckiwi_list_requirements",
  "speckiwi_overview",
  "speckiwi_preview_requirement_id",
  "speckiwi_propose_change",
  "speckiwi_read_document",
  "speckiwi_search",
  "speckiwi_trace_requirement",
  "speckiwi_validate"
];

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });
});

afterEach(async () => {
  clearReadModelMemo();
  resetReadModelMemoStats();
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("mcp tools", () => {
  it("registers all required tools with closed input schemas", async () => {
    await withClient(validRoot, async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(requiredTools);
      expect(listed.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
      expect(listed.tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
      expect(listed.tools.every((tool) => tool.outputSchema !== undefined && typeof tool.outputSchema === "object")).toBe(true);
      expect(listed.tools.find((tool) => tool.name === "speckiwi_overview")?.inputSchema.properties).not.toHaveProperty("root");
    });
  });

  it("returns Core DTO structuredContent and matching JSON text content", async () => {
    await withClient(validRoot, async (client) => {
      const result = await client.callTool({ name: "speckiwi_get_requirement", arguments: { id: "FR-CORE-0001" } });
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        ok: true,
        requirement: { id: "FR-CORE-0001" },
        relations: { incoming: [], outgoing: [] }
      });
      expect(JSON.parse(text)).toEqual(result.structuredContent);

      const missing = await client.callTool({ name: "speckiwi_get_requirement", arguments: { id: "FR-MISSING-0001" } });
      expect(missing.isError).toBe(true);
      expect(missing.structuredContent).toMatchObject({
        ok: false,
        error: { code: "REQUIREMENT_NOT_FOUND" }
      });
    });
  });

  it("accepts project filters and enforces separate search and list page limits", async () => {
    await withClient(validRoot, async (client) => {
      const byId = await client.callTool({ name: "speckiwi_list_requirements", arguments: { project: "speckiwi" } });
      const byName = await client.callTool({ name: "speckiwi_list_requirements", arguments: { project: "SpecKiwi" } });
      const unknown = await client.callTool({ name: "speckiwi_list_requirements", arguments: { project: "missing" } });
      const searchMax = await client.callTool({ name: "speckiwi_search", arguments: { query: "Validate", limit: 100 } });
      const listMax = await client.callTool({ name: "speckiwi_list_requirements", arguments: { limit: 500 } });

      expect(byId.structuredContent).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001" }], page: { limit: 50, total: 1 } });
      expect(byName.structuredContent).toMatchObject({ ok: true, requirements: [{ id: "FR-CORE-0001" }], page: { limit: 50, total: 1 } });
      expect(unknown.structuredContent).toMatchObject({ ok: true, requirements: [], page: { returned: 0, total: 0 } });
      expect(searchMax.structuredContent).toMatchObject({ ok: true, page: { limit: 100 } });
      expect(listMax.structuredContent).toMatchObject({ ok: true, page: { limit: 500 } });
      await expect(client.callTool({ name: "speckiwi_search", arguments: { query: "Validate", limit: 101 } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
      await expect(client.callTool({ name: "speckiwi_list_requirements", arguments: { limit: 501 } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
    });
  });

  it("rejects tool shape errors as invalid params and returns ErrorResult for apply policy rejection", async () => {
    const workspace = await copyFixture("speckiwi-mcp-apply-");
    await writeFile(
      join(workspace, ".speckiwi", "index.yaml"),
      (await readFile(join(workspace, ".speckiwi", "index.yaml"), "utf8")).replace(
        "documents:\n",
        "settings:\n  agent:\n    allowApply: false\ndocuments:\n"
      ),
      "utf8"
    );

    await withClient(workspace, async (client) => {
      await expect(client.callTool({ name: "speckiwi_overview", arguments: { root: validRoot } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
      await expect(client.callTool({ name: "speckiwi_validate", arguments: { unexpected: true } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
      await expect(client.callTool({ name: "speckiwi_graph", arguments: { graphType: "bad" } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
      await expect(client.callTool({ name: "speckiwi_trace_requirement", arguments: { id: "FR-CORE-0001", depth: 6 } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
      await expect(client.callTool({ name: "speckiwi_search", arguments: { query: 1 } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
      await expect(client.callTool({ name: "speckiwi_apply_change", arguments: { confirm: true } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
      await expect(
        client.callTool({
          name: "speckiwi_apply_change",
          arguments: {
            confirm: true,
            proposalId: "proposal.one",
            proposalPath: ".speckiwi/proposals/proposal.one.yaml"
          }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });

      const confirmMissing = await client.callTool({
        name: "speckiwi_apply_change",
        arguments: {
          confirm: false,
          change: {
            operation: "update_requirement",
            target: { kind: "requirement", requirementId: "FR-CORE-0001" },
            changes: [{ op: "replace", path: "/requirements/0/statement", value: "MCP apply should require confirm." }],
            reason: "Exercise MCP confirm policy."
          }
        }
      });
      expect(confirmMissing.isError).toBe(true);
      expect(confirmMissing.structuredContent).toMatchObject({
        ok: false,
        error: { code: "APPLY_REJECTED_CONFIRM_REQUIRED" },
        diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
      });

      const rejected = await client.callTool({
        name: "speckiwi_apply_change",
        arguments: {
          confirm: true,
          change: {
            operation: "update_requirement",
            target: { kind: "requirement", requirementId: "FR-CORE-0001" },
            changes: [{ op: "replace", path: "/requirements/0/statement", value: "MCP apply should be rejected." }],
            reason: "Exercise MCP apply policy."
          }
        }
      });
      expect(rejected.isError).toBe(true);
      expect(rejected.structuredContent).toMatchObject({
        ok: false,
        error: { code: "APPLY_REJECTED_ALLOW_APPLY_FALSE" }
      });
      await expect(machineResultOutputSchema.parseAsync(rejected.structuredContent)).resolves.toMatchObject({ ok: false });
    });
  });

  it("accepts list requirement filter combinations and rejects invalid filter params", async () => {
    await withClient(validRoot, async (client) => {
      const stringFilters = await client.callTool({
        name: "speckiwi_list_requirements",
        arguments: { project: "SpecKiwi", scope: "core", type: "functional", status: "active", tag: "validation" }
      });
      const arrayFilters = await client.callTool({
        name: "speckiwi_list_requirements",
        arguments: {
          project: ["missing", "speckiwi"],
          scope: ["missing", "core"],
          type: ["functional"],
          status: ["active"],
          tag: ["validation"]
        }
      });
      const empty = await client.callTool({
        name: "speckiwi_list_requirements",
        arguments: { project: "missing", scope: "missing", type: "reliability", status: "proposed", tag: "missing" }
      });

      expect(stringFilters.structuredContent).toMatchObject({
        ok: true,
        requirements: [{ id: "FR-CORE-0001" }],
        page: { total: 1, returned: 1 }
      });
      expect(arrayFilters.structuredContent).toMatchObject({
        ok: true,
        requirements: [{ id: "FR-CORE-0001" }],
        page: { total: 1, returned: 1 }
      });
      expect(empty.structuredContent).toMatchObject({ ok: true, requirements: [], page: { total: 0, returned: 0 } });
      await expect(client.callTool({ name: "speckiwi_list_requirements", arguments: { project: 123 } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
      await expect(client.callTool({ name: "speckiwi_list_requirements", arguments: { status: [true] } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
    });
  });

  it("keeps read-only tool outputs compatible with the common output schema", async () => {
    await withClient(validRoot, async (client) => {
      const calls = [
        { name: "speckiwi_overview", arguments: {} },
        { name: "speckiwi_list_documents", arguments: {} },
        { name: "speckiwi_list_requirements", arguments: {} },
        { name: "speckiwi_search", arguments: { query: "Validate workspace" } },
        { name: "speckiwi_graph", arguments: {} },
        { name: "speckiwi_impact", arguments: { id: "FR-CORE-0001" } },
        { name: "speckiwi_validate", arguments: {} }
      ];

      for (const call of calls) {
        const result = await client.callTool(call);
        await expect(machineResultOutputSchema.parseAsync(result.structuredContent)).resolves.toMatchObject({ ok: true });
      }

      const errorResult = await client.callTool({ name: "speckiwi_get_requirement", arguments: { id: "FR-MISSING-0001" } });
      await expect(machineResultOutputSchema.parseAsync(errorResult.structuredContent)).resolves.toMatchObject({ ok: false });
    });
  });

  it("uses tool-specific output schemas for success and error structured content", async () => {
    const diagnostics = createDiagnosticBag();
    await expect(
      toolOutputSchemaFor("speckiwi_search").safeParseAsync({
        ok: true,
        diagnostics
      })
    ).resolves.toMatchObject({ success: false });
    await expect(
      toolOutputSchemaFor("speckiwi_search").parseAsync({
        ok: true,
        diagnostics,
        query: "Validate",
        mode: "auto",
        results: [],
        page: { limit: 10, offset: 0, returned: 0, total: 0, hasMore: false, nextOffset: null }
      })
    ).resolves.toMatchObject({ ok: true, query: "Validate" });
    await expect(
      toolOutputSchemaFor("speckiwi_apply_change").safeParseAsync({
        ok: true,
        diagnostics,
        mode: "apply",
        applied: true,
        modifiedFiles: [".speckiwi/srs/core.yaml"]
      })
    ).resolves.toMatchObject({ success: false });
    await expect(
      toolOutputSchemaFor("speckiwi_search").parseAsync({
        ok: false,
        diagnostics: createDiagnosticBag([{ severity: "error", code: "SEARCH_REJECTED", message: "Rejected." }]),
        error: { code: "SEARCH_REJECTED", message: "Rejected." }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "SEARCH_REJECTED" } });
    await expect(
      toolOutputSchemaFor("speckiwi_search").safeParseAsync({
        ok: true,
        diagnostics,
        error: { code: "IMPOSSIBLE", message: "Successful output must not expose an error." },
        query: "Validate",
        mode: "auto",
        results: [],
        page: { limit: 10, offset: 0, returned: 0, total: 0, hasMore: false, nextOffset: null }
      })
    ).resolves.toMatchObject({ success: false });
    await expect(
      machineErrorOutputSchema.parseAsync({
        ok: false,
        diagnostics: createDiagnosticBag([{ severity: "error", code: "APPLY_REJECTED", message: "Rejected." }]),
        error: { code: "APPLY_REJECTED", message: "Rejected." }
      })
    ).resolves.toMatchObject({ ok: false });
  });

  it("rejects malformed error structured content through the registered handler path", async () => {
    const core = createSpecKiwiCore({ root: validRoot });
    const server = new McpServer({ name: "speckiwi-malformed-test", version: "1.0.0" });
    registerMcpTools(server, {
      ...core,
      search: async () =>
        ({
          ok: false,
          error: { message: "Malformed error output is missing code." },
          diagnostics: createDiagnosticBag([{ severity: "error", code: "MALFORMED", message: "Malformed." }])
        }) as never
    });

    await withServerClient(server, async (client) => {
      await expect(client.callTool({ name: "speckiwi_search", arguments: { query: "Validate" } })).rejects.toMatchObject({
        code: ErrorCode.InvalidParams
      });
    });
  });

  it("covers MCP read, preview, trace, propose, and apply success paths through registered handlers", async () => {
    const workspace = await copyFixture("speckiwi-mcp-success-");
    const sourcePath = join(workspace, ".speckiwi", "srs", "core.yaml");
    const sourceBefore = await readFile(sourcePath, "utf8");

    await withClient(workspace, async (client) => {
      const document = await client.callTool({
        name: "speckiwi_read_document",
        arguments: { id: "srs.core", includeParsed: true }
      });
      expect(document.structuredContent).toMatchObject({
        ok: true,
        documentId: "srs.core",
        path: "srs/core.yaml",
        parsed: { id: "srs.core" }
      });

      const preview = await client.callTool({
        name: "speckiwi_preview_requirement_id",
        arguments: { requirementType: "functional", scope: "core" }
      });
      expect(preview.structuredContent).toMatchObject({
        ok: true,
        generated: true,
        id: "FR-SPE-CORE-0001"
      });

      const trace = await client.callTool({
        name: "speckiwi_trace_requirement",
        arguments: { id: "FR-CORE-0001", direction: "both", depth: 1 }
      });
      expect(trace.structuredContent).toMatchObject({
        ok: true,
        requirementId: "FR-CORE-0001",
        direction: "both"
      });

      const proposal = await client.callTool({
        name: "speckiwi_propose_change",
        arguments: {
          operation: "update_requirement",
          target: { kind: "requirement", requirementId: "FR-CORE-0001" },
          changes: [{ op: "replace", path: "/requirements/0/statement", value: "The system shall apply MCP success path updates." }],
          reason: "Exercise MCP success path."
        }
      });
      expect(proposal.structuredContent).toMatchObject({
        ok: true,
        mode: "propose",
        applied: false,
        proposal: { operation: "update_requirement" }
      });
      expect(await readFile(sourcePath, "utf8")).toBe(sourceBefore);

      const proposalPath =
        typeof proposal.structuredContent?.proposal === "object" &&
        proposal.structuredContent.proposal !== null &&
        "path" in proposal.structuredContent.proposal
          ? String(proposal.structuredContent.proposal.path)
          : "";
      const applied = await client.callTool({
        name: "speckiwi_apply_change",
        arguments: { confirm: true, proposalPath }
      });
      expect(applied.structuredContent).toMatchObject({
        ok: true,
        mode: "apply",
        applied: true,
        modifiedFiles: [".speckiwi/srs/core.yaml"]
      });
      expect(await readFile(sourcePath, "utf8")).toContain("MCP success path updates");
    });
  });

  it("returns deterministic MCP error output for malformed stored proposal paths", async () => {
    const workspace = await copyFixture("speckiwi-mcp-malformed-proposal-");
    const sourcePath = join(workspace, ".speckiwi", "srs", "core.yaml");
    const before = await readFile(sourcePath, "utf8");

    await withClient(workspace, async (client) => {
      const proposal = await client.callTool({
        name: "speckiwi_propose_change",
        arguments: {
          operation: "update_requirement",
          target: { kind: "requirement", requirementId: "FR-CORE-0001" },
          changes: [{ op: "replace", path: "/requirements/0/statement", value: "The system shall reject malformed MCP proposal paths." }],
          reason: "Exercise MCP malformed proposal rejection."
        }
      });
      const proposalPath =
        typeof proposal.structuredContent?.proposal === "object" &&
        proposal.structuredContent.proposal !== null &&
        "path" in proposal.structuredContent.proposal
          ? String(proposal.structuredContent.proposal.path)
          : "";
      const proposalFile = join(workspace, proposalPath.replace(/^\.speckiwi\//, ".speckiwi/"));
      await writeFile(
        proposalFile,
        (await readFile(proposalFile, "utf8")).replace("path: /requirements/0/statement", "path: requirements/0/statement"),
        "utf8"
      );

      const rejected = await client.callTool({
        name: "speckiwi_apply_change",
        arguments: { confirm: true, proposalPath }
      });

      expect(rejected.isError).toBe(true);
      expect(rejected.structuredContent).toMatchObject({
        ok: false,
        error: { code: "PROPOSAL_SCHEMA_INVALID" },
        diagnostics: { errors: [{ details: { recovery: expect.any(String) } }] }
      });
    });
    expect(await readFile(sourcePath, "utf8")).toBe(before);
  });

  it("starts through the CLI stdio command without stdout logs", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["bin/speckiwi", "mcp", "--root", validRoot],
      cwd: root,
      stderr: "pipe"
    });
    const chunks: Buffer[] = [];
    transport.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
    const client = new Client({ name: "speckiwi-mcp-stdio-test", version: "1.0.0" });

    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(13);
    await client.close().catch((error: unknown) => {
      if (!(error instanceof McpError)) {
        throw error;
      }
    });
    expect(Buffer.concat(chunks).toString("utf8")).toBe("");
  });

  it("reuses memoized search read models and invalidates them after cache clean and rebuild", async () => {
    const workspace = await copyFixture("speckiwi-mcp-memo-");
    await rebuildCache({ root: workspace });
    const core = createSpecKiwiCore({ root: workspace });

    resetReadModelMemoStats();
    await core.search({ query: "Validate workspace", mode: "bm25" });
    await core.search({ query: "Validate workspace", mode: "bm25" });
    expect(getReadModelMemoStats()).toMatchObject({ misses: 1, hits: 1 });

    await writeFile(
      join(workspace, ".speckiwi", "srs", "core.yaml"),
      (await readFile(join(workspace, ".speckiwi", "srs", "core.yaml"), "utf8")).replace(
        "시스템은 workspace YAML 문서를 deterministic하게 validate해야 한다.",
        "The system shall expose memoized search invalidation after cache clean."
      ),
      "utf8"
    );
    await cleanCache({ root: workspace });
    const afterClean = await core.search({ query: "memoized", mode: "bm25" });
    expect(afterClean).toMatchObject({ ok: true, results: [{ id: "FR-CORE-0001" }] });

    await rebuildCache({ root: workspace });
    const afterRebuild = await core.search({ query: "memoized", mode: "bm25" });
    expect(afterRebuild).toMatchObject({ ok: true, results: [{ id: "FR-CORE-0001" }] });
    expect(getReadModelMemoStats().misses).toBeGreaterThanOrEqual(3);
  });

  it("returns structured validate diagnostics when the store directory is an external symlink", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await mkdtemp(join(tmpdir(), "speckiwi-mcp-store-symlink-"));
    const externalStore = await mkdtemp(join(tmpdir(), "speckiwi-mcp-external-store-"));
    tempRoots.push(workspace, externalStore);
    await rm(externalStore, { recursive: true, force: true });
    await cp(join(validRoot, ".speckiwi"), externalStore, { recursive: true });
    await symlink(externalStore, join(workspace, ".speckiwi"), "dir");

    await withClient(workspace, async (client) => {
      const result = await client.callTool({ name: "speckiwi_validate", arguments: {} });
      expect(result.structuredContent).toMatchObject({
        ok: false,
        valid: false,
        diagnostics: {
          errors: [{ code: "WORKSPACE_ESCAPE" }]
        }
      });
    });
  });
});

async function withClient(workspace: string, callback: (client: Client) => Promise<void>): Promise<void> {
  await withServerClient(createMcpServer({ root: workspace }), callback);
}

async function withServerClient(server: McpServer, callback: (client: Client) => Promise<void>): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "speckiwi-mcp-test", version: "1.0.0" });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await callback(client);
  } finally {
    await client.close().catch((error: unknown) => {
      if (!(error instanceof McpError)) {
        throw error;
      }
    });
    await server.close();
  }
}

async function copyFixture(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(workspace);
  await cp(validRoot, workspace, { recursive: true });
  return workspace;
}
