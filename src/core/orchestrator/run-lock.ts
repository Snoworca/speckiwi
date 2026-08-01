import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { hostname } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * The orchestrator run lock — harvest H2 from the deferred multi-root branch's
 * `src/core/workflow/lease-lock.ts`.
 *
 * @req FR-NODE-102 — the port, proven against a second operating-system process and against two
 *   worktrees sharing one `.git`.
 * @req FR-NODE-131 — one orchestrator run per repository: the lock path derives from the git
 *   common dir, never from a project root.
 *
 * The one required change from the source module (`06:161`): every lock path on the branch derives
 * from a `ProjectRoot`, so N worktrees over one shared `.git` get N different locks and no mutual
 * exclusion at all. Keying on the common dir is what makes "one orchestrator run per repository"
 * true rather than merely intended.
 *
 * The common dir is resolved by plain `git` with an explicit `cwd`, for the reason `06` §5.1
 * Defect B gives: a git invocation that inherits the caller's working directory answers a question
 * nobody asked.
 */

const execFileAsync = promisify(execFile);

/** How long a sentinel that cannot be parsed is respected before it is treated as debris. */
const TORN_SENTINEL_GRACE_MS = 5_000;

export const RUN_LOCK_GATE = "orchestrator-run-lock-held";

export interface RunLock {
  readonly commonDir: string;
  readonly lockPath: string;
  readonly token: string;
  readonly owner: string;
}

export interface RunLockHolder {
  readonly owner: string;
  readonly pid: number;
  readonly host: string;
  readonly acquiredAt: string;
}

export interface AcquireRunLockInput {
  readonly commonDir: string;
  readonly owner: string;
}

export class RunLockHeldError extends Error {
  /** §13's critical gate raised at Preflight P.5 when another run already holds this repository. */
  readonly gate = RUN_LOCK_GATE;
  readonly lockPath: string;
  readonly owner: string | null;

  // Written out rather than as constructor parameter properties: this module is loaded directly by
  // a second Node process in the FR-NODE-102 AC-1 cross-process test, and Node's strip-only
  // TypeScript support rejects parameter properties as non-erasable syntax.
  constructor(lockPath: string, owner: string | null) {
    super(owner
      ? `Another orchestrator run holds ${lockPath} (owner ${owner})`
      : `Another orchestrator run holds ${lockPath}`);
    this.name = "RunLockHeldError";
    this.lockPath = lockPath;
    this.owner = owner;
  }
}

interface SentinelRecord {
  readonly version: 1;
  readonly token: string;
  readonly pid: number;
  readonly host: string;
  readonly owner: string;
  readonly acquired_at: string;
}

interface KernelFence {
  readonly held: boolean;
  close(): Promise<void>;
}

/**
 * The Windows named-pipe fence, held for as long as this process owns the lock. It is keyed on the
 * lock path, so it is a machine-wide fence over exactly the same key the sentinel uses.
 */
const fences = new Map<string, KernelFence>();

function canonical(value: string): string {
  const resolved = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validRecord(value: unknown): value is SentinelRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 &&
    typeof record.token === "string" && record.token.length > 0 &&
    typeof record.pid === "number" && Number.isSafeInteger(record.pid) && record.pid > 0 &&
    typeof record.host === "string" && record.host.length > 0 &&
    typeof record.owner === "string" && record.owner.length > 0 &&
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

function fenceName(lockPath: string): string {
  return `\\\\.\\pipe\\speckiwi-orchestrator-run-${createHash("sha256").update(canonical(lockPath)).digest("hex")}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

/**
 * `null` means another process already holds the fence. The refusal is raised by the caller rather
 * than here, because only the caller can read the sentinel to name the *holder* — reporting the
 * contender's own name, as the source module did, tells an operator nothing about who to stop.
 */
async function acquireKernelFence(lockPath: string): Promise<KernelFence | null> {
  if (process.platform !== "win32") return { held: true, close: async () => undefined };
  const server = createServer((socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once("error", onError);
      server.listen(fenceName(lockPath), () => {
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

async function readSentinel(lockPath: string): Promise<{ record: SentinelRecord | null; ageMs: number }> {
  const metadata = await stat(lockPath);
  let record: SentinelRecord | null = null;
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    if (validRecord(parsed)) record = parsed;
  } catch {
    // A crashed writer leaves an empty or torn sentinel. Its age gate below keeps a lock another
    // process created moments ago from being taken over as debris.
  }
  return { record, ageMs: Math.max(0, Date.now() - metadata.mtimeMs) };
}

function isReclaimable(record: SentinelRecord | null, ageMs: number): boolean {
  if (!record) return ageMs >= TORN_SENTINEL_GRACE_MS;
  if (record.host === hostname()) return !processIsAlive(record.pid);
  // A local process cannot prove that a process on another host is dead, so a foreign-host lock is
  // never stolen on age alone; it needs explicit operator recovery.
  return false;
}

function serialize(record: SentinelRecord): string {
  return `${JSON.stringify(record)}\n`;
}

async function assertToken(lockPath: string, token: string): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    if (!validRecord(current) || current.token !== token) {
      throw new RunLockHeldError(lockPath, validRecord(current) ? current.owner : null);
    }
  } catch (error) {
    if (error instanceof RunLockHeldError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new RunLockHeldError(lockPath, null);
    throw error;
  }
}

/**
 * Serializes stale recovery. Without it two contenders can both observe the same dead sentinel,
 * both quarantine it, and both believe they won.
 */
async function acquireRecoveryGuard(lockPath: string, token: string, owner: string): Promise<() => Promise<void>> {
  const guardPath = `${lockPath}.acquire`;
  const guard: SentinelRecord = {
    version: 1,
    token,
    pid: process.pid,
    host: hostname(),
    owner: `${owner}:acquire`,
    acquired_at: new Date().toISOString()
  };
  try {
    await writeFile(guardPath, serialize(guard), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let guardOwner: string | null = null;
    try {
      const current = JSON.parse(await readFile(guardPath, "utf8")) as unknown;
      if (validRecord(current)) guardOwner = current.owner;
    } catch {
      // A torn acquisition guard is never stolen automatically: two stale-recovery contenders are
      // worse than an operator having to remove one file.
    }
    throw new RunLockHeldError(lockPath, guardOwner);
  }
  return async () => {
    try {
      const current = JSON.parse(await readFile(guardPath, "utf8")) as unknown;
      if (validRecord(current) && current.token === token) await rm(guardPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}

/**
 * The repository's git common dir, absolute and realpath-resolved so every linked worktree over one
 * `.git` produces the identical string — which is what makes the lock path identical for all of
 * them.
 */
export async function resolveGitCommonDir(cwd: string): Promise<string> {
  if (typeof cwd !== "string" || cwd.length === 0 || !path.isAbsolute(cwd)) {
    throw new Error("Resolving the git common dir requires an absolute working directory");
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  const reported = stdout.trim();
  if (reported.length === 0) throw new Error(`git reported no common dir for ${cwd}`);
  return realpath(path.resolve(reported));
}

/** Pure: the one lock path a repository has, derived from its common dir and nothing else. */
export function runLockPath(commonDir: string): string {
  if (typeof commonDir !== "string" || commonDir.length === 0 || !path.isAbsolute(commonDir)) {
    throw new Error("The orchestrator run lock path requires an absolute git common dir");
  }
  return path.join(path.resolve(commonDir), "speckiwi", "orchestrator-run.lock");
}

export async function acquire(input: AcquireRunLockInput): Promise<RunLock> {
  const owner = typeof input?.owner === "string" ? input.owner.trim() : "";
  if (!owner) throw new Error("Acquiring the orchestrator run lock requires an owner");
  const commonDir = await realpath(path.resolve(input.commonDir));
  const lockPath = runLockPath(commonDir);
  await mkdir(path.dirname(lockPath), { recursive: true });

  const fence = await acquireKernelFence(lockPath);
  if (!fence) throw new RunLockHeldError(lockPath, (await readHolder(commonDir))?.owner ?? null);
  let acquired = false;
  try {
    const token = randomUUID();
    const record: SentinelRecord = {
      version: 1,
      token,
      pid: process.pid,
      host: hostname(),
      owner,
      acquired_at: new Date().toISOString()
    };
    const releaseGuard = await acquireRecoveryGuard(lockPath, token, owner);
    try {
      try {
        await writeFile(lockPath, serialize(record), { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const observed = await readSentinel(lockPath);
        if (!isReclaimable(observed.record, observed.ageMs)) {
          throw new RunLockHeldError(lockPath, observed.record?.owner ?? null);
        }
        const quarantine = `${lockPath}.stale-${token}`;
        await rename(lockPath, quarantine);
        try {
          await writeFile(lockPath, serialize(record), { encoding: "utf8", flag: "wx" });
        } finally {
          await rm(quarantine, { force: true });
        }
      }
      fences.set(token, fence);
      acquired = true;
      return Object.freeze({ commonDir, lockPath, token, owner });
    } finally {
      await releaseGuard();
    }
  } finally {
    if (!acquired) await fence.close().catch(() => undefined);
  }
}

/** Refreshes the sentinel's mtime and proves this process still owns it. */
export async function renew(lock: RunLock): Promise<void> {
  await assertToken(lock.lockPath, lock.token);
  const fence = fences.get(lock.token);
  if (fence && !fence.held) throw new RunLockHeldError(lock.lockPath, lock.owner);
  await writeFile(lock.lockPath, serialize({
    version: 1,
    token: lock.token,
    pid: process.pid,
    host: hostname(),
    owner: lock.owner,
    acquired_at: new Date().toISOString()
  }), "utf8");
}

/** Releases only a sentinel this token still owns, so a successor's lock is never removed. */
export async function release(lock: RunLock): Promise<void> {
  const fence = fences.get(lock.token);
  fences.delete(lock.token);
  try {
    const current = JSON.parse(await readFile(lock.lockPath, "utf8")) as unknown;
    if (validRecord(current) && current.token === lock.token) await rm(lock.lockPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    if (fence) await fence.close();
  }
}

/**
 * The current holder, or `null` when no valid sentinel is present. A torn sentinel reports no
 * holder because there is no owner to name; `acquire` still refuses it until its grace window ends.
 */
export async function readHolder(commonDir: string): Promise<RunLockHolder | null> {
  const lockPath = runLockPath(path.resolve(commonDir));
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!validRecord(parsed)) return null;
  return Object.freeze({
    owner: parsed.owner,
    pid: parsed.pid,
    host: parsed.host,
    acquiredAt: parsed.acquired_at
  });
}
