import { findHeadingMatching, SCOPE_ROW_COLUMNS, type ScopeRowField } from "../parser/index-parser.js";
import { parseMarkdownTable, renderRowByHeader, type ParsedTable } from "../parser/table.js";
import type { Result } from "../result.js";
import type { TextFile } from "../types.js";

// @req FR-NODE-233 — the one path every scope-row writer (scaffold, register, rename) takes.

export type ScopeIndexSection = "srs-documents" | "scope-map";

const SECTION_HEADINGS: Record<ScopeIndexSection, RegExp> = {
  "srs-documents": /^##\s+\d+\.\s+SRS Documents$/,
  "scope-map": /^##\s+\d+\.\s+Scope Map$/
};

export interface ScopeIndexTable extends ParsedTable {
  section: ScopeIndexSection;
  /** 1-based line at which a new row is inserted: just past the table's last row. */
  insertLine: number;
}

export function readScopeIndexTable(file: TextFile, section: ScopeIndexSection): ScopeIndexTable | undefined {
  // The index parser's own lookup, so a fenced example of the index is never taken for the table.
  const heading = findHeadingMatching(file.lines, SECTION_HEADINGS[section]);
  if (heading < 0) return undefined;
  const table = parseMarkdownTable(file.lines, heading + 1);
  return table ? { ...table, section, insertLine: table.endLine + 1 } : undefined;
}

export type ScopeRowFields = Record<ScopeRowField, string>;

/**
 * The header's name for a scope-row field. When the header lists none of the field's names the
 * canonical name is returned, so the row primitive refuses it rather than dropping the value.
 */
export function scopeColumn(headers: readonly string[], field: ScopeRowField): string {
  const names: readonly string[] = SCOPE_ROW_COLUMNS[field];
  return names.find((name) => headers.includes(name)) ?? SCOPE_ROW_COLUMNS[field][0];
}

export function renderScopeIndexRow(headers: readonly string[], fields: ScopeRowFields): Result<string> {
  const values: Record<string, string> = {};
  for (const field of Object.keys(SCOPE_ROW_COLUMNS) as ScopeRowField[]) {
    values[scopeColumn(headers, field)] = fields[field];
  }
  return renderRowByHeader(headers, values);
}
