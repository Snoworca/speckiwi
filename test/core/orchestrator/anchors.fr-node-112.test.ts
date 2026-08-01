import { describe, expect, it } from "vitest";
import { computeAnchorCoverage, deriveAnchoredRequirements, type RouteRequirementRecord } from "../../../src/core/orchestrator/route-probe.js";

// FR-NODE-112 — S3 and S3c (09 §3.2). The anchor set answers "which body requirements already own this
// file?" by normalized exact match; coverage is type-qualified because `traceReferences` is populated
// from every trace row regardless of type, so an unqualified count would clear the step rung vacuously
// in a repository whose requirements were never implemented through `kiwi-coder`.

function record(id: string, overrides: Partial<RouteRequirementRecord> = {}): RouteRequirementRecord {
  return { id, scope: id.split("-")[1] as string, traceReferences: [], traceLinks: [], ...overrides };
}

function codeAnchored(id: string, references = 1): RouteRequirementRecord {
  return record(id, { traceLinks: Array.from({ length: references }, (_, index) => ({ type: "Code", reference: `src/${id}-${index}.ts`, relation: "implements" })) });
}

describe("FR-NODE-112 AC-1 — a normalized exact match returns the requirement id", () => {
  const records = [record("FR-NODE-001", { traceReferences: ["src/core/orchestrator/route.ts"] })];

  it("matches a backslash-separated file path", () => {
    expect(deriveAnchoredRequirements(records, ["src\\core\\orchestrator\\route.ts"])).toEqual(["FR-NODE-001"]);
  });

  it("matches a ./-prefixed file path", () => {
    expect(deriveAnchoredRequirements(records, ["./src/core/orchestrator/route.ts"])).toEqual(["FR-NODE-001"]);
  });

  it("matches a trace reference carrying a #fragment", () => {
    const fragmented = [record("FR-NODE-001", { traceReferences: ["src/core/orchestrator/route.ts#L42"] })];

    expect(deriveAnchoredRequirements(fragmented, ["src/core/orchestrator/route.ts"])).toEqual(["FR-NODE-001"]);
  });
});

describe("FR-NODE-112 AC-2 — no match, and a union that counts each id once", () => {
  const records = [
    record("FR-NODE-001", { traceReferences: ["src/core/orchestrator/route.ts", "src/core/orchestrator/route-probe.ts"] }),
    record("FR-CLI-002", { traceReferences: ["src/cli/index.ts"] })
  ];

  it("returns no id for a file path that matches no trace reference", () => {
    expect(deriveAnchoredRequirements(records, ["src/core/orchestrator/route-lock.ts"])).toEqual([]);
  });

  it("contains each matching id exactly once across several file paths", () => {
    const anchored = deriveAnchoredRequirements(records, ["src/core/orchestrator/route.ts", "src/core/orchestrator/route-probe.ts", "src/cli/index.ts"]);

    expect(anchored).toEqual(["FR-NODE-001", "FR-CLI-002"]);
  });

  it("returns nothing for an empty file-path set", () => {
    expect(deriveAnchoredRequirements(records, [])).toEqual([]);
  });

  // Two records can carry the same id: that is SRS-E002, the merge-time duplicate this repository ships
  // a whole repair workflow for, and `list_requirements` returns both occurrences. Without the union
  // the anchor set would carry the id twice, and D1's `observed` would name it twice in the lock.
  it("counts a duplicated requirement id once when two records carry it", () => {
    const duplicated = [
      record("FR-NODE-001", { traceReferences: ["src/core/orchestrator/route.ts"] }),
      record("FR-NODE-001", { traceReferences: ["src/core/orchestrator/route-probe.ts"] })
    ];

    expect(deriveAnchoredRequirements(duplicated, ["src/core/orchestrator/route.ts", "src/core/orchestrator/route-probe.ts"])).toEqual(["FR-NODE-001"]);
  });
});

describe("FR-NODE-112 AC-3 — coverage counts only Code-typed trace rows", () => {
  it("yields 0 when every trace row carries another type", () => {
    const records = [
      // No `relation` here: the kernel's declared input is `{type, reference}` because `type` is the
      // only member it reads, and a fixture carrying a third field claims a shape the declaration does
      // not have. Real trace rows do carry a relation, and they satisfy this narrower input unchanged.
      record("FR-NODE-001", { traceLinks: [{ type: "Requirement", reference: "FR-NODE-002" }] }),
      record("FR-NODE-002", { traceLinks: [{ type: "Task", reference: "T-PH001-01" }] })
    ];

    expect(computeAnchorCoverage(records)).toBe(0);
  });

  it("counts the Code-typed row in a mixed trace list", () => {
    const records = [
      record("FR-NODE-001", { traceLinks: [{ type: "Task", reference: "T-PH001-01" }, { type: "Code", reference: "src/a.ts" }] }),
      record("FR-NODE-002")
    ];

    expect(computeAnchorCoverage(records)).toBe(0.5);
  });
});

describe("FR-NODE-112 AC-4 — the 0.2 comparison is pinned at the boundary", () => {
  function coverageOver(total: number, covered: number): number {
    return computeAnchorCoverage([
      ...Array.from({ length: covered }, (_, index) => codeAnchored(`FR-NODE-1${index}`)),
      ...Array.from({ length: total - covered }, (_, index) => record(`FR-NODE-2${index}`))
    ]);
  }

  it("is below 0.2 at one of ten", () => {
    expect(coverageOver(10, 1)).toBeLessThan(0.2);
  });

  it("is exactly 0.2 at one of five", () => {
    expect(coverageOver(5, 1)).toBe(0.2);
  });

  it("is above 0.2 at one of two", () => {
    expect(coverageOver(2, 1)).toBeGreaterThan(0.2);
  });

  it("is 0 for an empty record set, so the comparison is defined on an empty denominator", () => {
    expect(computeAnchorCoverage([])).toBe(0);
  });
});

describe("FR-NODE-112 AC-5 — coverage is a fraction of requirements, never of rows", () => {
  it("counts a requirement once however many Code rows it carries", () => {
    expect(computeAnchorCoverage([codeAnchored("FR-NODE-001", 3), record("FR-NODE-002")])).toBe(0.5);
  });

  it("never exceeds 1", () => {
    expect(computeAnchorCoverage([codeAnchored("FR-NODE-001", 4), codeAnchored("FR-NODE-002", 2)])).toBe(1);
  });
});

describe("FR-NODE-112 AC-6 — coverage reads traceLinks, not the type-erased traceReferences", () => {
  it("ignores a populated traceReferences list when traceLinks is empty", () => {
    const records = [record("FR-NODE-001", { traceReferences: ["src/core/orchestrator/route.ts"], traceLinks: [] })];

    expect(computeAnchorCoverage(records)).toBe(0);
  });

  it("counts a Code-typed traceLinks row on a record carrying no traceReferences", () => {
    const records = [{ id: "FR-NODE-001", scope: "NODE", traceLinks: [{ type: "Code", reference: "src/a.ts", relation: "implements" }] }];

    expect(computeAnchorCoverage(records)).toBe(1);
  });
});
