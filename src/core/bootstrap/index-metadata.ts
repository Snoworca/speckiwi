// @req FR-NODE-091 @req FR-NODE-085
//
// The index metadata table is the two-column `| Field | Value |` table under the document heading. Two
// things need to agree about it: init's Rules-pointer refresh and the migration's Rules-row insertion.
//
// Matching a metadata row by the raw prefix `| Rules |` is not safe. A scope named `Rules` produces
// `| Rules | [01.rules.srs.md](./01.rules.srs.md) | RULE | ... |` in both the SRS Documents table and
// the Scope Map, and a prefix test replaces those author rows with the metadata pointer — unregistering
// the scope document in both sections with validation still clean. Cell count is what separates them.

/** Inclusive line-index range of a table. */
export interface TableRange {
  first: number;
  last: number;
}

/** The cells of a markdown table row, trimmed; empty for a line that is not a table row. */
export function tableCells(line: string | undefined): string[] {
  const trimmed = line?.trim() ?? "";
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return [];
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

/**
 * Whether a line is the metadata table's Rules row. Two cells whose first is `Rules` — so a scope row
 * carrying more columns never matches, and a row written without the template's spacing still does.
 */
export function isRulesMetadataRow(line: string | undefined): boolean {
  const cells = tableCells(line);
  return cells.length === 2 && cells[0] === "Rules";
}

/**
 * The `| Field | Value |` metadata table, or undefined when the index has none. Located by its header
 * rather than by "the first table in the file": an index that opens with a summary table would
 * otherwise have the Rules row inserted into that table, leaving the real one still missing it.
 */
export function findMetadataTableRange(lines: readonly string[]): TableRange | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const cells = tableCells(lines[index]);
    if (cells.length !== 2 || cells[0]?.toLowerCase() !== "field" || cells[1]?.toLowerCase() !== "value") continue;
    let last = index;
    while (last + 1 < lines.length && tableCells(lines[last + 1]).length > 0) last += 1;
    return { first: index, last };
  }
  return undefined;
}
