import { describe, expect, it } from "vitest";
import { deriveSuccessorSlot, findIncomingTraceRows } from "../../../src/core/mutation/trace-search.js";
import type { RequirementRecord } from "../../../src/core/types.js";

function makeRecord(id: string, filePath: string, traceLinks: RequirementRecord["traceLinks"]): RequirementRecord {
  return {
    id,
    title: id,
    type: "functional",
    target: "v1.0.0",
    status: "planned",
    scope: "ARCH",
    filePath,
    headingLine: 1,
    metadata: {},
    acceptanceCriteria: [],
    verificationEvidence: [],
    traceLinks,
    changeNotes: [],
    tags: []
  };
}

describe("findIncomingTraceRows — SRS-MD-Rules v1.1.0 §30.1/§30.2 FIRST search", () => {
  it("returns no matches when nothing supersedes the target", () => {
    const records = [
      makeRecord("FR-ARCH-001", "docs/spec/10.product-architecture.srs.md", []),
      makeRecord("FR-AUTH-001", "docs/spec/20.auth.srs.md", [])
    ];
    expect(findIncomingTraceRows(records, { type: "Requirement", relation: "supersedes", reference: "FR-ARCH-001" })).toHaveLength(0);
  });

  it("returns a single supersedes match", () => {
    const records = [
      makeRecord("FR-ARCH-001", "docs/spec/10.product-architecture.srs.md", []),
      makeRecord("FR-ARCH-002", "docs/spec/10.product-architecture.srs.md", [
        { type: "Requirement", reference: "FR-ARCH-001", relation: "supersedes", notes: "delta", line: 200 }
      ])
    ];
    const matches = findIncomingTraceRows(records, { type: "Requirement", relation: "supersedes", reference: "FR-ARCH-001" });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sourceId).toBe("FR-ARCH-002");
  });

  it("orders multiple matches by filePath then by line (deterministic FIRST)", () => {
    const records = [
      makeRecord("FR-AUTH-009", "docs/spec/20.auth.srs.md", [
        { type: "Requirement", reference: "FR-ARCH-001", relation: "supersedes", notes: "", line: 50 }
      ]),
      makeRecord("FR-ARCH-002", "docs/spec/10.product-architecture.srs.md", [
        { type: "Requirement", reference: "FR-ARCH-001", relation: "supersedes", notes: "", line: 300 }
      ]),
      makeRecord("FR-ARCH-003", "docs/spec/10.product-architecture.srs.md", [
        { type: "Requirement", reference: "FR-ARCH-001", relation: "supersedes", notes: "", line: 200 }
      ])
    ];
    const matches = findIncomingTraceRows(records, { type: "Requirement", relation: "supersedes", reference: "FR-ARCH-001" });
    expect(matches.map((m) => m.sourceId)).toEqual(["FR-ARCH-003", "FR-ARCH-002", "FR-AUTH-009"]);
  });

  it("ignores rows whose type or relation does not match", () => {
    const records = [
      makeRecord("FR-ARCH-002", "docs/spec/10.product-architecture.srs.md", [
        { type: "Requirement", reference: "FR-ARCH-001", relation: "depends_on", notes: "", line: 1 },
        { type: "Code", reference: "FR-ARCH-001", relation: "supersedes", notes: "", line: 2 }
      ])
    ];
    expect(findIncomingTraceRows(records, { type: "Requirement", relation: "supersedes", reference: "FR-ARCH-001" })).toHaveLength(0);
  });

  it("conflicts_with relation is searched independently of supersedes", () => {
    const records = [
      makeRecord("FR-ARCH-002", "docs/spec/10.product-architecture.srs.md", [
        { type: "Requirement", reference: "FR-ARCH-001", relation: "conflicts_with", notes: "", line: 10 }
      ])
    ];
    expect(findIncomingTraceRows(records, { type: "Requirement", relation: "conflicts_with", reference: "FR-ARCH-001" })).toHaveLength(1);
    expect(findIncomingTraceRows(records, { type: "Requirement", relation: "supersedes", reference: "FR-ARCH-001" })).toHaveLength(0);
  });
});

describe("deriveSuccessorSlot", () => {
  it("returns undefined for empty matches", () => {
    expect(deriveSuccessorSlot([])).toBeUndefined();
  });

  it("maps single match to {id, count=0}", () => {
    expect(
      deriveSuccessorSlot([{ sourceId: "FR-X", sourceFilePath: "f.md", line: 1, relation: "supersedes", notes: "" }])
    ).toEqual({ successorId: "FR-X", successorCount: 0 });
  });

  it("maps N matches to {first.id, count=N-1}", () => {
    expect(
      deriveSuccessorSlot([
        { sourceId: "FR-A", sourceFilePath: "f.md", line: 1, relation: "supersedes", notes: "" },
        { sourceId: "FR-B", sourceFilePath: "f.md", line: 2, relation: "supersedes", notes: "" },
        { sourceId: "FR-C", sourceFilePath: "f.md", line: 3, relation: "supersedes", notes: "" }
      ])
    ).toEqual({ successorId: "FR-A", successorCount: 2 });
  });
});
