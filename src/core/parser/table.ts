export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  startLine: number;
  endLine: number;
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

export function parseMarkdownTable(lines: string[], startLine: number): ParsedTable | undefined {
  let line = startLine;
  while (line < lines.length && lines[line]?.trim() === "") line += 1;
  if (!isTableLine(lines[line] ?? "") || !isSeparator(lines[line + 1] ?? "")) {
    return undefined;
  }
  const headers = splitTableRow(lines[line] ?? "");
  const rows: Record<string, string>[] = [];
  let cursor = line + 2;
  while (cursor < lines.length && isTableLine(lines[cursor] ?? "")) {
    const cells = splitTableRow(lines[cursor] ?? "");
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    rows.push(row);
    cursor += 1;
  }
  return { headers, rows, startLine: line + 1, endLine: cursor };
}

export function parseMetadataRows(lines: string[], startLine: number): { metadata: Record<string, string>; endLine: number } {
  const table = parseMarkdownTable(lines, startLine);
  if (!table) return { metadata: {}, endLine: startLine + 1 };
  const metadata: Record<string, string> = {};
  for (const row of table.rows) {
    const field = row.Field;
    if (field) {
      metadata[field] = row.Value ?? "";
    }
  }
  return { metadata, endLine: table.endLine };
}
