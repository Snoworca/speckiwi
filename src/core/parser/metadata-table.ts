import { parseMetadataRows } from "./table.js";
import { parseTopLevelSectionTitle, type RequirementBlockRange } from "./block-scanner.js";
import { classifyDocumentLines } from "./document-lines.js";

export function parseMetadataTable(block: RequirementBlockRange, lines: string[]): { metadata: Record<string, string>; endLine: number } {
  return parseMetadataRows(lines, block.startLine);
}

const SDS_STATUS_ROW = /^\|\s*Status\s*\|\s*([^|]*?)\s*\|\s*$/;

/**
 * A step design.md's metadata Status row: the first `| Status | <value> |` body line before the first
 * top-level section heading, with its 0-based index and trimmed value. A row or a `## ` line shown in a
 * fence, indented code or an HTML comment is an example, not the document's structure. set-sds-status
 * and list_steps both ask it, so the row one writes is the row the other reads. @req FR-NODE-260 AC-2
 */
export function findSdsStatusRow(lines: readonly string[]): { index: number; value: string } | undefined {
  const classified = classifyDocumentLines(lines);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (classified[index]?.body !== true) continue;
    if (parseTopLevelSectionTitle(line) !== undefined) return undefined;
    const match = SDS_STATUS_ROW.exec(line);
    if (match) return { index, value: (match[1] ?? "").trim() };
  }
  return undefined;
}
