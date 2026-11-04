import { describe, expect, it } from "vitest";
import { prdCoverage } from "../../../src/core/prd/coverage.js";
import { parsePrd } from "../../../src/core/prd/parse.js";
import { checkLinks } from "../../../src/core/query/links.js";
import type { ParsedWorkspace, RequirementRecord } from "../../../src/core/types.js";
import { PRD_PATH, writePrd } from "../../cli/prd-surface-fixture.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { buildPrd } from "./prd-fixture.js";

// Round 8 of the 5.2.0 PRD tool verification.

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

describe("verify 5.2.0 round 8 — PRD tools", () => {
  // @req FR-NODE-242 AC-2
  it("reports coverage for a Rationale whose criterion range ends in a large number instead of throwing", () => {
    // One requirement with one criterion; a typo in the range end (a date pasted as a number) must not
    // make coverage enumerate every number up to it.
    const doc = parsePrd(buildPrd(), PRD_PATH);
    const run = () => prdCoverage(doc, [record({ rationale: "AC-1–AC-20261104 ← PRD-1" })], { target: "t1" });
    expect(run).not.toThrow();
    expect(run().ungroundedCriteria).toEqual([]);
  }, 120_000);

  // @req FR-NODE-242 AC-2
  it("counts a link to a PRD file whose name holds a space as a citation of that PRD", () => {
    const prdPath = "docs/prd/a b.prd.md";
    const doc = parsePrd(buildPrd(), prdPath);
    const report = prdCoverage(doc, [record({ rationale: "AC-1 ← [PRD-1](../prd/a%20b.prd.md#PRD-1)" })], { target: "t1" });
    expect(report.uncitedRequirements).toEqual([]);
    expect(report.ungroundedCriteria).toEqual([]);
  });

  // @req FR-NODE-242 AC-1
  it("links check reports a Rationale link to a missing PRD file whose name holds a space", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const rec = record({ rationale: "AC-1 ← [PRD-1](../prd/missing%20file.prd.md#PRD-1)" });
    expect(prdW079((await checkLinks(workspace(root, [rec]))).broken)).toHaveLength(1);
  });

  // @req FR-NODE-242 AC-1
  it.runIf(process.platform === "win32" || process.platform === "darwin")(
    "coverage and links check agree that an upper-case .PRD.md suffix is not a PRD reference (suffix case)",
    async () => {
      // Lead decision (round 8): only the lower-case `.prd.md` suffix names a PRD file. The property kept
      // from the verifier's finding is that coverage and links check judge the same reference the same way.
      const root = await copyFixtureWorkspace("valid-basic");
      await writePrd(root, PRD_PATH, buildPrd());
      const rec = record({ rationale: `AC-1 ← ${PRD_PATH.replace(".prd.md", ".PRD.md")}#PRD-1` });
      const coverage = prdCoverage(parsePrd(buildPrd(), PRD_PATH), [rec], { target: "t1" });
      expect(coverage.ungroundedCriteria.length).toBeGreaterThan(0);
      expect(prdW079((await checkLinks(workspace(root, [rec]))).broken)).toEqual([]);
    }
  );
});
