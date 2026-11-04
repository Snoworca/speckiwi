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

// FR-NODE-239: dropFinalS strips the "s" that Porter step 5a leaves after removing a final "e",
// so "erase"/"erased"/"erases" (Porter: eras) collapse onto "era" ("SDS-era", "sidecar-era").
// On this repository `rankRequirements(index, "erase")` returns FR-FLOW-143 ("A verification axis
// whose rule is decidable runs as a script") at rank 7 of 7 only because its evidence says
// "SDS-era". Same merge: worse -> wor, tense -> ten. Plain Porter keeps eras/era apart.
it("a query word ending in -se does not match a record that only holds the word minus 'se'", () => {
  const records = [
    ...filler,
    rec("FR-ERA-001", "Era note", "The SDS-era expectation is left open."),
    rec("FR-ERA-002", "Erase cache", "The command erases the cache.")
  ];
  const ids = rankRequirements(buildRequirementSearchIndex(records), "erase").map((hit) => hit.record.id);
  // Observed: ["FR-ERA-002", "FR-ERA-001"]
  expect(ids).toEqual(["FR-ERA-002"]);
});
