import { describe, expect, it } from "vitest";
import { classifyLinkDestination, findMarkdownLinks } from "../../../src/core/parser/markdown-links.js";

// FR-NODE-242 AC-1 — the shared link reader agrees with CommonMark on three points the PRD citation
// reader depends on: an autolink is a link span, a link inside link text is the link (the outer brackets
// are text), and a backslash-escaped punctuation character in a destination is that character.

const summary = (line: string) =>
  findMarkdownLinks(line).map((link) => `${link.kind}:${line.slice(link.start, link.end)}${"destination" in link ? ` -> ${link.destination.value}` : ""}`);

describe("FR-NODE-242 AC-1 — autolinks", () => {
  // @req FR-NODE-242 AC-1
  it("reads `<https://…>` and `<mailto:…>` as autolink spans with their destination", () => {
    expect(summary("AC-1 ← <https://tracker.example.com/browse/PRD-1> and <mailto:a@b.example>.")).toEqual([
      "autolink:<https://tracker.example.com/browse/PRD-1> -> https://tracker.example.com/browse/PRD-1",
      "autolink:<mailto:a@b.example> -> mailto:a@b.example"
    ]);
  });

  // @req FR-NODE-242 AC-1
  it("reads an email autolink, and leaves a bracketed word, a space-holding URI and a code span alone", () => {
    expect(summary("<team@example.com> <not a link> <https://a b> `<https://code>`")).toEqual(["autolink:<team@example.com> -> team@example.com"]);
  });
});

describe("FR-NODE-242 AC-1 — a link inside link text", () => {
  // @req FR-NODE-242 AC-1
  it("takes the inner link and treats the outer brackets as text", () => {
    expect(summary("[see [the item](../prd/missing.prd.md#PRD-1)](https://example.com)")).toEqual([
      "inline:[the item](../prd/missing.prd.md#PRD-1) -> ../prd/missing.prd.md#PRD-1"
    ]);
  });

  // @req FR-NODE-242 AC-1
  it("keeps a link whose text holds an image, which is not a link", () => {
    expect(summary("[![logo](i.png)](../prd/a.prd.md)")).toEqual(["inline:[![logo](i.png)](../prd/a.prd.md) -> ../prd/a.prd.md"]);
  });

  // @req FR-NODE-242 AC-1
  it("does not read a full reference around a link as a link either", () => {
    // The trailing `[ref]` is then a shortcut reference of its own, as CommonMark reads it.
    expect(summary("[see [x](a.md)][ref]")).toEqual(["inline:[x](a.md) -> a.md", "reference:[ref]"]);
  });
});

describe("FR-NODE-242 AC-1 — backslash escapes in a destination", () => {
  // @req FR-NODE-242 AC-1
  it("unescapes `\\;` to `;` before any backslash is read as a path separator", () => {
    expect(classifyLinkDestination("../prd/a\\;b.prd.md#PRD-1")).toEqual({ kind: "local", path: "../prd/a;b.prd.md", fragment: "PRD-1" });
  });

  // @req FR-NODE-242 AC-1
  it("reads an escaped `#` or `?` as part of the path, not as a fragment or query", () => {
    expect(classifyLinkDestination("a\\#b.md")).toEqual({ kind: "local", path: "a#b.md" });
    expect(classifyLinkDestination("a\\?b.md")).toEqual({ kind: "local", path: "a?b.md" });
    expect(classifyLinkDestination("a.md#PRD\\-1")).toEqual({ kind: "local", path: "a.md", fragment: "PRD-1" });
  });

  // @req FR-NODE-242 AC-1
  it("still reads a backslash before a non-punctuation character as a path separator", () => {
    expect(classifyLinkDestination("..\\prd\\a.prd.md")).toEqual({ kind: "local", path: "../prd/a.prd.md" });
  });
});
