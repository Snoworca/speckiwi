import { lstat, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
export const WORKSPACE_DIRECTORY = ".speckiwi";
export class WorkspacePathError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "WorkspacePathError";
    }
}
export function normalizeStorePath(input) {
    if (input.includes("\0")) {
        throw new WorkspacePathError("INVALID_STORE_PATH", "Store path cannot contain NUL bytes.");
    }
    const withPosixSeparators = input.replace(/\\/g, "/").trim();
    if (withPosixSeparators.length === 0) {
        throw new WorkspacePathError("INVALID_STORE_PATH", "Store path cannot be empty.");
    }
    if (/^[A-Za-z]:/.test(withPosixSeparators) || withPosixSeparators.startsWith("//") || withPosixSeparators.startsWith("/")) {
        throw new WorkspacePathError("INVALID_STORE_PATH", "Store path must be relative to .speckiwi.");
    }
    const segments = withPosixSeparators.split("/");
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
        throw new WorkspacePathError("INVALID_STORE_PATH", "Store path cannot contain empty, current, or parent segments.");
    }
    return segments.join("/");
}
export function resolveStorePath(root, storePath) {
    const normalized = normalizeStorePath(storePath);
    const absolutePath = resolve(root.speckiwiPath, normalized);
    if (!isInsideDirectory(absolutePath, root.speckiwiPath)) {
        throw new WorkspacePathError("WORKSPACE_ESCAPE", `Store path escapes ${WORKSPACE_DIRECTORY}: ${storePath}`);
    }
    return {
        root,
        storePath: normalized,
        absolutePath
    };
}
export async function resolveRealStorePath(root, storePath) {
    const workspacePath = resolveStorePath(root, storePath);
    await assertRealPathInsideWorkspace(workspacePath);
    return workspacePath;
}
export async function assertRealPathInsideWorkspace(path) {
    await assertRealPathInsideWorkspaceWithGuard(path, await createRealPathGuard(path.root));
}
export async function createRealPathGuard(root) {
    const realWorkspaceRoot = await realpath(root.rootPath);
    const realStoreRoot = await realpath(root.speckiwiPath);
    if (!isInsideDirectory(realStoreRoot, realWorkspaceRoot)) {
        throw new WorkspacePathError("WORKSPACE_ESCAPE", `${WORKSPACE_DIRECTORY} escapes workspace root: ${root.speckiwiPath}`);
    }
    return {
        realWorkspaceRoot,
        realStoreRoot,
        realPathCache: new Map([
            [resolve(root.rootPath), realWorkspaceRoot],
            [resolve(root.speckiwiPath), realStoreRoot]
        ])
    };
}
export async function resolveRealStorePathWithGuard(root, storePath, guard) {
    const workspacePath = resolveStorePath(root, storePath);
    await assertRealPathInsideWorkspaceWithGuard(workspacePath, guard);
    return workspacePath;
}
export async function assertRealPathInsideWorkspaceWithGuard(path, guard) {
    if (!isInsideDirectory(guard.realStoreRoot, guard.realWorkspaceRoot)) {
        throw new WorkspacePathError("WORKSPACE_ESCAPE", `${WORKSPACE_DIRECTORY} escapes workspace root: ${path.root.speckiwiPath}`);
    }
    const realCandidate = await realExistingPath(path.absolutePath, guard);
    if (!isInsideDirectory(realCandidate, guard.realStoreRoot)) {
        throw new WorkspacePathError("WORKSPACE_ESCAPE", `Store path escapes ${WORKSPACE_DIRECTORY}: ${path.storePath}`);
    }
}
export function isInsideDirectory(candidate, directory) {
    const normalizedDirectory = resolve(directory);
    const normalizedCandidate = resolve(candidate);
    return normalizedCandidate === normalizedDirectory || normalizedCandidate.startsWith(`${normalizedDirectory}${sep}`);
}
async function realExistingPath(path, guard) {
    let current = resolve(path);
    while (current.length > 0) {
        const cached = guard?.realPathCache.get(current);
        if (cached !== undefined) {
            return cached;
        }
        try {
            await lstat(current);
            const resolved = await realpath(current);
            guard?.realPathCache.set(current, resolved);
            return resolved;
        }
        catch (error) {
            if (!isNodeError(error) || error.code !== "ENOENT") {
                throw error;
            }
            const parent = dirname(current);
            if (parent === current) {
                throw error;
            }
            current = parent;
        }
    }
    return realpath(path);
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
export function toFileUrl(path) {
    return pathToFileURL(path.absolutePath).href;
}
//# sourceMappingURL=path.js.map