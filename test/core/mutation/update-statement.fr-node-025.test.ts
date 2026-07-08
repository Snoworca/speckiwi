import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
// The green task (T-PH003-18) introduces src/core/mutation/update-statement.ts
// (exporting updateRequirementStatement) and a new Requirement-statement range
// helper in src/core/mutation/internal.ts (findRequirementStatementRange).
// Importing the not-yet-existing module/export makes the whole suite red until
// then.
import { updateRequirementStatement } from "../../../src/core/mutation/update-statement.js";
import { findRequirementStatementRange, loadRecordWithWorkspace } from "../../../src/core/mutation/internal.js";

// FR-NODE-025 — update_requirement_statement mutation with new Requirement range
// helper.
//
// Red-phase suite (T-PH003-17): one test case per acceptance criterion
// (AC-1..AC-3). These cases describe the future contract of
// update_requirement_statement before src/core/mutation/update-statement.ts and
// the findRequirementStatementRange helper exist, so the whole suite fails
// (missing module/export) until the green task (T-PH003-18) implements them.
//
// Contract under test (from the requirement body and AC):
//   updateRequirementStatement(root, { id, text }) replaces the body of the
//   "#### Requirement" section of a requirement block using a NEW range helper
//   distinct from findSectionBodyRange (which cannot target the Requirement
//   section). It is guarded against corrupting the adjacent Acceptance Criteria
//   section as well as any GFM tables or fenced code blocks that live inside the
//   statement body.
//     - AC-1: replaces the statement text without altering Acceptance Criteria.
//     - AC-2: does not corrupt GFM tables or fenced code blocks adjacent to the
//             statement.
//     - AC-3: a new range helper distinct from findSectionBodyRange locates the
//             Requirement statement range.

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

describe("FR-NODE-025 AC-1 — replaces statement without altering Acceptance Criteria", () => {
  it("replaces the Requirement statement body and leaves Acceptance Criteria untouched", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);
    // sanity: fixture preconditions
    expect(before).toContain("SpecKiwi must mutate this fixture requirement.");
    expect(before).toContain("- [ ] AC-1: The status can be updated.");
    expect(before).toContain("- [ ] AC-2: Evidence can be added.");

    const result = await updateRequirementStatement(root, {
      id: "FR-ARCH-001",
      text: "The requirement statement was replaced by the mutation."
    });

    expect(result.ok).toBe(true);
    const after = await readArch(rootPath);
    // new statement present, old statement gone
    expect(after).toContain("The requirement statement was replaced by the mutation.");
    expect(after).not.toContain("SpecKiwi must mutate this fixture requirement.");
    // Acceptance Criteria section and its entries are byte-for-byte preserved
    expect(after).toContain("#### Acceptance Criteria");
    expect(after).toContain("- [ ] AC-1: The status can be updated.");
    expect(after).toContain("- [ ] AC-2: Evidence can be added.");
  });
});

describe("FR-NODE-025 AC-2 — does not corrupt GFM tables or fenced code blocks", () => {
  it("preserves a table and a fenced code block that are adjacent to the statement", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const filePath = path.join(rootPath, ARCH_FILE);
    const original = await readArch(rootPath);

    // Inject a statement body containing a GFM table and a fenced code block so
    // that the mutation must replace ONLY the prose statement while leaving the
    // surrounding structured content intact. The Rationale heading marks the end
    // of the Requirement section.
    const richStatement = [
      "#### Requirement",
      "",
      "The original statement prose to be replaced.",
      "",
      "| Col A | Col B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const adjacent = true;",
      "```",
      "",
      "#### Rationale"
    ].join("\n");
    const withRich = original.replace(/#### Requirement[\s\S]*?#### Rationale/, richStatement);
    expect(withRich).not.toBe(original);
    await writeFile(filePath, withRich, "utf8");

    const root = await resolveProjectRoot(rootPath);
    const result = await updateRequirementStatement(root, {
      id: "FR-ARCH-001",
      text: "A safe replacement statement."
    });

    expect(result.ok).toBe(true);
    const after = await readArch(rootPath);
    // the GFM table rows survive intact
    expect(after).toContain("| Col A | Col B |");
    expect(after).toContain("| --- | --- |");
    expect(after).toContain("| 1 | 2 |");
    // the fenced code block survives intact
    expect(after).toContain("```ts");
    expect(after).toContain("const adjacent = true;");
    // the prose was replaced
    expect(after).toContain("A safe replacement statement.");
    expect(after).not.toContain("The original statement prose to be replaced.");
  });
});

describe("FR-NODE-025 AC-3 — a new range helper distinct from findSectionBodyRange", () => {
  it("findRequirementStatementRange locates the Requirement statement range", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const loaded = await loadRecordWithWorkspace(root, "FR-ARCH-001");
    expect(loaded).toBeDefined();
    if (!loaded) return;

    const range = findRequirementStatementRange(loaded.file, loaded.record);
    expect(range).toBeDefined();
    if (!range) return;

    // the located range must cover the statement line, NOT the Acceptance Criteria
    expect(range.startLine).toBeLessThanOrEqual(range.endLine);
    const statementLineIndex = loaded.file.lines.findIndex((l) =>
      l.includes("SpecKiwi must mutate this fixture requirement.")
    );
    expect(statementLineIndex).toBeGreaterThanOrEqual(0);
    const statementLine = statementLineIndex + 1;
    expect(range.startLine).toBeLessThanOrEqual(statementLine);
    expect(range.endLine).toBeGreaterThanOrEqual(statementLine);

    // the range must stop before the Acceptance Criteria section so the helper is
    // genuinely distinct from a section-body helper that targets other sections
    const workspace = await parseWorkspace(root);
    const record = workspace.records.find((r) => r.id === "FR-ARCH-001");
    expect(record).toBeDefined();
    const acHeadingLine = record?.sectionLines?.["Acceptance Criteria"];
    expect(acHeadingLine).toBeGreaterThan(0);
    if (acHeadingLine) {
      expect(range.endLine).toBeLessThan(acHeadingLine);
    }
  });
});
