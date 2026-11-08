import { describe, expect, it } from "vitest";
import { buildPrdSearchIndex, parsePrd, searchPrdItems } from "../../../src/core/prd/index.js";
import { buildRequirementSearchIndex, rankRequirements } from "../../../src/core/query/search-index.js";
import { splitQueryWords } from "../../../src/core/query/search-tokenize.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { buildPrd } from "../prd/prd-fixture.js";

// FR-NODE-262 AC-3 — two query words whose parts fold to the same terms in a different order are one
// word: they are scored and counted once, for requirement search and PRD search alike.

function rec(id: string, title: string, requirement: string): RequirementRecord {
  return {
    id, title, requirement, type: "functional", target: "t", status: "planned", scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as RequirementRecord;
}

const RECORDS = [
  ...Array.from({ length: 10 }, (_, i) => rec(`FR-FILL-${String(i).padStart(3, "0")}`, `Filler ${i}`, "The parser reads the workspace.")),
  rec("FR-LOCK-001", "Lock only", "The lock is held."),
  rec("FR-CW-001", "Completed work", "The completed work log.")
];

const ranked = (query: string) => rankRequirements(buildRequirementSearchIndex(RECORDS), query).map((hit) => ({ id: hit.record.id, score: hit.score }));

describe("FR-NODE-262 AC-3 — reordered parts fold to one query word", () => {
  // @req FR-NODE-262 AC-3
  it("splitQueryWords keeps one word for `completed-work work-completed`", () => {
    expect(splitQueryWords("completed-work work-completed").map((word) => word.text)).toEqual(["completed-work"]);
  });

  // @req FR-NODE-262 AC-3 — control: a different multiset of parts is a different word.
  it("splitQueryWords keeps `completed-work` and `completed-work-work` apart", () => {
    expect(splitQueryWords("completed-work completed-work-work").map((word) => word.text)).toEqual(["completed-work", "completed-work-work"]);
  });

  // @req FR-NODE-262 AC-3
  it("requirement search scores `completed-work work-completed` like `completed-work completed-work`", () => {
    expect(ranked("completed-work work-completed")).toEqual(ranked("completed-work completed-work"));
  });

  // @req FR-NODE-262 AC-3
  it("requirement search counts the folded word once for coverage", () => {
    expect(ranked("lock completed-work work-completed")).toEqual(ranked("lock completed-work completed-work"));
    expect(ranked("lock completed-work work-completed").map((hit) => hit.id)).toContain("FR-LOCK-001");
  });

  // @req FR-NODE-262 AC-3
  it("PRD search returns for `completed-work work-completed` what it returns for `completed-work completed-work`", () => {
    const items = [
      { title: "Lock only", rows: { Kind: "proposal", State: "proposed", Reason: "r", Effect: "in-scope" }, body: "The lock is held." },
      { title: "Completed work", rows: { Kind: "proposal", State: "proposed", Reason: "r", Effect: "in-scope" }, body: "The completed work log." }
    ];
    const index = buildPrdSearchIndex([parsePrd(buildPrd({ items }), "docs/prd/2026-11-08.search.prd.md")]);
    const hits = (query: string) => searchPrdItems(index, query).items.map((item) => `${item.id}:${(item as { score?: number }).score ?? ""}`);
    expect(hits("lock completed-work work-completed")).toEqual(hits("lock completed-work completed-work"));
    expect(hits("lock completed-work work-completed").map((hit) => hit.split(":")[0])).toContain("PRD-1");
  });
});
