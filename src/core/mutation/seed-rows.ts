import type { EvidenceRow, TraceLink } from "../types.js";

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

function normalizeRows<K extends string>(label: string, keys: readonly K[], rows: readonly unknown[]): NormalizedRows<K> {
  const normalized: Array<RowCells<K>> = [];
  for (const [index, row] of rows.entries()) {
    const name = `${label} row ${index + 1}`;
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return { ok: false, message: `${name} is not an object; a row is an object of ${keys.join(", ")}` };
    }
    const cells: RowCells<K> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!isKnownKey(keys, key)) return { ok: false, message: `${name} key "${key}" is not a ${label.toLowerCase()} row key; the keys are ${keys.join(", ")}` };
      if (value === undefined) continue;
      const text = textOf(value);
      if (text === undefined) return { ok: false, message: `${name} key "${key}" holds ${describeNonText(value)}, which cannot be written as given; a cell takes text` };
      cells[key] = text;
    }
    // A row without a reference holds nothing the caller gave but defaults, the row
    // add_verification_evidence refuses as "Evidence reference is required".
    if (!(cells as Partial<Record<string, string>>).reference?.trim()) return { ok: false, message: `${name} key "reference" is required` };
    normalized.push(cells);
  }
  return { ok: true, rows: normalized };
}

export type NormalizedSeedRows =
  | { ok: true; evidence: Array<Partial<EvidenceRow>>; trace: Array<Partial<TraceLink>> }
  | { ok: false; message: string };

/**
 * The one reader of the evidence and trace rows a new requirement is seeded with.
 *
 * The CLI hands it the rows it split from `type|reference|…` strings and MCP hands it the objects the
 * caller sent, so both channels refuse the same row: a key the row does not know, a cell that is
 * not text, or a row with no reference. Before this, MCP wrote such a row with the defaults in every misspelled cell and
 * `[object Object]` in every structured one. @req FR-NODE-281 AC-6
 */
export function normalizeSeedRows(input: { evidence?: readonly unknown[] | undefined; trace?: readonly unknown[] | undefined }): NormalizedSeedRows {
  const evidence = normalizeRows("Evidence", EVIDENCE_ROW_KEYS, input.evidence ?? []);
  if (!evidence.ok) return evidence;
  const trace = normalizeRows("Trace", TRACE_ROW_KEYS, input.trace ?? []);
  if (!trace.ok) return trace;
  return { ok: true, evidence: evidence.rows, trace: trace.rows };
}
