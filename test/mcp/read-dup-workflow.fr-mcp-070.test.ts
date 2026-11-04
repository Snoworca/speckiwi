import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-MCP-070 AC-1 — the two read-only MCP tools outside the read-envelope family that answered
// with the same diagnostic entry more than once: get_next_work_order (a duplicated list, plus the
// blocking errors copied out of it) and diagnose_requirement_id_collisions (each group's diagnostic
// copied beside the top-level list). Each entry is now serialized once.

interface Entry {
  code: string;
  severity: string;
  message: string;
  details?: { duplicateId?: string };
}

let call: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;

beforeAll(async () => {
  const root = await copyFixtureWorkspace("problem-matrix");
  const sdk = createSdkServer(createMcpServer({ root, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-mcp-070-workflow", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  call = async (name, args = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
    return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Record<string, unknown>;
  };
});

/** How many times each full diagnostic entry (code, severity and message) is serialized anywhere. */
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

function repeated(value: unknown): number[] {
  return [...entryCounts(value).values()].filter((count) => count > 1);
}

describe("FR-MCP-070 AC-1 — workflow and repair readers list each entry once", () => {
  // @req FR-MCP-070 AC-1
  it("get_next_work_order lists each entry once and as many as its summary counts", async () => {
    const order = await call("get_next_work_order");
    const diagnostics = order.diagnostics as Entry[];
    const summary = order.diagnosticsSummary as { errors: number; warnings: number };
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(repeated(order)).toEqual([]);
    expect(diagnostics).toHaveLength(summary.errors + summary.warnings);
  });

  // @req FR-MCP-070 AC-1
  it("get_next_work_order names each blocking error by its place in diagnostics", async () => {
    const order = await call("get_next_work_order");
    const diagnostics = order.diagnostics as Entry[];
    const blocking = order.blockingDiagnostics as Array<{ index: number; code: string }>;
    const summary = order.diagnosticsSummary as { errors: number };
    expect(blocking).toHaveLength(summary.errors);
    expect(blocking.length).toBeGreaterThan(0);
    for (const reference of blocking) {
      expect(diagnostics[reference.index]?.code).toBe(reference.code);
      expect(diagnostics[reference.index]?.severity).toBe("error");
    }
    expect(new Set(blocking.map((reference) => reference.index)).size).toBe(blocking.length);
  });

  // @req FR-MCP-070 AC-1
  it("get_next_work_order with explain names its blockers by place too, listing each entry once", async () => {
    const order = await call("get_next_work_order", { explain: true });
    const diagnostics = order.diagnostics as Entry[];
    const blockers = order.blockers as Array<{ index: number; code: string }>;
    const summary = order.diagnosticsSummary as { errors: number };
    expect(order.decisionTrace).toBeDefined();
    expect(repeated(order)).toEqual([]);
    expect(blockers).toHaveLength(summary.errors);
    for (const reference of blockers) {
      expect(diagnostics[reference.index]?.code).toBe(reference.code);
      expect(diagnostics[reference.index]?.severity).toBe("error");
    }
  });

  // @req FR-MCP-024 AC-2
  it("get_next_work_order with measure measures the response the client receives", async () => {
    const order = await call("get_next_work_order", { measure: true });
    const measurement = order.measurement as { baselineBytes: number; compactBytes: number; compactApproxTokens: number; reductionRatio: number };
    const { measurement: _measurement, ...rest } = order;
    const bytes = Buffer.byteLength(JSON.stringify(rest));
    expect(rest.mcpWorkspace).toBeDefined();
    expect(measurement.compactBytes).toBe(bytes);
    expect(measurement.compactApproxTokens).toBe(Math.ceil(bytes / 4));
    expect(measurement.reductionRatio).toBe(bytes / measurement.baselineBytes);
  });

  // @req FR-MCP-070 AC-1
  it("diagnose_requirement_id_collisions keeps each group's diagnostic only in the top-level list", async () => {
    const answer = await call("diagnose_requirement_id_collisions");
    expect(answer.ok).toBe(true);
    const groups = (answer.value as { groups: Array<Record<string, unknown> & { duplicateId: string }> }).groups;
    const diagnostics = answer.diagnostics as Entry[];
    expect(groups.length).toBeGreaterThan(0);
    expect(repeated(answer)).toEqual([]);
    expect(groups.every((group) => !("diagnostic" in group))).toBe(true);
    expect(diagnostics.map((entry) => entry.details?.duplicateId)).toEqual(groups.map((group) => group.duplicateId));
  });
});
