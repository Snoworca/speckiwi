import { resolve } from "node:path";
import { cleanCache as cleanCacheImpl } from "../cache/clean.js";
import { rebuildCache as rebuildCacheImpl } from "../cache/rebuild.js";
import type { CacheCleanInput, CacheRebuildInput } from "./inputs.js";
import type { CacheResult } from "./dto.js";
import { clearReadModelMemo } from "./read-model.js";

export async function rebuildCache(input: CacheRebuildInput = {}): Promise<CacheResult> {
  const result = await rebuildCacheImpl(input);
  clearReadModelMemo(resolve(input.root ?? process.cwd()));
  return result;
}

export async function cleanCache(input: CacheCleanInput = {}): Promise<CacheResult> {
  const result = await cleanCacheImpl(input);
  clearReadModelMemo(resolve(input.root ?? process.cwd()));
  return result;
}

export { buildCacheInputs, isCacheStale, isIndexSectionArtifactFresh, isIndexSectionFresh, readCacheManifest, type CacheInputs, type CacheManifest } from "../cache/manifest.js";
export type { CacheVersionFingerprint, IndexManifestV2, IndexSectionName } from "../cache/index-manifest.js";
