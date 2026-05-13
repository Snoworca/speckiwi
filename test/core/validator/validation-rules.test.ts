import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

async function diagnosticCodesForFixture(name: string): Promise<string[]> {
  const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(name)));
  return validateWorkspace(workspace).diagnostics.map((diagnostic) => diagnostic.code);
}

describe("validation registry", () => {
  it("passes the valid fixture", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const result = validateWorkspace(workspace);
    expect(result.errors).toHaveLength(0);
  });

  it("detects duplicate IDs, missing metadata, and verified guard failures", async () => {
    const duplicate = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("duplicate-id"))));
    expect(duplicate.diagnostics.map((d) => d.code)).toContain("SRS-E002");

    const missing = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("missing-metadata"))));
    expect(missing.diagnostics.map((d) => d.code)).toContain("SRS-E003");

    const guard = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("verified-guard-failure"))));
    expect(guard.diagnostics.map((d) => d.code)).toContain("SRS-E010");

    const invalid = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("invalid-structure"))));
    expect(invalid.diagnostics.map((d) => d.code)).toContain("SRS-E001");
  });

  it("validates explicit Active Target metadata against the Target Map", async () => {
    const unknownRoot = await copyFixtureWorkspace("valid-basic");
    const unknownIndexPath = path.join(unknownRoot, "docs", "spec", "00.index.md");
    await writeFile(unknownIndexPath, (await readFile(unknownIndexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target | v9.9.9 |"), "utf8");
    const unknown = validateWorkspace(await parseWorkspace(await resolveProjectRoot(unknownRoot)));
    expect(unknown.diagnostics.map((d) => d.code)).toContain("SRS-E017");

    const inactiveRoot = await copyFixtureWorkspace("valid-basic");
    const inactiveIndexPath = path.join(inactiveRoot, "docs", "spec", "00.index.md");
    await writeFile(inactiveIndexPath, (await readFile(inactiveIndexPath, "utf8")).replace("| v1.0.0 | release | active |", "| v1.0.0 | release | planned |"), "utf8");
    const inactive = validateWorkspace(await parseWorkspace(await resolveProjectRoot(inactiveRoot)));
    expect(inactive.diagnostics.map((d) => d.code)).toContain("SRS-W010");

    const emptyRoot = await copyFixtureWorkspace("valid-basic");
    const emptyIndexPath = path.join(emptyRoot, "docs", "spec", "00.index.md");
    await writeFile(emptyIndexPath, (await readFile(emptyIndexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target |  |"), "utf8");
    const empty = validateWorkspace(await parseWorkspace(await resolveProjectRoot(emptyRoot)));
    expect(empty.diagnostics.map((d) => d.code)).not.toContain("SRS-E017");
    expect(empty.diagnostics.map((d) => d.code)).not.toContain("SRS-W010");
  });

  it("reports Completed Work Log inconsistencies as warnings", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    await writeFile(
      indexPath,
      original.replace("| 2026-05-09 |  | ARCH |  | Cross-target fixture setup completed. |", "| 2026/05/09 | v9.9.9 | UNKNOWN | MISSING-ID | Bad completed row. |"),
      "utf8"
    );

    const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(root)));
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(["SRS-W011", "SRS-W012", "SRS-W013", "SRS-W014", "SRS-W015"]));
    expect(result.errors).toHaveLength(0);
  });

  it("reports malformed Completed Work Log report paths as warnings", async () => {
    for (const reportPath of [
      "/absolute.md",
      "./local.md",
      "../escape.md",
      "docs/../escape.md",
      "https://example.com/report.md",
      String.raw`docs\report.md`,
      "docs/reports/bad|path.md",
      "docs/reports/ok.md, , docs/reports/next.md",
      "docs/reports/fragment.md#section"
    ]) {
      const root = await copyFixtureWorkspace("valid-basic");
      const indexPath = path.join(root, "docs", "spec", "00.index.md");
      const original = await readFile(indexPath, "utf8");
      await writeFile(
        indexPath,
        original
          .replace("| Date | Target | Scope | Requirement IDs | Summary |", "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |")
          .replace("|---|---|---|---|---|", "|---|---|---|---|---|---|")
          .replace(
            "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |",
            `| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. | ${reportPath} |`
          ),
        "utf8"
      );

      const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(root)));
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "SRS-W024",
            filePath: "docs/spec/00.index.md"
          })
        ])
      );
      expect(result.errors).toHaveLength(0);
    }
  });

  it("preserves parser hardening diagnostics in validation output", async () => {
    const fixtures = [
      { name: "parser-hardening-duplicate-section", codes: ["SRS-E018"] },
      { name: "parser-hardening-nested-ac", codes: ["SRS-E019"] },
      { name: "parser-hardening-forbidden-heading-content", codes: ["SRS-E020"] },
      { name: "parser-hardening-malformed-tables", codes: ["SRS-E021", "SRS-W016", "SRS-W017"] }
    ];

    for (const fixture of fixtures) {
      const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(fixture.name))));
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(fixture.codes));
    }
  });

  it("reports index consistency and rollup drift diagnostics", async () => {
    const fixtures = [
      { name: "index-drift-duplicate-target", codes: ["SRS-E022"] },
      { name: "index-drift-duplicate-scope", codes: ["SRS-E023"] },
      { name: "index-drift-multiple-active-targets", codes: ["SRS-E024"] },
      { name: "index-drift-missing-scope-document", codes: ["SRS-E025"] },
      { name: "index-drift-unregistered-srs", codes: ["SRS-W018"] },
      { name: "index-drift-status-summary", codes: ["SRS-W019"] },
      { name: "index-drift-type-summary", codes: ["SRS-W020"] }
    ];

    for (const fixture of fixtures) {
      const result = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(fixture.name))));
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(fixture.codes));
    }
  });

  it("reports exact stability lifecycle diagnostics from focused fixtures", async () => {
    const fixtures = [
      { name: "stability-legacy-volatile", codes: ["SRS-W022"] },
      { name: "stability-invalid-unknown", codes: ["SRS-E011"] },
      { name: "stability-active-draft", codes: ["SRS-W023"] },
      { name: "stability-released-draft", codes: ["SRS-W023"] },
      { name: "stability-verified-draft", codes: ["SRS-E033"] },
      { name: "stability-frozen-missing", codes: ["SRS-W009"] },
      { name: "stability-frozen-explicit", codes: [] },
      { name: "stability-frozen-discarded", codes: [] }
    ];

    for (const fixture of fixtures) {
      await expect(diagnosticCodesForFixture(fixture.name)).resolves.toEqual(fixture.codes);
    }
  });
});
