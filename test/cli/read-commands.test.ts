import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("read-only CLI commands", () => {
  it("validates, lists, shows, summarizes, and checks links", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    for (const args of [
      ["--root", root, "validate", "--json"],
      ["--root", root, "list", "--json"],
      ["--root", root, "show", "FR-ARCH-001", "--json", "--markdown"],
      ["--root", root, "summary", "--json"],
      ["--root", root, "links", "check", "--json"]
    ]) {
      const streams = io();
      const code = await main(args, streams);
      expect(code).toBe(0);
      expect(() => JSON.parse(streams.stdout.read()?.toString() ?? "")).not.toThrow();
    }
  });
});
