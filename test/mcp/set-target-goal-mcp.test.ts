import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("FR-MCP-019 MCP — set_target_goal", () => {
  it("registers with kind=workspace", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    expect(server.toolKinds.set_target_goal).toBe("workspace");
  });

  it("writes a Goal block via callTool", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const result = await server.callTool("set_target_goal", { target: "v1.0.0", goal: "MCP goal" });
    expect(result).toMatchObject({ ok: true });
  });

  it("returns NOT_FOUND for unregistered target", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    const result = await server.callTool("set_target_goal", { target: "v9.9.9", goal: "ghost" });
    expect(result).toMatchObject({ ok: false });
  });

  it("architectural guard: set_target_goal is NOT registered in src/mcp/tools/read-tools.ts (AC-8)", async () => {
    const text = await readFile(path.resolve(process.cwd(), "src/mcp/tools/read-tools.ts"), "utf8");
    expect(text).not.toContain("set_target_goal");
  });
});
