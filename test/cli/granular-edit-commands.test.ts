import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function runJson<T = Record<string, unknown>>(root: string, args: string[]): Promise<T> {
  const streams = io();
  const code = await main(["--root", root, ...args, "--json"], streams);
  const stdout = streams.stdout.read()?.toString() ?? "";
  expect(code, stdout || streams.stderr.read()?.toString()).toBe(0);
  return JSON.parse(stdout) as T;
}

describe("FR-NODE-019 CLI granular edit commands", () => {
  it("updates requirement fields and replaces acceptance criteria through official commands", async () => {
    const root = await copyFixtureWorkspace("mutation-target");

    const fields = await runJson<{ ok: true; value: { written: boolean } }>(root, [
      "edit-requirement",
      "FR-ARCH-001",
      "--title",
      "CLI edited requirement",
      "--statement",
      "CLI edits structured requirement text.",
      "--priority",
      "medium",
      "--tags",
      "cli,granular"
    ]);
    expect(fields.value.written).toBe(true);

    const ac = await runJson<{ ok: true; value: { written: boolean } }>(root, [
      "replace-acceptance-criteria",
      "FR-ARCH-001",
      "--items",
      JSON.stringify([{ text: "CLI criterion one", checked: true }, { text: "CLI criterion two" }])
    ]);
    expect(ac.value.written).toBe(true);

    const text = await readFile(path.join(root, "docs/spec/10.product-architecture.srs.md"), "utf8");
    expect(text).toContain("### FR-ARCH-001 — CLI edited requirement");
    expect(text).toContain("| Tags | cli, granular |");
    expect(text).toContain("- [x] AC-1: CLI criterion one");
    expect(text).toContain("- [ ] AC-2: CLI criterion two");
  });
});
