import type { Diagnostic } from "../core/dto.js";
import type { StorePath, WorkspaceRoot } from "../io/path.js";
export type SerializedArtifactFile = {
    path: StorePath;
    sha256: string;
    text: string;
};
export declare function readArtifact<T>(root: WorkspaceRoot, storePath: string, guard: (value: unknown) => T | undefined): Promise<{
    artifact?: T;
    warning?: Diagnostic;
}>;
export declare function writeArtifact(root: WorkspaceRoot, storePath: string, value: unknown): Promise<void>;
export declare function writeSerializedArtifact(root: WorkspaceRoot, artifact: SerializedArtifactFile): Promise<void>;
export declare function writeSerializedArtifacts(root: WorkspaceRoot, artifacts: SerializedArtifactFile[]): Promise<void>;
export declare function artifactFileHash(storePath: string, value: unknown): {
    path: StorePath;
    sha256: string;
};
export declare function serializeArtifactFile(storePath: string, value: unknown): SerializedArtifactFile;
//# sourceMappingURL=serialization.d.ts.map