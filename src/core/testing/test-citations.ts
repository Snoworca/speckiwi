import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// @req FR-NODE-210 AC-1 AC-3 @req REL-NODE-007
//
// The one citation scanner: requirement ids cited in source text. Two readings share it — the `@req`
// citations REL-NODE-007 resolves (re-exported to the repository's own tests by
// `test/support/req-references.ts`) and the test-line citations `coverage --tests` counts — so they
// share one id pattern and one file walk and cannot drift apart.
//
// The walk reads every candidate as UTF-8 itself. `grep` and the tools built on it treat a file holding
// a NUL byte as binary and skip it without a word; reading the file directly keeps it visible.

/**
 * A Requirement ID in free text: an uppercase prefix, one or more scope segments and a numeric tail —
 * `FR-NODE-188`, `FR-2FA-001`, `FR-AUTH-2-001`. A scope segment may start with a digit and a scope may
 * have several parts, because the requirement heading grammar (`REQUIREMENT_HEADING_RE`) allows both.
 * The prefix stays open rather than listing the known ones, so an `@req` naming an invented prefix is
 * still extracted and reported as unknown (REL-NODE-007 AC-1).
 */
export const REQUIREMENT_ID_SOURCE = "[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+-\\d+";

/** `@req`, but not `@req-lint` — the exemption marker must not read as a citation of itself. */
export const REQ_MARKER_SOURCE = "@req(?![-\\w])";

/** Directories no scan descends into: installed packages, build output and version control. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", "dist", ".git", ".hg", ".svn"]);

/** One token found in a line, with the offset it starts at. */
interface Token {
  readonly id: string;
  readonly at: number;
}

/**
 * The requirement ids in `text` with their offsets. An `SDS-AC-<n>` token has the same shape and is an
 * SDS contract id, never a requirement, so it is left out.
 */
function requirementIdTokens(text: string): Token[] {
  return [...text.matchAll(new RegExp(`\\b(${REQUIREMENT_ID_SOURCE})\\b`, "g"))]
    .map((match) => ({ id: match[1] as string, at: match.index }))
    .filter((token) => !/^SDS-AC-\d+$/.test(token.id));
}

/** The `AC-<n>` tokens in `text` with their offsets — whole tokens only, never the tail of an `SDS-AC-<n>`. */
function acceptanceCriterionTokens(text: string): Token[] {
  return [...text.matchAll(/(?<![A-Za-z0-9-])AC-\d+\b/g)].map((match) => ({ id: match[0], at: match.index }));
}

/** Every requirement id in `text`, in order of appearance. */
export function requirementIdsIn(text: string): string[] {
  return requirementIdTokens(text).map((token) => token.id);
}

/** Every `AC-<n>` token in `text`, in order of appearance. */
export function acceptanceCriterionIdsIn(text: string): string[] {
  return acceptanceCriterionTokens(text).map((token) => token.id);
}

/**
 * The `requirementId\u0000AC-n` keys one line cites. The convention writes a requirement id once,
 * before its ACs (`FR-X-001 AC-1 AC-3 / FR-X-002 AC-2`), so each AC belongs to the nearest requirement
 * id before it on the line, and an AC with no id before it cites nothing. Pairing every id with every
 * AC credited `FR-X-001 AC-2` to a line that says no such thing. @req FR-NODE-210 AC-2
 */
function citedCriterionKeys(text: string): Set<string> {
  const ids = requirementIdTokens(text);
  const keys = new Set<string>();
  for (const criterion of acceptanceCriterionTokens(text)) {
    const owner = ids.filter((id) => id.at < criterion.at).at(-1);
    if (owner !== undefined) keys.add(`${owner.id}\u0000${criterion.id}`);
  }
  return keys;
}

/** Every `SDS-AC-<n>` token in `text`. */
export function sdsContractIdsIn(text: string): string[] {
  return [...text.matchAll(/(?<![A-Za-z0-9-])SDS-AC-\d+\b/g)].map((match) => match[0]);
}

/** Workspace-relative POSIX paths of every file under `directory` that `accept` admits, sorted. */
async function walkFiles(directory: string, root: string, accept: (relativePath: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await walkFiles(entryPath, root, accept)));
    } else if (entry.isFile()) {
      const relative = path.relative(root, entryPath).split(path.sep).join("/");
      if (accept(relative)) files.push(relative);
    }
  }
  return files.sort();
}

// --- `@req` citations in source (REL-NODE-007) -----------------------------------------------------

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
const MARKER = new RegExp(REQ_MARKER_SOURCE);
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
    for (const id of requirementIdsIn(line.slice(marker.index + marker[0].length))) {
      references.push({ file, line: index + 1, id });
    }
  });
  return references;
}

export async function collectReqReferences(roots: readonly string[], options: { root: string }): Promise<ReqReference[]> {
  const references: ReqReference[] = [];
  for (const root of roots) {
    for (const relative of await walkFiles(root, options.root, (file) => SOURCE_FILE.test(file))) {
      references.push(...extractReqReferences(await readFile(path.join(options.root, relative), "utf8"), relative));
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

// --- test-line citations (FR-NODE-210) -------------------------------------------------------------

/** The files counted as tests unless `--test-glob` replaces them (FR-NODE-210 AC-3). */
export const DEFAULT_TEST_FILE_GLOBS: readonly string[] = Object.freeze([
  "**/*.test.*",
  "**/*.spec.*",
  "**/test_*.py",
  "**/*_test.py",
  "**/*_test.go",
  "**/*Test.java",
  "**/*Tests.cs",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**"
]);

/**
 * A glob over workspace-relative POSIX paths: `**` spans directories (a leading `**` + `/` may match
 * none, a trailing `/` + `**` needs at least one more segment), `*` and `?` stay inside one segment.
 */
export function globToRegExp(glob: string): RegExp {
  const source = glob.replace(/\\/g, "/");
  let pattern = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("**/", index)) {
      pattern += "(?:.*/)?";
      index += 3;
    } else if (source.startsWith("/**", index) && index + 3 === source.length) {
      pattern += "/.+";
      index += 3;
    } else if (source.startsWith("**", index)) {
      pattern += ".*";
      index += 2;
    } else {
      const char = source[index] as string;
      pattern += char === "*" ? "[^/]*" : char === "?" ? "[^/]" : char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      index += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** Whether a workspace-relative POSIX path is a test file under `globs`, with the globs compiled once. */
export function testFileMatcher(globs: readonly string[] = DEFAULT_TEST_FILE_GLOBS): (relativePath: string) => boolean {
  const patterns = globs.map(globToRegExp);
  return (relativePath) => patterns.some((pattern) => pattern.test(relativePath));
}

/** Every test file under `rootPath`, as sorted workspace-relative POSIX paths. */
export async function listTestFiles(rootPath: string, globs: readonly string[] = DEFAULT_TEST_FILE_GLOBS): Promise<string[]> {
  return walkFiles(rootPath, rootPath, testFileMatcher(globs));
}

export interface TestCitation {
  readonly file: string;
  readonly line: number;
}

export interface TestCitationIndex {
  /** Lines on which `AC-<n>` follows the requirement id with no other requirement id between them. */
  acCitations(requirementId: string, acId: string): TestCitation[];
  /** Lines of one file that carry `SDS-AC-<n>`. SDS-AC numbers restart per SDS, so the file scopes them. */
  sdsCitations(file: string, sdsAcId: string): TestCitation[];
}

/** One pass over the test files' lines, answering both citation questions from it. */
export function indexTestCitations(files: ReadonlyArray<{ path: string; text: string }>): TestCitationIndex {
  const byCriterion = new Map<string, TestCitation[]>();
  const bySdsContract = new Map<string, TestCitation[]>();
  const add = (map: Map<string, TestCitation[]>, key: string, citation: TestCitation): void => {
    const list = map.get(key) ?? [];
    list.push(citation);
    map.set(key, list);
  };
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    file.text.split(/\r?\n/).forEach((text, index) => {
      const citation = { file: file.path, line: index + 1 };
      for (const key of citedCriterionKeys(text)) add(byCriterion, key, citation);
      for (const sdsAcId of new Set(sdsContractIdsIn(text))) add(bySdsContract, `${file.path}\u0000${sdsAcId}`, citation);
    });
  }
  return {
    acCitations: (requirementId, acId) => [...(byCriterion.get(`${requirementId}\u0000${acId}`) ?? [])],
    sdsCitations: (file, sdsAcId) => [...(bySdsContract.get(`${file}\u0000${sdsAcId}`) ?? [])]
  };
}
