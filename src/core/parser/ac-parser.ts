import type { AcceptanceCriterion } from "../types.js";
import { diagnostic } from "../diagnostic.js";
import type { Diagnostic } from "../types.js";
import type { SectionRange } from "./section-parser.js";

export interface ParsedAcceptanceCriteria {
  criteria: AcceptanceCriterion[];
  diagnostics: Diagnostic[];
}

const FENCE_RE = /^(?: {0,3})(`{3,}|~{3,})/;
const CLOSING_FENCE_RE = /^(?: {0,3})(`{3,}|~{3,}) *$/;

interface FenceState {
  marker: "`" | "~";
  length: number;
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

export function parseAcceptanceCriteria(section?: SectionRange, filePath = "", requirementId = ""): ParsedAcceptanceCriteria {
  if (!section) return { criteria: [], diagnostics: [] };
  const criteria: AcceptanceCriterion[] = [];
  const diagnostics: Diagnostic[] = [];
  let fence: FenceState | undefined;
  section.lines.forEach((line, index) => {
    if (fence) {
      if (isClosingFence(line, fence)) fence = undefined;
      return;
    }
    const openingFence = parseFence(line);
    if (openingFence) {
      fence = openingFence;
      return;
    }
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
    const id = match[2] ?? `AC-${criteria.length + 1}`;
    criteria.push({
      id,
      text: match[3]!.trim(),
      checked: match[1]?.toLowerCase() === "x",
      line: section.contentStartLine + index
    });
  });
  return { criteria, diagnostics };
}
