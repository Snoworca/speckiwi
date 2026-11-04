import { describe, expect, it, vi } from "vitest";

// The record parsers read the document's line classification once, from the block scanner: the section
// and criteria parsers take their slice of it instead of classifying their lines again, which made
// parsing docs/spec five to six times slower.

const calls = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../src/core/parser/document-lines.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/core/parser/document-lines.js")>();
  return {
    ...original,
    classifyDocumentLines: (...args: Parameters<typeof original.classifyDocumentLines>) => {
      calls.count += 1;
      return original.classifyDocumentLines(...args);
    }
  };
});

const { scanRequirementBlocks } = await import("../../../src/core/parser/block-scanner.js");
const { toRequirementRecord } = await import("../../../src/core/query/records.js");

function block(id: string): string[] {
  return [`### ${id} — Title`, "", "| Field | Value |", "| --- | --- |", "| Status | planned |", "", "#### Requirement", "", "Text.", "", "#### Acceptance Criteria", "", "- [ ] AC-1: Works.", ""];
}

describe("the record parsers classify a document's lines once", () => {
  // @req FR-NODE-233 AC-1
  it("builds every record of a scanned document without classifying again", () => {
    const lines = ["# X", "", "## 4. Requirements", "", ...block("FR-AAA-001"), ...block("FR-AAA-002"), ...block("FR-AAA-003")];
    const file = { path: "x.md", relativePath: "docs/spec/10.x.srs.md", text: lines.join("\n"), lines, newline: "\n" as const };
    const scanned = scanRequirementBlocks(lines, file.relativePath);
    calls.count = 0;

    const records = scanned.blocks.map((found) => toRequirementRecord(file, found, scanned.lines).record);

    expect(records.map((record) => record.acceptanceCriteria.length)).toEqual([1, 1, 1]);
    expect(calls.count).toBe(0);
  });
});
