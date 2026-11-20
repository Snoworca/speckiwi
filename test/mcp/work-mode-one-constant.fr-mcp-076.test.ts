import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { workModeRefusal } from "../../src/core/mutation/work-mode.js";
import { WORK_MODES } from "../../src/core/types.js";
import { createMcpServer, createSdkServer } from "../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req FR-MCP-076 — the FR-MCP-075 inventory found the mode closed by a list in the MCP handler and a
// Set in the CLI, written by hand, and no constant to describe the MCP field from; merging them found
// two more deciding copies, in the state.md parser and in route-probe.

type Answer = { ok: boolean; value?: { mode?: string }; error?: { code: string; message: string } };

/** The refusal both surfaces gave before the change, byte for byte. */
const BEFORE = (value: string) => `Invalid mode: ${value} (expected sdd, vibe, wait, or tdd)`;

async function workspace(): Promise<string> {
  const root = await copyFixtureWorkspace("valid-basic");
  await mkdir(path.join(root, "docs", "spec", "steps"), { recursive: true });
  await writeFile(path.join(root, "docs", "spec", "steps", "state.md"), "# Step State\n\nMode: sdd\n\n| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |\n| --- | --- | --- | --- | --- | --- | --- |\n", "utf8");
  return root;
}

async function mcp(root: string, tool: string, args: Record<string, unknown>): Promise<Answer> {
  return (await createMcpServer({ root }).callTool(tool, args)) as Answer;
}

async function cli(root: string, argv: string[]): Promise<{ code: number; answer: Answer }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...argv, "--json"], streams);
  return { code, answer: JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Answer };
}

describe("FR-MCP-076 AC-1 — the MCP mode field describes the modes", () => {
  // @req FR-MCP-076 AC-1
  it("set_work_mode mode lists every value of WORK_MODES and stays a plain string", async () => {
    const sdk = createSdkServer(createMcpServer({ root: process.cwd(), rootSource: "server-cwd-discovery" }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sdk.connect(serverTransport);
    const client = new Client({ name: "fr-mcp-076", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    await client.close();
    const field = (tools.tools.find((tool) => tool.name === "set_work_mode")?.inputSchema as { properties?: Record<string, { type?: string; enum?: unknown; description?: string }> }).properties?.mode;
    expect(field?.type).toBe("string");
    expect(field?.enum).toBeUndefined();
    const words = (field?.description ?? "").split(/[\s,;:]+/);
    for (const mode of WORK_MODES) expect(words).toContain(mode);
  });
});

describe("FR-MCP-076 AC-2 — one refusal, unchanged, on both surfaces", () => {
  // @req FR-MCP-076 AC-2
  it("MCP and CLI refuse with INVALID_MODE and the message they gave before, from one function", async () => {
    const root = await workspace();
    expect(workModeRefusal("tddx")?.error).toEqual({ code: "INVALID_MODE", message: BEFORE("tddx") });
    const viaMcp = await mcp(root, "set_work_mode", { mode: "tddx" });
    expect(viaMcp.error).toEqual({ code: "INVALID_MODE", message: BEFORE("tddx") });
    const viaCli = await cli(root, ["mode", "tddx"]);
    expect(viaCli.code).toBe(2);
    expect(viaCli.answer.error?.code).toBe("INVALID_MODE");
    expect(viaCli.answer.error?.message).toBe(BEFORE("tddx"));
  });
});

describe("FR-MCP-076 AC-3 — every mode is still taken, and the parser reads it back", () => {
  // @req FR-MCP-076 AC-3
  it("each mode is accepted by MCP and CLI and read back by get_work_mode", async () => {
    expect([...WORK_MODES]).toEqual(["sdd", "vibe", "wait", "tdd"]);
    for (const mode of WORK_MODES) {
      expect(workModeRefusal(mode), mode).toBeUndefined();
      const root = await workspace();
      expect((await mcp(root, "set_work_mode", { mode })).ok, mode).toBe(true);
      expect((await mcp(root, "get_work_mode", {})).value?.mode, mode).toBe(mode);
      const other = await workspace();
      expect((await cli(other, ["mode", mode])).code, mode).toBe(0);
      expect((await cli(other, ["mode"])).answer.value?.mode, mode).toBe(mode);
    }
  });
});
