import { resolve } from "node:path";
import { cleanCache as cleanCacheImpl } from "../cache/clean.js";
import { rebuildCache as rebuildCacheImpl } from "../cache/rebuild.js";
import { clearReadModelMemo } from "./read-model.js";
export async function rebuildCache(input = {}) {
    const result = await rebuildCacheImpl(input);
    clearReadModelMemo(resolve(input.root ?? process.cwd()));
    return result;
}
export async function cleanCache(input = {}) {
    const result = await cleanCacheImpl(input);
    clearReadModelMemo(resolve(input.root ?? process.cwd()));
    return result;
}
export { buildCacheInputs, isCacheStale, isIndexSectionArtifactFresh, isIndexSectionFresh, readCacheManifest } from "../cache/manifest.js";
//# sourceMappingURL=cache.js.map