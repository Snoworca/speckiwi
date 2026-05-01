import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDiagnosticBag } from "./result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { loadWorkspaceForValidation } from "../validate/semantic.js";
import { buildDictionaryExpansion, buildSearchIndex, deserializeSearchIndex, flattenWorkspace, search } from "../search/index.js";
import { rebuildCache } from "../cache/rebuild.js";
import { buildCacheInputs, cacheOutputStorePaths, isCacheStale, readCacheManifest } from "../cache/manifest.js";
export async function searchWorkspace(input) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    const workspace = await loadWorkspaceForValidation(root);
    const warnings = [];
    let index;
    if (input.cacheMode !== "bypass") {
        const stale = isCacheStale(await readCacheManifest(root), await buildCacheInputs(root, workspace));
        if (stale) {
            const rebuild = await rebuildCache(input);
            if (!rebuild.ok) {
                warnings.push({
                    severity: "warning",
                    code: "CACHE_REBUILD_DEGRADED",
                    message: "Cache rebuild failed; search used YAML source data.",
                    details: { reason: rebuild.error.message }
                });
            }
        }
        else {
            const cached = await readSearchCache(root);
            if (cached.index !== undefined) {
                index = cached.index;
            }
            else if (cached.warning !== undefined) {
                warnings.push(cached.warning);
            }
        }
    }
    index ??= buildSearchIndex(flattenWorkspace(workspace), buildDictionaryExpansion(workspace));
    const result = search(input, index);
    if (!result.ok || warnings.length === 0) {
        return result;
    }
    const diagnostics = createDiagnosticBag([
        ...result.diagnostics.errors,
        ...result.diagnostics.warnings,
        ...result.diagnostics.infos,
        ...warnings
    ]);
    return {
        ...result,
        diagnostics,
        data: {
            query: result.query,
            mode: result.mode,
            results: result.results,
            page: result.page
        }
    };
}
async function readSearchCache(root) {
    const displayPath = `.speckiwi/${cacheOutputStorePaths.search}`;
    try {
        const raw = await readFile(resolve(root.speckiwiPath, cacheOutputStorePaths.search), "utf8");
        const index = deserializeSearchIndex(JSON.parse(raw));
        if (index !== undefined) {
            return { index };
        }
        return {
            warning: unreadableSearchCacheWarning(displayPath, "Serialized search cache has an invalid shape.")
        };
    }
    catch (error) {
        return {
            warning: unreadableSearchCacheWarning(displayPath, error instanceof Error ? error.message : String(error))
        };
    }
}
function unreadableSearchCacheWarning(path, reason) {
    return {
        severity: "warning",
        code: "SEARCH_CACHE_UNREADABLE",
        message: "Search cache could not be read; search used YAML source data.",
        path,
        details: { reason }
    };
}
//# sourceMappingURL=search.js.map