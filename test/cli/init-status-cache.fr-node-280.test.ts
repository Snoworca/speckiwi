import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

// @req FR-NODE-280 — the first init in an empty project is not a status cache failure.

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** An empty directory where only `git init` has run. */
async function emptyGitProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "speckiwi-fr-node-280-"));
  roots.push(root);
  await execFileAsync("git", ["init", "-q", root]);
  return root;
}

interface InitEnvelope {
  ok: boolean;
  diagnostics?: Array<{ code: string; message: string }>;
}

async function initQuickStart(root: string): Promise<{ code: number; envelope: InitEnvelope }> {
  const streams = { stdout: new PassThrough(), stderr: new PassThrough() };
  const code = await main(["--root", root, "init", "--target", "v0.1.0", "--scope", "App:APP", "--no-mcp", "--no-skills", "--json"], streams);
  return { code, envelope: JSON.parse(streams.stdout.read()?.toString() ?? "{}") as InitEnvelope };
}

function codes(envelope: InitEnvelope): string[] {
  return (envelope.diagnostics ?? []).map((entry) => entry.code);
}

describe("FR-NODE-280 — status cache on the first init", () => {
  // @req FR-NODE-280 AC-1
  it("reports no SRS-W066 and leaves kiwi/.status.json describing the created index", async () => {
    const root = await emptyGitProject();
    const { code, envelope } = await initQuickStart(root);
    expect(code).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(codes(envelope)).not.toContain("SRS-W066");

    const cache = JSON.parse(await readFile(path.join(root, "kiwi", ".status.json"), "utf8")) as {
      specFingerprint: { files: Array<{ path: string; sha256?: string }> };
      lock: { active: boolean };
    };
    const index = await readFile(path.join(root, "docs", "spec", "00.index.md"));
    const indexEntry = cache.specFingerprint.files.find((file) => file.path === "docs/spec/00.index.md");
    expect(indexEntry?.sha256).toBe(createHash("sha256").update(index).digest("hex"));
    expect(cache.lock.active).toBe(false);
  });

  // @req FR-NODE-280 AC-2
  it("still reports SRS-W066 when the cache write itself fails", async () => {
    const root = await emptyGitProject();
    await mkdir(path.join(root, "kiwi", ".status.json"), { recursive: true });
    const { code, envelope } = await initQuickStart(root);
    expect(code).toBe(0);
    expect(codes(envelope)).toContain("SRS-W066");
  });
});
