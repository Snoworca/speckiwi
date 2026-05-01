import type { WorkspaceRoot } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
export type CacheFileHash = {
    path: string;
    sha256: string;
};
export type CacheManifestSection = {
    inputs: CacheFileHash[];
    outputs: CacheFileHash[];
};
export type SearchCacheManifestSection = CacheManifestSection & {
    searchSettingsHash: string;
};
export type ExportCacheManifestSection = CacheManifestSection & {
    outputRoot: string;
    templateSettingsHash: string;
};
export type CacheManifest = {
    speckiwiVersion: string;
    schemaVersions: string[];
    sections: {
        graph: CacheManifestSection;
        search: SearchCacheManifestSection;
        diagnostics: CacheManifestSection;
        export: ExportCacheManifestSection;
    };
};
export type CacheInputs = CacheManifest;
export declare const cacheOutputStorePaths: {
    readonly graph: "cache/graph.json";
    readonly search: "cache/search-index.json";
    readonly diagnostics: "cache/diagnostics.json";
    readonly manifest: "cache/manifest.json";
};
export declare function readCacheManifest(root: WorkspaceRoot): Promise<CacheManifest | undefined>;
export declare function buildCacheInputs(root: WorkspaceRoot, workspace: LoadedWorkspace): Promise<CacheInputs>;
export declare function manifestFromInputs(inputs: CacheInputs): CacheManifest;
export declare function isCacheStale(manifest: CacheManifest | undefined, inputs: CacheInputs): boolean;
//# sourceMappingURL=manifest.d.ts.map