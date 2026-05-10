import { diagnostic } from "../diagnostic.js";
import type { Diagnostic } from "../types.js";

export interface RequirementHeading {
  id: string;
  title: string;
}

export interface RequirementBlockRange {
  heading: RequirementHeading;
  startLine: number;
  endLine: number;
}

export const REQUIREMENT_HEADING_RE = /^###\s+((?:FR|NFR|IR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4})\s+—\s+(.+)$/;
const NON_REQUIREMENT_THIRD_LEVEL_HEADING_RE = /^###\s+(In Scope|Out of Scope)\s*$/;
const TOP_LEVEL_SECTION_RE = /^##(?!#)\s+(.+)$/;
const FENCE_RE = /^(?: {0,3})(`{3,}|~{3,})/;

interface FenceState {
  marker: "`" | "~";
  length: number;
}

export function parseRequirementHeading(line: string): RequirementHeading | undefined {
  const match = REQUIREMENT_HEADING_RE.exec(line.trim());
  if (!match) return undefined;
  return { id: match[1]!, title: match[2]!.trim() };
}

function parseFence(line: string): FenceState | undefined {
  const match = FENCE_RE.exec(line);
  if (!match) return undefined;
  const fence = match[1]!;
  return { marker: fence[0] as FenceState["marker"], length: fence.length };
}

function isClosingFence(line: string, fence: FenceState): boolean {
  const next = parseFence(line);
  return Boolean(next && next.marker === fence.marker && next.length >= fence.length);
}

function parseTopLevelSectionTitle(line: string): string | undefined {
  const match = TOP_LEVEL_SECTION_RE.exec(line.trim());
  return match?.[1]?.trim();
}

function isRequirementsSection(title: string): boolean {
  return /\brequirements?\b/i.test(title);
}

export function scanRequirementBlocks(lines: string[], filePath = ""): { blocks: RequirementBlockRange[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const starts: Array<{ heading: RequirementHeading; line: number }> = [];
  const boundaries: number[] = [];
  let fence: FenceState | undefined;
  let inRequirementsSection = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (fence) {
      if (isClosingFence(line, fence)) fence = undefined;
      return;
    }

    const openingFence = parseFence(line);
    if (openingFence) {
      fence = openingFence;
      return;
    }

    const topLevelSectionTitle = parseTopLevelSectionTitle(line);
    if (topLevelSectionTitle) {
      if (inRequirementsSection) boundaries.push(lineNumber);
      inRequirementsSection = isRequirementsSection(topLevelSectionTitle);
      return;
    }

    if (!inRequirementsSection) return;

    if (line.startsWith("### ")) {
      const heading = parseRequirementHeading(line);
      if (heading) {
        starts.push({ heading, line: lineNumber });
      } else if (!NON_REQUIREMENT_THIRD_LEVEL_HEADING_RE.test(line.trim())) {
        diagnostics.push(diagnostic("SRS-E001", "error", "Malformed requirement heading", { filePath, line: lineNumber }));
      }
    }
  });
  const blocks = starts.map((start, index) => ({
    heading: start.heading,
    startLine: start.line,
    endLine: Math.min(starts[index + 1]?.line ?? lines.length + 1, boundaries.find((line) => line > start.line) ?? lines.length + 1) - 1
  }));
  return { blocks, diagnostics };
}
