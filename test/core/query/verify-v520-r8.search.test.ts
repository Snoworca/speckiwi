import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";
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
const ids = (result: unknown) => (result as { records: Array<{ id: string }> }).records.map((hit) => hit.id);

// FR-NODE-239 AC-8: the vocabulary holds only lower-case letter runs ("readlens"), never camelCase pieces,
// so the piece "lens" folds as an unknown word (-> "len") while the query "lenses" folds to "lens".
it("a camelCase piece written in the singular meets its plural query as a standalone singular does", () => {
  const standalone = [...filler, rec("FR-OPT-001", "Review", "The reviewer applies one lens.")];
  const camel = [...filler, rec("FR-OPT-002", "Review", "The reviewer calls readLens once.")];
  expect(ids(searchRequirementRecords(standalone, { query: "lenses" }))).toContain("FR-OPT-001");
  expect(ids(searchRequirementRecords(camel, { query: "lenses" }))).toContain("FR-OPT-002");
});

// FR-NODE-239: a piece with digits stems its letter tail with plain Porter and skips the vocabulary,
// so "v2alias" -> "v2alia" and "v2aliases" -> "v2alias" never meet, while alias/aliases do.
it("a digit-holding identifier meets its -es plural as the digit-free word does", () => {
  const plain = [...filler, rec("FR-A-001", "Alias", "The CLI keeps the alias.")];
  const digit = [...filler, rec("FR-A-002", "Alias", "The CLI keeps the v2alias.")];
  expect(ids(searchRequirementRecords(plain, { query: "aliases" }))).toContain("FR-A-001");
  expect(ids(searchRequirementRecords(digit, { query: "v2aliases" }))).toContain("FR-A-002");
});

const letters = (n: number): string => { let out = ""; do { out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); } while (n > 0); return out; };

// FR-MCP-071: the cached index keeps one vocabulary for the server's life, and its fold cache keeps
// every distinct query word without the bound the stem and run caches have (STEM_CACHE_LIMIT).
it("a cached index's vocabulary cache stays bounded across many distinct queries", () => {
  const index = buildRequirementSearchIndex(filler);
  for (let i = 0; i < 60_000; i += 1) rankRequirements(index, `q${letters(i)}x`);
  expect((index.vocabulary as unknown as { folded: Map<string, string> }).folded.size).toBeLessThanOrEqual(50_000);
}, 120000);
