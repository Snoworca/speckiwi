import { describe, expect, it } from "vitest";
import { classifyDocumentLines, SRS_RECORD_LINES } from "../../../src/core/parser/document-lines.js";

// FR-NODE-268 AC-3 — a roadmap update refuses an item whose end an unclosed fence hides; the classifier
// marks the lines of such a fence, and only those, so the reader can tell.

describe("FR-NODE-268 AC-3 — the classifier marks a fence that never closes", () => {
  it("@req FR-NODE-268 AC-3: every line from an unclosed top-level fence opener to the end is marked unclosed; a closed fence is not", () => {
    const lines = ["text", "```", "closed", "```", "between", "~~~", "open", "", "### RM-2 — Hidden"];
    const unclosed = classifyDocumentLines(lines, SRS_RECORD_LINES).map((line) => line.unclosed === true);
    expect(unclosed).toEqual([false, false, false, false, false, true, true, true, true]);
  });
});
