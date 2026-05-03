import type { SearchInput } from "./inputs.js";
import type { SearchResultSet, Diagnostic } from "./dto.js";
import { type DictionaryExpansion, type SearchDocument } from "../search/index.js";
import { type ReadModel } from "./read-model.js";
export type SearchSourceAudit = {
    documents: readonly SearchDocument[];
    dictionary: DictionaryExpansion;
};
export type SearchReadModelOptions = {
    extraWarnings?: readonly Diagnostic[];
    sourceDocuments?: readonly SearchDocument[];
    sourceDictionary?: DictionaryExpansion;
    sourceAudit?: SearchSourceAudit;
};
export declare function searchWorkspace(input: SearchInput): Promise<SearchResultSet>;
export declare function searchWorkspaceFromReadModel(input: SearchInput, model: ReadModel, options?: SearchReadModelOptions | readonly Diagnostic[]): SearchResultSet;
export declare function rehydrateSearchResultsFromSource(result: SearchResultSet, sourceDocuments: readonly SearchDocument[], queries?: readonly string[]): {
    result: SearchResultSet;
    mismatchCount: number;
};
//# sourceMappingURL=search.d.ts.map