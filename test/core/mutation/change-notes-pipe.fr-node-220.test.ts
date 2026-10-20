import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import { getDiagnosticDefinition } from "../../../src/core/diagnostic-registry.js";
import { addChangeNote } from "../../../src/core/mutation/add-change-note.js";
import { retarget } from "../../../src/core/mutation/retarget.js";
import { supersedeRequirement } from "../../../src/core/mutation/supersede-requirement.js";
import { updateStability } from "../../../src/core/mutation/update-stability.js";
import { restore, updateStatus } from "../../../src/core/mutation/update-status.js";
import { splitTableRow } from "../../../src/core/parser/table.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-220 — a reason containing `|` never breaks a Change Notes row, and validation reports a
// row whose cell count differs from its header.

const ID = "FR-ARCH-001";
const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
// A pipe splits a cell; a line break (LF or CRLF) ends the row. Both must leave one row of the header's width.
const REASONS: ReadonlyArray<readonly [string, string]> = [
  ["pipe", "first half | second half"],
  ["LF", "first half\nsecond half"],
  ["CRLF", "first half\r\nsecond half"]
];

/** Every table line of the Change Notes section of `id`, header first. */
async function changeNoteRows(rootPath: string, id: string): Promise<string[][]> {
  const lines = (await readFile(path.join(rootPath, SPEC), "utf8")).split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`### ${id} `) || line.startsWith(`### ~~${id} `));
  const notes = lines.findIndex((line, index) => index > start && line === "#### Change Notes");
  const rows: string[][] = [];
  for (const line of lines.slice(notes + 1)) {
    if (line.startsWith("#")) break;
    if (line.startsWith("|") && !/^\|\s*-/.test(line)) rows.push(splitTableRow(line));
  }
  return rows;
}

async function expectRowsKeepHeaderWidth(rootPath: string, id: string, minimumRows: number): Promise<void> {
  const [header, ...rows] = await changeNoteRows(rootPath, id);
  expect(header).toEqual(["Date", "Change", "Reason"]);
  expect(rows.length).toBeGreaterThanOrEqual(minimumRows);
  for (const row of rows) expect(row, row.join(" | ")).toHaveLength(header!.length);
  expect(rows.at(-1)?.at(-1)).toContain("first half");
  expect(rows.at(-1)?.at(-1)).toContain("second half");
  // The whole section stays a table: no line of the reason spills out of the row.
  const section = (await readFile(path.join(rootPath, SPEC), "utf8")).split(/\r?\n/);
  expect(section.filter((line) => /second half/.test(line) && !line.startsWith("|"))).toEqual([]);
  // A line break, CRLF included, folds to exactly one space.
  if (!rows.at(-1)?.at(-1)?.includes("/")) expect(rows.at(-1)?.at(-1)).toContain("first half second half");
}

async function fixture(): Promise<{ rootPath: string; root: Awaited<ReturnType<typeof resolveProjectRoot>> }> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  return { rootPath, root: await resolveProjectRoot(rootPath) };
}

for (const [kind, REASON] of REASONS) describe(`FR-NODE-220 AC-1 — every Change Notes writing path keeps the header's column count (${kind} in the reason)`, () => {
  it("FR-NODE-220 AC-1: update_status with a reason", async () => {
    const { rootPath, root } = await fixture();
    expect((await updateStatus(root, { id: ID, status: "in_progress", reason: REASON })).ok).toBe(true);
    await expectRowsKeepHeaderWidth(rootPath, ID, 2);
  });

  it("FR-NODE-220 AC-1: a discard through update_status", async () => {
    const { rootPath, root } = await fixture();
    expect((await updateStatus(root, { id: ID, status: "discarded", reason: REASON, confirmDiscardVerified: true })).ok).toBe(true);
    await expectRowsKeepHeaderWidth(rootPath, ID, 2);
  });

  it("FR-NODE-220 AC-1: restore", async () => {
    const { rootPath, root } = await fixture();
    expect((await updateStatus(root, { id: ID, status: "discarded", confirmDiscardVerified: true })).ok).toBe(true);
    expect((await restore(root, { id: ID, reason: REASON })).ok).toBe(true);
    await expectRowsKeepHeaderWidth(rootPath, ID, 2);
  });

  it("FR-NODE-220 AC-1: supersede_requirement", async () => {
    const { rootPath, root } = await fixture();
    const result = await supersedeRequirement(root, {
      oldId: ID,
      scope: "ARCH",
      target: "v1.0.0",
      title: "Successor fixture requirement",
      statement: "SpecKiwi must parse the successor fixture requirement.",
      acceptanceCriteria: ["The successor can be listed."],
      reason: REASON,
      confirmDiscardVerified: true
    });
    expect(result.ok).toBe(true);
    await expectRowsKeepHeaderWidth(rootPath, ID, 2);
  });

  it("FR-NODE-220 AC-1: update_stability with a reason", async () => {
    const { rootPath, root } = await fixture();
    expect((await updateStability(root, { id: ID, stability: "evolving", reason: REASON })).ok).toBe(true);
    await expectRowsKeepHeaderWidth(rootPath, ID, 2);
  });

  it("FR-NODE-220 AC-1: retarget with a reason", async () => {
    const { rootPath, root } = await fixture();
    const index = path.join(rootPath, "docs", "spec", "00.index.md");
    await writeFile(
      index,
      (await readFile(index, "utf8")).replace("| v1.0.0 | release | active | Fixture release |", "| v1.0.0 | release | active | Fixture release |\n| v2.0.0 | release | planned | Next |"),
      "utf8"
    );
    expect((await retarget(root, { ids: [ID], toTarget: "v2.0.0", reason: REASON, dryRun: false })).ok).toBe(true);
    await expectRowsKeepHeaderWidth(rootPath, ID, 2);
  });

  it("FR-NODE-220 AC-1: add_change_note refuses a pipe and writes nothing (FR-NODE-061 AC-3)", async () => {
    const { rootPath, root } = await fixture();
    const result = await addChangeNote(root, { id: ID, date: "2026-10-20", change: "Edited", reason: REASON });
    expect(result.ok).toBe(false);
    const [header, ...rows] = await changeNoteRows(rootPath, ID);
    expect(rows.every((row) => row.length === header!.length)).toBe(true);
    expect(rows).toHaveLength(1);
  });
});

describe("FR-NODE-220 AC-2 — validation reports a Change Notes row whose cell count differs from its header", () => {
  it("FR-NODE-220 AC-2: a four-cell row yields SRS-W075 naming the requirement and the line", async () => {
    const { rootPath, root } = await fixture();
    const file = path.join(rootPath, SPEC);
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace("| 2026-05-08 | Created | Fixture |", "| 2026-05-08 | Created | Fixture |\n| 2026-10-20 | Status -> discarded | Discarded | broken |"), "utf8");
    const brokenLine = (await readFile(file, "utf8")).split(/\r?\n/).findIndex((line) => line.includes("| broken |")) + 1;

    const result = validateWorkspace(await parseWorkspace(root));
    const hits = result.diagnostics.filter((item) => item.code === "SRS-W075");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: "warning", requirementId: ID, line: brokenLine });
  });

  it("FR-NODE-220 AC-2: the clean fixture yields no SRS-W075", async () => {
    const { root } = await fixture();
    const result = validateWorkspace(await parseWorkspace(root));
    expect(result.diagnostics.map((item) => item.code)).not.toContain("SRS-W075");
  });

  it("FR-NODE-220 AC-2: SRS-W075 is registered and listed in the bundled rules validation table", async () => {
    expect(getDiagnosticDefinition("SRS-W075")).toMatchObject({ code: "SRS-W075", severity: "warning" });
    const rules = await readFile(path.join(process.cwd(), "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "utf8");
    expect(rules).toMatch(/^\|\s*`?SRS-W075`?\s*\|/m);
  });
});
