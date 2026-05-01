export declare const WORKSPACE_DIRECTORY = ".speckiwi";
declare const storePathBrand: unique symbol;
export type StorePath = string & {
    readonly [storePathBrand]: "StorePath";
};
export type WorkspaceRoot = {
    rootPath: string;
    speckiwiPath: string;
    explicit: boolean;
};
export type WorkspacePath = {
    root: WorkspaceRoot;
    storePath: StorePath;
    absolutePath: string;
};
export declare class WorkspacePathError extends Error {
    readonly code: "INVALID_STORE_PATH" | "WORKSPACE_ESCAPE";
    constructor(code: "INVALID_STORE_PATH" | "WORKSPACE_ESCAPE", message: string);
}
export declare function normalizeStorePath(input: string): StorePath;
export declare function resolveStorePath(root: WorkspaceRoot, storePath: StorePath): WorkspacePath;
export declare function resolveRealStorePath(root: WorkspaceRoot, storePath: StorePath): Promise<WorkspacePath>;
export declare function assertRealPathInsideWorkspace(path: WorkspacePath): Promise<void>;
export declare function isInsideDirectory(candidate: string, directory: string): boolean;
export declare function toFileUrl(path: WorkspacePath): string;
export {};
//# sourceMappingURL=path.d.ts.map