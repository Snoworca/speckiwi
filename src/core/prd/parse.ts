import { createHash } from "node:crypto";
import { classifyDocumentLines } from "../parser/document-lines.js";
import { parseMarkdownTableResult } from "../parser/table.js";
import { formatPrdPointer } from "./pointer.js";
import { PRD_SECTIONS, type PrdDocument, type PrdItem, type PrdUserBlock } from "./model.js";

// @req FR-NODE-240 AC-2 — a parser of its own: the requirement heading grammar takes a closed list of
// type prefixes, and a PRD item is not a requirement. Tables go through the shared table parser.

// The heading the skill's own gate accepts: kiwi-prd SKILL.md §3 writes `### PRD-<n> — <title>`, and its
// prd-quote command checks only that the heading starts with `PRD-<n> ` (its position, then a space), so
// `### PRD-1 Title` and `### PRD-1 - Title` pass it too. A heading it rejects (a leading zero, nothing
// after the number, no space before the dash, `PRD-1a`) gets the number NaN, which `checkPrd` reports as a
// numbering fault. Its ID is the heading's token as written, so it never takes a well-formed item's ID.
const ITEM_HEADING_RE = /^### PRD-([1-9]\d*) (.*)$/;
const TITLE_SEPARATOR_RE = /^\s*[—-]\s*/;
const LOOSE_ITEM_ID_RE = /^### (PRD-[^\s—]*)/;

interface Block {
  heading: string;
  /** 0-based index of the heading line. */
  start: number;
  lines: string[];
}

/** PRD content: the bytes as read from disk, or text, which is taken as its UTF-8 bytes. */
export type PrdContent = string | Uint8Array;

function bytesOf(content: PrdContent): Buffer {
  return typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content.buffer, content.byteOffset, content.byteLength);
}

/** `<path>@sha256:<hex>` over the file's bytes — the pointer convention of the run ledger. */
export function prdPointer(path: string, content: PrdContent): string {
  return formatPrdPointer(path, bytesOf(content));
}

/**
 * The sha256 the `Request SHA256` row records: the `## 1. User Request` section, line endings folded
 * to LF, from its heading up to the next `## ` heading — byte for byte what kiwi-prd's `prd-hash`
 * command hashes. Undefined when the section is missing or nothing follows it, where that command
 * exits 2.
 */
export function prdRequestSha256(content: PrdContent): string | undefined {
  // One character per byte, as prd-hash reads the file (latin1), so a byte that is not UTF-8 hashes the same.
  const folded = bytesOf(content).toString("latin1").replace(/\r\n/g, "\n");
  const start = folded.indexOf(`\n${PRD_SECTIONS.userRequest}`) + 1;
  const end = folded.indexOf("\n## ", start) + 1;
  if (start < 1 || end <= start) return undefined;
  return createHash("sha256").update(folded.slice(start, end), "latin1").digest("hex");
}

/** The `>` lines of a block with the marker removed, joined and trimmed, as kiwi-prd's `prd-quote` reads them. */
export function quoteText(lines: readonly string[]): string {
  return lines
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n")
    .trim();
}

/**
 * Whether each line is document text, as the shared classifier reads it. @req FR-NODE-262 AC-1 — a
 * `## ` or `### ` line inside fenced code is text of the block it sits in, never a section or item
 * boundary.
 */
export function prdBodyLines(lines: readonly string[]): boolean[] {
  return classifyDocumentLines(lines).map((line) => line.body);
}

/** 0-based [start, end) of the section whose heading line is exactly `heading`; undefined when absent. */
export function sectionRange(lines: readonly string[], heading: string, body: readonly boolean[] = prdBodyLines(lines)): [number, number] | undefined {
  const start = lines.findIndex((line, index) => body[index] && line === heading);
  if (start < 0) return undefined;
  const next = lines.findIndex((line, index) => index > start && body[index] && line.startsWith("## "));
  return [start, next < 0 ? lines.length : next];
}

function blocksIn(lines: readonly string[], body: readonly boolean[], range: [number, number] | undefined): Block[] {
  if (!range) return [];
  const blocks: Block[] = [];
  for (let index = range[0] + 1; index < range[1]; index += 1) {
    const line = lines[index]!;
    if (body[index] && line.startsWith("### ")) blocks.push({ heading: line.slice(4), start: index, lines: [line] });
    else blocks[blocks.length - 1]?.lines.push(line);
  }
  return blocks;
}

function quotableUserWords(id: string, quote: string): string {
  if (id === "U-1" || !/^답:/m.test(quote)) return quote;
  let inQuestion = false;
  return quote
    .split("\n")
    .filter((line) => {
      if (line.startsWith("답:")) inQuestion = false;
      else if (line.startsWith("질문:")) inQuestion = true;
      return !inQuestion;
    })
    .join("\n");
}

function parseUserBlock(block: Block): PrdUserBlock {
  const id = block.heading.split(" ")[0] ?? "";
  return { id, line: block.start + 1, quotable: quotableUserWords(id, quoteText(block.lines)) };
}

function fieldTable(block: Block): { values: Record<string, string>; lines: Record<string, number> } {
  const { table } = parseMarkdownTableResult(block.lines, 1, { skipNonTableLeading: true });
  const values: Record<string, string> = {};
  const lines: Record<string, number> = {};
  table?.rows.forEach((row, position) => {
    const field = row.Field ?? "";
    if (field === "" || field in values) return;
    values[field] = row.Value ?? "";
    lines[field] = block.start + table.rowLines[position]!;
  });
  return { values, lines };
}

function optional(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function parseItem(block: Block): PrdItem {
  const heading = `### ${block.heading}`;
  const match = ITEM_HEADING_RE.exec(heading);
  const id = LOOSE_ITEM_ID_RE.exec(heading)?.[1] ?? "PRD-";
  const { values, lines } = fieldTable(block);
  const quoteLines = block.lines.flatMap((line, offset) => (line.startsWith(">") ? [block.start + offset + 1] : []));
  const body = block.lines
    .slice(1)
    .filter((line) => !line.startsWith(">") && !line.trim().startsWith("|"))
    .join("\n")
    .trim();
  const item: PrdItem = {
    id,
    number: match ? Number(match[1]) : Number.NaN,
    title: (match ? match[2]! : block.heading.slice(id.length)).replace(TITLE_SEPARATOR_RE, "").trim(),
    line: block.start + 1,
    kind: values.Kind ?? "",
    state: values.State ?? "",
    source: (values.Source ?? "").split(/[ ,]+/).filter((entry) => entry !== ""),
    quote: quoteText(block.lines),
    body,
    fieldLines: lines,
    quoteLines
  };
  const exclusionClass = optional(values["Exclusion Class"]);
  const reason = optional(values.Reason);
  const effect = optional(values.Effect);
  if (exclusionClass !== undefined) item.exclusionClass = exclusionClass;
  if (reason !== undefined) item.reason = reason;
  if (effect !== undefined) item.effect = effect;
  return item;
}

function headerFields(lines: readonly string[]): { values: Record<string, string>; requestLine: number } {
  // Up to the User Request heading, not the first `## ` line: the skill's commands read the header rows
  // wherever they are, so a `## ` line in a fenced example above the table must not hide them.
  const requestHeading = lines.indexOf(PRD_SECTIONS.userRequest);
  const preamble = lines.slice(0, requestHeading < 0 ? lines.length : requestHeading);
  const { table } = parseMarkdownTableResult([...preamble], 0, { skipNonTableLeading: true });
  const values: Record<string, string> = {};
  let requestLine = 1;
  table?.rows.forEach((row, position) => {
    const field = row.Field ?? "";
    if (field === "" || field in values) return;
    values[field] = row.Value ?? "";
    if (field === "Request SHA256") requestLine = table.rowLines[position]!;
  });
  return { values, requestLine };
}

/**
 * Parses a PRD. Pass the bytes as read from disk when you have them, so both hashes are exact even
 * for a byte that is not UTF-8. Never fails: what the grammar does not allow is reported by `checkPrd`.
 */
export function parsePrd(content: PrdContent, path: string): PrdDocument {
  const text = typeof content === "string" ? content : bytesOf(content).toString("utf8");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const header = headerFields(lines);
  const body = prdBodyLines(lines);
  const document: PrdDocument = {
    path,
    pointer: prdPointer(path, content),
    status: header.values.Status ?? "",
    approved: header.values.Approved ?? "",
    requestSha256Cell: header.values["Request SHA256"] ?? "",
    requestSha256Line: header.requestLine,
    userBlocks: blocksIn(lines, body, sectionRange(lines, PRD_SECTIONS.userRequest, body))
      .filter((block) => block.heading.startsWith("U-"))
      .map(parseUserBlock),
    items: blocksIn(lines, body, sectionRange(lines, PRD_SECTIONS.items, body))
      .filter((block) => block.heading.startsWith("PRD-"))
      .map(parseItem),
    lines
  };
  const requestSha256 = prdRequestSha256(content);
  if (requestSha256 !== undefined) document.requestSha256 = requestSha256;
  return document;
}
