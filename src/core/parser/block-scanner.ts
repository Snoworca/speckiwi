import { diagnostic } from "../diagnostic.js";
import type { Diagnostic } from "../types.js";

export interface RequirementHeading {
  id: string;
  title: string;
  strikethrough: boolean;
  marker?: "DISCARDED" | "DRAFT";
  /** marker inner content sub-parser 가 채움 (C2 후속 단계). 본 정규식은 raw 만 잡음. */
  successorId?: string;
  /** N = (총 매치 row 수) - 1. marker inner sub-parser 책임. */
  successorCount?: number;
}

export interface RequirementBlockRange {
  heading: RequirementHeading;
  startLine: number;
  endLine: number;
}

/**
 * SRS-MD-Rules v1.1.0 §30.1/§30.2 marker 자동 적용 인식.
 *
 * 5 캡처 그룹:
 *   1. openStrike  (~~) — strikethrough open, optional
 *   2. id          — speckiwi enum 기반 REQ-ID
 *   3. title       — lazy match, marker/closeStrike/line-end 직전까지 흡수.
 *                    title 내 합법 markdown (예: `[link](url)`) 보존 — records.ts 의
 *                    headingContainsForbiddenMarkdown 가 추가 검증 (SRS-E020).
 *                    title 내 비표준 brackets (예: `[TBD]`) 의 검출은 별도 sub-parser 책임 (v5.1 §3 (B)).
 *   4. closeStrike (~~) — strikethrough close, optional. open 과 짝일 때만 strikethrough=true
 *   5. marker      — DISCARDED | DRAFT, optional. inner content 는 marker inner sub-parser 책임.
 *
 * 정합성 강제 (strikethrough+DISCARDED only / no-strikethrough+DRAFT only) 는 후속 validator/rules-version 책임.
 */
export const REQUIREMENT_HEADING_RE =
  /^###\s+(~~)?((?:FR|NFR|IR|DR|SEC|PERF|REL|OBS|OPS|MIG|CON)-[A-Z0-9][A-Z0-9-]{1,24}-[0-9]{3,4})\s+—\s+(.+?)(~~)?\s*(?:\[(DISCARDED|DRAFT)(?:[^\]]*)\])?\s*$/;
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
  const [, openStrike, id, title, closeStrike, marker] = match;
  const heading: RequirementHeading = {
    id: id!,
    title: title!.trim(),
    strikethrough: Boolean(openStrike && closeStrike)
  };
  if (marker === "DISCARDED" || marker === "DRAFT") heading.marker = marker;
  return heading;
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

    if (!inRequirementsSection) {
      // @req FR-PARSE-035 — a well-formed block here is invisible to every query, mutation and
      // validation rule. Reporting it does not change that; it just stops the invisibility being
      // silent, which is how an author ends up filing work against an id the tool does not have.
      if (line.startsWith("### ")) {
        const stranded = parseRequirementHeading(line);
        if (stranded) {
          diagnostics.push(
            diagnostic(
              "SRS-W071",
              "warning",
              `Requirement heading ${stranded.id} is outside a Requirements section and is not parsed as a requirement`,
              { filePath, line: lineNumber },
              { id: stranded.id }
            )
          );
        }
      }
      return;
    }

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
