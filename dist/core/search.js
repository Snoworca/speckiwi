import { resolve } from "node:path";
import { createDiagnosticBag } from "./result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { rebuildCache } from "./cache.js";
import { isIndexSectionFresh } from "../cache/manifest.js";
import { buildDictionaryExpansion, buildSearchIndex, search, flattenWorkspace } from "../search/index.js";
import { fieldBoosts, normalizeExactKey, searchFieldOrder, tokenizeSearchText } from "../search/tokenizer.js";
import { loadReadModel } from "./read-model.js";
import { buildRequirementRegistry, getRequirement } from "./requirements.js";
import { loadWorkspaceForValidation } from "../validate/semantic.js";
import { normalizeStorePath, resolveRealStorePath } from "../io/path.js";
import { loadYamlDocument } from "../io/yaml-loader.js";
export async function searchWorkspace(input) {
    const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
    const warnings = [];
    if (canUseRequirementExactFastPath(input)) {
        const requirementResult = await searchExactRequirementFromSource(input, root.rootPath);
        if (requirementResult !== undefined) {
            return requirementResult;
        }
    }
    let model = await loadReadModel({
        root: root.rootPath,
        ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
        sections: ["search"]
    });
    if (input.cacheMode !== "bypass" && model.stats.mode !== "cache" && !(await isIndexSectionFresh(root, "search"))) {
        const rebuild = await rebuildCache(input);
        if (!rebuild.ok) {
            warnings.push({
                severity: "warning",
                code: "CACHE_REBUILD_DEGRADED",
                message: "Cache rebuild failed; search used YAML source data.",
                details: { reason: rebuild.error.message }
            });
        }
        else {
            model = await loadReadModel({
                root: root.rootPath,
                ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
                sections: ["search"]
            });
        }
    }
    if (input.cacheMode !== "bypass" && input.mode !== "exact" && model.stats.mode === "cache" && !(await isIndexSectionFresh(root, "search"))) {
        const rebuild = await rebuildCache(input);
        if (!rebuild.ok) {
            warnings.push({
                severity: "warning",
                code: "CACHE_REBUILD_DEGRADED",
                message: "Cache rebuild failed; search used YAML source data.",
                details: { reason: rebuild.error.message }
            });
        }
        else {
            model = await loadReadModel({
                root: root.rootPath,
                ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
                sections: ["search"]
            });
        }
    }
    const options = { extraWarnings: warnings };
    if (model.stats.mode === "cache") {
        const cachedResult = search(input, model.getSearchIndex());
        options.sourceAudit = input.mode === "exact" ? await loadExactSearchSourceAudit(root, cachedResult) : await loadSearchSourceAudit(root);
    }
    return searchWorkspaceFromReadModel(input, model, options);
}
function canUseRequirementExactFastPath(input) {
    return input.mode === "exact" && isRequirementIdLike(input.query) && matchesFilterValue("requirement", input.filters?.entityType);
}
function isRequirementIdLike(value) {
    return /^(FR|NFR|IR|DR|CON|SEC|PERF|REL|UX|MAINT|OPS|COMP|MIG|OBS)-[A-Z0-9][A-Z0-9_-]*-\d{4,}$/i.test(value.trim());
}
async function searchExactRequirementFromSource(input, root) {
    if (input.query.trim().length === 0) {
        return undefined;
    }
    const requirement = await getRequirement({
        root,
        ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
        id: input.query,
        includeDocument: true
    });
    if (!requirement.ok) {
        return undefined;
    }
    const item = requirementSearchResultItem(requirement.requirement, requirement.document);
    const results = item !== undefined && matchesSearchRequirementFilters(item, requirement.requirement, input.filters) ? [item] : [];
    const limit = normalizeSearchLimit(input.limit);
    const offset = normalizeOffset(input.offset);
    const pageResults = results.slice(offset, offset + limit);
    const page = {
        limit,
        offset,
        returned: pageResults.length,
        total: results.length,
        hasMore: offset + pageResults.length < results.length,
        nextOffset: offset + pageResults.length < results.length ? offset + pageResults.length : null
    };
    const payload = {
        query: input.query,
        mode: "exact",
        results: pageResults,
        page
    };
    return {
        ...payload,
        data: payload,
        ok: true,
        diagnostics: requirement.diagnostics
    };
}
async function loadSearchSourceAudit(root) {
    const workspace = await loadWorkspaceForValidation(root);
    return {
        documents: flattenWorkspace(workspace, buildRequirementRegistry(workspace)),
        dictionary: buildDictionaryExpansion(workspace)
    };
}
async function loadExactSearchSourceAudit(root, cachedResult) {
    if (!cachedResult.ok ||
        cachedResult.results.length === 0 ||
        cachedResult.page.total > cachedResult.results.length ||
        cachedResult.results.some((item) => item.entityType !== "requirement")) {
        return loadSearchSourceAudit(root);
    }
    const documents = [];
    for (const item of cachedResult.results) {
        const document = await loadRequirementSearchDocument(root, item);
        if (document !== undefined) {
            documents.push(document);
        }
    }
    return { documents, dictionary: await loadDictionaryExpansionForExactAudit(root) };
}
async function loadDictionaryExpansionForExactAudit(root) {
    try {
        const loaded = await loadYamlDocument(await resolveRealStorePath(root, normalizeStorePath("dictionary.yaml")));
        const value = jsonObjectValue(loaded.value);
        const synonyms = jsonObjectValue(value?.synonyms);
        const groups = Object.entries(synonyms ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, values]) => uniqueStrings([key, ...tagsFrom(values)]))
            .filter((group) => group.length > 0);
        return { groups };
    }
    catch {
        return { groups: [] };
    }
}
async function loadRequirementSearchDocument(root, item) {
    try {
        const storePath = normalizeStorePath(item.path.replace(/^\.speckiwi\//, ""));
        const loaded = await loadYamlDocument(await resolveRealStorePath(root, storePath));
        const value = jsonObjectValue(loaded.value);
        const rawRequirement = arrayObjects(value?.requirements).find((requirement) => stringValue(requirement.id) === item.id);
        if (value === undefined || rawRequirement === undefined) {
            return undefined;
        }
        const scope = stringValue(value.scope);
        const tags = tagsFrom(rawRequirement.tags);
        const documentId = stringValue(value.id) ?? item.documentId;
        const title = stringValue(rawRequirement.title);
        const type = stringValue(rawRequirement.type);
        const status = stringValue(rawRequirement.status);
        return {
            entityType: "requirement",
            id: item.id,
            path: `.speckiwi/${storePath}`,
            ...(documentId === undefined ? {} : { documentId }),
            ...(scope === undefined ? {} : { scope }),
            ...(title === undefined ? {} : { title }),
            fields: compactSearchFields({
                id: item.id,
                title,
                tags,
                scope,
                statement: stringValue(rawRequirement.statement),
                acceptanceCriteria: acceptanceCriteriaText(rawRequirement.acceptanceCriteria),
                rationale: stringValue(rawRequirement.rationale),
                description: stringValue(rawRequirement.description),
                body: metadataText(rawRequirement.metadata)
            }),
            filters: {
                entityType: "requirement",
                path: `.speckiwi/${storePath}`,
                ...(documentId === undefined ? {} : { documentId }),
                ...(scope === undefined ? {} : { scope }),
                ...(type === undefined ? {} : { type }),
                ...(status === undefined ? {} : { status }),
                tags
            }
        };
    }
    catch {
        return undefined;
    }
}
export function searchWorkspaceFromReadModel(input, model, options = {}) {
    const normalizedOptions = normalizeSearchReadModelOptions(options);
    const index = model.getSearchIndex();
    const searchOptions = {
        extraWarnings: [
            ...model.diagnostics.filter((diagnostic) => diagnostic.severity === "warning"),
            ...(normalizedOptions.extraWarnings ?? [])
        ]
    };
    const sourceAudit = normalizedOptions.sourceAudit ?? sourceAuditFromLegacyOptions(normalizedOptions);
    if (sourceAudit !== undefined) {
        searchOptions.sourceAudit = sourceAudit;
    }
    return searchWorkspaceFromIndex(input, index, searchOptions);
}
function searchWorkspaceFromIndex(input, index, options) {
    const searched = search(input, index);
    const sourceAudit = options.sourceAudit ?? sourceAuditFromLegacyOptions(options);
    const { result, mismatchCount } = sourceAudit === undefined
        ? { result: searched, mismatchCount: 0 }
        : searchWorkspaceFromSourceAudit(input, searched, sourceAudit);
    const warnings = [
        ...(options.extraWarnings ?? []),
        ...(mismatchCount === 0 ? [] : [cacheSourceMismatchWarning(mismatchCount)])
    ];
    if (!result.ok || warnings.length === 0) {
        return result;
    }
    const diagnostics = createDiagnosticBag([
        ...result.diagnostics.errors,
        ...result.diagnostics.warnings,
        ...result.diagnostics.infos,
        ...warnings
    ]);
    return {
        ...result,
        diagnostics,
        data: {
            query: result.query,
            mode: result.mode,
            results: result.results,
            page: result.page
        }
    };
}
function sourceAuditFromLegacyOptions(options) {
    if (options.sourceDocuments === undefined) {
        return undefined;
    }
    return {
        documents: options.sourceDocuments,
        dictionary: options.sourceDictionary ?? { groups: [] }
    };
}
function searchWorkspaceFromSourceAudit(input, cachedResult, sourceAudit) {
    const sourceIndex = buildSearchIndex([...sourceAudit.documents], sourceAudit.dictionary);
    const sourceResult = search(input, sourceIndex);
    return {
        result: sourceResult,
        mismatchCount: countSearchResultMismatches(cachedResult, sourceResult)
    };
}
function countSearchResultMismatches(cached, source) {
    if (!cached.ok || !source.ok) {
        return cached.ok === source.ok ? 0 : 1;
    }
    let mismatches = Math.abs(cached.page.total - source.page.total);
    const sourceByEntity = new Map(source.results.map((item) => [searchEntityKey(item.entityType, item.id), item]));
    const cachedByEntity = new Map(cached.results.map((item) => [searchEntityKey(item.entityType, item.id), item]));
    for (const cachedItem of cached.results) {
        const sourceItem = sourceByEntity.get(searchEntityKey(cachedItem.entityType, cachedItem.id));
        if (sourceItem === undefined || !sameSearchResultItem(cachedItem, sourceItem)) {
            mismatches += 1;
        }
    }
    for (const sourceItem of source.results) {
        if (!cachedByEntity.has(searchEntityKey(sourceItem.entityType, sourceItem.id))) {
            mismatches += 1;
        }
    }
    return mismatches;
}
export function rehydrateSearchResultsFromSource(result, sourceDocuments, queries = result.ok ? [result.query] : []) {
    if (!result.ok) {
        return { result, mismatchCount: 0 };
    }
    const sourceByEntity = new Map(sourceDocuments.map((document) => [searchEntityKey(document.entityType, document.id), document]));
    let mismatchCount = 0;
    const results = result.results.flatMap((item) => {
        const source = sourceByEntity.get(searchEntityKey(item.entityType, item.id));
        if (source === undefined) {
            mismatchCount += 1;
            return [];
        }
        const matchedFields = observedMatchedFields(queries, item.matchedFields, source);
        if (item.matchedFields.length > 0 && matchedFields.length === 0) {
            mismatchCount += 1;
            return [];
        }
        const rehydrated = rehydrateSearchResultItem(item, source, matchedFields);
        if (!sameSearchResultItem(item, rehydrated)) {
            mismatchCount += 1;
        }
        return [rehydrated];
    });
    if (mismatchCount === 0) {
        return { result, mismatchCount: 0 };
    }
    const page = {
        ...result.page,
        returned: results.length,
        total: result.page.offset + results.length
    };
    page.hasMore = page.offset + page.returned < page.total;
    page.nextOffset = page.hasMore ? page.offset + page.returned : null;
    return {
        mismatchCount,
        result: {
            ...result,
            data: {
                query: result.query,
                mode: result.mode,
                results,
                page
            },
            query: result.query,
            mode: result.mode,
            results,
            page
        }
    };
}
function cacheSourceMismatchWarning(mismatchCount) {
    return {
        severity: "warning",
        code: "SEARCH_CACHE_SOURCE_MISMATCH",
        message: "Search cache contained source-inconsistent results; YAML source data was used to filter or rehydrate them.",
        details: { mismatchCount }
    };
}
function normalizeSearchReadModelOptions(options) {
    if (options === undefined) {
        return {};
    }
    if (Array.isArray(options)) {
        return { extraWarnings: options };
    }
    return options;
}
function searchEntityKey(entityType, id) {
    return `${entityType}\0${id}`;
}
function observedMatchedFields(queries, matchedFields, source) {
    const fields = matchedFields.filter((field) => searchFieldOrder.includes(field));
    return fields
        .filter((field) => fieldValues(source, field).some((value) => queries.some((query) => fieldValueMatchesQuery(value, query))))
        .sort((left, right) => searchFieldOrder.indexOf(left) - searchFieldOrder.indexOf(right));
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
function fieldValueMatchesQuery(value, query) {
    const normalizedValue = normalizeExactKey(value);
    const normalizedQuery = normalizeExactKey(query);
    if (normalizedQuery.length === 0) {
        return false;
    }
    if (normalizedValue === normalizedQuery || normalizedValue.includes(normalizedQuery)) {
        return true;
    }
    const valueTokens = new Set(tokenizeSearchText(value));
    return tokenizeSearchText(query).some((token) => valueTokens.has(token));
}
function rehydrateSearchResultItem(item, source, matchedFields) {
    return {
        entityType: item.entityType,
        id: item.id,
        score: conservativeObservedScore(matchedFields),
        matchedFields: [...matchedFields],
        path: source.path,
        ...(source.documentId === undefined ? {} : { documentId: source.documentId }),
        ...(source.scope === undefined ? {} : { scope: source.scope }),
        ...(source.title === undefined ? {} : { title: source.title })
    };
}
function conservativeObservedScore(matchedFields) {
    if (matchedFields.length === 0) {
        return 0;
    }
    const observed = matchedFields.reduce((sum, field) => sum + fieldBoosts[field], 0);
    const possible = searchFieldOrder.reduce((sum, field) => sum + fieldBoosts[field], 0);
    return Math.min(observed / possible, 0.999);
}
function sameSearchResultItem(left, right) {
    return (left.path === right.path &&
        left.documentId === right.documentId &&
        left.scope === right.scope &&
        left.title === right.title &&
        left.score === right.score &&
        left.matchedFields.length === right.matchedFields.length &&
        left.matchedFields.every((field, index) => field === right.matchedFields[index]));
}
function compactSearchFields(fields) {
    const compacted = {};
    for (const [field, value] of Object.entries(fields)) {
        if (value === undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            const values = value.filter((entry) => entry.trim().length > 0);
            if (values.length > 0) {
                compacted[field] = values;
            }
        }
        else if (value.trim().length > 0) {
            compacted[field] = value;
        }
    }
    return compacted;
}
function acceptanceCriteriaText(value) {
    return arrayObjects(value).flatMap((item) => [stringValue(item.id), stringValue(item.method), stringValue(item.description)].filter(isString));
}
function metadataText(value) {
    return value === undefined ? undefined : JSON.stringify(value);
}
function arrayObjects(value) {
    return Array.isArray(value) ? value.filter(isJsonObject) : [];
}
function jsonObjectValue(value) {
    return isJsonObject(value) ? value : undefined;
}
function stringValue(value) {
    return typeof value === "string" ? value : undefined;
}
function tagsFrom(value) {
    return Array.isArray(value) ? value.filter(isString).sort() : [];
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value) {
    return typeof value === "string" && value.length > 0;
}
function requirementSearchResultItem(requirement, document) {
    const id = stringValue(requirement.id);
    if (id === undefined || document === undefined) {
        return undefined;
    }
    const title = stringValue(requirement.title);
    return {
        entityType: "requirement",
        id,
        score: 1,
        matchedFields: ["id"],
        path: `.speckiwi/${document.path}`,
        documentId: document.id,
        ...(document.scope === undefined ? {} : { scope: document.scope }),
        ...(title === undefined ? {} : { title })
    };
}
function matchesSearchRequirementFilters(item, requirement, filters) {
    if (filters === undefined) {
        return true;
    }
    return (matchesFilterValue(item.entityType, filters.entityType) &&
        matchesFilterValue(item.documentId, filters.documentId) &&
        matchesFilterValue(item.scope, filters.scope) &&
        matchesFilterValue(stringValue(requirement.type), filters.type) &&
        matchesFilterValue(stringValue(requirement.status), filters.status) &&
        matchesFilterValue(item.path, filters.path) &&
        matchesTagFilter(tagsFrom(requirement.tags), filters.tag));
}
function matchesFilterValue(value, filter) {
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
    return values.some((tag) => tags.includes(tag));
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
//# sourceMappingURL=search.js.map