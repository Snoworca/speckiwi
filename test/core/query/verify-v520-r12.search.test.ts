import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";

import type { RequirementRecord } from "../../../src/core/types.js";

function rec(id: string, requirement: string, title = "Probe"): RequirementRecord {
  return {
    id, title, requirement, type: "functional", target: "t", status: "planned", scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as RequirementRecord;
}
type Hit = { id: string; score: number; match: string; matchedTerms: string[] };
const search = (records: RequirementRecord[], query: string) =>
  (searchRequirementRecords(records, { query }) as { records: Hit[] }).records;

const fixture = () => [
  rec("FR-X-001", "the lock is held"),
  rec("FR-X-002", "the locks are held"),
  ...Array.from({ length: 8 }, (_, i) => rec(`FR-F-00${i}`, "other text"))
];

// @req FR-NODE-239 AC-2 — "lock Lock" is one word, but "lock locks" (same term after folding) counts
// as two, so one matched term covers half of a query that names one matched and two unmatched words.
it("a word that folds to the same term as an earlier word counts once for coverage, like a case variant", () => {
  const byCase = search(fixture(), "lock LOCK zzzq yyyq").map((h) => h.id);
  const byPlural = search(fixture(), "lock locks zzzq yyyq").map((h) => h.id);
  expect(byPlural).toEqual(byCase);
});

// @req FR-NODE-239 AC-2 — the same duplicate adds its term's BM25 contribution twice.
it("a word that folds to the same term as an earlier word adds to the score once, like a case variant", () => {
  const byCase = search(fixture(), "lock LOCK").find((h) => h.id === "FR-X-001")!.score;
  const byPlural = search(fixture(), "lock locks").find((h) => h.id === "FR-X-001")!.score;
  expect(byPlural).toBe(byCase);
});
