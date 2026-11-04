import { describe, expect, it } from "vitest";
import { prdCoverage } from "../../../src/core/prd/coverage.js";
import { parsePrd } from "../../../src/core/prd/parse.js";
import { checkLinks } from "../../../src/core/query/links.js";
import type { ParsedWorkspace, RequirementRecord } from "../../../src/core/types.js";
import { PRD_PATH, writePrd } from "../../cli/prd-surface-fixture.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { buildPrd } from "./prd-fixture.js";

// Round 9 of the 5.2.0 PRD tool verification.

function record(overrides: Partial<RequirementRecord>): RequirementRecord {
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
    acceptanceCriteria: [{ id: "AC-1", text: "a", checked: false }],
    verificationEvidence: [],
    traceLinks: [],
    changeNotes: [],
    tags: [],
    ...overrides
  } as RequirementRecord;
}

function workspace(root: string, records: RequirementRecord[]): ParsedWorkspace {
  return { root: { root }, records } as unknown as ParsedWorkspace;
}

const prdW079 = (broken: Array<{ code: string }>) => broken.filter((entry) => entry.code === "SRS-W079");
const coverageOf = (rec: RequirementRecord) => prdCoverage(parsePrd(buildPrd(), PRD_PATH), [rec], { target: "t1" });

describe("verify 5.2.0 round 9 — PRD tools", () => {
  // @req FR-NODE-242 AC-2
  it("reads a bare citation written in square brackets, `AC-1 ← [PRD-1]`, as a citation", () => {
    // `[PRD-1]` with no `[PRD-1]: ...` definition is not a Markdown link; the bare PRD-1 inside it must
    // still cite PRD-1. Today the shortcut-reference form is swallowed by the link marker.
    const report = coverageOf(record({ rationale: "AC-1 ← [PRD-1]" }));
    expect(report.uncitedRequirements).toEqual([]);
    expect(report.ungroundedCriteria).toEqual([]);
  });

  // @req FR-NODE-242 AC-2
  it("does not throw when a Rationale holds private-use characters that look like the link marker", () => {
    // U+E000 / U+E001 are legal text; coverage must not crash on them.
    const run = () => coverageOf(record({ rationale: "AC-1 ← PRD-1 0" }));
    expect(run).not.toThrow();
  });

  // @req FR-NODE-242 AC-1
  it("links check does not throw when a Rationale holds private-use characters that look like the link marker", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writePrd(root, PRD_PATH, buildPrd());
    const rec = record({ rationale: `AC-1 ← ${PRD_PATH}#PRD-1 0` });
    await expect(checkLinks(workspace(root, [rec]))).resolves.toBeDefined();
  });

  // @req FR-NODE-242 AC-2
  it("counts a link written `./../prd/<file>.prd.md#PRD-1` as a citation, like `../prd/<file>.prd.md#PRD-1`", () => {
    // From docs/spec both destinations open the same PRD file.
    const file = PRD_PATH.slice("docs/prd/".length);
    const report = coverageOf(record({ rationale: `AC-1 ← [PRD-1](./../prd/${file}#PRD-1)` }));
    expect(report.uncitedRequirements).toEqual([]);
    expect(report.ungroundedCriteria).toEqual([]);
  });

  // @req FR-NODE-242 AC-2
  it("judges a running-text PRD path that holds `;` the same way at requirement and criterion level", () => {
    // The verifier found the requirement-level reader and the clause reader disagreeing on this path.
    // Lead decision (round 9): in running text `;` is a clause separator and ends a bare path; a path
    // holding `;` must be written as a link. The kept property is that both levels agree: not a citation.
    const prdPath = "docs/prd/a;b.prd.md";
    const report = prdCoverage(parsePrd(buildPrd(), prdPath), [record({ rationale: `AC-1 ← ${prdPath}#PRD-1` })], { target: "t1" });
    expect(report.uncitedRequirements.length).toBe(1);
    expect(report.ungroundedCriteria.map((entry) => entry.criterionId)).toEqual(["AC-1"]);
  });

  // @req FR-NODE-242 AC-2
  it("does not read the word `refills:` as a fills: basis that grounds another criterion", () => {
    const rec = record({
      acceptanceCriteria: [
        { id: "AC-1", text: "a", checked: false },
        { id: "AC-2", text: "b", checked: false }
      ],
      rationale: "AC-1 ← PRD-1 (the cache refills: PRD-2 for AC-2 is unrelated prose)"
    });
    expect(coverageOf(rec).ungroundedCriteria.map((entry) => entry.criterionId)).toEqual(["AC-2"]);
  });

  // @req FR-NODE-242 AC-1
  it("links check treats a PRD reference inside inline code as it treats a PRD link inside inline code", async () => {
    // The shared link scanner skips code spans, so a missing PRD link written as code is not reported;
    // the same missing reference written as a code-span path is reported. One of the two is wrong.
    const root = await copyFixtureWorkspace("valid-basic");
    const asLink = prdW079((await checkLinks(workspace(root, [record({ rationale: "`[x](../prd/missing.prd.md#PRD-1)`" })]))).broken);
    const asPath = prdW079((await checkLinks(workspace(root, [record({ rationale: "`docs/prd/missing.prd.md#PRD-1`" })]))).broken);
    expect(asPath.length).toBe(asLink.length);
  });
});
