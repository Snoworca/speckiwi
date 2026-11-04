// @req FR-NODE-232 — the one markdown link extractor. renameScope rewrites what it finds and
// `links check` reads it, so a link form one of them recognises the other recognises too.

import path from "node:path";
import { classifyDocumentLines, skipCodeSpan, type DocumentLine } from "./document-lines.js";

export interface TextSpan {
  /** Offset of the first character in the line. */
  start: number;
  /** Offset just past the last character. */
  end: number;
  value: string;
}

interface LinkBase {
  /** The whole link in the line, `[` to its last character. */
  start: number;
  end: number;
}

/** `[text](destination "title")`; the destination span excludes angle brackets. */
export interface InlineLink extends LinkBase {
  kind: "inline";
  text: TextSpan;
  destination: TextSpan;
  /** The title inside its quotes or parentheses, when there is one. */
  title?: TextSpan;
}

/**
 * `[text][label]` (full), `[text][]` (collapsed) or `[text]` (shortcut). Whether it is a link at all
 * depends on a definition with the same key, which only the whole document can tell.
 */
export interface ReferenceLink extends LinkBase {
  kind: "reference";
  form: "full" | "collapsed" | "shortcut";
  text: TextSpan;
  /** Present only in the full form; otherwise the text is the key. */
  label?: TextSpan;
}

/** `[label]: destination "title"` at the start of a line. */
export interface LinkDefinition extends LinkBase {
  kind: "definition";
  label: TextSpan;
  destination: TextSpan;
  /** The title; when `continuationLines` is set its span is in the last of those lines. */
  title?: TextSpan;
  /**
   * How many lines after its own the definition occupies — 1 when its title sits on the next line.
   * Set only by {@link findMarkdownLinksInDocument}, which sees the next line; absent means one line.
   */
  continuationLines?: number;
}

/** `<https://…>`, `<mailto:…>` or `<name@host>` (CommonMark §6.5); the destination excludes the brackets. */
export interface Autolink extends LinkBase {
  kind: "autolink";
  destination: TextSpan;
}

export type MarkdownLink = InlineLink | ReferenceLink | LinkDefinition | Autolink;

/** A URI autolink's scheme and body, and an email autolink, as CommonMark §6.5 defines them. */
const URI_AUTOLINK = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>\x00-\x1f\x7f]*$/;
const EMAIL_AUTOLINK = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** The autolink opening at `at` (a `<`), or undefined when the bracketed run is not one. */
function autolinkAt(line: string, at: number): Autolink | undefined {
  const close = line.indexOf(">", at + 1);
  if (close < 0) return undefined;
  const inner = line.slice(at + 1, close);
  if (!URI_AUTOLINK.test(inner) && !EMAIL_AUTOLINK.test(inner)) return undefined;
  return { kind: "autolink", start: at, end: close + 1, destination: span(line, at + 1, close) };
}

/** Whether a reference's key has a definition in the document; undefined when only one line is known. */
type IsDefined = ((key: string) => boolean) | undefined;

/**
 * Whether a link's text holds a link (an image is not one): CommonMark forbids links in links, so the
 * outer brackets are text (§6.3). A shortcut reference is a link only when its key is defined, which
 * only the document can tell; on a lone line it is not counted.
 */
function holdsLink(text: TextSpan, isDefined: IsDefined): boolean {
  return scanLine(text.value, undefined, isDefined).some((inner) => {
    if (text.value[inner.start - 1] === "!") return false;
    if (inner.kind === "inline") return true;
    if (inner.kind !== "reference") return false;
    return inner.form !== "shortcut" || isDefined?.(referenceKey(inner.text.value)) === true;
  });
}

/** The key a reference and its definition share: case and runs of whitespace do not matter. */
export function referenceKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function span(line: string, start: number, end: number): TextSpan {
  return { start, end, value: line.slice(start, end) };
}

/**
 * For each `[` of the line, the offset of the `]` that closes it (nesting counted, escapes and code
 * spans skipped), or -1. One pass with a stack, so a line of unclosed brackets costs linear time
 * rather than a scan to the end of the line per bracket.
 */
function bracketPairs(line: string): Int32Array {
  const pairs = new Int32Array(line.length).fill(-1);
  const open: number[] = [];
  let at = 0;
  while (at < line.length) {
    const char = line[at];
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === "`") {
      at = skipCodeSpan(line, at);
      continue;
    }
    if (char === "[") open.push(at);
    if (char === "]" && open.length > 0) pairs[open.pop() ?? 0] = at;
    at += 1;
  }
  return pairs;
}

function closingBracket(pairs: Int32Array, open: number): number {
  return pairs[open] ?? -1;
}

function skipBlanks(line: string, at: number): number {
  while (line[at] === " " || line[at] === "\t") at += 1;
  return at;
}

/** A destination starting at `at`: `<...>` or a run without blanks and with balanced parentheses. */
function readDestination(line: string, at: number): { destination: TextSpan; end: number } | undefined {
  if (line[at] === "<") {
    let close = at + 1;
    while (close < line.length && line[close] !== ">" && line[close] !== "<") close += line[close] === "\\" ? 2 : 1;
    return line[close] === ">" ? { destination: span(line, at + 1, close), end: close + 1 } : undefined;
  }
  let depth = 0;
  let end = at;
  while (end < line.length) {
    const char = line[end];
    if (char === "\\") {
      end += 2;
      continue;
    }
    if (char === " " || char === "\t") break;
    if (char === "(") depth += 1;
    if (char === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    end += 1;
  }
  return { destination: span(line, at, Math.min(end, line.length)), end: Math.min(end, line.length) };
}

/**
 * An optional title (`"..."`, `'...'` or `(...)`) starting at `at`: its inner span and the offset past
 * it, `{ end: at }` when there is none, or undefined when one opens and never closes.
 */
function readTitle(line: string, at: number): { title?: TextSpan; end: number } | undefined {
  const closer = ({ '"': '"', "'": "'", "(": ")" } as Record<string, string | undefined>)[line[at] ?? ""];
  if (!closer) return { end: at };
  let close = at + 1;
  while (close < line.length && line[close] !== closer) close += line[close] === "\\" ? 2 : 1;
  return close < line.length ? { title: span(line, at + 1, close), end: close + 1 } : undefined;
}

function inlineTail(line: string, openParen: number): { destination: TextSpan; title?: TextSpan; end: number } | undefined {
  const read = readDestination(line, skipBlanks(line, openParen + 1));
  if (!read) return undefined;
  const beforeTitle = skipBlanks(line, read.end);
  // A title is separated from a destination by a blank.
  const titled = beforeTitle > read.end || read.destination.value === "" ? readTitle(line, beforeTitle) : { end: beforeTitle };
  if (!titled) return undefined;
  const close = skipBlanks(line, titled.end);
  if (line[close] !== ")") return undefined;
  return { destination: read.destination, ...(titled.title ? { title: titled.title } : {}), end: close + 1 };
}

/** The definition whose `[` is at `open`, the start of the line's own block. */
function definitionAt(line: string, open: number): LinkDefinition | undefined {
  if (line[open] !== "[") return undefined;
  const pairs = bracketPairs(line);
  const close = closingBracket(pairs, open);
  if (close < 0 || line[close + 1] !== ":" || close === open + 1) return undefined;
  const read = readDestination(line, skipBlanks(line, close + 2));
  if (!read || read.destination.value === "") return undefined;
  const rest = line.slice(read.end);
  if (rest !== "" && !/^[ \t]/.test(rest)) return undefined;
  const label = span(line, open + 1, close);
  const titled = readTitle(line, skipBlanks(line, read.end));
  if (titled?.title && line.slice(titled.end).trim() === "") {
    return { kind: "definition", start: open, end: titled.end, label, destination: read.destination, title: titled.title };
  }
  return { kind: "definition", start: open, end: read.end, label, destination: read.destination };
}

/**
 * Every link in one line, in order: inline links (with or without a title, destination bare or in
 * angle brackets, nested brackets in the text), reference links in their three forms, and a link
 * definition. Escaped brackets and code spans are not links. A table row is just a line, so the links
 * in its cells are found like any others.
 */
export function findMarkdownLinks(line: string): MarkdownLink[] {
  const open = skipBlanks(line, 0);
  return scanLine(line, open <= 3 ? definitionAt(line, open) : undefined, undefined);
}

/** The links of one line: the definition the caller found there, or every other link in it. */
function scanLine(line: string, defined: LinkDefinition | undefined, isDefined: IsDefined): MarkdownLink[] {
  if (defined) return [defined];
  const pairs = bracketPairs(line);
  const links: MarkdownLink[] = [];
  let at = 0;
  while (at < line.length) {
    const char = line[at];
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === "`") {
      at = skipCodeSpan(line, at);
      continue;
    }
    if (char === "<") {
      const autolink = autolinkAt(line, at);
      if (autolink) {
        links.push(autolink);
        at = autolink.end;
        continue;
      }
    }
    const close = char === "[" ? closingBracket(pairs, at) : -1;
    if (close < 0) {
      at += 1;
      continue;
    }
    const text = span(line, at + 1, close);
    // A link inside the text makes the outer brackets plain text; scanning resumes inside them.
    if ((line[close + 1] === "(" || line[close + 1] === "[") && holdsLink(text, isDefined)) {
      at += 1;
      continue;
    }
    if (line[close + 1] === "(") {
      const tail = inlineTail(line, close + 1);
      if (tail) {
        links.push({ kind: "inline", start: at, end: tail.end, text, destination: tail.destination, ...(tail.title ? { title: tail.title } : {}) });
        at = tail.end;
        continue;
      }
    }
    const labelClose = line[close + 1] === "[" ? closingBracket(pairs, close + 1) : -1;
    if (labelClose >= 0) {
      const full = labelClose > close + 2;
      links.push({
        kind: "reference",
        form: full ? "full" : "collapsed",
        start: at,
        end: labelClose + 1,
        text,
        ...(full ? { label: span(line, close + 2, labelClose) } : {})
      });
      at = labelClose + 1;
      continue;
    }
    // A shortcut reference may hold a real link inside it, so scanning resumes within its text.
    links.push({ kind: "reference", form: "shortcut", start: at, end: close + 1, text });
    at += 1;
  }
  return links;
}

/**
 * The link reference definitions of a document, by line (CommonMark §4.7): a definition starts the
 * line's own block, inside block quotes and list items too, and cannot interrupt a paragraph, so it
 * stands at a paragraph's start or right after another definition. Its title may sit on the next line,
 * which the definition then spans; that line is undefined here and marked as taken.
 */
function documentDefinitions(lines: readonly string[], classified: readonly DocumentLine[]): { byLine: (LinkDefinition | undefined)[]; taken: Set<number> } {
  const byLine: (LinkDefinition | undefined)[] = [];
  const taken = new Set<number>();
  let afterDefinition = false;
  for (let index = 0; index < classified.length; index += 1) {
    const line = classified[index]!;
    const candidate: LinkDefinition | undefined = line.body && (!line.continuesParagraph || afterDefinition) ? definitionAt(line.text, line.contentStart) : undefined;
    afterDefinition = candidate !== undefined;
    if (candidate === undefined) continue;
    // @req FR-PARSE-044 AC-6 — a title on the next line; only the document can tell, not one line.
    const next = classified[index + 1];
    if (candidate.title === undefined && next?.body === true && (lines[index] ?? "").slice(candidate.end).trim() === "") {
      const titled = readTitle(next.text, next.contentStart);
      if (titled?.title !== undefined && next.text.slice(titled.end).trim() === "") {
        byLine[index] = { ...candidate, title: titled.title, continuationLines: 1 };
        taken.add(index + 1);
        index += 1;
        continue;
      }
    }
    byLine[index] = candidate;
  }
  return { byLine, taken };
}

/**
 * Every link in a whole document, one array per line. Only body lines hold links (classifyDocumentLines:
 * not code, not inside an HTML comment). Offsets are those of the original lines. Definitions are read
 * first, so a shortcut reference inside another link's brackets is known to be a link when it is defined.
 */
export function findMarkdownLinksInDocument(lines: readonly string[]): MarkdownLink[][] {
  const classified = classifyDocumentLines(lines);
  const { byLine, taken } = documentDefinitions(lines, classified);
  const keys = new Set(byLine.flatMap((defined) => (defined ? [referenceKey(defined.label.value)] : [])));
  const isDefined = (key: string): boolean => keys.has(key);
  return classified.map((line, index) => (line.body && !taken.has(index) ? scanLine(line.text, byLine[index], isDefined) : []));
}

/** One link reference definition of a document, as {@link linkDefinitions} reports it. */
export interface DocumentLinkDefinition {
  destination: string;
  title?: string;
  /** 1-based first line of the definition. */
  startLine: number;
  /** 1-based last line: the next line when the title sits there, otherwise `startLine`. */
  endLine: number;
}

// @req FR-PARSE-044 AC-6
/**
 * Every link reference definition in a document, keyed by {@link referenceKey}. The first definition of
 * a key wins, as in CommonMark; a later one is void. Only body lines count (not fenced or indented code,
 * not an HTML comment), and a definition whose title sits on the next line spans both lines.
 */
export function linkDefinitions(lines: readonly string[]): Map<string, DocumentLinkDefinition> {
  const out = new Map<string, DocumentLinkDefinition>();
  findMarkdownLinksInDocument(lines).forEach((lineLinks, index) => {
    for (const link of lineLinks) {
      if (link.kind !== "definition") continue;
      const key = referenceKey(link.label.value);
      if (out.has(key)) continue;
      out.set(key, {
        destination: link.destination.value,
        ...(link.title ? { title: link.title.value } : {}),
        startLine: index + 1,
        endLine: index + 1 + (link.continuationLines ?? 0)
      });
    }
  });
  return out;
}

export type LinkDestination =
  | { kind: "external" }
  | { kind: "same-document"; fragment?: string }
  | { kind: "local"; path: string; fragment?: string };

const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const MALFORMED_PERCENT = /%(?![0-9A-Fa-f]{2})/;
/** The characters a backslash may escape (CommonMark §2.4). */
const ASCII_PUNCTUATION = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Percent-decoding that never throws: bytes that are not valid UTF-8 become U+FFFD. */
function percentDecode(value: string): string {
  const parts = value.split(/(%[0-9A-Fa-f]{2})/);
  const bytes = parts.flatMap((part) =>
    /^%[0-9A-Fa-f]{2}$/.test(part) ? [Number.parseInt(part.slice(1), 16)] : [...encoder.encode(part)]
  );
  return decoder.decode(new Uint8Array(bytes));
}

/**
 * What a link destination names. Any URI scheme is external; otherwise the query and fragment are
 * dropped from the path, which is percent-decoded and written with forward slashes. Resolving the
 * path against a directory is the caller's: each caller knows what its links are relative to.
 */
export function classifyLinkDestination(destination: string): LinkDestination {
  const trimmed = destination.trim();
  // `C:/x` reads like a scheme but is a Windows absolute path.
  if (URI_SCHEME.test(trimmed) && !WINDOWS_DRIVE.test(trimmed)) return { kind: "external" };
  // @req FR-NODE-242 AC-1 — a backslash before ASCII punctuation is an escape (CommonMark §2.4): the
  // character is literal, so an escaped `#` or `?` splits nothing. Only a backslash left over after
  // that is read as a Windows path separator.
  const characters: Array<{ value: string; escaped: boolean }> = [];
  for (let at = 0; at < trimmed.length; at += 1) {
    const char = trimmed[at]!;
    const next = trimmed[at + 1];
    if (char === "\\" && next !== undefined && ASCII_PUNCTUATION.has(next)) {
      characters.push({ value: next, escaped: true });
      at += 1;
    } else {
      characters.push({ value: char, escaped: false });
    }
  }
  const text = (from: number, to: number) => characters.slice(from, to).map((entry) => entry.value).join("");
  const hashAt = characters.findIndex((entry) => entry.value === "#" && !entry.escaped);
  const fragment = hashAt < 0 ? undefined : text(hashAt + 1, characters.length);
  const pathEnd = hashAt < 0 ? characters.length : hashAt;
  const queryAt = characters.slice(0, pathEnd).findIndex((entry) => entry.value === "?" && !entry.escaped);
  const rawPath = characters
    .slice(0, queryAt < 0 ? pathEnd : queryAt)
    .map((entry) => (entry.value === "\\" && !entry.escaped ? "/" : entry.value))
    .join("");
  const withFragment = fragment !== undefined ? { fragment } : {};
  if (rawPath === "") return { kind: "same-document", ...withFragment };
  const decoded = MALFORMED_PERCENT.test(rawPath) ? rawPath : percentDecode(rawPath);
  return { kind: "local", path: decoded, ...withFragment };
}

/**
 * The repository-relative path a link names, resolved against `baseDirectory` (itself repository
 * relative, e.g. the linking file's directory). External, same-document and absolute links name no
 * repository path.
 */
export function resolveRepositoryLink(destination: string, baseDirectory: string): string | undefined {
  const classified = classifyLinkDestination(destination);
  if (classified.kind !== "local" || classified.path.startsWith("/") || WINDOWS_DRIVE.test(classified.path)) return undefined;
  return path.posix.join(baseDirectory, classified.path);
}

/** A requirement's Related Docs entry resolves against docs/spec wherever the requirement lives. */
export const RELATED_DOCS_BASE = "docs/spec";

export function resolveRelatedDocsLink(destination: string): string | undefined {
  return resolveRepositoryLink(destination, RELATED_DOCS_BASE);
}
