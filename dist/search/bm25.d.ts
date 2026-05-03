import type { SearchFieldName } from "./tokenizer.js";
import { buildSearchIndexV2, deserializeSearchIndexV2, exactLookupV2, serializeSearchIndexV2, sortFields, type ExactEntry, type SearchIndexV2 as SerializedSearchIndex, type SearchRuntimeIndexV2 as SearchIndex } from "../indexing/full-text.js";
export type Bm25Candidate = {
    index: number;
    rawScore: number;
    matchedFields: SearchFieldName[];
};
export declare const buildSearchIndex: typeof buildSearchIndexV2;
export declare const serializeSearchIndex: typeof serializeSearchIndexV2;
export declare const deserializeSearchIndex: typeof deserializeSearchIndexV2;
export declare const exactLookup: typeof exactLookupV2;
export declare const bm25Search: (index: SearchIndex, queryTokens: string[], allowedIndexes: Set<number>) => Bm25Candidate[];
export { sortFields };
export type { ExactEntry, SearchIndex, SerializedSearchIndex };
//# sourceMappingURL=bm25.d.ts.map