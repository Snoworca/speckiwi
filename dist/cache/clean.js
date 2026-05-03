import { readdir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { ok } from "../core/result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { cacheOutputStorePaths } from "./manifest.js";
import { createRealPathGuard, normalizeStorePath, resolveRealStorePathWithGuard } from "../io/path.js";
export async function cleanCache(input = {}) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    if (input.cacheMode === "bypass") {
        return ok({
            operation: "clean",
            touchedFiles: []
        });
    }
    const touchedFiles = [];
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
        }
        catch (error) {
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
    }
    catch (error) {
        if (!isMissingPathError(error)) {
            throw error;
        }
    }
    return ok({
        operation: "clean",
        touchedFiles
    });
}
async function unlinkCacheArtifact(root, storePath, guard) {
    const target = await resolveRealStorePathWithGuard(root, normalizeStorePath(storePath), guard);
    try {
        if ((await stat(target.absolutePath)).isFile()) {
            await unlink(target.absolutePath);
            return true;
        }
    }
    catch (error) {
        if (!isMissingPathError(error)) {
            throw error;
        }
    }
    return false;
}
function isMissingPathError(error) {
    return (error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR"));
}
//# sourceMappingURL=clean.js.map