import type { CacheCleanInput, CacheRebuildInput } from "./inputs.js";
import type { CacheResult } from "./dto.js";
export declare function rebuildCache(input?: CacheRebuildInput): Promise<CacheResult>;
export declare function cleanCache(input?: CacheCleanInput): Promise<CacheResult>;
export { buildCacheInputs, isCacheStale, isIndexSectionArtifactFresh, isIndexSectionFresh, readCacheManifest, type CacheInputs, type CacheManifest } from "../cache/manifest.js";
export type { CacheVersionFingerprint, IndexManifestV2, IndexSectionName } from "../cache/index-manifest.js";
//# sourceMappingURL=cache.d.ts.map