import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-NODE-091 — attaching the unreadable file's path must not move a failure to another CLI error
// class. The CLI boundary (src/cli/index.ts classifyUnhandledError) is the one caller that classifies a
// readUtf8File failure, and it reads the error's code and message; both stay what Node wrote, so every
// document of the SRS set that the parser reads keeps the class it had: a directory where a document
// belongs is a read error (exit 2, CLI_READ_ERROR) with Node's own message.

async function runList(root: string): Promise<{ exit: number; code?: string; message?: string }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "list", "--json"], streams);
  const out = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { error?: { code?: string; message?: string } };
  return { exit, code: out.error?.code, message: out.error?.message };
}

describe("FR-NODE-091 — a document read as a directory keeps its CLI error class", () => {
  // A scope document turned into a directory is not read at all (discovery lists files only), so it is
  // not a read failure and is left out.
  for (const document of ["00.index.md", "90.appendix.md"]) {
    // @req FR-NODE-091
    it(`${document} as a directory: exit 2, CLI_READ_ERROR, Node's message`, async () => {
      const root = await copyFixtureWorkspace("valid-basic");
      const target = path.join(root, "docs", "spec", document);
      await rm(target);
      await mkdir(target);

      expect(await runList(root)).toEqual({ exit: 2, code: "CLI_READ_ERROR", message: "EISDIR: illegal operation on a directory, read" });
    });
  }
});
