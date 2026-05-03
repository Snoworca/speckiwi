import type { Diagnostic, PerfCounters } from "./dto.js";
import { type RequirementRegistry } from "./requirements.js";
import type { GraphType } from "../graph/builder.js";
import { buildGraphFromRegistry } from "../graph/builder.js";
import type { WorkspaceRoot } from "../io/path.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import type { CacheMode } from "./inputs.js";
import type { IndexSectionName } from "../cache/index-manifest.js";
import { type DictionaryExpansion, type SearchIndex } from "../search/index.js";
export type ReadModelLoadStats = PerfCounters & {
    mode: "cache" | "source";
};
type CachedSearchIndex = SearchIndex & {
    dictionary?: DictionaryExpansion;
};
export type ReadModel = {
    readonly root: WorkspaceRoot;
    readonly sections: readonly IndexSectionName[];
    readonly stats: ReadModelLoadStats;
    readonly diagnostics: readonly Diagnostic[];
    getWorkspace(): LoadedWorkspace;
    getRequirementRegistry(): RequirementRegistry;
    getSearchIndex(): CachedSearchIndex;
    buildGraph(graphType?: GraphType): ReturnType<typeof buildGraphFromRegistry>;
};
export type ReadModelCacheKey = {
    root: string;
    cacheMode: CacheMode;
    sourceIntegrityHash: string;
    manifestHash: string;
    artifactIntegrityHash: string;
    sections: string[];
};
type ReadModelMemoStats = {
    hits: number;
    misses: number;
    size: number;
};
export declare function loadReadModel(input: {
    root: string;
    cacheMode?: CacheMode;
    sections: IndexSectionName[];
}): Promise<ReadModel>;
export declare function clearReadModelMemo(root?: string): void;
export declare function getReadModelMemoStats(): ReadModelMemoStats;
export declare function resetReadModelMemoStats(): void;
export declare function createReadModelMemo(): {
    get(key: ReadModelCacheKey, load: () => Promise<ReadModel>): Promise<ReadModel>;
    clear(root?: string): void;
};
export {};
//# sourceMappingURL=read-model.d.ts.map