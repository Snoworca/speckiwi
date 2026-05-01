import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE_DIRECTORY } from "./path.js";
export class WorkspaceDiscoveryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "WorkspaceDiscoveryError";
    }
}
export async function findWorkspaceRoot(start, explicitRoot) {
    const startPath = resolve(start);
    if (explicitRoot !== undefined) {
        const rootPath = resolve(startPath, explicitRoot);
        const root = buildWorkspaceRoot(rootPath, true);
        await assertWorkspaceExists(root);
        return root;
    }
    let current = startPath;
    for (;;) {
        const root = buildWorkspaceRoot(current, false);
        if (await workspaceExists(root)) {
            return root;
        }
        const parent = dirname(current);
        if (parent === current) {
            throw new WorkspaceDiscoveryError("WORKSPACE_NOT_FOUND", `Could not find ${WORKSPACE_DIRECTORY} from ${startPath}.`);
        }
        current = parent;
    }
}
export function workspaceRootFromPath(rootPath, explicit = true) {
    return buildWorkspaceRoot(resolve(rootPath), explicit);
}
export function workspaceRootFromUrl(rootUrl, explicit = true) {
    return workspaceRootFromPath(fileURLToPath(rootUrl), explicit);
}
function buildWorkspaceRoot(rootPath, explicit) {
    const absoluteRootPath = resolve(rootPath);
    return {
        rootPath: absoluteRootPath,
        speckiwiPath: resolve(absoluteRootPath, WORKSPACE_DIRECTORY),
        explicit
    };
}
async function assertWorkspaceExists(root) {
    if (!(await workspaceExists(root))) {
        throw new WorkspaceDiscoveryError("WORKSPACE_NOT_FOUND", `Could not find ${WORKSPACE_DIRECTORY} at ${root.rootPath}.`);
    }
}
async function workspaceExists(root) {
    try {
        await access(root.speckiwiPath);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=workspace.js.map