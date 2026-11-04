import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import type { ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import type { DirtyEdge } from "../query/summary.js";
import { parseMarkdownTable, parseMetadataRows, renderRowByHeader, splitTableRow, type ParsedTable } from "../parser/table.js";
import type { PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";

// FR-NODE-033: origin-aware record lookup. When origin/stepName are omitted the lookup
// prefers the body scope records (backward compatible). When origin=step and a stepName are
// supplied the lookup routes to the matching step record, tagging it with origin/stepName so
// mutation routing can distinguish a promoted step copy from the body copy of the same id.
type RecordOrigin = "body" | "step";

function selectRecord(
  workspace: { records: readonly RequirementRecord[]; stepRecords?: readonly RequirementRecord[] },
  id: string,
  origin?: RecordOrigin,
  stepName?: string
): RequirementRecord | undefined {
  if (origin === "step") {
    const stepRecord = (workspace.stepRecords ?? []).find(
      (candidate) => candidate.id === id && (stepName === undefined || candidate.stepName === stepName)
    );
    if (!stepRecord) return undefined;
    return { ...stepRecord, origin: "step" } as RequirementRecord;
  }
  return workspace.records.find((candidate) => candidate.id === id);
}

function resolveLoadedRecord(record: RequirementRecord, file: TextFile, origin?: RecordOrigin): RequirementRecord {
  // A step record's parsed filePath is the step-scope relative path; surface the absolute
  // path of the file actually loaded so callers can distinguish the step origin on disk.
  if (origin === "step") return { ...record, filePath: file.path } as RequirementRecord;
  return record;
}

export async function loadRecord(
  root: ProjectRoot,
  id: string,
  origin?: RecordOrigin,
  stepName?: string
): Promise<{ record: RequirementRecord; file: TextFile } | undefined> {
  const workspace = await parseWorkspace(root);
  const record = selectRecord(workspace, id, origin, stepName);
  if (!record) return undefined;
  const file = await readUtf8File(path.join(root.root, record.filePath), root.root);
  return { record: resolveLoadedRecord(record, file, origin), file };
}

export async function loadRecordWithWorkspace(
  root: ProjectRoot,
  id: string,
  origin?: RecordOrigin,
  stepName?: string
): Promise<{ record: RequirementRecord; file: TextFile; records: readonly RequirementRecord[] } | undefined> {
  const workspace = await parseWorkspace(root);
  const record = selectRecord(workspace, id, origin, stepName);
  if (!record) return undefined;
  const file = await readUtf8File(path.join(root.root, record.filePath), root.root);
  return { record: resolveLoadedRecord(record, file, origin), file, records: workspace.records };
}

// The row the parser reads the value from: same metadata table, same row selection. A prose line that
// merely reads like a Field name is never in that table.
export function findMetadataLine(file: TextFile, record: RequirementRecord, field: string): number | undefined {
  return parseMetadataRows(file.lines, record.headingLine).fieldLines[field];
}

const ESCAPED_PIPE = String.raw`\|`;

export type MetadataWritePlan =
  | { ok: true; operation: PatchOperation; current: string | undefined }
  | { ok: false; message: string };

export interface MetadataWriteOptions {
  /** Add the row at the end of the metadata table when the field has none. Off: a missing row is refused. */
  insertWhenMissing?: boolean;
}

/**
 * The one writer for a requirement's metadata value. It reads the current value and its row through
 * the parser's metadata reader, finds the table through the parser's table reader, and renders the
 * row by the table's own header, so column order, extra cells and spacing variants the parser
 * accepts all survive, and the value written is the value the parser reads back.
 */
export function planMetadataWrite(
  file: TextFile,
  record: RequirementRecord,
  field: string,
  next: string | ((current: string) => string),
  options: MetadataWriteOptions = {}
): MetadataWritePlan {
  return planFieldValueRowWrite(file, record.headingLine, "Requirement metadata table", field, next, options);
}

/** The index's metadata table (Active Target and the rest), read where the index parser reads it. */
export const INDEX_METADATA_TABLE_START = 1;

/** The same writer for the index document's own metadata table. */
export function planIndexMetadataWrite(
  indexFile: TextFile,
  field: string,
  next: string | ((current: string) => string),
  options: MetadataWriteOptions = {}
): MetadataWritePlan {
  return planFieldValueRowWrite(indexFile, INDEX_METADATA_TABLE_START, "Index metadata table", field, next, options);
}

/** The value the index parser reads for one index metadata field. */
export function readIndexMetadataValue(indexFile: TextFile, field: string): string | undefined {
  return parseMetadataRows(indexFile.lines, INDEX_METADATA_TABLE_START).metadata[field];
}

function planFieldValueRowWrite(
  file: TextFile,
  tableStart: number,
  tableLabel: string,
  field: string,
  next: string | ((current: string) => string),
  options: MetadataWriteOptions
): MetadataWritePlan {
  const table = parseMarkdownTable(file.lines, tableStart);
  if (!table) return { ok: false, message: `${tableLabel} not found` };
  const { metadata, fieldLines } = parseMetadataRows(file.lines, tableStart);
  const current = metadata[field];
  const value = typeof next === "function" ? next(current ?? "") : next;
  const line = fieldLines[field];
  if (line === undefined) {
    if (!options.insertWhenMissing) return { ok: false, message: `${field} metadata row not found` };
    return withCurrent(planTableRowInsert(file, table, { Field: field, Value: value }), current);
  }
  // A value derived from the current one is derived from what the parser read; on a cut row that is
  // only part of the text, so it is refused like any other re-render that would carry cut cells over.
  if (typeof next === "function" && !rowReadWhole(file, table, line)) return cutRowRefusal(`${field} metadata row`);
  return withCurrent(planTableRowUpdate(file, table, table.rowLines.indexOf(line), { Field: field, Value: value }), current);
}

function withCurrent(plan: TableRowPlan, current: string | undefined): MetadataWritePlan {
  return plan.ok ? { ok: true, operation: plan.operation, current } : plan;
}

export type TableRowPlan = { ok: true; operation: PatchOperation } | { ok: false; message: string };

/**
 * The parser splits cells on every `|`, an escaped `\|` included, so such a row reads cut short: its
 * cell count no longer matches the header (SRS-E021), or, when an extra column absorbs the split, the
 * escape itself is the only sign.
 */
export function rowReadWhole(file: TextFile, table: ParsedTable, line: number): boolean {
  const original = file.lines[line - 1] ?? "";
  return splitTableRow(original).length === table.headers.length && !original.includes(ESCAPED_PIPE);
}

function cutRowRefusal(subject: string): { ok: false; message: string } {
  return {
    ok: false,
    message: `${subject} is not one cell per column (an escaped ${ESCAPED_PIPE} splits cells, SRS-E021), so rewriting it would lose text; fix the row first`
  };
}

export interface TableRowWriteOptions {
  /**
   * Columns a table may leave out. A value for one the header lacks is dropped and the write goes on;
   * a value for any other column the header lacks is refused, naming the column, with nothing written,
   * since the row would otherwise be reported written while the parser reads no such value.
   */
  optional?: readonly string[];
}

/** The values the header can hold, or the name of a non-optional column it lacks. */
function valuesForHeader(table: ParsedTable, values: Readonly<Record<string, string>>, options: TableRowWriteOptions): { ok: true; values: Record<string, string> } | { ok: false; message: string } {
  const kept: Record<string, string> = {};
  for (const [column, value] of Object.entries(values)) {
    if (table.headers.includes(column)) kept[column] = value;
    else if (!(options.optional ?? []).includes(column)) {
      return { ok: false, message: `table header [${table.headers.join(", ")}] has no ${column} column, so the ${column} value cannot be written` };
    }
  }
  return { ok: true, values: kept };
}

/**
 * The one row writer for every table the tool edits by column (a metadata table, the Target Map, the
 * index rollups, the Completed Work Log): re-renders row `rowIndex` of a parsed table by the table's
 * own header with `updates` applied, so column order, extra columns and the parser's spacing variants
 * all survive. A row the parser reads cut short is rewritten only when `updates` sets every column,
 * since nothing is carried over then; otherwise the cut cells would be written back and text lost, so
 * it is refused. When nothing is left to change the operation leaves the line as it is.
 */
export function planTableRowUpdate(
  file: TextFile,
  table: ParsedTable,
  rowIndex: number,
  updates: Readonly<Record<string, string>>,
  options: TableRowWriteOptions = {}
): TableRowPlan {
  const line = table.rowLines[rowIndex];
  if (line === undefined) return { ok: false, message: "table row not found" };
  const original = file.lines[line - 1] ?? "";
  const accepted = valuesForHeader(table, updates, options);
  if (!accepted.ok) return accepted;
  if (Object.keys(accepted.values).length === 0) return { ok: true, operation: { type: "replaceLine", line, original, replacement: original } };
  const readWhole = rowReadWhole(file, table, line);
  if (!readWhole && !table.headers.every((header) => Object.hasOwn(accepted.values, header))) return cutRowRefusal(`row ${line}`);
  const rendered = renderRowByHeader(table.headers, { ...(readWhole ? table.rows[rowIndex] : {}), ...accepted.values });
  if (!rendered.ok) return { ok: false, message: rendered.error.message };
  return { ok: true, operation: { type: "replaceLine", line, original, replacement: rendered.value } };
}

/** Appends a row after a parsed table's last row, rendered by the table's own header. */
export function planTableRowInsert(file: TextFile, table: ParsedTable, values: Readonly<Record<string, string>>, options: TableRowWriteOptions = {}): TableRowPlan {
  return planTableRowsInsert(file, table, [values], options);
}

/** Appends several rows, in order, after a parsed table's last row, each rendered by the table's own header. */
export function planTableRowsInsert(
  file: TextFile,
  table: ParsedTable,
  rows: readonly Readonly<Record<string, string>>[],
  options: TableRowWriteOptions = {}
): TableRowPlan {
  const lines: string[] = [];
  for (const values of rows) {
    const accepted = valuesForHeader(table, values, options);
    if (!accepted.ok) return accepted;
    const rendered = renderRowByHeader(table.headers, accepted.values);
    if (!rendered.ok) return { ok: false, message: rendered.error.message };
    lines.push(rendered.value);
  }
  const insertAt = table.endLine + 1;
  const operation: PatchOperation = { type: "insertLines", line: insertAt, lines };
  const expectedBefore = file.lines[insertAt - 2];
  if (expectedBefore !== undefined) operation.expectedBefore = expectedBefore;
  const expectedAfter = file.lines[insertAt - 1];
  if (expectedAfter !== undefined) operation.expectedAfter = expectedAfter;
  return { ok: true, operation };
}

/**
 * The lossless path: edits the metadata row's own text, so nothing the parser would cut is touched.
 * For edits that rewrite a token inside the row (a renamed document) rather than the cell value.
 * Returns `unchanged` when the edit leaves the row as it was.
 */
export function planMetadataRowEdit(
  file: TextFile,
  record: RequirementRecord,
  field: string,
  edit: (rowText: string) => string
): MetadataWritePlan | { ok: true; unchanged: true } {
  const line = findMetadataLine(file, record, field);
  if (line === undefined) return { ok: false, message: `${field} metadata row not found` };
  const original = file.lines[line - 1] ?? "";
  const replacement = edit(original);
  if (replacement === original) return { ok: true, unchanged: true };
  if (/[\r\n]/.test(replacement)) return { ok: false, message: `${field} metadata row edit would break the row across lines` };
  return { ok: true, operation: { type: "replaceLine", line, original, replacement }, current: undefined };
}

/** The raw text of the metadata row the parser reads `field` from, or undefined when there is none. */
export function metadataRowText(file: TextFile, record: RequirementRecord, field: string): string | undefined {
  const line = findMetadataLine(file, record, field);
  return line === undefined ? undefined : file.lines[line - 1];
}

export function findSectionTableInsertionLine(file: TextFile, record: RequirementRecord, sectionName: string): number | undefined {
  const start = record.sectionLines?.[sectionName];
  if (!start) return undefined;
  const end = record.blockEndLine ?? file.lines.length;
  let lastTableLine: number | undefined;
  for (let line = start + 1; line <= end; line += 1) {
    const text = file.lines[line - 1] ?? "";
    if (line > start + 1 && text.startsWith("#### ")) break;
    if (text.trim().startsWith("|")) lastTableLine = line;
  }
  return lastTableLine ? lastTableLine + 1 : start + 1;
}

const CANONICAL_SECTION_ORDER: readonly string[] = [
  "Requirement",
  "Rationale",
  "Acceptance Criteria",
  "Verification Evidence",
  "Trace Links",
  "Research / Analysis",
  "Implementation Notes",
  "Change Notes"
];

export interface SectionInsertionTarget {
  mode: "append";
  line: number;
}

export interface SectionInsertionCreate {
  mode: "create";
  insertAtLine: number;
}

export function findSectionInsertionLine(
  file: TextFile,
  record: RequirementRecord,
  headingText: "Rationale" | "Research / Analysis" | "Implementation Notes"
): SectionInsertionTarget | SectionInsertionCreate | undefined {
  const start = record.sectionLines?.[headingText];
  const end = record.blockEndLine ?? file.lines.length;
  if (start) {
    let lastBodyLine = start;
    for (let line = start + 1; line <= end; line += 1) {
      const text = file.lines[line - 1] ?? "";
      if (text.startsWith("#### ")) break;
      if (text.trim() !== "") lastBodyLine = line;
    }
    return { mode: "append", line: lastBodyLine + 1 };
  }
  const targetIndex = CANONICAL_SECTION_ORDER.indexOf(headingText);
  if (targetIndex < 0) return undefined;
  for (let i = targetIndex + 1; i < CANONICAL_SECTION_ORDER.length; i += 1) {
    const nextHeading = CANONICAL_SECTION_ORDER[i];
    const nextStart = record.sectionLines?.[nextHeading ?? ""];
    if (nextStart) {
      return { mode: "create", insertAtLine: nextStart };
    }
  }
  const changeNotesLine = record.sectionLines?.["Change Notes"];
  if (changeNotesLine) return { mode: "create", insertAtLine: changeNotesLine };
  return { mode: "create", insertAtLine: end };
}

export function findSectionBodyRange(
  file: TextFile,
  record: RequirementRecord,
  headingText: "Rationale" | "Research / Analysis" | "Implementation Notes"
): { startLine: number; endLine: number } | undefined {
  const start = record.sectionLines?.[headingText];
  if (!start) return undefined;
  const end = record.blockEndLine ?? file.lines.length;
  let bodyStart = start + 1;
  while (bodyStart <= end && (file.lines[bodyStart - 1] ?? "").trim() === "") bodyStart += 1;
  let bodyEnd = bodyStart;
  for (let line = bodyStart; line <= end; line += 1) {
    const text = file.lines[line - 1] ?? "";
    if (text.startsWith("#### ")) break;
    if (text.trim() !== "") bodyEnd = line;
  }
  return { startLine: bodyStart, endLine: bodyEnd };
}

// FR-NODE-058 / FR-NODE-072 — vibe/tdd merge contradiction hard-gate. A vibe or
// tdd synthesis/merge flow may only be marked complete once its touched
// dirty-edge closure is contradiction-verified (empty) or the remaining
// contradictions are explicitly acknowledged. Being SYNTHESIZED (a step
// directory exists) is orthogonal to being contradiction-verified, so
// stepDirectoryExists never, by itself, grants completion. For STEP namespace
// flows that are neither vibe nor tdd the diagnostic stays advisory: the gate
// is never enforced and never blocks.
export interface VibeCompletionGateResult {
  allowed: boolean;
  blockedReason?: "dirty-edges-unacknowledged";
  enforced: boolean;
}

export function evaluateVibeCompletionGate(input: {
  vibe: boolean;
  /** FR-NODE-072 — a tdd flow is enforced with vibe parity. */
  tdd?: boolean;
  stepDirectoryExists: boolean;
  dirtyEdges: DirtyEdge[];
  acknowledged: boolean;
}): VibeCompletionGateResult {
  // Advisory-only for flows that are neither vibe nor tdd: the hard-gate never
  // governs the decision.
  if (!input.vibe && !input.tdd) {
    return { allowed: true, enforced: false };
  }
  // An edge is a contradiction unless its classification is "clean".
  const hasContradiction = input.dirtyEdges.some((edge) => edge.classification !== "clean");
  if (hasContradiction && !input.acknowledged) {
    return { allowed: false, blockedReason: "dirty-edges-unacknowledged", enforced: true };
  }
  return { allowed: true, enforced: true };
}
