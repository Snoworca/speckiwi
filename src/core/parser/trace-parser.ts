import type { TraceLink } from "../types.js";
import type { SectionRange } from "./section-parser.js";
import { parseMarkdownTable } from "./table.js";

export function parseTraceLinksTable(section?: SectionRange): TraceLink[] {
  if (!section) return [];
  const table = parseMarkdownTable(section.lines, 0);
  return (table?.rows ?? [])
    .map((row, index) => ({
      type: row.Type ?? "",
      reference: row.Reference ?? "",
      relation: row.Relation ?? "",
      notes: row.Notes ?? "",
      line: section.contentStartLine + (table?.startLine ?? 1) + 1 + index
    }))
    .filter((row) => row.type !== "" || row.reference !== "" || row.relation !== "" || row.notes !== "");
}
