import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// Fixture mutation-target: Target Map v1.0.0 (active) and v1.1.0 (planned); FR-ARCH-001 targets v1.0.0.
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

function drain(s: PassThrough): string {
  return s.read()?.toString() ?? "";
}
async function cli(root: string, args: string[]) {
  const o = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, ...args], o);
  return { code, stdout: drain(o.stdout), stderr: drain(o.stderr) };
}

describe("verify r1 — retarget surface", () => {
  it("--from naming a target the --id requirement is not in is not silently ignored", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(path.join(root, SPEC), "utf8");
    // The user says "move FR-ARCH-001 out of v1.1.0"; FR-ARCH-001 is in v1.0.0.
    const run = await cli(root, ["retarget", "--from", "v1.1.0", "--id", "FR-ARCH-001", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    expect(run.code, run.stdout).not.toBe(0);
    expect(await readFile(path.join(root, SPEC), "utf8")).toBe(before);
  });

  it("--id naming no requirement does not report success with exit 0", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const run = await cli(root, ["retarget", "--id", "FR-NOPE-001", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    // The same command exits 5 when nothing moves because --to is unregistered (target-not-registered).
    expect(run.code, run.stdout).toBe(5);
  });
});
