import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./kiwi-orchestrator-variants.js";

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

/** Every markdown file under `<rendering>/<skill>`, as repo-relative POSIX paths. */
export function markdownFiles(rendering: string, skill?: string): string[] {
  const base = skill === undefined ? path.join(REPO_ROOT, rendering) : path.join(REPO_ROOT, rendering, skill);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) out.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
    }
  };
  walk(base);
  return out;
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
