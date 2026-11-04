import { describe, expect, it } from "vitest";
import { findRulesPointers, pointerNeedsRefresh, refreshRulesPointers } from "../../../src/core/bootstrap/rules-references.js";
import { linkDefinitions } from "../../../src/core/parser/markdown-links.js";

// Round 11 adversarial verification of FR-PARSE-044 AC-6 (rules 2.6.0 pointers) and the shared link
// reader. Each case below is read the way CommonMark 0.31 reads it; the spec example or section is cited.

const OLD = "SRS-MD-Rules-v2.5.0.md";
const NEW = "SRS-MD-Rules-v2.6.0.md";
const SCOPE = "docs/spec/01.alpha.srs.md";
const INDEX = "docs/spec/00.index.md";

function scopeDoc(rulesRow: string, ...tail: string[]): string {
  return ["# Alpha SRS", "", "| Field | Value |", "| --- | --- |", "| Document Type | scope-srs |", rulesRow, "", "## 1. Scope", "", ...tail].join("\n");
}

const rulesRowVerdicts = (text: string) =>
  findRulesPointers(text, "srs").map((pointer) => ({ line: pointer.line, needsRefresh: pointerNeedsRefresh(pointer, SCOPE) }));

describe("verify FR-PARSE-044 AC-6 rules pointers and the shared link reader, round 11", () => {
  // @req FR-PARSE-044 AC-6
  it("a reference-style Rules row whose definition sits inside a block quote is not a tool-owned pointer", () => {
    // Lead decision (round 11): a reference-style Rules row is author text, not a tool-owned pointer,
    // whatever its definition says or wherever it sits; doctor and upgrade leave it, validate sends it
    // to a hand edit.
    const text = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.6.0][rules] |", "Body.", "", `> [rules]: ../rule/${NEW}`, "");
    expect(rulesRowVerdicts(text)).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  it("a reference-style Rules row whose definition sits inside a list item is not a tool-owned pointer", () => {
    // Lead decision (round 11): a reference-style Rules row is author text, not a tool-owned pointer,
    // whatever its definition says or wherever it sits; doctor and upgrade leave it, validate sends it
    // to a hand edit.
    const text = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.6.0][rules] |", "Body.", "", `- [rules]: ../rule/${NEW}`, "");
    expect(rulesRowVerdicts(text)).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  it("refreshing leaves a stale reference-style Rules row and its block-quoted definition as they are", () => {
    // Lead decision (round 11): a reference-style Rules row is author text, not a tool-owned pointer,
    // whatever its definition says or wherever it sits; doctor and upgrade leave it, validate sends it
    // to a hand edit.
    const text = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |", "Body.", "", `> [rules]: ../rule/${OLD}`, "");
    expect(refreshRulesPointers(text, SCOPE).next).toBe(text);
  });

  // @req FR-PARSE-044 AC-6
  it("linkDefinitions does not take a line that continues a paragraph for a definition", () => {
    // CommonMark §4.7 and example 213: a link reference definition cannot interrupt a paragraph.
    expect([...linkDefinitions(["Foo", "[bar]: /baz", "", "[bar]"]).keys()]).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  it("a reference-style Rules row whose only 'definition' is paragraph text is not a tool-owned pointer", () => {
    // Lead decision (round 11): a reference-style Rules row is author text, not a tool-owned pointer,
    // whatever its definition says or wherever it sits; doctor and upgrade leave it, validate sends it
    // to a hand edit.
    const text = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.6.0][r] |", "The rules file is:", `[r]: ../rule/${NEW}`, "");
    expect(rulesRowVerdicts(text)).toEqual([]);
  });

  // @req FR-PARSE-044 AC-6
  it("the refresh keeps a definition an author paragraph uses through a reference wrapped across two lines", () => {
    // A link label may contain a line ending (CommonMark §6.3); `[SRS-MD Authoring\nRules v2.5.0]` uses the definition.
    const text = scopeDoc(
      "| Rules | [SRS-MD Authoring Rules v2.5.0] |",
      "Requirements before 2026-11 follow the [SRS-MD Authoring",
      "Rules v2.5.0] they were written under.",
      "",
      `[SRS-MD Authoring Rules v2.5.0]: ../rule/${OLD}`,
      ""
    );
    expect(refreshRulesPointers(text, SCOPE).next).toContain(`[SRS-MD Authoring Rules v2.5.0]: ../rule/${OLD}`);
  });

  // @req FR-PARSE-044 AC-6
  it("the refresh keeps a definition an author line uses through a shortcut reference inside other link brackets", () => {
    // CommonMark §6.3: a defined shortcut `[rules]` is a link, and links may not contain links, so the
    // outer `[...](...)` is text and `[rules]` is the author's use of the definition.
    const text = scopeDoc(
      "| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |",
      "See [the old [rules]](https://example.com/guide).",
      "",
      `[rules]: ../rule/${OLD}`,
      ""
    );
    expect(refreshRulesPointers(text, SCOPE).next).toContain(`[rules]: ../rule/${OLD}`);
  });

  // @req FR-PARSE-044 AC-6
  it("a Rules row whose link escapes punctuation in the bundled file name does not need a refresh", () => {
    // CommonMark §2.4: `\-` in a destination is a literal `-`; the shared reader resolves it to the bundled file.
    const text = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/SRS\\-MD\\-Rules\\-v2.6.0.md) |");
    expect(rulesRowVerdicts(text)).toEqual([{ line: 6, needsRefresh: false }]);
  });

  // @req FR-PARSE-044 AC-6
  it("a Rules row whose link percent-encodes the dots of the bundled file name does not need a refresh", () => {
    const text = scopeDoc("| Rules | [SRS-MD Authoring Rules v2.6.0](../rule/SRS-MD-Rules-v2%2E6%2E0.md) |");
    expect(rulesRowVerdicts(text)).toEqual([{ line: 6, needsRefresh: false }]);
  });

  // @req FR-PARSE-044 AC-6
  it("removing two adjacent pointer-only definitions leaves no doubled blank line", () => {
    const text = [
      "# Index",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| Rules | [SRS-MD Authoring Rules v2.5.0][rules] |",
      "",
      "## 10. Reference Documents",
      "",
      "- [SRS-MD Authoring Rules v2.5.0]",
      "",
      `[rules]: ../rule/${OLD}`,
      `[SRS-MD Authoring Rules v2.5.0]: ../rule/${OLD}`,
      "",
      "## 11. Next",
      ""
    ].join("\n");
    expect(refreshRulesPointers(text, INDEX).next).not.toMatch(/\n\n\n/);
  });
});
