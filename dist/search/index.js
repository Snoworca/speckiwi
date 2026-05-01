import { ok } from "../core/result.js";
import { bm25Search, buildSearchIndex as buildBm25SearchIndex, deserializeSearchIndex as deserializeBm25SearchIndex, exactLookup, serializeSearchIndex as serializeBm25SearchIndex, sortFields } from "./bm25.js";
import { normalizeExactKey, searchFieldOrder, tokenizeSearchText } from "./tokenizer.js";
export { buildDictionaryExpansion, flattenWorkspace } from "./document.js";
export { tokenizeKorean } from "./korean.js";
export { tokenizeSearchText };
export function buildSearchIndex(documents, dictionary = { groups: [] }) {
    return {
        ...buildBm25SearchIndex(documents),
        dictionary
    };
}
export function serializeSearchIndex(index) {
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
export function deserializeSearchIndex(value) {
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
export function search(input, index) {
    const mode = input.mode ?? "auto";
    const expandedQueries = expandQuery(input.query, index.dictionary ?? { groups: [] });
    const allowedIndexes = allowedDocumentIndexes(index, input.filters);
    const merged = new Map();
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
function expandQuery(query, dictionary) {
    const values = new Set([query]);
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
function normalizeForDictionary(value) {
    return normalizeExactKey(value).replace(/\s+/g, " ");
}
function allowedDocumentIndexes(index, filters) {
    const allowed = new Set();
    for (let documentIndex = 0; documentIndex < index.documents.length; documentIndex += 1) {
        const document = index.documents[documentIndex];
        if (document !== undefined && matchesFilters(document, filters)) {
            allowed.add(documentIndex);
        }
    }
    return allowed;
}
function matchesFilters(document, filters) {
    if (filters === undefined) {
        return true;
    }
    return (matchesFilter(document.entityType, filters.entityType) &&
        matchesFilter(document.documentId, filters.documentId) &&
        matchesFilter(document.scope, filters.scope) &&
        matchesFilter(document.filters.type, filters.type) &&
        matchesFilter(document.filters.status, filters.status) &&
        matchesFilter(document.path, filters.path) &&
        matchesTagFilter(document.filters.tags, filters.tag));
}
function matchesFilter(value, filter) {
    if (filter === undefined) {
        return true;
    }
    const values = Array.isArray(filter) ? filter : [filter];
    return value !== undefined && values.includes(value);
}
function matchesTagFilter(tags, filter) {
    if (filter === undefined) {
        return true;
    }
    const values = Array.isArray(filter) ? filter : [filter];
    return values.some((value) => tags.includes(value));
}
function toResultItem(document, score, matchedFields) {
    const item = {
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
function mergeResult(results, item) {
    const key = `${item.entityType}\0${item.id}`;
    const existing = results.get(key);
    if (existing === undefined) {
        results.set(key, item);
        return;
    }
    existing.score = Math.max(existing.score, item.score);
    existing.matchedFields = sortFields([...existing.matchedFields, ...item.matchedFields]);
}
function compareResults(left, right) {
    return (right.score - left.score ||
        entityPriority(left.entityType) - entityPriority(right.entityType) ||
        left.id.localeCompare(right.id) ||
        (left.documentId ?? "").localeCompare(right.documentId ?? "") ||
        left.path.localeCompare(right.path));
}
function entityPriority(entityType) {
    return ["requirement", "document", "scope", "prd_item", "technical_section", "adr", "rule"].indexOf(entityType);
}
function normalizeSearchLimit(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 10;
    }
    return Math.min(Math.max(Math.trunc(value), 1), 100);
}
function normalizeOffset(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }
    return Math.max(Math.trunc(value), 0);
}
function pageInfo(limit, offset, total, returned) {
    return {
        limit,
        offset,
        returned,
        total,
        hasMore: offset + returned < total,
        nextOffset: offset + returned < total ? offset + returned : null
    };
}
function serializedSearchIndexValue(value) {
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
    const serialized = {
        documents: documents
    };
    if (dictionary !== undefined) {
        serialized.dictionary = dictionary;
    }
    return serialized;
}
function searchDocumentValue(value) {
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
    const document = {
        entityType,
        id: object.id,
        path: object.path,
        fields,
        filters
    };
    for (const key of ["documentId", "scope", "title"]) {
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
function searchFieldsValue(value) {
    const object = objectValue(value);
    if (object === undefined) {
        return undefined;
    }
    const fields = {};
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
function searchFiltersValue(value, documentEntityType, documentPath) {
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
    const filters = {
        entityType,
        path: object.path,
        tags
    };
    for (const key of ["documentId", "scope", "type", "status"]) {
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
function dictionaryExpansionValue(value) {
    if (value === undefined) {
        return undefined;
    }
    const object = objectValue(value);
    if (object === undefined || !Array.isArray(object.groups)) {
        return undefined;
    }
    const groups = object.groups.map(stringArray);
    return groups.some((group) => group === undefined) ? undefined : { groups: groups };
}
function entityTypeValue(value) {
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
function isSearchFieldName(value) {
    return searchFieldOrder.includes(value);
}
function objectValue(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}
function stringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : undefined;
}
function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
//# sourceMappingURL=index.js.map