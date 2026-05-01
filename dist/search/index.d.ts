import type { SearchResultSet } from "../core/dto.js";
import type { SearchInput } from "../core/inputs.js";
import type { DictionaryExpansion } from "./document.js";
import { buildSearchIndex as buildBm25SearchIndex, type SearchIndex, type SerializedSearchIndex as SerializedBm25SearchIndex } from "./bm25.js";
import { tokenizeSearchText } from "./tokenizer.js";
export { buildDictionaryExpansion, flattenWorkspace, type DictionaryExpansion, type SearchDocument, type ValidWorkspace } from "./document.js";
export { tokenizeKorean } from "./korean.js";
export type { SearchIndex };
export type SerializedSearchIndex = SerializedBm25SearchIndex & {
    dictionary?: DictionaryExpansion;
};
export { tokenizeSearchText };
export declare function buildSearchIndex(documents: Parameters<typeof buildBm25SearchIndex>[0], dictionary?: DictionaryExpansion): SearchIndex & {
    dictionary: DictionaryExpansion;
};
export declare function serializeSearchIndex(index: SearchIndex & {
    dictionary?: DictionaryExpansion;
}): SerializedSearchIndex;
export declare function deserializeSearchIndex(value: unknown): (SearchIndex & {
    dictionary?: DictionaryExpansion;
}) | undefined;
export declare function search(input: SearchInput, index: SearchIndex & {
    dictionary?: DictionaryExpansion;
}): SearchResultSet;
//# sourceMappingURL=index.d.ts.map