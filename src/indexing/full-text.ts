import type { SearchDocument, DictionaryExpansion } from "../search/document.js";
import { fieldBoosts, normalizeExactKey, searchFieldOrder, tokenizeFieldValues, type SearchFieldName } from "../search/tokenizer.js";

export const SEARCH_INDEX_V2_FORMAT = "speckiwi/search-index/v2";

export type ExactEntry = {
  index: number;
  field: SearchFieldName;
};

export type Bm25Posting = {
  index: number;
  fieldTokenCounts: Partial<Record<SearchFieldName, number>>;
};

export type SearchFilterBucketName = "entityType" | "documentId" | "scope" | "type" | "status" | "path" | "tag";
export type SerializedBm25Posting = [index: number, fields: Array<[SearchFieldName, number]>] | { index: number; fields: Array<[SearchFieldName, number]> };

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

type IndexedDocument = {
  fieldTokenCounts: Record<SearchFieldName, Map<string, number>>;
  fieldLengths: Record<SearchFieldName, number>;
};

export function buildSearchIndexV2(
  documents: SearchDocument[],
  dictionary: DictionaryExpansion = { groups: [] }
): SearchRuntimeIndexV2 {
  const indexedDocuments = documents.map((document) => buildIndexedDocument(document));
  const exact = buildExactIndex(documents);
  const filterBuckets = buildFilterBuckets(documents);
  const postings = buildPostings(indexedDocuments);
  const documentFrequency = new Map([...postings.entries()].map(([token, values]) => [token, values.length]));
  const fieldLengths = indexedDocuments.map((document) => document.fieldLengths);
  const averageFieldLengths = buildAverageFieldLengths(fieldLengths);
  const storedDocuments = documents.map(compactSearchDocument);

  return {
    format: SEARCH_INDEX_V2_FORMAT,
    documents: storedDocuments,
    exact,
    filterBuckets,
    postings,
    documentFrequency,
    fieldLengths,
    averageFieldLengths,
    dictionary: { groups: dictionary.groups.map((group) => [...group]) }
  };
}

function compactSearchDocument(document: SearchDocument): SearchDocument {
  const compact: SearchDocument = {
    entityType: document.entityType,
    id: document.id,
    path: document.path,
    fields: {},
    filters: {
      entityType: document.entityType,
      path: document.path,
      tags: []
    }
  };
  if (document.documentId !== undefined) {
    compact.documentId = document.documentId;
  }
  if (document.scope !== undefined) {
    compact.scope = document.scope;
  }
  if (document.title !== undefined) {
    compact.title = document.title;
  }
  return compact;
}

export function serializeSearchIndexV2(index: SearchRuntimeIndexV2): SearchIndexV2 {
  return {
    format: SEARCH_INDEX_V2_FORMAT,
    documents: index.documents,
    exact: [...index.exact.entries()].map(([key, entries]) => [key, entries.map((entry) => ({ ...entry }))]),
    filterBuckets: {
      entityType: serializeBucketMap(index.filterBuckets.entityType),
      documentId: serializeBucketMap(index.filterBuckets.documentId),
      scope: serializeBucketMap(index.filterBuckets.scope),
      type: serializeBucketMap(index.filterBuckets.type),
      status: serializeBucketMap(index.filterBuckets.status),
      path: serializeBucketMap(index.filterBuckets.path),
      tag: serializeBucketMap(index.filterBuckets.tag)
    },
    postings: [...index.postings.entries()].map(([token, postings]) => [
      token,
      postings.map((posting) => [
        posting.index,
        searchFieldOrder
          .map((field) => [field, posting.fieldTokenCounts[field] ?? 0] as [SearchFieldName, number])
          .filter(([, count]) => count > 0)
      ])
    ]),
    documentFrequency: [...index.documentFrequency.entries()],
    fieldLengths: index.fieldLengths.map((lengths) => searchFieldOrder.map((field) => lengths[field] ?? 0)),
    averageFieldLengths: { ...index.averageFieldLengths },
    dictionary: { groups: index.dictionary.groups.map((group) => [...group]) }
  };
}

export function deserializeSearchIndexV2(value: unknown): SearchRuntimeIndexV2 | undefined {
  const object = objectValue(value);
  if (object?.format === SEARCH_INDEX_V2_FORMAT) {
    return deserializeSearchIndexV2Exact(object);
  }
  const legacy = legacySearchIndexValue(value);
  if (legacy === undefined) {
    return undefined;
  }
  return buildSearchIndexV2(legacy.documents, legacy.dictionary ?? { groups: [] });
}

export function exactLookupV2(index: SearchRuntimeIndexV2, query: string): ExactEntry[] {
  return index.exact.get(normalizeExactKey(query)) ?? [];
}

export function bm25SearchV2(
  index: SearchRuntimeIndexV2,
  queryTokens: string[],
  allowed: Set<number>,
  limit: number,
  offset: number
): Array<{ index: number; rawScore: number; matchedFields: SearchFieldName[] }> {
  if (queryTokens.length === 0 || allowed.size === 0) {
    return [];
  }

  const scores = new Map<number, { rawScore: number; matchedFields: Set<SearchFieldName> }>();
  for (const token of [...new Set(queryTokens)]) {
    const postings = index.postings.get(token);
    const frequency = index.documentFrequency.get(token) ?? 0;
    if (postings === undefined || frequency === 0) {
      continue;
    }
    const idf = Math.log(1 + (index.documents.length - frequency + 0.5) / (frequency + 0.5));
    for (const posting of postings) {
      if (!allowed.has(posting.index)) {
        continue;
      }
      const score = scores.get(posting.index) ?? { rawScore: 0, matchedFields: new Set<SearchFieldName>() };
      for (const field of searchFieldOrder) {
        const count = posting.fieldTokenCounts[field] ?? 0;
        if (count === 0) {
          continue;
        }
        score.matchedFields.add(field);
        const length = index.fieldLengths[posting.index]?.[field] ?? 0;
        const averageLength = Math.max(index.averageFieldLengths[field], 1);
        const denominator = count + 1.2 * (1 - 0.75 + 0.75 * (length / averageLength));
        score.rawScore += idf * ((count * 2.2) / denominator) * fieldBoosts[field];
      }
      scores.set(posting.index, score);
    }
  }

  return [...scores.entries()]
    .map(([entryIndex, score]) => ({
      index: entryIndex,
      rawScore: score.rawScore,
      matchedFields: sortFields([...score.matchedFields])
    }))
    .filter((candidate) => candidate.rawScore > 0)
    .sort((left, right) => right.rawScore - left.rawScore || left.index - right.index)
    .slice(0, Math.max(limit + offset, limit));
}

export function sortFields(fields: SearchFieldName[]): SearchFieldName[] {
  const unique = [...new Set(fields)];
  return unique.sort((left, right) => searchFieldOrder.indexOf(left) - searchFieldOrder.indexOf(right));
}

function buildIndexedDocument(document: SearchDocument): IndexedDocument {
  const fieldTokenCounts = Object.fromEntries(
    searchFieldOrder.map((field) => {
      const tokens = tokenizeFieldValues(fieldValues(document, field));
      return [field, tokenCounts(tokens)];
    })
  ) as Record<SearchFieldName, Map<string, number>>;
  const fieldLengths = Object.fromEntries(
    searchFieldOrder.map((field) => [field, [...fieldTokenCounts[field].values()].reduce((sum, count) => sum + count, 0)])
  ) as Record<SearchFieldName, number>;
  return { fieldTokenCounts, fieldLengths };
}

function fieldValues(document: SearchDocument, field: SearchFieldName): string[] {
  if (field === "path") {
    return [document.path];
  }
  const value = document.fields[field];
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function buildExactIndex(documents: SearchDocument[]): Map<string, ExactEntry[]> {
  const exact = new Map<string, ExactEntry[]>();
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    if (document === undefined) {
      continue;
    }
    addExact(exact, document.id, index, "id");
    addExact(exact, document.path, index, "path");
    addExact(exact, document.path.replace(/^\.speckiwi\//, ""), index, "path");
    if (document.title !== undefined) {
      addExact(exact, document.title, index, "title");
    }
    if (document.documentId !== undefined) {
      addExact(exact, document.documentId, index, "id");
    }
    if (document.scope !== undefined) {
      addExact(exact, document.scope, index, "scope");
    }
  }
  return exact;
}

function addExact(exact: Map<string, ExactEntry[]>, value: string, index: number, field: SearchFieldName): void {
  const key = normalizeExactKey(value);
  const entries = exact.get(key) ?? [];
  if (!entries.some((entry) => entry.index === index && entry.field === field)) {
    entries.push({ index, field });
  }
  exact.set(key, entries);
}

function buildFilterBuckets(documents: SearchDocument[]): Record<SearchFilterBucketName, Map<string, number[]>> {
  const buckets = {
    entityType: new Map<string, number[]>(),
    documentId: new Map<string, number[]>(),
    scope: new Map<string, number[]>(),
    type: new Map<string, number[]>(),
    status: new Map<string, number[]>(),
    path: new Map<string, number[]>(),
    tag: new Map<string, number[]>()
  } satisfies Record<SearchFilterBucketName, Map<string, number[]>>;

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    if (document === undefined) {
      continue;
    }
    addBucketValue(buckets.entityType, document.entityType, index);
    addBucketValue(buckets.path, document.path, index);
    if (document.documentId !== undefined) {
      addBucketValue(buckets.documentId, document.documentId, index);
    }
    if (document.scope !== undefined) {
      addBucketValue(buckets.scope, document.scope, index);
    }
    if (document.filters.type !== undefined) {
      addBucketValue(buckets.type, document.filters.type, index);
    }
    if (document.filters.status !== undefined) {
      addBucketValue(buckets.status, document.filters.status, index);
    }
    for (const tag of document.filters.tags) {
      addBucketValue(buckets.tag, tag, index);
    }
  }

  return buckets;
}

function addBucketValue(bucket: Map<string, number[]>, value: string, index: number): void {
  const indexes = bucket.get(value) ?? [];
  if (indexes[indexes.length - 1] !== index) {
    indexes.push(index);
  }
  bucket.set(value, indexes);
}

function buildPostings(indexedDocuments: IndexedDocument[]): Map<string, Bm25Posting[]> {
  const postings = new Map<string, Bm25Posting[]>();
  indexedDocuments.forEach((document, index) => {
    const fieldsByToken = new Map<string, Partial<Record<SearchFieldName, number>>>();
    for (const field of searchFieldOrder) {
      for (const [token, count] of document.fieldTokenCounts[field].entries()) {
        const fields = fieldsByToken.get(token) ?? {};
        fields[field] = count;
        fieldsByToken.set(token, fields);
      }
    }
    for (const [token, fields] of fieldsByToken.entries()) {
      const bucket = postings.get(token) ?? [];
      bucket.push({ index, fieldTokenCounts: fields });
      postings.set(token, bucket);
    }
  });
  return postings;
}

function buildAverageFieldLengths(fieldLengths: Array<Record<SearchFieldName, number>>): Record<SearchFieldName, number> {
  const averages = {} as Record<SearchFieldName, number>;
  for (const field of searchFieldOrder) {
    const total = fieldLengths.reduce((sum, lengths) => sum + lengths[field], 0);
    averages[field] = fieldLengths.length === 0 ? 0 : total / fieldLengths.length;
  }
  return averages;
}

function tokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function serializeBucketMap(bucket: Map<string, number[]>): Array<[string, number[]]> {
  return [...bucket.entries()].map(([key, indexes]) => [key, [...indexes]]);
}

function deserializeSearchIndexV2Exact(index: Record<string, unknown>): SearchRuntimeIndexV2 | undefined {
  const averageFieldLengths = fieldLengthsRecord(index.averageFieldLengths);
  if (
    !Array.isArray(index.documents) ||
    !entryArray(index.exact) ||
    !bucketObjectValue(index.filterBuckets) ||
    !postingArray(index.postings) ||
    !numberEntryArray(index.documentFrequency) ||
    !searchFieldLengthsArray(index.fieldLengths) ||
    averageFieldLengths === undefined
  ) {
    return undefined;
  }
  const dictionary = dictionaryValue(index.dictionary);
  if (index.dictionary !== undefined && dictionary === undefined) {
    return undefined;
  }
  return {
    format: SEARCH_INDEX_V2_FORMAT,
    documents: index.documents as SearchDocument[],
    exact: new Map(index.exact.map(([key, entries]) => [key, entries.map((entry) => ({ ...entry }))])),
    filterBuckets: {
      entityType: new Map(index.filterBuckets.entityType.map(([key, indexes]) => [key, [...indexes]])),
      documentId: new Map(index.filterBuckets.documentId.map(([key, indexes]) => [key, [...indexes]])),
      scope: new Map(index.filterBuckets.scope.map(([key, indexes]) => [key, [...indexes]])),
      type: new Map(index.filterBuckets.type.map(([key, indexes]) => [key, [...indexes]])),
      status: new Map(index.filterBuckets.status.map(([key, indexes]) => [key, [...indexes]])),
      path: new Map(index.filterBuckets.path.map(([key, indexes]) => [key, [...indexes]])),
      tag: new Map(index.filterBuckets.tag.map(([key, indexes]) => [key, [...indexes]]))
    },
    postings: new Map(
      index.postings.map(([token, postings]) => [
        token,
        postings.map((posting) => ({
          index: postingIndex(posting),
          fieldTokenCounts: Object.fromEntries(postingFields(posting)) as Partial<Record<SearchFieldName, number>>
        }))
      ])
    ),
    documentFrequency: new Map(index.documentFrequency),
    fieldLengths: index.fieldLengths.map((lengths) => fieldLengthsRecord(lengths)).filter((lengths): lengths is Record<SearchFieldName, number> => lengths !== undefined),
    averageFieldLengths,
    dictionary: dictionary ?? { groups: [] }
  };
}

function legacySearchIndexValue(value: unknown): { documents: SearchDocument[]; dictionary?: DictionaryExpansion } | undefined {
  const object = objectValue(value);
  if (object === undefined || !Array.isArray(object.documents)) {
    return undefined;
  }
  const dictionary = dictionaryValue(object.dictionary);
  if (object.dictionary !== undefined && dictionary === undefined) {
    return undefined;
  }
  return {
    documents: object.documents as SearchDocument[],
    ...(dictionary === undefined ? {} : { dictionary })
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function dictionaryValue(value: unknown): DictionaryExpansion | undefined {
  const dictionary = objectValue(value);
  if (
    dictionary === undefined ||
    !Array.isArray(dictionary.groups) ||
    !dictionary.groups.every((group) => Array.isArray(group) && group.every((item) => typeof item === "string"))
  ) {
    return undefined;
  }
  return { groups: dictionary.groups.map((group) => [...group]) };
}

function entryArray(value: unknown): value is Array<[string, ExactEntry[]]> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === "string" &&
        Array.isArray(item[1]) &&
        item[1].every((entry) => typeof entry?.index === "number" && searchFieldOrder.includes(entry.field))
    )
  );
}

function bucketObjectValue(value: unknown): value is Record<SearchFilterBucketName, Array<[string, number[]]>> {
  const object = objectValue(value);
  return (
    object !== undefined &&
    bucketEntryArray(object.entityType) &&
    bucketEntryArray(object.documentId) &&
    bucketEntryArray(object.scope) &&
    bucketEntryArray(object.type) &&
    bucketEntryArray(object.status) &&
    bucketEntryArray(object.path) &&
    bucketEntryArray(object.tag)
  );
}

function bucketEntryArray(value: unknown): value is Array<[string, number[]]> {
  return Array.isArray(value) && value.every((item) => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && numberArray(item[1]));
}

function postingArray(value: unknown): value is SearchIndexV2["postings"] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === "string" &&
        Array.isArray(item[1]) &&
        item[1].every(serializedPostingValue)
    )
  );
}

function numberEntryArray(value: unknown): value is Array<[string, number]> {
  return Array.isArray(value) && value.every((item) => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && typeof item[1] === "number");
}

function numberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function searchFieldLengthsArray(value: unknown): value is SearchIndexV2["fieldLengths"] | Array<Record<SearchFieldName, number>> {
  return Array.isArray(value) && value.every((item) => searchFieldLengthsValue(item));
}

function searchFieldLengthsValue(value: unknown): boolean {
  return fieldLengthsRecord(value) !== undefined;
}

function fieldLengthsRecord(value: unknown): Record<SearchFieldName, number> | undefined {
  if (Array.isArray(value)) {
    if (value.length !== searchFieldOrder.length || !value.every((item) => typeof item === "number")) {
      return undefined;
    }
    return Object.fromEntries(searchFieldOrder.map((field, index) => [field, value[index] ?? 0])) as Record<SearchFieldName, number>;
  }
  const object = objectValue(value);
  return object !== undefined && searchFieldOrder.every((field) => typeof object[field] === "number")
    ? (object as Record<SearchFieldName, number>)
    : undefined;
}

function serializedPostingValue(value: unknown): value is SerializedBm25Posting {
  if (Array.isArray(value)) {
    return value.length === 2 && typeof value[0] === "number" && postingFieldsValue(value[1]);
  }
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { index?: unknown }).index === "number" &&
    postingFieldsValue((value as { fields?: unknown }).fields)
  );
}

function postingIndex(posting: SerializedBm25Posting): number {
  return Array.isArray(posting) ? posting[0] : posting.index;
}

function postingFields(posting: SerializedBm25Posting): Array<[SearchFieldName, number]> {
  return Array.isArray(posting) ? posting[1] : posting.fields;
}

function postingFieldsValue(value: unknown): value is Array<[SearchFieldName, number]> {
  return (
    Array.isArray(value) &&
    value.every(
      (field) =>
        Array.isArray(field) &&
        field.length === 2 &&
        searchFieldOrder.includes(field[0] as SearchFieldName) &&
        typeof field[1] === "number"
    )
  );
}
