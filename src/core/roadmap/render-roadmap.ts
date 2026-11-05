import { renderRowByHeader } from "../parser/table.js";
import type { PatchOperation } from "../patch/patch-plan.js";
import { fail, ok, type Result } from "../result.js";
import { ROADMAP_EMPTY, ROADMAP_FIELDS, ROADMAP_HISTORY_COLUMNS, type RoadmapFieldName } from "./roadmap-grammar.js";
import type { RoadmapItem } from "./roadmap-model.js";

// @req FR-NODE-256 FR-NODE-257 FR-NODE-258
//
// How the roadmap writers render what they write. Every table row goes through the shared row renderer,
// which refuses a value that would split into extra cells or rows, so the writers cannot disagree on the
// form of a row and none of them can emit a broken one.

/** The head of a new roadmap document: its banner, its document table and the items heading. */
export const ROADMAP_DOCUMENT_HEAD: readonly string[] = [
  "# Roadmap",
  "",
  "> A plan record, not a requirement source: what to build is decided by the SRS under `docs/spec`, and each item's status and progress are computed from it by the roadmap tools.",
  "> Change this file only through the roadmap commands (`speckiwi roadmap`); the roadmap check reports a value that no longer matches its Change History.",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | roadmap |",
  "| Schema | 1 |",
  "",
  "## 1. Items"
];

const METADATA_HEADER = ["Field", "Value"] as const;

export interface RoadmapHistoryCells {
  readonly date: string;
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

/** A list cell: the entries joined by `, `, or `-` for none. */
export function formatRoadmapList(entries: readonly string[]): string {
  const kept = entries.map((entry) => entry.trim()).filter((entry) => entry !== "");
  return kept.length === 0 ? ROADMAP_EMPTY : kept.join(", ");
}

/** A single-value cell: the value, or `-` when it is empty. */
export function formatRoadmapValue(value: string): string {
  return value.trim() === "" ? ROADMAP_EMPTY : value.trim();
}

function cellRefusal(label: string): Result<never> {
  return fail("USAGE", `${label} contains a pipe or a line break, which would break the roadmap table`);
}

export function renderRoadmapMetadataRow(field: RoadmapFieldName, value: string): Result<string> {
  const row = renderRowByHeader(METADATA_HEADER, { Field: field, Value: value });
  return row.ok ? row : cellRefusal(field);
}

export function renderRoadmapHistoryRow(cells: RoadmapHistoryCells): Result<string> {
  const row = renderRowByHeader(ROADMAP_HISTORY_COLUMNS, { Date: cells.date, Field: cells.field, From: cells.from, To: cells.to, Reason: cells.reason });
  return row.ok ? row : cellRefusal(`Change History ${cells.field}`);
}

/** Renders every row in order, or the first refusal. */
export function renderAll<T>(values: readonly T[], render: (value: T) => Result<string>): Result<string[]> {
  const rows: string[] = [];
  for (const value of values) {
    const row = render(value);
    if (!row.ok) return row;
    rows.push(row.value);
  }
  return ok(rows);
}

export interface RoadmapItemBlock {
  readonly id: string;
  readonly title: string;
  readonly values: Readonly<Record<RoadmapFieldName, string>>;
  readonly purpose: string;
  readonly history: readonly RoadmapHistoryCells[];
}

/** The lines of one item, from its heading to its last history row. */
export function renderRoadmapItem(block: RoadmapItemBlock): Result<string[]> {
  const metadata = renderAll(ROADMAP_FIELDS, (field) => renderRoadmapMetadataRow(field, block.values[field]));
  if (!metadata.ok) return metadata;
  const history = renderAll(block.history, renderRoadmapHistoryRow);
  if (!history.ok) return history;
  return ok([
    `### ${block.id} — ${block.title}`,
    "",
    "| Field | Value |",
    "|---|---|",
    ...metadata.value,
    "",
    "#### Purpose",
    "",
    ...block.purpose.split(/\r?\n/),
    "",
    "#### Change History",
    "",
    `| ${ROADMAP_HISTORY_COLUMNS.join(" | ")} |`,
    `|${ROADMAP_HISTORY_COLUMNS.map(() => "---").join("|")}|`,
    ...history.value
  ]);
}

/**
 * The operation that appends `rows` to an item's Change History: after the table's last row, or — for
 * an item written without the section — as a new section at the item's end. An item whose section has
 * no readable table gets undefined: where its rows belong is not something a writer should guess.
 */
export function planHistoryRows(item: RoadmapItem, lines: readonly string[], rows: readonly string[]): PatchOperation | undefined {
  if (item.historyTableLastLine !== undefined) {
    return { type: "insertLines", line: item.historyTableLastLine + 1, lines: [...rows], expectedBefore: lines[item.historyTableLastLine - 1] ?? "" };
  }
  if (item.sections["Change History"]) return undefined;
  return {
    type: "insertLines",
    line: item.lastLine + 1,
    lines: ["", "#### Change History", "", `| ${ROADMAP_HISTORY_COLUMNS.join(" | ")} |`, `|${ROADMAP_HISTORY_COLUMNS.map(() => "---").join("|")}|`, ...rows],
    expectedBefore: lines[item.lastLine - 1] ?? ""
  };
}
