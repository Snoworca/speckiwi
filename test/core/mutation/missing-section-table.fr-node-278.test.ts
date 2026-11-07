import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { addChangeNote } from "../../../src/core/mutation/add-change-note.js";
import { addTraceLink } from "../../../src/core/mutation/add-trace.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { updateStability } from "../../../src/core/mutation/update-stability.js";
import { expireAcceptanceCriterion } from "../../../src/core/mutation/expire-ac.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import type { ProjectRoot, RequirementRecord } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-278 — a row writer meets a requirement block with no Trace Links, Change Notes or
// Verification Evidence table. Before, a missing section was refused with MUTATION_DENIED and a
// heading with no table under it got a header-less row reported written that the parser never read.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

const EVIDENCE_AND_TRACE_TABLES = [
  "#### Verification Evidence",
  "",
  "| Evidence ID | Type | Reference | Covers | Notes |",
  "| --- | --- | --- | --- | --- |",
  "",
  "#### Trace Links",
  "",
  "| Type | Reference | Relation | Notes |",
  "| --- | --- | --- | --- |",
  "",
  ""
].join("\n");

const CHANGE_NOTES_TABLE = ["#### Change Notes", "", "| Date | Change | Reason |", "| --- | --- | --- |", "| 2026-05-08 | Created | Fixture |"].join("\n");

const CANONICAL_ORDER = [
  "Requirement",
  "Rationale",
  "Acceptance Criteria",
  "Verification Evidence",
  "Trace Links",
  "Research / Analysis",
  "Implementation Notes",
  "Change Notes"
];

type Shape = "no-section" | "heading-only";

/** The mutation-target workspace with FR-ARCH-001's three tables removed (`no-section`) or reduced to their headings. */
async function workspace(shape: Shape): Promise<{ rootPath: string; root: ProjectRoot }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const specPath = path.join(rootPath, SPEC);
  const text = await readFile(specPath, "utf8");
  expect(text).toContain(EVIDENCE_AND_TRACE_TABLES);
  expect(text).toContain(CHANGE_NOTES_TABLE);
  const next =
    shape === "no-section"
      ? text.replace(EVIDENCE_AND_TRACE_TABLES, "").replace(CHANGE_NOTES_TABLE, "").trimEnd() + "\n"
      : text
          .replace(EVIDENCE_AND_TRACE_TABLES, "#### Verification Evidence\n\n#### Trace Links\n\n")
          .replace(CHANGE_NOTES_TABLE, "#### Change Notes\n");
  await writeFile(specPath, next, "utf8");
  const root = await resolveProjectRoot(rootPath);
  const record = await readRecord(root);
  if (shape === "no-section") {
    expect(record.sectionLines?.["Trace Links"]).toBeUndefined();
    expect(record.sectionLines?.["Change Notes"]).toBeUndefined();
    expect(record.sectionLines?.["Verification Evidence"]).toBeUndefined();
  } else {
    expect(record.sectionLines?.["Trace Links"]).toBeDefined();
    expect(record.sectionLines?.["Change Notes"]).toBeDefined();
  }
  return { rootPath, root };
}

async function readRecord(root: ProjectRoot): Promise<RequirementRecord> {
  const record = (await parseWorkspace(root)).records.find((candidate) => candidate.id === "FR-ARCH-001");
  if (!record) throw new Error("FR-ARCH-001 not parsed");
  return record;
}

async function errors(root: ProjectRoot): Promise<string[]> {
  const parsed = await parseWorkspace(root);
  return [...parsed.diagnostics, ...validateWorkspace(parsed).diagnostics]
    .filter((item) => item.severity === "error")
    .map((item) => `${item.code}:${item.message}`);
}

/** The block's section headings in file order. */
function sectionOrder(record: RequirementRecord): string[] {
  return Object.entries(record.sectionLines ?? {})
    .sort(([, left], [, right]) => left - right)
    .map(([name]) => name);
}

interface Case {
  name: string;
  run: (root: ProjectRoot) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>;
  read: (record: RequirementRecord) => unknown[];
  expected: unknown;
}

const CASES: Case[] = [
  {
    name: "add-trace",
    run: (root) => addTraceLink(root, { id: "FR-ARCH-001", type: "Issue", reference: "https://example.com/1", relation: "tracks" }),
    read: (record) => record.traceLinks,
    expected: expect.objectContaining({ type: "Issue", reference: "https://example.com/1", relation: "tracks", notes: "-" })
  },
  {
    name: "add-change-note",
    run: (root) => addChangeNote(root, { id: "FR-ARCH-001", date: "2026-11-08", change: "Added AC-3", reason: "repro" }),
    read: (record) => record.changeNotes,
    expected: expect.objectContaining({ date: "2026-11-08", change: "Added AC-3", reason: "repro" })
  },
  {
    name: "add-evidence",
    run: (root) => addVerificationEvidence(root, { id: "FR-ARCH-001", type: "test", reference: "docs/spec/00.index.md", covers: "AC-1" }),
    read: (record) => record.verificationEvidence,
    expected: expect.objectContaining({ id: "VE-1", type: "test", reference: "docs/spec/00.index.md", covers: "AC-1", notes: "-" })
  },
  {
    name: "update-status reason",
    run: (root) => updateStatus(root, { id: "FR-ARCH-001", status: "in_progress", reason: "start" }),
    read: (record) => record.changeNotes,
    expected: expect.objectContaining({ reason: "start" })
  },
  {
    name: "update-stability reason",
    run: (root) => updateStability(root, { id: "FR-ARCH-001", stability: "evolving", reason: "reopened" }),
    read: (record) => record.changeNotes,
    expected: expect.objectContaining({ reason: "reopened" })
  },
  {
    name: "expire-ac",
    run: (root) => expireAcceptanceCriterion(root, { id: "FR-ARCH-001", acId: "AC-2", reason: "obsolete" }),
    read: (record) => record.changeNotes,
    expected: expect.objectContaining({ change: "Expired AC-2", reason: "obsolete" })
  },
  {
    name: "retarget",
    run: (root) => retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", reason: "next release", dryRun: false }),
    read: (record) => record.changeNotes,
    expected: expect.objectContaining({ change: "Target v1.0.0 -> v1.1.0", reason: "next release" })
  }
];

describe("FR-NODE-278 row writers on a block without the row's table", () => {
  // @req FR-NODE-278 AC-1
  it("AC-1: add_trace_link creates the Trace Links section with its standard header in rule position, and show returns the row", async () => {
    const { rootPath, root } = await workspace("no-section");
    const result = await addTraceLink(root, { id: "FR-ARCH-001", type: "Issue", reference: "https://example.com/1", relation: "tracks" });
    expect(result.ok, result.error?.message).toBe(true);
    const text = await readFile(path.join(rootPath, SPEC), "utf8");
    expect(text).toContain("#### Trace Links\n\n| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n| Issue | https://example.com/1 | tracks | - |\n");
    const record = await readRecord(root);
    expect(record.traceLinks).toEqual([expect.objectContaining({ type: "Issue", reference: "https://example.com/1", relation: "tracks" })]);
    expect(sectionOrder(record)).toEqual(CANONICAL_ORDER.filter((name) => name !== "Verification Evidence" && name !== "Change Notes"));
  });

  // @req FR-NODE-278 AC-1
  it("AC-1: add_change_note creates the Change Notes section with its standard header in rule position, and show returns the row", async () => {
    const { rootPath, root } = await workspace("no-section");
    const result = await addChangeNote(root, { id: "FR-ARCH-001", date: "2026-11-08", change: "Added AC-3", reason: "repro" });
    expect(result.ok, result.error?.message).toBe(true);
    const text = await readFile(path.join(rootPath, SPEC), "utf8");
    expect(text).toContain("- src/core/mutation\n\n#### Change Notes\n\n| Date | Change | Reason |\n| --- | --- | --- |\n| 2026-11-08 | Added AC-3 | repro |");
    const record = await readRecord(root);
    expect(record.changeNotes).toEqual([expect.objectContaining({ date: "2026-11-08", change: "Added AC-3", reason: "repro" })]);
    expect(sectionOrder(record)).toEqual(CANONICAL_ORDER.filter((name) => name !== "Verification Evidence" && name !== "Trace Links"));
  });

  // @req FR-NODE-278 AC-1
  it("AC-1: a section created before a later present section lands right before it, with blank lines around it", async () => {
    const { rootPath, root } = await workspace("no-section");
    expect((await addVerificationEvidence(root, { id: "FR-ARCH-001", type: "test", reference: "docs/spec/00.index.md" })).ok).toBe(true);
    const text = await readFile(path.join(rootPath, SPEC), "utf8");
    expect(text).toContain(
      "- [ ] AC-2: Evidence can be added.\n\n#### Verification Evidence\n\n| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |\n| VE-1 | test | docs/spec/00.index.md | all | - |\n\n#### Research / Analysis"
    );
  });

  // @req FR-NODE-278 AC-2
  it("AC-2: under a heading with no table, add-trace writes the header before the row and show reads the row", async () => {
    const { rootPath, root } = await workspace("heading-only");
    const result = await addTraceLink(root, { id: "FR-ARCH-001", type: "Issue", reference: "https://example.com/1", relation: "tracks" });
    expect(result.ok, result.error?.message).toBe(true);
    const text = await readFile(path.join(rootPath, SPEC), "utf8");
    expect(text).toContain("#### Trace Links\n\n| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n| Issue | https://example.com/1 | tracks | - |\n\n#### Research / Analysis");
    expect((await readRecord(root)).traceLinks).toHaveLength(1);
  });

  // @req FR-NODE-278 AC-2
  it("AC-2: under a Change Notes heading with no table at the end of the file, add-change-note writes the header before the row", async () => {
    const { rootPath, root } = await workspace("heading-only");
    const result = await addChangeNote(root, { id: "FR-ARCH-001", date: "2026-11-08", change: "Added AC-2", reason: "repro" });
    expect(result.ok, result.error?.message).toBe(true);
    const text = await readFile(path.join(rootPath, SPEC), "utf8");
    expect(text).toContain("#### Change Notes\n\n| Date | Change | Reason |\n| --- | --- | --- |\n| 2026-11-08 | Added AC-2 | repro |");
    expect((await readRecord(root)).changeNotes).toHaveLength(1);
  });

  // @req FR-NODE-278 AC-2
  it("AC-2: a section holding text but no table the parser reads is refused, not reported written with an unreadable row", async () => {
    const { rootPath, root } = await workspace("heading-only");
    const specPath = path.join(rootPath, SPEC);
    const withProse = (await readFile(specPath, "utf8")).replace("#### Trace Links\n\n", "#### Trace Links\n\nSee below.\n\n| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |\n\n");
    await writeFile(specPath, withProse, "utf8");
    const result = await addTraceLink(root, { id: "FR-ARCH-001", type: "Issue", reference: "https://example.com/1", relation: "tracks" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/Trace Links/);
    expect(await readFile(specPath, "utf8")).toBe(withProse);
  });

  for (const shape of ["no-section", "heading-only"] as const) {
    for (const testCase of CASES) {
      // @req FR-NODE-278 AC-3
      it(`AC-3: ${testCase.name} succeeds on a block whose table is ${shape === "no-section" ? "missing" : "only a heading"}, show returns the row and validate reports no error`, async () => {
        const { root } = await workspace(shape);
        const result = await testCase.run(root);
        expect(result.ok, result.error?.message).toBe(true);
        expect((result.value as { written?: boolean } | undefined)?.written).toBe(true);
        const record = await readRecord(root);
        expect(testCase.read(record)).toContainEqual(testCase.expected);
        expect(sectionOrder(record)).toEqual(CANONICAL_ORDER.filter((name) => Object.hasOwn(record.sectionLines ?? {}, name)));
        expect(await errors(root)).toEqual([]);
      });
    }
  }
});
