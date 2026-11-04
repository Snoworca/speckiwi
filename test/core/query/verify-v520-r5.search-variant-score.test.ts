import { expect, it } from "vitest";
import { buildRequirementSearchIndex, rankRequirements } from "../../../src/core/query/search-index.js";
import type { RequirementRecord } from "../../../src/core/types.js";

function rec(id: string, title: string, requirement: string): RequirementRecord {
  return {
    id, title, requirement, type: "functional", target: "t", status: "planned", scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as RequirementRecord;
}
const filler = Array.from({ length: 10 }, (_, i) => rec(`FR-FILL-${String(i).padStart(3, "0")}`, `Filler ${i}`, "The parser reads the workspace."));

// FR-NODE-239 AC-2: each group is ordered by BM25F score, equal scores by ascending ID. A query word
// is one BM25 query term. A word whose Porter stem ends in "us"/"is" (status, analysis, focus) is
// indexed under two terms (status + statu) and the query looks up both, so the one word adds its
// IDF-weighted frequency twice. Two records that differ only in which word they hold therefore no
// longer tie: one "status" outweighs one "stage" with the same frequency and document frequency.
it("a word with an s-stripped variant adds to the score once, like any other word", () => {
  const records = [
    ...filler,
    rec("FR-PAIR-001", "Pair one", "The stage field."),
    rec("FR-PAIR-002", "Pair two", "The status field.")
  ];
  const hits = rankRequirements(buildRequirementSearchIndex(records), "stage status");
  const score = (id: string) => hits.find((hit) => hit.record.id === id)!.score;
  // Observed: the status record scores 1.77x the stage record, and FR-PAIR-002 ranks first.
  expect(score("FR-PAIR-002") / score("FR-PAIR-001")).toBeLessThanOrEqual(1);
  expect(hits.map((hit) => hit.record.id)).toEqual(["FR-PAIR-001", "FR-PAIR-002"]);
});
