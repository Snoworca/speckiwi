import path from "node:path";
import { classifyDocumentLines, maskInlineComments, skipCodeSpan } from "../parser/document-lines.js";
import {
  classifyLinkDestination,
  findMarkdownLinks,
  findMarkdownLinksInDocument,
  linkDefinitions,
  referenceKey,
  resolveRepositoryLink,
  type MarkdownLink
} from "../parser/markdown-links.js";
import { isPrdFilePath } from "./paths.js";

// @req FR-NODE-242 — the one reader of PRD citations in SRS text: `links check` resolves the
// references it finds, and coverage judges each requirement and criterion by them.
//
// The text is read once into tokens, without rewriting it: the shared link scanner splits each line
// into links, code spans and running text. A link cites through its destination, resolved from the
// linking document's directory (`resolveRepositoryLink`), and only when that lands on a PRD file
// (paths.ts); its text is the link's, not running text. A reference link resolves through a definition
// in the same text, and one without a definition is not a link (CommonMark), so `[PRD-1]` is running
// text. A code span holds no citation. Running text cites with a bare `PRD-<n>` or a repository path
// `docs/prd/<file>.prd.md#PRD-<n>`, which ends at a blank or at `;`: a path holding one is written as a
// link.
//
// The Rationale grammar kiwi-srs writes (skills/claude/kiwi-srs/SKILL.md: the PRD verdict rules (b)
// and (c), and "요구마다 Rationale 에 인용한 PRD 항목(`AC-n ← PRD-m`)이나 `fills:` 근거"), read from the
// running-text tokens only:
// - `AC-1, AC-2 ← PRD-3 (...)`: a head names criteria (a list, or a range `AC-1–AC-3`), and the
//   citations up to the next head are their basis. `AC-4 ← fills: PRD-4 / ...` and `AC-4 fills: ...`
//   give the head a fills basis.
// - `fills: PRD-4 / <kind> / <reason>`: the fills basis grounds the criteria its reason names
//   (`for AC-5, ...`). A fills naming no criterion is the requirement's basis, not any criterion's.
// - A citation outside any head and outside a fills is the requirement's, not any criterion's.
// Line breaks and `;` end every clause.

// The suffix here only finds candidates; `isPrdFilePath` decides. Case is spelled out per letter
// because a RegExp modifier group (a flag letter after `(?`) needs Node.js 23, and engines.node admits 22 (FR-NODE-275).
const TEXT_PATH = String.raw`(?<![\w./-])[dD][oO][cC][sS]/[pP][rR][dD]/[^\s;#()[\]` + "`" + String.raw`'"|]+?\.[pP][rR][dD]\.[mM][dD]`;
const CRITERION = String.raw`(?<![\w-])AC-\d+`;
const RUNNING_TEXT_RE = new RegExp(
  [
    String.raw`(?<end>[\n;])`,
    String.raw`(?<head>${CRITERION}(?:\s*[,–~]\s*AC-\d+)*)(?=\s*(?:←|fills:))`,
    String.raw`(?<arrow>←)`,
    String.raw`(?<fills>\bfills:)`,
    String.raw`(?<path>${TEXT_PATH})#(?<qualified>PRD-\d+)\b`,
    String.raw`(?<![#\w/-])(?<bare>PRD-\d+)\b`,
    String.raw`(?<mention>${CRITERION}(?:\s*[–~]\s*AC-\d+)?)`
  ].join("|"),
  "g"
);
const CRITERION_RANGE_RE = /AC-(\d+)(?:\s*[–~]\s*AC-(\d+))?/g;
const ITEM_ID_RE = /^PRD-\d+$/;
// CommonMark raw HTML: an open tag with its attributes, or a closing tag. An autolink (`<https://…>`)
// is not one: its name runs into `:`.
const HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;
/** Running text between tokens that is only spacing or punctuation lets a fills open the head before it. */
const FILLER_RE = /^[\s:.,]*$/;

export interface PrdReference {
  /** The reference as a repository path and item, e.g. `docs/prd/x.prd.md#PRD-2`. */
  reference: string;
  path: string;
  itemId: string;
}

export interface PrdCitation {
  itemId: string;
  /** The PRD file a qualified citation names; absent for a bare `PRD-<n>`. */
  path?: string;
}

/** Criterion numbers as inclusive ranges: `AC-3` is 3..3, `AC-1–AC-20261104` stays one range. */
export interface CriterionRange {
  from: number;
  to: number;
}

/** Criteria named by a head or a fills reason, and the citations that are their basis. */
export interface CriterionBasis {
  criteria: CriterionRange[];
  citations: PrdCitation[];
}

type Token =
  | { kind: "end" | "arrow" | "fills" | "prose" }
  | { kind: "head" | "mention"; ranges: CriterionRange[] }
  | { kind: "citation"; citation: PrdCitation };

/** Whether `criterionId` (`AC-<n>`) falls in one of the basis's ranges; a comparison, never an enumeration. */
export function namesCriterion(basis: CriterionBasis, criterionId: string): boolean {
  const number = Number(/^AC-(\d+)$/.exec(criterionId)?.[1] ?? Number.NaN);
  return basis.criteria.some((range) => number >= range.from && number <= range.to);
}

/** `AC-1, AC-3–AC-5` → [1..1], [3..5]. A reversed range reads as its start only. */
function rangesIn(text: string): CriterionRange[] {
  return [...text.matchAll(CRITERION_RANGE_RE)].map((match) => {
    const from = Number(match[1]);
    return { from, to: match[2] === undefined ? from : Math.max(from, Number(match[2])) };
  });
}

function prdCitation(filePath: string | undefined, itemId: string | undefined): Token[] {
  if (filePath === undefined || itemId === undefined || !isPrdFilePath(filePath) || !ITEM_ID_RE.test(itemId)) return [{ kind: "prose" }];
  return [{ kind: "citation", citation: { itemId, path: filePath } }];
}

function linkTokens(destination: string, baseDirectory: string): Token[] {
  const target = resolveRepositoryLink(destination, baseDirectory);
  const classified = classifyLinkDestination(destination);
  return prdCitation(target, classified.kind === "local" ? classified.fragment : undefined);
}

function runningTextTokens(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  for (const match of text.matchAll(RUNNING_TEXT_RE)) {
    if (!FILLER_RE.test(text.slice(at, match.index))) tokens.push({ kind: "prose" });
    at = match.index + match[0].length;
    const groups = match.groups!;
    if (groups.end !== undefined) tokens.push({ kind: "end" });
    else if (groups.head !== undefined) tokens.push({ kind: "head", ranges: rangesIn(groups.head) });
    else if (groups.arrow !== undefined) tokens.push({ kind: "arrow" });
    else if (groups.fills !== undefined) tokens.push({ kind: "fills" });
    else if (groups.path !== undefined) tokens.push(...prdCitation(groups.path, groups.qualified));
    else if (groups.bare !== undefined) tokens.push({ kind: "citation", citation: { itemId: groups.bare } });
    else tokens.push({ kind: "mention", ranges: rangesIn(groups.mention!) });
  }
  if (!FILLER_RE.test(text.slice(at))) tokens.push({ kind: "prose" });
  return tokens;
}

/** Offsets of the closed code spans of the text, as the shared scanner skips them. */
function codeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let at = 0; at < text.length; ) {
    if (text[at] === "\\") at += 2;
    else if (text[at] === "`") {
      let run = 0;
      while (text[at + run] === "`") run += 1;
      const close = skipCodeSpan(text, at);
      if (close > at + run) spans.push([at, close]);
      at = close;
    } else at += 1;
  }
  return spans;
}

const blank = (text: string) => text.replace(/[^\n]/g, " ");

/**
 * The text a reader sees, same length: code blocks and HTML comment blocks (the shared line
 * classifier), inline HTML comments (the shared mask, across lines as in a paragraph) and inline HTML
 * tags blanked. Nothing in them cites.
 */
function visibleText(text: string): string {
  const lines = text.split("\n");
  const body = classifyDocumentLines(lines).map((line, index) => (line.body ? lines[index]! : blank(lines[index]!)));
  return maskInlineComments(body.join("\n")).replace(HTML_TAG_RE, blank);
}

/** Where a link points: an inline link or a definition its own destination, a reference link its definition's. */
function destinationOf(link: MarkdownLink, definitions: ReadonlyMap<string, string>): string | undefined {
  if (link.kind !== "reference") return link.destination.value;
  return definitions.get(referenceKey((link.label ?? link.text).value));
}

interface Piece {
  start: number;
  end: number;
  tokens: Token[];
}

/**
 * The text as tokens, read once over the whole text: a Rationale is a paragraph, so a link may wrap
 * onto the next line. Definitions open a line, so they are read line by line; every other link, and
 * every code span, is found in the whole text, where a definition's own span is already taken. A line
 * break ends a clause like `;` only in running text, never inside a link or a code span.
 */
function tokenize(text: string, baseDirectory: string): Token[] {
  const visible = visibleText(text);
  const lines = visible.split("\n");
  const lineStarts = lines.map((_, index) => lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0));
  const kept = linkDefinitions(lines);
  const definitions = new Map([...kept].map(([key, definition]) => [key, definition.destination]));
  const pieces: Piece[] = [];
  // Every definition takes its lines; only the one the shared parser kept for its label cites. A later
  // definition of the same label is void (CommonMark): it defines nothing and cites nothing.
  findMarkdownLinksInDocument(lines).forEach((lineLinks, index) => {
    for (const link of lineLinks) {
      if (link.kind !== "definition") continue;
      const last = index + (link.continuationLines ?? 0);
      const isKept = kept.get(referenceKey(link.label.value))?.startLine === index + 1;
      pieces.push({
        start: lineStarts[index]!,
        end: lineStarts[last]! + lines[last]!.length,
        tokens: isKept ? linkTokens(link.destination.value, baseDirectory) : [{ kind: "prose" }]
      });
    }
  });
  // An undefined reference is no link, so the text under it stays running text.
  for (const link of findMarkdownLinks(visible)) {
    const destination = destinationOf(link, definitions);
    if (destination !== undefined) pieces.push({ start: link.start, end: link.end, tokens: linkTokens(destination, baseDirectory) });
  }
  for (const [start, end] of codeSpans(visible)) pieces.push({ start, end, tokens: [{ kind: "prose" }] });
  pieces.sort((a, b) => a.start - b.start);
  const tokens: Token[] = [];
  let at = 0;
  for (const piece of pieces) {
    if (piece.start < at) continue;
    tokens.push(...runningTextTokens(visible.slice(at, piece.start)), ...piece.tokens);
    at = piece.end;
  }
  tokens.push(...runningTextTokens(visible.slice(at)), { kind: "end" });
  return tokens;
}

function citationsOf(tokens: readonly Token[]): PrdCitation[] {
  return tokens.flatMap((token) => (token.kind === "citation" ? [token.citation] : []));
}

/**
 * Every `docs/prd/<file>.prd.md#PRD-<n>` reference in `text`, in order. `baseDirectory` is the
 * repository directory of the document the text is in: relative link destinations resolve from it.
 */
export function findPrdReferences(text: string, baseDirectory: string): PrdReference[] {
  return citationsOf(tokenize(text, baseDirectory)).flatMap((citation) =>
    citation.path === undefined ? [] : [{ reference: `${citation.path}#${citation.itemId}`, path: citation.path, itemId: citation.itemId }]
  );
}

/** Every PRD citation in `text`, qualified or bare; `baseDirectory` as for `findPrdReferences`. */
export function findPrdCitations(text: string, baseDirectory: string): PrdCitation[] {
  return citationsOf(tokenize(text, baseDirectory));
}

/** The repository directory of a requirement's document, which its relative links resolve from. */
export function documentDirectory(filePath: string): string {
  return path.posix.dirname(filePath.replace(/\\/g, "/"));
}

/**
 * One head's body (or the tokens before the first head, with no criteria): the citations before any
 * `fills:` belong to the head; each `fills:` cites its first item for the criteria its reason names,
 * and for the head too when the fills opens the body (`AC-4 ← fills: ...`).
 */
function readBody(body: readonly Token[], head: readonly CriterionRange[], clauses: CriterionBasis[]): void {
  const fills = body.flatMap((token, position) => (token.kind === "fills" ? [position] : []));
  const direct = body.slice(0, fills[0] ?? body.length);
  if (head.length > 0) clauses.push({ criteria: [...head], citations: citationsOf(direct) });
  fills.forEach((start, position) => {
    const part = body.slice(start + 1, fills[position + 1] ?? body.length);
    const first = citationsOf(part)[0];
    if (first === undefined) return;
    const opensHead = position === 0 && head.length > 0 && direct.every((token) => token.kind === "arrow");
    const named = part.flatMap((token) => (token.kind === "mention" ? token.ranges : []));
    const criteria = [...(opensHead ? head : []), ...named];
    if (criteria.length > 0) clauses.push({ criteria, citations: [first] });
  });
}

/**
 * @req FR-NODE-242 AC-2 — a Rationale read into each criterion's own basis. A citation attached to no
 * criterion is the requirement's basis only; `findPrdCitations` finds it with every other citation.
 */
export function parseRationaleBasis(text: string, baseDirectory: string): CriterionBasis[] {
  const clauses: CriterionBasis[] = [];
  let clause: Token[] = [];
  const close = () => {
    const heads = clause.flatMap((token, position) => (token.kind === "head" ? [position] : []));
    readBody(clause.slice(0, heads[0] ?? clause.length), [], clauses);
    heads.forEach((start, position) => {
      const token = clause[start] as { ranges: CriterionRange[] };
      readBody(clause.slice(start + 1, heads[position + 1] ?? clause.length), token.ranges, clauses);
    });
    clause = [];
  };
  for (const token of tokenize(text, baseDirectory)) {
    if (token.kind === "end") close();
    else clause.push(token);
  }
  close();
  return clauses;
}
