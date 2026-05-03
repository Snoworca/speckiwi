import type { SearchFieldName } from "./tokenizer.js";
import {
  buildSearchIndexV2,
  bm25SearchV2,
  deserializeSearchIndexV2,
  exactLookupV2,
  serializeSearchIndexV2,
  sortFields,
  type ExactEntry,
  type SearchIndexV2 as SerializedSearchIndex,
  type SearchRuntimeIndexV2 as SearchIndex
} from "../indexing/full-text.js";

export type Bm25Candidate = {
  index: number;
  rawScore: number;
  matchedFields: SearchFieldName[];
};

export const buildSearchIndex = buildSearchIndexV2;
export const serializeSearchIndex = serializeSearchIndexV2;
export const deserializeSearchIndex = deserializeSearchIndexV2;
export const exactLookup = exactLookupV2;
export const bm25Search = (index: SearchIndex, queryTokens: string[], allowedIndexes: Set<number>): Bm25Candidate[] =>
  bm25SearchV2(index, queryTokens, allowedIndexes, allowedIndexes.size, 0);

export { sortFields };
export type { ExactEntry, SearchIndex, SerializedSearchIndex };
