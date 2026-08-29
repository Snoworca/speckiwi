import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, isTableRowLine } from "./kiwi-orchestrator-variants.js";

/**
 * Corpus derivation shared by the suites that read every shipped rendering of a kiwi skill.
 *
 * Each export here answers one question — which trees ship, which skills each tree carries, which
 * files a skill is written across — by READING the tree rather than by restating it. A literal
 * answer to any of them is an inclusion test one level above the corpus boundary: whatever the
 * literal omits is never swept, and a sweep over the survivors passes for the same reason a clean
 * one does. That silence is what FR-FLOW-154 and FR-FLOW-155 each spent a verification round
 * removing, and it is removed once here instead of once per suite.
 */

/** The shipped renderings plus the mirror, read from disk. @req FR-FLOW-159 AC-2 */
export const RENDERINGS: readonly string[] = [
  ...readdirSync(path.join(REPO_ROOT, "skills"))
    .filter((entry) => statSync(path.join(REPO_ROOT, "skills", entry)).isDirectory())
    .sort()
    .map((entry) => `skills/${entry}`),
  ".agents/skills"
];

/**
 * The skills `mirror-skills.ts` leaves out of the mirror, read from the exclusion file the mirror
 * itself is built against, so the two cannot disagree. FR-FLOW-160 AC-2 needs this derived rather
 * than listed: an exclusion that is retired in the file but survives here would keep excusing a
 * name nothing excludes any more.
 */
export const MIRROR_EXCLUDED: readonly string[] = (
  JSON.parse(readFileSync(path.join(REPO_ROOT, ".agents/skills/.speckiwi-mirror-exclusions.json"), "utf8")) as { excluded: string[] }
).excluded;

/** The `kiwi-*` skill directories one rendering carries, read from disk. */
export function skillDirs(rendering: string): string[] {
  const base = path.join(REPO_ROOT, rendering);
  return readdirSync(base)
    .filter((entry) => entry.startsWith("kiwi-") && statSync(path.join(base, entry)).isDirectory())
    .sort();
}

/** Every file under `dir`, recursively, as repo-relative POSIX paths in directory order. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/**
 * Every entry under `_shared/kiwi/`, markdown or not, in every rendering that ships the directory.
 *
 * The corpus `sharedKiwiFiles` sweeps is this narrowed to markdown, and FR-FLOW-158 AC-1 holds the
 * two counts EQUAL rather than trusting the narrowing: today every entry in those directories is
 * markdown, so it drops nothing, and a `.json` or `.yaml` shared contract landing there later would
 * otherwise sit outside the sweep with only a smaller denominator to show for it.
 *
 * A rendering without the directory contributes nothing rather than throwing, so a tree that stops
 * shipping shared files is a shrunken corpus the caller can assert on, not an ENOENT at import.
 */
export function sharedKiwiEntries(): string[] {
  return RENDERINGS.flatMap((rendering) => {
    const dir = path.join(REPO_ROOT, rendering, "_shared", "kiwi");
    try {
      if (!statSync(dir).isDirectory()) return [];
    } catch {
      return [];
    }
    return filesUnder(dir);
  });
}

/**
 * Every markdown file under `_shared/kiwi/`, in every rendering that ships the directory.
 *
 * The files `§0` of `kiwi-orchestrator` defers to — ten of them by name — plus the two it does not.
 * FR-FLOW-158 AC-1 needs this read from the directory rather than listed: a shared file added later
 * must be covered without an edit to the suite that sweeps it, and the renderings do not carry the
 * same set — `skills/etc` ships `local-llm-profile.md` and the other three do not. A list would
 * have to encode that difference and would be wrong the first time it changed.
 */
export function sharedKiwiFiles(): string[] {
  return sharedKiwiEntries().filter((relPath) => relPath.endsWith(".md"));
}

/** Every markdown file under `<rendering>/<skill>`, as repo-relative POSIX paths. */
export function markdownFiles(rendering: string, skill?: string): string[] {
  const base = skill === undefined ? path.join(REPO_ROOT, rendering) : path.join(REPO_ROOT, rendering, skill);
  return filesUnder(base).filter((relPath) => relPath.endsWith(".md"));
}

/** Read a repo-relative path, ENOENT to empty string so a missing file fails as an assertion. */
export function readRepoFile(relPath: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  } catch {
    return "";
  }
}

const HEADING = /^(#{1,6})\s/;
const NUMBERED = /^ {0,3}\d+\.\s/;
/** What opens a list item, once the quote marker and the indent are already off the line. */
const LIST_MARKER = /^(?:[-*+]\s|\d+\.\s)/;
/** What opens and closes a fenced block, read after the quote marker is off the line. */
const FENCE_DELIMITER = /^(?:`{3,}|~{3,})/;

/**
 * Every run of whitespace collapsed to one space, for matching a RULE rather than a layout.
 *
 * The renderings wrap at different widths — measured, `move eligible REQs from \`implemented\` to
 * \`verified\`` is one line in codex and two in etc — so a pattern written against the sentence
 * misses wherever the wrap happens to fall. That is a false clean, and the worst kind: it reports
 * that a rendering lacks a rule it states perfectly well. Use this for pattern checks only; a
 * golden comparison must see the bytes as they ship.
 */
export function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * The block scanner FR-FLOW-164 introduced, shared so one block boundary does not become two.
 *
 * FR-FLOW-164 reads a declaring section for cancellations and polarity inversions; FR-FLOW-158
 * reads every file under `_shared/kiwi/` for a rule it may not state. Both need the same unit and
 * for the same reason, and the doc below is the measurement that fixed its shape. It lived in the
 * first suite until the second needed it: two spellings of one boundary drift apart, and the one
 * that drifts is always the one nobody is looking at — which is what `isTableRowLine`, read by
 * this scanner, was itself extracted to stop.
 */
/** One markdown block of a section, which is the unit a block-wise scan reads. */
export interface ScanUnit {
  /** The block's lines joined by single spaces, which is the sentence a reader is handed. */
  readonly text: string;
  /** 1-based within the section, so a report names the block rather than a fold inside it. */
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * A section's blocks, with the soft line breaks inside each paragraph joined the way a renderer
 * joins them.
 *
 * Scanning raw lines let a forbidden phrase pass by being FOLDED across a line break: no line
 * carried it, while the rendered paragraph read as one sentence. That was reachable in the tree as
 * it ships rather than only in principle — three sections already wrap prose mid-sentence
 * (`skills/codex/kiwi-tdd`, `skills/etc/kiwi-tdd` and its `.agents` mirror) — and `may be
 * overridden` folded across two lines of that paragraph was measured at 20 passed.
 *
 * Flattening the WHOLE SECTION instead is the accident FR-FLOW-160 recorded: with the newline
 * boundaries gone the only boundary left was a table delimiter, and a pattern then reached across
 * 2,496 characters into an unrelated clause. A blank line is the boundary markdown itself uses, so
 * joining only within one block closes the fold and keeps every boundary a reader can see.
 *
 * A TABLE ROW is its own unit, and so is a heading — inside a quote as much as outside one, which
 * is why both are read after the quote marker is stripped rather than off the raw line. Joining
 * consecutive rows would put the 571 table lines these 27 sections carry into one blob per section,
 * which is FR-FLOW-160's shape again with cell walls for the boundaries it erased. A row is
 * `isTableRowLine`, the predicate `tableRows` reads by, and the two share it rather than each
 * holding a copy: they had diverged, and reading the leading `|` alone made a boundary out of a
 * line a renderer wraps into the prose below it — `| a | may be` continued by `overridden here`
 * rendered as one paragraph and was missed, and is caught now.
 *
 * A BLOCKQUOTE repeats its `>` on every line it wraps onto, so joining those lines raw left the
 * marker standing mid-string and the phrase still did not reassemble — the fold passed while the
 * renderer showed one paragraph. The marker is therefore stripped from each quoted line before the
 * join, and the quote is made a boundary where a quote STARTS after unquoted text, where a `>`-only
 * line blanks it, and where the NESTING DEPTH changes. These were rendered and counted rather than
 * reasoned about, and counting is what found the one place the boundary is NOT the renderer's: a
 * line DEDENTING to a shallower `>` is markdown's lazy continuation, so `>> one may be` above
 * `> overridden here` renders as a single paragraph while this closes between them and MISSES the
 * fold. Deepening is the opposite — a renderer opens a nested quote there — so no single rule
 * over `!==` serves both, and the miss was kept over the false alarm the other choice makes. It is
 * unreachable in a tree whose seven quote lines are all single-line and unnested, and AC-8, VE-6 Q8
 * and VE-7 record it. A LIST marker needs none of this and gets none: it is not repeated on a
 * wrapped line, so a wrapped item already joins while two items keep the `-` between them, which is
 * the split the renderer draws there.
 *
 * `splitListItems` opts into that split, for a reader whose check is PROXIMITY rather than
 * substring. `-` between two joined items is a boundary a substring search still sees and a
 * distance-bounded pattern does not: measured, `- 종료 줄을 쓴다` above `- 생략한다` reads as one
 * 15-character span to FR-FLOW-158's ban, which is a refusal of two bullets a renderer draws apart.
 * Off by default so FR-FLOW-164's blocks, and the counts it records over them, are unchanged.
 *
 * `splitFencedLines` is the same option for the same reader over the boundary FR-FLOW-164's notes
 * name as the other one: a CODE FENCE. A renderer preserves every line break inside a fence, so two
 * unrelated fields of one JSON object are never shown as one sentence, and joining them read as one
 * to a distance-bounded pattern — measured red on a two-field fence and on a two-line shell fence.
 * The fence delimiters are their own units and the lines between them are one unit each; a paragraph
 * after the fence closes joins as a paragraph again. Also off by default, and FR-FLOW-164 passes
 * neither option: its 27 declaring sections carry no fence at all, which its own notes record.
 */
export function scanUnits(
  section: string,
  { splitListItems = false, splitFencedLines = false }: { splitListItems?: boolean; splitFencedLines?: boolean } = {}
): ScanUnit[] {
  const units: ScanUnit[] = [];
  const lines = section.split("\n");
  let parts: string[] = [];
  let startLine = 0;
  // 0 outside a quote, otherwise how many `>` the open block's lines carry. A different depth is a
  // different blockquote, which is why a change in it closes the block rather than joining to it.
  let quoteDepth = 0;
  let inFence = false;
  const close = (endLine: number): void => {
    if (parts.length > 0) units.push({ text: parts.join(" "), startLine, endLine });
    parts = [];
    quoteDepth = 0;
  };
  const open = (index: number, text: string): void => {
    if (parts.length === 0) startLine = index + 1;
    parts.push(text);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] as string).trim();
    if (trimmed === "") {
      close(index);
      continue;
    }
    let content = trimmed;
    const quoted = /^(>+)\s?(.*)$/.exec(trimmed);
    if (quoted !== null) {
      const depth = (quoted[1] as string).length;
      content = (quoted[2] as string).trim();
      // A quote opening, a nesting change and a marker-only line each start a new paragraph in the
      // rendered output; only a line continuing the same depth is a soft wrap inside one.
      if (content === "" || depth !== quoteDepth) close(index);
      if (content === "") continue;
      quoteDepth = depth;
    }
    // Read AFTER the marker is off, because `> ## x` is a heading in the rendered output and this
    // check run over the raw line could not see it: the heading fell through to the quote branch,
    // lost its marker and joined the quoted line beneath it, which is a block a renderer never
    // draws. An unquoted line here is either prose or markdown's lazy continuation of an open
    // quote, which renders inside that same paragraph and so joins on the footing every soft wrap
    // has.
    // A fence delimiter both closes what is open and flips the state the lines under it are read in.
    if (splitFencedLines && FENCE_DELIMITER.test(content)) {
      close(index);
      inFence = !inFence;
      units.push({ text: content, startLine: index + 1, endLine: index + 1 });
      continue;
    }
    if (isTableRowLine(content) || /^#{1,6}\s/.test(content)) {
      close(index);
      units.push({ text: content, startLine: index + 1, endLine: index + 1 });
      continue;
    }
    // A marker OPENS an item; a line without one is that item's soft wrap and joins it. Inside a
    // fence there is no soft wrap at all: the renderer keeps every break, so every line opens.
    if ((splitListItems && LIST_MARKER.test(content)) || inFence) close(index);
    open(index, content);
  }
  close(lines.length);
  return units;
}

/**
 * Where a block sits, so a failure names a place rather than a joined string.
 *
 * `scope` names what the 1-based numbers are relative to, because they are relative to whatever
 * text was handed in: a declaring section for FR-FLOW-164, a whole file for FR-FLOW-158. Reporting
 * a file line as a section line sends the reader to the wrong place.
 */
export function unitAt(unit: ScanUnit, scope = "section"): string {
  return unit.startLine === unit.endLine ? `${scope} line ${unit.startLine}` : `${scope} lines ${unit.startLine}-${unit.endLine}`;
}

export interface Span {
  /** 0-based, inclusive. */
  start: number;
  /** 0-based, exclusive. */
  end: number;
  text: string;
}

/**
 * The maximal runs of a markdown numbered list, continuation lines included.
 *
 * A blank line inside a list does not end it — the list ends at the first non-blank line that is
 * neither a new item nor an indented continuation of one. That distinction is what lets a sequence
 * written as `1.` … blank … `2.` be read as one block rather than two.
 */
export function numberedLists(lines: readonly string[]): Span[] {
  const spans: Span[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!NUMBERED.test(lines[index] as string)) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length) {
      const line = lines[end] as string;
      const continues = NUMBERED.test(line) || (line.startsWith(" ") && line.trim() !== "");
      if (continues) {
        end += 1;
        continue;
      }
      const next = lines[end + 1];
      const blankThenMore = line.trim() === "" && next !== undefined && (NUMBERED.test(next) || (next.startsWith(" ") && next.trim() !== ""));
      if (blankThenMore) {
        end += 2;
        continue;
      }
      break;
    }
    spans.push({ start: index, end, text: lines.slice(index, end).join("\n") });
    index = end;
  }
  return spans;
}

/**
 * The section a line sits in: the nearest heading at or above it, up to the NEXT heading of any
 * depth.
 *
 * Depth-insensitive on purpose. A `##` section that contains a `###` subsection about something
 * else would drag that subsection into a byte comparison, and freezing text a different
 * requirement owns is exactly the cost FR-FLOW-155 paid and recorded. Ending at the next heading
 * keeps one subject per compared span.
 */
export function enclosingSection(lines: readonly string[], lineIndex: number): Span | null {
  let start = -1;
  for (let index = lineIndex; index >= 0; index -= 1) {
    if (HEADING.test(lines[index] as string)) {
      start = index;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (HEADING.test(lines[index] as string)) {
      end = index;
      break;
    }
  }
  return { start, end, text: lines.slice(start, end).join("\n").replace(/\s+$/, "") };
}
