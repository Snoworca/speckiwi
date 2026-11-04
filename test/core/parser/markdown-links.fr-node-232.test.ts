import { describe, expect, it } from "vitest";
import {
  classifyLinkDestination,
  findMarkdownLinks,
  findMarkdownLinksInDocument,
  referenceKey
} from "../../../src/core/parser/markdown-links.js";

// The one markdown link extractor that renameScope (FR-NODE-232) and `links check` share.

function shape(line: string) {
  return findMarkdownLinks(line).map((link) => ({
    kind: link.kind,
    whole: line.slice(link.start, link.end),
    text: "text" in link ? link.text.value : undefined,
    label: link.label?.value,
    destination: "destination" in link ? link.destination.value : undefined
  }));
}

describe("findMarkdownLinks", () => {
  // @req FR-NODE-232 AC-1
  it("finds inline links with a title, an angle-bracket destination and nested brackets in the text", () => {
    expect(shape(`a [x](./a.md "t") b [y](<./b c.md>) [[draft] z](../spec/c.md#h) [e]()`)).toEqual([
      { kind: "inline", whole: `[x](./a.md "t")`, text: "x", label: undefined, destination: "./a.md" },
      { kind: "inline", whole: "[y](<./b c.md>)", text: "y", label: undefined, destination: "./b c.md" },
      { kind: "inline", whole: "[[draft] z](../spec/c.md#h)", text: "[draft] z", label: undefined, destination: "../spec/c.md#h" },
      { kind: "inline", whole: "[e]()", text: "e", label: undefined, destination: "" }
    ]);
  });

  // @req FR-NODE-232 AC-1
  it("finds full, collapsed and shortcut references and a definition with or without a title", () => {
    expect(shape("[t][Arch] [u][] [v]")).toEqual([
      { kind: "reference", whole: "[t][Arch]", text: "t", label: "Arch", destination: undefined },
      { kind: "reference", whole: "[u][]", text: "u", label: undefined, destination: undefined },
      { kind: "reference", whole: "[v]", text: "v", label: undefined, destination: undefined }
    ]);
    expect(findMarkdownLinks("[t][Arch] [u][] [v]").map((link) => (link.kind === "reference" ? link.form : link.kind))).toEqual([
      "full",
      "collapsed",
      "shortcut"
    ]);
    expect(shape(`  [Arch]: <./a.md> "title"`)).toEqual([
      { kind: "definition", whole: `[Arch]: <./a.md> "title"`, text: undefined, label: "Arch", destination: "./a.md" }
    ]);
    expect(findMarkdownLinks(`  [Arch]: <./a.md> "title"`)[0]).toMatchObject({ title: { value: "title" } });
    expect(findMarkdownLinks(`[x](./a.md 'in quotes')`)[0]).toMatchObject({ title: { value: "in quotes" } });
    expect(findMarkdownLinks("[x](./a.md)")[0]).not.toHaveProperty("title");
    expect(shape("[Arch]: ./a.md")[0]).toMatchObject({ kind: "definition", destination: "./a.md" });
  });

  // @req FR-NODE-232 AC-1
  it("ignores escaped brackets and links inside code spans, and finds a link inside a table cell", () => {
    expect(shape("\\[x](./a.md) `[y](./b.md)` | [z](./c.md) |").map((link) => link.whole)).toEqual(["[z](./c.md)"]);
  });

  it("finds the inner link of brackets that do not form a link themselves", () => {
    expect(shape("[see [a](./a.md) here]").filter((link) => link.kind === "inline").map((link) => link.whole)).toEqual(["[a](./a.md)"]);
  });

  // @req FR-NODE-232 AC-1
  it.each([
    ["./a.md#2-srs-documents", { kind: "local", path: "./a.md", fragment: "2-srs-documents" }],
    ["mailto:owner@example.com", { kind: "external" }],
    ["HTTPS://example.com/a.md", { kind: "external" }],
    ["http://example.com", { kind: "external" }],
    ["./a.md?raw=1#top", { kind: "local", path: "./a.md", fragment: "top" }],
    ["./10%2Eproduct-architecture.srs.md", { kind: "local", path: "./10.product-architecture.srs.md" }],
    ["../spec/b%20c.md", { kind: "local", path: "../spec/b c.md" }],
    ["./bad%zz.md", { kind: "local", path: "./bad%zz.md" }],
    ["./%C3%A9t%C3%A9.md", { kind: "local", path: "./été.md" }],
    ["./bad%C3%28.md", { kind: "local", path: "./bad�(.md" }],
    ["#section", { kind: "same-document", fragment: "section" }],
    ["", { kind: "same-document" }],
    [".\\win\\a.md", { kind: "local", path: "./win/a.md" }],
    ["C:/no/such.md", { kind: "local", path: "C:/no/such.md" }],
    ["d:\\dir\\a.md", { kind: "local", path: "d:/dir/a.md" }],
    ["c:relative", { kind: "external" }]
  ])("classifies the destination %s", (destination, expected) => {
    expect(classifyLinkDestination(destination)).toEqual(expected);
  });

  // @req FR-NODE-232 AC-1
  it("finds no link inside an HTML comment, on one line or across lines", () => {
    const found = findMarkdownLinksInDocument(["a <!-- [x](./a.md) --> [v](./v.md)", "<!--", "[y](./b.md)", "-->", "[z](./c.md)"]);
    expect(found.map((links) => links.map((link) => (link.kind === "inline" ? link.destination.value : link.kind)))).toEqual([
      ["./v.md"],
      [],
      [],
      [],
      ["./c.md"]
    ]);
  });

  // @req FR-NODE-232 AC-1
  it("finds no link inside a fenced code block, closing a fence only with the same marker at least as long", () => {
    const lines = ["```md", "[a](./a.md)", "~~~", "[b](./b.md)", "```", "~~~~", "[c](./c.md)", "~~~", "[d](./d.md)", "~~~~~", "[e](./e.md)"];
    const found = findMarkdownLinksInDocument(lines);
    expect(found.flatMap((links, line) => links.map(() => lines[line]))).toEqual(["[e](./e.md)"]);
  });

  // @req FR-NODE-232 AC-1
  it("does not open an HTML comment from `<!--` inside a code span", () => {
    const found = findMarkdownLinksInDocument(["Write `<!--` to start a note. [a](./a.md)", "[b](./b.md)"]);
    expect(found.map((links) => links.length)).toEqual([1, 1]);
  });

  // @req FR-NODE-232 AC-1
  it("finds no link in a fence nested in a list item, and treats a deep indent outside a list as text", () => {
    const nested = ["10. Example:", "", "    ```md", "    [a](./a.md)", "    ```", "[b](./b.md)"];
    expect(findMarkdownLinksInDocument(nested).map((links) => links.length)).toEqual([0, 0, 0, 0, 0, 1]);
    const bullet = ["- item", "  ```", "  [a](./a.md)", "  ```", "[b](./b.md)"];
    expect(findMarkdownLinksInDocument(bullet).map((links) => links.length)).toEqual([0, 0, 0, 0, 1]);
    const outside = ["- item", "", "text", "    ```", "[c](./c.md)"];
    expect(findMarkdownLinksInDocument(outside).map((links) => links.length)).toEqual([0, 0, 0, 0, 1]);
  });

  // @req FR-NODE-232 AC-1
  it("reads a fence opened on a list item's marker line, so its closing fence closes it", () => {
    const bullet = ["- ```text", "  [a](./a.md)", "  ```", "", "[b](./b.md)"];
    expect(findMarkdownLinksInDocument(bullet).map((links) => links.length)).toEqual([0, 0, 0, 0, 1]);
    const ordered = ["1. ```md", "   [a](./a.md)", "   ```", "", "[b](./b.md)"];
    expect(findMarkdownLinksInDocument(ordered).map((links) => links.length)).toEqual([0, 0, 0, 0, 1]);
  });

  it("scans a line of unclosed brackets in linear time", () => {
    const line = `${"[".repeat(60_000)}x`;
    const started = performance.now();
    expect(findMarkdownLinks(line).filter((link) => link.kind !== "reference")).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("normalises a reference key by case and whitespace", () => {
    expect(referenceKey("  Arch   Doc ")).toBe(referenceKey("arch doc"));
  });
});
