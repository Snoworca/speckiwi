import type { SearchDocument, DictionaryExpansion } from "../search/document.js";
import { type SearchFieldName } from "../search/tokenizer.js";
export declare const SEARCH_INDEX_V2_FORMAT = "speckiwi/search-index/v2";
export type ExactEntry = {
    index: number;
    field: SearchFieldName;
};
export type Bm25Posting = {
    index: number;
    fieldTokenCounts: Partial<Record<SearchFieldName, number>>;
};
export type SearchFilterBucketName = "entityType" | "documentId" | "scope" | "type" | "status" | "path" | "tag";
export type SerializedBm25Posting = [index: number, fields: Array<[SearchFieldName, number]>] | {
    index: number;
    fields: Array<[SearchFieldName, number]>;
};
export type SearchRuntimeIndexV2 = {
    format: typeof SEARCH_INDEX_V2_FORMAT;
    documents: SearchDocument[];
    exact: Map<string, ExactEntry[]>;
    filterBuckets: Record<SearchFilterBucketName, Map<string, number[]>>;
    postings: Map<string, Bm25Posting[]>;
    documentFrequency: Map<string, number>;
    fieldLengths: Array<Record<SearchFieldName, number>>;
    averageFieldLengths: Record<SearchFieldName, number>;
    dictionary: DictionaryExpansion;
};
export type SearchIndexV2 = {
    format: typeof SEARCH_INDEX_V2_FORMAT;
    documents: SearchDocument[];
    exact: Array<[key: string, entries: ExactEntry[]]>;
    filterBuckets: Record<SearchFilterBucketName, Array<[key: string, indexes: number[]]>>;
    postings: Array<[token: string, postings: SerializedBm25Posting[]]>;
    documentFrequency: Array<[token: string, count: number]>;
    fieldLengths: number[][];
    averageFieldLengths: Record<SearchFieldName, number>;
    dictionary?: DictionaryExpansion;
};
export declare function buildSearchIndexV2(documents: SearchDocument[], dictionary?: DictionaryExpansion): SearchRuntimeIndexV2;
export declare function serializeSearchIndexV2(index: SearchRuntimeIndexV2): SearchIndexV2;
export declare function deserializeSearchIndexV2(value: unknown): SearchRuntimeIndexV2 | undefined;
export declare function exactLookupV2(index: SearchRuntimeIndexV2, query: string): ExactEntry[];
export declare function bm25SearchV2(index: SearchRuntimeIndexV2, queryTokens: string[], allowed: Set<number>, limit: number, offset: number): Array<{
    index: number;
    rawScore: number;
    matchedFields: SearchFieldName[];
}>;
export declare function sortFields(fields: SearchFieldName[]): SearchFieldName[];
//# sourceMappingURL=full-text.d.ts.map