import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Command } from "commander";
import { afterAll, describe, expect, it } from "vitest";
import { buildCommand } from "../../src/cli/command.js";
import { registerOrchestrateCommands, ORCHESTRATE_TOOL_BINDINGS, orchestrateArgv } from "../../src/cli/commands/orchestrate.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree, tempDir } from "./support/workspace-root-fixture.js";

function preflightBinding() {
  const binding = ORCHESTRATE_TOOL_BINDINGS.find((item) => item.tool === "orchestrate_preflight");
  expect(binding, "orchestrate_preflight must be bound").toBeDefined();
  return binding!;
}

/** The preflight leaf as Commander registered it — the authority AC-4 derives its expectation from. */
function preflightLeaf(): Command {
  const io = { stdout: new PassThrough() as unknown as NodeJS.WriteStream, stderr: new PassThrough() as unknown as NodeJS.WriteStream };
  const command = buildCommand({ io });
  registerOrchestrateCommands(command, { io });
  const orchestrate = command.commands.find((sub) => sub.name() === "orchestrate") as Command;
  return orchestrate.commands.find((sub) => sub.name() === "preflight") as Command;
}

function serverFor(root: string) {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  return server;
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("IR-MCP-005 — orchestrate_preflight lets a lane declare that it is a lane", { timeout: 180_000 }, () => {
  it("AC-1: the schema declares role, laneId and lanePlan, and the argv carries the leaf's flags", () => {
    const schema = toolSchemas.orchestrate_preflight ?? {};
    for (const field of ["role", "laneId", "lanePlan"]) {
      expect(Object.keys(schema), `orchestrate_preflight must declare ${field}`).toContain(field);
    }
    const argv = orchestrateArgv(preflightBinding(), {
      mcpRoot: "/host",
      gitRoot: "/lane",
      role: "lane",
      laneId: "lane-1",
      lanePlan: "/plan/lanes.lock.json"
    });
    expect(argv).toEqual(expect.arrayContaining(["--role", "lane", "--lane-id", "lane-1", "--lane-plan", "/plan/lanes.lock.json"]));
  });

  it("AC-2: role lane passes against a linked worktree where the undeclared call is refused", async () => {
    const host = await gitWorkspaceRepo("irmcp005-ac2");
    const lane = await linkedWorktree(host, "irmcp005-ac2-wt", "lane-irmcp005-ac2");
    const planDir = await tempDir("irmcp005-ac2-plan");
    const lanePlan = path.join(planDir, "lanes.lock.json");
    await writeFile(lanePlan, JSON.stringify({ "lane-1": { writeSet: ["src/a.ts"] } }), "utf8");
    const server = serverFor(host);

    const declared = (await server.callTool("orchestrate_preflight", {
      mcpRoot: host,
      gitRoot: lane,
      role: "lane",
      laneId: "lane-1",
      lanePlan
    })) as Record<string, unknown>;
    expect(declared, JSON.stringify(declared)).toMatchObject({ ok: true, topology: "linked-worktree", exitCode: 0 });

    // The same arguments without the role declaration are refused: only the contrast shows the
    // flags changed the verdict rather than the fixture.
    const undeclared = (await server.callTool("orchestrate_preflight", { mcpRoot: host, gitRoot: lane })) as Record<string, unknown>;
    expect(undeclared).toMatchObject({ gate: "run-root-preflight-mismatch", exitCode: 2 });

    // `host-root-is-a-linked-worktree` is the topology gate's own reason, and it is reachable only
    // when both roots ARE the worktree — with the roots differing the equality gate refuses first
    // with `roots-differ`. Asserted here so the named reason is still covered.
    const hostInWorktree = (await server.callTool("orchestrate_preflight", { mcpRoot: lane, gitRoot: lane })) as Record<string, unknown>;
    expect(hostInWorktree).toMatchObject({ gate: "run-root-preflight-mismatch", exitCode: 2 });
    expect(JSON.stringify(hostInWorktree)).toContain("host-root-is-a-linked-worktree");
  });

  it("AC-3: a lane declaration without a lane id, or with an unplanned lane id, is refused", async () => {
    const host = await gitWorkspaceRepo("irmcp005-ac3");
    const lane = await linkedWorktree(host, "irmcp005-ac3-wt", "lane-irmcp005-ac3");
    const planDir = await tempDir("irmcp005-ac3-plan");
    const lanePlan = path.join(planDir, "lanes.lock.json");
    await writeFile(lanePlan, JSON.stringify({ "lane-1": { writeSet: ["src/a.ts"] } }), "utf8");
    const server = serverFor(host);

    const noId = (await server.callTool("orchestrate_preflight", { mcpRoot: host, gitRoot: lane, role: "lane", lanePlan })) as { exitCode?: number };
    expect(noId.exitCode, "a lane without --lane-id must not pass").not.toBe(0);
    expect(JSON.stringify(noId), "the refusal must name the missing lane id, not the topology").toContain("--lane-id");

    const unplanned = (await server.callTool("orchestrate_preflight", {
      mcpRoot: host,
      gitRoot: lane,
      role: "lane",
      laneId: "lane-not-in-plan",
      lanePlan
    })) as { exitCode?: number; gate?: string };
    expect(unplanned.exitCode, "a lane id absent from the frozen plan must not pass").not.toBe(0);
    expect(unplanned.gate, "an unplanned lane is refused by the topology gate itself").toBe("run-root-preflight-mismatch");
  });

  it("AC-4: every option the preflight leaf defines is present in its MCP binding", () => {
    // Derived from the command definition, so an option added to the leaf and forgotten in the
    // binding fails here rather than shipping uncallable over MCP.
    const leafFlags = preflightLeaf()
      .options.map((option) => option.long)
      .filter((long): long is string => typeof long === "string" && long !== "--json");
    const boundFlags = preflightBinding().options.map((option) => option.flag);
    expect(leafFlags.length).toBeGreaterThan(0);
    expect(boundFlags).toEqual(expect.arrayContaining(leafFlags));
  });
});
