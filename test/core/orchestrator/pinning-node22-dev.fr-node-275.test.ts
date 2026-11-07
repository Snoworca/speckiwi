import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// Node.js 22 on Windows reports device 0 from a path-based stat (lstat, stat) and the volume serial
// from an open handle's stat; Node.js 24 reports the serial from both. Measured with
// node-v22.16.0-win-x64: lstat(package.json).dev 0, (await open(...)).stat().dev 2050326575.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const zeroDevice = <T extends { dev: number | bigint }>(stats: T): T =>
    Object.assign(Object.create(Object.getPrototypeOf(stats) as object) as T, stats, { dev: typeof stats.dev === "bigint" ? 0n : 0 });
  return {
    ...actual,
    lstat: (async (...args: Parameters<typeof actual.lstat>) => zeroDevice(await actual.lstat(...args))) as typeof actual.lstat
  };
});

const { assertPinned, pinHandoff } = await import("../../../src/core/orchestrator/pinning.js");
const { cleanupFixtures, commitAll, initRepo } = await import("./support/git-fixture.js");

const DOC = "handoff/lane-1.md";

async function fixture(): Promise<{ root: string; head: string }> {
  const root = await initRepo("pin-node22-dev");
  await mkdir(path.join(root, "handoff"), { recursive: true });
  await writeFile(path.join(root, DOC), "# Lane 1 handoff\n");
  return { root, head: await commitAll(root, "test: seed handoff document") };
}

afterAll(cleanupFixtures);

describe("FR-NODE-275 AC-4 handoff pinning when a path stat reports device 0", () => {
  it("@req FR-NODE-275 AC-4: pins and re-proves an unchanged document", async () => {
    const run = await fixture();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [DOC] });
    expect(pinned.documents.map((document) => document.path)).toEqual([DOC]);
    await expect(assertPinned(pinned)).resolves.not.toThrow();
  }, 120_000);

  it("@req FR-NODE-275 AC-4: still refuses a leaf replaced by a same-byte copy (a new inode)", async () => {
    const run = await fixture();
    const pinned = await pinHandoff({ root: run.root, expectedHead: run.head, documentPaths: [DOC] });
    const leaf = path.join(run.root, DOC);
    const replacement = `${leaf}.replacement`;
    await writeFile(replacement, await readFile(leaf));
    await rm(leaf);
    await rename(replacement, leaf);
    await expect(assertPinned(pinned)).rejects.toThrow();
  }, 120_000);
});
