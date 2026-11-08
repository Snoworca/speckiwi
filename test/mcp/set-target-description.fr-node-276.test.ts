import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { toolSchemas } from "../../src/mcp/server.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-276 AC-2 AC-3 — the CLI command and the MCP tool reach the same mutation and return the same
// value: `{ target, previousDescription, description, written }`.

const INDEX = path.join("docs", "spec", "00.index.md");

async function cli(root: string, args: string[]): Promise<{ exit: number; out: Record<string, unknown> }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "set-target-description", ...args, "--json"], streams);
  return { exit, out: JSON.parse(streams.stdout.read()?.toString() ?? "{}") as Record<string, unknown> };
}

async function mcp(root: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const server = createTestMcpServer({ root });
  registerMutationTools(server, { root });
  return (await server.callTool("set_target_description", input)) as Record<string, unknown>;
}

describe("FR-NODE-276 AC-2 — set-target-description over the CLI and set_target_description over MCP", () => {
  // @req FR-NODE-276 AC-2
  it("the MCP tool is registered as a workspace mutation with target, description, dryRun and ignoreLock", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const server = createTestMcpServer({ root });
    registerMutationTools(server, { root });
    expect(server.toolKinds.set_target_description).toBe("workspace");
    expect(Object.keys(toolSchemas.set_target_description ?? {})).toEqual(expect.arrayContaining(["target", "description", "dryRun", "ignoreLock"]));
  });

  // @req FR-NODE-276 AC-2
  it("the CLI and the MCP tool write the same cell and return the same value", async () => {
    const viaCli = await copyFixtureWorkspace("mutation-target");
    const viaMcp = await copyFixtureWorkspace("mutation-target");
    const fromCli = await cli(viaCli, ["v1.1.0", "--description", "Replaced description"]);
    const fromMcp = await mcp(viaMcp, { target: "v1.1.0", description: "Replaced description" });
    expect(fromCli.exit).toBe(0);
    const expected = { target: "v1.1.0", previousDescription: "Next fixture target", description: "Replaced description", written: true };
    expect(fromCli.out).toMatchObject({ ok: true, value: expected });
    expect(fromMcp).toMatchObject({ ok: true, value: expected });
    expect(await readFile(path.join(viaCli, INDEX), "utf8")).toBe(await readFile(path.join(viaMcp, INDEX), "utf8"));
    expect(await readFile(path.join(viaCli, INDEX), "utf8")).toContain("| v1.1.0 | version | planned | Replaced description |");
  });

  // @req FR-NODE-276 AC-2
  it("a dry run on either surface reports written false and writes nothing", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(path.join(root, INDEX), "utf8");
    const fromCli = await cli(root, ["v1.1.0", "--description", "Replaced description", "--dry-run"]);
    const fromMcp = await mcp(root, { target: "v1.1.0", description: "Replaced description", dryRun: true });
    expect(fromCli.out).toMatchObject({ ok: true, value: { written: false } });
    expect(fromMcp).toMatchObject({ ok: true, value: { written: false } });
    expect(await readFile(path.join(root, INDEX), "utf8")).toBe(before);
  });

  // @req FR-NODE-276 AC-3
  it("an unregistered target is a USAGE error with a non-zero exit on the CLI and on MCP", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const fromCli = await cli(root, ["v9.9.9", "--description", "ghost"]);
    expect(fromCli.exit).not.toBe(0);
    expect(fromCli.out).toMatchObject({ ok: false, error: { code: "USAGE" } });
    expect(await mcp(root, { target: "v9.9.9", description: "ghost" })).toMatchObject({ ok: false, error: { code: "USAGE" } });
  });

  // @req FR-NODE-276 AC-4
  it("the CLI set-active-target --description on a registered target fails and names set-target-description", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    const exit = await main(["--root", root, "set-active-target", "v1.1.0", "--description", "Replaced description", "--json"], streams);
    expect(exit).not.toBe(0);
    expect(streams.stdout.read()?.toString() ?? "").toContain("set-target-description");
  });
});
