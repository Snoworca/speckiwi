import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createRealPathGuard, normalizeStorePath, resolveRealStorePath, resolveRealStorePathWithGuard } from "../io/path.js";
import { sha256 } from "../cache/hash.js";
const ARTIFACT_FORMAT = "speckiwi/cache-artifact/v1";
const ARTIFACT_VERSION = 1;
const allowedArtifactStorePaths = new Set([
    "cache/graph.json",
    "cache/search-index.json",
    "cache/diagnostics.json",
    "cache/entities.json",
    "cache/relations.json",
    "cache/facts.json"
]);
export async function readArtifact(root, storePath, guard) {
    const normalized = assertArtifactStorePath(storePath);
    const displayPath = `.speckiwi/${normalized}`;
    try {
        const target = await resolveRealStorePath(root, normalized);
        const raw = await readFile(target.absolutePath, "utf8");
        const parsed = JSON.parse(raw);
        const value = artifactValue(parsed);
        const artifact = guard(value);
        if (artifact !== undefined) {
            return { artifact };
        }
        return { warning: unreadableArtifactWarning(displayPath, "Serialized cache artifact has an invalid shape.") };
    }
    catch (error) {
        return {
            warning: unreadableArtifactWarning(displayPath, error instanceof Error ? error.message : String(error))
        };
    }
}
export async function writeArtifact(root, storePath, value) {
    await writeSerializedArtifact(root, serializeArtifactFile(storePath, value));
}
export async function writeSerializedArtifact(root, artifact) {
    const target = await resolveRealStorePath(root, artifact.path);
    await mkdir(dirname(target.absolutePath), { recursive: true });
    await writeFile(target.absolutePath, artifact.text, "utf8");
}
export async function writeSerializedArtifacts(root, artifacts) {
    const guard = await createRealPathGuard(root);
    const targets = await Promise.all(artifacts.map(async (artifact) => ({
        artifact,
        target: await resolveRealStorePathWithGuard(root, artifact.path, guard)
    })));
    await Promise.all([...new Set(targets.map(({ target }) => dirname(target.absolutePath)))].map((directory) => mkdir(directory, { recursive: true })));
    await Promise.all(targets.map(({ artifact, target }) => writeFile(target.absolutePath, artifact.text, "utf8")));
}
export function artifactFileHash(storePath, value) {
    const artifact = serializeArtifactFile(storePath, value);
    return {
        path: artifact.path,
        sha256: artifact.sha256
    };
}
export function serializeArtifactFile(storePath, value) {
    const normalized = assertArtifactStorePath(storePath);
    const text = serializeArtifact(value);
    return {
        path: normalized,
        sha256: `sha256:${sha256(text)}`,
        text
    };
}
function artifactValue(value) {
    if (isArtifactEnvelope(value)) {
        return value.data;
    }
    return value;
}
function assertArtifactStorePath(storePath) {
    const normalized = normalizeStorePath(storePath);
    if (!allowedArtifactStorePaths.has(normalized) && !/^cache\/requirements\/[a-f0-9]{64}\.json$/.test(normalized)) {
        throw new Error(`Cache artifact path is not allowed: ${storePath}.`);
    }
    return normalized;
}
function unreadableArtifactWarning(path, reason) {
    return {
        severity: "warning",
        code: "CACHE_ARTIFACT_UNREADABLE",
        message: "Cache artifact could not be read; source YAML data was used.",
        path,
        details: { reason }
    };
}
function isArtifactEnvelope(value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        value.format === ARTIFACT_FORMAT &&
        value.version === ARTIFACT_VERSION &&
        "data" in value);
}
function serializeArtifact(value) {
    const envelope = {
        format: ARTIFACT_FORMAT,
        version: ARTIFACT_VERSION,
        data: value
    };
    return `${JSON.stringify(envelope)}\n`;
}
//# sourceMappingURL=serialization.js.map