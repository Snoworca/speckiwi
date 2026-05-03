import type { Diagnostic } from "../core/dto.js";
import type { WorkspaceRoot } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import { type IndexManifestV2, type IndexSectionName } from "./index-manifest.js";
export type CacheFileHash = {
    path: string;
    sha256: string;
};
type LegacyCacheManifestSection = {
    inputs: CacheFileHash[];
    outputs: CacheFileHash[];
};
type LegacySearchCacheManifestSection = LegacyCacheManifestSection & {
    searchSettingsHash: string;
};
type LegacyExportCacheManifestSection = LegacyCacheManifestSection & {
    outputRoot: string;
    templateSettingsHash: string;
};
type LegacyCacheManifest = {
    speckiwiVersion: string;
    schemaVersions: string[];
    sections: {
        graph: LegacyCacheManifestSection;
        search: LegacySearchCacheManifestSection;
        diagnostics: LegacyCacheManifestSection;
        export: LegacyExportCacheManifestSection;
    };
};
export type CacheManifest = IndexManifestV2 | LegacyCacheManifest;
export type CacheInputs = IndexManifestV2;
export declare const cacheOutputStorePaths: {
    readonly graph: "cache/graph.json";
    readonly search: "cache/search-index.json";
    readonly entities: "cache/entities.json";
    readonly relations: "cache/relations.json";
    readonly diagnostics: "cache/diagnostics.json";
    readonly manifest: "cache/manifest.json";
};
export declare function readCacheManifest(root: WorkspaceRoot): Promise<CacheManifest | undefined>;
export declare function readCacheManifestFile(root: WorkspaceRoot): Promise<{
    manifest?: CacheManifest;
    warning?: Diagnostic;
}>;
export declare function writeCacheManifest(root: WorkspaceRoot, manifest: CacheManifest): Promise<void>;
export declare function buildCacheInputs(root: WorkspaceRoot, workspace: LoadedWorkspace): Promise<CacheInputs>;
export declare function manifestFromInputs(inputs: CacheInputs): CacheManifest;
export declare function isCacheStale(manifest: CacheManifest | undefined, inputs: CacheInputs): boolean;
export declare function isIndexSectionFresh(root: WorkspaceRoot, section: IndexSectionName): Promise<boolean>;
export declare function isIndexSectionArtifactFresh(root: WorkspaceRoot, section: IndexSectionName): Promise<boolean>;
export declare function outputsMatchManifest(root: WorkspaceRoot, outputs: CacheFileHash[]): Promise<boolean>;
export declare function cacheOutputMatchesManifest(root: WorkspaceRoot, manifest: IndexManifestV2, storePath: string): Promise<boolean>;
export {};
//# sourceMappingURL=manifest.d.ts.map