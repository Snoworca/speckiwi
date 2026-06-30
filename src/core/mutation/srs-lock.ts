import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { diagnostic, summarizeDiagnostics } from "../diagnostic.js";
import type { Diagnostic, MutationResult, ProjectRoot, SrsMutationLockError, SrsMutationLockMetadata } from "../types.js";
import { refreshSrsStatusCache } from "../status-cache.js";

export const SRS_LOCK_PATH = "kiwi/.srs.lock";
const SRS_LOCK_GUARD_PATH = "kiwi/.srs.lock.guard";
const SRS_LOCK_SCHEMA_VERSION = "1.0.0";
const DEFAULT_LOCK_TTL_MS = 60_000;
const DEFAULT_GUARD_TTL_MS = 30_000;

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

function retryFor(metadata: SrsMutationLockMetadata): SrsMutationLockError["retry"] {
  const expiresAt = Date.parse(metadata.expiresAt);
  return {
    message: "SRS mutation lock is active; retry after the lock expires or rerun with ignoreLock only if this is an SRS-only override.",
    recommendedDelayMs: Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : DEFAULT_LOCK_TTL_MS
  };
}

function unknownLock(operation: string): SrsMutationLockError {
  const acquiredAt = nowIso();
  const metadata: SrsMutationLockMetadata = {
    schemaVersion: SRS_LOCK_SCHEMA_VERSION,
    owner: "unknown",
    operation,
    requestId: "unknown",
    acquiredAt,
    expiresAt: new Date(Date.now() + DEFAULT_LOCK_TTL_MS).toISOString()
  };
  return { ...metadata, retry: retryFor(metadata) };
}

function lockError(metadata: SrsMutationLockMetadata, details: Record<string, unknown> = {}): MutationResult {
  const lock = { ...metadata, retry: retryFor(metadata) };
  const message = `SRS mutation lock is active for ${metadata.operation} by ${metadata.owner}; retry after ${metadata.expiresAt}.`;
  const lockDiagnostic = diagnostic("SRS-E065", "error", message, { filePath: SRS_LOCK_PATH }, { ...details, lock });
  return {
    ok: false,
    error: { code: "SRS_LOCKED", message, diagnostics: [lockDiagnostic], lock },
    diagnostics: [lockDiagnostic],
    diagnosticsSummary: summarizeDiagnostics([lockDiagnostic])
  };
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

async function readLockMetadataFile(root: ProjectRoot, relativePath: string, operation: string): Promise<{ metadata: SrsMutationLockMetadata | null; failure?: MutationResult; stale: boolean }> {
  const filePath = relativeAbsolutePath(root, relativePath);
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      return { metadata: null, stale: false, failure: lockError(unknownLock(operation), { kind: "symlink-lock" }) };
    }
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isLockMetadata(parsed)) {
      return { metadata: null, stale: false, failure: lockError(unknownLock(operation), { kind: "malformed-lock" }) };
    }
    const expiresAt = Date.parse(parsed.expiresAt);
    const stale = Number.isFinite(expiresAt) && expiresAt <= Date.now();
    return { metadata: parsed, stale };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { metadata: null, stale: false };
    return { metadata: null, stale: false, failure: lockError(unknownLock(operation), { kind: "unreadable-lock", error: (error as Error).message }) };
  }
}

async function readLockMetadata(root: ProjectRoot, operation: string): Promise<{ metadata: SrsMutationLockMetadata | null; failure?: MutationResult; stale: boolean }> {
  return readLockMetadataFile(root, SRS_LOCK_PATH, operation);
}

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
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return metadata;
}

async function createLock(root: ProjectRoot, operation: string, ttlMs = DEFAULT_LOCK_TTL_MS): Promise<SrsMutationLockMetadata> {
  return createLockFile(root, SRS_LOCK_PATH, operation, ttlMs);
}

function sameLockIdentity(left: SrsMutationLockMetadata, right: SrsMutationLockMetadata): boolean {
  return left.owner === right.owner && left.operation === right.operation && left.requestId === right.requestId && left.acquiredAt === right.acquiredAt;
}

async function acquireLockGuard(root: ProjectRoot, operation: string): Promise<AcquiredLock | MutationResult> {
  try {
    const metadata = await createLockFile(root, SRS_LOCK_GUARD_PATH, `srs_lock_guard:${operation}`, DEFAULT_GUARD_TTL_MS);
    return { metadata, diagnostics: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readLockMetadataFile(root, SRS_LOCK_GUARD_PATH, operation);
    if (existing.failure) return existing.failure;
    if (existing.metadata && existing.stale) {
      await rm(relativeAbsolutePath(root, SRS_LOCK_GUARD_PATH), { force: true });
      const metadata = await createLockFile(root, SRS_LOCK_GUARD_PATH, `srs_lock_guard:${operation}`, DEFAULT_GUARD_TTL_MS);
      return {
        metadata,
        diagnostics: [diagnostic("SRS-W068", "warning", `Recovered stale SRS mutation lock guard: ${SRS_LOCK_GUARD_PATH}`, { filePath: SRS_LOCK_GUARD_PATH }, { staleLock: existing.metadata })]
      };
    }
    return existing.metadata ? lockError(existing.metadata, { kind: "lock-guard-active" }) : lockError(unknownLock(operation), { kind: "lock-guard-active" });
  }
}

async function releaseLockFileIfOwner(root: ProjectRoot, relativePath: string, metadata: SrsMutationLockMetadata): Promise<void> {
  const current = await readLockMetadataFile(root, relativePath, metadata.operation);
  if (current.metadata && sameLockIdentity(current.metadata, metadata)) {
    await rm(relativeAbsolutePath(root, relativePath), { force: true });
  }
}

async function acquireSrsMutationLock(root: ProjectRoot, options: SrsMutationLockOptions): Promise<AcquiredLock | MutationResult> {
  const existing = await readLockMetadata(root, options.operation);
  if (existing.failure) return existing.failure;
  if (existing.metadata && !existing.stale) return lockError(existing.metadata);
  if (options.dryRun) {
    return { metadata: unknownLock(options.operation), diagnostics: existing.stale ? [diagnostic("SRS-W068", "warning", `Stale SRS mutation lock would be recovered: ${SRS_LOCK_PATH}`, { filePath: SRS_LOCK_PATH }, { staleLock: existing.metadata })] : [] };
  }

  const guard = await acquireLockGuard(root, options.operation);
  if ("ok" in guard && guard.ok === false) return guard;
  const diagnostics: Diagnostic[] = [];
  try {
    diagnostics.push(...(guard as AcquiredLock).diagnostics);
    const rechecked = await readLockMetadata(root, options.operation);
    if (rechecked.failure) return rechecked.failure;
    if (rechecked.metadata && !rechecked.stale) return lockError(rechecked.metadata);
    if (rechecked.metadata && rechecked.stale) {
      await releaseLockFileIfOwner(root, SRS_LOCK_PATH, rechecked.metadata);
      diagnostics.push(diagnostic("SRS-W068", "warning", `Recovered stale SRS mutation lock: ${SRS_LOCK_PATH}`, { filePath: SRS_LOCK_PATH }, { staleLock: rechecked.metadata }));
    }
    const metadata = await createLock(root, options.operation, options.ttlMs);
    return { metadata, diagnostics };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const retry = await readLockMetadata(root, options.operation);
      if (retry.failure) return retry.failure;
      return retry.metadata ? lockError(retry.metadata) : lockError(unknownLock(options.operation));
    }
    throw error;
  } finally {
    await releaseLockFileIfOwner(root, SRS_LOCK_GUARD_PATH, (guard as AcquiredLock).metadata);
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
  if ("ok" in acquired && acquired.ok === false) return acquired as MutationResult<T>;
  const lock = acquired as AcquiredLock;

  const lockMetadata = options.dryRun ? null : lock.metadata;
  const preDiagnostics = options.dryRun ? lock.diagnostics : [...lock.diagnostics, ...(await refreshCacheDiagnostics(root, lock.metadata))];
  let result: MutationResult<T>;
  try {
    result = await mutate();
  } finally {
    if (!options.dryRun) {
      const releaseGuard = await acquireLockGuard(root, `release:${options.operation}`);
      if (!("ok" in releaseGuard && releaseGuard.ok === false)) {
        try {
          await releaseLockFileIfOwner(root, SRS_LOCK_PATH, lock.metadata);
        } finally {
          await releaseLockFileIfOwner(root, SRS_LOCK_GUARD_PATH, (releaseGuard as AcquiredLock).metadata);
        }
      }
    }
  }
  const postDiagnostics = !options.dryRun && resultWrote(result) ? await refreshCacheDiagnostics(root, null) : [];
  void lockMetadata;
  return mergeDiagnostics(result, [...preDiagnostics, ...postDiagnostics]);
}
