import { describe, expect, it } from "vitest";
import { scanRequirementBlocks } from "../../../src/core/parser/block-scanner.js";
import { toRequirementRecord } from "../../../src/core/query/records.js";

// The block scanner, the section parser and the acceptance-criteria parser read the same lines as
// document text (classifyDocumentLines), so a heading or a criterion shown inside an HTML comment, a
// fence in a container or an indented code block is invisible to all three alike.

function record(body: string[]) {
  const lines = ["# X", "", "## 4. Requirements", "", "### FR-AAA-001 — One", "", "| Field | Value |", "| --- | --- |", "| Status | planned |", "", ...body, "", "## 5. End", ""];
  const file = { path: "x.srs.md", relativePath: "docs/spec/10.x.srs.md", text: lines.join("\n"), lines, newline: "\n" as const };
  const scanned = scanRequirementBlocks(lines, file.relativePath);
  const block = scanned.blocks[0];
  if (!block) throw new Error("no block");
  return toRequirementRecord(file, block, scanned.lines);
}

const HIDDEN: Record<string, string[]> = {
  "an HTML comment": ["<!--", "#### Acceptance Criteria", "", "- [ ] AC-9: hidden", "-->"],
  "a fence on a list item marker line": ["- ```md", "  #### Acceptance Criteria", "", "  - [ ] AC-9: hidden", "  ```"],
  "a fence inside a block quote": ["> ```md", "> #### Acceptance Criteria", "> - [ ] AC-9: hidden", "> ```"],
  "a top-level fence holding `>` lines": ["```md", "> quoted", "#### Acceptance Criteria", "- [ ] AC-9: hidden", "```"]
};

describe("record parsers share the line classifier", () => {
  for (const [shape, example] of Object.entries(HIDDEN)) {
    // @req FR-NODE-233 AC-1
    it(`a section heading and a criterion shown in ${shape} are neither a section nor a criterion`, () => {
      const result = record(["#### Requirement", "", "Text.", "", "#### Rationale", "", ...example, "", "#### Acceptance Criteria", "", "- [ ] AC-1: real"]);
      expect(result.diagnostics.filter((entry) => entry.code === "SRS-E018")).toEqual([]);
      expect(result.record.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(["AC-1"]);
    });
  }

  // @req FR-NODE-233 AC-1
  it("a criterion shown in a comment inside the criteria section is not counted", () => {
    const result = record(["#### Acceptance Criteria", "", "- [ ] AC-1: real", "<!--", "- [ ] AC-2: hidden", "-->", "- [ ] AC-2: also real"]);
    expect(result.record.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(["AC-1", "AC-2"]);
  });
});
