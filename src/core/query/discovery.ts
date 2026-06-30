import type { RequirementFilter, RequirementRecord } from "../types.js";
import { matchesRequirementFilter } from "./filter.js";

export type RequirementProjection = "ids" | "compact" | "full";

export interface RequirementDiscoveryOptions {
  projection?: string;
  fields?: string[] | string;
  includeMarkdown?: boolean;
  limit?: number;
  offset?: number;
}

export interface RequirementSearchOptions extends RequirementDiscoveryOptions {
  query: string;
  filter?: RequirementFilter;
}

export interface PageInfo {
  total: number;
  offset: number;
  limit: number | null;
  returned: number;
  nextOffset: number | null;
  truncated: boolean;
}

export interface RequirementSnippet {
  field: string;
  text: string;
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

function pageSlice<T>(items: readonly T[], options: RequirementDiscoveryOptions): { items: T[]; page: PageInfo } {
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

function textEntries(record: RequirementRecord): Array<{ field: string; text: string }> {
  return [
    { field: "id", text: record.id },
    { field: "title", text: record.title },
    { field: "requirement", text: record.requirement ?? "" },
    { field: "rationale", text: record.rationale ?? "" },
    { field: "research", text: record.research ?? "" },
    { field: "acceptanceCriteria", text: record.acceptanceCriteria.map((criterion) => `${criterion.id}: ${criterion.text}`).join("\n") },
    { field: "verificationEvidence", text: record.verificationEvidence.map((row) => `${row.id} ${row.type} ${row.reference} ${row.covers} ${row.notes}`).join("\n") },
    { field: "traceLinks", text: record.traceLinks.map((row) => `${row.type} ${row.reference} ${row.relation} ${row.notes}`).join("\n") },
    { field: "relatedDocs", text: (record.relatedDocs ?? []).join("\n") },
    { field: "changeNotes", text: record.changeNotes.map((row) => `${row.date} ${row.change} ${row.reason}`).join("\n") }
  ];
}

function snippetFor(text: string, index: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + 100);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function snippetsFor(record: RequirementRecord, query: string): RequirementSnippet[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const snippets: RequirementSnippet[] = [];
  for (const entry of textEntries(record)) {
    const haystack = entry.text.toLowerCase();
    const index = haystack.indexOf(needle);
    if (index >= 0) {
      snippets.push({ field: entry.field, text: snippetFor(entry.text, index) });
    }
  }
  return snippets.slice(0, 3);
}

export function searchRequirementRecords(records: readonly RequirementRecord[], options: RequirementSearchOptions): Record<string, unknown> {
  const filtered = records.filter((record) => matchesRequirementFilter(record, options.filter ?? {}));
  const matches = filtered
    .map((record) => ({ record, snippets: snippetsFor(record, options.query) }))
    .filter((match) => match.snippets.length > 0)
    .sort((a, b) => a.record.id.localeCompare(b.record.id));
  const { items, page } = pageSlice(matches, options);
  return {
    records: items.map(({ record, snippets }) => ({
      id: record.id,
      title: record.title,
      snippets,
      filePath: record.filePath,
      headingLine: record.headingLine,
      target: record.target,
      status: record.status,
      stability: record.stability,
      scope: record.scope
    })),
    projection: "search",
    page
  };
}
