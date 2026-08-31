import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import type * as FsPromisesModule from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type FsPromises = typeof FsPromisesModule;

const LOCK_MODULE = "../../../src/core/lock/exclusive-lock.js";
const RUN_LOCK_MODULE = "../../../src/core/orchestrator/run-lock.js";
const FENCE_NAMESPACE = "speckiwi-fr-node-203";

/*
 * Windows answers an open of a delete-pending file with EPERM rather than ENOENT, and that is the
 * code observed escaping `readHolderAt` in production contention. The suite injects it rather than
 * racing for it: the real race fired 5 times in 24000 contended acquires, which is not a rate a
 * deterministic assertion can be built on. @req FR-NODE-203
 */
function transientError(code: string, target: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation not permitted, open '${target}'`), { code });
}

/** `acquireKernelFence` answers null only on win32, where a busy named pipe reports EADDRINUSE;
 *  everywhere else it hands back a held fence, so the fence-null branch of `acquireExclusiveLock` is
 *  unreachable there and asserting over it would assert nothing. That is the ONLY platform-bound
 *  branch: `readHolderAt` itself is also called from `acquireRecoveryGuard`, which needs no fence, so
 *  the guard case below covers this absorption on every platform. */
const onFencedPlatform = process.platform === "win32" ? it : it.skip;

async function lockRoot(): Promise<{ root: string; lockPath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-203-"));
  return { root, lockPath: path.join(root, "artifact.jsonl.speckiwi.lock") };
}

async function actualLockModule() {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  return import(LOCK_MODULE);
}

async function faultedModule<T>(specifier: string, factory: (actual: FsPromises) => Partial<FsPromises>): Promise<T> {
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<FsPromises>();
    return { ...actual, ...factory(actual) };
  });
  return import(specifier) as Promise<T>;
}

/** Raises `code` for every read of `lockPath` and counts the hits, so a green assertion can be
 *  distinguished from an injection that never fired. */
function readFileFault(lockPath: string, code: string) {
  const evidence = { hits: 0 };
  const factory = (actual: FsPromises): Partial<FsPromises> => ({
    readFile: (async (target: Parameters<FsPromises["readFile"]>[0], options?: unknown) => {
      if (typeof target === "string" && path.resolve(target) === path.resolve(lockPath)) {
        evidence.hits += 1;
        throw transientError(code, lockPath);
      }
      return actual.readFile(target as never, options as never);
    }) as FsPromises["readFile"]
  });
  return { evidence, factory };
}

async function residue(lockPath: string): Promise<string[]> {
  const directory = path.dirname(lockPath);
  const prefix = path.basename(lockPath);
  return (await readdir(directory)).filter((entry) => entry === prefix || entry.startsWith(`${prefix}.`)).sort();
}

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  vi.restoreAllMocks();
});

// @req FR-NODE-203 AC-1/AC-2
describe("FR-NODE-203 unreadable sentinel answers contention as held", () => {
  onFencedPlatform.each(["EPERM", "EACCES", "EBUSY"])(
    "returns held rather than throwing when the holder sentinel read raises %s",
    async (code) => {
      const { root, lockPath } = await lockRoot();
      const holderModule = await actualLockModule();
      const held = await holderModule.acquireExclusiveLock({
        fenceNamespace: FENCE_NAMESPACE,
        lockPath,
        owner: "holder"
      });
      expect(held.ok, "the holder must take the lock before contention is measured").toBe(true);

      const { evidence, factory } = readFileFault(lockPath, code);
      let outcome: unknown;
      let thrown: unknown;
      try {
        const waiterModule = await faultedModule<typeof holderModule>(LOCK_MODULE, factory);
        outcome = await waiterModule.acquireExclusiveLock({
          fenceNamespace: FENCE_NAMESPACE,
          lockPath,
          owner: "waiter"
        });
      } catch (error) {
        thrown = error;
      } finally {
        await holderModule.releaseExclusiveLock(held.capability);
        await rm(root, { recursive: true, force: true });
      }

      expect(evidence.hits, "the injected sentinel-read failure must be reached").toBeGreaterThan(0);
      expect(thrown, "a sentinel that cannot be read must not become a thrown acquisition error").toBeUndefined();
      expect(outcome).toEqual({ ok: false, reason: "held" });
    }
  );

  /* The second of the two INTERNAL `readHolderAt` call sites — internal meaning inside
   * `acquireExclusiveLock`'s own acquisition flow, which must return an acquire outcome and so
   * answers held. `acquireRecoveryGuard` reads the guard sentinel to name whoever won the guard, and
   * it needs no kernel fence, so this is the one case that measures the absorption on every
   * platform. It is also what makes AC-2's claim a claim about both internal call sites rather than
   * about the fenced one alone. There is a third call site, the exported `readExclusiveLockHolder`,
   * which answers no acquire and is covered by the two cases below. @req FR-NODE-203 AC-2 */
  it("answers held rather than granting when the recovery guard's sentinel cannot be read", async () => {
    const { root, lockPath } = await lockRoot();
    const guardPath = `${lockPath}.acquire`;
    try {
      // Torn and older than the grace, so the sentinel is reclaimable and the acquire routes into
      // the recovery guard instead of returning held straight from `readSentinel`.
      await writeFile(lockPath, "torn\n", "utf8");
      const stale = new Date(Date.now() - 60_000);
      await utimes(lockPath, stale, stale);
      await writeFile(guardPath, `${JSON.stringify({
        version: 1,
        token: "guard-winner-token",
        pid: process.pid,
        host: hostname(),
        owner: "guard-winner",
        acquired_at: new Date().toISOString()
      })}\n`, "utf8");

      const { evidence, factory } = readFileFault(guardPath, "EPERM");
      const module = await faultedModule<Awaited<ReturnType<typeof actualLockModule>>>(LOCK_MODULE, factory);

      let outcome: unknown;
      let thrown: unknown;
      try {
        outcome = await module.acquireExclusiveLock({
          fenceNamespace: `${FENCE_NAMESPACE}-guard`,
          lockPath,
          owner: "contender"
        });
      } catch (error) {
        thrown = error;
      }

      expect(evidence.hits, "the guard sentinel read must be reached").toBeGreaterThan(0);
      expect(thrown, "an unreadable guard sentinel must not become a thrown acquisition error").toBeUndefined();
      expect(outcome, "an unknown guard holder is still a holder, never a granted lock")
        .toEqual({ ok: false, reason: "held" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports no holder rather than throwing when the exported reader cannot read the sentinel", async () => {
    const { root, lockPath } = await lockRoot();
    try {
      await writeFile(lockPath, `${JSON.stringify({
        version: 1,
        token: "live-owner-token",
        pid: process.pid,
        host: hostname(),
        owner: "holder",
        acquired_at: new Date().toISOString()
      })}\n`, "utf8");

      const { evidence, factory } = readFileFault(lockPath, "EPERM");
      const module = await faultedModule<Awaited<ReturnType<typeof actualLockModule>>>(LOCK_MODULE, factory);
      const holder = await module.readExclusiveLockHolder(lockPath);

      expect(evidence.hits).toBeGreaterThan(0);
      expect(holder).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports no run-lock holder rather than throwing, which its contract already defines as torn", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-203-run-"));
    try {
      const actualRunLock = await import(RUN_LOCK_MODULE);
      const lockPath: string = actualRunLock.runLockPath(root);
      await mkdir(path.dirname(lockPath), { recursive: true });
      await writeFile(lockPath, "not json at all\n", "utf8");

      const { evidence, factory } = readFileFault(lockPath, "EPERM");
      const runLock = await faultedModule<typeof actualRunLock>(RUN_LOCK_MODULE, factory);
      const holder = await runLock.readHolder(root);

      expect(evidence.hits).toBeGreaterThan(0);
      expect(holder).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// @req FR-NODE-203 AC-4
describe("FR-NODE-203 sibling ENOENT-only absorptions keep their behaviour", () => {
  it("keeps sentinelHasToken strict: a cleanup fault still surfaces as that fault, not as the read fault", async () => {
    const { root, lockPath } = await lockRoot();
    try {
      const quarantine = `${lockPath}.stale-unrelated-orphan`;
      await writeFile(quarantine, "orphan\n", "utf8");
      await utimes(quarantine, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));

      const readFault = readFileFault(lockPath, "EPERM");
      const readdirEvidence = { hits: 0 };
      const module = await faultedModule<Awaited<ReturnType<typeof actualLockModule>>>(LOCK_MODULE, (actual) => ({
        ...readFault.factory(actual),
        readdir: (async (target: unknown, options?: unknown) => {
          if (typeof target === "string" && path.resolve(target) === path.resolve(path.dirname(lockPath))) {
            readdirEvidence.hits += 1;
            throw transientError("EIO", String(target));
          }
          return actual.readdir(target as never, options as never);
        }) as FsPromises["readdir"]
      }));

      let thrown: NodeJS.ErrnoException | undefined;
      try {
        await module.acquireExclusiveLock({ fenceNamespace: `${FENCE_NAMESPACE}-sibling-a`, lockPath, owner: "orphan-sweeper" });
      } catch (error) {
        thrown = error as NodeJS.ErrnoException;
      }

      expect(readdirEvidence.hits, "the orphan sweep must be reached").toBeGreaterThan(0);
      expect(readFault.evidence.hits, "the ownership re-read must be reached").toBeGreaterThan(0);
      // `retainFailedCleanupWhileOwned` catches anything `sentinelHasToken` throws and continues with
      // `owned = false`, which rethrows the ORIGINAL cleanup fault. Absorbing EPERM inside
      // `sentinelHasToken` would produce that same `false`, so the change would buy no outcome.
      expect(thrown?.code).toBe("EIO");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps removeOwnedSentinel strict: an unverifiable rollback fails loudly instead of reporting held", async () => {
    const { root, lockPath } = await lockRoot();
    try {
      await writeFile(`${lockPath}.acquire`, `${JSON.stringify({
        version: 1,
        token: "live-guard-token",
        pid: process.pid,
        host: hostname(),
        owner: "other:acquire",
        acquired_at: new Date().toISOString()
      })}\n`, "utf8");

      const { evidence, factory } = readFileFault(lockPath, "EPERM");
      const module = await faultedModule<Awaited<ReturnType<typeof actualLockModule>>>(LOCK_MODULE, factory);

      let thrown: NodeJS.ErrnoException | undefined;
      let outcome: unknown;
      try {
        outcome = await module.acquireExclusiveLock({
          fenceNamespace: `${FENCE_NAMESPACE}-sibling-b`,
          lockPath,
          owner: "guard-loser"
        });
      } catch (error) {
        thrown = error as NodeJS.ErrnoException;
      }

      const observed = {
        outcome,
        thrownCode: thrown?.code,
        sentinelLeftBehind: (await residue(lockPath)).includes(path.basename(lockPath))
      };

      expect(evidence.hits, "the rollback ownership read must be reached").toBeGreaterThan(0);
      // The whole observation is compared at once so that absorbing inside `removeOwnedSentinel`
      // reports what it actually changes. It changes the answer, not the residue: the sentinel this
      // call published stays either way, under a live pid `isReclaimable` refuses to reclaim, so
      // absorbing would swap a loud failure for a `held` that invites the caller to wait on a lock
      // nothing will free.
      expect(observed).toEqual({ outcome: undefined, thrownCode: "EPERM", sentinelLeftBehind: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
