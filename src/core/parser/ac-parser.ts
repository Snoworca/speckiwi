import type { AcceptanceCriterion } from "../types.js";
import type { SectionRange } from "./section-parser.js";

export function parseAcceptanceCriteria(section?: SectionRange): AcceptanceCriterion[] {
  if (!section) return [];
  const criteria: AcceptanceCriterion[] = [];
  section.lines.forEach((line, index) => {
    const match = /^\s*-\s+\[( |x|X)]\s+(?:(AC-\d+):\s*)?(.+)$/.exec(line);
    if (!match) return;
    const id = match[2] ?? `AC-${criteria.length + 1}`;
    criteria.push({
      id,
      text: match[3]!.trim(),
      checked: match[1]?.toLowerCase() === "x",
      line: section.contentStartLine + index
    });
  });
  return criteria;
}
