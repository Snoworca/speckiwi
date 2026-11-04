import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

let call: (name: string, args: Record<string, unknown>) => Promise<{ text: string; json: Record<string, unknown> }>;

beforeAll(async () => {
  const root = await copyFixtureWorkspace("problem-matrix");
  const sdk = createSdkServer(createMcpServer({ root, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "verify-r3", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  call = async (name, args) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
    const text = result.content.find((item) => item.type === "text")?.text ?? "{}";
    return { text, json: JSON.parse(text) as Record<string, unknown> };
  };
});

function entryCounts(value: unknown, counts = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(value)) for (const item of value) entryCounts(item, counts);
  else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.code === "string" && typeof record.message === "string" && typeof record.severity === "string") {
      const key = JSON.stringify(record);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const item of Object.values(record)) entryCounts(item, counts);
  }
  return counts;
}
const repeated = (value: unknown) => [...entryCounts(value).values()].filter((count) => count > 1);

describe("verify r3 — get_next_work_order profiles", () => {
  it("explain profile lists each diagnostic entry once", async () => {
    const { json } = await call("get_next_work_order", { explain: true });
    expect(json.decisionTrace).toBeDefined();
    expect(repeated(json)).toEqual([]);
  });

  it("measure: compactBytes measures the response the MCP client actually receives", async () => {
    const { json } = await call("get_next_work_order", { measure: true });
    const measurement = json.measurement as { compactBytes: number };
    const withoutMeasurement = { ...json };
    delete withoutMeasurement.measurement;
    expect(measurement.compactBytes).toBe(Buffer.byteLength(JSON.stringify(withoutMeasurement)));
  });
});
