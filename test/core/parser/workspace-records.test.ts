import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDiagnosticDefinition } from "../../../src/core/diagnostic-registry.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("workspace parser", () => {
  it("discovers SRS files and returns normalized records", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    expect(workspace.index.targets.map((target) => target.target)).toContain("v1.0.0");
    expect(workspace.index.activeTarget).toBe("v1.0.0");
    expect(workspace.index.metadata["Active Target"]).toBe("v1.0.0");
    expect(workspace.index.scopes.map((scope) => scope.prefix)).toContain("ARCH");
    expect(workspace.index.completedWork).toHaveLength(2);
    expect(workspace.index.completedWork[1]).toMatchObject({
      date: "2026-05-10",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      summary: "Fixture parser coverage completed."
    });
    expect(workspace.index.completedWork[1]?.line).toBeGreaterThan(0);
    expect(workspace.records.map((record) => record.id)).toContain("FR-ARCH-001");
    expect(JSON.parse(JSON.stringify(workspace.records[0]))).toHaveProperty("id");
  });

  it("parses Change Notes and ignores empty placeholder rows", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));
    const record = workspace.records.find((item) => item.id === "FR-ARCH-001");
    expect(record?.changeNotes).toEqual([
      expect.objectContaining({
        date: "2026-05-08",
        change: "Created",
        reason: "Fixture"
      })
    ]);
    expect(record?.changeNotes[0]?.line).toBeGreaterThan(0);

    const emptyRoot = await copyFixtureWorkspace("valid-basic");
    const srsPath = path.join(emptyRoot, "docs", "spec", "10.product-architecture.srs.md");
    await writeFile(
      srsPath,
      (await readFile(srsPath, "utf8")).replace("| 2026-05-08 | Created | Fixture |", "|  |  |  |"),
      "utf8"
    );
    const empty = await parseWorkspace(await resolveProjectRoot(emptyRoot));
    expect(empty.records.find((item) => item.id === "FR-ARCH-001")?.changeNotes).toEqual([]);
  });

  it("preserves explicit empty Active Target and only falls back for missing legacy rows", async () => {
    const emptyRoot = await copyFixtureWorkspace("valid-basic");
    const emptyIndexPath = path.join(emptyRoot, "docs", "spec", "00.index.md");
    await writeFile(emptyIndexPath, (await readFile(emptyIndexPath, "utf8")).replace("| Active Target | v1.0.0 |", "| Active Target |  |"), "utf8");
    const empty = await parseWorkspace(await resolveProjectRoot(emptyRoot));
    expect(empty.index.activeTarget).toBe("");

    const legacyRoot = await copyFixtureWorkspace("valid-basic");
    const legacyIndexPath = path.join(legacyRoot, "docs", "spec", "00.index.md");
    await writeFile(legacyIndexPath, (await readFile(legacyIndexPath, "utf8")).replace("| Active Target | v1.0.0 |\n", ""), "utf8");
    const legacy = await parseWorkspace(await resolveProjectRoot(legacyRoot));
    expect(legacy.index.activeTarget).toBe("v1.0.0");
  });

  it("treats missing or empty Completed Work Log tables as empty arrays", async () => {
    const missingRoot = await copyFixtureWorkspace("valid-basic");
    const missingIndexPath = path.join(missingRoot, "docs", "spec", "00.index.md");
    const missingOriginal = await readFile(missingIndexPath, "utf8");
    await writeFile(missingIndexPath, missingOriginal.replace(/\r?\n## 7\. Completed Work Log\r?\n\r?\n\| Date \| Target \| Scope \| Requirement IDs \| Summary \|\r?\n\|---\|---\|---\|---\|---\|\r?\n(?:\|.*\|\r?\n?)+/, "\n"), "utf8");
    const missing = await parseWorkspace(await resolveProjectRoot(missingRoot));
    expect(missing.index.completedWork).toEqual([]);

    const emptyRoot = await copyFixtureWorkspace("valid-basic");
    const emptyIndexPath = path.join(emptyRoot, "docs", "spec", "00.index.md");
    const emptyOriginal = await readFile(emptyIndexPath, "utf8");
    await writeFile(
      emptyIndexPath,
      emptyOriginal.replace(/\| 2026-05-09 \|.*\r?\n\| 2026-05-10 \|.*\r?\n/, ""),
      "utf8"
    );
    const empty = await parseWorkspace(await resolveProjectRoot(emptyRoot));
    expect(empty.index.completedWork).toEqual([]);
  });

  it("parses legacy and report-path Completed Work Log rows", async () => {
    const legacy = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    expect(legacy.index.completedWork).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Fixture parser coverage completed.",
          reportPaths: []
        })
      ])
    );

    const root = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    await writeFile(
      indexPath,
      original
        .replace("| Date | Target | Scope | Requirement IDs | Summary |", "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |")
        .replace("|---|---|---|---|---|", "|---|---|---|---|---|---|")
        .replace(
          "| 2026-05-09 |  | ARCH |  | Cross-target fixture setup completed. |",
          "| 2026-05-09 |  | ARCH |  | Cross-target fixture setup completed. |  |"
        )
        .replace(
          "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |",
          "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. | docs/reports/a.md, docs/reports/a.md, docs/reports/b.md |"
        ),
      "utf8"
    );

    const workspace = await parseWorkspace(await resolveProjectRoot(root));
    expect(workspace.index.completedWork).toEqual([
      expect.objectContaining({
        summary: "Cross-target fixture setup completed.",
        reportPaths: []
      }),
      expect.objectContaining({
        summary: "Fixture parser coverage completed.",
        reportPaths: ["docs/reports/a.md", "docs/reports/a.md", "docs/reports/b.md"]
      })
    ]);
  });

  it("only treats a trailing Report Paths column as completed-work report metadata", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    await writeFile(
      indexPath,
      original
        .replace("| Date | Target | Scope | Requirement IDs | Summary |", "| Date | Target | Scope | Report Paths | Requirement IDs | Summary |")
        .replace("|---|---|---|---|---|", "|---|---|---|---|---|---|")
        .replace(
          "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |",
          "| 2026-05-10 | v1.0.0 | ARCH | docs/reports/misplaced.md | FR-ARCH-001 | Fixture parser coverage completed. |"
        ),
      "utf8"
    );

    const workspace = await parseWorkspace(await resolveProjectRoot(root));
    expect(workspace.index.completedWork.find((entry) => entry.date === "2026-05-10")).toMatchObject({
      reportPaths: []
    });
  });

  it("keeps valid neighboring records when diagnostics are present", async () => {
    const root = await copyFixtureWorkspace("invalid-structure");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    expect(workspace.records.length).toBeGreaterThan(0);
    expect(workspace.diagnostics.length).toBeGreaterThan(0);
  });

  it("ignores requirement-like headings inside fenced code blocks", async () => {
    const root = await copyFixtureWorkspace("parser-hardening-code-fence-heading");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    expect(workspace.records.map((record) => record.id)).toEqual(["FR-ARCH-001"]);
    expect(workspace.diagnostics.map((item) => item.code)).not.toContain("SRS-E001");

    const tildeRoot = await copyFixtureWorkspace("parser-hardening-code-fence-heading");
    const tildeFile = path.join(tildeRoot, "docs", "spec", "10.product-architecture.srs.md");
    const tildeMarkdown = (await readFile(tildeFile, "utf8")).replace("```md", "~~~md").replace("```", "~~~");
    await writeFile(tildeFile, tildeMarkdown, "utf8");
    const tildeWorkspace = await parseWorkspace(await resolveProjectRoot(tildeRoot));

    expect(tildeWorkspace.records.map((record) => record.id)).toEqual(["FR-ARCH-001"]);
    expect(tildeWorkspace.diagnostics.map((item) => item.code)).not.toContain("SRS-E001");
  });

  it("ends the final requirement block before the next top-level section", async () => {
    const root = await copyFixtureWorkspace("parser-hardening-block-boundary");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));
    const record = workspace.records[0];

    expect(workspace.records.map((item) => item.id)).toEqual(["FR-ARCH-001"]);
    expect(record?.markdown).toContain("Block boundary baseline");
    expect(record?.markdown).not.toContain("## 5. Appendix");
    expect(record?.markdown).not.toContain("FR-ARCH-999");
  });

  it("keeps parser hardening fixture workspaces available for follow-up phases", async () => {
    const fixtures = [
      { name: "parser-hardening-code-fence-heading", codes: ["SRS-E001"] },
      { name: "parser-hardening-block-boundary", codes: ["SRS-E001"] },
      { name: "parser-hardening-duplicate-section", codes: ["SRS-E018"] },
      { name: "parser-hardening-nested-ac", codes: ["SRS-E019"] },
      { name: "parser-hardening-forbidden-heading-content", codes: ["SRS-E020"] },
      { name: "parser-hardening-malformed-tables", codes: ["SRS-E021", "SRS-W016", "SRS-W017"] }
    ];

    for (const fixture of fixtures) {
      const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace(fixture.name)));
      expect(workspace.files.map((file) => file.relativePath)).toContain("docs/spec/10.product-architecture.srs.md");
      if (!fixture.codes.includes("SRS-E001")) {
        expect(workspace.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(fixture.codes));
      }
      for (const code of fixture.codes) {
        expect(getDiagnosticDefinition(code).code).toBe(code);
      }
    }
  });

  it("reports FR-PARSE-012 structural diagnostics with actionable parser context", async () => {
    const duplicate = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("parser-hardening-duplicate-section")));
    expect(duplicate.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SRS-E018",
          filePath: "docs/spec/10.product-architecture.srs.md",
          line: 17,
          requirementId: "FR-ARCH-001",
          message: expect.stringContaining("FR-ARCH-001")
        })
      ])
    );

    for (const sectionName of ["Requirement", "Acceptance Criteria", "Verification Evidence", "Trace Links"]) {
      const root = await copyFixtureWorkspace("valid-basic");
      const srsPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
      const marker = `#### ${sectionName}`;
      await writeFile(
        srsPath,
        (await readFile(srsPath, "utf8")).replace(marker, `${marker}\n\nDuplicate section test body.\n\n${marker}`),
        "utf8"
      );
      const workspace = await parseWorkspace(await resolveProjectRoot(root));
      expect(workspace.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "SRS-E018", requirementId: "FR-ARCH-001" })])
      );
    }

    const fencedSectionRoot = await copyFixtureWorkspace("valid-basic");
    const fencedSectionPath = path.join(fencedSectionRoot, "docs", "spec", "10.product-architecture.srs.md");
    await writeFile(
      fencedSectionPath,
      (await readFile(fencedSectionPath, "utf8")).replace("SpecKiwi must parse this fixture requirement.", "```md\n```\t\n#### Requirement\n```\n\nSpecKiwi must parse this fixture requirement."),
      "utf8"
    );
    const fencedSection = await parseWorkspace(await resolveProjectRoot(fencedSectionRoot));
    expect(fencedSection.diagnostics.map((item) => item.code)).not.toContain("SRS-E018");

    const nested = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("parser-hardening-nested-ac")));
    expect(nested.records[0]?.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(["AC-1"]);
    expect(nested.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SRS-E019",
          filePath: "docs/spec/10.product-architecture.srs.md",
          line: 20,
          requirementId: "FR-ARCH-001",
          message: expect.stringContaining("AC-2")
        })
      ])
    );

    const fencedAcRoot = await copyFixtureWorkspace("valid-basic");
    const fencedAcPath = path.join(fencedAcRoot, "docs", "spec", "10.product-architecture.srs.md");
    await writeFile(
      fencedAcPath,
      (await readFile(fencedAcPath, "utf8")).replace("- [ ] AC-2: The requirement can be shown.", "```md\n```\t\n  - [ ] AC-2: fenced criterion\n```\n\n- [ ] AC-2: The requirement can be shown."),
      "utf8"
    );
    const fencedAc = await parseWorkspace(await resolveProjectRoot(fencedAcRoot));
    expect(fencedAc.diagnostics.map((item) => item.code)).not.toContain("SRS-E019");
    expect(fencedAc.records[0]?.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(["AC-1", "AC-2"]);

    const heading = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("parser-hardening-forbidden-heading-content")));
    expect(heading.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SRS-E020",
          filePath: "docs/spec/10.product-architecture.srs.md",
          line: 5,
          requirementId: "FR-ARCH-001",
          message: expect.stringContaining("FR-ARCH-001")
        })
      ])
    );

    for (const title of ["Heading with **bold**", "Heading with _italic_", "Heading with `code`", `Heading with ${String.fromCodePoint(0x2705)}`]) {
      const root = await copyFixtureWorkspace("valid-basic");
      const srsPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
      await writeFile(
        srsPath,
        (await readFile(srsPath, "utf8")).replace("### FR-ARCH-001 — Fixture requirement", `### FR-ARCH-001 — ${title}`),
        "utf8"
      );
      const workspace = await parseWorkspace(await resolveProjectRoot(root));
      expect(workspace.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "SRS-E020", requirementId: "FR-ARCH-001" })])
      );
    }

    const malformed = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("parser-hardening-malformed-tables")));
    expect(malformed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SRS-E021", filePath: "docs/spec/10.product-architecture.srs.md", line: 11, requirementId: "FR-ARCH-001" }),
        expect.objectContaining({ code: "SRS-W016", filePath: "docs/spec/10.product-architecture.srs.md", line: 25, requirementId: "FR-ARCH-001" }),
        expect.objectContaining({ code: "SRS-W017", filePath: "docs/spec/10.product-architecture.srs.md", line: 31, requirementId: "FR-ARCH-001" })
      ])
    );

    const separatorCases = [
      { code: "SRS-E021", search: "| Field | Value |\n| --- | --- |", replacement: "| Field | Value |\n| --- |" },
      {
        code: "SRS-W016",
        search: "| Evidence ID | Type | Reference | Covers | Notes |\n| --- | --- | --- | --- | --- |",
        replacement: "| Evidence ID | Type | Reference | Covers | Notes |\n| --- |"
      },
      {
        code: "SRS-W017",
        search: "| Type | Reference | Relation | Notes |\n| --- | --- | --- | --- |",
        replacement: "| Type | Reference | Relation | Notes |\n| --- |"
      }
    ];

    for (const item of separatorCases) {
      const root = await copyFixtureWorkspace("valid-basic");
      const srsPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
      await writeFile(srsPath, (await readFile(srsPath, "utf8")).replace(item.search, item.replacement), "utf8");
      const workspace = await parseWorkspace(await resolveProjectRoot(root));
      expect(workspace.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: item.code, requirementId: "FR-ARCH-001" })])
      );
    }
  });
});
