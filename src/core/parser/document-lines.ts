import { closesFence, closingFenceAt, fenceAt, type ClosingFenceTrail } from "./fence.js";

// The one answer to "is this line of a markdown document its own text, or code or a comment?". Every
// reader that looks for the document's headings, sections, criteria, tables or links asks it, and so
// does the guard on prose written into a requirement block, so none of them can disagree about which
// lines count. The rules follow CommonMark where it states one, with one deliberate limit: a structure
// that is never closed hides nothing, except a fence at the top level, which hid the rest of the
// document before this classifier existed and still does.

export type DocumentLineKind = "body" | "fence" | "indented-code" | "comment";

export interface DocumentLine {
  /** True for document text: the line is neither code nor part of an HTML comment block. */
  body: boolean;
  kind: DocumentLineKind;
  /** The line with closed inline HTML comments blanked out, same length; all blanks when not body. */
  text: string;
  /**
   * Offset in the line of the first non-blank character past its block-quote and list-item markers,
   * where the line's own block starts; the line's length when that rest is blank or the line is not body.
   */
  contentStart: number;
  /**
   * True for a body line that continues the paragraph of the line before it, lazily or not. Such a line
   * starts no block, so it cannot be a link reference definition (CommonMark §4.7).
   */
  continuesParagraph: boolean;
  /**
   * Set on the lines of a structure that never closes yet hides the rest of the document (a top-level
   * fence; any fence or comment block under `unclosedOpens`), from its opener on: it has no end, so a
   * reader cannot tell where the text it hides was meant to stop.
   */
  unclosed?: true;
}

export interface ClassifyOptions {
  /**
   * What may follow a closing fence. CommonMark allows spaces or tabs (the default); the SRS record
   * parsers read spaces only, which FR-PARSE-012's parser test pins.
   */
  closingFence?: ClosingFenceTrail;
  /**
   * When true, a fence or comment block that never closes is still taken as open, as CommonMark reads
   * it. The prose guard uses this: prose written into a block may be followed by a closer elsewhere.
   */
  unclosedOpens?: boolean;
}

/**
 * How the record parsers (blocks, sections, criteria) and the writers that place a block read lines: a
 * closing fence followed by spaces only, which FR-PARSE-012's parser test pins.
 */
export const SRS_RECORD_LINES: ClassifyOptions = { closingFence: "spaces" };

/** Offset past a code span opened at `at`, or `at + run` when the backtick run is never closed. */
export function skipCodeSpan(line: string, at: number): number {
  let run = 0;
  while (line[at + run] === "`") run += 1;
  const fence = "`".repeat(run);
  let search = at + run;
  for (;;) {
    const close = line.indexOf(fence, search);
    if (close < 0) return at + run;
    let closeRun = 0;
    while (line[close + closeRun] === "`") closeRun += 1;
    if (closeRun === run) return close + run;
    search = close + closeRun;
  }
}

const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const BLOCK_QUOTE_MARKER = /^ {0,3}>/;
const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?=[ \t])/;
const HTML_COMMENT_START = /^ {0,3}<!--/;
/**
 * CommonMark 0.31: `<!-->` and `<!--->` are complete comments, so the `-->` that ends one may begin as
 * early as the third character after `<`; searching from `<!--` plus two finds it.
 */
const COMMENT_CLOSE_SEARCH_OFFSET = 2;
const TAB_STOP = 4;
/** Indentation that makes a line indented code (CommonMark §4.4). */
const CODE_INDENT = 4;
/** Spaces after a list marker from which the item's content is indented code (CommonMark §5.2). */
const LIST_CODE_GAP = 5;

/**
 * The rest of a line from `column` on. Its leading tabs are already spaces, expanded at their place in
 * the original line (CommonMark §2.2), so a width counted on `text` is a width in columns.
 */
interface Cursor {
  text: string;
  column: number;
}

function expandLeading(text: string, column: number): string {
  let end = column;
  let at = 0;
  let tabs = false;
  for (; at < text.length; at += 1) {
    if (text[at] === " ") end += 1;
    else if (text[at] === "\t") {
      end += TAB_STOP - (end % TAB_STOP);
      tabs = true;
    } else break;
  }
  // Most lines lead with spaces or nothing; they are already in columns.
  return tabs ? " ".repeat(end - column) + text.slice(at) : text;
}

/** Moves past `count` characters of the cursor's text: a marker, or spaces already expanded. */
function advance(cursor: Cursor, count: number): Cursor {
  const column = cursor.column + count;
  return { text: expandLeading(cursor.text.slice(count), column), column };
}

/** Whether the first character is printable ASCII other than a space, so no blank leads the text. */
function startsPrintable(text: string): boolean {
  const code = text.charCodeAt(0);
  return code > 32 && code < 127;
}

function indentOf(text: string): number {
  return startsPrintable(text) ? 0 : text.length - text.trimStart().length;
}

const isBlank = (text: string): boolean => !startsPrintable(text) && text.trim() === "";

/** The line with every closed inline comment blanked, same length. An unclosed `<!--` is text. */
export function maskInlineComments(line: string): string {
  if (!line.includes("<!--")) return line;
  let result = "";
  let at = 0;
  while (at < line.length) {
    if (line[at] === "`") {
      const end = skipCodeSpan(line, at);
      result += line.slice(at, end);
      at = end;
      continue;
    }
    if (line.startsWith("<!--", at)) {
      const close = line.indexOf("-->", at + COMMENT_CLOSE_SEARCH_OFFSET);
      if (close >= 0) {
        result += " ".repeat(close + 3 - at);
        at = close + 3;
        continue;
      }
    }
    result += line[at];
    at += 1;
  }
  return result;
}

/** A block quote, or a list item whose content starts `offset` columns into its parent's content. */
type Container = { kind: "quote" } | { kind: "item"; offset: number };

/** Past a block-quote marker and the one optional space after it, which may be part of a tab. */
function afterQuoteMarker(cursor: Cursor): Cursor | undefined {
  const marker = BLOCK_QUOTE_MARKER.exec(cursor.text);
  if (marker === null) return undefined;
  const after = advance(cursor, marker[0].length);
  return after.text.startsWith(" ") ? advance(after, 1) : after;
}

/** A list item opened at the cursor: its content offset and the cursor at its content. */
function listItemAt(cursor: Cursor): { offset: number; content: Cursor } | undefined {
  if (THEMATIC_BREAK.test(cursor.text)) return undefined;
  const marker = LIST_MARKER.exec(cursor.text);
  if (marker === null) return undefined;
  const after = advance(cursor, marker[0].length);
  // An item that starts blank is not taken for one; this classifier never needed it to be.
  if (isBlank(after.text)) return undefined;
  const gap = indentOf(after.text);
  const taken = gap >= LIST_CODE_GAP ? 1 : gap;
  return { offset: marker[0].length + taken, content: advance(after, taken) };
}

/** How many of the open containers the line continues, and the cursor past their markers. */
function continueContainers(line: string, stack: readonly Container[]): { matched: number; cursor: Cursor } {
  let cursor: Cursor = { text: expandLeading(line, 0), column: 0 };
  let matched = 0;
  for (const container of stack) {
    if (container.kind === "quote") {
      const after = afterQuoteMarker(cursor);
      if (after === undefined) break;
      cursor = after;
    } else if (isBlank(cursor.text)) {
      cursor = { text: "", column: cursor.column };
    } else if (indentOf(cursor.text) >= container.offset) {
      cursor = advance(cursor, container.offset);
    } else {
      break;
    }
    matched += 1;
  }
  return { matched, cursor };
}

/** Whether a line can only continue a paragraph: it starts no block, so a paragraph takes it lazily. */
function continuesParagraph(text: string): boolean {
  if (isBlank(text) || indentOf(text) >= CODE_INDENT) return !isBlank(text);
  const cursor: Cursor = { text, column: 0 };
  return (
    afterQuoteMarker(cursor) === undefined &&
    listItemAt(cursor) === undefined &&
    fenceAt(text) === undefined &&
    !ATX_HEADING.test(text) &&
    !THEMATIC_BREAK.test(text) &&
    !HTML_COMMENT_START.test(text)
  );
}

/**
 * The last line of a structure opened inside `stack` on the line before `from`: the line `closes`
 * accepts, or the line before the first one that leaves a container. Undefined when it runs off the end.
 */
function structureEnd(lines: readonly string[], from: number, stack: readonly Container[], closes: (text: string) => boolean): EndSearch {
  for (let index = from; index < lines.length; index += 1) {
    const { matched, cursor } = continueContainers(lines[index] ?? "", stack);
    if (matched < stack.length) return { from, stop: index, end: index - 1 };
    if (closes(cursor.text)) return { from, stop: index, end: index };
  }
  return { from, stop: lines.length, end: undefined };
}

/** A search for a structure's end that started at line `from` and stopped at line `stop`. */
interface EndSearch {
  from: number;
  stop: number;
  end: number | undefined;
}

/** What closes a structure; structures with the same key close on the same lines. */
interface Closer {
  key: string;
  closes: (text: string) => boolean;
}

/**
 * {@link structureEnd} remembered per container stack and closer. A search that stopped at `stop` met
 * neither a closer nor a container's end before it, so a later search with the same stack and closer
 * from any line up to `stop` stops there too and finds the same end. Reusing it keeps a run of openers
 * that never close linear, instead of scanning to the end of the document once per opener.
 */
function structureEnds(lines: readonly string[]): (from: number, stack: readonly Container[], closer: Closer) => number | undefined {
  const searches = new Map<string, EndSearch>();
  return (from, stack, closer) => {
    const key = `${closer.key}|${JSON.stringify(stack)}`;
    const known = searches.get(key);
    if (known !== undefined && from >= known.from && from <= known.stop) return known.end;
    const search = structureEnd(lines, from, stack, closer.closes);
    searches.set(key, search);
    return search.end;
  };
}

const COMMENT_CLOSER: Closer = { key: "comment", closes: (text) => text.includes("-->") };

/**
 * Classifies every line of a document as CommonMark 0.31 reads it:
 * - block quotes and list items are containers: each line first continues the open ones (a quote by its
 *   `>` and one optional space, which may take part of a tab; a list item by a blank line or by
 *   indentation of at least its content offset), then may open new ones, and the rest is read as a
 *   document of its own; tabs expand at their column in the original line;
 * - a paragraph continues lazily on a line that starts no block, even past a container's markers;
 * - a fenced code block closes on a fence of the same marker at least as long, or where its container
 *   ends;
 * - an indented code block is a line indented four or more columns past its containers, anywhere but
 *   right after paragraph text;
 * - an HTML comment block opens on a line starting with `<!--` (up to three spaces in) and runs through
 *   the line holding `-->` (`<!-->` and `<!--->` close at once), or to its container's end; a closed
 *   `<!--…-->` inside a line is blanked on that line only.
 */
export function classifyDocumentLines(lines: readonly string[], options: ClassifyOptions = {}): DocumentLine[] {
  const trail = options.closingFence ?? "spaces-or-tabs";
  let stack: Container[] = [];
  let hiddenThrough = -1;
  let hiddenKind: DocumentLineKind = "fence";
  let hiddenUnclosed = false;
  let inIndentedCode = false;
  let paragraphOpen = false;
  const endOf = structureEnds(lines);
  const not = (line: string, kind: DocumentLineKind, unclosed = false): DocumentLine => ({
    body: false,
    kind,
    text: " ".repeat(line.length),
    contentStart: line.length,
    continuesParagraph: false,
    ...(unclosed ? { unclosed: true as const } : {})
  });
  // The cursor's text past its leading blanks is the end of the line itself, so its length places it.
  const body = (line: string, cursor: Cursor, continuesParagraph: boolean): DocumentLine => ({
    body: true,
    kind: "body",
    text: maskInlineComments(line),
    contentStart: line.length - cursor.text.length + indentOf(cursor.text),
    continuesParagraph
  });
  /** Hides the structure opened on line `index` through its end; false when it never ends and so hides nothing. */
  const hide = (index: number, kind: DocumentLineKind, end: number | undefined, hidesWhenUnclosed: boolean): boolean => {
    if (end === undefined && !hidesWhenUnclosed && options.unclosedOpens !== true) return false;
    hiddenThrough = end ?? lines.length - 1;
    hiddenKind = kind;
    hiddenUnclosed = end === undefined;
    paragraphOpen = false;
    return true;
  };

  return lines.map((line, index) => {
    if (index <= hiddenThrough) return not(line, hiddenKind, hiddenUnclosed);

    const continued = continueContainers(line, stack);
    let cursor = continued.cursor;
    if (continued.matched < stack.length) {
      if (paragraphOpen && continuesParagraph(cursor.text)) return body(line, cursor, true);
      stack = stack.slice(0, continued.matched);
      paragraphOpen = false;
      inIndentedCode = false;
    }

    if (inIndentedCode) {
      if (isBlank(cursor.text)) return body(line, cursor, false);
      if (indentOf(cursor.text) >= CODE_INDENT) return not(line, "indented-code");
      inIndentedCode = false;
    }

    if (indentOf(cursor.text) < CODE_INDENT) {
      for (;;) {
        const quoted = afterQuoteMarker(cursor);
        const item = quoted === undefined ? listItemAt(cursor) : undefined;
        if (quoted !== undefined) {
          stack.push({ kind: "quote" });
          cursor = quoted;
        } else if (item !== undefined) {
          stack.push({ kind: "item", offset: item.offset });
          cursor = item.content;
        } else {
          break;
        }
        paragraphOpen = false;
      }
    }

    const text = cursor.text;
    if (isBlank(text)) {
      paragraphOpen = false;
      return body(line, cursor, false);
    }
    if (indentOf(text) >= CODE_INDENT) {
      if (paragraphOpen) return body(line, cursor, true);
      inIndentedCode = true;
      return not(line, "indented-code");
    }

    const opening = fenceAt(text);
    if (opening !== undefined) {
      const containers = [...stack];
      const closer: Closer = { key: `fence:${opening.marker}${opening.length}`, closes: (inner) => closesFence(opening, closingFenceAt(inner, trail)) };
      const end = endOf(index + 1, containers, closer);
      // An unclosed fence at the top level keeps hiding the rest of the document, as it did before.
      if (hide(index, "fence", end, containers.length === 0)) return not(line, "fence", end === undefined);
    }
    if (HTML_COMMENT_START.test(text)) {
      const closesHere = text.indexOf("-->", text.indexOf("<!--") + COMMENT_CLOSE_SEARCH_OFFSET) >= 0;
      const end = closesHere ? index : endOf(index + 1, stack, COMMENT_CLOSER);
      // An HTML comment block that never closes is taken for text, so it hides nothing.
      if (hide(index, "comment", end, false)) return not(line, "comment", end === undefined);
    }

    const endsParagraph = ATX_HEADING.test(text) || THEMATIC_BREAK.test(text) || (paragraphOpen && SETEXT_UNDERLINE.test(text));
    const continues = paragraphOpen && !endsParagraph;
    paragraphOpen = !endsParagraph;
    return body(line, cursor, continues);
  });
}


/**
 * The structure still open after the last line, or undefined when the lines end in plain document
 * text: a blank line placed after them is classified, and only an open fence or comment block keeps it
 * from being body.
 */
export function openStructureAfter(lines: readonly string[], options: ClassifyOptions = {}): DocumentLineKind | undefined {
  const sentinel = classifyDocumentLines([...lines, ""], options).at(-1);
  return sentinel === undefined || sentinel.body ? undefined : sentinel.kind;
}
