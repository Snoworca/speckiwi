import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("FR-MCP-018 CLI — append-note", () => {
  it("appends a note successfully", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const exit = await main(
      ["--root", root, "append-note", "FR-ARCH-001", "--section", "rationale", "--text", "cli note", "--json"],
      streams
    );
    expect(exit).toBe(0);
    const out = JSON.parse(streams.stdout.read()?.toString() ?? "{}");
    expect(out.ok).toBe(true);
  });

  it("rejects deny-list section with non-zero exit", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const exit = await main(
      ["--root", root, "append-note", "FR-ARCH-001", "--section", "verification_evidence", "--text", "blocked", "--json"],
      streams
    );
    expect(exit).not.toBe(0);
  });

  it("defaults mode to append when --mode is omitted", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = io();
    const exit = await main(
      ["--root", root, "append-note", "FR-ARCH-001", "--section", "rationale", "--text", "default mode", "--json"],
      streams
    );
    expect(exit).toBe(0);
    const out = JSON.parse(streams.stdout.read()?.toString() ?? "{}");
    expect(out.value.mode).toBe("append");
  });
});
