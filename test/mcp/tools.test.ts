import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/server.js";
import { machineResultOutputSchema } from "../../src/mcp/structured-content.js";

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
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("mcp tools", () => {
  it("registers all required tools with closed input schemas", async () => {
    await withClient(validRoot, async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(requiredTools);
      expect(listed.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
      expect(listed.tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
      expect(listed.tools.every((tool) => tool.outputSchema?.type === "object")).toBe(true);
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
});

async function withClient(workspace: string, callback: (client: Client) => Promise<void>): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "speckiwi-mcp-test", version: "1.0.0" });
  const server = createMcpServer({ root: workspace });

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
