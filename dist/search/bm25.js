import { buildSearchIndexV2, bm25SearchV2, deserializeSearchIndexV2, exactLookupV2, serializeSearchIndexV2, sortFields } from "../indexing/full-text.js";
export const buildSearchIndex = buildSearchIndexV2;
export const serializeSearchIndex = serializeSearchIndexV2;
export const deserializeSearchIndex = deserializeSearchIndexV2;
export const exactLookup = exactLookupV2;
export const bm25Search = (index, queryTokens, allowedIndexes) => bm25SearchV2(index, queryTokens, allowedIndexes, allowedIndexes.size, 0);
export { sortFields };
//# sourceMappingURL=bm25.js.map