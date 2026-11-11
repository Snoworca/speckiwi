import { isDateStamp, todayStamp } from "../date-stamp.js";
import type { ChangeNoteRow, EvidenceRow, TraceLink } from "../types.js";

/**
 * The text a caller's value stands for in a written cell, or undefined when it has none.
 *
 * A string, number or boolean is its own text. An object, an array or `null` has no text that could
 * be written as given: `String()` turns it into `[object Object]`, an empty string or `null`, and the
 * row is written with every given value lost. @req FR-NODE-281
 */
export function textOf(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
}

/** How a value {@link textOf} rejects is named in a refusal. */
export function describeNonText(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : "an object";
}

const EVIDENCE_ROW_KEYS = ["id", "type", "reference", "covers", "notes"] as const;
const TRACE_ROW_KEYS = ["type", "reference", "relation", "notes"] as const;

type RowCells<K extends string> = Partial<Record<K, string>>;

type NormalizedRows<K extends string> = { ok: true; rows: Array<RowCells<K>> } | { ok: false; message: string };

function isKnownKey<K extends string>(keys: readonly K[], key: string): key is K {
  return (keys as readonly string[]).includes(key);
}

/** How one kind of row is named in a refusal, which keys it takes, and which of them must hold text. */
interface RowKind<K extends string> {
  label: string;
  noun: string;
  keys: readonly K[];
  required: readonly K[];
}

const EVIDENCE_ROWS: RowKind<(typeof EVIDENCE_ROW_KEYS)[number]> = { label: "Evidence", noun: "evidence", keys: EVIDENCE_ROW_KEYS, required: ["reference"] };
const TRACE_ROWS: RowKind<(typeof TRACE_ROW_KEYS)[number]> = { label: "Trace", noun: "trace", keys: TRACE_ROW_KEYS, required: ["reference"] };
const CHANGE_NOTE_ROWS: RowKind<"date" | "change" | "reason"> = { label: "changeNotes", noun: "change note", keys: ["date", "change", "reason"], required: ["change", "reason"] };

function normalizeRows<K extends string>(kind: RowKind<K>, rows: readonly unknown[]): NormalizedRows<K> {
  const { label, noun, keys } = kind;
  const normalized: Array<RowCells<K>> = [];
  for (const [index, row] of rows.entries()) {
    const name = `${label} row ${index + 1}`;
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return { ok: false, message: `${name} is not an object; a row is an object of ${keys.join(", ")}` };
    }
    const cells: RowCells<K> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!isKnownKey(keys, key)) return { ok: false, message: `${name} key "${key}" is not a ${noun} row key; the keys are ${keys.join(", ")}` };
      if (value === undefined) continue;
      const text = textOf(value);
      if (text === undefined) return { ok: false, message: `${name} key "${key}" holds ${describeNonText(value)}, which cannot be written as given; a cell takes text` };
      cells[key] = text;
    }
    // A row without its required cell holds nothing the caller gave but defaults, the row
    // add_verification_evidence refuses as "Evidence reference is required".
    const missing = kind.required.find((key) => !cells[key]?.trim());
    if (missing !== undefined) return { ok: false, message: `${name} key "${missing}" is required` };
    normalized.push(cells);
  }
  return { ok: true, rows: normalized };
}

/** The string form of one Change Notes row, as an example. @req FR-NODE-305 AC-5 */
export const CHANGE_NOTE_STRING_EXAMPLE = '"2026-11-12 | Added | #4920"';

/**
 * The forms `changeNotes` takes: shown with every refusal of it and as its MCP schema description,
 * so the two cannot name different forms. @req FR-NODE-305 AC-3 AC-5
 */
export const CHANGE_NOTES_FORMS = `changeNotes takes rows such as [{"change": "Added", "reason": "#4920", "date": "2026-11-12"}] (date optional, today's local date when omitted) or the string ${CHANGE_NOTE_STRING_EXAMPLE}`;

/** The one form the CLI `--change-notes` takes, shown with its refusals instead of both. */
const CLI_CHANGE_NOTES_FORM = `changeNotes takes the string "date | change | reason" with a YYYY-MM-DD date, such as ${CHANGE_NOTE_STRING_EXAMPLE}`;

/** Which surface handed in `changeNotes`, so a refusal names only the forms that surface takes. */
export type ChangeNotesSurface = "mcp" | "cli";

type NormalizedChangeNotes = { ok: true; rows: ChangeNoteRow[] | undefined } | { ok: false; message: string };

/**
 * `changeNotes` as the rows it writes: objects in `add_change_note`'s keys from MCP, or the string
 * `date | change | reason` from MCP or the CLI, each dated by the one rule (FR-NODE-205 AC-7).
 * @req FR-NODE-305 AC-1 AC-2 AC-3 AC-4
 */
function normalizeChangeNotes(value: unknown, surface: ChangeNotesSurface): NormalizedChangeNotes {
  if (value === undefined) return { ok: true, rows: undefined };
  const forms = surface === "cli" ? CLI_CHANGE_NOTES_FORM : CHANGE_NOTES_FORMS;
  const refuse = (message: string): NormalizedChangeNotes => ({ ok: false, message: `${message}; ${forms}` });
  let given: Array<RowCells<"date" | "change" | "reason">>;
  if (typeof value === "string") {
    const cells = value.split("|").map((cell) => cell.trim());
    if (cells.length !== 3 || cells.some((cell) => !cell)) return refuse(`changeNotes row 1 "${value}" is not the three cells date | change | reason`);
    const [date = "", change = "", reason = ""] = cells;
    given = [{ date, change, reason }];
  } else if (Array.isArray(value)) {
    if (value.length === 0) return refuse("changeNotes holds no row");
    const read = normalizeRows(CHANGE_NOTE_ROWS, value);
    if (!read.ok) return refuse(read.message);
    given = read.rows;
  } else {
    return refuse(`changeNotes is ${describeNonText(value)}`);
  }
  const rows: ChangeNoteRow[] = [];
  for (const [index, cells] of given.entries()) {
    const date = cells.date ?? todayStamp();
    if (!isDateStamp(date)) return refuse(`changeNotes row ${index + 1} date "${date}" does not use YYYY-MM-DD`);
    rows.push({ date, change: cells.change ?? "", reason: cells.reason ?? "" });
  }
  return { ok: true, rows };
}

export type NormalizedSeedRows =
  | { ok: true; evidence: Array<Partial<EvidenceRow>>; trace: Array<Partial<TraceLink>>; changeNotes: ChangeNoteRow[] | undefined }
  | { ok: false; message: string };

/**
 * The one reader of the evidence, trace and Change Notes rows a new requirement is seeded with.
 *
 * The CLI hands it the rows it split from `type|reference|…` strings and MCP hands it the objects the
 * caller sent, so both channels refuse the same row: a key the row does not know, a cell that is
 * not text, or a row with no reference. Before this, MCP wrote such a row with the defaults in every misspelled cell and
 * `[object Object]` in every structured one. @req FR-NODE-281 AC-6 @req FR-NODE-305 AC-4
 */
export function normalizeSeedRows(input: {
  evidence?: readonly unknown[] | undefined;
  trace?: readonly unknown[] | undefined;
  changeNotes?: unknown;
  changeNotesSurface?: ChangeNotesSurface | undefined;
}): NormalizedSeedRows {
  const evidence = normalizeRows(EVIDENCE_ROWS, input.evidence ?? []);
  if (!evidence.ok) return evidence;
  const trace = normalizeRows(TRACE_ROWS, input.trace ?? []);
  if (!trace.ok) return trace;
  const changeNotes = normalizeChangeNotes(input.changeNotes, input.changeNotesSurface ?? "mcp");
  if (!changeNotes.ok) return changeNotes;
  return { ok: true, evidence: evidence.rows, trace: trace.rows, changeNotes: changeNotes.rows };
}
