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
import { normalizeExactKey, searchFieldOrder, tokenizeSearchText, type SearchFieldName } from "./tokenizer.js";

export { buildDictionaryExpansion, flattenWorkspace, type DictionaryExpansion, type SearchDocument, type ValidWorkspace } from "./document.js";
export { tokenizeKorean } from "./korean.js";
export type { SearchIndex };

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
  const serialized = serializedSearchIndexValue(value);
  if (serialized === undefined) {
    return undefined;
  }

  const index = deserializeBm25SearchIndex({ documents: serialized.documents });
  if (serialized.dictionary === undefined) {
    return index;
  }
  return {
    ...index,
    dictionary: serialized.dictionary
  };
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
  const allowed = new Set<number>();
  for (let documentIndex = 0; documentIndex < index.documents.length; documentIndex += 1) {
    const document = index.documents[documentIndex];
    if (document !== undefined && matchesFilters(document, filters)) {
      allowed.add(documentIndex);
    }
  }
  return allowed;
}

function matchesFilters(document: SearchIndex["documents"][number], filters: SearchFilters | undefined): boolean {
  if (filters === undefined) {
    return true;
  }

  return (
    matchesFilter(document.entityType, filters.entityType) &&
    matchesFilter(document.documentId, filters.documentId) &&
    matchesFilter(document.scope, filters.scope) &&
    matchesFilter(document.filters.type, filters.type) &&
    matchesFilter(document.filters.status, filters.status) &&
    matchesFilter(document.path, filters.path) &&
    matchesTagFilter(document.filters.tags, filters.tag)
  );
}

function matchesFilter(value: string | undefined, filter: string | string[] | EntityType | EntityType[] | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  const values = Array.isArray(filter) ? filter : [filter];
  return value !== undefined && values.includes(value as EntityType);
}

function matchesTagFilter(tags: string[], filter: string | string[] | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  const values = Array.isArray(filter) ? filter : [filter];
  return values.some((value) => tags.includes(value));
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

function serializedSearchIndexValue(value: unknown): SerializedSearchIndex | undefined {
  const object = objectValue(value);
  if (object === undefined || !Array.isArray(object.documents)) {
    return undefined;
  }

  const documents = object.documents.map(searchDocumentValue);
  if (documents.some((document) => document === undefined)) {
    return undefined;
  }

  const dictionary = dictionaryExpansionValue(object.dictionary);
  if (object.dictionary !== undefined && dictionary === undefined) {
    return undefined;
  }

  const serialized: SerializedSearchIndex = {
    documents: documents as SerializedSearchIndex["documents"]
  };
  if (dictionary !== undefined) {
    serialized.dictionary = dictionary;
  }
  return serialized;
}

function searchDocumentValue(value: unknown): SerializedSearchIndex["documents"][number] | undefined {
  const object = objectValue(value);
  if (object === undefined) {
    return undefined;
  }

  const entityType = entityTypeValue(object.entityType);
  const fields = searchFieldsValue(object.fields);
  const filters = searchFiltersValue(object.filters, entityType, stringValue(object.path));
  if (entityType === undefined || typeof object.id !== "string" || typeof object.path !== "string" || fields === undefined || filters === undefined) {
    return undefined;
  }

  const document: SerializedSearchIndex["documents"][number] = {
    entityType,
    id: object.id,
    path: object.path,
    fields,
    filters
  };
  for (const key of ["documentId", "scope", "title"] as const) {
    const value = object[key];
    if (value !== undefined) {
      if (typeof value !== "string") {
        return undefined;
      }
      document[key] = value;
    }
  }
  return document;
}

function searchFieldsValue(value: unknown): SerializedSearchIndex["documents"][number]["fields"] | undefined {
  const object = objectValue(value);
  if (object === undefined) {
    return undefined;
  }

  const fields: SerializedSearchIndex["documents"][number]["fields"] = {};
  for (const [key, raw] of Object.entries(object)) {
    if (!isSearchFieldName(key)) {
      return undefined;
    }
    if (typeof raw === "string") {
      fields[key] = raw;
      continue;
    }
    const values = stringArray(raw);
    if (values === undefined) {
      return undefined;
    }
    fields[key] = values;
  }
  return fields;
}

function searchFiltersValue(
  value: unknown,
  documentEntityType: SerializedSearchIndex["documents"][number]["entityType"] | undefined,
  documentPath: string | undefined
): SerializedSearchIndex["documents"][number]["filters"] | undefined {
  const object = objectValue(value);
  const entityType = entityTypeValue(object?.entityType);
  const tags = stringArray(object?.tags);
  if (object === undefined || entityType === undefined || tags === undefined || typeof object.path !== "string") {
    return undefined;
  }
  if (documentEntityType !== undefined && entityType !== documentEntityType) {
    return undefined;
  }
  if (documentPath !== undefined && object.path !== documentPath) {
    return undefined;
  }

  const filters: SerializedSearchIndex["documents"][number]["filters"] = {
    entityType,
    path: object.path,
    tags
  };
  for (const key of ["documentId", "scope", "type", "status"] as const) {
    const value = object[key];
    if (value !== undefined) {
      if (typeof value !== "string") {
        return undefined;
      }
      filters[key] = value;
    }
  }
  return filters;
}

function dictionaryExpansionValue(value: unknown): DictionaryExpansion | undefined {
  if (value === undefined) {
    return undefined;
  }
  const object = objectValue(value);
  if (object === undefined || !Array.isArray(object.groups)) {
    return undefined;
  }
  const groups = object.groups.map(stringArray);
  return groups.some((group) => group === undefined) ? undefined : { groups: groups as string[][] };
}

function entityTypeValue(value: unknown): EntityType | undefined {
  return value === "document" ||
    value === "scope" ||
    value === "requirement" ||
    value === "prd_item" ||
    value === "technical_section" ||
    value === "adr" ||
    value === "rule"
    ? value
    : undefined;
}

function isSearchFieldName(value: string): value is SearchFieldName {
  return (searchFieldOrder as readonly string[]).includes(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
