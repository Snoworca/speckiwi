import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  acquireExclusiveLock,
  releaseExclusiveLock,
  retryRetainedExclusiveLockCleanup,
  type ExclusiveLockCapability,
  type ReleaseExclusiveLockResult
} from "../lock/exclusive-lock.js";

// @req FR-NODE-177 AC-6/7/11

const ARTIFACT_LOCK_FENCE_NAMESPACE = "speckiwi-workflow-artifact";

export interface ArtifactLockIdentity {
  readonly canonicalPath: string;
  readonly lockPath: string;
}

export interface ArtifactLockCapability extends ArtifactLockIdentity {
  readonly ownerIdentitySha256: string;
  readonly token: string;
}

export type AcquireArtifactLockResult =
  | { readonly ok: true; readonly capability: ArtifactLockCapability }
  | {
    readonly ok: false;
    readonly reason: "held";
    // `owner` travels with the identity hash. The hash answers "is this me?", which is enough to
    // decide whether to retry, but not enough to TELL anyone who is holding the lock — and a caller
    // that must surface a wait or a refusal has to name the holder. `run-lock.ts` already reads
    // `holder.owner` off the exclusive-lock result for exactly that; narrowing it away here left
    // the artifact-lock callers unable to do the same. @req FR-NODE-177
    readonly holder?: { readonly owner?: string; readonly ownerIdentitySha256?: string };
  };

export type ReleaseArtifactLockResult = ReleaseExclusiveLockResult;

const capabilities = new Map<string, ExclusiveLockCapability>();

function artifactLockPath(canonicalPath: string): string {
  return `${canonicalPath}.speckiwi.lock`;
}

/**
 * Resolves aliases before deriving the one lock identity for a workflow artifact.
 *
 * @req FR-NODE-194 — the artifact need not exist yet. `realpath` throws on a path that is not there,
 * and this runs before the append that would create it, so a project with no journal could not take
 * the lock and therefore could not write its first event at all: the tool path died on ENOENT for
 * the file it was about to make. Only the shell append the skills use — which does its own mkdir and
 * takes no lock — could bootstrap a journal, which is why the defect stayed invisible.
 *
 * Aliases live in the directories, so canonicalising the nearest existing ancestor and reattaching
 * the rest yields the same identity the file will have once created. Two writers racing to create it
 * therefore agree on one lock path and still serialise.
 */
export async function resolveArtifactLockIdentity(artifactPath: string): Promise<ArtifactLockIdentity> {
  if (typeof artifactPath !== "string" || artifactPath.length === 0 || !path.isAbsolute(artifactPath)) {
    throw new Error("Resolving a workflow artifact lock requires an absolute artifact path");
  }
  const canonicalPath = await canonicaliseAllowingAbsent(path.resolve(artifactPath));
  return Object.freeze({ canonicalPath, lockPath: artifactLockPath(canonicalPath) });
}

/** `realpath` for a path whose leaf — or whose directory — may not exist yet. */
async function canonicaliseAllowingAbsent(target: string): Promise<string> {
  const trailing: string[] = [];
  let current = target;
  for (;;) {
    const resolved = await realpath(current).catch(() => undefined);
    if (resolved !== undefined) return path.join(resolved, ...trailing.reverse());
    const parent = path.dirname(current);
    // A root that cannot be resolved is not something to walk past; hand back what we were given.
    if (parent === current) return target;
    trailing.push(path.basename(current));
    current = parent;
  }
}

export async function acquireArtifactLock(input: {
  readonly artifactPath: string;
  readonly owner: string;
}): Promise<AcquireArtifactLockResult> {
  const identity = await resolveArtifactLockIdentity(input.artifactPath);
  const result = await acquireExclusiveLock({
    fenceNamespace: ARTIFACT_LOCK_FENCE_NAMESPACE,
    lockPath: identity.lockPath,
    owner: input.owner
  });
  if (!result.ok) {
    return result.holder
      ? { ok: false, reason: "held", holder: { owner: result.holder.owner, ownerIdentitySha256: result.holder.ownerIdentitySha256 } }
      : { ok: false, reason: "held" };
  }
  capabilities.set(result.capability.token, result.capability);
  return {
    ok: true,
    capability: Object.freeze({
      ...identity,
      ownerIdentitySha256: result.capability.ownerIdentitySha256,
      token: result.capability.token
    })
  };
}

export async function releaseArtifactLock(
  capability: ArtifactLockCapability
): Promise<ReleaseArtifactLockResult> {
  const internal = capabilities.get(capability.token);
  if (!internal ||
      internal.lockPath !== capability.lockPath ||
      internal.ownerIdentitySha256 !== capability.ownerIdentitySha256) {
    return { ok: true, released: false, reason: "not_owner" };
  }
  const result = await releaseExclusiveLock(internal);
  if (result.ok) capabilities.delete(capability.token);
  return result;
}

export async function retryRetainedArtifactLockCleanup(
  canonicalPath: string
): Promise<ReleaseArtifactLockResult> {
  if (typeof canonicalPath !== "string" || canonicalPath.length === 0 || !path.isAbsolute(canonicalPath)) {
    throw new Error("Retrying workflow artifact lock cleanup requires an absolute canonical path");
  }
  const lockPath = artifactLockPath(path.resolve(canonicalPath));
  const result = await retryRetainedExclusiveLockCleanup(lockPath);
  if (result.ok && result.released) {
    for (const [token, capability] of capabilities) {
      if (capability.lockPath === lockPath) capabilities.delete(token);
    }
  }
  return result;
}
