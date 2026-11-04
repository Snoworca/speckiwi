import { describe, expect, it } from "vitest";
import { findMetadataTableRange } from "../../../src/core/bootstrap/index-metadata.js";
import { findHeadingMatching } from "../../../src/core/parser/index-parser.js";

// FR-PARSE-044 AC-6 — the anchors the rules-pointer scan stands on ignore fenced examples. A fenced
// `| Field | Value |` table or a fenced heading is a sample an author shows, not the document's own.

describe("FR-PARSE-044 AC-6 — heading and metadata-table anchors skip fenced code", () => {
  // @req FR-PARSE-044 AC-6
  it("finds the real heading after a fenced copy of it", () => {
    const lines = ["# Index", "", "```md", "## 10. Reference Documents", "```", "", "## 10. Reference Documents", ""];
    expect(findHeadingMatching(lines, /^##\s+\d+\.\s+Reference Documents$/)).toBe(6);
  });

  // @req FR-PARSE-044 AC-6
  it("finds no heading when the only match is fenced", () => {
    const lines = ["~~~", "## 7. Completed Work Log", "~~~"];
    expect(findHeadingMatching(lines, /^##\s+\d+\.\s+Completed Work Log$/)).toBe(-1);
  });

  // @req FR-PARSE-044 AC-6
  it("finds the real metadata table after a fenced example table", () => {
    const lines = ["# Alpha", "", "```md", "| Field | Value |", "|---|---|", "| Status | planned |", "```", "", "| Field | Value |", "| --- | --- |", "| Rules | x |", ""];
    expect(findMetadataTableRange(lines)).toEqual({ first: 8, last: 10 });
  });
});
