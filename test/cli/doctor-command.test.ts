import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function stream() {
  return new PassThrough() as NodeJS.WriteStream;
}

function io() {
  return { stdout: stream(), stderr: stream() };
}

describe("speckiwi doctor", () => {
  it("OPS-NODE-003 emits structured JSON diagnostics for package and MCP smoke checks", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const streams = io();

    expect(await main(["--root", root, "doctor", "--json"], streams)).toBe(0);
    const output = JSON.parse(streams.stdout.read()?.toString() ?? "");

    expect(output).toMatchObject({
      ok: true,
      package: { name: "speckiwi", version: expect.stringMatching(/^\d+\.\d+\.\d+/) },
      workspace: { activeTarget: "v1.0.0" },
      summary: { fail: 0 }
    });
    expect(output.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "mcp-active-target-read", status: "pass" }),
        expect.objectContaining({ id: "mcp-validation-read", status: "pass" }),
        expect.objectContaining({ id: "mcp-dry-run-mutation", status: "pass" })
      ])
    );
  });
});
