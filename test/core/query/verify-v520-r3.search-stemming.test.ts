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

const filler = Array.from({ length: 10 }, (_, i) => rec(`FR-FILL-${String(i).padStart(3, "0")}`, `Filler ${i}`, "The parser reads the workspace."));
const ids = (result: unknown) => (result as { records: Array<{ id: string }> }).records.map((hit) => hit.id);

// FR-NODE-239 (Porter step 1a): the implementation keeps every final "is" whole so "analysis" stays
// one word, but reference Porter strips the plural "s" of an acronym ("APIs" -> "api"). This SRS
// writes "APIs", "CLIs" and "URIs" (60.workflow-release:1354, 50.nodejs:15056, 40.mcp:2252), so a
// query in one number misses a record written in the other, while "requirements" meets "requirement".
it("an acronym plural (APIs, CLIs) matches the record that writes the singular, as other plurals do", () => {
  const records = [
    ...filler,
    rec("FR-API-001", "Server surface", "The server exposes one API to agents."),
    rec("FR-CLI-900", "Agent runner", "The installer reaches the agent CLI through a runner.")
  ];
  expect(ids(searchRequirementRecords(records, { query: "APIs" }))).toContain("FR-API-001");
  expect(ids(searchRequirementRecords(records, { query: "agent CLIs" }))).toContain("FR-CLI-900");
});

// FR-NODE-239 AC-8 + stemming: a multi-part identifier also needs its whole-run term, and that term
// is never stemmed when it holds a digit. So "parseRecords" meets "parseRecord", but the same
// identifier with a digit ("parseV2Records") misses "parseV2Record" although every part matches.
it("an identifier holding a digit matches its own inflection the way the digit-free identifier does", () => {
  const records = [
    ...filler,
    rec("FR-PARSE-900", "Record parser", "parseRecord reads one block."),
    rec("FR-PARSE-901", "V2 record parser", "parseV2Record reads one block.")
  ];
  expect(ids(searchRequirementRecords(records, { query: "parseRecords" }))).toContain("FR-PARSE-900");
  expect(ids(searchRequirementRecords(records, { query: "parseV2Records" }))).toContain("FR-PARSE-901");
});
