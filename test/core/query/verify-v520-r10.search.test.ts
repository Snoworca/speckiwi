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

// 80 emoji = 160 UTF-16 units, so the window edges (match - 60, match + 100) land inside a surrogate pair.
const EMOJI = "😀".repeat(80);

// @req FR-NODE-239 AC-6 — a snippet window cut by code units splits an emoji into lone surrogates.
it("a phrase-hit snippet next to emoji is well-formed text in ranked and exact mode", () => {
  const records = [...filler, rec("FR-EMO-001", "Emoji", `${EMOJI} gateway retries ${EMOJI}`)];
  for (const match of ["ranked", "exact"] as const) {
    const hit = hits(searchRequirementRecords(records, { query: "gateway retries", match })).find((h) => h.id === "FR-EMO-001");
    expect(hit).toBeDefined();
    for (const snippet of hit!.snippets) expect(snippet.text.isWellFormed(), match).toBe(true);
  }
});

// @req FR-NODE-239 AC-6
it("a terms-hit snippet next to emoji is well-formed text", () => {
  const records = [...filler, rec("FR-EMO-002", "Emoji", `${EMOJI} rollback ${EMOJI}`)];
  const hit = hits(searchRequirementRecords(records, { query: "rollback plan" })).find((h) => h.id === "FR-EMO-002");
  expect(hit).toBeDefined();
  for (const snippet of hit!.snippets) expect(snippet.text.isWellFormed()).toBe(true);
});
