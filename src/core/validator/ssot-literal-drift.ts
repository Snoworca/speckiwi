import { SSOT_LITERAL_REGISTRY, type SsotLiteralEntry } from "../ssot-literal-registry.js";

// @req FR-PARSE-039 — compares what a requirement says against what the tool ships, so a statement
// that stopped being true when a constant moved is reported instead of staying quietly checked.
//
// Only a shape match with a differing value is a finding. Matching the shape alone would report
// every mention of a rules document, current ones included, and carry no information about age.

/** A stretch of specification text, with where it came from and what kind of section it is. */
export interface SsotTextSpan {
  readonly requirementId?: string;
  readonly filePath: string;
  readonly line: number;
  readonly section: SsotSection;
  readonly text: string;
}

/**
 * Sections that say what is true now, and sections that describe what was true then.
 *
 * The distinction is the whole precision story: change notes are supposed to name old values.
 */
export type SsotSection =
  | "acceptanceCriteria"
  | "requirement"
  | "rationale"
  | "research"
  | "sample"
  | "traceLinks"
  | "evidenceReference"
  | "relatedDocs"
  | "changeNotes"
  | "implementationNotes"
  | "evidenceNotes"
  | "other";

/**
 * A planting round found only three sections were being read, so a stale value in an evidence
 * Reference or a Related Docs row went unreported. Those are pure pointers: they name a file that
 * has to exist, and a moved one is broken the moment it moves.
 *
 * Rationale and Research were added with them and taken back out. A Rationale says why a
 * requirement exists, which regularly means naming what was wrong before it: one of them reads
 * "five requirements have carried a broken link to <old path>", and reporting that would be
 * reporting the sentence that explains the repair. They are retrospective the way Change Notes are.
 *
 * The Notes columns stay out for the same reason. They narrate a run that happened — "10 cases
 * green, mutation reverted" — and naming the value in force at that time is what they are for.
 */
const LIVE_SECTIONS: ReadonlySet<SsotSection> = new Set([
  "acceptanceCriteria",
  "requirement",
  "sample",
  "traceLinks",
  "evidenceReference",
  "relatedDocs"
]);

export interface SsotLiteralFinding {
  readonly requirementId?: string;
  readonly filePath: string;
  readonly line: number;
  readonly constantName: string;
  readonly expected: string;
  readonly found: string;
  readonly message: string;
}

function build(entry: SsotLiteralEntry, span: SsotTextSpan, expected: string, found: string, message: string): SsotLiteralFinding {
  return {
    ...(span.requirementId === undefined ? {} : { requirementId: span.requirementId }),
    filePath: span.filePath,
    line: span.line,
    constantName: entry.name,
    expected,
    found,
    message
  };
}

function shapeFindings(entry: SsotLiteralEntry, span: SsotTextSpan): SsotLiteralFinding[] {
  if (entry.shape === undefined || entry.value === undefined) return [];
  const flags = entry.shape.flags.includes("g") ? entry.shape.flags : `${entry.shape.flags}g`;
  const pattern = new RegExp(entry.shape.source, flags);
  const findings: SsotLiteralFinding[] = [];
  for (const match of span.text.matchAll(pattern)) {
    const found = match[1];
    if (found === undefined || found === entry.value) continue;
    findings.push(build(entry, span, entry.value, found, `${entry.name} is ${entry.value}, but this says ${found}`));
  }
  return findings;
}

/** Every comment in `text` that opens with `prefix`, as whole strings. */
function markersOpeningWith(text: string, prefix: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(prefix, from);
    if (start === -1) return found;
    const close = text.indexOf("-->", start);
    found.push(close === -1 ? text.slice(start) : text.slice(start, close + 3));
    from = start + prefix.length;
  }
}

/**
 * A marker carries no version, so a wrong one is a different string rather than a different value
 * of the same shape. Comparing whole strings only catches an exact copy of the retired marker; a
 * planting round wrote `<!-- /SpecKiwi SRS workflow v1.6 -->` and nothing saw it. Match how the
 * marker opens instead, and report anything that opens like it without closing as it should.
 */
function markerFindings(entry: SsotLiteralEntry, span: SsotTextSpan): SsotLiteralFinding[] {
  if (entry.markerPrefix === undefined || entry.value === undefined) return [];
  const current = entry.value;
  return markersOpeningWith(span.text, entry.markerPrefix)
    .filter((whole) => whole !== current)
    .map((whole) => build(entry, span, current, whole, `${entry.name} is ${current}, but this says ${whole}`));
}

const LEGACY_MESSAGE =
  "is kept only so the tool can recognise what an older version wrote; this states it as current";

function legacyFindings(entry: SsotLiteralEntry, span: SsotTextSpan): SsotLiteralFinding[] {
  if (entry.markerPrefix !== undefined) {
    return markersOpeningWith(span.text, entry.markerPrefix).map((whole) =>
      build(entry, span, "", whole, `${entry.name} ${LEGACY_MESSAGE}`)
    );
  }
  if (entry.value === undefined || !span.text.includes(entry.value)) return [];
  return [build(entry, span, "", entry.value, `${entry.name} ${LEGACY_MESSAGE}`)];
}

/**
 * Spaces that render as an ordinary space but are not one.
 *
 * A planting round wrote a heading with a non-breaking space in it. It renders identically, reads
 * correctly to anyone looking at it, and carried a version the tool had left behind — and the
 * comparison walked straight past it. Pasting from a rendered document or a word processor is how
 * that character arrives, so it is worth folding before comparing.
 */
const LOOKALIKE_SPACES = /[\u00A0\u2007\u202F]/g;

function normalizeSpaces(text: string): string {
  return text.replace(LOOKALIKE_SPACES, " ");
}

/** Reports spans that quote a stale or compatibility-only value of a registered constant. */
export function collectSsotLiteralDrift(spans: readonly SsotTextSpan[]): SsotLiteralFinding[] {
  const findings: SsotLiteralFinding[] = [];
  for (const original of spans) {
    if (!LIVE_SECTIONS.has(original.section)) continue;
    const span: SsotTextSpan = { ...original, text: normalizeSpaces(original.text) };
    for (const entry of SSOT_LITERAL_REGISTRY) {
      if (entry.role === "current") findings.push(...shapeFindings(entry, span), ...markerFindings(entry, span));
      else if (entry.role === "legacy") findings.push(...legacyFindings(entry, span));
    }
  }
  return findings;
}
