import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";

import type { RequirementRecord } from "../../../src/core/types.js";

function rec(id: string, requirement: string): RequirementRecord {
  return {
    id, title: "Probe", requirement, type: "functional", target: "t", status: "planned", scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as RequirementRecord;
}
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
type Hit = { id: string; score: number };

// @req FR-NODE-239 AC-2 — hits are sorted on the unrounded score but the response reports it rounded
// to three decimals, so two hits the caller sees with the same score can come out in descending ID order.
it("hits reported with equal scores are in ascending ID order", () => {
  const fixture = [
    rec("FR-X-002", `lock ${words(2000)}`),
    rec("FR-X-001", `lock ${words(2001)}`),
    ...Array.from({ length: 8 }, (_, i) => rec(`FR-F-00${i}`, "other text"))
  ];
  const hits = (searchRequirementRecords(fixture, { query: "lock" }) as { records: Hit[] }).records;
  expect(hits.map((h) => h.score)).toEqual([hits[0]!.score, hits[0]!.score]);
  expect(hits.map((h) => h.id)).toEqual(["FR-X-001", "FR-X-002"]);
});
