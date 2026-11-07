import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { parseStepState } from "../../../src/core/parser/index-parser.js";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import { addChangeNote } from "../../../src/core/mutation/add-change-note.js";
import { addTraceLink } from "../../../src/core/mutation/add-trace.js";
import { addVerificationEvidence } from "../../../src/core/mutation/add-evidence.js";
import { updateStatus } from "../../../src/core/mutation/update-status.js";
import { updateStability } from "../../../src/core/mutation/update-stability.js";
import { expireAcceptanceCriterion } from "../../../src/core/mutation/expire-ac.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { repairRulesReferences } from "../../../src/core/mutation/repair-rules-references.js";
import { editRequirementTableRows } from "../../../src/core/mutation/edit-requirement.js";
import { claimStep } from "../../../src/core/mutation/claim-step.js";
import { updateStepState } from "../../../src/core/mutation/update-step-state.js";
import type { ProjectRoot, RequirementRecord } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-259 — the rows a mutation adds to or rewrites in a requirement block's Change Notes,
// Verification Evidence or Trace Links table, and in the step table of state.md, go under the
// table's own header. Before, each writer built the row in template column order, so an author's
// reordered table read back with every value under the wrong heading.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const STATE = path.join("docs", "spec", "steps", "state.md");

const CHANGE_NOTES = "| Date | Change | Reason |\n| --- | --- | --- |\n| 2026-05-08 | Created | Fixture |";
const EVIDENCE_HEADER = "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |";
const TRACE_HEADER = "| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |";

async function mutationTarget(edit: (text: string) => string): Promise<{ rootPath: string; root: ProjectRoot; specPath: string }> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const specPath = path.join(rootPath, SPEC);
  const text = await readFile(specPath, "utf8");
  const next = edit(text);
  expect(next).not.toBe(text);
  await writeFile(specPath, next, "utf8");
  return { rootPath, root: await resolveProjectRoot(rootPath), specPath };
}

const reorderedChangeNotes = (text: string): string =>
  text.replace(CHANGE_NOTES, "| Reason | Date | Change |\n| --- | --- | --- |\n| Fixture | 2026-05-08 | Created |");

async function record(root: ProjectRoot, id = "FR-ARCH-001"): Promise<RequirementRecord> {
  const found = (await parseWorkspace(root)).records.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`${id} not parsed`);
  return found;
}

function lastChangeNote(found: RequirementRecord): { date: string; change: string; reason: string } {
  const note = found.changeNotes.at(-1);
  if (!note) throw new Error("no change note");
  return { date: note.date, change: note.change, reason: note.reason };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("FR-NODE-259 rows go under their table's header", () => {
  // @req FR-NODE-259 AC-1
  it("AC-1: add-change-note on a reordered Change Notes table puts each value under its own header", async () => {
    const { root, specPath } = await mutationTarget(reorderedChangeNotes);
    expect((await addChangeNote(root, { id: "FR-ARCH-001", date: "2026-11-08", change: "Added AC-3", reason: "repro" })).ok).toBe(true);
    expect(await readFile(specPath, "utf8")).toContain("| Fixture | 2026-05-08 | Created |\n| repro | 2026-11-08 | Added AC-3 |");
    expect(lastChangeNote(await record(root))).toEqual({ date: "2026-11-08", change: "Added AC-3", reason: "repro" });
  });

  const changeNoteWriters: Array<{ name: string; run: (root: ProjectRoot) => Promise<{ ok: boolean; error?: { message: string } }>; change: RegExp; reason: string }> = [
    { name: "update-status", run: (root) => updateStatus(root, { id: "FR-ARCH-001", status: "in_progress", reason: "start" }), change: /in_progress/, reason: "start" },
    { name: "update-stability", run: (root) => updateStability(root, { id: "FR-ARCH-001", stability: "evolving", reason: "reopened" }), change: /evolving/, reason: "reopened" },
    { name: "retarget", run: (root) => retarget(root, { ids: ["FR-ARCH-001"], toTarget: "v1.1.0", reason: "next release", dryRun: false }), change: /^Target v1\.0\.0 -> v1\.1\.0$/, reason: "next release" },
    { name: "expire-ac", run: (root) => expireAcceptanceCriterion(root, { id: "FR-ARCH-001", acId: "AC-2", reason: "obsolete" }), change: /^Expired AC-2$/, reason: "obsolete" }
  ];
  for (const writer of changeNoteWriters) {
    // @req FR-NODE-259 AC-1
    it(`AC-1: ${writer.name} on a reordered Change Notes table puts each value under its own header`, async () => {
      const { root } = await mutationTarget(reorderedChangeNotes);
      const result = await writer.run(root);
      expect(result.ok, result.error?.message).toBe(true);
      const note = lastChangeNote(await record(root));
      expect(note.date).toMatch(DATE);
      expect(note.change).toMatch(writer.change);
      expect(note.reason).toBe(writer.reason);
    });
  }

  // @req FR-NODE-259 AC-1
  it("AC-1: repair rules-references on a reordered Change Notes table puts each value under its own header", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
    await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
    const specPath = path.join(rootPath, SPEC);
    const original = await readFile(specPath, "utf8");
    const body = reorderedChangeNotes(original)
      .replace("| Status | planned |", "| Status | verified |")
      .replace("| Related Docs | [Index](./00.index.md) |", "| Related Docs | [Index](./00.index.md), [SRS-MD-Rules-v1.0.0.md](../rule/SRS-MD-Rules-v1.0.0.md) |");
    expect(body).toContain("| Reason | Date | Change |");
    expect(body).toContain("SRS-MD-Rules-v1.0.0.md");
    await writeFile(specPath, body, "utf8");
    const root = await resolveProjectRoot(rootPath);
    const result = await repairRulesReferences(root, { apply: true, date: "2026-11-08" });
    expect(result.ok, result.error?.message).toBe(true);
    const repaired = (await parseWorkspace(root)).records.find((candidate) => candidate.changeNotes.some((note) => note.change === "Related Docs reference repaired"));
    expect(repaired).toBeDefined();
    const note = repaired!.changeNotes.find((entry) => entry.change === "Related Docs reference repaired")!;
    expect(note.date).toBe("2026-11-08");
    expect(note.reason).toMatch(/^rules document renamed/);
  });

  // @req FR-NODE-259 AC-2
  it("AC-2: add-evidence and add-trace on reordered tables put each value under its own header", async () => {
    const { root, specPath } = await mutationTarget((text) =>
      text
        .replace(EVIDENCE_HEADER, "| Covers | Evidence ID | Notes | Reference | Type |\n| --- | --- | --- | --- | --- |")
        .replace(TRACE_HEADER, "| Relation | Notes | Type | Reference |\n| --- | --- | --- | --- |")
    );
    expect((await addVerificationEvidence(root, { id: "FR-ARCH-001", type: "test", reference: "docs/spec/00.index.md", covers: "AC-1", notes: "n1" })).ok).toBe(true);
    expect((await addTraceLink(root, { id: "FR-ARCH-001", type: "Issue", reference: "https://example.com/1", relation: "tracks", notes: "n2" })).ok).toBe(true);
    const text = await readFile(specPath, "utf8");
    expect(text).toContain("| AC-1 | VE-1 | n1 | docs/spec/00.index.md | test |");
    expect(text).toContain("| tracks | n2 | Issue | https://example.com/1 |");
    const found = await record(root);
    expect(found.verificationEvidence).toEqual([expect.objectContaining({ id: "VE-1", type: "test", reference: "docs/spec/00.index.md", covers: "AC-1", notes: "n1" })]);
    expect(found.traceLinks).toEqual([expect.objectContaining({ type: "Issue", reference: "https://example.com/1", relation: "tracks", notes: "n2" })]);
  });

  // @req FR-NODE-259 AC-2
  it("AC-2: edit-requirement rewrites a row of a reordered Verification Evidence or Trace Links table under its own headers", async () => {
    const { root, specPath } = await mutationTarget((text) =>
      text
        .replace(EVIDENCE_HEADER, "| Covers | Evidence ID | Notes | Reference | Type |\n| --- | --- | --- | --- | --- |\n| AC-1 | VE-1 | old | docs/spec/00.index.md | test |")
        .replace(TRACE_HEADER, "| Relation | Notes | Type | Reference |\n| --- | --- | --- | --- |\n| tracks | old | Issue | https://example.com/1 |")
    );
    const evidence = await editRequirementTableRows(root, { id: "FR-ARCH-001", section: "verification_evidence", operations: [{ kind: "update", rowId: "VE-1", values: { notes: "new", covers: "AC-2" } }] });
    expect(evidence.ok, evidence.error?.message).toBe(true);
    const trace = await editRequirementTableRows(root, { id: "FR-ARCH-001", section: "trace_links", operations: [{ kind: "update", rowIndex: 0, values: { relation: "implements" } }] });
    expect(trace.ok, trace.error?.message).toBe(true);
    const text = await readFile(specPath, "utf8");
    expect(text).toContain("| AC-2 | VE-1 | new | docs/spec/00.index.md | test |");
    expect(text).toContain("| implements | old | Issue | https://example.com/1 |");
    const found = await record(root);
    expect(found.verificationEvidence).toEqual([expect.objectContaining({ id: "VE-1", type: "test", reference: "docs/spec/00.index.md", covers: "AC-2", notes: "new" })]);
    expect(found.traceLinks).toEqual([expect.objectContaining({ type: "Issue", reference: "https://example.com/1", relation: "implements", notes: "old" })]);
  });

  async function stepWorkspace(header: string, rows: string[] = []): Promise<{ root: ProjectRoot; statePath: string }> {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await mkdir(path.join(rootPath, "docs", "spec", "steps"), { recursive: true });
    const statePath = path.join(rootPath, STATE);
    const separator = `| ${header.split("|").slice(1, -1).map(() => "---").join(" | ")} |`;
    await writeFile(statePath, ["# Step State", "", "Mode: wait", "", header, separator, ...rows, ""].join("\n"), "utf8");
    return { root: await resolveProjectRoot(rootPath), statePath };
  }

  // @req FR-NODE-259 AC-3
  it("AC-3: claim-step and update-step-state on a reordered step table put each value under its own header", async () => {
    const { root, statePath } = await stepWorkspace("| Updated | Step | TouchesReq | Created | TouchesScope | DependsOn | Status |");
    const claimed = await claimStep(root, { step: "s1", touchesScope: "ARCH", touchesReq: ["FR-ARCH-001"] });
    expect(claimed.ok, claimed.error?.message).toBe(true);
    const updated = await updateStepState(root, { step: "s1", status: "merging", dependsOn: "s0" });
    expect(updated.ok, updated.error?.message).toBe(true);
    const lines = (await readFile(statePath, "utf8")).split("\n");
    const [entry] = parseStepState(lines);
    expect(entry).toEqual(expect.objectContaining({ step: "s1", status: "merging", dependsOn: "s0", touchesScope: "ARCH", touchesReq: "FR-ARCH-001" }));
    expect(entry?.created).toMatch(DATE);
    expect(entry?.updated).toMatch(DATE);
  });

  // @req FR-NODE-259 AC-4
  it("AC-4: a Change Notes table without a column the writer fills is refused naming the column, file byte-identical", async () => {
    const { root, specPath } = await mutationTarget((text) => text.replace(CHANGE_NOTES, "| Date | Change |\n| --- | --- |\n| 2026-05-08 | Created |"));
    const before = await readFile(specPath, "utf8");
    const result = await addChangeNote(root, { id: "FR-ARCH-001", date: "2026-11-08", change: "Added AC-3", reason: "repro" });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/\bReason\b/);
    const status = await updateStatus(root, { id: "FR-ARCH-001", status: "in_progress", reason: "start" });
    expect(status.ok).toBe(false);
    expect(status.error?.message).toMatch(/\bReason\b/);
    expect(await readFile(specPath, "utf8")).toBe(before);
  });

  // @req FR-NODE-259 AC-4
  it("AC-4: a step table without a column claim-step fills is refused naming the column, file byte-identical", async () => {
    const { root, statePath } = await stepWorkspace("| Step | Status | DependsOn | TouchesScope | Created | Updated |");
    const before = await readFile(statePath, "utf8");
    const result = await claimStep(root, { step: "s1", touchesScope: "ARCH", touchesReq: ["FR-ARCH-001"] });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/\bTouchesReq\b/);
    expect(await readFile(statePath, "utf8")).toBe(before);
  });

  // @req FR-NODE-259 AC-4
  it("AC-4: a column the writer does not own gets `-` in a new row", async () => {
    const { root, specPath } = await mutationTarget((text) =>
      text
        .replace(CHANGE_NOTES, "| Date | Change | Reason | Author |\n| --- | --- | --- | --- |\n| 2026-05-08 | Created | Fixture | bob |")
        .replace(TRACE_HEADER, "| Type | Reference | Relation | Notes | Owner |\n| --- | --- | --- | --- | --- |")
    );
    expect((await addChangeNote(root, { id: "FR-ARCH-001", date: "2026-11-08", change: "Added AC-3", reason: "repro" })).ok).toBe(true);
    expect((await addTraceLink(root, { id: "FR-ARCH-001", type: "Issue", reference: "https://example.com/1", relation: "tracks" })).ok).toBe(true);
    const text = await readFile(specPath, "utf8");
    expect(text).toContain("| 2026-11-08 | Added AC-3 | repro | - |");
    expect(text).toContain("| Issue | https://example.com/1 | tracks | - | - |");

    const { root: stepRoot, statePath } = await stepWorkspace("| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated | Owner |");
    expect((await claimStep(stepRoot, { step: "s1", touchesScope: "ARCH", touchesReq: ["FR-ARCH-001"] })).ok).toBe(true);
    expect(await readFile(statePath, "utf8")).toMatch(/\| s1 \| active \| - \| ARCH \| FR-ARCH-001 \| \d{4}-\d{2}-\d{2} \| \d{4}-\d{2}-\d{2} \| - \|/);
  });

  // @req FR-NODE-259 AC-4
  it("AC-4: a column the writer does not own keeps its cell in a rewritten row", async () => {
    const { root, specPath } = await mutationTarget((text) =>
      text.replace(TRACE_HEADER, "| Type | Reference | Relation | Notes | Owner |\n| --- | --- | --- | --- | --- |\n| Issue | https://example.com/1 | tracks | - | alice |")
    );
    const trace = await editRequirementTableRows(root, { id: "FR-ARCH-001", section: "trace_links", operations: [{ kind: "update", rowIndex: 0, values: { relation: "implements" } }] });
    expect(trace.ok, trace.error?.message).toBe(true);
    expect(await readFile(specPath, "utf8")).toContain("| Issue | https://example.com/1 | implements | - | alice |");

    const { root: stepRoot, statePath } = await stepWorkspace("| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated | Owner |", [
      "| s1 | active | - | ARCH | FR-ARCH-001 | 2026-01-01 | 2026-01-01 | carol |"
    ]);
    const updated = await updateStepState(stepRoot, { step: "s1", status: "merging" });
    expect(updated.ok, updated.error?.message).toBe(true);
    expect(await readFile(statePath, "utf8")).toMatch(/\| s1 \| merging \| - \| ARCH \| FR-ARCH-001 \| 2026-01-01 \| \d{4}-\d{2}-\d{2} \| carol \|/);
  });
});
