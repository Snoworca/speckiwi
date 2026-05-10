import { diagnostic } from "../diagnostic.js";
import type { Diagnostic, DiagnosticSeverity } from "../types.js";

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  rowLines: number[];
  startLine: number;
  endLine: number;
}

export interface ParsedTableResult {
  table?: ParsedTable;
  diagnostics: Diagnostic[];
}

export type TableDiagnosticCode = "SRS-E021" | "SRS-W016" | "SRS-W017";

export interface ParseMarkdownTableOptions {
  filePath?: string;
  lineOffset?: number;
  diagnosticCode?: TableDiagnosticCode;
  requirementId?: string;
  tableLabel?: string;
}

function isSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function isTableLine(line: string): boolean {
  return line.trim().startsWith("|") && line.includes("|");
}

export function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function severityForTableDiagnostic(code: TableDiagnosticCode): DiagnosticSeverity {
  return code === "SRS-E021" ? "error" : "warning";
}

function tableDiagnosticMessage(options: ParseMarkdownTableOptions): string {
  const label = options.tableLabel ?? "Markdown";
  const subject = options.requirementId ? ` for ${options.requirementId}` : "";
  return `${label} table row cell count does not match header count${subject}`;
}

export function parseMarkdownTableResult(lines: string[], startLine: number, options: ParseMarkdownTableOptions = {}): ParsedTableResult {
  const diagnostics: Diagnostic[] = [];
  let line = startLine;
  while (line < lines.length && lines[line]?.trim() === "") line += 1;
  if (!isTableLine(lines[line] ?? "")) {
    return { diagnostics };
  }
  const headers = splitTableRow(lines[line] ?? "");
  const separatorCells = splitTableRow(lines[line + 1] ?? "");
  if (options.diagnosticCode && isTableLine(lines[line + 1] ?? "") && separatorCells.length !== headers.length) {
    diagnostics.push(
      diagnostic(options.diagnosticCode, severityForTableDiagnostic(options.diagnosticCode), tableDiagnosticMessage(options), {
        ...(options.filePath ? { filePath: options.filePath } : {}),
        line: (options.lineOffset ?? 0) + line + 2,
        ...(options.requirementId ? { requirementId: options.requirementId } : {})
      })
    );
  }
  if (!isSeparator(lines[line + 1] ?? "")) {
    return { diagnostics };
  }
  const rows: Record<string, string>[] = [];
  const rowLines: number[] = [];
  let cursor = line + 2;
  while (cursor < lines.length && isTableLine(lines[cursor] ?? "")) {
    const cells = splitTableRow(lines[cursor] ?? "");
    const sourceLine = (options.lineOffset ?? 0) + cursor + 1;
    if (options.diagnosticCode && cells.length !== headers.length) {
      diagnostics.push(
        diagnostic(options.diagnosticCode, severityForTableDiagnostic(options.diagnosticCode), tableDiagnosticMessage(options), {
          ...(options.filePath ? { filePath: options.filePath } : {}),
          line: sourceLine,
          ...(options.requirementId ? { requirementId: options.requirementId } : {})
        })
      );
    }
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    rows.push(row);
    rowLines.push(sourceLine);
    cursor += 1;
  }
  return { table: { headers, rows, rowLines, startLine: line + 1, endLine: cursor }, diagnostics };
}

export function parseMarkdownTable(lines: string[], startLine: number): ParsedTable | undefined {
  return parseMarkdownTableResult(lines, startLine).table;
}

export function parseMetadataRows(
  lines: string[],
  startLine: number,
  options: Omit<ParseMarkdownTableOptions, "diagnosticCode" | "tableLabel"> = {}
): { metadata: Record<string, string>; endLine: number; diagnostics: Diagnostic[] } {
  const result = parseMarkdownTableResult(lines, startLine, { ...options, diagnosticCode: "SRS-E021", tableLabel: "Metadata" });
  const table = result.table;
  if (!table) return { metadata: {}, endLine: startLine + 1, diagnostics: result.diagnostics };
  const metadata: Record<string, string> = {};
  for (const row of table.rows) {
    const field = row.Field;
    if (field) {
      metadata[field] = row.Value ?? "";
    }
  }
  return { metadata, endLine: table.endLine, diagnostics: result.diagnostics };
}
