import type { WorkspaceRoot } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
export type SourceFileStat = {
    path: string;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
};
export type SourceFileFingerprint = SourceFileStat & {
    sha256: string;
};
export declare function statWorkspaceInputs(root: WorkspaceRoot): Promise<SourceFileStat[]>;
export declare function fingerprintWorkspace(root: WorkspaceRoot): Promise<SourceFileFingerprint[]>;
export declare function fingerprintLoadedWorkspace(root: WorkspaceRoot, workspace: LoadedWorkspace): Promise<SourceFileFingerprint[]>;
//# sourceMappingURL=fingerprint.d.ts.map