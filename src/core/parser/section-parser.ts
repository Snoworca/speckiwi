import type { RequirementBlockRange } from "./block-scanner.js";

export interface SectionRange {
  name: string;
  startLine: number;
  contentStartLine: number;
  endLine: number;
  lines: string[];
}

export function parseRequirementSections(block: RequirementBlockRange, lines: string[]): Record<string, SectionRange> {
  const headings: Array<{ name: string; line: number }> = [];
  for (let line = block.startLine; line <= block.endLine; line += 1) {
    const text = lines[line - 1] ?? "";
    if (text.startsWith("#### ")) {
      headings.push({ name: text.replace(/^####\s+/, "").trim(), line });
    }
  }
  const sections: Record<string, SectionRange> = {};
  headings.forEach((heading, index) => {
    const endLine = (headings[index + 1]?.line ?? block.endLine + 1) - 1;
    sections[heading.name] = {
      name: heading.name,
      startLine: heading.line,
      contentStartLine: heading.line + 1,
      endLine,
      lines: lines.slice(heading.line, endLine)
    };
  });
  return sections;
}
