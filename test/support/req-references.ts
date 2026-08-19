import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * @req REL-NODE-007 — resolve `@req` citations in source against the requirements that exist.
 *
 * The scan owns its file reading on purpose. `grep` and every tool built on it treat a file
 * containing a NUL byte as binary and skip it without a word, and five of the files this scan reads
 * carry one; reading each candidate as UTF-8 is what makes those files visible to the check.
 */

export interface ReqReference {
  /** Path relative to the scan root, POSIX-separated so a report reads the same on any platform. */
  readonly file: string;
  /** 1-based line of the citation. */
  readonly line: number;
  readonly id: string;
}

export interface ReqReferenceReport {
  /** Citations naming an id no requirement carries. These are the failures. */
  readonly unknown: ReqReference[];
  /** Citations of retracted requirements. Reviewable, but legitimate, so never a failure. */
  readonly discarded: ReqReference[];
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);
/** `@req`, but not `@req-lint` — the exemption marker must not read as a citation of itself. */
const MARKER = /@req(?![-\w])/;
/** A Requirement ID: two or more uppercase segments and a numeric tail, e.g. `FR-NODE-188`. */
const REQUIREMENT_ID = /\b([A-Z][A-Z0-9]+(?:-[A-Z][A-Z0-9]*)+-\d+)\b/g;
/**
 * The escape hatch, scoped to the single line it is written on. A test that builds a fixture has to
 * write a fabricated id as real source text, and without a way to say so that fixture becomes the
 * one unresolvable citation in the tree — which invites deleting the fixture to quiet the check.
 *
 * One line is the whole scope on purpose. A file-level or region-level form would let a real file
 * exempt itself by accident, or let an unterminated region swallow everything after it; a same-line
 * marker cannot drift away from what it exempts and cannot cover a line nobody looked at.
 */
const EXEMPTION = /@req-lint:\s*ignore\b/;

/**
 * Every requirement id cited on a line that carries `@req`. All ids after the marker count, because
 * a citation routinely names more than one owner (`@req FR-NODE-188 / FR-FLOW-134`), and reading
 * only the first leaves the rest unchecked.
 */
export function extractReqReferences(text: string, file: string): ReqReference[] {
  const references: ReqReference[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (EXEMPTION.test(line)) return;
    const marker = MARKER.exec(line);
    if (!marker) return;
    for (const match of line.slice(marker.index + marker[0].length).matchAll(REQUIREMENT_ID)) {
      references.push({ file, line: index + 1, id: match[1] as string });
    }
  });
  return references;
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

export async function collectReqReferences(roots: readonly string[], options: { root: string }): Promise<ReqReference[]> {
  const references: ReqReference[] = [];
  for (const root of roots) {
    for (const file of await sourceFiles(root)) {
      const relative = path.relative(options.root, file).split(path.sep).join("/");
      references.push(...extractReqReferences(await readFile(file, "utf8"), relative));
    }
  }
  return references;
}

export function classifyReqReferences(
  references: readonly ReqReference[],
  known: ReadonlySet<string>,
  discarded: ReadonlySet<string>
): ReqReferenceReport {
  return {
    unknown: references.filter((reference) => !known.has(reference.id)),
    discarded: references.filter((reference) => known.has(reference.id) && discarded.has(reference.id))
  };
}

/** `file:line id`, one per line — a lookup rather than a search. */
export function formatReqReferences(references: readonly ReqReference[]): string {
  return references.map((reference) => `${reference.file}:${reference.line} ${reference.id}`).join("\n");
}
