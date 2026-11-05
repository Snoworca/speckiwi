import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { judgeDiscardedTraceTargets } from "../../src/core/discarded-trace-target.js";
import { updateStatus } from "../../src/core/mutation/update-status.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { checkLinks } from "../../src/core/query/links.js";
import { deriveSuccessorSlot, findSupersedingRows } from "../../src/core/trace-search.js";
import type { RequirementRecord } from "../../src/core/types.js";
import { validateWorkspace } from "../../src/core/validator/validate-workspace.js";
import { A, LIVE, S, SPEC_FILE, discardedTargetWorkspace } from "../support/discarded-target-fixture.js";

// @req FR-PARSE-049 AC-8 — one function decides that a row targets a discarded requirement and finds
// its successors, and the successor lookup is the one the discarded heading marker uses.

function record(id: string, filePath: string, status: string, traceLinks: Array<{ reference: string; relation: string; line: number }>): RequirementRecord {
  return {
    id,
    title: id,
    type: "functional",
    target: "v1.0.0",
    status,
    scope: "ARCH",
    filePath,
    headingLine: 1,
    metadata: {},
    acceptanceCriteria: [],
    verificationEvidence: [],
    traceLinks: traceLinks.map((link) => ({ type: "Requirement", notes: "-", ...link })),
    changeNotes: [],
    tags: []
  } as RequirementRecord;
}

// The higher ID sits in the file that sorts first, so file order and ID order disagree.
const RECORDS = [
  record("FR-ARCH-001", "docs/spec/20.second.srs.md", "discarded", []),
  record("FR-ARCH-002", "docs/spec/20.second.srs.md", "planned", [{ reference: "FR-ARCH-001", relation: "supersedes", line: 40 }]),
  record("FR-ARCH-009", "docs/spec/10.first.srs.md", "planned", [{ reference: "FR-ARCH-001", relation: "supersedes", line: 90 }]),
  record("FR-ARCH-003", "docs/spec/20.second.srs.md", "planned", [{ reference: "FR-ARCH-001", relation: "extends", line: 70 }])
];

/** The live record holding the `extends` row, as links check and validate pass it. */
const LIVE_HOLDER = RECORDS[3]!;

describe("FR-PARSE-049 AC-8 — the shared discarded-target decision", () => {
  // @req FR-PARSE-049 AC-8
  it("finds the successors through the marker's lookup, in its order, with the marker's successor first", () => {
    const judged = judgeDiscardedTraceTargets(RECORDS).reports({ type: "Requirement", reference: "FR-ARCH-001", relation: "extends" }, LIVE_HOLDER);
    expect(judged).toMatchObject({ discardedId: "FR-ARCH-001", successorIds: ["FR-ARCH-009", "FR-ARCH-002"] });
    expect(judged?.successorIds).toEqual(findSupersedingRows(RECORDS, "FR-ARCH-001").map((row) => row.sourceId));
    expect(judged?.successorIds[0]).toBe(deriveSuccessorSlot(findSupersedingRows(RECORDS, "FR-ARCH-001"))?.successorId);
  });

  // @req FR-PARSE-049 AC-8
  it("gives the writers the same decision as the checks, except that only the checks leave checked_compatible alone", () => {
    const judge = judgeDiscardedTraceTargets(RECORDS);
    for (const relation of ["extends", "depends_on", "related_to", "refines"]) {
      const row = { type: "Requirement", reference: "FR-ARCH-001", relation };
      expect(judge.refuses(row), relation).toEqual(judge.reports(row, LIVE_HOLDER));
      expect(judge.refuses(row), relation).toBeDefined();
    }
    for (const relation of ["supersedes", "superseded_by"]) {
      const row = { type: "Requirement", reference: "FR-ARCH-001", relation };
      expect(judge.refuses(row), relation).toBeUndefined();
      expect(judge.reports(row, LIVE_HOLDER), relation).toBeUndefined();
    }
    const compatibility = { type: "Requirement", reference: "FR-ARCH-001", relation: "checked_compatible" };
    expect(judge.refuses(compatibility)).toBeDefined();
    expect(judge.reports(compatibility, LIVE_HOLDER)).toBeUndefined();
    // A live target, a missing target and a non-Requirement row are none of this decision's business.
    expect(judge.refuses({ type: "Requirement", reference: "FR-ARCH-002", relation: "extends" })).toBeUndefined();
    expect(judge.refuses({ type: "Requirement", reference: "FR-ARCH-404", relation: "extends" })).toBeUndefined();
    expect(judge.refuses({ type: "Code", reference: "FR-ARCH-001", relation: "extends" })).toBeUndefined();
  });

  // @req FR-PARSE-049 AC-5
  it("leaves a row held by a discarded requirement to the writers alone: the checks do not report it, the writers still refuse it", () => {
    const judge = judgeDiscardedTraceTargets(RECORDS);
    const discardedHolder = { ...LIVE_HOLDER, status: "discarded" };
    for (const relation of ["extends", "depends_on"]) {
      const row = { type: "Requirement", reference: "FR-ARCH-001", relation };
      expect(judge.reports(row, LIVE_HOLDER), relation).toBeDefined();
      expect(judge.reports(row, discardedHolder), relation).toBeUndefined();
      expect(judge.refuses(row), relation).toBeDefined();
    }
  });

  // @req FR-PARSE-049 AC-8
  it("names the same successors as the heading marker written by update_status, in links check and validate", async () => {
    const { rootPath, root } = await discardedTargetWorkspace();
    // A second supersedes row, above S in the file, so the marker gains `+1` and a new first successor.
    const file = path.join(rootPath, SPEC_FILE);
    const text = await readFile(file, "utf8");
    const traceHeader = text.indexOf("| Type | Reference | Relation | Notes |", text.indexOf(`### ${LIVE} — `));
    const rowEnd = text.indexOf("\n", text.indexOf("\n", traceHeader) + 1) + 1;
    await writeFile(file, `${text.slice(0, rowEnd)}| Requirement | ${A} | supersedes | - |\n${text.slice(rowEnd)}`, "utf8");
    expect((await updateStatus(root, { id: A, status: "planned" })).ok).toBe(true);
    expect((await updateStatus(root, { id: A, status: "discarded" })).ok).toBe(true);

    const after = await readFile(file, "utf8");
    expect(after).toContain(`[DISCARDED → see ${LIVE} +1]`);
    const workspace = await parseWorkspace(root);
    const warnings = validateWorkspace(workspace).diagnostics.filter((entry) => entry.code === "SRS-W081");
    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) expect(warning.details).toEqual({ discardedId: A, successorIds: [LIVE, S] });
    const broken = (await checkLinks(workspace)).broken.filter((entry) => entry.code === "SRS-W081");
    expect(broken.length).toBe(warnings.length);
    for (const entry of broken) expect(entry.reason).toBe(warnings[0]!.message.replace(/^Trace target /, ""));
  });
});
