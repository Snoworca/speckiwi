import { describe, expect, it } from "vitest";
import { requirementDependencyIds } from "../../src/core/requirement-dependency.js";

// The one reader of a requirement block's dependencies: the References of its `Requirement` /
// `depends_on` Trace Link rows. Readiness, the work-graph check and the wave proposal all call it.

const row = (type: string, reference: string, relation: string) => ({ type, reference, relation });

describe("requirementDependencyIds — the depends_on IDs of a block", () => {
  // @req FR-NODE-246 AC-6
  it("FR-NODE-246 AC-6: reads Requirement / depends_on rows only, trimmed, distinct, in row order, blanks dropped", () => {
    const record = {
      traceLinks: [
        row("Requirement", " FR-B-002 ", "depends_on"),
        row("Requirement", "FR-A-001", "Depends-On"),
        row("Requirement", "FR-C-003", "related_to"),
        row("Code", "src/x.ts", "depends_on"),
        row("Requirement", "FR-B-002", "depends_on"),
        row("Requirement", "  ", "depends_on")
      ]
    };
    expect(requirementDependencyIds(record)).toEqual(["FR-B-002", "FR-A-001"]);
  });

  // @req FR-NODE-246 AC-6
  it("FR-NODE-246 AC-6: with a set, keeps only the IDs inside it", () => {
    const record = { traceLinks: [row("Requirement", "FR-B-002", "depends_on"), row("Requirement", "FR-A-001", "depends_on")] };
    expect(requirementDependencyIds(record, new Set(["FR-A-001", "FR-Z-009"]))).toEqual(["FR-A-001"]);
    expect(requirementDependencyIds(record, new Set())).toEqual([]);
  });
});
