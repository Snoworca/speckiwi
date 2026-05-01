import type { SearchDocument } from "./document.js";
import { type SearchFieldName } from "./tokenizer.js";
export type SearchIndex = {
    documents: SearchDocument[];
    exact: Map<string, ExactEntry[]>;
    indexedDocuments: IndexedDocument[];
    documentFrequency: Map<string, number>;
    averageFieldLengths: Record<SearchFieldName, number>;
};
export type SerializedSearchIndex = {
    documents: SearchDocument[];
};
export type ExactEntry = {
    index: number;
    field: SearchFieldName;
};
export type Bm25Candidate = {
    index: number;
    rawScore: number;
    matchedFields: SearchFieldName[];
};
type IndexedDocument = {
    document: SearchDocument;
    fieldTokens: Record<SearchFieldName, string[]>;
    fieldTokenCounts: Record<SearchFieldName, Map<string, number>>;
};
export declare function buildSearchIndex(documents: SearchDocument[]): SearchIndex;
export declare function serializeSearchIndex(index: SearchIndex): SerializedSearchIndex;
export declare function deserializeSearchIndex(serialized: SerializedSearchIndex): SearchIndex;
export declare function exactLookup(index: SearchIndex, query: string): ExactEntry[];
export declare function bm25Search(index: SearchIndex, queryTokens: string[], allowedIndexes: Set<number>): Bm25Candidate[];
export declare function sortFields(fields: SearchFieldName[]): SearchFieldName[];
export {};
//# sourceMappingURL=bm25.d.ts.map