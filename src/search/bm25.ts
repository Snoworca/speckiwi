import type { SearchDocument } from "./document.js";
import { fieldBoosts, normalizeExactKey, searchFieldOrder, tokenizeFieldValues, type SearchFieldName } from "./tokenizer.js";

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

const k1 = 1.2;
const b = 0.75;

export function buildSearchIndex(documents: SearchDocument[]): SearchIndex {
  const indexedDocuments = documents.map((document) => buildIndexedDocument(document));
  const exact = buildExactIndex(documents);
  const documentFrequency = buildDocumentFrequency(indexedDocuments);
  const averageFieldLengths = buildAverageFieldLengths(indexedDocuments);

  return {
    documents,
    exact,
    indexedDocuments,
    documentFrequency,
    averageFieldLengths
  };
}

export function serializeSearchIndex(index: SearchIndex): SerializedSearchIndex {
  return {
    documents: index.documents
  };
}

export function deserializeSearchIndex(serialized: SerializedSearchIndex): SearchIndex {
  return buildSearchIndex(serialized.documents);
}

export function exactLookup(index: SearchIndex, query: string): ExactEntry[] {
  return index.exact.get(normalizeExactKey(query)) ?? [];
}

export function bm25Search(index: SearchIndex, queryTokens: string[], allowedIndexes: Set<number>): Bm25Candidate[] {
  if (queryTokens.length === 0) {
    return [];
  }

  const candidates: Bm25Candidate[] = [];
  const uniqueQueryTokens = [...new Set(queryTokens)];

  for (let docIndex = 0; docIndex < index.indexedDocuments.length; docIndex += 1) {
    if (!allowedIndexes.has(docIndex)) {
      continue;
    }

    const indexed = index.indexedDocuments[docIndex];
    if (indexed === undefined) {
      continue;
    }

    let rawScore = 0;
    const matchedFields = new Set<SearchFieldName>();

    for (const token of uniqueQueryTokens) {
      const idf = inverseDocumentFrequency(index, token);
      if (idf <= 0) {
        continue;
      }

      for (const field of searchFieldOrder) {
        const count = indexed.fieldTokenCounts[field].get(token) ?? 0;
        if (count === 0) {
          continue;
        }

        matchedFields.add(field);
        const length = indexed.fieldTokens[field].length;
        const averageLength = Math.max(index.averageFieldLengths[field], 1);
        const denominator = count + k1 * (1 - b + b * (length / averageLength));
        rawScore += idf * ((count * (k1 + 1)) / denominator) * fieldBoosts[field];
      }
    }

    if (rawScore > 0) {
      candidates.push({
        index: docIndex,
        rawScore,
        matchedFields: sortFields([...matchedFields])
      });
    }
  }

  return candidates;
}

export function sortFields(fields: SearchFieldName[]): SearchFieldName[] {
  const unique = [...new Set(fields)];
  return unique.sort((left, right) => searchFieldOrder.indexOf(left) - searchFieldOrder.indexOf(right));
}

function buildIndexedDocument(document: SearchDocument): IndexedDocument {
  const fieldTokens = Object.fromEntries(
    searchFieldOrder.map((field) => [field, tokenizeFieldValues(fieldValues(document, field))])
  ) as Record<SearchFieldName, string[]>;
  const fieldTokenCounts = Object.fromEntries(
    searchFieldOrder.map((field) => [field, tokenCounts(fieldTokens[field])])
  ) as Record<SearchFieldName, Map<string, number>>;

  return {
    document,
    fieldTokens,
    fieldTokenCounts
  };
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

function buildDocumentFrequency(indexedDocuments: IndexedDocument[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const document of indexedDocuments) {
    const tokens = new Set<string>();
    for (const field of searchFieldOrder) {
      for (const token of document.fieldTokens[field]) {
        tokens.add(token);
      }
    }
    for (const token of tokens) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  return frequency;
}

function buildAverageFieldLengths(indexedDocuments: IndexedDocument[]): Record<SearchFieldName, number> {
  const averages = {} as Record<SearchFieldName, number>;
  for (const field of searchFieldOrder) {
    const total = indexedDocuments.reduce((sum, document) => sum + document.fieldTokens[field].length, 0);
    averages[field] = indexedDocuments.length === 0 ? 0 : total / indexedDocuments.length;
  }
  return averages;
}

function inverseDocumentFrequency(index: SearchIndex, token: string): number {
  const total = index.indexedDocuments.length;
  const frequency = index.documentFrequency.get(token) ?? 0;
  if (total === 0 || frequency === 0) {
    return 0;
  }
  return Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5));
}

function tokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
