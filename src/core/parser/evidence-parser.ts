import type { EvidenceRow } from "../types.js";
import type { SectionRange } from "./section-parser.js";
import { parseMarkdownTable } from "./table.js";

export function parseEvidenceTable(section?: SectionRange): EvidenceRow[] {
  if (!section) return [];
  const table = parseMarkdownTable(section.lines, 0);
  return (table?.rows ?? [])
    .map((row, index) => ({
      id: row["Evidence ID"] ?? "",
      type: row.Type ?? "",
      reference: row.Reference ?? "",
      covers: row.Covers ?? "",
      notes: row.Notes ?? "",
      line: section.contentStartLine + (table?.startLine ?? 1) + 1 + index
    }))
    .filter((row) => row.id !== "" || row.type !== "" || row.reference !== "" || row.covers !== "" || row.notes !== "");
}
