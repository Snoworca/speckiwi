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
  /**
   * When this lease stops being honoured, written by the holder rather than inferred by a reader.
   *
   * Absent means the record makes no claim about its own lifetime, and a reader falls back to pid
   * liveness — the only rule this format had. The field is optional precisely so that stays true:
   * the workflow artifact lock writes no lease and must keep its old behaviour, and a sentinel
   * written by a build that predates this field is a record whose writer never agreed to an expiry,
   * so inventing one for it would be a reader applying its own policy to somebody else's record.
   * @req FR-NODE-207
   */
  readonly lease_expires_at?: string;
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

/**
 * A successful acquisition carries the holder it published, not only the capability to release it.
 *
 * The capability names the lock and the owner; it does not name WHICH lease this is. Two
 * acquisitions of one lock path by one owner differ only in the record on disk, so a caller holding
 * a capability could not tell a lease it took from a successor's that displaced it. Handing back the
 * record just published answers that without a second read: the value cannot have moved between
 * publishing it and returning it, whereas re-reading the sentinel could observe a successor's.
 * @req FR-NODE-204
 */
export type AcquireExclusiveLockResult =
  | { readonly ok: true; readonly capability: ExclusiveLockCapability; readonly holder: ExclusiveLockHolder }
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
  /**
   * How long the published lease is honoured for. Omitted, the sentinel carries no expiry and is
   * governed by pid liveness, which is what every caller got before this option existed.
   * @req FR-NODE-207
   */
  readonly leaseMs?: number;
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
    // An unparseable expiry fails validity rather than being honoured, and the torn-sentinel grace
    // decides instead. Honouring it would make the lock permanent, not lenient: `Date.parse` answers
    // NaN and every comparison against NaN is false, so `isReclaimable` below would answer "held"
    // for as long as the file exists — measured, with a dead pid and a sentinel a minute old.
    // @req FR-NODE-207
    (record.lease_expires_at === undefined ||
      (typeof record.lease_expires_at === "string" && Number.isFinite(Date.parse(record.lease_expires_at)))) &&
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

/**
 * Publish a sentinel atomically: either the file exists with durable contents, or not at all.
 *
 * `wx` creates the file before anything is written, so every failure after that point — including a
 * `close()` that throws AFTER a successful write and sync — leaves a live sentinel on disk that no
 * caller owns. For a mutual-exclusion sentinel that is the worst residue there is: the next acquirer
 * sees a file, honours it, and the lock is wedged until the grace period expires. The caller cannot
 * roll it back either, because a failed publish hands it no capability to release.
 *
 * So the rollback belongs here, at the only place that knows this call created the file.
 * @req FR-NODE-177
 */
async function publishExclusive(filePath: string, contents: string): Promise<void> {
  const handle = await open(filePath, "wx");
  let closed = false;
  try {
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
    // Closed inside `try` so a close failure counts as a publish failure, rather than something a
    // `finally` raises after the caller has already been told publication succeeded.
    await handle.close();
    closed = true;
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    // Best-effort: the goal is not to guarantee removal, it is to leave no sentinel behind wherever
    // removal is possible. A failure here cannot be reported without masking the original publish
    // error, which is the one the caller must see.
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
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

/**
 * A lease that names its own expiry is held until that instant, and nothing else is asked.
 *
 * Not the writer's host, and not whether the writer's process is still running. Both questions were
 * wrong for a lock a short-lived process takes on behalf of a long-running run: a CLI invocation
 * writes the sentinel and exits, so pid liveness answered "free" the moment the run began, and two
 * runs took one repository 0.536 s apart with both exiting 0. Host is skipped for the same reason it
 * mattered before — liveness cannot be probed across hosts, but an expiry needs no probe: it is an
 * absolute instant the writer published, and honouring it is what keeps a foreign-host lease from
 * being permanent.
 *
 * A record carrying no expiry keeps exactly the old rule. @req FR-NODE-207
 */
function isReclaimable(record: SentinelRecord | null, ageMs: number): boolean {
  if (!record) return ageMs >= TORN_SENTINEL_GRACE_MS;
  if (record.lease_expires_at !== undefined) return Date.now() >= Date.parse(record.lease_expires_at);
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

/**
 * Names the holder when one can be determined, and reports none when it cannot — for any reason.
 *
 * The absorption used to list ENOENT and SyntaxError, so every other read failure became a thrown
 * acquisition error. A holder removes its sentinel BEFORE closing the kernel fence, and Windows
 * answers an open of a delete-pending file with EPERM rather than ENOENT, so a waiter reading the
 * sentinel in that window met exactly the code the list omitted. The throw then left
 * `acquireReclassificationArtifactLock` before its wait loop, which retries only on `held`, so the
 * whole 30-second budget was skipped and ordinary contention was rendered as refusal. Measured at 5
 * escapes in 24000 contended acquires, every one of them here.
 *
 * Adding EPERM to the list would repeat the mistake that produced this: the failing code was the one
 * nobody had listed. Absorbing everything is safe because no caller can turn "holder unknown" into
 * "lock is free" — both internal call sites answer `held` whether or not a holder came back, and the
 * exported reader documents null as absent-or-torn. `readSentinel` above already absorbs the same
 * read-and-parse pair unconditionally, for the same reason.
 *
 * "Safe" is a claim about THIS function's callers and nothing wider. Whether an unreadable sentinel
 * may be reclaimed is decided by `readSentinel` and `isReclaimable`, not here, and there an
 * unreadable sentinel older than the torn grace IS reclaimed — measured, and measured the same way
 * before this absorption widened. @req FR-NODE-203
 */
async function readHolderAt(lockPath: string): Promise<ExclusiveLockHolder | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch {
    return null;
  }
  return validRecord(parsed) ? holderFrom(parsed) : null;
}

async function acquireRecoveryGuard(
  lockPath: string,
  record: SentinelRecord
): Promise<{ ok: true; release: () => Promise<void> } | { ok: false; holder: ExclusiveLockHolder | null }> {
  const guardPath = `${lockPath}.acquire`;
  // The guard lives for one acquisition call, not for the run the main record covers, and the
  // process making that call is alive throughout it. So it keeps pid liveness and inherits no
  // lease: a crash midway through an acquisition would otherwise leave a guard that blocks every
  // later acquire for the whole lease, and the residue this code already treats as self-healing
  // would stop being so. @req FR-NODE-207
  // Listed field by field rather than spread-and-override, so a field added to the record later
  // does not reach the guard by default: a required one is a compile error here, and an optional
  // one is simply left off — which is the safe direction for anything shaped like a lease.
  const guard: SentinelRecord = {
    version: record.version,
    token: record.token,
    pid: record.pid,
    host: record.host,
    acquired_at: record.acquired_at,
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
  // Refused at the door rather than stamped onto disk: a zero or negative lease publishes a sentinel
  // that is already expired, which reads as a lock nobody holds. @req FR-NODE-207
  const leaseMs = input.leaseMs;
  if (leaseMs !== undefined && (typeof leaseMs !== "number" || !Number.isFinite(leaseMs) || leaseMs <= 0)) {
    throw new Error("An exclusive lock lease must be a positive number of milliseconds");
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
    const acquiredAt = new Date();
    const record: SentinelRecord = {
      version: 1,
      token,
      pid: process.pid,
      host: hostname(),
      owner,
      owner_identity_sha256: ownerIdentity(owner),
      acquired_at: acquiredAt.toISOString(),
      ...(leaseMs === undefined
        ? {}
        : { lease_expires_at: new Date(acquiredAt.getTime() + leaseMs).toISOString() })
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
          // The answer is already decided and correct: a live successor holds the lock. Releasing
          // our own recovery guard is housekeeping that happens AFTER that decision, so a fault in
          // it must not replace an accurate `held` — carrying the holder a caller needs in order to
          // report or wait on it — with an exception the caller cannot act on. The guard left
          // behind is reclaimable: a later acquire clears it through
          // `clearReclaimableAcquisitionGuard`, so that residue is bounded and self-healing, which
          // a lost holder identity is not. @req FR-NODE-177
          await releaseGuard().catch(() => undefined);
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
        async () => clearExpiredOrphanQuarantines(lockPath),
        // STRICT on the first attempt, BEST-EFFORT on the retry, and the difference is deliberate.
        //
        // Strict first keeps the fault visible to `retainFailedCleanupWhileOwned`, which is what
        // validates that we still own the sentinel before deferring — the check that stops a
        // rollback from deleting a successor's sentinel. Swallowing there removes that signal, and
        // the successor-protection case goes red; measured.
        //
        // Best-effort on the retry because the retry runs at RELEASE. An orphan quarantine belongs
        // to some earlier crashed writer, not to this capability, so a permission or I/O fault on
        // it says nothing about whether this lock may be dropped. Failing the release would strand
        // a lock the caller has finished with for as long as an unrelated condition persists. The
        // orphan simply stays, and a later acquire sweeps it again. @req FR-NODE-177
        async () => {
          await clearExpiredOrphanQuarantines(lockPath).catch(() => undefined);
        }
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
      // `record` is the one this call published on BOTH paths above — onto an empty name, and onto
      // the name a stale sentinel was renamed out of — so this names the lease that is on disk now.
      // @req FR-NODE-204 AC-1
      return { ok: true, capability, holder: holderFrom(record) };
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
    // Renewing moves the expiry by as much as it moves the acquisition, so a renewed lease is the
    // one the holder asked for all over again. Reading the length off the record rather than
    // remembering it keeps the lease's terms where they are honoured — on disk — and leaves a
    // record that never carried one still carrying none. @req FR-NODE-207
    const renewedAt = new Date();
    const leaseMs = current.lease_expires_at === undefined
      ? undefined
      : Date.parse(current.lease_expires_at) - Date.parse(current.acquired_at);
    await writeFile(capability.lockPath, serialize({
      ...current,
      acquired_at: renewedAt.toISOString(),
      ...(leaseMs === undefined
        ? {}
        : { lease_expires_at: new Date(renewedAt.getTime() + leaseMs).toISOString() })
    }), "utf8");
    return true;
  });
}

export async function readExclusiveLockHolder(lockPath: string): Promise<ExclusiveLockHolder | null> {
  return readHolderAt(path.resolve(lockPath));
}
