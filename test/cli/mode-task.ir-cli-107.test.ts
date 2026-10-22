import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { findSpecByCliName, renderToolSchemas } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// @req IR-CLI-107 — without --task a CLI switch to vibe/tdd drops the Active Task, and the vibe gate
// never blocks without one.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

async function workspaceWithState(): Promise<{ root: string; statePath: string }> {
  const root = await copyFixtureWorkspace("valid-basic");
  const stepsDir = path.join(root, "docs", "spec", "steps");
  await mkdir(stepsDir, { recursive: true });
  const statePath = path.join(stepsDir, "state.md");
  await writeFile(
    statePath,
    ["# Step State", "", "Mode: sdd", "", "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |", "| --- | --- | --- | --- | --- | --- | --- |", ""].join("\n"),
    "utf8"
  );
  return { root, statePath };
}

async function run(args: string[]): Promise<{ code: number; stdout: string }> {
  const streams = io();
  const code = await main(args, streams);
  return { code, stdout: drain(streams.stdout) };
}

describe("IR-CLI-107 speckiwi mode --task", () => {
  it.each([["vibe"], ["tdd"]])("IR-CLI-107 AC-1: `mode %s --task` writes the Active Task and a read reports it", async (mode) => {
    const { root, statePath } = await workspaceWithState();

    const switched = await run(["--root", root, "mode", mode, "--task", "T-42", "--json"]);
    expect(switched.code).toBe(0);
    expect(JSON.parse(switched.stdout).value).toMatchObject({ mode, activeTask: "T-42" });
    const persisted = await readFile(statePath, "utf8");
    expect(persisted).toMatch(new RegExp(`^Mode: ${mode}$`, "m"));
    expect(persisted).toMatch(/^Active Task: T-42$/m);

    const read = await run(["--root", root, "mode", "--json"]);
    expect(JSON.parse(read.stdout).value).toMatchObject({ mode, activeTask: "T-42" });
  });

  it.each([
    [["mode", "sdd", "--task", "T-42"]],
    [["mode", "wait", "--task", "T-42"]],
    [["mode", "--task", "T-42"]],
    [["mode", "vibe", "--task", ""]]
  ])("IR-CLI-107 AC-2: %j is a usage error (exit 2) that writes nothing", async (args) => {
    const { root, statePath } = await workspaceWithState();
    const before = await readFile(statePath, "utf8");

    const result = await run(["--root", root, ...args, "--json"]);

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).ok).toBe(false);
    expect(await readFile(statePath, "utf8")).toBe(before);
  });

  it.each([["T|42"], ["T\n42"]])("IR-CLI-107 AC-3: the state-cell guard refuses %j and nothing is written", async (task) => {
    const { root, statePath } = await workspaceWithState();
    const before = await readFile(statePath, "utf8");

    const result = await run(["--root", root, "mode", "vibe", "--task", task, "--json"]);

    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(false);
    expect(await readFile(statePath, "utf8")).toBe(before);
  });

  it("IR-CLI-107 AC-4: the registry declares --task on mode, the catalogue lists it, get_work_mode is unchanged", async () => {
    expect(findSpecByCliName("mode")!.options.map((option) => option.flag)).toContain("--task <name>");
    const { root } = await workspaceWithState();
    const catalogue = await run(["--root", root, "commands", "--json"]);
    const entry = (JSON.parse(catalogue.stdout) as { commands: Array<{ name: string; options: Array<{ flag: string }> }> }).commands.find((candidate) => candidate.name === "mode");
    expect(entry?.options.map((option) => option.flag)).toContain("--task <name>");
    expect(Object.keys(renderToolSchemas().get_work_mode ?? {})).toEqual(["workspaceRoot"]);
  });
});
