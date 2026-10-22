import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { link, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { diagnostic, summarizeDiagnostics } from "../diagnostic.js";
import type { Diagnostic, MutationResult, ProjectRoot, SrsMutationLockError, SrsMutationLockMetadata } from "../types.js";
import { refreshSrsStatusCache } from "../status-cache.js";
import { isBusy, retryBusy } from "../lock/busy-retry.js";

export const SRS_LOCK_PATH = "kiwi/.srs.lock";
const SRS_LOCK_GUARD_PATH = "kiwi/.srs.lock.guard";
const SRS_LOCK_SCHEMA_VERSION = "1.0.0";
const DEFAULT_LOCK_TTL_MS = 60_000;
const DEFAULT_GUARD_TTL_MS = 30_000;

// @req REL-NODE-009 — the timing contract.
/** A lock or guard file that names no holder (empty, not JSON) is recovered only after this grace. */
const TORN_GRACE_MS = 5_000;
/** How long a release keeps trying before it reports the leftover lock (at least 1 s). */
const RELEASE_WINDOW_MS = 1_200;
const RELEASE_RETRY_DELAY_MS = 50;
/** What a refusal caused by an active guard recommends: the guard lives for milliseconds. */
const GUARD_RETRY_DELAY_MS = 250;
const BUSY_RETRY_DELAY_MS = 500;
const BUSY_MESSAGE = "another process may be deleting the lock file; if this persists, check permissions on kiwi/";
/** How long a contender that captured a successor's file keeps trying to put it back. */
const RESTORE_WINDOW_MS = 1_200;
/**
 * How long a holder whose own file is missing waits for it to come back: longer than a restorer
 * keeps trying, so a file put back late is still found by its owner rather than left with none.
 */
const OWN_FILE_WAIT_MS = RESTORE_WINDOW_MS + 500;

export interface SrsMutationLockOptions {
  operation: string;
  dryRun?: boolean | undefined;
  ignoreLock?: boolean | undefined;
  skipLock?: boolean | undefined;
  ttlMs?: number | undefined;
}

interface AcquiredLock {
  metadata: SrsMutationLockMetadata;
  diagnostics: Diagnostic[];
}

function relativeAbsolutePath(root: ProjectRoot, relativePath: string): string {
  return path.join(root.root, relativePath);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errnoOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}


function retryFor(metadata: SrsMutationLockMetadata): SrsMutationLockError["retry"] {
  const expiresAt = Date.parse(metadata.expiresAt);
  return {
    message: "SRS mutation lock is active; retry after the lock expires or rerun with ignoreLock only if this is an SRS-only override.",
    recommendedDelayMs: Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : DEFAULT_LOCK_TTL_MS
  };
}

function unknownLock(operation: string): SrsMutationLockMetadata {
  const acquiredAt = nowIso();
  return {
    schemaVersion: SRS_LOCK_SCHEMA_VERSION,
    owner: "unknown",
    operation,
    requestId: "unknown",
    acquiredAt,
    expiresAt: new Date(Date.now() + DEFAULT_LOCK_TTL_MS).toISOString()
  };
}

/** A structured SRS_LOCKED refusal; `message` and `recommendedDelayMs` default to the holder's. */
function lockRefusal(
  metadata: SrsMutationLockMetadata,
  details: Record<string, unknown> = {},
  override: { message?: string; recommendedDelayMs?: number; filePath?: string } = {}
): MutationResult {
  const retry = retryFor(metadata);
  const lock: SrsMutationLockError = {
    ...metadata,
    retry: {
      message: override.message ?? retry.message,
      recommendedDelayMs: override.recommendedDelayMs ?? retry.recommendedDelayMs
    }
  };
  const message = override.message ?? `SRS mutation lock is active for ${metadata.operation} by ${metadata.owner}; retry after ${metadata.expiresAt}.`;
  const lockDiagnostic = diagnostic("SRS-E065", "error", message, { filePath: override.filePath ?? SRS_LOCK_PATH }, { ...details, lock });
  return {
    ok: false,
    error: { code: "SRS_LOCKED", message, diagnostics: [lockDiagnostic], lock },
    diagnostics: [lockDiagnostic],
    diagnosticsSummary: summarizeDiagnostics([lockDiagnostic])
  };
}

function lockError(metadata: SrsMutationLockMetadata, details: Record<string, unknown> = {}): MutationResult {
  return lockRefusal(metadata, details);
}

/** @req REL-NODE-009 AC-9 — a file operation that stayed busy through its retries. */
function lockBusy(error: unknown, operation: string): MutationResult {
  const errno = errnoOf(error) ?? "EBUSY";
  return lockRefusal(unknownLock(operation), { kind: "lock-busy", errno }, {
    message: `SRS mutation lock file is busy (${errno}): ${BUSY_MESSAGE}`,
    recommendedDelayMs: BUSY_RETRY_DELAY_MS
  });
}

function isLockMetadata(value: unknown): value is SrsMutationLockMetadata {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SrsMutationLockMetadata>;
  return (
    record.schemaVersion === SRS_LOCK_SCHEMA_VERSION &&
    typeof record.owner === "string" &&
    typeof record.operation === "string" &&
    typeof record.requestId === "string" &&
    typeof record.acquiredAt === "string" &&
    typeof record.expiresAt === "string"
  );
}

/** The parsed JSON, or undefined when the text is not JSON (a torn write). */
function parseJson(text: string): { value: unknown } | undefined {
  if (text.trim() === "") return undefined;
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/**
 * Which file on disk a state was read from: `dev` + `ino` + `mtimeNs` of the stat taken when it was
 * judged. A rename keeps all three, so the file a quarantine captured can be compared with the file
 * that was judged stale. (Review r1 H1: comparing bytes cannot tell an empty torn file from a fresh
 * one not yet written.) `ino` alone is not enough: Linux ext4 gives a new file the inode number just
 * freed, so a successor created after the judgment can share `dev` + `ino`, and within one timestamp
 * tick its mtime as well. That is why `isJudgedFile` adds what a successor cannot share: the 5 s age
 * a torn file must have, and the bytes (a fresh request id) of a valid one.
 */
interface FileIdentity {
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
}

/** What a lock or guard file holds, read once. */
type LockFileState =
  | { kind: "absent" }
  | { kind: "symlink" }
  | { kind: "unreadable"; error: string }
  /** Empty or not JSON: names no holder. Recoverable only after the grace. */
  | { kind: "torn"; raw: string; ageMs: number; id: FileIdentity }
  /** Parseable but not a lock this version writes: never taken over. */
  | { kind: "unknown-format"; version: string }
  | { kind: "valid"; raw: string; metadata: SrsMutationLockMetadata; stale: boolean; id: FileIdentity };

/** @req REL-NODE-005 AC-6 @req REL-NODE-009 AC-4 AC-5 — reads and classifies one lock or guard file. */
async function readLockFileState(root: ProjectRoot, relativePath: string): Promise<LockFileState> {
  const filePath = relativeAbsolutePath(root, relativePath);
  let stats;
  try {
    stats = await retryBusy(() => lstat(filePath, { bigint: true }));
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return { kind: "absent" };
    throw error;
  }
  if (stats.isSymbolicLink()) return { kind: "symlink" };
  let raw: string;
  try {
    raw = await retryBusy(() => readFile(filePath, "utf8"));
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return { kind: "absent" };
    if (isBusy(error)) throw error;
    return { kind: "unreadable", error: (error as Error).message };
  }
  const parsed = parseJson(raw);
  const id: FileIdentity = { dev: stats.dev, ino: stats.ino, mtimeNs: stats.mtimeNs };
  if (!parsed) return { kind: "torn", raw, ageMs: Date.now() - Number(stats.mtimeMs), id };
  if (!isLockMetadata(parsed.value)) {
    const version = (parsed.value as { schemaVersion?: unknown } | null)?.schemaVersion;
    return { kind: "unknown-format", version: typeof version === "string" ? version : "none" };
  }
  const expiresAt = Date.parse(parsed.value.expiresAt);
  return { kind: "valid", raw, metadata: parsed.value, stale: Number.isFinite(expiresAt) && expiresAt <= Date.now(), id };
}

/** The refusal a state that blocks acquisition answers with, or undefined when it does not block. */
function blockingRefusal(state: LockFileState, relativePath: string, operation: string, activeKind?: string): MutationResult | undefined {
  switch (state.kind) {
    case "symlink":
      return lockRefusal(unknownLock(operation), { kind: "symlink-lock" }, { filePath: relativePath });
    case "unreadable":
      return lockRefusal(unknownLock(operation), { kind: "unreadable-lock", error: state.error }, { filePath: relativePath });
    case "torn":
      return state.ageMs > TORN_GRACE_MS
        ? undefined
        : lockRefusal(unknownLock(operation), { kind: "torn-lock" }, {
            filePath: relativePath,
            message: `SRS mutation lock file ${relativePath} is empty or unreadable; it is recovered once it is ${TORN_GRACE_MS / 1000} s old.`,
            recommendedDelayMs: Math.min(TORN_GRACE_MS, Math.max(0, TORN_GRACE_MS - state.ageMs))
          });
    case "unknown-format":
      return lockRefusal(unknownLock(operation), { kind: "unknown-lock-format", version: state.version }, {
        filePath: relativePath,
        message:
          `SRS mutation lock file ${relativePath} has an unknown format (schemaVersion ${state.version}); another SpecKiwi version may hold the lock. ` +
          `Delete ${relativePath} only when no other SpecKiwi process is running.`,
        recommendedDelayMs: DEFAULT_LOCK_TTL_MS
      });
    case "valid":
      if (state.stale) return undefined;
      return activeKind === "lock-guard-active"
        ? lockRefusal(state.metadata, { kind: activeKind }, { filePath: relativePath, recommendedDelayMs: GUARD_RETRY_DELAY_MS })
        : lockError(state.metadata);
    case "absent":
      return undefined;
  }
}

/**
 * Whether the file a quarantine captured is the file that was judged. By `dev` + `ino` + `mtimeNs`
 * where the file system reports an inode; where it reports none (0), by the bytes and, for a torn
 * file, by the captured file's own age, so a file younger than the grace is never taken for a torn
 * one. A valid file is compared by its bytes as well: it is judged by its expiry rather than its age,
 * so a short-TTL file and a successor written within one timestamp tick could share an mtime, never
 * a request id. @req REL-NODE-010
 */
async function isJudgedFile(quarantine: string, judged: Extract<LockFileState, { kind: "torn" | "valid" }>): Promise<boolean> {
  const stats = await retryBusy(() => lstat(quarantine, { bigint: true }));
  if (judged.id.ino !== 0n && stats.ino !== 0n) {
    if (stats.dev !== judged.id.dev || stats.ino !== judged.id.ino || stats.mtimeNs !== judged.id.mtimeNs) return false;
    if (judged.kind === "torn") return true;
  }
  const raw = await retryBusy(() => readFile(quarantine, "utf8"));
  if (raw !== judged.raw) return false;
  return judged.kind === "valid" || Date.now() - Number(stats.mtimeMs) > TORN_GRACE_MS;
}

/**
 * Puts a wrongly captured file back without overwriting anything. Review r1 M2: when another
 * contender has taken the empty path meanwhile (`link` gives EEXIST), back off and retry rather than
 * delete the captured file — guards live for milliseconds, so the path frees almost at once. Only if
 * it never frees within the window is the captured file dropped; its owner's release then finds no
 * guard of its own and removes nothing.
 */
async function restoreCaptured(quarantine: string, target: string): Promise<void> {
  const deadline = Date.now() + RESTORE_WINDOW_MS;
  for (;;) {
    try {
      await retryBusy(() => link(quarantine, target));
      break;
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") {
        await rm(quarantine, { force: true }).catch(() => undefined);
        throw error;
      }
      if (Date.now() >= deadline) break;
      await sleep(RELEASE_RETRY_DELAY_MS);
    }
  }
  await retryBusy(() => rm(quarantine, { force: true }));
}

/** The judged file was taken off the path but its quarantine name could not be deleted. */
class QuarantineLeftBehind extends Error {
  /** The errno of the failed delete, so acquisition answers it as it answers any busy file. */
  readonly code: string | undefined;
  constructor(readonly quarantine: string, cause: unknown) {
    super(`could not delete ${quarantine}: ${(cause as Error).message}`);
    this.code = errnoOf(cause);
  }
}

/**
 * @req REL-NODE-009 AC-6 @req REL-NODE-005 AC-6 — removes the file that was judged, and only that file.
 * The path is renamed to a unique quarantine name, which only one contender can win; the winner then
 * checks the captured file is the judged one (file identity). If it captured a successor's file, it
 * puts it back and reports the race as lost. Used for a stale guard, a stale or torn lock, and a
 * holder's own release (review r1 M1: no read-compare-rm anywhere).
 */
async function removeJudgedFile(root: ProjectRoot, relativePath: string, judged: Extract<LockFileState, { kind: "torn" | "valid" }>): Promise<"removed" | "lost"> {
  const target = relativeAbsolutePath(root, relativePath);
  const quarantine = `${target}.quarantine-${randomUUID()}`;
  try {
    await retryBusy(() => rename(target, quarantine));
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return "lost";
    throw error;
  }
  if (await isJudgedFile(quarantine, judged)) {
    try {
      await retryBusy(() => rm(quarantine, { force: true }));
    } catch (error) {
      throw new QuarantineLeftBehind(quarantine, error);
    }
    return "removed";
  }
  await restoreCaptured(quarantine, target);
  return "lost";
}

/** @req REL-NODE-009 AC-8 — creates the file exclusively; a failed metadata write removes it again. */
async function createLockFile(root: ProjectRoot, relativePath: string, operation: string, ttlMs: number): Promise<SrsMutationLockMetadata> {
  const filePath = relativeAbsolutePath(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  const acquiredAt = Date.now();
  const metadata: SrsMutationLockMetadata = {
    schemaVersion: SRS_LOCK_SCHEMA_VERSION,
    owner: `${hostname()}:${process.pid}`,
    operation,
    requestId: randomUUID(),
    acquiredAt: new Date(acquiredAt).toISOString(),
    expiresAt: new Date(acquiredAt + ttlMs).toISOString()
  };
  const handle = await retryBusy(() => open(filePath, "wx"));
  try {
    await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return metadata;
}

function sameLockIdentity(left: SrsMutationLockMetadata, right: SrsMutationLockMetadata): boolean {
  return left.owner === right.owner && left.operation === right.operation && left.requestId === right.requestId && left.acquiredAt === right.acquiredAt;
}

function recovered(relativePath: string, stale: unknown): Diagnostic {
  return diagnostic("SRS-W068", "warning", `Recovered stale SRS mutation lock${relativePath === SRS_LOCK_GUARD_PATH ? " guard" : ""}: ${relativePath}`, { filePath: relativePath }, { staleLock: stale });
}

/** Takes the guard, recovering a stale one (expired, or torn past the grace) by quarantine. */
async function acquireLockGuard(root: ProjectRoot, operation: string): Promise<AcquiredLock | MutationResult> {
  const guardOperation = `srs_lock_guard:${operation}`;
  try {
    return { metadata: await createLockFile(root, SRS_LOCK_GUARD_PATH, guardOperation, DEFAULT_GUARD_TTL_MS), diagnostics: [] };
  } catch (error) {
    if (errnoOf(error) !== "EEXIST") throw error;
  }
  const state = await readLockFileState(root, SRS_LOCK_GUARD_PATH);
  const refusal = blockingRefusal(state, SRS_LOCK_GUARD_PATH, operation, "lock-guard-active");
  if (refusal) return refusal;
  const guardActive = (): MutationResult => lockRefusal(unknownLock(operation), { kind: "lock-guard-active" }, { filePath: SRS_LOCK_GUARD_PATH, recommendedDelayMs: GUARD_RETRY_DELAY_MS });
  if (state.kind !== "torn" && state.kind !== "valid") return guardActive();
  if ((await removeJudgedFile(root, SRS_LOCK_GUARD_PATH, state)) === "lost") return guardActive();
  try {
    const metadata = await createLockFile(root, SRS_LOCK_GUARD_PATH, guardOperation, DEFAULT_GUARD_TTL_MS);
    return { metadata, diagnostics: [recovered(SRS_LOCK_GUARD_PATH, state.kind === "valid" ? state.metadata : { torn: true })] };
  } catch (error) {
    if (errnoOf(error) === "EEXIST") return guardActive();
    throw error;
  }
}

/**
 * Removes `relativePath` when it names `metadata`. True when no file of this holder is left at the
 * path afterwards; false when the path holds this holder's file that could not be taken.
 *
 * When the holder's file is not at the path, it may be in another contender's quarantine on its way
 * back (a capture that turned out to be a successor's file is restored). Returning at once left that
 * file at the path with no owner until its TTL, found under load in the full suite. So the holder
 * waits for the file longer than any restorer keeps trying, and removes it if it comes back.
 */
async function releaseLockFileIfOwner(root: ProjectRoot, relativePath: string, metadata: SrsMutationLockMetadata): Promise<boolean> {
  const deadline = Date.now() + OWN_FILE_WAIT_MS;
  for (;;) {
    const current = await readLockFileState(root, relativePath);
    if (current.kind === "valid" && sameLockIdentity(current.metadata, metadata)) {
      await removeJudgedFile(root, relativePath, current);
      const after = await readLockFileState(root, relativePath);
      return after.kind !== "valid" || !sameLockIdentity(after.metadata, metadata);
    }
    if (Date.now() >= deadline) return true;
    await sleep(RELEASE_RETRY_DELAY_MS);
  }
}

/** Releases the guard; a failure only leaves the guard until its TTL. */
async function releaseGuardQuietly(root: ProjectRoot, guard: AcquiredLock): Promise<void> {
  await releaseLockFileIfOwner(root, SRS_LOCK_GUARD_PATH, guard.metadata).catch(() => undefined);
}

function isRefusal(value: AcquiredLock | MutationResult): value is MutationResult {
  return "ok" in value && value.ok === false;
}

async function acquireUnderGuard(root: ProjectRoot, options: SrsMutationLockOptions): Promise<AcquiredLock | MutationResult> {
  const guard = await acquireLockGuard(root, options.operation);
  if (isRefusal(guard)) return guard;
  const diagnostics: Diagnostic[] = [...guard.diagnostics];
  try {
    const rechecked = await readLockFileState(root, SRS_LOCK_PATH);
    const refusal = blockingRefusal(rechecked, SRS_LOCK_PATH, options.operation);
    if (refusal) return refusal;
    if (rechecked.kind === "valid" || rechecked.kind === "torn") {
      // The stale file is taken by quarantine and file identity, so a lock created meanwhile survives.
      if ((await removeJudgedFile(root, SRS_LOCK_PATH, rechecked)) === "removed") {
        diagnostics.push(recovered(SRS_LOCK_PATH, rechecked.kind === "valid" ? rechecked.metadata : { torn: true }));
      }
    }
    try {
      return { metadata: await createLockFile(root, SRS_LOCK_PATH, options.operation, options.ttlMs ?? DEFAULT_LOCK_TTL_MS), diagnostics };
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") throw error;
      const raced = await readLockFileState(root, SRS_LOCK_PATH);
      return blockingRefusal(raced, SRS_LOCK_PATH, options.operation) ?? lockError(unknownLock(options.operation));
    }
  } finally {
    await releaseGuardQuietly(root, guard);
  }
}

async function acquireSrsMutationLock(root: ProjectRoot, options: SrsMutationLockOptions): Promise<AcquiredLock | MutationResult> {
  try {
    const existing = await readLockFileState(root, SRS_LOCK_PATH);
    const refusal = blockingRefusal(existing, SRS_LOCK_PATH, options.operation);
    if (refusal) return refusal;
    if (options.dryRun) {
      const wouldRecover = existing.kind === "valid" || existing.kind === "torn";
      return {
        metadata: unknownLock(options.operation),
        diagnostics: wouldRecover ? [diagnostic("SRS-W068", "warning", `Stale SRS mutation lock would be recovered: ${SRS_LOCK_PATH}`, { filePath: SRS_LOCK_PATH }, { staleLock: existing.kind === "valid" ? existing.metadata : { torn: true } })] : []
      };
    }
    return await acquireUnderGuard(root, options);
  } catch (error) {
    if (isBusy(error)) return lockBusy(error, options.operation);
    throw error;
  }
}

/**
 * @req REL-NODE-009 AC-1 AC-2 AC-3 — removes the lock this call took. A busy guard or a busy file
 * operation is retried for the release window; whatever happens, the mutation's result stands, and a
 * lock that could not be removed is reported as SRS-W076 (it is recovered at its own expiresAt).
 */
async function releaseSrsMutationLock(root: ProjectRoot, lock: SrsMutationLockMetadata, operation: string): Promise<Diagnostic[]> {
  const deadline = Date.now() + RELEASE_WINDOW_MS;
  // Our lock, already off the path, under a quarantine name that could not be deleted yet.
  let leftover: string | undefined;
  for (;;) {
    try {
      if (leftover !== undefined) {
        await retryBusy(() => rm(leftover as string, { force: true }));
        return [];
      }
      const guard = await acquireLockGuard(root, `release:${operation}`);
      if (!isRefusal(guard)) {
        try {
          if (await releaseLockFileIfOwner(root, SRS_LOCK_PATH, lock)) return [];
          const current = await readLockFileState(root, SRS_LOCK_PATH);
          // Someone else's lock (ours was recovered after it expired) is not ours to report.
          if (current.kind !== "valid" || !sameLockIdentity(current.metadata, lock)) return [];
        } finally {
          await releaseGuardQuietly(root, guard);
        }
      }
    } catch (error) {
      // A release failure must not change the mutation's result; keep trying until the window ends.
      if (error instanceof QuarantineLeftBehind) leftover = error.quarantine;
    }
    if (Date.now() >= deadline) {
      const where = leftover === undefined ? "" : ` (moved aside as ${path.relative(root.root, leftover).replace(/\\/g, "/")}, which names no live holder)`;
      return [
        diagnostic(
          "SRS-W076",
          "warning",
          `SRS mutation lock could not be released: ${SRS_LOCK_PATH}${where} is left until it expires at ${lock.expiresAt}`,
          { filePath: SRS_LOCK_PATH },
          { lock, ...(leftover === undefined ? {} : { leftover }) }
        )
      ];
    }
    await sleep(RELEASE_RETRY_DELAY_MS);
  }
}

function mergeDiagnostics<T>(result: MutationResult<T>, diagnostics: Diagnostic[]): MutationResult<T> {
  if (diagnostics.length === 0) return result;
  const merged = [...result.diagnostics, ...diagnostics];
  return {
    ...result,
    diagnostics: merged,
    diagnosticsSummary: summarizeDiagnostics(merged),
    ...(result.error ? { error: { ...result.error, diagnostics: [...(result.error.diagnostics ?? []), ...diagnostics] } } : {})
  };
}

function resultWrote(result: MutationResult): boolean {
  return Boolean(result.ok && result.value && typeof result.value === "object" && "written" in result.value && (result.value as { written?: unknown }).written === true);
}

async function refreshCacheDiagnostics(root: ProjectRoot, lockMetadata: SrsMutationLockMetadata | null): Promise<Diagnostic[]> {
  try {
    const refreshed = await refreshSrsStatusCache(root, lockMetadata);
    return refreshed.ok ? [] : refreshed.diagnostics;
  } catch (error) {
    return [diagnostic("SRS-W066", "warning", `SRS status cache write failed: ${(error as Error).message}`, { filePath: "kiwi/.status.json" }, { rebuildable: true })];
  }
}

export async function withSrsMutationLock<T>(root: ProjectRoot, options: SrsMutationLockOptions, mutate: () => Promise<MutationResult<T>>): Promise<MutationResult<T>> {
  if (options.skipLock) return mutate();

  if (options.ignoreLock) {
    const bypass = diagnostic("SRS-W067", "warning", `SRS mutation lock bypassed for ${options.operation}`, { filePath: SRS_LOCK_PATH }, { operation: options.operation, bypass: "srs-lock-only" });
    const result = await mutate();
    const cacheDiagnostics = resultWrote(result) ? await refreshCacheDiagnostics(root, null) : [];
    return mergeDiagnostics(result, [bypass, ...cacheDiagnostics]);
  }

  const acquired = await acquireSrsMutationLock(root, options);
  if (isRefusal(acquired)) return acquired as MutationResult<T>;
  const lock = acquired;

  const preDiagnostics = options.dryRun ? lock.diagnostics : [...lock.diagnostics, ...(await refreshCacheDiagnostics(root, lock.metadata))];
  let result: MutationResult<T> | undefined;
  let releaseDiagnostics: Diagnostic[] = [];
  try {
    result = await mutate();
  } finally {
    if (!options.dryRun) releaseDiagnostics = await releaseSrsMutationLock(root, lock.metadata, options.operation);
  }
  const postDiagnostics = !options.dryRun && resultWrote(result) ? await refreshCacheDiagnostics(root, null) : [];
  return mergeDiagnostics(result, [...preDiagnostics, ...releaseDiagnostics, ...postDiagnostics]);
}
