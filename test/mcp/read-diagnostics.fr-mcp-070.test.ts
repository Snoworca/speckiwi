import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { splitDiagnostics, summarizeDiagnostics } from "../../src/core/diagnostic.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import type { Diagnostic } from "../../src/core/types.js";
import { MCP_READ_DIAGNOSTICS_LIMIT } from "../../src/mcp/read-diagnostics.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-MCP-070 — an MCP read response carries its diagnostic entries once, bounded by default,
// with an explicit path to all of them. Calls go through an SDK client so `includeAllDiagnostics`
// must survive the tool's argument schema to have any effect.

type Response = Record<string, unknown> & {
  ok: boolean;
  value?: Record<string, unknown> & { diagnostics?: Diagnostic[]; diagnosticsTruncation?: unknown };
  diagnostics?: Diagnostic[];
  diagnosticsSummary?: unknown;
};

let call: (name: string, args?: Record<string, unknown>) => Promise<Response>;
let descriptions: Map<string, string>;
let total: number;
let fullSummary: unknown;
let requirementId: string;

beforeAll(async () => {
  const root = await copyFixtureWorkspace("problem-matrix");
  const workspace = await parseWorkspace(await resolveProjectRoot(process.cwd(), root));
  const all = [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics];
  total = splitDiagnostics(all).diagnostics.length;
  fullSummary = summarizeDiagnostics(all);
  requirementId = workspace.records[0]?.id ?? "";
  expect(total, "the fixture must hold more diagnostics than the default limit").toBeGreaterThan(MCP_READ_DIAGNOSTICS_LIMIT);

  const sdk = createSdkServer(createMcpServer({ root, rootSource: "server-cwd-discovery" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await sdk.connect(serverTransport);
  const client = new Client({ name: "fr-mcp-070", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  call = async (name, args = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text: string }> };
    return JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}") as Response;
  };
  descriptions = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.description ?? ""]));
});

const BOUNDED: Array<{ tool: string; args: () => Record<string, unknown> }> = [
  { tool: "get_requirement", args: () => ({ id: requirementId }) },
  { tool: "list_requirements", args: () => ({}) },
  { tool: "search_requirements", args: () => ({ query: "requirement" }) },
  { tool: "summarize_target", args: () => ({}) },
  { tool: "get_active_target", args: () => ({}) },
  { tool: "list_completed_work", args: () => ({}) },
  { tool: "mcp_workspace_info", args: () => ({}) }
];

describe("FR-MCP-070 — MCP read diagnostics", () => {
  // @req FR-MCP-070 AC-1
  it.each([...BOUNDED, { tool: "validate_spec", args: () => ({}) }])(
    "AC-1: $tool serializes the entries in the value only, with the summary kept at top level",
    async ({ tool, args }) => {
      const response = await call(tool, args());
      expect(response.ok, JSON.stringify(response).slice(0, 300)).toBe(true);
      expect(Array.isArray(response.value?.diagnostics)).toBe(true);
      expect(response.value?.diagnostics?.length).toBeGreaterThan(0);
      expect("diagnostics" in response, "no top-level copy of the entries").toBe(false);
      expect(response.diagnosticsSummary).toEqual(fullSummary);
    }
  );

  // @req FR-MCP-070 AC-1
  it.each(BOUNDED)("AC-1: $tool lists each entry once, without errors/warnings copies, bounded or not", async ({ tool, args }) => {
    for (const extra of [{}, { includeAllDiagnostics: true }]) {
      const response = await call(tool, { ...args(), ...extra });
      const entries = response.value?.diagnostics ?? [];
      expect(entries.length).toBeGreaterThan(0);
      expect("errors" in (response.value ?? {}), "no errors copy in the value").toBe(false);
      expect("warnings" in (response.value ?? {}), "no warnings copy in the value").toBe(false);
      // Each listed entry is serialized exactly once anywhere in the response.
      const text = JSON.stringify(response);
      for (const entry of entries) expect(text.split(JSON.stringify(entry)).length - 1, entry.code).toBe(1);
    }
  });

  // @req FR-MCP-070 AC-1
  it("AC-1: validate_spec lists every entry once with its severity, plus summary, and no errors/warnings copies", async () => {
    const response = await call("validate_spec");
    const entries = response.value?.diagnostics ?? [];
    expect(entries).toHaveLength(total);
    expect(response.value?.summary).toEqual(fullSummary);
    expect("errors" in (response.value ?? {}) || "warnings" in (response.value ?? {})).toBe(false);
    expect("diagnostics" in response).toBe(false);
    const severities = { errors: entries.filter((item) => item.severity === "error").length, warnings: entries.filter((item) => item.severity === "warning").length };
    expect(severities.errors + severities.warnings).toBe(total);
    expect(severities.errors).toBeGreaterThan(0);
    expect(severities.warnings).toBeGreaterThan(0);
    const text = JSON.stringify(response);
    for (const entry of entries) expect(text.split(JSON.stringify(entry)).length - 1, entry.code).toBe(1);
  });

  // @req FR-MCP-070 AC-2
  it.each(BOUNDED)("AC-2: $tool bounds the entries by default and says so", async ({ tool, args }) => {
    const response = await call(tool, args());
    expect(response.value?.diagnostics).toHaveLength(MCP_READ_DIAGNOSTICS_LIMIT);
    expect(response.value?.diagnosticsTruncation).toEqual({ total, returned: MCP_READ_DIAGNOSTICS_LIMIT, limit: MCP_READ_DIAGNOSTICS_LIMIT });
    expect(response.value?.diagnosticsSummary).toEqual(fullSummary);
    const description = descriptions.get(tool) ?? "";
    expect(description).toContain(`${MCP_READ_DIAGNOSTICS_LIMIT} entries`);
    expect(description).toContain("includeAllDiagnostics");
  });

  // @req FR-MCP-070 AC-3
  it.each(BOUNDED)("AC-3: $tool returns every entry when includeAllDiagnostics is true", async ({ tool, args }) => {
    const response = await call(tool, { ...args(), includeAllDiagnostics: true });
    expect(response.value?.diagnostics).toHaveLength(total);
    expect(response.value?.diagnosticsTruncation).toBeUndefined();
  });

  // @req FR-MCP-070 AC-3
  it("AC-3: validate_spec returns every entry without being asked", async () => {
    const response = await call("validate_spec");
    expect(response.value?.diagnostics).toHaveLength(total);
    expect(response.value?.diagnosticsTruncation).toBeUndefined();
  });

  // @req FR-MCP-070 AC-2
  it("AC-2: a get_requirement refusal bounds its diagnostics too and still counts them all", async () => {
    const response = await call("get_requirement", { id: "FR-NONE-999" });
    expect(response.ok).toBe(false);
    expect(response.diagnostics).toHaveLength(MCP_READ_DIAGNOSTICS_LIMIT);
    expect(response.diagnosticsSummary).toEqual(fullSummary);
    expect(response.diagnosticsTruncation).toEqual({ total, returned: MCP_READ_DIAGNOSTICS_LIMIT, limit: MCP_READ_DIAGNOSTICS_LIMIT });

    const all = await call("get_requirement", { id: "FR-NONE-999", includeAllDiagnostics: true });
    expect(all.diagnostics).toHaveLength(total);
  });
});
