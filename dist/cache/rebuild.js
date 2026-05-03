import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ok, fail, createDiagnosticBag } from "../core/result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { buildGraphFromRegistry } from "../graph/builder.js";
import { loadWorkspaceForValidation, validateRegistry } from "../validate/semantic.js";
import { mergeDiagnosticBags } from "../validate/diagnostics.js";
import { buildDictionaryExpansion, buildSearchIndex, flattenWorkspace, serializeSearchIndex } from "../search/index.js";
import { buildCacheInputs, cacheOutputStorePaths, isCacheStale, readCacheManifest, writeCacheManifest } from "./manifest.js";
import { serializeArtifactFile, writeSerializedArtifacts } from "../indexing/serialization.js";
import { buildRequirementRegistry } from "../core/requirements.js";
import { bindRequirementPayloadShards, buildEntityIndex, buildRequirementPayloadShardRefs, buildRequirementPayloadShards, requirementPayloadShardStorePath } from "../indexing/entities.js";
import { buildRelationIndex } from "../indexing/relations.js";
import { buildIndexManifestWithOutputs } from "./index-manifest.js";
import { createRealPathGuard, normalizeStorePath, resolveRealStorePathWithGuard } from "../io/path.js";
export async function rebuildCache(input = {}) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    if (input.cacheMode === "bypass") {
        return ok({
            operation: "rebuild",
            touchedFiles: []
        });
    }
    const workspace = await loadWorkspaceForValidation(root);
    const cacheInputsBeforeWrite = await buildCacheInputs(root, workspace);
    const staleBefore = isCacheStale(await readCacheManifest(root), cacheInputsBeforeWrite);
    const cacheDir = resolve(root.speckiwiPath, "cache");
    const generatedPaths = [
        cacheOutputStorePaths.graph,
        cacheOutputStorePaths.search,
        cacheOutputStorePaths.entities,
        cacheOutputStorePaths.relations,
        cacheOutputStorePaths.diagnostics,
        cacheOutputStorePaths.manifest
    ];
    try {
        await mkdir(cacheDir, { recursive: true });
        const registry = buildRequirementRegistry(workspace);
        const graph = buildGraphFromRegistry(registry, "traceability", mergeDiagnosticBags(workspace.diagnostics, validateRegistry(workspace)));
        const searchIndex = buildSearchIndex(flattenWorkspace(workspace, registry), buildDictionaryExpansion(workspace));
        const documentHashes = new Map(cacheInputsBeforeWrite.files.map((file) => [file.path, file.sha256.replace(/^sha256:/, "")]));
        const shards = buildRequirementPayloadShards(registry, documentHashes);
        const entityIndex = bindRequirementPayloadShards(buildEntityIndex(registry), buildRequirementPayloadShardRefs(shards));
        const relationIndex = buildRelationIndex(registry);
        const serializedSearchIndex = serializeSearchIndex(searchIndex);
        const guard = await createRealPathGuard(root);
        const shardDirectory = (await resolveRealStorePathWithGuard(root, normalizeStorePath("cache/requirements"), guard)).absolutePath;
        const shardPaths = new Set(shards.map((shard) => requirementPayloadShardStorePath(shard.documentHash)));
        const artifacts = [
            serializeArtifactFile(cacheOutputStorePaths.graph, graph),
            serializeArtifactFile(cacheOutputStorePaths.search, serializedSearchIndex),
            serializeArtifactFile(cacheOutputStorePaths.entities, entityIndex),
            serializeArtifactFile(cacheOutputStorePaths.relations, relationIndex),
            serializeArtifactFile(cacheOutputStorePaths.diagnostics, workspace.diagnostics),
            ...shards.map((shard) => serializeArtifactFile(requirementPayloadShardStorePath(shard.documentHash), shard))
        ];
        const outputHashes = artifacts.map(({ path, sha256 }) => ({ path, sha256 }));
        try {
            const existingShardFiles = (await readdir(shardDirectory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
            await Promise.all(existingShardFiles
                .map((name) => `cache/requirements/${name}`)
                .filter((path) => !shardPaths.has(path))
                .map((path) => removeCacheArtifact(root, path, guard)));
        }
        catch (error) {
            if (!isMissingPathError(error)) {
                throw error;
            }
        }
        await writeSerializedArtifacts(root, artifacts);
        const manifest = await buildIndexManifestWithOutputs(root, workspace, cacheInputsBeforeWrite.files, outputHashes);
        await writeCacheManifest(root, manifest);
        return ok({
            operation: "rebuild",
            touchedFiles: [
                ...generatedPaths.map((path) => `.speckiwi/${path}`),
                ...shards.map((shard) => `.speckiwi/${requirementPayloadShardStorePath(shard.documentHash)}`)
            ],
            staleBefore
        });
    }
    catch (error) {
        try {
            const guard = await createRealPathGuard(root);
            await Promise.all(generatedPaths.map((path) => removeCacheArtifact(root, path, guard)));
        }
        catch {
            // Preserve the original cache rebuild failure as the returned diagnostic.
        }
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
async function removeCacheArtifact(root, storePath, guard) {
    const target = await resolveRealStorePathWithGuard(root, normalizeStorePath(storePath), guard);
    try {
        if ((await stat(target.absolutePath)).isFile()) {
            await rm(target.absolutePath, { force: true });
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
//# sourceMappingURL=rebuild.js.map