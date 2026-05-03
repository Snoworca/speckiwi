import { readFile } from "node:fs/promises";
import { atomicWriteText } from "../io/file-store.js";
import { normalizeStorePath, resolveRealStorePath } from "../io/path.js";
import { fingerprintLoadedWorkspace, fingerprintWorkspace, statWorkspaceInputs } from "./fingerprint.js";
import { sha256File, stableJson } from "./hash.js";
import { CACHE_MANIFEST_FORMAT, CACHE_MANIFEST_SCHEMA_VERSION, buildIndexManifest, readVersionFingerprint, sameManifestFiles, sameManifestStats } from "./index-manifest.js";
export const cacheOutputStorePaths = {
    graph: "cache/graph.json",
    search: "cache/search-index.json",
    entities: "cache/entities.json",
    relations: "cache/relations.json",
    diagnostics: "cache/diagnostics.json",
    manifest: "cache/manifest.json"
};
export async function readCacheManifest(root) {
    return (await readCacheManifestFile(root)).manifest;
}
export async function readCacheManifestFile(root) {
    try {
        const target = await resolveRealStorePath(root, normalizeStorePath(cacheOutputStorePaths.manifest));
        const raw = await readFile(target.absolutePath, "utf8");
        const parsed = JSON.parse(raw);
        if (isIndexManifest(parsed) || isLegacyCacheManifest(parsed)) {
            return { manifest: parsed };
        }
        return {
            warning: cacheManifestWarning("Serialized cache manifest has an invalid shape.")
        };
    }
    catch (error) {
        return {
            warning: cacheManifestWarning(error instanceof Error ? error.message : String(error))
        };
    }
}
export async function writeCacheManifest(root, manifest) {
    const target = await resolveRealStorePath(root, normalizeStorePath(cacheOutputStorePaths.manifest));
    await atomicWriteText(target.absolutePath, `${stableJson(manifest)}\n`);
}
export async function buildCacheInputs(root, workspace) {
    return buildIndexManifest(root, workspace, await fingerprintLoadedWorkspace(root, workspace));
}
export function manifestFromInputs(inputs) {
    return JSON.parse(JSON.stringify(inputs));
}
export function isCacheStale(manifest, inputs) {
    if (manifest === undefined || !isIndexManifest(manifest)) {
        return true;
    }
    return (manifest.speckiwiVersion !== inputs.speckiwiVersion ||
        manifest.parserVersion !== inputs.parserVersion ||
        manifest.schemaBundleHash !== inputs.schemaBundleHash ||
        !sameManifestFiles(manifest.files, inputs.files) ||
        !sameSection(manifest.sections.facts, inputs.sections.facts) ||
        !sameSection(manifest.sections.entities, inputs.sections.entities) ||
        !sameSection(manifest.sections.relations, inputs.sections.relations) ||
        !sameSearchSection(manifest.sections.search, inputs.sections.search) ||
        !sameGraphSection(manifest.sections.graph, inputs.sections.graph) ||
        !sameSection(manifest.sections.diagnostics, inputs.sections.diagnostics));
}
export async function isIndexSectionFresh(root, section) {
    if (!(await isIndexSectionArtifactFresh(root, section))) {
        return false;
    }
    const manifest = await readCacheManifest(root);
    if (!isIndexManifest(manifest)) {
        return false;
    }
    const stats = await statWorkspaceInputs(root);
    if (sameManifestStats(manifest.files, stats)) {
        return true;
    }
    return sameManifestFiles(manifest.files, await fingerprintWorkspace(root));
}
export async function isIndexSectionArtifactFresh(root, section) {
    const manifest = await readCacheManifest(root);
    if (!isIndexManifest(manifest)) {
        return false;
    }
    if (!(await outputsMatchManifest(root, manifest.sections[section].outputs))) {
        return false;
    }
    const versions = await readVersionFingerprint(root);
    if (!sameRootVersions(manifest, versions)) {
        return false;
    }
    if (section === "search" &&
        (manifest.sections.search.tokenizerVersion !== versions.tokenizerVersion ||
            manifest.sections.search.searchSettingsHash !== versions.searchSettingsHash ||
            manifest.sections.search.dictionaryHash !== versions.dictionaryHash)) {
        return false;
    }
    if (section === "graph" && manifest.sections.graph.graphRulesVersion !== versions.graphRulesVersion) {
        return false;
    }
    return true;
}
export async function outputsMatchManifest(root, outputs) {
    for (const output of outputs) {
        try {
            const target = await resolveRealStorePath(root, normalizeStorePath(output.path));
            const actualHash = `sha256:${await sha256File(target.absolutePath)}`;
            if (actualHash !== normalizeSha256(output.sha256)) {
                return false;
            }
        }
        catch {
            return false;
        }
    }
    return true;
}
export async function cacheOutputMatchesManifest(root, manifest, storePath) {
    const normalized = normalizeStorePath(storePath);
    const output = manifestOutputs(manifest).find((entry) => entry.path === normalized);
    return output !== undefined && (await outputsMatchManifest(root, [output]));
}
function manifestOutputs(manifest) {
    return [
        ...manifest.sections.facts.outputs,
        ...manifest.sections.entities.outputs,
        ...manifest.sections.relations.outputs,
        ...manifest.sections.search.outputs,
        ...manifest.sections.graph.outputs,
        ...manifest.sections.diagnostics.outputs
    ];
}
function normalizeSha256(value) {
    return value.startsWith("sha256:") ? value : `sha256:${value}`;
}
function sameSearchSection(left, right) {
    return (left.tokenizerVersion === right.tokenizerVersion &&
        left.searchSettingsHash === right.searchSettingsHash &&
        left.dictionaryHash === right.dictionaryHash &&
        sameSection(left, right));
}
function sameGraphSection(left, right) {
    return left.graphRulesVersion === right.graphRulesVersion && sameSection(left, right);
}
function sameSection(left, right) {
    return sameStrings(left.inputs, right.inputs) && sameFiles(left.outputs, right.outputs);
}
function sameFiles(left, right) {
    return JSON.stringify([...left].sort(compareFileHash)) === JSON.stringify([...right].sort(compareFileHash));
}
function sameStrings(left, right) {
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
function compareFileHash(left, right) {
    return left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256);
}
function isIndexManifest(value) {
    const manifest = jsonObjectValue(value);
    const sections = jsonObjectValue(manifest?.sections);
    const facts = jsonObjectValue(sections?.facts);
    const entities = jsonObjectValue(sections?.entities);
    const relations = jsonObjectValue(sections?.relations);
    const search = jsonObjectValue(sections?.search);
    const graph = jsonObjectValue(sections?.graph);
    const diagnostics = jsonObjectValue(sections?.diagnostics);
    return (manifest?.format === CACHE_MANIFEST_FORMAT &&
        manifest.cacheSchemaVersion === CACHE_MANIFEST_SCHEMA_VERSION &&
        typeof manifest.speckiwiVersion === "string" &&
        typeof manifest.parserVersion === "string" &&
        typeof manifest.schemaBundleHash === "string" &&
        manifestFiles(manifest.files) !== undefined &&
        isManifestSection(facts) &&
        isManifestSection(entities) &&
        isManifestSection(relations) &&
        isManifestSection(search) &&
        typeof search.tokenizerVersion === "string" &&
        typeof search.searchSettingsHash === "string" &&
        typeof search.dictionaryHash === "string" &&
        isManifestSection(graph) &&
        typeof graph.graphRulesVersion === "string" &&
        isManifestSection(diagnostics));
}
function isLegacyCacheManifest(value) {
    const manifest = jsonObjectValue(value);
    const sections = jsonObjectValue(manifest?.sections);
    const graph = jsonObjectValue(sections?.graph);
    const search = jsonObjectValue(sections?.search);
    const diagnostics = jsonObjectValue(sections?.diagnostics);
    const exportSection = jsonObjectValue(sections?.export);
    return (manifest?.format === undefined &&
        typeof manifest?.speckiwiVersion === "string" &&
        stringArray(manifest.schemaVersions) !== undefined &&
        isLegacySection(graph) &&
        isLegacySection(search) &&
        typeof search.searchSettingsHash === "string" &&
        isLegacySection(diagnostics) &&
        isLegacySection(exportSection) &&
        typeof exportSection.outputRoot === "string" &&
        typeof exportSection.templateSettingsHash === "string");
}
function jsonObjectValue(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}
function isManifestSection(value) {
    return value !== undefined && stringArray(value.inputs) !== undefined && fileHashArray(value.outputs) !== undefined;
}
function isLegacySection(value) {
    return value !== undefined && fileHashArray(value.inputs) !== undefined && fileHashArray(value.outputs) !== undefined;
}
function fileHashArray(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    return value.every(isFileHash) ? value : undefined;
}
function manifestFiles(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    return value.every(isManifestFile) ? value : undefined;
}
function stringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}
function isFileHash(value) {
    const item = jsonObjectValue(value);
    return typeof item?.path === "string" && typeof item.sha256 === "string";
}
function cacheManifestWarning(reason) {
    return {
        severity: "warning",
        code: "CACHE_MANIFEST_UNREADABLE",
        message: "Cache manifest could not be read; cache freshness was treated as stale.",
        path: ".speckiwi/cache/manifest.json",
        details: { reason }
    };
}
function isManifestFile(value) {
    const item = jsonObjectValue(value);
    return (typeof item?.path === "string" &&
        typeof item.size === "number" &&
        typeof item.mtimeMs === "number" &&
        typeof item.ctimeMs === "number" &&
        typeof item.sha256 === "string" &&
        (item.schemaKind === undefined || typeof item.schemaKind === "string") &&
        (item.artifactHash === undefined || typeof item.artifactHash === "string"));
}
function sameRootVersions(manifest, versions) {
    return (manifest.speckiwiVersion === versions.speckiwiVersion &&
        manifest.parserVersion === versions.parserVersion &&
        manifest.schemaBundleHash === versions.schemaBundleHash);
}
//# sourceMappingURL=manifest.js.map