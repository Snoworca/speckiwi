import { stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { CacheCleanInput } from "../core/inputs.js";
import type { CacheResult } from "../core/dto.js";
import { ok } from "../core/result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { cacheOutputStorePaths } from "./manifest.js";

export async function cleanCache(input: CacheCleanInput = {}): Promise<CacheResult> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  if (input.cacheMode === "bypass") {
    return ok({
      operation: "clean",
      touchedFiles: []
    });
  }

  const touchedFiles: string[] = [];
  for (const path of [
    cacheOutputStorePaths.graph,
    cacheOutputStorePaths.search,
    cacheOutputStorePaths.diagnostics,
    cacheOutputStorePaths.manifest
  ]) {
    const absolutePath = resolve(root.speckiwiPath, path);
    try {
      if ((await stat(absolutePath)).isFile()) {
        await unlink(absolutePath);
        touchedFiles.push(`.speckiwi/${path}`);
      }
    } catch {
      continue;
    }
  }

  return ok({
    operation: "clean",
    touchedFiles
  });
}
