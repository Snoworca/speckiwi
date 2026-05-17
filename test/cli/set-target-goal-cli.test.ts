import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("FR-MCP-019 CLI — set-target-goal", () => {
  it("sets a target goal successfully", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const exit = await main(
      ["--root", root, "set-target-goal", "v1.0.0", "--goal", "CLI goal", "--json"],
      streams
    );
    expect(exit).toBe(0);
    const out = JSON.parse(streams.stdout.read()?.toString() ?? "{}");
    expect(out.ok).toBe(true);
  });

  it("returns non-zero exit for non-existent target", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const exit = await main(
      ["--root", root, "set-target-goal", "v9.9.9", "--goal", "ghost", "--json"],
      streams
    );
    expect(exit).not.toBe(0);
  });

  it("returns non-zero exit for empty goal", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const exit = await main(
      ["--root", root, "set-target-goal", "v1.0.0", "--goal", "   ", "--json"],
      streams
    );
    expect(exit).not.toBe(0);
  });
});
