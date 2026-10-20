import { execFile } from "node:child_process";
import { realpath, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  AcquireExclusiveLockInput,
  AcquireExclusiveLockResult,
  ExclusiveLockCapability,
  ExclusiveLockFenceState,
  ExclusiveLockHolder,
  ExclusiveLockInspection,
  ReleaseExclusiveLockResult
} from "../lock/exclusive-lock.js";

/**
 * The orchestrator run lock.
 *
 * @req FR-NODE-102 — proven across operating-system processes and linked worktrees.
 * @req FR-NODE-131 — keyed on the git common dir, never an individual worktree root.
 * @req FR-NODE-207 — held until the lease it wrote expires, not until its writer's process stops.
 */

const execFileAsync = promisify(execFile);
const RUN_LOCK_FENCE_NAMESPACE = "speckiwi-orchestrator-run";

/**
 * How long a run lease stands once taken. Twelve hours: half a day.
 *
 * The number is a policy, not a measurement, and the reasoning is the asymmetry between the two ways
 * of being wrong rather than any observed run duration — those were not measured, and FR-NODE-207
 * AC-7 records that gap rather than papering over it.
 *
 * It has to cover a whole run in one stamp, because nothing renews it: `renew` below has no caller
 * in `src`, `orchestrate run` offers only lock, unlock, status and abort, and renewal is keyed on a
 * capability held in the acquiring process's memory — which a later CLI invocation does not have.
 * `kiwi-orchestrator` takes the lock once at preflight and drops it when the run ends, and in
 * between no process owns it.
 *
 * Too short is silent and unbounded: a live run's lease lapses mid-run, a second run takes the same
 * repository, and neither is told — the defect this replaced. Too long is visible and costs one
 * command: `orchestrate run status` names the holder and `orchestrate run unlock` removes another
 * process's lease outright (FR-NODE-197 AC-4/AC-7). So the error is taken on the long side, and
 * half a day is where that stops — long enough to outlast a run somebody starts and stays with,
 * short enough that a lease nobody comes back to is gone before the next day's work.
 * @req FR-NODE-207
 */
const RUN_LOCK_LEASE_MS = 12 * 60 * 60 * 1000;

export const RUN_LOCK_GATE = "orchestrator-run-lock-held";

/** A release refused because a live process other than the caller holds the fence. @req FR-NODE-221 */
export const RUN_LOCK_LIVE_SESSION_GATE = "run-lock-held-by-live-session";

export interface RunLock {
  readonly commonDir: string;
  readonly lockPath: string;
  readonly token: string;
  readonly owner: string;
  /**
   * The lease this acquisition took, in the shape `readHolder` reports.
   *
   * `owner` alone cannot answer which lease is whose: the CLI defaults it to one string for every
   * run and `kiwi-orchestrator` never overrides it, so a run that resumes after its own lease was
   * reclaimed had nothing to compare a status read against. @req FR-NODE-204
   */
  readonly holder: RunLockHolder;
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
  inspectExclusiveLock(lockPath: string): Promise<ExclusiveLockInspection>;
  probeExclusiveLockFence(namespace: string, lockPath: string): Promise<ExclusiveLockFenceState>;
  exclusiveLockFenceName(namespace: string, lockPath: string): string;
  addCleanupTaskForTest(token: string, task: () => Promise<void>): boolean;
}

/*
 * The cross-process regression imports this source .ts file directly with Node's strip-only
 * loader, while production imports the compiled .js file. Select the matching internal module
 * extension at runtime without weakening the package's NodeNext build contract.
 */
async function exclusiveLockModule(): Promise<ExclusiveLockModule> {
  return lockLayerModule<ExclusiveLockModule>("exclusive-lock");
}

async function lockLayerModule<T>(name: string): Promise<T> {
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  return import(new URL(`../lock/${name}${extension}`, import.meta.url).href) as Promise<T>;
}

interface BusyRetryModule {
  retryBusy<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Whether this process is a long-lived session (an MCP server) rather than a one-call CLI process.
 * Only a session can tell a fence held by another session from one it holds itself. @req FR-NODE-221
 */
let sessionProcess = false;

/** Declared by the MCP bridge before it runs a verb. */
export function declareSessionProcess(): void {
  sessionProcess = true;
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
    owner,
    leaseMs: RUN_LOCK_LEASE_MS
  });
  if (!result.ok) throw new RunLockHeldError(lockPath, result.holder?.owner ?? null);
  capabilities.set(result.capability.token, result.capability);
  return Object.freeze({
    commonDir,
    lockPath,
    token: result.capability.token,
    owner,
    holder: runLockHolder(result.holder)
  });
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

/** The run lock's fence state: `held`, `free`, or `not-applicable` on POSIX. @req IR-CLI-105 */
export type RunLockFence = ExclusiveLockFenceState;

/**
 * The fence as a caller is told it: a held fence is this session's or another session's when the
 * process can know, and plain `held` from a one-call CLI process, which cannot tell its own MCP
 * session from someone else's. @req IR-CLI-105, FR-NODE-221
 */
export type ReportedRunLockFence = "held-by-this-session" | "held-by-another-session" | "held" | "free" | "not-applicable";

export function reportedFence(state: RunLockState): ReportedRunLockFence {
  if (state.fence !== "held") return state.fence;
  if (state.heldByThisProcess) return "held-by-this-session";
  return sessionProcess ? "held-by-another-session" : "held";
}

/** Everything a refusal or `run status` reports about the run lock, read in one place. @req IR-CLI-105 */
export interface RunLockState {
  readonly lockPath: string;
  readonly present: boolean;
  readonly holder: RunLockHolder | null;
  readonly leaseExpiresAt: string | null;
  /** A sentinel exists and names nobody. */
  readonly holderUnreadable: boolean;
  /** What the real acquisition decides for the sentinel, before it asks the fence. */
  readonly reclaimable: boolean;
  readonly fence: RunLockFence;
  /** This process holds the lock's capability: the holder releasing its own lock. */
  readonly heldByThisProcess: boolean;
}

/** The fence's pipe name for this repository's run lock. */
export async function runLockFenceName(commonDir: string): Promise<string> {
  return (await exclusiveLockModule()).exclusiveLockFenceName(RUN_LOCK_FENCE_NAMESPACE, runLockPath(path.resolve(commonDir)));
}

/** Whether a live process holds the run lock's Windows fence. Takes nothing. @req FR-NODE-221 */
export async function probeRunLockFence(commonDir: string): Promise<RunLockFence> {
  return (await exclusiveLockModule()).probeExclusiveLockFence(RUN_LOCK_FENCE_NAMESPACE, runLockPath(path.resolve(commonDir)));
}

function ownCapability(lockPath: string): ExclusiveLockCapability | undefined {
  return [...capabilities.values()].find((entry) => entry.lockPath === lockPath);
}

function stateFrom(lockPath: string, inspection: ExclusiveLockInspection, fence: RunLockFence): RunLockState {
  return Object.freeze({
    lockPath,
    present: inspection.present,
    holder: inspection.holder ? runLockHolder(inspection.holder) : null,
    leaseExpiresAt: inspection.leaseExpiresAt,
    holderUnreadable: inspection.unreadable,
    reclaimable: inspection.reclaimable,
    fence,
    heldByThisProcess: ownCapability(lockPath) !== undefined
  });
}

/** Reads the run lock's sentinel and asks its fence. Pid and host are reported, never judged. @req IR-CLI-105 */
export async function inspectRunLock(commonDir: string): Promise<RunLockState> {
  const lockPath = runLockPath(path.resolve(commonDir));
  const locks = await exclusiveLockModule();
  const inspection = await locks.inspectExclusiveLock(lockPath);
  return stateFrom(lockPath, inspection, await locks.probeExclusiveLockFence(RUN_LOCK_FENCE_NAMESPACE, lockPath));
}

/**
 * Whether a real `acquire` would be refused: the fence is held, or a sentinel stands that it would not
 * reclaim. The dry run's answer, so it can never differ from the call it previews. @req IR-CLI-105 AC-8
 */
export function acquisitionRefused(state: RunLockState): boolean {
  return state.fence === "held" || (state.present && !state.reclaimable);
}

/** The state a release by this caller is refused on, or null when the caller may release. @req FR-NODE-221 */
export async function foreignReleaseBlocker(commonDir: string): Promise<RunLockState | null> {
  const state = await inspectRunLock(commonDir);
  return !state.heldByThisProcess && state.fence === "held" ? state : null;
}

export type RunLockRelease =
  | { readonly ok: true; readonly owner: string | null }
  | { readonly ok: false; readonly reason: "live-session" | "changed-hands"; readonly state: RunLockState }
  | { readonly ok: false; readonly reason: "cleanup-failed"; readonly diagnostic: Readonly<Record<string, unknown>> };

/** Test-only: runs between the fence probe and the re-read of the sentinel. @req FR-NODE-221 AC-6 */
export interface RunLockReleaseSeams {
  readonly afterProbe?: () => Promise<void>;
}

/**
 * Releases the run lock: the one path `run unlock` and `run abort` share. @req FR-NODE-197 AC-7, FR-NODE-221
 *
 * The holder releases through its own capability, and if that fails the sentinel stays: removing the
 * file while the fence stays open is how the ghost was made, by a holder as much as by a stranger.
 * Any other caller is refused while a live process holds the fence — the session that took the lock
 * releases it, or is closed — and otherwise removes the sentinel only if it is still the one it read.
 * Between that re-read and the `rm` a successor can still publish, but only over a sentinel that was
 * reclaimable; that window is narrowed to that case, not closed.
 */
export async function releaseHeldRunLock(commonDir: string, seams: RunLockReleaseSeams = {}): Promise<RunLockRelease> {
  const lockPath = runLockPath(path.resolve(commonDir));
  const locks = await exclusiveLockModule();
  const capability = ownCapability(lockPath);
  if (capability) {
    const holder = await readHolder(commonDir).catch(() => null);
    const result = await locks.releaseExclusiveLock(capability);
    if (!result.ok) return { ok: false, reason: "cleanup-failed", diagnostic: result.cleanupDiagnostic };
    capabilities.delete(capability.token);
    if (result.released) return { ok: true, owner: holder?.owner ?? null };
    // The sentinel on disk is no longer this capability's: judge it as any other caller would.
  }
  const read = await locks.inspectExclusiveLock(lockPath);
  const fence = await locks.probeExclusiveLockFence(RUN_LOCK_FENCE_NAMESPACE, lockPath);
  if (fence === "held") return { ok: false, reason: "live-session", state: stateFrom(lockPath, read, fence) };
  await seams.afterProbe?.();
  const reread = await locks.inspectExclusiveLock(lockPath);
  if (reread.raw !== read.raw) return { ok: false, reason: "changed-hands", state: stateFrom(lockPath, reread, fence) };
  // @req FR-NODE-221 — a delete-pending sentinel answers EPERM/EBUSY on Windows; retried as the SRS lock is.
  if (read.present) await (await lockLayerModule<BusyRetryModule>("busy-retry")).retryBusy(() => rm(lockPath, { force: true }));
  return { ok: true, owner: read.holder?.owner ?? null };
}

/** Test-only: makes the holder's next capability release fail while `task` throws. @req FR-NODE-221 AC-5 */
export async function injectCleanupFaultForTest(lock: RunLock, task: () => Promise<void>): Promise<void> {
  if (!(await exclusiveLockModule()).addCleanupTaskForTest(lock.token, task)) {
    throw new Error("this process holds no capability for that run lock");
  }
}

/**
 * The four fields a run lock lease is named by, projected off the lock layer's own holder.
 *
 * One projection for both the acquisition and the read, because the whole point of returning a
 * holder from `acquire` is that a caller can compare the two: two projections would let the halves
 * of that comparison drift apart field by field and the comparison would start answering "not mine"
 * about a lease that is. @req FR-NODE-204 AC-1
 */
function runLockHolder(holder: ExclusiveLockHolder): RunLockHolder {
  return Object.freeze({
    owner: holder.owner,
    pid: holder.pid,
    host: holder.host,
    acquiredAt: holder.acquiredAt
  });
}

/**
 * Returns the current valid holder, or null when no holder can be named.
 *
 * Null covers three cases and not two: the sentinel is absent, it is torn, or it could not be read
 * at all. The third was folded in by FR-NODE-203, which stopped an unreadable sentinel from raising
 * past a contention budget; the reader beneath now absorbs every read and parse failure. A caller
 * deciding whether a lease is its own must therefore treat null as "unknown holder" rather than as
 * "no holder", because the two are indistinguishable here. @req FR-NODE-204 AC-4
 */
export async function readHolder(commonDir: string): Promise<RunLockHolder | null> {
  const holder: ExclusiveLockHolder | null = await (await exclusiveLockModule())
    .readExclusiveLockHolder(runLockPath(path.resolve(commonDir)));
  return holder ? runLockHolder(holder) : null;
}
