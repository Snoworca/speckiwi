import type { EntityType, PageInfo, SearchResultItem, SearchResultSet } from "../core/dto.js";
import type { SearchInput, SearchFilters } from "../core/inputs.js";
import { ok } from "../core/result.js";
import type { DictionaryExpansion } from "./document.js";
import {
  bm25Search,
  buildSearchIndex as buildBm25SearchIndex,
  deserializeSearchIndex as deserializeBm25SearchIndex,
  exactLookup,
  serializeSearchIndex as serializeBm25SearchIndex,
  sortFields,
  type SearchIndex,
  type SerializedSearchIndex as SerializedBm25SearchIndex
} from "./bm25.js";
import { normalizeExactKey, tokenizeSearchText, type SearchFieldName } from "./tokenizer.js";
import type { SearchRuntimeIndexV2 } from "../indexing/full-text.js";

export { buildDictionaryExpansion, flattenWorkspace, type DictionaryExpansion, type SearchDocument, type ValidWorkspace } from "./document.js";
export { tokenizeKorean } from "./korean.js";
export type { SearchIndex };
export type { SearchIndexV2, SearchRuntimeIndexV2 } from "../indexing/full-text.js";

export type SerializedSearchIndex = SerializedBm25SearchIndex & {
  dictionary?: DictionaryExpansion;
};
export { tokenizeSearchText };

export function buildSearchIndex(documents: Parameters<typeof buildBm25SearchIndex>[0], dictionary: DictionaryExpansion = { groups: [] }): SearchIndex & { dictionary: DictionaryExpansion } {
  return {
    ...buildBm25SearchIndex(documents),
    dictionary
  };
}

export function serializeSearchIndex(index: SearchIndex & { dictionary?: DictionaryExpansion }): SerializedSearchIndex {
  const serialized = serializeBm25SearchIndex(index);
  if (index.dictionary === undefined) {
    return serialized;
  }
  return {
    ...serialized,
    dictionary: {
      groups: index.dictionary.groups.map((group) => [...group])
    }
  };
}

export function deserializeSearchIndex(value: unknown): (SearchIndex & { dictionary?: DictionaryExpansion }) | undefined {
  return deserializeBm25SearchIndex(value);
}

export function search(input: SearchInput, index: SearchIndex & { dictionary?: DictionaryExpansion }): SearchResultSet {
  const mode = input.mode ?? "auto";
  const expandedQueries = expandQuery(input.query, index.dictionary ?? { groups: [] });
  const allowedIndexes = allowedDocumentIndexes(index, input.filters);
  const merged = new Map<string, SearchResultItem>();

  if (mode !== "bm25") {
    for (const query of expandedQueries) {
      for (const entry of exactLookup(index, query)) {
        if (!allowedIndexes.has(entry.index)) {
          continue;
        }
        const document = index.documents[entry.index];
        if (document === undefined) {
          continue;
        }
        mergeResult(merged, toResultItem(document, 1, [entry.field]));
      }
    }
  }

  if (mode !== "exact") {
    const queryTokens = expandedQueries.flatMap((query) => tokenizeSearchText(query));
    const bm25Candidates = bm25Search(index, queryTokens, allowedIndexes);
    const maxRaw = bm25Candidates.reduce((max, candidate) => Math.max(max, candidate.rawScore), 0);
    if (maxRaw > 0) {
      for (const candidate of bm25Candidates) {
        const document = index.documents[candidate.index];
        if (document === undefined) {
          continue;
        }
        mergeResult(merged, toResultItem(document, Math.min((candidate.rawScore / maxRaw) * 0.999, 0.999), candidate.matchedFields));
      }
    }
  }

  const allResults = [...merged.values()].sort(compareResults);
  const limit = normalizeSearchLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  const results = allResults.slice(offset, offset + limit);

  return ok({
    query: input.query,
    mode,
    results,
    page: pageInfo(limit, offset, allResults.length, results.length)
  });
}

function expandQuery(query: string, dictionary: DictionaryExpansion): string[] {
  const values = new Set<string>([query]);
  let changed = true;
  let rounds = 0;

  while (changed && rounds < 10) {
    changed = false;
    rounds += 1;
    const normalizedValues = [...values].map((value) => normalizeForDictionary(value));

    for (const group of dictionary.groups) {
      const normalizedTerms = group.map((term) => normalizeForDictionary(term));
      if (!normalizedTerms.some((term) => normalizedValues.some((value) => value === term || value.includes(term)))) {
        continue;
      }
      for (const term of group) {
        if (!values.has(term)) {
          values.add(term);
          changed = true;
        }
      }
    }
  }

  return [...values].filter((value) => value.trim().length > 0);
}

function normalizeForDictionary(value: string): string {
  return normalizeExactKey(value).replace(/\s+/g, " ");
}

function allowedDocumentIndexes(index: SearchIndex, filters: SearchFilters | undefined): Set<number> {
  const v2 = index as SearchRuntimeIndexV2;
  if (filters === undefined || v2.filterBuckets === undefined) {
    return new Set(index.documents.map((_, documentIndex) => documentIndex));
  }

  const buckets: Array<Set<number>> = [];
  addFilterBucket(v2, buckets, "entityType", filters.entityType);
  addFilterBucket(v2, buckets, "documentId", filters.documentId);
  addFilterBucket(v2, buckets, "scope", filters.scope);
  addFilterBucket(v2, buckets, "type", filters.type);
  addFilterBucket(v2, buckets, "status", filters.status);
  addFilterBucket(v2, buckets, "path", filters.path);
  addFilterBucket(v2, buckets, "tag", filters.tag);

  if (buckets.length === 0) {
    return new Set(index.documents.map((_, documentIndex) => documentIndex));
  }

  buckets.sort((left, right) => left.size - right.size);
  const [first, ...rest] = buckets;
  const allowed = new Set(first);
  for (const bucket of rest) {
    for (const candidate of [...allowed]) {
      if (!bucket.has(candidate)) {
        allowed.delete(candidate);
      }
    }
  }
  return allowed;
}

function addFilterBucket(
  index: SearchRuntimeIndexV2,
  buckets: Array<Set<number>>,
  bucketName: "entityType" | "documentId" | "scope" | "type" | "status" | "path" | "tag",
  filter: string | string[] | EntityType | EntityType[] | undefined
): void {
  if (filter === undefined) {
    return;
  }
  const values = Array.isArray(filter) ? filter : [filter];
  const bucket = new Set<number>();
  for (const value of values) {
    for (const entry of index.filterBuckets[bucketName].get(value as string) ?? []) {
      bucket.add(entry);
    }
  }
  buckets.push(bucket);
}

function toResultItem(document: SearchIndex["documents"][number], score: number, matchedFields: SearchFieldName[]): SearchResultItem {
  const item: SearchResultItem = {
    entityType: document.entityType,
    id: document.id,
    score,
    matchedFields: sortFields(matchedFields),
    path: document.path
  };
  if (document.documentId !== undefined) {
    item.documentId = document.documentId;
  }
  if (document.scope !== undefined) {
    item.scope = document.scope;
  }
  if (document.title !== undefined) {
    item.title = document.title;
  }
  return item;
}

function mergeResult(results: Map<string, SearchResultItem>, item: SearchResultItem): void {
  const key = `${item.entityType}\0${item.id}`;
  const existing = results.get(key);
  if (existing === undefined) {
    results.set(key, item);
    return;
  }

  existing.score = Math.max(existing.score, item.score);
  existing.matchedFields = sortFields([...existing.matchedFields, ...item.matchedFields] as SearchFieldName[]);
}

function compareResults(left: SearchResultItem, right: SearchResultItem): number {
  return (
    right.score - left.score ||
    entityPriority(left.entityType) - entityPriority(right.entityType) ||
    left.id.localeCompare(right.id) ||
    (left.documentId ?? "").localeCompare(right.documentId ?? "") ||
    left.path.localeCompare(right.path)
  );
}

function entityPriority(entityType: EntityType): number {
  return ["requirement", "document", "scope", "prd_item", "technical_section", "adr", "rule"].indexOf(entityType);
}

function normalizeSearchLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(Math.trunc(value), 0);
}

function pageInfo(limit: number, offset: number, total: number, returned: number): PageInfo {
  return {
    limit,
    offset,
    returned,
    total,
    hasMore: offset + returned < total,
    nextOffset: offset + returned < total ? offset + returned : null
  };
}
