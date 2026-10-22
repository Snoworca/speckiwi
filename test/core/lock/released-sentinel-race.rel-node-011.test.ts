import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import type * as FsPromisesModule from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ExclusiveLockModule from "../../../src/core/lock/exclusive-lock.js";

type FsPromises = typeof FsPromisesModule;
type LockModule = typeof ExclusiveLockModule;

const LOCK_MODULE = "../../../src/core/lock/exclusive-lock.js";
const FENCE_NAMESPACE = "speckiwi-rel-node-011";

/*
 * @req REL-NODE-011 — the sentinel that refused an exclusive create can be released before the
 * acquisition reads it. On Linux the kernel fence is always granted, so contenders meet at the
 * sentinel and its holder's unlink lands at once; the eight-writer wave journal case met exactly this
 * as a thrown `ENOENT ... stat '<journal>.speckiwi.lock'`. The release is injected at the read, so the
 * order is deterministic on every platform rather than one that fires some of the time.
 */

async function lockRoot(): Promise<{ root: string; lockPath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-rel-node-011-"));
  return { root, lockPath: path.join(root, "artifact.jsonl.speckiwi.lock") };
}

/** Loads the lock module with `stat` of `lockPath` removing the sentinel first on its `nth` call. */
async function moduleReleasingAtStat(lockPath: string, nth: number): Promise<{ module: LockModule; evidence: { released: number } }> {
  const evidence = { released: 0 };
  let seen = 0;
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<FsPromises>();
    return {
      ...actual,
      stat: (async (target: Parameters<FsPromises["stat"]>[0], options?: unknown) => {
        if (typeof target === "string" && path.resolve(target) === path.resolve(lockPath) && ++seen === nth) {
          await actual.rm(lockPath, { force: true }); // the holder releases now
          evidence.released += 1;
        }
        return actual.stat(target as never, options as never);
      }) as FsPromises["stat"]
    };
  });
  return { module: (await import(LOCK_MODULE)) as LockModule, evidence };
}

async function residue(lockPath: string): Promise<string[]> {
  const prefix = path.basename(lockPath);
  return (await readdir(path.dirname(lockPath))).filter((entry) => entry === prefix || entry.startsWith(`${prefix}.`)).sort();
}

async function attempt(module: LockModule, lockPath: string, fenceNamespace: string): Promise<{ outcome: unknown; thrown: unknown }> {
  try {
    return { outcome: await module.acquireExclusiveLock({ fenceNamespace, lockPath, owner: "waiter" }), thrown: undefined };
  } catch (error) {
    return { outcome: undefined, thrown: error };
  }
}

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

describe("REL-NODE-011 a sentinel released before the acquisition reads it is contention, not an error", () => {
  it("REL-NODE-011 AC-1: answers held, without throwing, when the holder releases between the refused create and the read", async () => {
    const { root, lockPath } = await lockRoot();
    try {
      await writeFile(lockPath, `${JSON.stringify({
        version: 1,
        token: "live-holder-token",
        pid: process.pid,
        host: hostname(),
        owner: "holder",
        acquired_at: new Date().toISOString()
      })}\n`, "utf8");
      const { module, evidence } = await moduleReleasingAtStat(lockPath, 1);

      const { outcome, thrown } = await attempt(module, lockPath, `${FENCE_NAMESPACE}-read`);

      expect(evidence.released, "the holder's release must land before the read").toBe(1);
      expect(thrown, "a released sentinel must not become a thrown acquisition error").toBeUndefined();
      expect(outcome).toEqual({ ok: false, reason: "held" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("REL-NODE-011 AC-2: answers held and leaves no guard when the sentinel goes while the recovery guard is taken", async () => {
    const { root, lockPath } = await lockRoot();
    try {
      // Torn and older than the grace, so the first read judges it reclaimable and the acquisition
      // takes the recovery guard before reading it again.
      await writeFile(lockPath, "torn\n", "utf8");
      const stale = new Date(Date.now() - 60_000);
      await utimes(lockPath, stale, stale);
      const { module, evidence } = await moduleReleasingAtStat(lockPath, 2);

      const { outcome, thrown } = await attempt(module, lockPath, `${FENCE_NAMESPACE}-guard`);

      expect(evidence.released, "the sentinel must go between the guard and the re-read").toBe(1);
      expect(thrown, "a sentinel gone under the guard must not become a thrown acquisition error").toBeUndefined();
      expect(outcome).toEqual({ ok: false, reason: "held" });
      expect(await residue(lockPath), "the recovery guard is released").toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
