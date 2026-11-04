import path from "node:path";
import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";
import { buildRequirementSearchIndex, rankRequirements } from "../../../src/core/query/search-index.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
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

// FR-NODE-239: porterStep1a now returns every word ending in "us" unchanged
// (src/core/query/search-tokenize.ts), so a plural formed by adding "s" to a word that ends
// in "u" keeps its "s": "CPUs" -> "cpus", "GPUs" -> "gpus", "menus" -> "menus", while the singular
// is "cpu" / "gpu" / "menu". The acronym plural "APIs" still meets "API" (round 4), these do not.
it("a plural of a word ending in -u (CPUs, GPUs, menus) matches the record that writes the singular", () => {
  const records = [
    ...filler,
    rec("FR-CPU-001", "Worker pool", "The pool sizes itself to one CPU per worker."),
    rec("FR-GPU-001", "Renderer", "The renderer needs a GPU."),
    rec("FR-MENU-001", "Context menu", "The editor shows a menu of commands.")
  ];
  // Observed: [] for each of the three queries.
  expect(ids(searchRequirementRecords(records, { query: "CPUs" }))).toContain("FR-CPU-001");
  expect(ids(searchRequirementRecords(records, { query: "GPUs" }))).toContain("FR-GPU-001");
  expect(ids(searchRequirementRecords(records, { query: "menus" }))).toContain("FR-MENU-001");
});

// FR-NODE-239: with the post-Porter final-"s" pass removed, a singular that itself ends in "s"
// loses that "s" in step 1a ("alias" -> "alia", "bias" -> "bia", "lens" -> "len") while its
// "-es" plural keeps it via step 5a ("aliases" -> "aliase" -> "alias"), so the two never meet.
it("a plural in -ses (aliases, biases, lenses) matches the record that writes the singular, and back", () => {
  const records = [
    ...filler,
    rec("FR-ALIAS-001", "Option alias", "The --qna flag stays a deprecated alias."),
    rec("FR-ALIAS-002", "Command aliases", "The CLI keeps old command aliases."),
    rec("FR-BIAS-001", "Ranking bias", "The ranker adds a bias toward titles."),
    rec("FR-LENS-001", "Review lenses", "The reviewer applies three lenses.")
  ];
  // Observed: "aliases" -> ["FR-ALIAS-002"], "alias" -> ["FR-ALIAS-001"], "biases" -> [], "lens" -> [].
  expect(ids(searchRequirementRecords(records, { query: "aliases" }))).toContain("FR-ALIAS-001");
  expect(ids(searchRequirementRecords(records, { query: "alias" }))).toContain("FR-ALIAS-002");
  expect(ids(searchRequirementRecords(records, { query: "biases" }))).toContain("FR-BIAS-001");
  expect(ids(searchRequirementRecords(records, { query: "lens" }))).toContain("FR-LENS-001");
});

// Same split on this repository's SRS, which writes "alias" 48 times and "aliases" 10 times.
it("on this repository's SRS, aliases and alias return the same records", async () => {
  const records = (await parseWorkspace(await resolveProjectRoot(path.resolve(__dirname, "../../..")))).records;
  const index = buildRequirementSearchIndex(records);
  const singularHits = rankRequirements(index, "alias");
  const singular = new Set(singularHits.map((hit) => hit.record.id));
  const plural = new Set(rankRequirements(index, "aliases").map((hit) => hit.record.id));
  // Lead decision (round 7): FR-NODE-239 AC-1 makes a phrase hit on the substring "alias" (e.g. in
  // "aliased" inside phrase-only fields) correct for the singular only. The word-matched records
  // must agree in both directions; the plural may never find what the singular misses.
  const singularByWords = singularHits.filter((hit) => hit.match !== "phrase").map((hit) => hit.record.id);
  expect(singularByWords.filter((id) => !plural.has(id))).toEqual([]);
  expect([...plural].filter((id) => !singular.has(id))).toEqual([]);
}, 60000);
