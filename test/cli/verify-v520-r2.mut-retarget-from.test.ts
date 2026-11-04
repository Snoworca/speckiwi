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

describe("verify r2 — retarget --from naming an unregistered target", () => {
  it("is refused like rename-target --from and retarget --to, not reported as a successful empty move", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const before = await readFile(path.join(root, SPEC), "utf8");
    // A typo of v1.0.0. rename-target --from v9.9.9 exits 5 (NOT_FOUND "Target is not registered"),
    // and retarget --to v9.9.9 exits 5 (target-not-registered); retarget --from v9.9.9 exits 0 with ok:true, items:[].
    const run = await cli(root, ["retarget", "--from", "v9.9.9", "--to", "v1.1.0", "--reason", "x", "--apply", "--json"]);
    expect(run.code, run.stdout).toBe(5);
    expect(await readFile(path.join(root, SPEC), "utf8")).toBe(before);
  });
});
