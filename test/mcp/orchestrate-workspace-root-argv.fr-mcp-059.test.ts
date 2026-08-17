import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { ORCHESTRATE_TOOL_BINDINGS } from "../../src/cli/commands/orchestrate.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

const observed: string[][] = [];

// The argv is the contract between the MCP surface and the CLI leaf, so it is asserted directly:
// an outcome assertion alone cannot tell a root that reached the leaf from one that was ignored.
vi.mock("../../src/cli/index.js", () => ({
  main: async (argv: string[], io: { stdout: { write(text: string): boolean } }) => {
    observed.push([...argv]);
    io.stdout.write(JSON.stringify({ ok: true }));
    return 0;
  }
}));

function serverFor(root: string) {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  registerMutationTools(server, { root });
  return server;
}

beforeEach(() => {
  observed.length = 0;
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("FR-MCP-059 — orchestrate_* tools carry a per-call workspace root into the CLI they mirror", { timeout: 180_000 }, () => {
  it("AC-1: an accepted workspaceRoot reaches the mirrored CLI leaf as its root", async () => {
    const host = await gitWorkspaceRepo("frmcp059-ac1");
    const lane = await linkedWorktree(host, "frmcp059-ac1-wt", "lane-059-ac1");
    const server = serverFor(host);

    await server.callTool("orchestrate_route_show", { workspaceRoot: lane });

    expect(observed).toHaveLength(1);
    expect(observed[0]?.slice(0, 2)).toEqual(["--root", lane]);
    expect(observed[0]).toContain("orchestrate");
  });

  it("AC-2: omitting workspaceRoot produces the argv it produces today", async () => {
    const host = await gitWorkspaceRepo("frmcp059-ac2");
    const server = serverFor(host);

    await server.callTool("orchestrate_route_show", { lock: "kiwi/route.lock.json" });

    expect(observed[0]).toEqual(["--root", host, "orchestrate", "route", "show", "--lock", "kiwi/route.lock.json", "--json"]);
  });

  it("AC-3: orchestrate_replay_apply refuses a workspaceRoot fail-closed, naming the host-root rule", async () => {
    const host = await gitWorkspaceRepo("frmcp059-ac3");
    const lane = await linkedWorktree(host, "frmcp059-ac3-wt", "lane-059-ac3");
    const server = serverFor(host);

    const refused = (await server.callTool("orchestrate_replay_apply", {
      workspaceRoot: lane,
      plan: "kiwi/replay.plan.json",
      applied: "kiwi/replay.applied.json"
    })) as { ok: boolean; error: { code: string; reason: string; message: string } };

    expect(refused.ok).toBe(false);
    expect(refused.error).toMatchObject({ reason: "workspace-root-forbidden-for-replay-apply" });
    expect(refused.error.message).toMatch(/host root/i);
    // Would pass if the tool merely ignored the argument, were it not for this: the leaf never ran.
    expect(observed, "a refused replay apply must not reach the CLI leaf").toHaveLength(0);
    expect(toolSchemas.orchestrate_replay_apply?.workspaceRoot, "the schema must not offer the field").toBeUndefined();
  });

  it("AC-4: orchestrate_preflight gains no root and no workspaceRoot", () => {
    const schema = toolSchemas.orchestrate_preflight ?? {};
    expect(Object.keys(schema)).not.toContain("workspaceRoot");
    expect(Object.keys(schema)).not.toContain("root");
    expect(Object.keys(schema)).toEqual(expect.arrayContaining(["mcpRoot", "gitRoot"]));
  });

  it("AC-1 companion: every other orchestrate row declares the field and forwards it", async () => {
    const host = await gitWorkspaceRepo("frmcp059-ac1b");
    const lane = await linkedWorktree(host, "frmcp059-ac1b-wt", "lane-059-ac1b");
    const server = serverFor(host);
    const hostFixed = new Set(["orchestrate_replay_apply", "orchestrate_preflight"]);

    for (const binding of ORCHESTRATE_TOOL_BINDINGS) {
      if (hostFixed.has(binding.tool)) continue;
      expect(toolSchemas[binding.tool]?.workspaceRoot, `${binding.tool} must declare workspaceRoot`).toBeDefined();
      observed.length = 0;
      await server.callTool(binding.tool, { workspaceRoot: lane });
      expect(observed[0]?.slice(0, 2), `${binding.tool} must forward the accepted root`).toEqual(["--root", lane]);
    }
    expect(path.isAbsolute(lane)).toBe(true);
  });
});
