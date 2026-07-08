import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { setAcceptanceCriteriaChecked } from "../../../src/core/mutation/check-ac.js";
// The green task (T-PH003-20) introduces a new export
// `editAcceptanceCriteria` in src/core/mutation/check-ac.ts. Importing the
// not-yet-existing export makes the whole suite red until the green task
// implements it.
import { editAcceptanceCriteria } from "../../../src/core/mutation/check-ac.js";

// FR-NODE-026 — edit_acceptance_criteria mutation.
//
// Red-phase suite (T-PH003-19): one test case per acceptance criterion
// (AC-1..AC-3). These cases describe the future contract of
// editAcceptanceCriteria before src/core/mutation/check-ac.ts exports it, so
// the whole suite fails (missing export) until the green task (T-PH003-20)
// implements it.
//
// Contract under test (from the requirement body and AC):
//   editAcceptanceCriteria(root, { id, acId, text }) edits the prose text of a
//   targeted acceptance criterion entry on a requirement block.
//     - AC-1: updates the text of a targeted AC entry.
//     - AC-2: leaves the checked/unchecked state of AC entries unchanged.
//     - AC-3: does not modify the requirement statement or Trace Links sections.

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

describe("FR-NODE-026 AC-1 — updates the text of a targeted AC entry", () => {
  it("replaces the prose of the targeted acceptance criterion and leaves siblings untouched", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);
    // sanity: fixture preconditions
    expect(before).toContain("- [ ] AC-1: The status can be updated.");
    expect(before).toContain("- [ ] AC-2: Evidence can be added.");

    const result = await editAcceptanceCriteria(root, {
      id: "FR-ARCH-001",
      acId: "AC-1",
      text: "The status can be transitioned through the workflow."
    });

    expect(result.ok).toBe(true);
    const after = await readArch(rootPath);
    // new AC-1 text present, old AC-1 text gone, id prefix + checkbox preserved
    expect(after).toContain("- [ ] AC-1: The status can be transitioned through the workflow.");
    expect(after).not.toContain("- [ ] AC-1: The status can be updated.");
    // the untargeted sibling AC-2 is byte-for-byte preserved
    expect(after).toContain("- [ ] AC-2: Evidence can be added.");
  });
});

describe("FR-NODE-026 AC-2 — leaves the checked/unchecked state of AC entries unchanged", () => {
  it("preserves a checked AC's checkbox when editing its text", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);

    // Pre-condition: mark AC-1 as checked so the edit must preserve `[x]`.
    const check = await setAcceptanceCriteriaChecked(root, {
      id: "FR-ARCH-001",
      acIds: ["AC-1"],
      checked: true
    });
    expect(check.ok).toBe(true);
    const checked = await readArch(rootPath);
    expect(checked).toMatch(/- \[x\] AC-1: The status can be updated\./);

    const result = await editAcceptanceCriteria(root, {
      id: "FR-ARCH-001",
      acId: "AC-1",
      text: "The status can be updated atomically."
    });

    expect(result.ok).toBe(true);
    const after = await readArch(rootPath);
    // checked state is preserved across the text edit
    expect(after).toMatch(/- \[x\] AC-1: The status can be updated atomically\./);
    expect(after).not.toMatch(/- \[ \] AC-1: The status can be updated atomically\./);
    // the unchecked sibling AC-2 keeps its unchecked state
    expect(after).toContain("- [ ] AC-2: Evidence can be added.");
  });
});

describe("FR-NODE-026 AC-3 — does not modify the requirement statement or Trace Links sections", () => {
  it("leaves the Requirement statement and Trace Links section untouched when editing an AC", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);
    // sanity: fixture preconditions for the protected sections
    expect(before).toContain("SpecKiwi must mutate this fixture requirement.");
    expect(before).toContain("#### Trace Links");
    expect(before).toContain("| Type | Reference | Relation | Notes |");

    const result = await editAcceptanceCriteria(root, {
      id: "FR-ARCH-001",
      acId: "AC-2",
      text: "Verification evidence can be appended."
    });

    expect(result.ok).toBe(true);
    const after = await readArch(rootPath);
    // the targeted AC text was edited
    expect(after).toContain("- [ ] AC-2: Verification evidence can be appended.");
    // the Requirement statement section is byte-for-byte preserved
    expect(after).toContain("#### Requirement");
    expect(after).toContain("SpecKiwi must mutate this fixture requirement.");
    // the Trace Links section header and table are byte-for-byte preserved
    expect(after).toContain("#### Trace Links");
    expect(after).toContain("| Type | Reference | Relation | Notes |");
    expect(after).toContain("| --- | --- | --- | --- |");
  });
});
