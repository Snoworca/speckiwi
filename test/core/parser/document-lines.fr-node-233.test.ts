import { describe, expect, it } from "vitest";
import { classifyDocumentLines } from "../../../src/core/parser/document-lines.js";
import { findHeadingMatching, linesOutsideFences } from "../../../src/core/parser/index-parser.js";
import { findMarkdownLinksInDocument } from "../../../src/core/parser/markdown-links.js";

// The one line classifier: the index's heading lookup and the link scan both read it, so they agree on
// which lines are the document's own text.

const SCOPE_MAP = /^##\s+\d+\.\s+Scope Map$/;

describe("classifyDocumentLines", () => {
  // @req FR-NODE-233 AC-1
  it("marks fenced, list-marker-fenced, indented-code and commented lines as not body", () => {
    const lines = [
      "Intro paragraph.", // 0 body
      "", // 1
      "```", // 2 fence
      "## 4. Scope Map", // 3 fenced
      "```", // 4 fence
      "- ```md", // 5 fence opened on a list marker
      "  ## 4. Scope Map", // 6 fenced
      "  ```", // 7 fence
      "", // 8 (a line indented here would still belong to the list item, so the list ends first)
      "Back to text.", // 9 body: leaves the list
      "", // 10
      "    ## 4. Scope Map", // 11 indented code after a blank line
      "", // 12
      "<!--", // 13 comment
      "## 4. Scope Map", // 14 comment
      "-->", // 15 comment
      "text <!-- note --> more", // 16 body, comment blanked
      "## 4. Scope Map" // 17 body
    ];
    const classified = classifyDocumentLines(lines);
    expect(classified.map((line) => line.body)).toEqual([
      true, true, false, false, false, false, false, false, true, true, true, false, true, false, false, false, true, true
    ]);
    expect(classified[16]?.text).toBe(`text ${" ".repeat("<!-- note -->".length)} more`);
    expect(linesOutsideFences(lines)).toEqual(classified.map((line) => line.body));
    expect(findHeadingMatching(lines, SCOPE_MAP)).toBe(17);
  });

  // @req FR-NODE-233 AC-1
  it("keeps an indented line that continues a paragraph as body", () => {
    expect(classifyDocumentLines(["A paragraph", "    still the paragraph"]).map((line) => line.body)).toEqual([true, true]);
    expect(classifyDocumentLines(["- item", "", "      code in the item", "  text in the item"]).map((line) => line.body)).toEqual([
      true,
      true,
      false,
      true
    ]);
  });

  // @req FR-NODE-233 AC-1
  it("takes only an unindented ATX heading for a section heading", () => {
    expect(findHeadingMatching(["  ## 4. Scope Map", "## 4. Scope Map"], SCOPE_MAP)).toBe(1);
    expect(findHeadingMatching([" ## 4. Scope Map"], SCOPE_MAP)).toBe(-1);
    expect(findHeadingMatching(["## 4. Scope Map   "], SCOPE_MAP)).toBe(0);
  });

  // @req FR-NODE-233 AC-1
  it("lets no unclosed structure hide the rest of the document, except a top-level fence as before", () => {
    const rest = ["", "## 4. Scope Map", "", "| Scope | Document |", "|---|---|", "| A | [a](./a.md) |"];
    const unclosed: Record<string, string[]> = {
      "a comment block opened at line start": ["<!-- never closed"],
      "an unclosed comment in the middle of a line": ["Draft notes start with <!-- and are hidden by renderers."],
      "a fence opened on a list item marker line": ["- ```text", "  body"],
      "a fence indented inside a list item": ["- item", "", "  ```text"],
      "a fence inside a block quote": ["> ```text", "> quoted"],
      "a tab-indented `<!--`": ["", "\t<!-- code, not a comment"]
    };
    for (const [shape, opener] of Object.entries(unclosed)) {
      const classified = classifyDocumentLines([...opener, ...rest]);
      // The blank line right after the opener may still belong to a list item's code; every line from
      // the heading on is past any container and must be the document's again.
      expect(classified.slice(opener.length + 1).map((line) => line.body), shape).toEqual(rest.slice(1).map(() => true));
      expect(findHeadingMatching([...opener, ...rest], SCOPE_MAP), shape).toBe(opener.length + 1);
    }
    expect(classifyDocumentLines(["```text", ...rest]).slice(1).map((line) => line.body)).toEqual(rest.map(() => false));
  });

  // @req FR-NODE-233 AC-1
  it("expands tabs to four-column stops and strips block-quote markers before the same rules", () => {
    expect(classifyDocumentLines(["", "\t## 4. Scope Map"]).map((line) => line.body)).toEqual([true, false]);
    expect(classifyDocumentLines(["", "  \t## 4. Scope Map"]).map((line) => line.body)).toEqual([true, false]);
    expect(classifyDocumentLines(["> <!--", "> ## 4. Scope Map", "> -->", "## 4. Scope Map"]).map((line) => line.body)).toEqual([
      false,
      false,
      false,
      true
    ]);
    expect(classifyDocumentLines(["> ```", "> code", "after the quote"]).map((line) => line.body)).toEqual([false, false, true]);
  });

  // @req FR-NODE-233 AC-1
  it("reads `<!-->` and `<!--->` as complete comments, as a block and inside a line", () => {
    expect(classifyDocumentLines(["<!-->", "## 4. Scope Map", "<!--->", "## 4. Scope Map"]).map((line) => line.body)).toEqual([
      false,
      true,
      false,
      true
    ]);
    expect(findMarkdownLinksInDocument(["a <!--> [x](./x.md) -->", "b <!---> [y](./y.md) -->"]).map((links) => links.length)).toEqual([1, 1]);
  });

  // @req FR-NODE-233 AC-1
  it("gives the link scan and the heading lookup the same body lines", () => {
    const lines = ["<!--", "[a](./a.md)", "-->", "    [b](./b.md)", "[c](./c.md)"];
    const outside = linesOutsideFences(lines);
    expect(findMarkdownLinksInDocument(lines).map((links) => links.length > 0)).toEqual([false, false, false, false, true]);
    expect(outside).toEqual([false, false, false, false, true]);
  });
});
