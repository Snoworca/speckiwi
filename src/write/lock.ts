import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { normalizeStorePath, resolveRealStorePath, type StorePath, type WorkspaceRoot } from "../io/path.js";

const WRITE_LOCK_TTL_MS = 30 * 60 * 1000;
const LOCK_ACQUIRE_ATTEMPTS = 3;
const STALE_CLEANUP_LOCK_TTL_MS = 30_000;

export class WriteLockError extends Error {
  public readonly code = "APPLY_REJECTED_LOCK_CONFLICT";

  constructor(target: StorePath) {
    super(`A write is already in progress for ${target}.`);
    this.name = "WriteLockError";
  }
}

type WriteLockPayload = {
  version: 1;
  target: string;
  token: string;
  pid: number;
  hostname: string;
  createdAt: string;
  expiresAt: string;
};

type WriteLockHandle = {
  path: string;
  target: StorePath;
  token: string;
};

type CleanupLockHandle = {
  path: string;
  token: string;
};

export async function withTargetWriteLock<T>(root: WorkspaceRoot, target: StorePath, fn: () => Promise<T>): Promise<T> {
  const handle = await acquireFileLock(root, target);
  try {
    return await fn();
  } finally {
    try {
      await releaseFileLock(handle);
    } catch {
      // Preserve the write outcome; TTL-based stale recovery handles cleanup failures.
    }
  }
}

async function acquireFileLock(root: WorkspaceRoot, target: StorePath): Promise<WriteLockHandle> {
  let lockPath = await applyLockPath(root, target);
  await mkdir(dirname(lockPath), { recursive: true });
  lockPath = await applyLockPath(root, target);

  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
    const payload = buildLockPayload(target, new Date());
    if (await tryCreateLock(lockPath, payload)) {
      return { path: lockPath, target, token: payload.token };
    }

    const existing = await readLockPayload(lockPath, target);
    if (existing === "missing") {
      continue;
    }

    if (existing === undefined || isStaleLock(existing, new Date())) {
      await removeStaleLock(root, lockPath, target);
      continue;
    }

    throw new WriteLockError(target);
  }

  throw new WriteLockError(target);
}

async function removeStaleLock(root: WorkspaceRoot, lockPath: string, target: StorePath): Promise<void> {
  await withStaleCleanupLock(root, target, async () => {
    const current = await readLockPayload(lockPath, target);
    if (current !== "missing" && (current === undefined || isStaleLock(current, new Date()))) {
      await rm(lockPath, { force: true });
    }
  });
}

async function withStaleCleanupLock(root: WorkspaceRoot, target: StorePath, fn: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
    const cleanupLockPath = await cleanupLockPathForTarget(root, target);
    const cleanupHandle = await tryCreateCleanupLock(cleanupLockPath);
    if (cleanupHandle !== undefined) {
      try {
        await fn();
      } finally {
        await releaseCleanupLock(cleanupHandle);
      }
      return;
    }

    await removeExpiredCleanupLock(await cleanupLockPathForTarget(root, target));
    await delay(25);
  }
}

async function tryCreateCleanupLock(cleanupLockPath: string): Promise<CleanupLockHandle | undefined> {
  const token = randomUUID();
  try {
    await mkdir(cleanupLockPath);
    try {
      await writeFile(join(cleanupLockPath, token), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      return { path: cleanupLockPath, token };
    } catch (error) {
      await rmdir(cleanupLockPath).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return undefined;
    }
    throw error;
  }
}

async function releaseCleanupLock(handle: CleanupLockHandle): Promise<void> {
  await rm(join(handle.path, handle.token), { force: true });
  await rmdir(handle.path).catch((error: unknown) => {
    if (!isNodeError(error) || (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")) {
      throw error;
    }
  });
}

async function removeExpiredCleanupLock(cleanupLockPath: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(cleanupLockPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (entries.length === 0) {
    await removeEmptyExpiredCleanupLock(cleanupLockPath);
    return;
  }

  if (entries.length !== 1) {
    return;
  }

  const tokenPath = join(cleanupLockPath, entries[0] ?? "");
  try {
    const raw = await readFile(tokenPath, "utf8");
    const parsed = JSON.parse(raw) as { createdAt?: unknown };
    const createdAt = typeof parsed.createdAt === "string" ? Date.parse(parsed.createdAt) : Number.NaN;
    if (Number.isFinite(createdAt) && createdAt + STALE_CLEANUP_LOCK_TTL_MS <= Date.now()) {
      await rm(tokenPath, { force: true });
      await rmdir(cleanupLockPath).catch(() => undefined);
    }
  } catch {
    const tokenStat = await stat(tokenPath).catch(() => undefined);
    if (tokenStat !== undefined && tokenStat.mtimeMs + STALE_CLEANUP_LOCK_TTL_MS <= Date.now()) {
      await rm(tokenPath, { force: true });
      await rmdir(cleanupLockPath).catch(() => undefined);
    }
  }
}

async function removeEmptyExpiredCleanupLock(cleanupLockPath: string): Promise<void> {
  const cleanupStat = await stat(cleanupLockPath).catch(() => undefined);
  if (cleanupStat !== undefined && cleanupStat.mtimeMs + STALE_CLEANUP_LOCK_TTL_MS <= Date.now()) {
    await rmdir(cleanupLockPath).catch(() => undefined);
  }
}

function buildLockPayload(target: StorePath, now: Date): WriteLockPayload {
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + WRITE_LOCK_TTL_MS).toISOString();
  return {
    version: 1,
    target: target.toString(),
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    createdAt,
    expiresAt
  };
}

async function tryCreateLock(lockPath: string, payload: WriteLockPayload): Promise<boolean> {
  try {
    await writeFile(lockPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function releaseFileLock(handle: WriteLockHandle): Promise<void> {
  const existing = await readLockPayload(handle.path, handle.target);
  if (existing === "missing" || existing === undefined || existing.token !== handle.token) {
    return;
  }

  await rm(handle.path, { force: true });
}

async function readLockPayload(lockPath: string, target: StorePath): Promise<WriteLockPayload | "missing" | undefined> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isWriteLockPayload(parsed, target) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isStaleLock(payload: WriteLockPayload, now: Date): boolean {
  const expiresAt = Date.parse(payload.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

async function applyLockPath(root: WorkspaceRoot, target: StorePath): Promise<string> {
  const storePath = lockStorePath(target);
  return (await resolveRealStorePath(root, storePath)).absolutePath;
}

async function cleanupLockPathForTarget(root: WorkspaceRoot, target: StorePath): Promise<string> {
  const storePath = normalizeStorePath(`${lockStorePath(target)}.cleanup`);
  return (await resolveRealStorePath(root, storePath)).absolutePath;
}

function lockStorePath(target: StorePath): StorePath {
  return normalizeStorePath(`.locks/${createHash("sha256").update(target.toString()).digest("hex")}.json`);
}

function isWriteLockPayload(value: unknown, target: StorePath): value is WriteLockPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as WriteLockPayload).version === 1 &&
    (value as WriteLockPayload).target === target.toString() &&
    typeof (value as WriteLockPayload).token === "string" &&
    typeof (value as WriteLockPayload).pid === "number" &&
    typeof (value as WriteLockPayload).hostname === "string" &&
    typeof (value as WriteLockPayload).createdAt === "string" &&
    typeof (value as WriteLockPayload).expiresAt === "string"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
