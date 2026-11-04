import path from "node:path";
import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";
import { buildRequirementSearchIndex, rankRequirements } from "../../../src/core/query/search-index.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import type { RequirementRecord } from "../../../src/core/types.js";

function rec(id: string, title: string, requirement: string, tags: string[] = []): RequirementRecord {
  return {
    id, title, requirement, type: "functional", target: "t", status: "planned", scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags
  } as RequirementRecord;
}
const filler = Array.from({ length: 10 }, (_, i) => rec(`FR-FILL-${String(i).padStart(3, "0")}`, `Filler ${i}`, "The parser reads the workspace."));
const ids = (result: unknown) => (result as { records: Array<{ id: string }> }).records.map((hit) => hit.id);

// FR-NODE-239: the camelCase whole-run term is now joined from stemmed pieces ("workspac"+"root"),
// while the same word written in one case is stemmed whole ("workspaceroot"), and a camelCase query
// also demands its pieces. This SRS writes both "OpenCode" and "opencode" (30.cli-interface:1720,1763)
// and "workspaceRoot" and "workspaceroot" (40.mcp:4763), so the casing of the query decides the result.
it("a camelCase query word matches a record that writes the same word in lower case", () => {
  const records = [
    ...filler,
    rec("FR-SKILL-900", "Skill installer", "The installer writes skills for every agent.", ["opencode", "hermes"]),
    rec("FR-MCP-900", "Root gate", "The server checks the workspaceroot argument before a read.")
  ];
  expect(ids(searchRequirementRecords(records, { query: "opencode" }))).toContain("FR-SKILL-900");
  expect(ids(searchRequirementRecords(records, { query: "OpenCode" }))).toContain("FR-SKILL-900");
  expect(ids(searchRequirementRecords(records, { query: "workspaceRoot before" }))).toContain("FR-MCP-900");
});

// Same defect on this repository's SRS: FR-FLOW-004 is tagged "github-actions"; "github" returns it, "GitHub" does not.
it("on this repository's SRS, GitHub returns every record that github returns", async () => {
  const records = (await parseWorkspace(await resolveProjectRoot(path.resolve(__dirname, "../../..")))).records;
  const index = buildRequirementSearchIndex(records);
  const lower = new Set(rankRequirements(index, "github").map((hit) => hit.record.id));
  const camel = new Set(rankRequirements(index, "GitHub").map((hit) => hit.record.id));
  expect([...lower].filter((id) => !camel.has(id))).toEqual([]);
}, 60000);

// The acronym plural rule reads casing, so "APIs" meets "API" but the lower-case "apis" and "clis"
// stay whole under Porter's final-"is" rule and miss it ("CLIs" 252 hits vs "clis" 1 on this SRS).
it("a lower-case acronym plural matches the singular record as the capitalised one does", () => {
  const records = [
    ...filler,
    rec("FR-API-001", "Server surface", "The server exposes one API to agents."),
    rec("FR-CLI-900", "Agent runner", "The installer reaches the agent CLI through a runner.")
  ];
  expect(ids(searchRequirementRecords(records, { query: "APIs" }))).toContain("FR-API-001");
  expect(ids(searchRequirementRecords(records, { query: "apis" }))).toContain("FR-API-001");
  expect(ids(searchRequirementRecords(records, { query: "agent clis" }))).toContain("FR-CLI-900");
});
