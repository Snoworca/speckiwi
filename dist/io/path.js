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
    const realWorkspaceRoot = await realpath(path.root.rootPath);
    const realStoreRoot = await realpath(path.root.speckiwiPath);
    if (!isInsideDirectory(realStoreRoot, realWorkspaceRoot)) {
        throw new WorkspacePathError("WORKSPACE_ESCAPE", `${WORKSPACE_DIRECTORY} escapes workspace root: ${path.root.speckiwiPath}`);
    }
    const realCandidate = await realExistingPath(path.absolutePath);
    if (!isInsideDirectory(realCandidate, realStoreRoot)) {
        throw new WorkspacePathError("WORKSPACE_ESCAPE", `Store path escapes ${WORKSPACE_DIRECTORY}: ${path.storePath}`);
    }
}
export function isInsideDirectory(candidate, directory) {
    const normalizedDirectory = resolve(directory);
    const normalizedCandidate = resolve(candidate);
    return normalizedCandidate === normalizedDirectory || normalizedCandidate.startsWith(`${normalizedDirectory}${sep}`);
}
async function realExistingPath(path) {
    let current = resolve(path);
    while (current.length > 0) {
        try {
            await lstat(current);
            return await realpath(current);
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