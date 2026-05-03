import type { WorkspaceRoot } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import { type CacheFileHash } from "./manifest.js";
import { type SourceFileFingerprint, type SourceFileStat } from "./fingerprint.js";
export declare const CACHE_MANIFEST_FORMAT = "speckiwi/cache-manifest/v2";
export declare const CACHE_MANIFEST_SCHEMA_VERSION = 2;
export declare const CACHE_PARSER_VERSION = "yaml@2";
export declare const CACHE_TOKENIZER_VERSION = "search-tokenizer@1";
export declare const CACHE_GRAPH_RULES_VERSION = "graph-rules@1";
export type CacheVersionFingerprint = {
    speckiwiVersion: string;
    parserVersion: string;
    schemaBundleHash: string;
    tokenizerVersion: string;
    graphRulesVersion: string;
    dictionaryHash: string;
    searchSettingsHash: string;
};
export type IndexSectionName = "facts" | "entities" | "relations" | "search" | "graph" | "diagnostics";
export type IndexManifestFile = SourceFileFingerprint & {
    schemaKind?: string;
    artifactHash?: string;
};
export type IndexManifestSection = {
    inputs: string[];
    outputs: CacheFileHash[];
};
export type SearchManifestSection = IndexManifestSection & {
    tokenizerVersion: string;
    searchSettingsHash: string;
    dictionaryHash: string;
};
export type GraphManifestSection = IndexManifestSection & {
    graphRulesVersion: string;
};
export type IndexManifestV2 = {
    format: typeof CACHE_MANIFEST_FORMAT;
    cacheSchemaVersion: typeof CACHE_MANIFEST_SCHEMA_VERSION;
    speckiwiVersion: string;
    parserVersion: string;
    schemaBundleHash: string;
    files: IndexManifestFile[];
    sections: {
        facts: IndexManifestSection;
        entities: IndexManifestSection;
        relations: IndexManifestSection;
        search: SearchManifestSection;
        graph: GraphManifestSection;
        diagnostics: IndexManifestSection;
    };
};
export declare function buildIndexManifest(root: WorkspaceRoot, workspace: LoadedWorkspace, files: SourceFileFingerprint[]): Promise<IndexManifestV2>;
export declare function buildIndexManifestWithOutputs(root: WorkspaceRoot, workspace: LoadedWorkspace, files: SourceFileFingerprint[], outputHashes: CacheFileHash[]): Promise<IndexManifestV2>;
export declare function readVersionFingerprint(root: WorkspaceRoot, workspace?: LoadedWorkspace): Promise<CacheVersionFingerprint>;
export declare function sameManifestFiles(left: IndexManifestFile[], right: SourceFileFingerprint[] | IndexManifestFile[]): boolean;
export declare function sameManifestStats(left: IndexManifestFile[], right: SourceFileStat[]): boolean;
export declare function hasManifestFormat(value: unknown): value is IndexManifestV2;
//# sourceMappingURL=index-manifest.d.ts.map