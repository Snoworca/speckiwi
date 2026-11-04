import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-070 AC-1 / user complaint "the same diagnostics up to three times in one response":
// read-only MCP tools outside the read-envelope family must also serialize each entry once.

let call: (name: string, args?: Record<string, unknown>) => Promise<{ text: string; json: Record<string, unknown> }>;

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
});

function diagnosticEntries(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => diagnosticEntries(item, out));
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.code === "string" && typeof record.message === "string" && "severity" in record) out.push(JSON.stringify(record));
    Object.values(record).forEach((item) => diagnosticEntries(item, out));
  }
  return out;
}

function repeated(json: unknown): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entry of diagnosticEntries(json)) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([entry, count]) => [entry.slice(0, 120), count]);
}

describe("read-only MCP tools serialize each diagnostic entry at most once", () => {
  it("get_next_work_order", async () => {
    const { json } = await call("get_next_work_order");
    expect(repeated(json)).toEqual([]);
  });

  it("get_next_work_order diagnostics array length equals diagnosticsSummary errors+warnings", async () => {
    const { json } = await call("get_next_work_order");
    const summary = json.diagnosticsSummary as { errors: number; warnings: number };
    expect((json.diagnostics as unknown[]).length).toBe(summary.errors + summary.warnings);
  });

  it("diagnose_requirement_id_collisions", async () => {
    const { json } = await call("diagnose_requirement_id_collisions");
    expect(repeated(json)).toEqual([]);
  });
});
