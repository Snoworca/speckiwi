import { fieldBoosts, normalizeExactKey, searchFieldOrder, tokenizeFieldValues } from "./tokenizer.js";
const k1 = 1.2;
const b = 0.75;
export function buildSearchIndex(documents) {
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
export function serializeSearchIndex(index) {
    return {
        documents: index.documents
    };
}
export function deserializeSearchIndex(serialized) {
    return buildSearchIndex(serialized.documents);
}
export function exactLookup(index, query) {
    return index.exact.get(normalizeExactKey(query)) ?? [];
}
export function bm25Search(index, queryTokens, allowedIndexes) {
    if (queryTokens.length === 0) {
        return [];
    }
    const candidates = [];
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
        const matchedFields = new Set();
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
export function sortFields(fields) {
    const unique = [...new Set(fields)];
    return unique.sort((left, right) => searchFieldOrder.indexOf(left) - searchFieldOrder.indexOf(right));
}
function buildIndexedDocument(document) {
    const fieldTokens = Object.fromEntries(searchFieldOrder.map((field) => [field, tokenizeFieldValues(fieldValues(document, field))]));
    const fieldTokenCounts = Object.fromEntries(searchFieldOrder.map((field) => [field, tokenCounts(fieldTokens[field])]));
    return {
        document,
        fieldTokens,
        fieldTokenCounts
    };
}
function fieldValues(document, field) {
    if (field === "path") {
        return [document.path];
    }
    const value = document.fields[field];
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
function buildExactIndex(documents) {
    const exact = new Map();
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
function addExact(exact, value, index, field) {
    const key = normalizeExactKey(value);
    const entries = exact.get(key) ?? [];
    if (!entries.some((entry) => entry.index === index && entry.field === field)) {
        entries.push({ index, field });
    }
    exact.set(key, entries);
}
function buildDocumentFrequency(indexedDocuments) {
    const frequency = new Map();
    for (const document of indexedDocuments) {
        const tokens = new Set();
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
function buildAverageFieldLengths(indexedDocuments) {
    const averages = {};
    for (const field of searchFieldOrder) {
        const total = indexedDocuments.reduce((sum, document) => sum + document.fieldTokens[field].length, 0);
        averages[field] = indexedDocuments.length === 0 ? 0 : total / indexedDocuments.length;
    }
    return averages;
}
function inverseDocumentFrequency(index, token) {
    const total = index.indexedDocuments.length;
    const frequency = index.documentFrequency.get(token) ?? 0;
    if (total === 0 || frequency === 0) {
        return 0;
    }
    return Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5));
}
function tokenCounts(tokens) {
    const counts = new Map();
    for (const token of tokens) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return counts;
}
//# sourceMappingURL=bm25.js.map