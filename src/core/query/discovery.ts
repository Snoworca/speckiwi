import type { RequirementFilter, RequirementRecord } from "../types.js";
import { matchesRequirementFilter } from "./filter.js";
import {
  buildRequirementSearchIndex,
  phraseSnippets,
  rankedSnippets,
  rankRequirements,
  type RequirementSearchIndex,
  type RequirementSnippet
} from "./search-index.js";

export type { RequirementSnippet } from "./search-index.js";

export type RequirementProjection = "ids" | "compact" | "full";

export interface RequirementDiscoveryOptions {
  projection?: string;
  fields?: string[] | string;
  includeMarkdown?: boolean;
  limit?: number;
  offset?: number;
}

/** `ranked` (default): phrase matches, then word matches by score. `exact`: phrase matches only, in ID order. */
export type RequirementSearchMatch = "ranked" | "exact";

export interface RequirementSearchOptions extends RequirementDiscoveryOptions {
  query: string;
  filter?: RequirementFilter;
  match?: RequirementSearchMatch;
}

export interface PageInfo {
  total: number;
  offset: number;
  limit: number | null;
  returned: number;
  nextOffset: number | null;
  truncated: boolean;
}

const COMPACT_FIELDS = [
  "id",
  "title",
  "type",
  "target",
  "status",
  "stability",
  "priority",
  "scope",
  "filePath",
  "headingLine",
  "tags",
  "relatedDocs",
  "evidenceReferences",
  "traceReferences",
  "newWorkCandidate"
] as const;

const FIELD_ALLOWLIST = new Set([
  ...COMPACT_FIELDS,
  "risk",
  "metadata",
  "acceptanceCriteria",
  "expiredAcceptanceCriteria",
  "verificationEvidence",
  "traceLinks",
  "changeNotes",
  "requirement",
  "rationale",
  "research",
  "implementationNotes",
  "blockStartLine",
  "blockEndLine",
  "sectionLines",
  "markdown"
]);

function normalizeProjection(value: string | undefined): RequirementProjection {
  if (value === "ids" || value === "compact" || value === "full") return value;
  return "compact";
}

export function normalizeDiscoveryFields(value: string[] | string | undefined): string[] | undefined {
  const fields = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const normalized = fields.map((field) => field.trim()).filter(Boolean);
  if (normalized.length === 0) return undefined;
  const invalid = normalized.find((field) => !FIELD_ALLOWLIST.has(field));
  if (invalid) throw new Error(`Unknown requirement field: ${invalid}`);
  return [...new Set(normalized)];
}

export function pageSlice<T>(items: readonly T[], options: RequirementDiscoveryOptions): { items: T[]; page: PageInfo } {
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = options.limit === undefined ? null : Math.max(0, Math.trunc(options.limit));
  const end = limit === null ? items.length : offset + limit;
  const sliced = items.slice(offset, end);
  const nextOffset = end < items.length ? end : null;
  return {
    items: sliced,
    page: {
      total: items.length,
      offset,
      limit,
      returned: sliced.length,
      nextOffset,
      truncated: nextOffset !== null
    }
  };
}

function pickFields(record: RequirementRecord, fields: readonly string[], includeMarkdown: boolean): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === "markdown" && !includeMarkdown) continue;
    if (field in record) output[field] = record[field as keyof RequirementRecord];
  }
  return output;
}

function projectRecord(record: RequirementRecord, options: RequirementDiscoveryOptions): Record<string, unknown> {
  const fields = normalizeDiscoveryFields(options.fields);
  if (fields) return pickFields(record, fields, options.includeMarkdown === true);
  const projection = normalizeProjection(options.projection);
  if (projection === "compact") return pickFields(record, COMPACT_FIELDS, false);
  const output = { ...record };
  if (!options.includeMarkdown) delete output.markdown;
  return output;
}

export function projectRequirementRecords(records: readonly RequirementRecord[], options: RequirementDiscoveryOptions = {}): Record<string, unknown> {
  const projection = normalizeDiscoveryFields(options.fields) ? "fields" : normalizeProjection(options.projection);
  const { items, page } = pageSlice(records, options);
  if (projection === "ids") {
    return { ids: items.map((record) => record.id), projection, page };
  }
  return {
    records: items.map((record) => projectRecord(record, options)),
    projection,
    page
  };
}

// @req FR-CLI-001 AC-1 — ranked results can be many; exact keeps the pre-ranking unlimited page.
export const RANKED_DEFAULT_LIMIT = 20;

function searchRecordFields(record: RequirementRecord, snippets: RequirementSnippet[]): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    snippets,
    filePath: record.filePath,
    headingLine: record.headingLine,
    target: record.target,
    status: record.status,
    stability: record.stability,
    scope: record.scope
  };
}

// @req FR-NODE-239 AC-7 — the search as it was before ranking: phrase matches in ID order.
function exactSearch(records: readonly RequirementRecord[], options: RequirementSearchOptions): Record<string, unknown> {
  const filtered = records.filter((record) => matchesRequirementFilter(record, options.filter ?? {}));
  const matches = filtered
    .map((record) => ({ record, snippets: phraseSnippets(record, options.query) }))
    .filter((match) => match.snippets.length > 0)
    .sort((a, b) => a.record.id.localeCompare(b.record.id));
  const { items, page } = pageSlice(matches, options);
  return {
    records: items.map(({ record, snippets }) => searchRecordFields(record, snippets)),
    projection: "search",
    page
  };
}

export function searchRequirementRecords(records: readonly RequirementRecord[], options: RequirementSearchOptions): Record<string, unknown> {
  // Exact matching needs no index; returning here skips building one.
  if (options.match === "exact") return exactSearch(records, options);
  return searchRequirementIndex(buildRequirementSearchIndex(records), options);
}

/** Same as `searchRequirementRecords`, over an index built once and reused across queries. */
export function searchRequirementIndex(index: RequirementSearchIndex, options: RequirementSearchOptions): Record<string, unknown> {
  if (options.match === "exact") return exactSearch(index.records, options);
  const filter = options.filter ?? {};
  // Filters apply after scoring so document frequencies always come from the whole corpus.
  const hits = rankRequirements(index, options.query).filter((hit) => matchesRequirementFilter(hit.record, filter));
  const { items, page } = pageSlice(hits, { ...options, limit: options.limit ?? RANKED_DEFAULT_LIMIT });
  return {
    records: items.map((hit) => ({
      ...searchRecordFields(hit.record, rankedSnippets(index, hit, options.query)),
      match: hit.match,
      matchedTerms: hit.matchedTerms,
      score: hit.score
    })),
    projection: "search",
    page
  };
}
