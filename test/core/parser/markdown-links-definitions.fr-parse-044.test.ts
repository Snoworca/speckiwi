import { describe, expect, it } from "vitest";
import { findMarkdownLinksInDocument, linkDefinitions } from "../../../src/core/parser/markdown-links.js";

// The shared link parser reads link reference definitions as CommonMark 0.31 does: inside block quotes
// and list items, never as a paragraph's continuation line (§4.7), and a defined shortcut reference
// inside another link's brackets is the link, the outer brackets text (§6.3).

const definitionsOf = (lines: string[]) => Object.fromEntries([...linkDefinitions(lines)].map(([key, value]) => [key, value]));

describe("linkDefinitions inside containers", () => {
  // CommonMark example 218: a definition inside a block quote defines the reference outside it.
  // @req FR-PARSE-044 AC-6
  it("reads a definition inside a block quote (example 218)", () => {
    expect(definitionsOf(["[foo]", "", "> [foo]: /url"])).toEqual({ foo: { destination: "/url", startLine: 3, endLine: 3 } });
  });

  // §5.2 with §4.7: a list item's content is a document, so its first block may be a definition.
  // @req FR-PARSE-044 AC-6
  it("reads a definition inside a list item and inside a list item in a block quote", () => {
    expect(definitionsOf(["- [foo]: /url"])).toEqual({ foo: { destination: "/url", startLine: 1, endLine: 1 } });
    expect(definitionsOf(["> 1. [bar]: <../b.md>"])).toEqual({ bar: { destination: "../b.md", startLine: 1, endLine: 1 } });
  });

  // §4.7: the title may sit on the next line; inside a block quote that line carries the quote marker.
  // @req FR-PARSE-044 AC-6
  it("reads a title on the next line inside a block quote", () => {
    expect(definitionsOf(["> [foo]: /url", '> "the title"'])).toEqual({ foo: { destination: "/url", title: "the title", startLine: 1, endLine: 2 } });
  });

  // @req FR-PARSE-044 AC-6
  it("reports the definition's spans at their offsets in the original line", () => {
    const [defined] = findMarkdownLinksInDocument(["> - [foo]: /url"])[0] ?? [];
    expect(defined).toMatchObject({ kind: "definition", start: 4, label: { start: 5, end: 8, value: "foo" }, destination: { start: 11, value: "/url" } });
  });
});

describe("a definition cannot interrupt a paragraph (§4.7)", () => {
  // CommonMark example 213.
  // @req FR-PARSE-044 AC-6
  it("does not read a paragraph's continuation line as a definition (example 213)", () => {
    expect(definitionsOf(["Foo", "[bar]: /baz", "", "[bar]"])).toEqual({});
  });

  // @req FR-PARSE-044 AC-6
  it("does not read a lazy continuation line of a quoted paragraph as a definition", () => {
    expect(definitionsOf(["> Foo", "[bar]: /baz"])).toEqual({});
  });

  // Definitions open a paragraph one after another; a heading ends the paragraph before one.
  // @req FR-PARSE-044 AC-6
  it("still reads consecutive definitions, a definition after a two-line one, and one after a heading", () => {
    expect(Object.keys(definitionsOf(["[a]: /a", "[b]: /b", "[c]: /c", '  "c title"', "[d]: /d"]))).toEqual(["a", "b", "c", "d"]);
    expect(Object.keys(definitionsOf(["# Title", "[e]: /e"]))).toEqual(["e"]);
  });

  // @req FR-PARSE-044 AC-6
  it("does not read a definition after paragraph text that followed a definition", () => {
    expect(Object.keys(definitionsOf(["[a]: /a", "text", "[b]: /b"]))).toEqual(["a"]);
  });
});

describe("a defined shortcut reference inside another link's brackets (§6.3)", () => {
  // Links may not contain other links: once `[rules]` is a link, the outer brackets are text.
  // @req FR-NODE-232 AC-1
  it("takes a defined shortcut inside the text as the link and the outer brackets as text", () => {
    const lines = ["See [the old [rules]](https://example.com/guide).", "", "[rules]: /r"];
    const [first] = findMarkdownLinksInDocument(lines);
    expect(first?.map((link) => link.kind)).toEqual(["reference"]);
    expect(first?.[0]).toMatchObject({ form: "shortcut", text: { value: "rules" } });
  });

  // @req FR-NODE-232 AC-1
  it("keeps the outer inline link when the inner shortcut has no definition", () => {
    const [first] = findMarkdownLinksInDocument(["See [the old [rules]](https://example.com/guide)."]);
    expect(first?.[0]).toMatchObject({ kind: "inline", destination: { value: "https://example.com/guide" } });
  });

  // @req FR-NODE-232 AC-1
  it("takes a defined collapsed reference inside the text as the link", () => {
    const [first] = findMarkdownLinksInDocument(["[a [rules][] b](/outer)", "", "[rules]: /r"]);
    expect(first?.map((link) => link.kind)).toEqual(["reference"]);
  });
});
