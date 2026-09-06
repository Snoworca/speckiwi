import { EXEMPTION } from "./location-citations.js";

/**
 * @req FR-NODE-206 — a Trace Link of a type other than Requirement names a file, not a line.
 *
 * The subject is the parsed `Reference` field rather than the text of the document, which is what
 * keeps a committee tally and a timestamp out of the denominator by structure instead of by a word
 * list: neither is ever written into that field. The bare-colon forms stay outside it because
 * reaching them needs a rule that inherits context from the surrounding sentence, and inheriting
 * context is a judgement rather than a match.
 */

/** The shape of a parsed Trace Links row this scan needs; a `RequirementRecord` supplies it. */
export interface TraceLinkRowLike {
  readonly type: string;
  readonly reference: string;
  readonly notes: string;
}

/** The shape of a parsed requirement this scan needs. */
export interface TraceLinkOwnerLike {
  readonly id: string;
  readonly filePath: string;
  readonly traceLinks: readonly TraceLinkRowLike[];
}

export interface TraceLinkCitation {
  /** The requirement whose Trace Links table holds the row. */
  readonly requirementId: string;
  /** Path of the document holding that requirement, as the parser reports it. */
  readonly file: string;
  /** The row's Type cell, so a report names the row and not only the requirement. */
  readonly type: string;
  /** The Reference cell as written. */
  readonly reference: string;
}

/**
 * A line designation anchored on a file extension.
 *
 * The exemption below covers two invented illustrations of the banned shape — they point at nothing
 * and are here to show what the pattern matches. It is not a licence for a citation meant to be
 * followed: one of those has a line number that moves, which is the whole defect this file exists to
 * catch, so do not copy this exemption onto a real one.
 * Illustrations: `read.ts:294`, `pipeline-event.md:118-120`. @cite-lint: ignore
 *
 * Anchoring on the extension is what excludes a tally (`5:0`) and a clock reading (`12:48:33`)
 * without naming either: they carry no extension ahead of the colon. The extension must start with a
 * letter so a version (`1.2:34`) is not read as one.
 */
const LINE_DESIGNATION = /\.[A-Za-z][A-Za-z0-9]*:\d+(?:[-:]\d+)?$/;

/** True when the reference, or any file in a semicolon-separated list of them, names a line. */
export function citesALine(reference: string): boolean {
  return String(reference)
    .split(";")
    .map((part) => part.trim())
    .some((part) => LINE_DESIGNATION.test(part));
}

/**
 * Every row that names a line, skipping `Requirement` rows — whose reference is a requirement id
 * rather than a path — and rows exempted on their own Notes cell. The exemption spelling is the one
 * FR-FLOW-141 established rather than a second one, so an author learns it once.
 */
export function collectTraceLinkCitations(records: readonly TraceLinkOwnerLike[]): TraceLinkCitation[] {
  const found: TraceLinkCitation[] = [];
  for (const record of records) {
    for (const row of record.traceLinks) {
      if (row.type === "Requirement") continue;
      if (EXEMPTION.test(row.notes ?? "")) continue;
      if (!citesALine(row.reference)) continue;
      found.push({ requirementId: record.id, file: record.filePath, type: row.type, reference: row.reference });
    }
  }
  return found;
}

/** `file requirement [type] reference`, one per line — a lookup rather than a search. */
export function formatTraceLinkCitations(citations: readonly TraceLinkCitation[]): string {
  return citations
    .map((entry) => `${entry.file} ${entry.requirementId} [${entry.type}] cites ${entry.reference}`)
    .join("\n");
}
