// @req FR-NODE-121 — the two mechanical prose detectors behind `orchestrate freeze design`.
//
// 05 §3.3 makes `unmarked-normative-prose` a critical gate rather than a warning, because the miss is
// silent and the count is load-bearing: an under-counted design-item set shrinks every frozen
// denominator in loops D, W, P and F while the invariant digest reports no drift, so nothing else in
// the design can catch it. Both detectors therefore have a *declared* vocabulary rather than an
// ad-hoc inline list, and both vocabularies live in this file — product code compiled by plain tsc —
// so they reach a consumer install. An asset under `src/` would not: the build copies no non-`.ts`
// file, and `test/` is outside the package file list.

/** The closed finding vocabulary (05 §10.1). */
export const PROSE_RULES = ["script-block", "hedge", "unmarked-normative-prose"] as const;

export type ProseRule = (typeof PROSE_RULES)[number];

/**
 * The normative token set, English-only and ordered longest-first.
 *
 * @req FR-NODE-121 — 05 §3.3 rule 3 scopes this set to `design/00.design.md` and
 * `waves/wave-{n}/design.md`, both of which are marked English. The Layer-3 skill-body vocabulary is
 * a separate bilingual set; the two are named apart so neither is read as the other and no
 * downstream denominator moves. `MUST NOT` counts once and not twice, which is why it leads.
 */
export const NORMATIVE_TOKENS = ["MUST NOT", "MUST", "SHALL"] as const;

/**
 * The hedge vocabulary, bilingual, one array of tokens.
 *
 * @req FR-NODE-121 AC-8 — an exported module constant rather than an asset, because `npm run build`
 * is plain tsc with `rootDir src` and copies nothing else into `dist`. Tests import this constant
 * rather than restating the list, so widening it cannot leave the assertions behind.
 */
export const HEDGE_TOKENS = [
  "probably",
  "possibly",
  "perhaps",
  "maybe",
  "roughly",
  "approximately",
  "somewhat",
  "arguably",
  "presumably",
  "seemingly",
  "more or less",
  "and so on",
  "아마도",
  "대충",
  "적당히",
  "어느 정도",
  "듯하다",
  "웬만하면"
] as const;

export interface ProseFinding {
  rule: ProseRule;
  /** 1-based source lines, exactly as they appear in the scanned text. */
  lines: number[];
  token?: string;
}

export interface ProseScan {
  findings: ProseFinding[];
}

/** A `[D-nnn]` or `[I-nnn]` design-item row: a top-level list row whose text opens with the id. */
const ITEM_ROW = /^\s*[-*+]\s+\[[DI]-\d{3}\]/;

const LIST_ROW = /^\s*(?:[-*+]|\d+\.)\s+/;

const HEADING = /^(#{1,6})\s+\S/;

/**
 * Fenced-code content blanked, line count preserved.
 *
 * Separated from {@link maskExcludedConstructs} because the two callers need different exclusion
 * sets over the same text: a heading scan and a path scan must still see inline code spans, which
 * is where a handoff names its paths, while §3.3 rule 6's item and gate scans must not.
 */
export function maskFencedBlocks(text: string): string[] {
  const masked: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      masked.push("");
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      masked.push("");
      continue;
    }
    masked.push(line);
  }
  return masked;
}

/**
 * The §3.3 rule 6 exclusion set: fenced code, blockquote content and inline code spans.
 *
 * The construct list is chosen because a scanner can decide it without judging provenance, which is
 * the same reason 05 §6.2 layer 3 names the same three for the handoff's English scan.
 */
export function maskExcludedConstructs(text: string): string[] {
  return maskFencedBlocks(text).map((line) => (/^\s*>/.test(line) ? "" : line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length))));
}

/**
 * Normative-token occurrences in a stretch of text, with `MUST NOT` counted once.
 *
 * @req FR-NODE-121 AC-3 — token counting replaces revision 2's *"exactly one normative sentence"*,
 * which needed a sentence splitter: a judgment call over abbreviations, code spans and list
 * punctuation feeding a critical gate. `orchestrate freeze design` uses this to hold §3.3 rule 3's
 * exactly-one-occurrence rule over an item row.
 */
export function countNormativeTokens(text: string): number {
  const mustNot = (text.match(/\bMUST NOT\b/g) ?? []).length;
  const must = (text.match(/\bMUST\b/g) ?? []).length - mustNot;
  const shall = (text.match(/\bSHALL\b/g) ?? []).length;
  return mustNot + must + shall;
}

/** The indices of headings that are lowest-level: no deeper heading before the next same-or-shallower one. */
function lowestLevelHeadings(lines: string[]): number[] {
  const headings = lines.map((line, index) => ({ index, level: HEADING.exec(line)?.[1]?.length ?? 0 })).filter((entry) => entry.level > 0);

  // A deeper heading exists between a heading and the next same-or-shallower one exactly when the
  // *immediately* following heading is deeper — anything further along is behind that one.
  return headings.filter((current, position) => (headings[position + 1]?.level ?? 0) <= current.level).map((entry) => entry.index);
}

/** Content of a heading, up to the next heading of any level. */
function contentRange(lines: string[], headingIndex: number): { start: number; end: number } {
  let end = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (HEADING.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  return { start: headingIndex + 1, end };
}

/** Paragraphs and list rows, each with the 1-based source lines it occupies. */
function unitsIn(lines: string[], start: number, end: number): Array<{ text: string; lines: number[] }> {
  const units: Array<{ text: string; lines: number[] }> = [];
  let current: { text: string[]; lines: number[] } | null = null;

  const flush = (): void => {
    if (current) units.push({ text: current.text.join(" "), lines: current.lines });
    current = null;
  };

  for (let index = start; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (LIST_ROW.test(line)) flush();
    if (!current) current = { text: [], lines: [] };
    current.text.push(line.trim());
    current.lines.push(index + 1);
  }
  flush();
  return units;
}

/**
 * @req FR-NODE-121 — `scanProse` has one argument and one mode. A `strict` switch was declared once
 * and never given a meaning; the natural guess — widening the token set — is the divergence §3.3
 * rule 3 spends a paragraph forbidding, so the parameter is deliberately absent.
 *
 * Two detectors run, both mechanical: the normative scan over content under a lowest-level heading,
 * and the hedge scan over the same exclusion set. `script-block` is a member of the closed rule
 * vocabulary and no phase-1 detector emits it.
 */
export function scanProse(text: string): ProseScan {
  const lines = maskExcludedConstructs(text);
  const findings: ProseFinding[] = [];

  for (const token of HEDGE_TOKENS) {
    const needle = token.toLowerCase();
    const hits = lines.map((line, index) => (line.toLowerCase().includes(needle) ? index + 1 : 0)).filter((line) => line > 0);
    if (hits.length > 0) findings.push({ rule: "hedge", lines: hits, token });
  }

  for (const headingIndex of lowestLevelHeadings(lines)) {
    const { start, end } = contentRange(lines, headingIndex);
    for (const unit of unitsIn(lines, start, end)) {
      if (countNormativeTokens(unit.text) === 0) continue;
      if (ITEM_ROW.test(unit.text)) continue;
      findings.push({ rule: "unmarked-normative-prose", lines: unit.lines });
    }
  }

  return { findings };
}
