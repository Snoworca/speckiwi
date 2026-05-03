import { lstat, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { sha256, sha256File } from "./hash.js";
export async function statWorkspaceInputs(root) {
    const paths = [];
    await visitYamlInputs(root, async (absolutePath, storePath) => {
        const stats = await lstat(absolutePath);
        paths.push({
            path: storePath,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            ctimeMs: stats.ctimeMs
        });
    });
    return paths.sort(compareSourceFile);
}
export async function fingerprintWorkspace(root) {
    const paths = await statWorkspaceInputs(root);
    const fingerprints = await Promise.all(paths.map(async (entry) => ({
        ...entry,
        sha256: await sha256File(resolve(root.speckiwiPath, entry.path))
    })));
    return fingerprints.sort(compareSourceFile);
}
export async function fingerprintLoadedWorkspace(root, workspace) {
    const rawByPath = new Map(workspace.documents.map((document) => [document.storePath, document.raw]));
    const paths = await statWorkspaceInputs(root);
    const fingerprints = await Promise.all(paths.map(async (entry) => {
        const raw = rawByPath.get(entry.path);
        return {
            ...entry,
            sha256: raw === undefined ? await sha256File(resolve(root.speckiwiPath, entry.path)) : `sha256:${sha256(raw)}`
        };
    }));
    return fingerprints.sort(compareSourceFile);
}
async function visitYamlInputs(root, visit) {
    async function walk(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = resolve(directory, entry.name);
            const storePath = toStorePath(root, absolutePath);
            if (isIgnoredStorePath(storePath) || entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                await walk(absolutePath);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith(".yaml")) {
                await visit(absolutePath, storePath);
            }
        }
    }
    await walk(root.speckiwiPath);
}
function toStorePath(root, absolutePath) {
    return relative(root.speckiwiPath, absolutePath).split(sep).join("/");
}
function isIgnoredStorePath(storePath) {
    return storePath.startsWith("cache/") || storePath.startsWith("exports/") || storePath.startsWith("templates/");
}
function compareSourceFile(left, right) {
    return left.path.localeCompare(right.path);
}
//# sourceMappingURL=fingerprint.js.map