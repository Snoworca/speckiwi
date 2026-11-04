import { describe, expect, it } from "vitest";
import { classifyDocumentLines } from "../../../src/core/parser/document-lines.js";

// CommonMark finds where an HTML block or a fence ends in one forward pass, so classifying a document is
// linear in its length. Lines that open a structure and never close it are the costly input: each one
// asks where its structure ends. The bound is loose so CI load cannot trip it; a quadratic reading of
// 16,000 such lines takes several seconds.

const LINES = 16_000;
const BOUND_MS = 1_000;

function elapsedMs(lines: readonly string[]): number {
  const started = performance.now();
  classifyDocumentLines(lines);
  return performance.now() - started;
}

describe("classifyDocumentLines runs in linear time on structures that never close", () => {
  const cases: Array<[string, string]> = [
    ["top-level `<!--` lines", "<!-- open"],
    ["`<!--` lines in a block quote", "> <!-- open"],
    ["`<!--` lines in a list item", "- <!-- open"],
    ["fence openers with an info string in a block quote", "> ```x"],
    ["fence openers with an info string in a list item", "- ```x"]
  ];
  for (const [name, line] of cases) {
    // @req FR-NODE-233 AC-1
    it(`${LINES} ${name}`, () => {
      const lines = Array.from({ length: LINES }, () => line);
      classifyDocumentLines(lines.slice(0, 100));

      expect(elapsedMs(lines)).toBeLessThan(BOUND_MS);
    }, 60_000);
  }
});
