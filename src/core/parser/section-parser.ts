import type { RequirementBlockRange } from "./block-scanner.js";
import { diagnostic } from "../diagnostic.js";
import type { Diagnostic } from "../types.js";

export interface SectionRange {
  name: string;
  startLine: number;
  contentStartLine: number;
  endLine: number;
  lines: string[];
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
const FENCE_RE = /^(?: {0,3})(`{3,}|~{3,})/;
const CLOSING_FENCE_RE = /^(?: {0,3})(`{3,}|~{3,}) *$/;

interface FenceState {
  marker: "`" | "~";
  length: number;
}

function normalizeSectionName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalSectionName(name: string): string {
  return CANONICAL_SECTIONS.get(normalizeSectionName(name)) ?? name.trim();
}

function parseFence(line: string): FenceState | undefined {
  const match = FENCE_RE.exec(line);
  if (!match) return undefined;
  const fence = match[1]!;
  return { marker: fence[0] as FenceState["marker"], length: fence.length };
}

function isClosingFence(line: string, fence: FenceState): boolean {
  const match = CLOSING_FENCE_RE.exec(line);
  if (!match) return false;
  const closing = match[1]!;
  const next = { marker: closing[0] as FenceState["marker"], length: closing.length };
  return Boolean(next && next.marker === fence.marker && next.length >= fence.length);
}

export function parseRequirementSections(block: RequirementBlockRange, lines: string[], filePath = ""): ParsedRequirementSections {
  const diagnostics: Diagnostic[] = [];
  const headings: Array<{ name: string; line: number }> = [];
  let fence: FenceState | undefined;
  for (let line = block.startLine; line <= block.endLine; line += 1) {
    const text = lines[line - 1] ?? "";
    if (fence) {
      if (isClosingFence(text, fence)) fence = undefined;
      continue;
    }
    const openingFence = parseFence(text);
    if (openingFence) {
      fence = openingFence;
      continue;
    }
    if (text.startsWith("#### ")) {
      headings.push({ name: text.replace(/^####\s+/, "").trim(), line });
    }
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
      lines: lines.slice(heading.line, endLine)
    };
  });
  return { sections, diagnostics };
}
