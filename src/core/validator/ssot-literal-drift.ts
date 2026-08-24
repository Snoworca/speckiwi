import { SSOT_LITERAL_REGISTRY, type SsotLiteralEntry } from "../ssot-literal-registry.js";

// @req FR-PARSE-039 — compares what a criterion says against what the tool ships, so a criterion
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
  | "sample"
  | "traceLinks"
  | "changeNotes"
  | "implementationNotes"
  | "other";

/**
 * A trace link is a live statement: it says this requirement is carried by that file, now. One of
 * them named a rules document that had moved, and nothing reported it — the link checker reads
 * Markdown links and walks past a bare path in a table cell.
 */
const LIVE_SECTIONS: ReadonlySet<SsotSection> = new Set([
  "acceptanceCriteria",
  "requirement",
  "sample",
  "traceLinks"
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

function shapeFindings(entry: SsotLiteralEntry, span: SsotTextSpan): SsotLiteralFinding[] {
  if (entry.shape === undefined || entry.value === undefined) return [];
  const pattern = new RegExp(entry.shape.source, entry.shape.flags.includes("g") ? entry.shape.flags : `${entry.shape.flags}g`);
  const findings: SsotLiteralFinding[] = [];
  for (const match of span.text.matchAll(pattern)) {
    const found = match[1];
    if (found === undefined || found === entry.value) continue;
    findings.push({
      ...(span.requirementId === undefined ? {} : { requirementId: span.requirementId }),
      filePath: span.filePath,
      line: span.line,
      constantName: entry.name,
      expected: entry.value,
      found,
      message: `${entry.name} is ${entry.value}, but this says ${found}`
    });
  }
  return findings;
}

function legacyFindings(entry: SsotLiteralEntry, span: SsotTextSpan): SsotLiteralFinding[] {
  if (entry.value === undefined || !span.text.includes(entry.value)) return [];
  return [
    {
      ...(span.requirementId === undefined ? {} : { requirementId: span.requirementId }),
      filePath: span.filePath,
      line: span.line,
      constantName: entry.name,
      expected: "",
      found: entry.value,
      message: `${entry.name} is kept only so the tool can recognise what an older version wrote; this states it as current`
    }
  ];
}

/** Reports spans that quote a stale or compatibility-only value of a registered constant. */
export function collectSsotLiteralDrift(spans: readonly SsotTextSpan[]): SsotLiteralFinding[] {
  const findings: SsotLiteralFinding[] = [];
  for (const span of spans) {
    if (!LIVE_SECTIONS.has(span.section)) continue;
    for (const entry of SSOT_LITERAL_REGISTRY) {
      if (entry.role === "current") findings.push(...shapeFindings(entry, span));
      else if (entry.role === "legacy") findings.push(...legacyFindings(entry, span));
    }
  }
  return findings;
}
