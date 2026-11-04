import { describe, expect, it } from "vitest";
import { linkDefinitions, referenceKey } from "../../../src/core/parser/markdown-links.js";

// FR-PARSE-044 AC-6 — the one collector of a document's link reference definitions. Three callers
// (rules pointers, scope renames, PRD citations) each kept their own; this is the shared one.

describe("FR-PARSE-044 AC-6 — linkDefinitions", () => {
  // @req FR-PARSE-044 AC-6
  it("keys each definition by its normalised label, first definition winning", () => {
    const lines = ["Text.", "", "[Rules  Doc]: ../rule/a.md", "[rules doc]: ../rule/b.md", ""];
    const found = linkDefinitions(lines);
    expect([...found.keys()]).toEqual([referenceKey("rules doc")]);
    expect(found.get(referenceKey("RULES DOC"))).toEqual({ destination: "../rule/a.md", startLine: 3, endLine: 3 });
  });

  // @req FR-PARSE-044 AC-6
  it("reads a bracketed destination without its brackets and a title on the same line", () => {
    const found = linkDefinitions(['[x]: <../rule/a b.md> "Title"']);
    expect(found.get("x")).toEqual({ destination: "../rule/a b.md", title: "Title", startLine: 1, endLine: 1 });
  });

  // @req FR-PARSE-044 AC-6
  it("spans two lines when the title sits on the next line", () => {
    const found = linkDefinitions(["[x]: ../rule/a.md", '  "Title"', "", "Body."]);
    expect(found.get("x")).toEqual({ destination: "../rule/a.md", title: "Title", startLine: 1, endLine: 2 });
  });

  // @req FR-PARSE-044 AC-6
  it("ignores definitions inside a fence or an HTML comment", () => {
    const lines = ["```md", "[x]: ../fenced.md", "```", "<!--", "[y]: ../commented.md", "-->", "[x]: ../real.md"];
    const found = linkDefinitions(lines);
    expect([...found.keys()]).toEqual(["x"]);
    expect(found.get("x")?.destination).toBe("../real.md");
  });
});
