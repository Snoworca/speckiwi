import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-070 AC-1: a read response serializes each diagnostic entry at most once.

let call: (name: string, args?: Record<string, unknown>) => Promise<{ text: string; json: Record<string, unknown> }>;
let requirementId = "";

beforeAll(async () => {
  const root = await copyFixtureWorkspace("problem-matrix");
  const sdk = createSdkServer(createMcpServer({ root, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "verify", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  call = async (name, args = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
    const text = result.content.find((item) => item.type === "text")?.text ?? "{}";
    return { text, json: JSON.parse(text) as Record<string, unknown> };
  };
  const list = await call("list_requirements", { limit: 1 });
  requirementId = ((list.json.value as { records: Array<{ id: string }> }).records[0]?.id) ?? "";
});

function occurrences(text: string, entry: unknown): number {
  const needle = JSON.stringify(entry);
  return text.split(needle).length - 1;
}

describe("FR-MCP-070 AC-1 — each diagnostic entry serialized at most once", () => {
  it.each([
    { tool: "validate_spec", args: () => ({}) }
  ])("$tool serializes every diagnostic entry once", async ({ tool, args }) => {
    const { text, json } = await call(tool, args());
    const value = (json.value ?? json) as { diagnostics: unknown[] };
    expect(value.diagnostics.length).toBeGreaterThan(0);
    const repeated = value.diagnostics.map((entry) => occurrences(text, entry)).filter((count) => count > 1);
    expect(repeated, `bytes=${text.length}; entries=${value.diagnostics.length}`).toEqual([]);
  });
});
