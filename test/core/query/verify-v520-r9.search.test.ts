import { expect, it } from "vitest";
import { searchRequirementRecords } from "../../../src/core/query/discovery.js";

import type { RequirementRecord } from "../../../src/core/types.js";

function rec(id: string, title: string, requirement: string, status = "planned"): RequirementRecord {
  return {
    id, title, requirement, type: "functional", target: "t", status, scope: "X",
    filePath: "docs/spec/10.x.srs.md", headingLine: 1, metadata: {}, acceptanceCriteria: [],
    verificationEvidence: [], traceLinks: [], changeNotes: [], tags: []
  } as RequirementRecord;
}
const filler = Array.from({ length: 10 }, (_, i) => rec(`FR-FILL-${String(i).padStart(3, "0")}`, `Filler ${i}`, "The parser reads the workspace."));
type Hit = { id: string; snippets: Array<{ text: string }> };
const hits = (result: unknown) => (result as { records: Hit[] }).records;

// @req FR-NODE-239 AC-6 — a snake_case piece is anchored at the start of its run, so a long name cuts the piece out.
it("a terms-hit snippet contains the matched snake_case piece of a long identifier", () => {
  const name = `${Array.from({ length: 14 }, (_, i) => `segment${i}`).join("_")}_rollback_flag`;
  const records = [...filler, rec("FR-SNK-001", "Config", `The loader reads ${name} at start.`)];
  const hit = hits(searchRequirementRecords(records, { query: "rollbacks" })).find((h) => h.id === "FR-SNK-001");
  expect(hit).toBeDefined();
  expect(hit!.snippets.some((s) => s.text.toLowerCase().includes("rollback"))).toBe(true);
});

// @req FR-NODE-239 AC-6 — the phrase offset comes from the lower-cased text; "İ" lower-cases to two code units.
it("a phrase-hit snippet contains the phrase after text whose lower case is longer", () => {
  const records = [...filler, rec("FR-TR-001", "Locale", `${"İ".repeat(200)} then the gateway retries twice.`)];
  const hit = hits(searchRequirementRecords(records, { query: "gateway retries" })).find((h) => h.id === "FR-TR-001");
  expect(hit).toBeDefined();
  expect(hit!.snippets.every((s) => s.text.toLowerCase().includes("gateway retries"))).toBe(true);
});
