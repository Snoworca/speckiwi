import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * @req FR-FLOW-141 — a comment does not cite a location by absolute line number.
 *
 * The scan owns its file reading for the same reason the `@req` scan does: a text search treats a
 * file containing a NUL byte as binary and skips it without a word, and several files in these trees
 * carry one.
 */

export interface LocationCitation {
  /** Path relative to the scan root, POSIX-separated. */
  readonly file: string;
  /** 1-based line of the comment carrying the citation. */
  readonly line: number;
  /** The citation as written, e.g. `SKILL.md:569`. @cite-lint: ignore — an illustration of the shape. */
  readonly citation: string;
}

const SOURCE_FILE = /\.(?:[cm]?ts|tsx)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);
/** A comment line: `//`, or a block-comment opener or continuation. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
/**
 * A filename with an extension, followed by a line number — and optionally a range end.
 *
 * Anchored on the extension on purpose. A bare number in prose ("the parser reports line 42") is a
 * value the code computes and says nothing about where anything lives; what rots is a number
 * attached to a file, because editing that file moves it.
 */
const CITATION = /[A-Za-z0-9_.@/-]+\.(?:[cm]?ts|tsx|js|mjs|md|json):\d+(?:-\d+)?/g;
/**
 * The escape hatch, scoped to the single line it is written on — the same shape as `@req-lint`.
 * A file-level or region-level form would let a file exempt itself by accident, or let an
 * unterminated region swallow every line after it.
 */
export const EXEMPTION = /@cite-lint:\s*ignore\b/;

export function extractLocationCitations(text: string, file: string): LocationCitation[] {
  const found: LocationCitation[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!COMMENT_LINE.test(line) || EXEMPTION.test(line)) return;
    for (const match of line.matchAll(CITATION)) {
      found.push({ file, line: index + 1, citation: match[0] });
    }
  });
  return found;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await sourceFiles(entryPath)));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

export async function collectLocationCitations(
  roots: readonly string[],
  options: { root: string }
): Promise<LocationCitation[]> {
  const found: LocationCitation[] = [];
  for (const root of roots) {
    for (const file of await sourceFiles(root)) {
      const relative = path.relative(options.root, file).split(path.sep).join("/");
      found.push(...extractLocationCitations(await readFile(file, "utf8"), relative));
    }
  }
  return found;
}

/** `file:line citation`, one per line — a lookup rather than a search. */
export function formatLocationCitations(citations: readonly LocationCitation[]): string {
  return citations.map((entry) => `${entry.file}:${entry.line} cites ${entry.citation}`).join("\n");
}
