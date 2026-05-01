import { type WorkspaceRoot } from "./path.js";
export declare class WorkspaceDiscoveryError extends Error {
    readonly code: "WORKSPACE_NOT_FOUND";
    constructor(code: "WORKSPACE_NOT_FOUND", message: string);
}
export declare function findWorkspaceRoot(start: string, explicitRoot?: string): Promise<WorkspaceRoot>;
export declare function workspaceRootFromPath(rootPath: string, explicit?: boolean): WorkspaceRoot;
export declare function workspaceRootFromUrl(rootUrl: URL, explicit?: boolean): WorkspaceRoot;
//# sourceMappingURL=workspace.d.ts.map