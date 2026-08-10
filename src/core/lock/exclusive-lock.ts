import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { hostname } from "node:os";
import path from "node:path";

const TORN_SENTINEL_GRACE_MS = 5_000;

interface SentinelRecord {
  readonly version: 1;
  readonly token: string;
  readonly pid: number;
  readonly host: string;
  readonly owner: string;
  readonly owner_identity_sha256?: string;
  readonly acquired_at: string;
}

interface KernelFence {
  readonly held: boolean;
  close(): Promise<void>;
}

interface ActiveCapability {
  readonly capability: ExclusiveLockCapability;
  readonly fence: KernelFence;
  readonly cleanupTasks: Array<() => Promise<void>>;
  operationTail: Promise<void>;
  sentinelRemoved: boolean;
}

export interface ExclusiveLockCapability {
  readonly lockPath: string;
  readonly owner: string;
  readonly ownerIdentitySha256: string;
  readonly token: string;
}

export interface ExclusiveLockHolder {
  readonly owner: string;
  readonly ownerIdentitySha256: string;
  readonly pid: number;
  readonly host: string;
  readonly acquiredAt: string;
}

export type AcquireExclusiveLockResult =
  | { readonly ok: true; readonly capability: ExclusiveLockCapability }
  | { readonly ok: false; readonly reason: "held"; readonly holder?: ExclusiveLockHolder };

export type ReleaseExclusiveLockResult =
  | { readonly ok: true; readonly released: true }
  | { readonly ok: true; readonly released: false; readonly reason: "not_found" | "not_owner" }
  | {
    readonly ok: false;
    readonly reason: "cleanup_failed";
    readonly cleanupDiagnostic: Readonly<Record<string, unknown>>;
  };

export interface AcquireExclusiveLockInput {
  readonly fenceNamespace: string;
  readonly lockPath: string;
  readonly owner: string;
}

const activeCapabilities = new Map<string, ActiveCapability>();
const retainedCleanup = new Map<string, ExclusiveLockCapability>();

async function serializeCapabilityOperation<T>(
  active: ActiveCapability,
  operation: () => Promise<T>
): Promise<T> {
  const previous = active.operationTail;
  let complete: () => void = () => undefined;
  active.operationTail = new Promise<void>((resolve) => { complete = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    complete();
  }
}

function canonical(value: string): string {
  const resolved = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function ownerIdentity(owner: string, pid = process.pid, host = hostname()): string {
  return createHash("sha256").update(`${host}\0${pid}\0${owner}`, "utf8").digest("hex");
}

function validRecord(value: unknown): value is SentinelRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 &&
    typeof record.token === "string" && record.token.length > 0 &&
    typeof record.pid === "number" && Number.isSafeInteger(record.pid) && record.pid > 0 &&
    typeof record.host === "string" && record.host.length > 0 &&
    typeof record.owner === "string" && record.owner.length > 0 &&
    (record.owner_identity_sha256 === undefined ||
      (typeof record.owner_identity_sha256 === "string" && /^[a-f0-9]{64}$/.test(record.owner_identity_sha256))) &&
    typeof record.acquired_at === "string" && Number.isFinite(Date.parse(record.acquired_at));
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH" && code !== "EINVAL";
  }
}

function fenceName(namespace: string, lockPath: string): string {
  const digest = createHash("sha256").update(canonical(lockPath)).digest("hex");
  return `\\\\.\\pipe\\${namespace}-${digest}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function acquireKernelFence(namespace: string, lockPath: string): Promise<KernelFence | null> {
  if (process.platform !== "win32") return { held: true, close: async () => undefined };
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once("error", onError);
      server.listen(fenceName(namespace, lockPath), () => {
        server.off("error", onError);
        resolve();
      });
    });
  } catch (error) {
    await closeServer(server).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return null;
    throw error;
  }
  server.unref();
  return {
    get held(): boolean { return server.listening; },
    close: async () => closeServer(server)
  };
}

function serialize(record: SentinelRecord): string {
  return `${JSON.stringify(record)}\n`;
}

async function publishExclusive(filePath: string, contents: string): Promise<void> {
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readSentinel(lockPath: string): Promise<{ record: SentinelRecord | null; ageMs: number }> {
  const metadata = await stat(lockPath);
  let record: SentinelRecord | null = null;
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    if (validRecord(parsed)) record = parsed;
  } catch {
    // A new or crashed writer can leave an empty/torn sentinel. Its grace period prevents theft.
  }
  return { record, ageMs: Math.max(0, Date.now() - metadata.mtimeMs) };
}

async function removeOwnedSentinel(lockPath: string, token: string): Promise<void> {
  let current: unknown;
  try {
    current = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (validRecord(current) && current.token === token) await rm(lockPath);
}

async function clearReclaimableAcquisitionGuard(
  lockPath: string,
  ownerToken: string
): Promise<{ ok: true } | { ok: false; holder: ExclusiveLockHolder | null }> {
  const guardPath = `${lockPath}.acquire`;
  let observed: { record: SentinelRecord | null; ageMs: number };
  try {
    observed = await readSentinel(guardPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true };
    throw error;
  }
  if (!isReclaimable(observed.record, observed.ageMs)) {
    return { ok: false, holder: observed.record ? holderFrom(observed.record) : null };
  }

  // The caller already owns the main sentinel. Every contender checks that sentinel before
  // attempting an acquisition guard, so no successor guard can appear while this rename runs.
  // Moving the observed name, rather than compare-then-unlinking it, also leaves an old owner
  // unable to delete a later guard through an ABA race.
  const quarantine = `${guardPath}.stale-${ownerToken}`;
  try {
    await rename(guardPath, quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { ok: true };
  }
  await rm(quarantine, { force: true });
  return { ok: true };
}

async function clearExpiredOrphanQuarantines(lockPath: string): Promise<void> {
  const directory = path.dirname(lockPath);
  const prefix = `${path.basename(lockPath)}.stale-`;
  const now = Date.now();
  for (const entry of await readdir(directory)) {
    if (!entry.startsWith(prefix)) continue;
    const candidate = path.join(directory, entry);
    let ageMs: number;
    try {
      ageMs = Math.max(0, now - (await stat(candidate)).mtimeMs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (ageMs >= TORN_SENTINEL_GRACE_MS) await rm(candidate, { force: true });
  }
}

async function sentinelHasToken(lockPath: string, token: string): Promise<boolean> {
  let current: unknown;
  try {
    current = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  return validRecord(current) && current.token === token;
}

async function retryAcquisitionGuardCleanup(lockPath: string, token: string): Promise<void> {
  await rm(`${lockPath}.acquire.stale-${token}`, { force: true });
  const result = await clearReclaimableAcquisitionGuard(lockPath, token);
  if (!result.ok) {
    throw Object.assign(new Error("The acquisition guard is still held"), { code: "ELOCKHELD" });
  }
}

async function retainFailedCleanupWhileOwned(
  lockPath: string,
  token: string,
  cleanupTasks: Array<() => Promise<void>>,
  operation: () => Promise<void>,
  retry = operation
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    let owned = false;
    try {
      owned = await sentinelHasToken(lockPath, token);
    } catch {
      // Preserve the cleanup failure that triggered ownership validation.
    }
    if (!owned) throw error;
    cleanupTasks.push(retry);
  }
}

function isReclaimable(record: SentinelRecord | null, ageMs: number): boolean {
  if (!record) return ageMs >= TORN_SENTINEL_GRACE_MS;
  if (record.host === hostname()) return !processIsAlive(record.pid);
  return false;
}

function holderFrom(record: SentinelRecord): ExclusiveLockHolder {
  return Object.freeze({
    owner: record.owner,
    ownerIdentitySha256: record.owner_identity_sha256 ?? ownerIdentity(record.owner, record.pid, record.host),
    pid: record.pid,
    host: record.host,
    acquiredAt: record.acquired_at
  });
}

async function readHolderAt(lockPath: string): Promise<ExclusiveLockHolder | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
  return validRecord(parsed) ? holderFrom(parsed) : null;
}

async function acquireRecoveryGuard(
  lockPath: string,
  record: SentinelRecord
): Promise<{ ok: true; release: () => Promise<void> } | { ok: false; holder: ExclusiveLockHolder | null }> {
  const guardPath = `${lockPath}.acquire`;
  const guard: SentinelRecord = {
    ...record,
    owner: `${record.owner}:acquire`,
    owner_identity_sha256: ownerIdentity(`${record.owner}:acquire`)
  };
  try {
    await publishExclusive(guardPath, serialize(guard));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return { ok: false, holder: await readHolderAt(guardPath) };
  }
  return {
    ok: true,
    release: async () => {
      let current: unknown;
      try {
        current = JSON.parse(await readFile(guardPath, "utf8")) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (validRecord(current) && current.token === record.token) await rm(guardPath);
    }
  };
}

export async function acquireExclusiveLock(input: AcquireExclusiveLockInput): Promise<AcquireExclusiveLockResult> {
  const owner = typeof input?.owner === "string" ? input.owner.trim() : "";
  if (!owner) throw new Error("Acquiring an exclusive lock requires an owner");
  if (typeof input?.lockPath !== "string" || !path.isAbsolute(input.lockPath)) {
    throw new Error("Acquiring an exclusive lock requires an absolute lock path");
  }
  if (typeof input?.fenceNamespace !== "string" || input.fenceNamespace.trim().length === 0) {
    throw new Error("Acquiring an exclusive lock requires a fence namespace");
  }

  const lockPath = path.resolve(input.lockPath);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const fence = await acquireKernelFence(input.fenceNamespace, lockPath);
  if (!fence) {
    const holder = await readHolderAt(lockPath);
    return holder ? { ok: false, reason: "held", holder } : { ok: false, reason: "held" };
  }

  let acquired = false;
  try {
    const token = randomUUID();
    const record: SentinelRecord = {
      version: 1,
      token,
      pid: process.pid,
      host: hostname(),
      owner,
      owner_identity_sha256: ownerIdentity(owner),
      acquired_at: new Date().toISOString()
    };
    const cleanupTasks: Array<() => Promise<void>> = [];
    let releaseGuard: (() => Promise<void>) | null = null;
    let published = false;
    try {
      try {
        await publishExclusive(lockPath, serialize(record));
        published = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let observed = await readSentinel(lockPath);
        if (!isReclaimable(observed.record, observed.ageMs)) {
          return observed.record
            ? { ok: false, reason: "held", holder: holderFrom(observed.record) }
            : { ok: false, reason: "held" };
        }

        const guard = await acquireRecoveryGuard(lockPath, record);
        if (!guard.ok) return guard.holder
          ? { ok: false, reason: "held", holder: guard.holder }
          : { ok: false, reason: "held" };
        releaseGuard = guard.release;

        // The sentinel may have changed before this contender won the recovery guard.
        // Re-read it under the guard and never quarantine a live successor.
        observed = await readSentinel(lockPath);
        if (!isReclaimable(observed.record, observed.ageMs)) {
          const held: AcquireExclusiveLockResult = observed.record
            ? { ok: false, reason: "held", holder: holderFrom(observed.record) }
            : { ok: false, reason: "held" };
          await releaseGuard();
          releaseGuard = null;
          return held;
        }
        const quarantine = `${lockPath}.stale-${token}`;
        await rename(lockPath, quarantine);
        try {
          await publishExclusive(lockPath, serialize(record));
          published = true;
        } catch (error) {
          await rm(quarantine, { force: true }).catch(() => undefined);
          throw error;
        }
        await retainFailedCleanupWhileOwned(
          lockPath,
          token,
          cleanupTasks,
          async () => rm(quarantine, { force: true })
        );
      }

      if (!releaseGuard) {
        let guardCleanup: Awaited<ReturnType<typeof clearReclaimableAcquisitionGuard>> | undefined;
        try {
          guardCleanup = await clearReclaimableAcquisitionGuard(lockPath, token);
        } catch (error) {
          await retainFailedCleanupWhileOwned(
            lockPath,
            token,
            cleanupTasks,
            async () => { throw error; },
            async () => retryAcquisitionGuardCleanup(lockPath, token)
          );
        }
        if (guardCleanup && !guardCleanup.ok) {
          await removeOwnedSentinel(lockPath, token);
          return guardCleanup.holder
            ? { ok: false, reason: "held", holder: guardCleanup.holder }
            : { ok: false, reason: "held" };
        }
      }
      await retainFailedCleanupWhileOwned(
        lockPath,
        token,
        cleanupTasks,
        async () => clearExpiredOrphanQuarantines(lockPath)
      );
      if (releaseGuard) {
        const guardCleanup = releaseGuard;
        await retainFailedCleanupWhileOwned(lockPath, token, cleanupTasks, guardCleanup);
        releaseGuard = null;
      }

      const capability = Object.freeze({
        lockPath,
        owner,
        ownerIdentitySha256: record.owner_identity_sha256 ?? ownerIdentity(owner),
        token
      });
      activeCapabilities.set(token, {
        capability,
        fence,
        cleanupTasks,
        operationTail: Promise.resolve(),
        sentinelRemoved: false
      });
      acquired = true;
      return { ok: true, capability };
    } catch (error) {
      if (releaseGuard) await releaseGuard().catch(() => undefined);
      if (published) await removeOwnedSentinel(lockPath, token).catch(() => undefined);
      throw error;
    }
  } finally {
    if (!acquired) await fence.close().catch(() => undefined);
  }
}

function cleanupDiagnostic(error: unknown, lockPath: string): Readonly<Record<string, unknown>> {
  const nodeError = error as NodeJS.ErrnoException;
  return Object.freeze({
    code: nodeError.code ?? "LOCK_CLEANUP_FAILED",
    lockPath,
    message: error instanceof Error ? error.message : String(error)
  });
}

export async function releaseExclusiveLock(
  capability: ExclusiveLockCapability
): Promise<ReleaseExclusiveLockResult> {
  const active = activeCapabilities.get(capability.token);
  if (!active ||
      canonical(active.capability.lockPath) !== canonical(capability.lockPath) ||
      active.capability.ownerIdentitySha256 !== capability.ownerIdentitySha256) {
    return { ok: true, released: false, reason: "not_owner" };
  }

  return serializeCapabilityOperation(active, async () => {
    if (activeCapabilities.get(capability.token) !== active) {
      return { ok: true, released: false, reason: "not_owner" };
    }
    try {
      while (active.cleanupTasks.length > 0) {
        const cleanupTask = active.cleanupTasks[0];
        if (!cleanupTask) break;
        await cleanupTask();
        active.cleanupTasks.shift();
      }
      if (!active.sentinelRemoved) {
        let current: unknown;
        try {
          current = JSON.parse(await readFile(capability.lockPath, "utf8")) as unknown;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            active.sentinelRemoved = true;
          } else {
            throw error;
          }
        }
        if (!active.sentinelRemoved) {
          if (!validRecord(current) || current.token !== capability.token) {
            await active.fence.close();
            activeCapabilities.delete(capability.token);
            retainedCleanup.delete(canonical(capability.lockPath));
            return { ok: true, released: false, reason: "not_owner" };
          }
          await rm(capability.lockPath);
          active.sentinelRemoved = true;
        }
      }
      await active.fence.close();
      activeCapabilities.delete(capability.token);
      retainedCleanup.delete(canonical(capability.lockPath));
      return { ok: true, released: true };
    } catch (error) {
      retainedCleanup.set(canonical(capability.lockPath), active.capability);
      return { ok: false, reason: "cleanup_failed", cleanupDiagnostic: cleanupDiagnostic(error, capability.lockPath) };
    }
  });
}

export async function retryRetainedExclusiveLockCleanup(
  lockPath: string
): Promise<ReleaseExclusiveLockResult> {
  const key = canonical(lockPath);
  const capability = retainedCleanup.get(key);
  if (!capability) return { ok: true, released: false, reason: "not_found" };
  retainedCleanup.delete(key);
  return releaseExclusiveLock(capability);
}

export async function renewExclusiveLock(capability: ExclusiveLockCapability): Promise<boolean> {
  const active = activeCapabilities.get(capability.token);
  if (!active) return false;
  return serializeCapabilityOperation(active, async () => {
    if (activeCapabilities.get(capability.token) !== active || !active.fence.held) return false;
    let current: unknown;
    try {
      current = JSON.parse(await readFile(capability.lockPath, "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!validRecord(current) || current.token !== capability.token) return false;
    await writeFile(capability.lockPath, serialize({
      ...current,
      acquired_at: new Date().toISOString()
    }), "utf8");
    return true;
  });
}

export async function readExclusiveLockHolder(lockPath: string): Promise<ExclusiveLockHolder | null> {
  return readHolderAt(path.resolve(lockPath));
}
