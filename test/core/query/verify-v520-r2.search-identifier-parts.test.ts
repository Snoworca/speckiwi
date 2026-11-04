import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";
import type { RequirementRecord } from "../../../src/core/types.js";

function rec(id: string, title: string, requirement: string): RequirementRecord {
  return {
    id, title, requirement, type: "functional", target: "t", status: "planned", scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as RequirementRecord;
}

type Hit = { id: string; matchedTerms: string[] };

// FR-NODE-239 AC-2/AC-6 (the round-1 FR-NODE-999 defect, AC-8, for `_` and camelCase): an
// identifier an agent copies from code (`check_vibe_gate`, `rankRequirements`) is one query word,
// yet a record holding only one of its parts ("check", "requirement") is reported as matching it.
// On this repository `scaffold_scope` returns 244 records, `rankRequirements` 396.
it("a snake_case identifier is not reported as matched by records that hold only one of its parts", () => {
  const records = [
    ...Array.from({ length: 10 }, (_, i) => rec(`FR-GATE-${String(100 + i)}`, `Gate ${i}`, "Every gate shall check the workspace.")),
    rec("FR-MCP-001", "check_vibe_gate tool", "The tool reports the vibe gate.")
  ];
  const result = searchRequirementRecords(records, { query: "check_vibe_gate" }) as { records: Hit[] };
  expect(result.records.map((hit) => hit.id)).toEqual(["FR-MCP-001"]);
});

it("a camelCase identifier is not reported as matched by records that hold only one of its parts", () => {
  const records = [
    ...Array.from({ length: 10 }, (_, i) => rec(`FR-REQ-${String(100 + i)}`, `Requirement ${i}`, "The parser keeps every requirement readable.")),
    rec("FR-NODE-239", "Ranked search", "rankRequirements orders the records.")
  ];
  const result = searchRequirementRecords(records, { query: "rankRequirements" }) as { records: Hit[] };
  expect(result.records.map((hit) => hit.id)).toEqual(["FR-NODE-239"]);
});
