import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  AcquireExclusiveLockInput,
  AcquireExclusiveLockResult,
  ExclusiveLockCapability,
  ExclusiveLockHolder,
  ReleaseExclusiveLockResult
} from "../lock/exclusive-lock.js";

/**
 * The orchestrator run lock.
 *
 * @req FR-NODE-102 — proven across operating-system processes and linked worktrees.
 * @req FR-NODE-131 — keyed on the git common dir, never an individual worktree root.
 */

const execFileAsync = promisify(execFile);
const RUN_LOCK_FENCE_NAMESPACE = "speckiwi-orchestrator-run";

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
  readonly gate = RUN_LOCK_GATE;
  readonly lockPath: string;
  readonly owner: string | null;

  // Explicit fields keep this file compatible with Node's strip-only TypeScript loader.
  constructor(lockPath: string, owner: string | null) {
    super(owner
      ? `Another orchestrator run holds ${lockPath} (owner ${owner})`
      : `Another orchestrator run holds ${lockPath}`);
    this.name = "RunLockHeldError";
    this.lockPath = lockPath;
    this.owner = owner;
  }
}

interface ExclusiveLockModule {
  acquireExclusiveLock(input: AcquireExclusiveLockInput): Promise<AcquireExclusiveLockResult>;
  readExclusiveLockHolder(lockPath: string): Promise<ExclusiveLockHolder | null>;
  releaseExclusiveLock(capability: ExclusiveLockCapability): Promise<ReleaseExclusiveLockResult>;
  renewExclusiveLock(capability: ExclusiveLockCapability): Promise<boolean>;
}

/*
 * The cross-process regression imports this source .ts file directly with Node's strip-only
 * loader, while production imports the compiled .js file. Select the matching internal module
 * extension at runtime without weakening the package's NodeNext build contract.
 */
async function exclusiveLockModule(): Promise<ExclusiveLockModule> {
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  return import(new URL(`../lock/exclusive-lock${extension}`, import.meta.url).href) as Promise<ExclusiveLockModule>;
}

const capabilities = new Map<string, ExclusiveLockCapability>();

/** Resolves the one real git common directory shared by every linked worktree. */
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
  const locks = await exclusiveLockModule();
  const result = await locks.acquireExclusiveLock({
    fenceNamespace: RUN_LOCK_FENCE_NAMESPACE,
    lockPath,
    owner
  });
  if (!result.ok) throw new RunLockHeldError(lockPath, result.holder?.owner ?? null);
  capabilities.set(result.capability.token, result.capability);
  return Object.freeze({ commonDir, lockPath, token: result.capability.token, owner });
}

/** Refreshes the sentinel's mtime and proves this process still owns it. */
export async function renew(lock: RunLock): Promise<void> {
  const capability = capabilities.get(lock.token);
  if (!capability || !(await (await exclusiveLockModule()).renewExclusiveLock(capability))) {
    throw new RunLockHeldError(lock.lockPath, lock.owner);
  }
}

/** Releases only the sentinel still owned by this process and token. */
export async function release(lock: RunLock): Promise<void> {
  const capability = capabilities.get(lock.token);
  if (!capability) return;
  const result = await (await exclusiveLockModule()).releaseExclusiveLock(capability);
  if (result.ok) capabilities.delete(lock.token);
  if (!result.ok) throw new Error(String(result.cleanupDiagnostic.message ?? "Run lock cleanup failed"));
}

/** Returns the current valid holder, or null for an absent/torn sentinel. */
export async function readHolder(commonDir: string): Promise<RunLockHolder | null> {
  const holder: ExclusiveLockHolder | null = await (await exclusiveLockModule())
    .readExclusiveLockHolder(runLockPath(path.resolve(commonDir)));
  if (!holder) return null;
  return Object.freeze({
    owner: holder.owner,
    pid: holder.pid,
    host: holder.host,
    acquiredAt: holder.acquiredAt
  });
}
