import type { AcceptanceCriterion, ExpiredAcceptanceCriterion, RequirementRecord } from "../types.js";
import { diagnostic } from "../diagnostic.js";
import type { Diagnostic } from "../types.js";
import { classifyDocumentLines, SRS_RECORD_LINES } from "./document-lines.js";
import type { SectionRange } from "./section-parser.js";

export interface ParsedAcceptanceCriteria {
  /** Live criteria only. */
  criteria: AcceptanceCriterion[];
  /** @req FR-PARSE-044 AC-1 */
  expired: ExpiredAcceptanceCriterion[];
  diagnostics: Diagnostic[];
}

// @req FR-PARSE-044 AC-1 — the text after `AC-<n>:` of an expired criterion. The id stays in front of
// the strike so a tool that predates the marker still reads the line as the same, checked criterion.
const EXPIRED_TEXT_RE = /^~~(.+)~~\s+\[EXPIRED (\d{4}-\d{2}-\d{2})(?: → ([A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*-\d+))?]$/;

/** `YYYY-MM-DD` naming a day that exists; 2026-02-30 does not. */
function isCalendarDate(stamp: string): boolean {
  const [year, month, day] = stamp.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The marker parts of `text`, or null when it is not the expired grammar with a real date. */
function expiredMarker(text: string): RegExpExecArray | null {
  const match = EXPIRED_TEXT_RE.exec(text.trim());
  return match && isCalendarDate(match[2]!) ? match : null;
}

/** True when `text`, written after `AC-<n>:`, would be read back as an expired criterion. */
export function isExpiredCriterionText(text: string): boolean {
  return expiredMarker(text) !== null;
}

/**
 * @req FR-NODE-243 AC-2 FR-PARSE-044 AC-4 — why `successor` cannot carry the behaviour of a criterion
 * of `ownerId`, or undefined when it can. The writer refuses and the validator reports on this one rule.
 */
export function successorProblem(ownerId: string, successor: string, records: readonly Pick<RequirementRecord, "id" | "status">[]): string | undefined {
  if (successor === ownerId) return `${successor} is the requirement itself`;
  const found = records.filter((record) => record.id === successor);
  if (found.length === 0) return `${successor} does not exist`;
  if (found.every((record) => record.status === "discarded")) return `${successor} is discarded`;
  return undefined;
}

/** The marker text the parser reads back as expired; the one writer of that grammar. */
export function expiredCriterionText(text: string, expiredOn: string, successor?: string): string {
  return `~~${text}~~ [EXPIRED ${expiredOn}${successor ? ` → ${successor}` : ""}]`;
}

export function parseAcceptanceCriteria(section?: SectionRange, filePath = "", requirementId = ""): ParsedAcceptanceCriteria {
  if (!section) return { criteria: [], expired: [], diagnostics: [] };
  const criteria: AcceptanceCriterion[] = [];
  const expired: ExpiredAcceptanceCriterion[] = [];
  const diagnostics: Diagnostic[] = [];
  // The section's lines as the block scanner classified them; a section built by hand is classified here.
  const bodyLines = section.bodyLines ?? classifyDocumentLines(section.lines, SRS_RECORD_LINES).map((line) => line.body);
  section.lines.forEach((line, index) => {
    if (bodyLines[index] !== true) return;
    const nestedMatch = /^\s+-\s+\[( |x|X)]\s+(?:(AC-\d+):\s*)?(.+)$/.exec(line);
    if (nestedMatch) {
      const criterionId = nestedMatch[2] ?? "(unnumbered)";
      const subject = requirementId ? `${criterionId} for ${requirementId}` : criterionId;
      diagnostics.push(
        diagnostic("SRS-E019", "error", `Nested acceptance criterion is not allowed: ${subject}`, {
          filePath,
          line: section.contentStartLine + index,
          ...(requirementId ? { requirementId } : {})
        })
      );
      return;
    }
    const match = /^-\s+\[( |x|X)]\s+(?:(AC-\d+):\s*)?(.+)$/.exec(line);
    if (!match) return;
    // An unnumbered line keeps the position number it had before expired lines left this list.
    const id = match[2] ?? `AC-${criteria.length + expired.length + 1}`;
    const text = match[3]!.trim();
    const checked = match[1]?.toLowerCase() === "x";
    const lineNumber = section.contentStartLine + index;
    const marker = match[2] ? expiredMarker(text) : null;
    if (marker) {
      expired.push({ id, text: marker[1]!, checked, line: lineNumber, expiredOn: marker[2]!, ...(marker[3] ? { successor: marker[3] } : {}) });
      return;
    }
    criteria.push({ id, text, checked, line: lineNumber });
  });
  return { criteria, expired, diagnostics };
}
