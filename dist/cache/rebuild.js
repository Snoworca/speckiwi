import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ok, fail, createDiagnosticBag } from "../core/result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { atomicWriteText } from "../io/file-store.js";
import { buildGraph } from "../graph/builder.js";
import { loadWorkspaceForValidation } from "../validate/semantic.js";
import { buildDictionaryExpansion, buildSearchIndex, flattenWorkspace, serializeSearchIndex } from "../search/index.js";
import { buildCacheInputs, cacheOutputStorePaths, isCacheStale, manifestFromInputs, readCacheManifest } from "./manifest.js";
import { stableJson } from "./hash.js";
export async function rebuildCache(input = {}) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    const workspace = await loadWorkspaceForValidation(root);
    const staleBefore = isCacheStale(await readCacheManifest(root), await buildCacheInputs(root, workspace));
    if (input.cacheMode === "bypass") {
        return ok({
            operation: "rebuild",
            touchedFiles: [],
            staleBefore
        });
    }
    const cacheDir = resolve(root.speckiwiPath, "cache");
    const generatedPaths = [
        cacheOutputStorePaths.graph,
        cacheOutputStorePaths.search,
        cacheOutputStorePaths.diagnostics,
        cacheOutputStorePaths.manifest
    ];
    try {
        await mkdir(cacheDir, { recursive: true });
        const graph = buildGraph(workspace);
        const searchIndex = buildSearchIndex(flattenWorkspace(workspace), buildDictionaryExpansion(workspace));
        await atomicWriteText(resolve(root.speckiwiPath, cacheOutputStorePaths.graph), stableJson(graph));
        await atomicWriteText(resolve(root.speckiwiPath, cacheOutputStorePaths.search), stableJson(serializeSearchIndex(searchIndex)));
        await atomicWriteText(resolve(root.speckiwiPath, cacheOutputStorePaths.diagnostics), stableJson(workspace.diagnostics));
        const manifest = manifestFromInputs(await buildCacheInputs(root, workspace));
        await atomicWriteText(resolve(root.speckiwiPath, cacheOutputStorePaths.manifest), `${stableJson(manifest)}\n`);
        return ok({
            operation: "rebuild",
            touchedFiles: generatedPaths.map((path) => `.speckiwi/${path}`),
            staleBefore
        });
    }
    catch (error) {
        await Promise.all(generatedPaths.map((path) => rm(resolve(root.speckiwiPath, path), { force: true })));
        const message = error instanceof Error ? error.message : String(error);
        const diagnostics = createDiagnosticBag([
            {
                severity: "error",
                code: "CACHE_REBUILD_FAILED",
                message
            }
        ]);
        return fail({ code: "CACHE_REBUILD_FAILED", message }, diagnostics);
    }
}
//# sourceMappingURL=rebuild.js.map