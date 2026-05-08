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

export function parseRequirementHeading(line: string): RequirementHeading | undefined {
  const match = REQUIREMENT_HEADING_RE.exec(line.trim());
  if (!match) return undefined;
  return { id: match[1]!, title: match[2]!.trim() };
}

export function scanRequirementBlocks(lines: string[], filePath = ""): { blocks: RequirementBlockRange[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const starts: Array<{ heading: RequirementHeading; line: number }> = [];
  lines.forEach((line, index) => {
    if (line.startsWith("### ")) {
      const heading = parseRequirementHeading(line);
      if (heading) {
        starts.push({ heading, line: index + 1 });
      } else if (!/^###\s+(In Scope|Out of Scope)\s*$/.test(line.trim())) {
        diagnostics.push(diagnostic("SRS-E001", "error", "Malformed requirement heading", { filePath, line: index + 1 }));
      }
    }
  });
  const blocks = starts.map((start, index) => ({
    heading: start.heading,
    startLine: start.line,
    endLine: (starts[index + 1]?.line ?? lines.length + 1) - 1
  }));
  return { blocks, diagnostics };
}
