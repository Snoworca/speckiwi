import { type StorePath, type WorkspaceRoot } from "../io/path.js";
export declare class WriteLockError extends Error {
    readonly code = "APPLY_REJECTED_LOCK_CONFLICT";
    constructor(target: StorePath);
}
export declare function withTargetWriteLock<T>(root: WorkspaceRoot, target: StorePath, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=lock.d.ts.map