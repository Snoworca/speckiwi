import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { registerSpeckiwiMcp } from "../../../src/core/bootstrap/mcp-registration.js";

// @req FR-NODE-318 — reproduced 2026-11-20 in this repository: .mcp.json carried `npx -y speckiwi mcp`,
// speckiwi init --dry-run reported .mcp.json as skipped, and the MCP server ran the published 5.5.1
// while the checkout was 5.6.0, until the entry was rewritten by hand.

const PUBLISHED = { command: "npx", args: ["-y", "speckiwi", "mcp"] };
const CHECKOUT = { command: "node", args: ["bin/speckiwi", "mcp"] };
/** The warning that names a kept entry; the always-present Codex remediation line does not carry it. */
const KEPT = "left as written";

/** A git repository at `dir` holding a package.json named `name`, with bin/speckiwi when `bin`. */
async function project(name: string, bin: boolean, entry?: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-318-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  expect(path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" }).trim())).toBe(path.resolve(dir));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0" }), "utf8");
  if (bin) {
    await mkdir(path.join(dir, "bin"), { recursive: true });
    await writeFile(path.join(dir, "bin", "speckiwi"), "#!/usr/bin/env node\n", "utf8");
  }
  if (entry !== undefined) {
    await writeFile(path.join(dir, ".mcp.json"), `${JSON.stringify({ extra: 1, mcpServers: { other: { command: "x" }, speckiwi: entry } }, null, 2)}\n`, "utf8");
  }
  return dir;
}

const config = async (dir: string) => readFile(path.join(dir, ".mcp.json"), "utf8");

describe("FR-NODE-318 AC-1 — the published launcher is repaired in a self-hosting checkout", () => {
  // @req FR-NODE-318 AC-1
  it("replaces exactly the published launcher, keeping the rest of the file", async () => {
    const dir = await project("speckiwi", true, PUBLISHED);
    const result = await registerSpeckiwiMcp(dir);
    expect(result.status).toBe("updated");
    const parsed = JSON.parse(await config(dir));
    expect(parsed).toEqual({ extra: 1, mcpServers: { other: { command: "x" }, speckiwi: CHECKOUT } });
  });

  // @req FR-NODE-318 AC-1
  it("a dry run reports updated and writes nothing", async () => {
    const dir = await project("speckiwi", true, PUBLISHED);
    const before = await config(dir);
    expect((await registerSpeckiwiMcp(dir, { dryRun: true })).status).toBe("updated");
    expect(await config(dir)).toBe(before);
  });

  // @req FR-NODE-318 AC-1
  it("speckiwi init reports .mcp.json among the updated files", async () => {
    const dir = await project("speckiwi", true, PUBLISHED);
    const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
    await main(["--root", dir, "init", "--target", "v0.1.0", "--scope", "App:APP", "--no-skills", "--json"], streams);
    const answer = JSON.parse(streams.stdout.read()?.toString() ?? "{}") as { value?: { updated?: string[] } };
    expect((answer.value?.updated ?? []).map((item) => path.basename(item))).toContain(".mcp.json");
    expect(JSON.parse(await config(dir)).mcpServers.speckiwi).toEqual(CHECKOUT);
  });
});

describe("FR-NODE-318 AC-1 — speckiwi upgrade repairs it too", () => {
  // @req FR-NODE-318 AC-1
  it("upgrade, which runs init, replaces the published launcher and a dry run only plans it", async () => {
    const dir = await project("speckiwi", true, PUBLISHED);
    const before = await config(dir);
    const plan = new PassThrough();
    await main(["--root", dir, "upgrade", "--dry-run", "--no-skills", "--json"], { stdout: plan, stderr: new PassThrough() });
    const planned = JSON.parse(plan.read()?.toString() ?? "{}") as { value?: { init?: { updated?: string[] } } };
    expect((planned.value?.init?.updated ?? []).map((item) => path.basename(item))).toContain(".mcp.json");
    expect(await config(dir)).toBe(before);
    await main(["--root", dir, "upgrade", "--no-skills", "--json"], { stdout: new PassThrough(), stderr: new PassThrough() });
    expect(JSON.parse(await config(dir)).mcpServers.speckiwi).toEqual(CHECKOUT);
  });
});

describe("FR-NODE-318 AC-2 AC-3 — any other entry is kept", () => {
  for (const [label, entry] of [
    ["a pinned version", { command: "npx", args: ["-y", "speckiwi@5.5.1", "mcp"] }],
    ["the published launcher with env", { ...PUBLISHED, env: { DEBUG: "1" } }],
    ["another command", { command: "node", args: ["dist/cli.js", "mcp"] }]
  ] as const) {
    // @req FR-NODE-318 AC-2
    it(`keeps ${label} byte for byte and names it and the checkout launcher`, async () => {
      const dir = await project("speckiwi", true, entry);
      const before = await config(dir);
      const result = await registerSpeckiwiMcp(dir);
      expect(result.status).toBe("skipped");
      expect(await config(dir)).toBe(before);
      const warning = result.warnings.find((item) => item.includes(KEPT)) ?? "";
      expect(warning).toContain(JSON.stringify(entry));
      expect(warning).toContain(JSON.stringify(CHECKOUT));
    });
  }

  for (const [label, entry] of [
    ["the checkout launcher with type and env", { type: "stdio", command: "node", args: ["bin/speckiwi", "mcp"], env: {} }],
    ["the checkout launcher spelled ./bin/speckiwi", { command: "node", args: ["./bin/speckiwi", "mcp"] }]
  ] as const) {
    // @req FR-NODE-318 AC-3
    it(`skips ${label}, which already runs this checkout, with no warning about it`, async () => {
      const dir = await project("speckiwi", true, entry);
      const before = await config(dir);
      const result = await registerSpeckiwiMcp(dir);
      expect(result.status).toBe("skipped");
      expect(await config(dir)).toBe(before);
      expect(result.warnings.some((item) => item.includes(KEPT))).toBe(false);
    });
  }

  // @req FR-NODE-318 AC-3
  it("skips the checkout launcher with no warning about it", async () => {
    const dir = await project("speckiwi", true, CHECKOUT);
    const before = await config(dir);
    const result = await registerSpeckiwiMcp(dir);
    expect(result.status).toBe("skipped");
    expect(await config(dir)).toBe(before);
    expect(result.warnings.some((item) => item.includes(KEPT))).toBe(false);
  });
});

describe("FR-NODE-318 AC-4 — ordinary projects are unchanged", () => {
  for (const [label, name, bin] of [
    ["another package", "some-consumer", true],
    ["speckiwi without bin/speckiwi", "speckiwi", false]
  ] as const) {
    // @req FR-NODE-318 AC-4
    it(`${label}: an existing entry is skipped whatever it is, with no warning about it`, async () => {
      for (const entry of [PUBLISHED, CHECKOUT, { command: "custom" }]) {
        const dir = await project(name, bin, entry);
        const before = await config(dir);
        const result = await registerSpeckiwiMcp(dir);
        expect(result.status).toBe("skipped");
        expect(await config(dir)).toBe(before);
        expect(result.warnings.some((item) => item.includes(KEPT))).toBe(false);
      }
    });
  }
});
