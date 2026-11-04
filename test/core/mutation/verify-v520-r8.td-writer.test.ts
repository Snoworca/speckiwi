import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { updateField } from "../../../src/core/mutation/update-field.js";
import { updateRequirementFields } from "../../../src/core/mutation/edit-requirement.js";
import { repairRulesReferences } from "../../../src/core/mutation/repair-rules-references.js";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// Verification probes for the shared metadata writer (planMetadataWrite) refusal.

const SPEC_FILE = path.join("docs", "spec", "10.product-architecture.srs.md");

async function patchSpec(rootPath: string, edit: (text: string) => string): Promise<string> {
  const file = path.join(rootPath, SPEC_FILE);
  const before = await readFile(file, "utf8");
  const after = edit(before);
  expect(after).not.toBe(before);
  await writeFile(file, after, "utf8");
  return file;
}

describe("shared metadata writer refusal reaches the caller", () => {
  it("a confirmed type migration does not report success while the Type row it could not write keeps the old type", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = await patchSpec(rootPath, (text) => text.replace("| Type | functional |", "| Type | functional | |"));

    const result = await updateField(await resolveProjectRoot(rootPath), {
      id: "FR-ARCH-001",
      field: "type",
      value: "non_functional",
      signOff: true,
      dryRun: false
    });

    const after = await readFile(file, "utf8");
    const headingMigrated = after.includes("### NFR-ARCH-001 ");
    const typeRowStale = !after.includes("non_functional");
    // Either the migration is refused (nothing written) or it is complete; never an ok with a stale Type.
    expect({ ok: result.ok, headingMigrated, typeRowStale }).not.toEqual({ ok: true, headingMigrated: true, typeRowStale: true });
  });

  it("repair rules-references apply that fails part-way still names the requirements it already rewrote", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
    await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
    const stale = "[SRS-MD-Rules-v1.0.0.md](../rule/SRS-MD-Rules-v1.0.0.md)";
    const file = await patchSpec(rootPath, (text) => {
      const second = text
        .slice(text.indexOf("### FR-ARCH-001"))
        .replace("### FR-ARCH-001 — Fixture requirement", "### FR-ARCH-002 — Second requirement")
        .replace("| FR-ARCH-001 | self |", "| FR-ARCH-002 | self |")
        .replace("| Related Docs | [Index](./00.index.md) |", `| Related Docs | ${stale}, [a \\| b](./00.index.md) |`);
      return (
        text.replace("| Related Docs | [Index](./00.index.md) |", `| Related Docs | [Index](./00.index.md), ${stale} |`).trimEnd() +
        "\n\n" +
        second
      );
    });

    const before = await readFile(file, "utf8");
    const result = await repairRulesReferences(await resolveProjectRoot(rootPath), { apply: true });
    const after = await readFile(file, "utf8");

    // Lead decision (round 8): the defect is a silent partial write. The batch is now all-or-nothing,
    // so either every stale reference is repaired with the escaped pipe kept, or nothing is written.
    if (result.ok) {
      expect(after).not.toContain("SRS-MD-Rules-v1.0.0.md");
      expect(after).toContain("[a \\| b](./00.index.md)");
    } else {
      expect(after).toBe(before);
    }
  });
});

describe("rows HEAD rewrote without loss are still writable", () => {
  it("replacing a whole Tags value whose old cell holds a code span with a pipe", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = await patchSpec(rootPath, (text) => text.replace("| Tags | fixture |", "| Tags | `a|b` |"));

    const result = await updateRequirementFields(await resolveProjectRoot(rootPath), { id: "FR-ARCH-001", tags: ["core"] });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(await readFile(file, "utf8")).toContain("| Tags | core |");
  });

  it("repair rules-references rewrites a Related Docs row that also holds an escaped pipe in a link text", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
    await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
    const file = await patchSpec(rootPath, (text) =>
      text.replace(
        "| Related Docs | [Index](./00.index.md) |",
        "| Related Docs | [SRS-MD-Rules-v1.0.0.md](../rule/SRS-MD-Rules-v1.0.0.md), [a \\| b](./00.index.md) |"
      )
    );

    const result = await repairRulesReferences(await resolveProjectRoot(rootPath), { apply: true });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await readFile(file, "utf8");
    expect(after).not.toContain("SRS-MD-Rules-v1.0.0.md");
    expect(after).toContain("[a \\| b](./00.index.md)");
  });
});
