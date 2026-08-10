import { hostname } from "node:os";
import { access, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import type * as FsPromisesModule from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type FsPromises = typeof FsPromisesModule;

interface FaultEvidence {
  enabled: boolean;
  hit: boolean;
  originalToken?: string;
  owner?: string;
}

const MODULE = "../../../src/core/workflow/artifact-lock.js";

function ioError(operation: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${operation} failure`), { code: "EIO" });
}

function fsError(operation: string, code: "EACCES" | "EIO"): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${operation} failure`), { code });
}

async function fixture(): Promise<{ artifactPath: string; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-lock-post-publish-"));
  const artifactPath = path.join(root, "kiwi", "pipeline.jsonl");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, "{\"schema_version\":\"1.0.0\"}\n", "utf8");
  return { artifactPath, root };
}

async function actualModule() {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  return import(MODULE);
}

async function faultedModule(factory: (actual: FsPromises) => Partial<FsPromises>) {
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<FsPromises>();
    return { ...actual, ...factory(actual) };
  });
  return import(MODULE);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupIdentity(lockPath: string): Promise<void> {
  const directory = path.dirname(lockPath);
  const prefix = path.basename(lockPath);
  for (const entry of await readdir(directory)) {
    if (entry === prefix || entry.startsWith(`${prefix}.`)) {
      await rm(path.join(directory, entry), { force: true });
    }
  }
}

async function identityResidue(lockPath: string): Promise<string[]> {
  const directory = path.dirname(lockPath);
  const prefix = path.basename(lockPath);
  return (await readdir(directory))
    .filter((entry) => entry === prefix || entry.startsWith(`${prefix}.`))
    .sort();
}

async function assertNoIdentityResidueThenCleanup(lockPath: string): Promise<void> {
  try {
    expect(await identityResidue(lockPath)).toEqual([]);
  } finally {
    await cleanupIdentity(lockPath);
  }
}

async function deadSentinel(lockPath: string): Promise<void> {
  await writeFile(lockPath, `${JSON.stringify({
    version: 1,
    token: "dead-owner-token",
    pid: 2_147_483_647,
    host: hostname(),
    owner: "dead-owner",
    acquired_at: "2000-01-01T00:00:00.000Z"
  })}\n`, "utf8");
  const old = new Date("2000-01-01T00:00:00.000Z");
  await utimes(lockPath, old, old);
}

async function assertRetryableAfterRejectedAcquire(artifactPath: string, lockPath: string): Promise<void> {
  expect.soft(await exists(lockPath), "a rejected acquire must roll back its owned main sentinel").toBe(false);
  const module = await actualModule();
  const retry = await module.acquireArtifactLock({ artifactPath, owner: "immediate-retry" });
  expect.soft(retry, "an immediate retry must not remain wedged").toMatchObject({ ok: true });
  if (retry.ok) await module.releaseArtifactLock(retry.capability);
}

async function captureOwnedMain(
  actual: FsPromises,
  lockPath: string,
  expectedOwner: string,
  evidence: FaultEvidence
): Promise<void> {
  const record = JSON.parse(await actual.readFile(lockPath, "utf8")) as Record<string, unknown>;
  expect(record).toMatchObject({ owner: expectedOwner, token: expect.any(String) });
  evidence.hit = true;
  evidence.owner = String(record.owner);
  evidence.originalToken = String(record.token);
}

async function verifyCallerVisibleOrRolledBack(
  module: Awaited<ReturnType<typeof actualModule>>,
  artifactPath: string,
  lockPath: string,
  acquisition: ReturnType<Awaited<ReturnType<typeof actualModule>>["acquireArtifactLock"]>,
  evidence: FaultEvidence,
  expectedOwner: string
): Promise<void> {
  let result: Awaited<typeof acquisition> | undefined;
  let failure: unknown;
  try {
    result = await acquisition;
  } catch (error) {
    failure = error;
  }
  expect(evidence.hit, "the injected operation must run after publication of an owned main sentinel").toBe(true);
  expect(evidence).toMatchObject({ owner: expectedOwner, originalToken: expect.any(String) });
  evidence.enabled = false;
  if (result) {
    expect(result, "held is not an allowed post-publication outcome").toMatchObject({ ok: true });
    if (result.ok) {
      const record = JSON.parse(await readFileActual(lockPath)) as Record<string, unknown>;
      expect(record).toMatchObject({ owner: expectedOwner, token: result.capability.token });
      expect(result.capability.token).toBe(evidence.originalToken);
      await expect(module.releaseArtifactLock(result.capability)).resolves.toEqual({ ok: true, released: true });
    }
  } else {
    expect(failure).toMatchObject({ code: "EIO" });
  }
  await assertRetryableAfterRejectedAcquire(artifactPath, lockPath);
}

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

// @req FR-NODE-177 AC-6/7/11
describe("FR-NODE-177 exclusive-lock post-publication rollback", () => {
  it.each(["initial-publish", "recovery-republish"] as const)(
    "does not retain a live main sentinel or fence when %s close fails after write and sync",
    async (family) => {
      const { artifactPath } = await fixture();
      const base = await actualModule();
      const identity = await base.resolveArtifactLockIdentity(artifactPath);
      if (family === "recovery-republish") await deadSentinel(identity.lockPath);
      const evidence = { wrote: false, synced: false, closeHit: false };
      const module = await faultedModule((actual) => ({
        open: (async (
          file: Parameters<FsPromises["open"]>[0],
          flags: Parameters<FsPromises["open"]>[1],
          mode?: Parameters<FsPromises["open"]>[2]
        ) => {
          const handle = await actual.open(file, flags, mode);
          if (path.resolve(String(file)) !== path.resolve(identity.lockPath)) return handle;
          return new Proxy(handle, {
            get(target, property) {
              if (property === "writeFile") {
                return async (...args: Parameters<typeof target.writeFile>) => {
                  const result = await target.writeFile(...args);
                  evidence.wrote = true;
                  return result;
                };
              }
              if (property === "sync") {
                return async () => {
                  await target.sync();
                  evidence.synced = true;
                };
              }
              if (property === "close") {
                return async () => {
                  await target.close();
                  evidence.closeHit = true;
                  throw ioError("published sentinel close");
                };
              }
              const value = Reflect.get(target, property, target) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            }
          });
        }) as FsPromises["open"]
      }));

      let acquisition: Awaited<ReturnType<typeof module.acquireArtifactLock>> | undefined;
      try {
        acquisition = await module.acquireArtifactLock({ artifactPath, owner: `close-fault-${family}` });
      } catch {
        // The contract is the observable rollback, not whether the API reports it by exception.
      }
      expect(evidence).toEqual({ wrote: true, synced: true, closeHit: true });
      expect(acquisition?.ok).not.toBe(true);
      await assertRetryableAfterRejectedAcquire(artifactPath, identity.lockPath);
      await assertNoIdentityResidueThenCleanup(identity.lockPath);
    }
  );

  it.each([
    ["readdir", "EACCES"],
    ["readdir", "EIO"],
    ["stat", "EACCES"],
    ["stat", "EIO"],
    ["rm", "EACCES"],
    ["rm", "EIO"]
  ] as const)(
    "treats persistent unrelated orphan %s %s as best-effort across release and reacquire",
    async (operation, code) => {
      const { artifactPath } = await fixture();
      const base = await actualModule();
      const identity = await base.resolveArtifactLockIdentity(artifactPath);
      const quarantine = `${identity.lockPath}.stale-unrelated-orphan`;
      await writeFile(quarantine, "orphan\n", "utf8");
      await utimes(quarantine, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));
      const directory = path.dirname(identity.lockPath);
      const evidence = { enabled: true, hits: 0 };
      const module = await faultedModule((actual) => ({
        ...(operation === "readdir" ? {
          readdir: (async (target, options) => {
            if (evidence.enabled && path.resolve(String(target)) === path.resolve(directory)) {
              evidence.hits += 1;
              throw fsError("orphan readdir", code);
            }
            return actual.readdir(target, options as never);
          }) as FsPromises["readdir"]
        } : {}),
        ...(operation === "stat" ? {
          stat: (async (target, options) => {
            if (evidence.enabled && path.resolve(String(target)) === path.resolve(quarantine)) {
              evidence.hits += 1;
              throw fsError("orphan stat", code);
            }
            return actual.stat(target, options as never);
          }) as FsPromises["stat"]
        } : {}),
        ...(operation === "rm" ? {
          rm: (async (target, options) => {
            if (evidence.enabled && path.resolve(String(target)) === path.resolve(quarantine)) {
              evidence.hits += 1;
              throw fsError("orphan rm", code);
            }
            return actual.rm(target, options);
          }) as FsPromises["rm"]
        } : {})
      }));
      let firstCapability: Parameters<typeof module.releaseArtifactLock>[0] | undefined;
      let retryCapability: Parameters<typeof module.releaseArtifactLock>[0] | undefined;
      try {
        const first = await module.acquireArtifactLock({ artifactPath, owner: `persistent-${operation}-${code}` });
        expect(first).toMatchObject({ ok: true });
        if (!first.ok) return;
        firstCapability = first.capability;
        expect.soft(await module.releaseArtifactLock(first.capability)).toEqual({ ok: true, released: true });

        const retry = await module.acquireArtifactLock({ artifactPath, owner: `persistent-retry-${operation}-${code}` });
        expect.soft(retry).toMatchObject({ ok: true });
        if (retry.ok) {
          retryCapability = retry.capability;
          expect.soft(await module.releaseArtifactLock(retry.capability)).toEqual({ ok: true, released: true });
        }
        expect.soft(evidence.hits).toBeGreaterThanOrEqual(2);
        expect.soft(await identityResidue(identity.lockPath)).toEqual([path.basename(quarantine)]);
      } finally {
        evidence.enabled = false;
        if (retryCapability) await module.releaseArtifactLock(retryCapability);
        if (firstCapability) await module.releaseArtifactLock(firstCapability);
        await cleanupIdentity(identity.lockPath);
      }
    }
  );

  it.each(["read", "rm"] as const)(
    "preserves a structured live-successor held result when recovery-guard release %s fails",
    async (operation) => {
      const { artifactPath } = await fixture();
      const base = await actualModule();
      const identity = await base.resolveArtifactLockIdentity(artifactPath);
      await deadSentinel(identity.lockPath);
      const guardPath = `${identity.lockPath}.acquire`;
      const successor = {
        version: 1,
        token: "live-successor-held-token",
        pid: process.pid,
        host: hostname(),
        owner: "live-successor-held-owner",
        acquired_at: new Date().toISOString()
      };
      let mainReads = 0;
      const evidence = { enabled: true, hit: false };
      const module = await faultedModule((actual) => ({
        readFile: (async (file, ...args: Parameters<FsPromises["readFile"]> extends [unknown, ...infer R] ? R : never) => {
          if (path.resolve(String(file)) === path.resolve(identity.lockPath)) {
            mainReads += 1;
            if (mainReads === 2) await actual.writeFile(identity.lockPath, `${JSON.stringify(successor)}\n`, "utf8");
          }
          if (operation === "read" && evidence.enabled && mainReads >= 2 &&
              path.resolve(String(file)) === path.resolve(guardPath)) {
            evidence.hit = true;
            throw ioError("held guard release read");
          }
          return actual.readFile(file, ...args as never);
        }) as FsPromises["readFile"],
        ...(operation === "rm" ? {
          rm: (async (target, options) => {
            if (evidence.enabled && mainReads >= 2 && path.resolve(String(target)) === path.resolve(guardPath)) {
              evidence.hit = true;
              throw ioError("held guard release rm");
            }
            return actual.rm(target, options);
          }) as FsPromises["rm"]
        } : {})
      }));

      let result: Awaited<ReturnType<typeof module.acquireArtifactLock>> | undefined;
      try {
        result = await module.acquireArtifactLock({ artifactPath, owner: `held-release-${operation}` });
      } catch {
        // A cleanup exception must not replace the already-decided structured held outcome.
      }
      try {
        expect(evidence.hit).toBe(true);
        expect(result).toMatchObject({
          ok: false,
          reason: "held",
          holder: { owner: successor.owner }
        });
        expect(JSON.parse(await readFileActual(identity.lockPath))).toMatchObject({ token: successor.token });
      } finally {
        evidence.enabled = false;
        await cleanupIdentity(identity.lockPath);
      }
    }
  );

  it.each(["read", "rename", "rm"] as const)(
    "rolls back the main sentinel when reclaimable acquisition-guard %s fails",
    async (operation) => {
      const { artifactPath } = await fixture();
      const base = await actualModule();
      const identity = await base.resolveArtifactLockIdentity(artifactPath);
      const guardPath = `${identity.lockPath}.acquire`;
      await writeFile(guardPath, "{\"torn-guard\"", "utf8");
      await utimes(guardPath, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));
      const owner = `guard-${operation}-fault`;
      const evidence: FaultEvidence = { enabled: true, hit: false };

      const module = await faultedModule((actual) => ({
        ...(operation === "read" ? {
          readFile: (async (file, ...args: Parameters<FsPromises["readFile"]> extends [unknown, ...infer R] ? R : never) => {
            if (evidence.enabled && path.resolve(String(file)) === path.resolve(guardPath)) {
              await captureOwnedMain(actual, identity.lockPath, owner, evidence);
              throw ioError("guard read");
            }
            return actual.readFile(file, ...args as never);
          }) as FsPromises["readFile"]
        } : {}),
        ...(operation === "rename" ? {
          rename: (async (from, to) => {
            if (evidence.enabled && path.resolve(String(from)) === path.resolve(guardPath)) {
              await captureOwnedMain(actual, identity.lockPath, owner, evidence);
              throw ioError("guard rename");
            }
            return actual.rename(from, to);
          }) as FsPromises["rename"]
        } : {}),
        ...(operation === "rm" ? {
          rm: (async (target, options) => {
            if (evidence.enabled && String(target).startsWith(`${guardPath}.stale-`)) {
              await captureOwnedMain(actual, identity.lockPath, owner, evidence);
              throw ioError("guard quarantine rm");
            }
            return actual.rm(target, options);
          }) as FsPromises["rm"]
        } : {})
      }));
      await verifyCallerVisibleOrRolledBack(
        module,
        artifactPath,
        identity.lockPath,
        module.acquireArtifactLock({ artifactPath, owner }),
        evidence,
        owner
      );
      await assertNoIdentityResidueThenCleanup(identity.lockPath);
    }
  );

  it.each(["readdir", "stat", "rm"] as const)(
    "rolls back the main sentinel when orphan-quarantine %s fails",
    async (operation) => {
      const { artifactPath } = await fixture();
      const base = await actualModule();
      const identity = await base.resolveArtifactLockIdentity(artifactPath);
      const quarantine = `${identity.lockPath}.stale-old-orphan`;
      await writeFile(quarantine, "orphan\n", "utf8");
      await utimes(quarantine, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));
      const directory = path.dirname(identity.lockPath);
      const owner = `orphan-${operation}-fault`;
      const evidence: FaultEvidence = { enabled: true, hit: false };

      const module = await faultedModule((actual) => ({
        ...(operation === "readdir" ? {
          readdir: (async (target, options) => {
            if (evidence.enabled && path.resolve(String(target)) === path.resolve(directory)) {
              await captureOwnedMain(actual, identity.lockPath, owner, evidence);
              throw ioError("orphan readdir");
            }
            return actual.readdir(target, options as never);
          }) as FsPromises["readdir"]
        } : {}),
        ...(operation === "stat" ? {
          stat: (async (target, options) => {
            if (evidence.enabled && path.resolve(String(target)) === path.resolve(quarantine)) {
              await captureOwnedMain(actual, identity.lockPath, owner, evidence);
              throw ioError("orphan stat");
            }
            return actual.stat(target, options as never);
          }) as FsPromises["stat"]
        } : {}),
        ...(operation === "rm" ? {
          rm: (async (target, options) => {
            if (evidence.enabled && path.resolve(String(target)) === path.resolve(quarantine)) {
              await captureOwnedMain(actual, identity.lockPath, owner, evidence);
              throw ioError("orphan rm");
            }
            return actual.rm(target, options);
          }) as FsPromises["rm"]
        } : {})
      }));
      await verifyCallerVisibleOrRolledBack(
        module,
        artifactPath,
        identity.lockPath,
        module.acquireArtifactLock({ artifactPath, owner }),
        evidence,
        owner
      );
      await assertNoIdentityResidueThenCleanup(identity.lockPath);
    }
  );

  it("rolls back a republished main sentinel when old-main quarantine cleanup fails", async () => {
    const { artifactPath } = await fixture();
    const base = await actualModule();
    const identity = await base.resolveArtifactLockIdentity(artifactPath);
    await deadSentinel(identity.lockPath);
    const owner = "recovery-cleanup-fault";
    const evidence: FaultEvidence = { enabled: true, hit: false };
    const module = await faultedModule((actual) => ({
      rm: (async (target, options) => {
        if (evidence.enabled && String(target).startsWith(`${identity.lockPath}.stale-`)) {
          await captureOwnedMain(actual, identity.lockPath, owner, evidence);
          throw ioError("old-main quarantine rm");
        }
        return actual.rm(target, options);
      }) as FsPromises["rm"]
    }));
    await verifyCallerVisibleOrRolledBack(
      module,
      artifactPath,
      identity.lockPath,
      module.acquireArtifactLock({ artifactPath, owner }),
      evidence,
      owner
    );
    await assertNoIdentityResidueThenCleanup(identity.lockPath);
  });

  it.each(["read", "rm"] as const)(
    "does not strand an inaccessible capability when recovery-guard release %s fails",
    async (operation) => {
      const { artifactPath } = await fixture();
      const base = await actualModule();
      const identity = await base.resolveArtifactLockIdentity(artifactPath);
      await deadSentinel(identity.lockPath);
      const guardPath = `${identity.lockPath}.acquire`;
      let recoveryRenamed = false;
      const owner = `release-guard-${operation}-fault`;
      const evidence: FaultEvidence = { enabled: true, hit: false };
      const module = await faultedModule((actual) => ({
        rename: (async (from, to) => {
          const result = await actual.rename(from, to);
          if (path.resolve(String(from)) === path.resolve(identity.lockPath)) recoveryRenamed = true;
          return result;
        }) as FsPromises["rename"],
        ...(operation === "read" ? {
          readFile: (async (file, ...args: Parameters<FsPromises["readFile"]> extends [unknown, ...infer R] ? R : never) => {
            if (evidence.enabled && recoveryRenamed && path.resolve(String(file)) === path.resolve(guardPath)) {
              await captureOwnedMain(actual, identity.lockPath, owner, evidence);
              throw ioError("release guard read");
            }
            return actual.readFile(file, ...args as never);
          }) as FsPromises["readFile"]
        } : {}),
        ...(operation === "rm" ? {
          rm: (async (target, options) => {
            if (evidence.enabled && recoveryRenamed && path.resolve(String(target)) === path.resolve(guardPath)) {
              await captureOwnedMain(actual, identity.lockPath, owner, evidence);
              throw ioError("release guard rm");
            }
            return actual.rm(target, options);
          }) as FsPromises["rm"]
        } : {})
      }));
      await verifyCallerVisibleOrRolledBack(
        module,
        artifactPath,
        identity.lockPath,
        module.acquireArtifactLock({ artifactPath, owner }),
        evidence,
        owner
      );
      await assertNoIdentityResidueThenCleanup(identity.lockPath);
    }
  );

  it.each(["orphan-cleanup", "recovery-guard-release"] as const)(
    "never deletes a successor-token sentinel while rolling back a %s fault",
    async (family) => {
    const { artifactPath } = await fixture();
    const base = await actualModule();
    const identity = await base.resolveArtifactLockIdentity(artifactPath);
    if (family === "orphan-cleanup") {
      const quarantine = `${identity.lockPath}.stale-successor-probe`;
      await writeFile(quarantine, "orphan\n", "utf8");
      await utimes(quarantine, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));
    } else {
      await deadSentinel(identity.lockPath);
    }
    const successor = {
      version: 1,
      token: "successor-token-must-survive",
      pid: process.pid,
      host: hostname(),
      owner: "successor-owner",
      acquired_at: new Date().toISOString()
    };
    const directory = path.dirname(identity.lockPath);
    const guardPath = `${identity.lockPath}.acquire`;
    const evidence: FaultEvidence = { enabled: true, hit: false };
    let recoveryRenamed = false;
    const module = await faultedModule((actual) => ({
      rename: (async (from, to) => {
        const result = await actual.rename(from, to);
        if (path.resolve(String(from)) === path.resolve(identity.lockPath)) recoveryRenamed = true;
        return result;
      }) as FsPromises["rename"],
      readdir: (async (target, options) => {
        if (family === "orphan-cleanup" && evidence.enabled && path.resolve(String(target)) === path.resolve(directory)) {
          await captureOwnedMain(actual, identity.lockPath, "replaced-owner", evidence);
          await actual.writeFile(identity.lockPath, `${JSON.stringify(successor)}\n`, "utf8");
          throw ioError("successor replacement cleanup");
        }
        return actual.readdir(target, options as never);
      }) as FsPromises["readdir"],
      readFile: (async (file, ...args: Parameters<FsPromises["readFile"]> extends [unknown, ...infer R] ? R : never) => {
        if (family === "recovery-guard-release" && evidence.enabled && recoveryRenamed && path.resolve(String(file)) === path.resolve(guardPath)) {
          await captureOwnedMain(actual, identity.lockPath, "replaced-owner", evidence);
          await actual.writeFile(identity.lockPath, `${JSON.stringify(successor)}\n`, "utf8");
          throw ioError("successor replacement guard release");
        }
        return actual.readFile(file, ...args as never);
      }) as FsPromises["readFile"]
    }));

    await expect(module.acquireArtifactLock({ artifactPath, owner: "replaced-owner" })).rejects.toThrow(/injected/);
    expect(evidence).toMatchObject({
      hit: true,
      owner: "replaced-owner",
      originalToken: expect.any(String)
    });
    expect(evidence.originalToken).not.toBe(successor.token);
    expect(JSON.parse(await readFileActual(identity.lockPath))).toMatchObject({ token: successor.token });
    // Explicit fixture teardown starts only after successor preservation is proven.
    await cleanupIdentity(identity.lockPath);
    expect(await identityResidue(identity.lockPath)).toEqual([]);
    }
  );
});

async function readFileActual(filePath: string): Promise<string> {
  const actual = await vi.importActual<FsPromises>("node:fs/promises");
  return actual.readFile(filePath, "utf8");
}
