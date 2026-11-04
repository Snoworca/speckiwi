import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";
import type { RequirementRecord } from "../../../src/core/types.js";

function rec(id: string, title: string): RequirementRecord {
  return {
    id, title, requirement: "The parser SHALL keep the workspace readable.", type: "functional", target: "t", status: "planned", scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as RequirementRecord;
}

// FR-NODE-239 AC-2/AC-6: a terms hit must match the query word it reports in matchedTerms.
// Searching for an ID that no record holds returns every record sharing the "FR"/"NODE" prefix,
// each reporting that it matched "FR-NODE-999".
it("an ID that occurs in no record is not reported as matched by records that only share its prefix", () => {
  const records = Array.from({ length: 12 }, (_, i) => rec(`FR-NODE-${String(100 + i)}`, `Node requirement ${i}`));
  const result = searchRequirementRecords(records, { query: "FR-NODE-999" }) as { records: Array<{ id: string; matchedTerms: string[] }> };
  expect(result.records.map((record) => `${record.id} ${record.matchedTerms.join(",")}`)).toEqual([]);
});
