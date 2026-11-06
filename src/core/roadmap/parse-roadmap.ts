import { diagnostic } from "../diagnostic.js";
import { splitLines } from "../fs/newline.js";
import { classifyDocumentLines, SRS_RECORD_LINES } from "../parser/document-lines.js";
import { isTableLine, parseMarkdownTableResult, splitTableRow } from "../parser/table.js";
import type { Diagnostic } from "../types.js";
import { endsBefore, isRoadmapDay, parseRoadmapDate, roadmapDateRange } from "./roadmap-dates.js";
import {
  ROADMAP_EMPTY,
  ROADMAP_FIELDS,
  ROADMAP_HISTORY_CHECKED_FIELDS,
  ROADMAP_HISTORY_COLUMNS,
  ROADMAP_ITEM_HEADING,
  ROADMAP_KINDS,
  ROADMAP_LIFECYCLES,
  ROADMAP_PATH,
  ROADMAP_SECTIONS,
  type RoadmapDiagnosticCode,
  type RoadmapFieldName,
  type RoadmapSectionName
} from "./roadmap-grammar.js";
import type { RoadmapDateRange, RoadmapDocument, RoadmapFieldValue, RoadmapHistoryRow, RoadmapItem, RoadmapParse, RoadmapSection, RoadmapSources } from "./roadmap-model.js";

// @req FR-PARSE-046
//
// The roadmap parser. It is a pure function of the document text and the SRS facts in `sources`: it
// reads no file and no clock, so the same inputs give byte-identical diagnostics on every run and every
// date. Lateness is a computed value (FR-NODE-255), never a diagnostic, for the same reason. Reading the
// file is load-roadmap.ts's job.
//
// One extent rule (FR-NODE-268 AC-4): an item is every line from its heading to the next heading of
// level 1 to 3 outside code (so a later chapter heading also ends the last item), and a section every
// line from its `####` heading to the next `####` heading outside code, whether the reader knows that
// heading or not. Lines inside code fences and HTML comment blocks are never structure — the shared
// line classifier says which lines those are, as it does for every SRS reader — but they belong to the
// item and the section they sit in.

/** A heading that ends an item: level 1 to 3. */
const ITEM_BOUNDARY = /^#{1,3} /;
const SECTION_PREFIX = "#### ";
const SECTION_HEADING = /^#### (.+?)\s*$/;

/**
 * Whether a line outside code is a heading this reader takes as an item or section boundary. The
 * Description and Features writers refuse a value holding one (FR-NODE-268 AC-5).
 */
export function isRoadmapBoundaryHeading(line: string): boolean {
  return ITEM_BOUNDARY.test(line) || line.startsWith(SECTION_PREFIX);
}
const ACCEPTANCE_LINE = /^\s*- \[[ xX]\] AC-\d+/;
const STATUS_FIELD = "Status";

function roadmapDiagnostic(code: RoadmapDiagnosticCode, message: string, line: number): Diagnostic {
  return diagnostic(code, code.startsWith("ROADMAP-W") ? "warning" : "error", message, { filePath: ROADMAP_PATH, line });
}

/** The lines without the blank lines at their start and at their end. @req FR-NODE-268 AC-5 */
export function withoutOuterBlankLines(lines: readonly string[]): string[] {
  const isBlank = (line: string) => line.trim() === "";
  const first = lines.findIndex((line) => !isBlank(line));
  if (first < 0) return [];
  const last = lines.length - 1 - [...lines].reverse().findIndex((line) => !isBlank(line));
  return lines.slice(first, last + 1);
}

/** The last non-blank line from `from` through `to` (1-based), or `from - 1` when all are blank. */
function lastNonBlankLine(lines: readonly string[], from: number, to: number): number {
  for (let line = to; line >= from; line -= 1) if ((lines[line - 1] ?? "").trim() !== "") return line;
  return from - 1;
}

/** The entries of a list cell (`a, b`); `-` and an empty cell are the empty list. */
export function roadmapList(value: string | undefined): string[] {
  const trimmed = (value ?? ROADMAP_EMPTY).trim();
  if (trimmed === ROADMAP_EMPTY || trimmed === "") return [];
  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** An item's value for `field`, `-` when the row is missing. */
export function roadmapFieldValue(item: RoadmapItem, field: RoadmapFieldName): string {
  return item.fields[field]?.value ?? ROADMAP_EMPTY;
}

/** 1-based first and last line of an extent. */
interface Extent {
  line: number;
  endLine: number;
}

interface ItemDraft extends Extent {
  id: string;
  number: number;
  title: string;
  /** The last line of the metadata part: the line before the item's first `####` heading. */
  metadataEndLine?: number;
  sections: Map<RoadmapSectionName, Extent>;
}

interface Scan {
  drafts: ItemDraft[];
  /** Whether each line is document structure rather than code or comment text. */
  body: boolean[];
  unclosedFenceLine?: number;
  diagnostics: Diagnostic[];
}

/** Splits the document into item and section extents; reports headings, sections and criterion lines on the way. */
function scanItems(lines: readonly string[]): Scan {
  const classified = classifyDocumentLines(lines, SRS_RECORD_LINES);
  const body = classified.map((line) => line.body);
  const unclosed = classified.findIndex((line) => line.unclosed === true);
  const drafts: ItemDraft[] = [];
  const diagnostics: Diagnostic[] = [];
  let current: ItemDraft | undefined;
  let section: Extent | undefined;
  const close = (endLine: number) => {
    if (section) section.endLine = endLine;
    if (current) {
      current.endLine = endLine;
      current.metadataEndLine ??= endLine;
    }
    section = undefined;
  };
  lines.forEach((text, index) => {
    if (!body[index]) return;
    const line = index + 1;
    if (ITEM_BOUNDARY.test(text)) {
      close(line - 1);
      current = undefined;
      const heading = ROADMAP_ITEM_HEADING.exec(text);
      if (heading) {
        current = { id: heading[1]!, number: Number(heading[2]), title: heading[3]!.trim(), line, endLine: line, sections: new Map() };
        drafts.push(current);
      } else if (text.startsWith("### RM-")) {
        diagnostics.push(roadmapDiagnostic("ROADMAP-E001", `Malformed roadmap item heading: ${text.trim()}`, line));
      }
      return;
    }
    if (!current) return;
    const sectionHeading = text.startsWith(SECTION_PREFIX) ? SECTION_HEADING.exec(text) : null;
    if (sectionHeading) {
      if (section) section.endLine = line - 1;
      current.metadataEndLine ??= line - 1;
      // Every `####` heading ends the section before it; only a known, first-seen one starts a section.
      section = { line, endLine: line };
      const name = sectionHeading[1]!;
      if (!(ROADMAP_SECTIONS as readonly string[]).includes(name)) {
        diagnostics.push(roadmapDiagnostic("ROADMAP-E003", `${current.id} has an unknown section: ${name}`, line));
      } else if (current.sections.has(name as RoadmapSectionName)) {
        diagnostics.push(roadmapDiagnostic("ROADMAP-E003", `${current.id} repeats the section ${name}`, line));
      } else {
        current.sections.set(name as RoadmapSectionName, section);
      }
      return;
    }
    if (ACCEPTANCE_LINE.test(text)) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-E017", `${current.id} carries an acceptance criterion; criteria belong to requirements`, line));
    }
  });
  close(lines.length);
  return { drafts, body, diagnostics, ...(unclosed >= 0 ? { unclosedFenceLine: unclosed + 1 } : {}) };
}

/** The 0-based indexes of the structure lines from `from` through `to` (1-based). */
function bodyIndexes(scan: Scan, from: number, to: number): number[] {
  const indexes: number[] = [];
  for (let index = from - 1; index < to; index += 1) if (scan.body[index]) indexes.push(index);
  return indexes;
}

/** The first table among `indexes`, read by the shared table parser, with the table lines it skipped. */
function firstTable(lines: string[], indexes: readonly number[]) {
  const start = indexes.find((index) => isTableLine(lines[index] ?? ""));
  if (start === undefined) return undefined;
  const parsed = parseMarkdownTableResult(lines, start);
  return { start, table: parsed.table };
}

function readMetadata(lines: string[], scan: Scan, draft: ItemDraft, diagnostics: Diagnostic[]): Partial<Record<RoadmapFieldName, RoadmapFieldValue>> {
  const fields: Partial<Record<RoadmapFieldName, RoadmapFieldValue>> = {};
  const found = firstTable(lines, bodyIndexes(scan, draft.line + 1, draft.metadataEndLine ?? draft.endLine));
  const table = found?.table;
  if (found && (!table || table.headers.join("|") !== "Field|Value")) {
    diagnostics.push(roadmapDiagnostic("ROADMAP-E003", `${draft.id} metadata table must have the header | Field | Value |`, found.start + 1));
  } else if (table) {
    table.rows.forEach((row, index) => {
      const field = (row.Field ?? "").trim();
      const line = table.rowLines[index]!;
      if (field === STATUS_FIELD) {
        diagnostics.push(roadmapDiagnostic("ROADMAP-E017", `${draft.id} has a Status row; status is computed from the SRS`, line));
      } else if (!(ROADMAP_FIELDS as readonly string[]).includes(field)) {
        diagnostics.push(roadmapDiagnostic("ROADMAP-E003", `${draft.id} has an unknown metadata row: ${field}`, line));
      } else if (fields[field as RoadmapFieldName]) {
        diagnostics.push(roadmapDiagnostic("ROADMAP-E003", `${draft.id} repeats the metadata row ${field}`, line));
      } else {
        fields[field as RoadmapFieldName] = { value: (row.Value ?? "").trim(), line };
      }
    });
  }
  for (const field of ROADMAP_FIELDS) {
    if (!fields[field]) diagnostics.push(roadmapDiagnostic("ROADMAP-E003", `${draft.id} is missing the metadata row ${field}`, draft.line));
  }
  return fields;
}

function readHistory(lines: string[], scan: Scan, draft: ItemDraft, diagnostics: Diagnostic[]): { rows: RoadmapHistoryRow[]; lastLine?: number } {
  const extent = draft.sections.get("Change History");
  const indexes = extent ? bodyIndexes(scan, extent.line + 1, extent.endLine) : [];
  const found = firstTable(lines, indexes);
  const table = found?.table;
  const malformed = (line: number, why: string) => diagnostics.push(roadmapDiagnostic("ROADMAP-E016", `${draft.id} Change History ${why}`, line));
  const rows: RoadmapHistoryRow[] = [];
  const read = new Set<number>();
  let lastLine: number | undefined;
  if (found && table && table.headers.join("|") === ROADMAP_HISTORY_COLUMNS.join("|")) {
    read.add(found.start).add(found.start + 1);
    lastLine = table.endLine;
    table.rowLines.forEach((line) => {
      read.add(line - 1);
      const cells = splitTableRow(lines[line - 1] ?? "");
      if (cells.length !== ROADMAP_HISTORY_COLUMNS.length) return malformed(line, `row has ${cells.length} cells instead of ${ROADMAP_HISTORY_COLUMNS.length}`);
      const [date, field, from, to, reason] = cells as [string, string, string, string, string];
      if (!isRoadmapDay(date)) return malformed(line, `row date is not YYYY-MM-DD: ${date}`);
      rows.push({ date, field, from, to, reason, line });
    });
  }
  // A table line the history table did not take — a wrong header, a missing separator, a second table
  // — is a row no reader can use.
  for (const index of indexes) {
    if (!read.has(index) && isTableLine(lines[index] ?? "")) malformed(index + 1, "row is outside a | Date | Field | From | To | Reason | table");
  }
  return lastLine === undefined ? { rows } : { rows, lastLine };
}

/**
 * Each section's text. Description and Features are free prose and keep every line of their extent as
 * written, code and comment lines included (FR-NODE-268 AC-5); Purpose and Change History keep the text
 * they always had, their structure lines trimmed.
 */
function sectionsOf(lines: string[], scan: Scan, draft: ItemDraft): Partial<Record<RoadmapSectionName, RoadmapSection>> {
  const sections: Partial<Record<RoadmapSectionName, RoadmapSection>> = {};
  for (const [name, extent] of draft.sections) {
    const text =
      name === "Description" || name === "Features"
        ? withoutOuterBlankLines(lines.slice(extent.line, extent.endLine)).join("\n")
        : bodyIndexes(scan, extent.line + 1, extent.endLine)
            .map((index) => lines[index] ?? "")
            .join("\n")
            .trim();
    sections[name] = { line: extent.line, lastLine: lastNonBlankLine(lines, extent.line + 1, extent.endLine), text };
  }
  return sections;
}

function buildItems(lines: string[], scan: Scan): RoadmapItem[] {
  return scan.drafts.map((draft) => {
    const fields = readMetadata(lines, scan, draft, scan.diagnostics);
    const history = readHistory(lines, scan, draft, scan.diagnostics);
    return {
      id: draft.id,
      number: draft.number,
      title: draft.title,
      line: draft.line,
      lastLine: lastNonBlankLine(lines, draft.line + 1, draft.endLine),
      fields,
      sections: sectionsOf(lines, scan, draft),
      history: history.rows,
      ...(history.lastLine !== undefined ? { historyTableLastLine: history.lastLine } : {})
    };
  });
}

function fieldLine(item: RoadmapItem, field: RoadmapFieldName): number {
  return item.fields[field]?.line ?? item.line;
}

/** E004, E005, E006 and W016: the item's own values. */
function checkValues(item: RoadmapItem, diagnostics: Diagnostic[]): void {
  const value = (field: RoadmapFieldName) => roadmapFieldValue(item, field);
  for (const [field, allowed] of [["Kind", ROADMAP_KINDS], ["Lifecycle", ROADMAP_LIFECYCLES]] as const) {
    if (item.fields[field] && !(allowed as readonly string[]).includes(value(field))) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-E004", `${item.id} ${field} must be ${allowed.join(", ")}: ${value(field)}`, fieldLine(item, field)));
    }
  }
  const pairs = [
    ["Planned Start", "Planned End", true],
    ["Actual Start", "Actual End", false]
  ] as const;
  for (const [startField, endField, coarse] of pairs) {
    for (const field of [startField, endField]) {
      if (item.fields[field] && parseRoadmapDate(value(field), coarse).kind === "invalid") {
        const forms = coarse ? "-, YYYY-MM-DD, YYYY-MM or YYYY-Qn" : "- or YYYY-MM-DD";
        diagnostics.push(roadmapDiagnostic("ROADMAP-E005", `${item.id} ${field} must be ${forms}: ${value(field)}`, fieldLine(item, field)));
      }
    }
    const start = roadmapDateRange(value(startField), coarse);
    const end = roadmapDateRange(value(endField), coarse);
    if (start && end && endsBefore(end, start)) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-E006", `${item.id} ${endField} ${end.raw} is earlier than ${startField} ${start.raw}`, fieldLine(item, endField)));
    }
  }
  for (const field of ROADMAP_HISTORY_CHECKED_FIELDS) {
    const last = [...item.history].reverse().find((row) => row.field === field);
    if (last && item.fields[field] && value(field) !== last.to) {
      diagnostics.push(
        roadmapDiagnostic("ROADMAP-W016", `${item.id} ${field} is ${value(field)} but its last Change History row records ${last.to}`, fieldLine(item, field))
      );
    }
  }
}

/** E007 and E008: Milestone and Depends On. */
function checkItemReferences(items: readonly RoadmapItem[], diagnostics: Diagnostic[]): void {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    const milestone = roadmapFieldValue(item, "Milestone");
    if (milestone !== ROADMAP_EMPTY) {
      const parent = byId.get(milestone);
      const line = fieldLine(item, "Milestone");
      if (!parent) diagnostics.push(roadmapDiagnostic("ROADMAP-E007", `${item.id} Milestone names no item: ${milestone}`, line));
      else if (roadmapFieldValue(item, "Kind") === "milestone") diagnostics.push(roadmapDiagnostic("ROADMAP-E007", `${item.id} is a milestone and cannot have a Milestone`, line));
      else if (roadmapFieldValue(parent, "Kind") !== "milestone") diagnostics.push(roadmapDiagnostic("ROADMAP-E007", `${item.id} Milestone ${milestone} is not a milestone item`, line));
    }
    const dependsOn = roadmapList(roadmapFieldValue(item, "Depends On"));
    for (const dependency of dependsOn.filter((entry) => !byId.has(entry))) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-E007", `${item.id} Depends On names no item: ${dependency}`, fieldLine(item, "Depends On")));
    }
    if (milestone !== ROADMAP_EMPTY && dependsOn.includes(milestone)) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-E008", `${item.id} depends on its own milestone ${milestone}`, fieldLine(item, "Depends On")));
    }
  }
  // Depth-first over Depends On, in document order; each back edge closes one cycle.
  const state = new Map<string, "open" | "done">();
  const visit = (item: RoadmapItem, path: string[]): void => {
    state.set(item.id, "open");
    for (const dependency of roadmapList(roadmapFieldValue(item, "Depends On"))) {
      const next = byId.get(dependency);
      if (!next) continue;
      if (state.get(dependency) === "open") {
        const cycle = [...path.slice(path.indexOf(dependency)), item.id, dependency];
        diagnostics.push(roadmapDiagnostic("ROADMAP-E008", `Depends On cycle: ${cycle.join(" -> ")}`, fieldLine(item, "Depends On")));
      } else if (!state.has(dependency)) {
        visit(next, [...path, item.id]);
      }
    }
    state.set(item.id, "done");
  };
  for (const item of items) if (!state.has(item.id)) visit(item, []);
}

/** W009, W010, W011: names the SRS and the PRD files must know. */
function checkSourceReferences(items: readonly RoadmapItem[], sources: RoadmapSources, diagnostics: Diagnostic[]): void {
  const targets = new Set(sources.targets.map((entry) => entry.target.trim()));
  const live = new Set(sources.requirements.filter((record) => record.status !== "discarded").map((record) => record.id));
  const prdFiles = new Set(sources.prdFiles);
  for (const item of items) {
    for (const target of roadmapList(roadmapFieldValue(item, "Targets")).filter((entry) => !targets.has(entry))) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-W009", `${item.id} names a target the Target Map does not register: ${target}`, fieldLine(item, "Targets")));
    }
    for (const id of roadmapList(roadmapFieldValue(item, "Requirements")).filter((entry) => !live.has(entry))) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-W010", `${item.id} names a requirement that is missing or discarded: ${id}`, fieldLine(item, "Requirements")));
    }
    for (const prd of roadmapList(roadmapFieldValue(item, "PRD")).filter((entry) => !prdFiles.has(entry))) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-W011", `${item.id} names a PRD path that is not a PRD file: ${prd}`, fieldLine(item, "PRD")));
    }
  }
}

function plannedRange(item: RoadmapItem): { start: RoadmapDateRange | null; end: RoadmapDateRange | null } {
  return { start: roadmapDateRange(roadmapFieldValue(item, "Planned Start"), true), end: roadmapDateRange(roadmapFieldValue(item, "Planned End"), true) };
}

/** W012 and W013: plans that contradict the items they depend on or belong to. */
function checkPlans(items: readonly RoadmapItem[], diagnostics: Diagnostic[]): void {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    const own = plannedRange(item);
    for (const dependency of roadmapList(roadmapFieldValue(item, "Depends On"))) {
      const other = byId.get(dependency);
      const otherEnd = other ? plannedRange(other).end : null;
      if (own.start && otherEnd && endsBefore(own.start, otherEnd)) {
        diagnostics.push(
          roadmapDiagnostic("ROADMAP-W012", `${item.id} is planned to start ${own.start.raw}, before ${dependency} is planned to end ${otherEnd.raw}`, fieldLine(item, "Planned Start"))
        );
      }
    }
    const parent = byId.get(roadmapFieldValue(item, "Milestone"));
    if (!parent || roadmapFieldValue(item, "Kind") !== "feature" || roadmapFieldValue(parent, "Kind") !== "milestone") continue;
    const outer = plannedRange(parent);
    const earliest = own.start ?? own.end;
    const latest = own.end ?? own.start;
    const before = earliest && outer.start && endsBefore(earliest, outer.start);
    const after = latest && outer.end && endsBefore(outer.end, latest);
    if (before || after) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-W013", `${item.id} is planned outside the planned range of its milestone ${parent.id}`, item.line));
    }
  }
}

// @req FR-PARSE-046 AC-1 AC-2 AC-3 AC-4 AC-5 AC-6 AC-7 AC-8
export function parseRoadmap(text: string, sources: RoadmapSources): RoadmapParse {
  const lines = splitLines(text);
  const scan = scanItems(lines);
  const items = buildItems(lines, scan);
  const diagnostics = scan.diagnostics;
  items.forEach((item, index) => {
    if (item.number !== index + 1) {
      diagnostics.push(roadmapDiagnostic("ROADMAP-E002", `${item.id} is out of sequence; item ${index + 1} must be RM-${index + 1}`, item.line));
    }
    checkValues(item, diagnostics);
  });
  checkItemReferences(items, diagnostics);
  checkSourceReferences(items, sources, diagnostics);
  checkPlans(items, diagnostics);
  const document: RoadmapDocument = { items, ...(scan.unclosedFenceLine !== undefined ? { unclosedFenceLine: scan.unclosedFenceLine } : {}) };
  return { document, diagnostics: sortRoadmapDiagnostics(diagnostics) };
}

/** Diagnostics in line order; the sort is stable, so one line keeps the order the checks ran in. */
export function sortRoadmapDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}
