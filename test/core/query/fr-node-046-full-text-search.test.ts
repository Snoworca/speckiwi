import { describe, expect, it } from "vitest";
import type { AcceptanceCriterion, RequirementRecord } from "../../../src/core/types.js";
// The green task (T-PH003-58) introduces the full-text search core query in
// src/core/query/records.ts (with any new result/option type surfaced from
// src/core/types.ts). Importing the not-yet-existing export makes the whole
// suite red (missing export) until the green task implements it.
import { searchRequirementRecords } from "../../../src/core/query/records.js";
// AC-4 anchor: the supersedes trace-search helper. It is NOT a text search
// engine, and the new search must not be that function.
import { findIncomingTraceRows } from "../../../src/core/mutation/trace-search.js";

// FR-NODE-046 — full-text search core query over requirement records.
//
// Red-phase suite (T-PH003-57): one test case per acceptance criterion
// (AC-1..AC-5). These cases describe the future contract of
// searchRequirementRecords before the export exists, so the whole suite fails
// (missing module/export) until the green task (T-PH003-58) implements it.
//
// Contract under test (from the requirement body + AC):
//
//   searchRequirementRecords(
//     records: readonly RequirementRecord[],
//     query: string
//   ): RequirementRecord[]
//
// It returns the records whose searchable text (at least the requirement
// statement, the title, and the acceptance criteria text) contains the
// caller-supplied query substring, deterministically ordered by requirement id.

function ac(id: string, text: string): AcceptanceCriterion {
  return { id, text, checked: false, line: 1 };
}

// Build a RequirementRecord with full control over which searchable field
// carries a given marker string. Mirrors the inline-record convention used by
// test/core/mutation/trace-search.test.ts (makeRecord).
function makeRecord(
  id: string,
  parts: { title?: string; requirement?: string; acceptanceCriteria?: AcceptanceCriterion[] }
): RequirementRecord {
  const record: RequirementRecord = {
    id,
    title: parts.title ?? id,
    type: "functional",
    target: "v3.0.0",
    status: "planned",
    scope: "NODE",
    filePath: "docs/spec/50.nodejs-implementation.srs.md",
    headingLine: 1,
    metadata: {},
    acceptanceCriteria: parts.acceptanceCriteria ?? [],
    verificationEvidence: [],
    traceLinks: [],
    changeNotes: [],
    tags: []
  };
  if (parts.requirement !== undefined) record.requirement = parts.requirement;
  return record;
}

describe("FR-NODE-046 full-text search core query over requirement records", () => {
  // AC-1: Searching for a substring that appears in a requirements statement
  // text returns that requirement in the results.
  it("FR-NODE-046 AC-1: a substring in the requirement statement text returns that requirement", () => {
    const statementMatch = makeRecord("FR-NODE-901", {
      title: "Unrelated heading",
      requirement: "The system performs zephyr reconciliation across targets.",
      acceptanceCriteria: [ac("AC-1", "Unrelated criterion.")]
    });
    const noMatch = makeRecord("FR-NODE-902", {
      title: "Other heading",
      requirement: "The system performs ordinary work.",
      acceptanceCriteria: [ac("AC-1", "Other criterion.")]
    });

    const results = searchRequirementRecords([statementMatch, noMatch], "zephyr reconciliation");

    expect(results.map((record) => record.id)).toEqual(["FR-NODE-901"]);
  });

  // AC-2: Searching for a substring that appears only in a requirements
  // acceptance criteria text returns that requirement in the results.
  it("FR-NODE-046 AC-2: a substring only in the acceptance criteria text returns that requirement", () => {
    const acOnlyMarker = "quokkacheck";
    const acMatch = makeRecord("FR-NODE-903", {
      title: "Heading without the marker",
      requirement: "Statement without the marker.",
      acceptanceCriteria: [ac("AC-1", `Results pass the ${acOnlyMarker} assertion.`)]
    });
    const noMatch = makeRecord("FR-NODE-904", {
      title: "Heading without the marker",
      requirement: "Statement without the marker.",
      acceptanceCriteria: [ac("AC-1", "A plain criterion.")]
    });

    // Guard: the marker exists in NO statement and NO title, only in the AC text.
    expect(acMatch.requirement).not.toContain(acOnlyMarker);
    expect(acMatch.title).not.toContain(acOnlyMarker);

    const results = searchRequirementRecords([acMatch, noMatch], acOnlyMarker);

    expect(results.map((record) => record.id)).toEqual(["FR-NODE-903"]);
  });

  // AC-3: Searching for a string that appears in no requirement returns an
  // empty result set.
  it("FR-NODE-046 AC-3: a query that matches no requirement returns an empty result set", () => {
    const records = [
      makeRecord("FR-NODE-905", {
        requirement: "The system performs ordinary work.",
        acceptanceCriteria: [ac("AC-1", "A plain criterion.")]
      }),
      makeRecord("FR-NODE-906", {
        requirement: "Another ordinary statement.",
        acceptanceCriteria: [ac("AC-1", "Another plain criterion.")]
      })
    ];

    const results = searchRequirementRecords(records, "nonexistentmarkerxyz");

    expect(results).toEqual([]);
  });

  // AC-4: The search is implemented in a new src/core/query module and does not
  // reuse src/core/mutation/trace-search.ts, which only resolves incoming
  // supersedes trace rows.
  it("FR-NODE-046 AC-4: search is a src/core/query export distinct from the trace-search helper", () => {
    // Exported as a callable from the new src/core/query module (records.ts).
    expect(typeof searchRequirementRecords).toBe("function");
    // It must NOT be the supersedes trace-search helper reused as a text engine.
    expect(searchRequirementRecords).not.toBe(findIncomingTraceRows);

    // Behavioural proof of distinctness: trace-search resolves rows by an exact
    // type/relation/reference filter (not free text). A free-text query that
    // matches a requirement's statement returns that requirement here, whereas
    // findIncomingTraceRows over records carrying no incoming supersedes rows
    // returns nothing for the same string.
    const record = makeRecord("FR-NODE-907", {
      requirement: "The umbacore engine indexes searchable text.",
      acceptanceCriteria: [ac("AC-1", "A plain criterion.")]
    });

    expect(searchRequirementRecords([record], "umbacore").map((r) => r.id)).toEqual(["FR-NODE-907"]);
    expect(
      findIncomingTraceRows([record], { type: "Requirement", relation: "supersedes", reference: "umbacore" })
    ).toEqual([]);
  });

  // AC-5: Search results are deterministically ordered by requirement id.
  it("FR-NODE-046 AC-5: results are deterministically ordered by requirement id", () => {
    const marker = "dindlewort";
    // Supplied out of id order; all three match the marker in their statement.
    const records = [
      makeRecord("FR-NODE-910", { requirement: `gamma ${marker} statement.` }),
      makeRecord("FR-NODE-908", { requirement: `alpha ${marker} statement.` }),
      makeRecord("FR-NODE-909", { requirement: `beta ${marker} statement.` })
    ];

    const results = searchRequirementRecords(records, marker);

    expect(results.map((record) => record.id)).toEqual(["FR-NODE-908", "FR-NODE-909", "FR-NODE-910"]);
  });
});
