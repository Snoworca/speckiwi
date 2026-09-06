import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

describe("FR-NODE-202 CLI — append-note refuses a mode it does not recognise", () => {
  /**
   * The CLI has no enum for `--mode`; the MCP surface does. The core treats anything that is not
   * `append` as `replace`, so before this requirement a typo did not fail, it took the destructive
   * branch and overwrote the section the caller meant to add to.
   */
  it("AC-7 --mode bogus exits non-zero and leaves the section byte-identical", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(path.join(root, ARCH_FILE), "utf8");
    const streams = io();

    const exit = await main(
      ["--root", root, "append-note", "FR-ARCH-001", "--section", "implementation_notes", "--text", "typo", "--mode", "bogus", "--json"],
      streams
    );

    expect(exit).not.toBe(0);
    const out = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { ok?: boolean; error?: { code?: string } };
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe("USAGE");
    await expect(readFile(path.join(root, ARCH_FILE), "utf8")).resolves.toBe(before);
  });

  it("AC-2 --mode replace accepts text longer than the append cap through the CLI", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const long = `CLI REWRITE ${"q".repeat(900)}`;
    const streams = io();

    const exit = await main(
      ["--root", root, "append-note", "FR-ARCH-001", "--section", "implementation_notes", "--text", long, "--mode", "replace", "--json"],
      streams
    );

    expect(exit).toBe(0);
    await expect(readFile(path.join(root, ARCH_FILE), "utf8")).resolves.toContain(long);
  });
});
