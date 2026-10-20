import { mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @req FR-NODE-221 AC-6, FR-NODE-197 AC-7 — the release reads a sentinel once and acts on those bytes:
 * the holder it names and the bytes it later compares come from one read, so a successor published
 * between two reads is never removed under the previous holder's name. And a delete-pending sentinel
 * on Windows (EPERM/EBUSY on `rm`) is retried as every SRS-lock operation is, rather than surfacing as
 * an operational error.
 *
 * `node:fs/promises` is wrapped so the interleavings are forced, not raced.
 */

const faults = vi.hoisted(() => ({
  /** Replies for the next `readFile` calls on `path`, consumed in order; then the real file. */
  reads: new Map<string, string[]>(),
  /** Errno codes the next `rm` calls on `path` throw, consumed in order. */
  rms: new Map<string, string[]>(),
  rmCalls: new Map<string, number>()
}));

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const key = (target: unknown): string => path.resolve(String(target)).toLowerCase();
  return {
    ...actual,
    readFile: (async (target: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      const queued = faults.reads.get(key(target));
      if (queued && queued.length > 0) return queued.shift();
      return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(target, ...rest);
    }) as typeof actual.readFile,
    rm: (async (target: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
      faults.rmCalls.set(key(target), (faults.rmCalls.get(key(target)) ?? 0) + 1);
      const code = faults.rms.get(key(target))?.shift();
      if (code !== undefined) throw Object.assign(new Error(`${code}: injected on rm`), { code });
      return actual.rm(target, options);
    }) as typeof actual.rm
  };
});

const { inspectExclusiveLock } = await import("../../../src/core/lock/exclusive-lock.js");
const { releaseHeldRunLock, resolveGitCommonDir, runLockPath } = await import("../../../src/core/orchestrator/run-lock.js");
const { cleanupFixtures, commitAll, initRepo } = await import("./support/git-fixture.js");
const { existsSync } = await import("node:fs");

const DEAD_PID = 2_147_483_647;

function record(token: string, pid: number): string {
  return `${JSON.stringify({ version: 1, token, pid, host: hostname(), owner: `owner-${token}`, acquired_at: new Date().toISOString() })}\n`;
}

async function staleRunLock(prefix: string): Promise<{ commonDir: string; lockPath: string }> {
  const root = await initRepo(prefix);
  await writeFile(path.join(root, "README.md"), "# fixture\n", "utf8");
  await commitAll(root, "test: seed");
  const commonDir = await resolveGitCommonDir(root);
  const lockPath = runLockPath(commonDir);
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, record("stale", DEAD_PID), "utf8");
  return { commonDir, lockPath };
}

beforeEach(() => {
  faults.reads.clear();
  faults.rms.clear();
  faults.rmCalls.clear();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("FR-NODE-221 the release acts on the bytes it read", () => {
  it("FR-NODE-221 AC-6 inspectExclusiveLock names the holder of the same bytes it returns", async () => {
    const { lockPath } = await staleRunLock("fr-node-221-one-read-");
    // The first read sees the stale holder; any second read would see a successor.
    faults.reads.set(lockPath.toLowerCase(), [record("stale", DEAD_PID), record("successor", process.pid)]);
    const inspection = await inspectExclusiveLock(lockPath);
    expect(inspection.raw).not.toBeNull();
    const parsed = JSON.parse(inspection.raw as string) as { pid: number; owner: string };
    expect(inspection.holder?.pid).toBe(parsed.pid);
    expect(inspection.holder?.owner).toBe(parsed.owner);
  });

  it("FR-NODE-197 AC-7 a release never reports the previous holder for a sentinel it did not read whole", async () => {
    const { commonDir, lockPath } = await staleRunLock("fr-node-221-one-read-release-");
    faults.reads.set(lockPath.toLowerCase(), [record("stale", DEAD_PID), record("successor", process.pid)]);
    const outcome = await releaseHeldRunLock(commonDir);
    // Either the release saw the successor and stood back, or it removed exactly what it named.
    if (outcome.ok) expect(outcome.owner).toBe("owner-successor");
    else expect(outcome.reason).toBe("changed-hands");
  });
});

describe("FR-NODE-221 the foreign release retries a busy delete", () => {
  it("FR-NODE-221 AC-4 an rm that meets EPERM then EBUSY is retried and the stale sentinel is removed", async () => {
    const { commonDir, lockPath } = await staleRunLock("fr-node-221-busy-rm-");
    faults.rms.set(lockPath.toLowerCase(), ["EPERM", "EBUSY"]);
    const outcome = await releaseHeldRunLock(commonDir);
    expect(outcome).toEqual({ ok: true, owner: "owner-stale" });
    expect(existsSync(lockPath)).toBe(false);
    expect(faults.rmCalls.get(lockPath.toLowerCase())).toBe(3);
  });

  it("FR-NODE-221 AC-4 a persistent EPERM is still reported, after the bounded retries", async () => {
    const { commonDir, lockPath } = await staleRunLock("fr-node-221-busy-rm-persistent-");
    faults.rms.set(lockPath.toLowerCase(), ["EPERM", "EPERM", "EPERM", "EPERM", "EPERM"]);
    await expect(releaseHeldRunLock(commonDir)).rejects.toMatchObject({ code: "EPERM" });
    expect(faults.rmCalls.get(lockPath.toLowerCase())).toBe(4);
  });
});
