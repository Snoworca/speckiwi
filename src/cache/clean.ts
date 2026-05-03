import { readdir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { CacheCleanInput } from "../core/inputs.js";
import type { CacheResult } from "../core/dto.js";
import { ok } from "../core/result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { cacheOutputStorePaths } from "./manifest.js";
import { createRealPathGuard, normalizeStorePath, resolveRealStorePathWithGuard, type RealPathGuard, type WorkspaceRoot } from "../io/path.js";

export async function cleanCache(input: CacheCleanInput = {}): Promise<CacheResult> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  if (input.cacheMode === "bypass") {
    return ok({
      operation: "clean",
      touchedFiles: []
    });
  }

  const touchedFiles: string[] = [];
  const guard = await createRealPathGuard(root);
  for (const path of [
    cacheOutputStorePaths.graph,
    cacheOutputStorePaths.search,
    cacheOutputStorePaths.entities,
    cacheOutputStorePaths.relations,
    cacheOutputStorePaths.diagnostics,
    cacheOutputStorePaths.manifest
  ]) {
    try {
      if (await unlinkCacheArtifact(root, path, guard)) {
        touchedFiles.push(`.speckiwi/${path}`);
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      continue;
    }
  }

  try {
    const shardDirectory = (await resolveRealStorePathWithGuard(root, normalizeStorePath("cache/requirements"), guard)).absolutePath;
    for (const name of (await readdir(shardDirectory)).filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry)).sort()) {
      const path = `cache/requirements/${name}`;
      if (await unlinkCacheArtifact(root, path, guard)) {
        touchedFiles.push(`.speckiwi/${path}`);
      }
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  return ok({
    operation: "clean",
    touchedFiles
  });
}

async function unlinkCacheArtifact(root: WorkspaceRoot, storePath: string, guard: RealPathGuard): Promise<boolean> {
  const target = await resolveRealStorePathWithGuard(root, normalizeStorePath(storePath), guard);
  try {
    if ((await stat(target.absolutePath)).isFile()) {
      await unlink(target.absolutePath);
      return true;
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
  return false;
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
}
