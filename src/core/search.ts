import { resolve } from "node:path";
import type { SearchInput } from "./inputs.js";
import type { SearchResultItem, SearchResultSet, Diagnostic } from "./dto.js";
import { createDiagnosticBag } from "./result.js";
import { workspaceRootFromPath } from "../io/workspace.js";
import { rebuildCache } from "./cache.js";
import { isIndexSectionFresh } from "../cache/manifest.js";
import { buildDictionaryExpansion, buildSearchIndex, search, flattenWorkspace, type DictionaryExpansion, type SearchDocument } from "../search/index.js";
import { fieldBoosts, normalizeExactKey, searchFieldOrder, tokenizeSearchText, type SearchFieldName } from "../search/tokenizer.js";
import { loadReadModel, type ReadModel } from "./read-model.js";
import { buildRequirementRegistry, getRequirement } from "./requirements.js";
import { loadWorkspaceForValidation } from "../validate/semantic.js";
import { normalizeStorePath, resolveRealStorePath } from "../io/path.js";
import { loadYamlDocument } from "../io/yaml-loader.js";
import type { JsonObject, JsonValue } from "./dto.js";

export type SearchSourceAudit = {
  documents: readonly SearchDocument[];
  dictionary: DictionaryExpansion;
};

export type SearchReadModelOptions = {
  extraWarnings?: readonly Diagnostic[];
  sourceDocuments?: readonly SearchDocument[];
  sourceDictionary?: DictionaryExpansion;
  sourceAudit?: SearchSourceAudit;
};

export async function searchWorkspace(input: SearchInput): Promise<SearchResultSet> {
  const root = workspaceRootFromPath(resolve(input.root ?? process.cwd()));
  const warnings: Diagnostic[] = [];
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
    } else {
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
    } else {
      model = await loadReadModel({
        root: root.rootPath,
        ...(input.cacheMode === undefined ? {} : { cacheMode: input.cacheMode }),
        sections: ["search"]
      });
    }
  }
  const options: SearchReadModelOptions = { extraWarnings: warnings };
  if (model.stats.mode === "cache") {
    const cachedResult = search(input, model.getSearchIndex());
    options.sourceAudit = input.mode === "exact" ? await loadExactSearchSourceAudit(root, cachedResult) : await loadSearchSourceAudit(root);
  }
  return searchWorkspaceFromReadModel(input, model, options);
}

function canUseRequirementExactFastPath(input: SearchInput): boolean {
  return input.mode === "exact" && isRequirementIdLike(input.query) && matchesFilterValue("requirement", input.filters?.entityType);
}

function isRequirementIdLike(value: string): boolean {
  return /^(FR|NFR|IR|DR|CON|SEC|PERF|REL|UX|MAINT|OPS|COMP|MIG|OBS)-[A-Z0-9][A-Z0-9_-]*-\d{4,}$/i.test(value.trim());
}

async function searchExactRequirementFromSource(input: SearchInput, root: string): Promise<SearchResultSet | undefined> {
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
    mode: "exact" as const,
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

async function loadSearchSourceAudit(root: ReturnType<typeof workspaceRootFromPath>): Promise<SearchSourceAudit> {
  const workspace = await loadWorkspaceForValidation(root);
  return {
    documents: flattenWorkspace(workspace, buildRequirementRegistry(workspace)),
    dictionary: buildDictionaryExpansion(workspace)
  };
}

async function loadExactSearchSourceAudit(root: ReturnType<typeof workspaceRootFromPath>, cachedResult: SearchResultSet): Promise<SearchSourceAudit> {
  if (
    !cachedResult.ok ||
    cachedResult.results.length === 0 ||
    cachedResult.page.total > cachedResult.results.length ||
    cachedResult.results.some((item) => item.entityType !== "requirement")
  ) {
    return loadSearchSourceAudit(root);
  }

  const documents: SearchDocument[] = [];
  for (const item of cachedResult.results) {
    const document = await loadRequirementSearchDocument(root, item);
    if (document !== undefined) {
      documents.push(document);
    }
  }
  return { documents, dictionary: await loadDictionaryExpansionForExactAudit(root) };
}

async function loadDictionaryExpansionForExactAudit(root: ReturnType<typeof workspaceRootFromPath>): Promise<DictionaryExpansion> {
  try {
    const loaded = await loadYamlDocument(await resolveRealStorePath(root, normalizeStorePath("dictionary.yaml")));
    const value = jsonObjectValue(loaded.value);
    const synonyms = jsonObjectValue(value?.synonyms);
    const groups = Object.entries(synonyms ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => uniqueStrings([key, ...tagsFrom(values)]))
      .filter((group) => group.length > 0);
    return { groups };
  } catch {
    return { groups: [] };
  }
}

async function loadRequirementSearchDocument(
  root: ReturnType<typeof workspaceRootFromPath>,
  item: SearchResultItem
): Promise<SearchDocument | undefined> {
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
  } catch {
    return undefined;
  }
}

export function searchWorkspaceFromReadModel(
  input: SearchInput,
  model: ReadModel,
  options: SearchReadModelOptions | readonly Diagnostic[] = {}
): SearchResultSet {
  const normalizedOptions = normalizeSearchReadModelOptions(options);
  const index = model.getSearchIndex();
  const searchOptions: SearchReadModelOptions = {
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

function searchWorkspaceFromIndex(input: SearchInput, index: ReturnType<ReadModel["getSearchIndex"]>, options: SearchReadModelOptions): SearchResultSet {
  const searched = search(input, index);
  const sourceAudit = options.sourceAudit ?? sourceAuditFromLegacyOptions(options);
  const { result, mismatchCount } =
    sourceAudit === undefined
      ? { result: searched, mismatchCount: 0 }
      : searchWorkspaceFromSourceAudit(input, searched, sourceAudit);
  const warnings = [
    ...(options.extraWarnings ?? []),
    ...(mismatchCount === 0 ? [] : [cacheSourceMismatchWarning(mismatchCount)])
  ] as Diagnostic[];
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

function sourceAuditFromLegacyOptions(options: SearchReadModelOptions): SearchSourceAudit | undefined {
  if (options.sourceDocuments === undefined) {
    return undefined;
  }
  return {
    documents: options.sourceDocuments,
    dictionary: options.sourceDictionary ?? { groups: [] }
  };
}

function searchWorkspaceFromSourceAudit(input: SearchInput, cachedResult: SearchResultSet, sourceAudit: SearchSourceAudit): { result: SearchResultSet; mismatchCount: number } {
  const sourceIndex = buildSearchIndex([...sourceAudit.documents], sourceAudit.dictionary);
  const sourceResult = search(input, sourceIndex);
  return {
    result: sourceResult,
    mismatchCount: countSearchResultMismatches(cachedResult, sourceResult)
  };
}

function countSearchResultMismatches(cached: SearchResultSet, source: SearchResultSet): number {
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

export function rehydrateSearchResultsFromSource(
  result: SearchResultSet,
  sourceDocuments: readonly SearchDocument[],
  queries: readonly string[] = result.ok ? [result.query] : []
): { result: SearchResultSet; mismatchCount: number } {
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

function cacheSourceMismatchWarning(mismatchCount: number): Diagnostic {
  return {
    severity: "warning",
    code: "SEARCH_CACHE_SOURCE_MISMATCH",
    message: "Search cache contained source-inconsistent results; YAML source data was used to filter or rehydrate them.",
    details: { mismatchCount }
  };
}

function normalizeSearchReadModelOptions(options: SearchReadModelOptions | readonly Diagnostic[] | undefined): SearchReadModelOptions {
  if (options === undefined) {
    return {};
  }
  if (Array.isArray(options)) {
    return { extraWarnings: options as readonly Diagnostic[] };
  }
  return options as SearchReadModelOptions;
}

function searchEntityKey(entityType: string, id: string): string {
  return `${entityType}\0${id}`;
}

function observedMatchedFields(queries: readonly string[], matchedFields: readonly string[], source: SearchDocument): SearchFieldName[] {
  const fields = matchedFields.filter((field): field is SearchFieldName => searchFieldOrder.includes(field as SearchFieldName));
  return fields
    .filter((field) => fieldValues(source, field).some((value) => queries.some((query) => fieldValueMatchesQuery(value, query))))
    .sort((left, right) => searchFieldOrder.indexOf(left) - searchFieldOrder.indexOf(right));
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

function fieldValueMatchesQuery(value: string, query: string): boolean {
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

function rehydrateSearchResultItem(item: SearchResultItem, source: SearchDocument, matchedFields: readonly SearchFieldName[]): SearchResultItem {
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

function conservativeObservedScore(matchedFields: readonly SearchFieldName[]): number {
  if (matchedFields.length === 0) {
    return 0;
  }
  const observed = matchedFields.reduce((sum, field) => sum + fieldBoosts[field], 0);
  const possible = searchFieldOrder.reduce((sum, field) => sum + fieldBoosts[field], 0);
  return Math.min(observed / possible, 0.999);
}

function sameSearchResultItem(left: SearchResultItem, right: SearchResultItem): boolean {
  return (
    left.path === right.path &&
    left.documentId === right.documentId &&
    left.scope === right.scope &&
    left.title === right.title &&
    left.score === right.score &&
    left.matchedFields.length === right.matchedFields.length &&
    left.matchedFields.every((field, index) => field === right.matchedFields[index])
  );
}

function compactSearchFields(fields: Partial<Record<SearchFieldName, string | string[] | undefined>>): SearchDocument["fields"] {
  const compacted: SearchDocument["fields"] = {};
  for (const [field, value] of Object.entries(fields) as [SearchFieldName, string | string[] | undefined][]) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      const values = value.filter((entry) => entry.trim().length > 0);
      if (values.length > 0) {
        compacted[field] = values;
      }
    } else if (value.trim().length > 0) {
      compacted[field] = value;
    }
  }
  return compacted;
}

function acceptanceCriteriaText(value: JsonValue | undefined): string[] {
  return arrayObjects(value).flatMap((item) => [stringValue(item.id), stringValue(item.method), stringValue(item.description)].filter(isString));
}

function metadataText(value: JsonValue | undefined): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function arrayObjects(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function jsonObjectValue(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function tagsFrom(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isString).sort() : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function requirementSearchResultItem(requirement: JsonObject, document: { id: string; path: string; scope?: string } | undefined): SearchResultItem | undefined {
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

function matchesSearchRequirementFilters(
  item: SearchResultItem,
  requirement: JsonObject,
  filters: SearchInput["filters"]
): boolean {
  if (filters === undefined) {
    return true;
  }
  return (
    matchesFilterValue(item.entityType, filters.entityType) &&
    matchesFilterValue(item.documentId, filters.documentId) &&
    matchesFilterValue(item.scope, filters.scope) &&
    matchesFilterValue(stringValue(requirement.type), filters.type) &&
    matchesFilterValue(stringValue(requirement.status), filters.status) &&
    matchesFilterValue(item.path, filters.path) &&
    matchesTagFilter(tagsFrom(requirement.tags), filters.tag)
  );
}

function matchesFilterValue(value: string | undefined, filter: string | string[] | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  const values = Array.isArray(filter) ? filter : [filter];
  return value !== undefined && values.includes(value);
}

function matchesTagFilter(tags: readonly string[], filter: string | string[] | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  const values = Array.isArray(filter) ? filter : [filter];
  return values.some((tag) => tags.includes(tag));
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
