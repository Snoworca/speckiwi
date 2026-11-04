import { describe, expect, it } from "vitest";
import { checkPrdReferences, prdCoverage } from "../../../src/core/prd/coverage.js";
import { parsePrd } from "../../../src/core/prd/parse.js";
import type { RequirementRecord } from "../../../src/core/types.js";
import { PRD_PATH } from "../../cli/prd-surface-fixture.js";
import { buildPrd } from "./prd-fixture.js";

// Round 10 of the 5.2.0 PRD tool verification: link forms the generated matrix does not cover.

function record(rationale: string): RequirementRecord {
  return {
    id: "FR-TEST-001",
    title: "t",
    requirement: "x",
    type: "functional",
    target: "t1",
    status: "planned",
    scope: "TEST",
    filePath: "docs/spec/01.test.srs.md",
    headingLine: 1,
    metadata: {},
    rationale,
    acceptanceCriteria: [{ id: "AC-1", text: "a", checked: false }],
    verificationEvidence: [],
    traceLinks: [],
    changeNotes: [],
    tags: []
  } as unknown as RequirementRecord;
}

const PRD_FILE = PRD_PATH.slice("docs/prd/".length);
const coverageAt = (prdPath: string, rationale: string) => prdCoverage(parsePrd(buildPrd(), prdPath), [record(rationale)], { target: "t1" });

describe("verify 5.2.0 round 10 — PRD citations", () => {
  // @req FR-NODE-242 AC-2
  it("does not read an autolink to an outside tracker, `<https://…/PRD-1>`, as a citation of PRD-1", () => {
    // `<https://…>` is a CommonMark autolink: a link whose destination is not a PRD file, so it cites
    // nothing. Today it is read as running text and its `PRD-1` grounds AC-1 and the requirement.
    const report = coverageAt(PRD_PATH, "AC-1 ← <https://tracker.example.com/browse/PRD-1>");
    expect(report.ungroundedCriteria.map((entry) => entry.criterionId)).toEqual(["AC-1"]);
    expect(report.uncitedRequirements.map((entry) => entry.requirementId)).toEqual(["FR-TEST-001"]);
  });

  // @req FR-NODE-242 AC-1
  it("links check reports a missing PRD file named by a link whose text wraps onto the next line", () => {
    // A Rationale is a paragraph; a wrapped line inside a link's text is still one link (CommonMark).
    const problems = checkPrdReferences([record("AC-1 ← [the reset\nitem](../prd/missing.prd.md#PRD-1)")], () => undefined);
    expect(problems.map((problem) => problem.reference)).toEqual(["docs/prd/missing.prd.md#PRD-1"]);
  });

  // @req FR-NODE-242 AC-2
  it("counts a link whose text wraps onto the next line as a citation", () => {
    const report = coverageAt(PRD_PATH, `AC-1 ← [the reset\nitem](../prd/${PRD_FILE}#PRD-1)`);
    expect(report.ungroundedCriteria).toEqual([]);
    expect(report.uncitedRequirements).toEqual([]);
  });

  // @req FR-NODE-242 AC-1
  it("links check reports a missing PRD file named by a link nested inside bracketed text", () => {
    // CommonMark example: `[foo [bar](/uri)](/uri)` — the inner one is the link, the outer brackets are text.
    const problems = checkPrdReferences([record("AC-1 ← [see [the item](../prd/missing.prd.md#PRD-1)](https://example.com)")], () => undefined);
    expect(problems.map((problem) => problem.reference)).toEqual(["docs/prd/missing.prd.md#PRD-1"]);
  });

  // @req FR-NODE-242 AC-1
  it("links check does not report a PRD file whose `;` is backslash-escaped in a link destination", () => {
    // `\;` is a CommonMark backslash escape: the destination is `../prd/a;b.prd.md`. Today the
    // backslash becomes a path separator and the reference reads `docs/prd/a/;b.prd.md`.
    const target = "docs/prd/a;b.prd.md";
    const doc = parsePrd(buildPrd(), target);
    const problems = checkPrdReferences([record(String.raw`AC-1 ← [x](../prd/a\;b.prd.md#PRD-1)`)], (p) => (p === target ? doc : undefined));
    expect(problems).toEqual([]);
  });

  // @req FR-NODE-242 AC-2
  it("counts a link with a backslash-escaped `;` in its destination as a citation of that PRD", () => {
    const report = coverageAt("docs/prd/a;b.prd.md", String.raw`AC-1 ← [x](../prd/a\;b.prd.md#PRD-1)`);
    expect(report.ungroundedCriteria).toEqual([]);
    expect(report.uncitedRequirements).toEqual([]);
  });
});
