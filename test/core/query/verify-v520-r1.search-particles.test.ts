import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";
import type { RequirementRecord } from "../../../src/core/types.js";

function rec(id: string, title: string, requirement = ""): RequirementRecord {
  return {
    id, title, requirement, type: "functional", target: "t", status: "planned", scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as RequirementRecord;
}

const corpus = [
  ...Array.from({ length: 10 }, (_, i) => rec(`FR-FILL-${String(i).padStart(3, "0")}`, `채움 요구 ${i}`, "파서는 작업 공간을 읽는다.")),
  rec("FR-KEY-001", "정렬 규칙", "표는 키를 값으로 정렬한다.")
];

// FR-NODE-239 AC-3: "a query differing from the record only by attached particles ... still matches it".
it("a query of one-syllable nouns finds the record that carries the same nouns with particles", () => {
  const result = searchRequirementRecords(corpus, { query: "키 값" }) as { records: Array<{ id: string }> };
  expect(result.records.map((record) => record.id)).toContain("FR-KEY-001");
});
