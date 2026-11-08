import type { RequirementBlockRange } from "./block-scanner.js";
import type { DocumentLine } from "./document-lines.js";
import { diagnostic } from "../diagnostic.js";
import type { Diagnostic } from "../types.js";

export interface SectionRange {
  name: string;
  startLine: number;
  contentStartLine: number;
  endLine: number;
  lines: string[];
  /**
   * For each of `lines`, whether it is document text, from the document's one classification; absent
   * on a section built by hand, whose reader then classifies its lines itself.
   */
  bodyLines?: boolean[];
}

export interface ParsedRequirementSections {
  sections: Record<string, SectionRange>;
  diagnostics: Diagnostic[];
}

const CANONICAL_SECTIONS = new Map(
  [
    "Requirement",
    "Rationale",
    "Acceptance Criteria",
    "Verification Evidence",
    "Trace Links",
    "Research / Analysis",
    "Implementation Notes",
    "Change Notes"
  ].map((name) => [normalizeSectionName(name), name])
);

function normalizeSectionName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalSectionName(name: string): string {
  return CANONICAL_SECTIONS.get(normalizeSectionName(name)) ?? name.trim();
}

/**
 * The name of a requirement-block section heading (`#### Name`), or undefined when the line is not
 * one. Ask it only of a line the document classifier reads as body: the section parser and every
 * writer that finds where a section ends use this one test, so they cannot disagree about it.
 */
export function parseSectionHeadingName(line: string): string | undefined {
  return line.startsWith("#### ") ? line.replace(/^####\s+/, "").trim() : undefined;
}

export function parseRequirementSections(
  block: RequirementBlockRange,
  lines: string[],
  documentLines: readonly DocumentLine[],
  filePath = ""
): ParsedRequirementSections {
  const diagnostics: Diagnostic[] = [];
  const headings: Array<{ name: string; line: number }> = [];
  // The block scanner's classification of the document: a `####` line in code or an HTML comment is
  // an example, not a section.
  const isBody = (line: number): boolean => documentLines[line - 1]?.body === true;
  for (let line = block.startLine; line <= block.endLine; line += 1) {
    const text = lines[line - 1] ?? "";
    if (!isBody(line)) continue;
    const name = parseSectionHeadingName(text);
    if (name !== undefined) headings.push({ name, line });
  }
  const sections: Record<string, SectionRange> = {};
  headings.forEach((heading, index) => {
    const endLine = (headings[index + 1]?.line ?? block.endLine + 1) - 1;
    const name = canonicalSectionName(heading.name);
    if (sections[name]) {
      diagnostics.push(
        diagnostic("SRS-E018", "error", `Duplicate requirement section: ${name} for ${block.heading.id}`, {
          filePath,
          line: heading.line,
          requirementId: block.heading.id
        })
      );
      return;
    }
    sections[name] = {
      name,
      startLine: heading.line,
      contentStartLine: heading.line + 1,
      endLine,
      lines: lines.slice(heading.line, endLine),
      bodyLines: documentLines.slice(heading.line, endLine).map((line) => line.body)
    };
  });
  return { sections, diagnostics };
}
