import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-271 — a scaffold-scope preview writes no file, the status cache and the lock file included.
//
// The preview took a real SRS mutation lock, so the status cache was written saying the lock was held
// and was never refreshed afterwards, because the preview wrote nothing. Every other dry-run mutation
// passes its preview to the lock as a dry run.

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

/** The sha256 of every file under the root outside `.git`, keyed by its relative path. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (relative === ".git" || relative.startsWith(".git/")) continue;
    hashes[relative] = createHash("sha256").update(await readFile(absolute)).digest("hex");
  }
  return hashes;
}

async function runCli(root: string, args: string[]): Promise<{ code: number; out: string }> {
  const streams = io();
  const code = await main(["--root", root, "scaffold-scope", ...args], streams);
  return { code, out: drain(streams.stdout) };
}

describe("FR-NODE-271 AC-1 — the default preview leaves every file byte-identical", () => {
  // @req FR-NODE-271 AC-1
  it("scaffold-scope without --apply creates and changes no file, kiwi/.status.json included", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await snapshot(root);

    const { code, out } = await runCli(root, ["Extra:EXT", "--json"]);

    expect(code, out).toBe(0);
    expect(await snapshot(root)).toEqual(before);
  });
});

describe("FR-NODE-271 AC-2 — the explicit dry run and the MCP preview write nothing either", () => {
  // @req FR-NODE-271 AC-2
  it("scaffold-scope --apply --dry-run creates and changes no file", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await snapshot(root);

    const { code, out } = await runCli(root, ["Extra:EXT", "--apply", "--dry-run", "--json"]);

    expect(code, out).toBe(0);
    expect(await snapshot(root)).toEqual(before);
  });

  // @req FR-NODE-271 AC-2
  it("MCP scaffold_scope without apply creates and changes no file", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const before = await snapshot(root);
    const handle = await createMcpServer({ root });

    const result = (await handle.callTool("scaffold_scope", { name: "Extra", prefix: "EXT" })) as { ok?: boolean };

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await snapshot(root)).toEqual(before);
  });
});

describe("FR-NODE-271 AC-3 — a status cache that says the lock is free stays that way", () => {
  // @req FR-NODE-271 AC-3
  it("keeps an existing kiwi/.status.json with lock.active false byte-identical across a preview", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const statusPath = path.join(root, "kiwi", ".status.json");
    await mkdir(path.dirname(statusPath), { recursive: true });
    const cache = `${JSON.stringify({ schemaVersion: "1.0.0", lock: { active: false } }, null, 2)}\n`;
    await writeFile(statusPath, cache, "utf8");

    const { code, out } = await runCli(root, ["Extra:EXT", "--json"]);

    expect(code, out).toBe(0);
    expect(await readFile(statusPath, "utf8")).toBe(cache);
  });
});

describe("FR-NODE-271 AC-4 — the applied write still runs under the lock", () => {
  // @req FR-NODE-271 AC-4
  it("scaffold-scope --apply writes the document and both index rows, and refreshes the cache the lock owns", async () => {
    const root = await copyFixtureWorkspace("valid-basic");

    const { code, out } = await runCli(root, ["Extra:EXT", "--apply", "--json"]);

    expect(code, out).toBe(0);
    const specDir = path.join(root, "docs", "spec");
    const created = (await readdir(specDir)).find((name) => name.endsWith(".extra.srs.md"));
    expect(created, "the new scope document").toBeDefined();
    const index = await readFile(path.join(specDir, "00.index.md"), "utf8");
    const rows = index.split(/\r?\n/).filter((line) => line.startsWith("| Extra |"));
    expect(rows).toHaveLength(2);
    // Only a write taken under the lock refreshes the status cache after release; a dry-run lock never does.
    const status = JSON.parse(await readFile(path.join(root, "kiwi", ".status.json"), "utf8")) as { lock?: { active?: boolean } };
    expect(status.lock?.active).toBe(false);
  });

  // @req FR-NODE-271 AC-4
  it("scaffold-scope --apply is refused while another session holds the lock", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        owner: "another-session",
        operation: "add_requirement",
        requestId: "held",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString()
      })}\n`,
      "utf8"
    );

    const { code, out } = await runCli(root, ["Extra:EXT", "--apply", "--json"]);

    expect(code).toBe(5);
    expect(out).toContain("SRS_LOCKED");
  });
});
