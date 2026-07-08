import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { updateRequirementStatement } from "../../../src/core/mutation/update-statement.js";

// FR-NODE-025 — hardening tests for update_requirement_statement (FND-004).
//
// The statement range helper formerly captured only the FIRST prose paragraph,
// which produced two structural defects:
//   (a) a multi-paragraph statement left the second paragraph contradicting the
//       replacement; the whole prose block must be replaced as a unit.
//   (b) a statement whose first element is a GFM table or fenced code block was
//       silently overwritten; such a body must NOT be partially clobbered — the
//       mutation rejects it instead (MUTATION_DENIED) and writes nothing.

const ARCH_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function readArch(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, ARCH_FILE), "utf8");
}

async function replaceRequirementSection(rootPath: string, sectionLines: string[]): Promise<void> {
  const filePath = path.join(rootPath, ARCH_FILE);
  const original = await readArch(rootPath);
  const replaced = original.replace(/#### Requirement[\s\S]*?#### Rationale/, [...sectionLines, "#### Rationale"].join("\n"));
  if (replaced === original) {
    throw new Error("fixture precondition: Requirement section not found");
  }
  await writeFile(filePath, replaced, "utf8");
}

describe("FR-NODE-025 FND-004 — multi-paragraph statement is replaced as a whole prose block", () => {
  it("replaces every prose paragraph so no stale second paragraph survives", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await replaceRequirementSection(rootPath, [
      "#### Requirement",
      "",
      "First prose paragraph of the statement.",
      "",
      "Second prose paragraph that must not survive a replacement.",
      ""
    ]);
    const root = await resolveProjectRoot(rootPath);

    const result = await updateRequirementStatement(root, {
      id: "FR-ARCH-001",
      text: "The single replacement statement."
    });

    expect(result.ok).toBe(true);
    const after = await readArch(rootPath);
    expect(after).toContain("The single replacement statement.");
    // No fragment of the original multi-paragraph statement remains.
    expect(after).not.toContain("First prose paragraph of the statement.");
    expect(after).not.toContain("Second prose paragraph that must not survive a replacement.");
    // The Rationale heading (section boundary) is preserved.
    expect(after).toContain("#### Rationale");
  });
});

describe("FR-NODE-025 FND-004 — a table/fence-first statement body is rejected, not partially clobbered", () => {
  it("rejects a statement whose first element is a GFM table and writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await replaceRequirementSection(rootPath, [
      "#### Requirement",
      "",
      "| Col A | Col B |",
      "| --- | --- |",
      "| 1 | 2 |",
      ""
    ]);
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);

    const result = await updateRequirementStatement(root, {
      id: "FR-ARCH-001",
      text: "Attempted replacement."
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_DENIED");
    // The table is left byte-for-byte intact; nothing was clobbered.
    expect(await readArch(rootPath)).toBe(before);
  });

  it("rejects a statement whose first element is a fenced code block and writes nothing", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await replaceRequirementSection(rootPath, [
      "#### Requirement",
      "",
      "```ts",
      "const first = true;",
      "```",
      ""
    ]);
    const root = await resolveProjectRoot(rootPath);
    const before = await readArch(rootPath);

    const result = await updateRequirementStatement(root, {
      id: "FR-ARCH-001",
      text: "Attempted replacement."
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MUTATION_DENIED");
    expect(await readArch(rootPath)).toBe(before);
  });
});
