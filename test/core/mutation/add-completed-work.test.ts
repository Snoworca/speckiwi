import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("add completed work mutation", () => {
  it("appends a row to an existing Completed Work Log table", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const srsPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    await writeFile(srsPath, (await readFile(srsPath, "utf8")).replace("| Status | planned |", "| Status | implemented |"), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-05-10",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      summary: "Completed work mutation added."
    });

    expect(result).toMatchObject({ ok: true, value: { written: true } });
    expect(result.patch).toMatchObject({ operations: 1, dryRun: false });
    await expect(readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).resolves.toContain(
      "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Completed work mutation added. |"
    );
  });

  it("creates a table when the section exists without one", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    await writeFile(indexPath, original.replace(/\n\| Date \| Target \| Scope \| Requirement IDs \| Summary \|\n\|---\|---\|---\|---\|---\|\n?/, "\n"), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "Created missing completed work table." });

    expect(result.ok).toBe(true);
    const index = await readFile(indexPath, "utf8");
    expect(index).toContain("| Date | Target | Scope | Requirement IDs | Summary |");
    expect(index).toContain("| 2026-05-10 |  |  |  | Created missing completed work table. |");
  });

  it("creates the section when it is missing", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    await writeFile(indexPath, original.replace(/\n## 5\. Completed Work Log\n\n\| Date \| Target \| Scope \| Requirement IDs \| Summary \|\n\|---\|---\|---\|---\|---\|\n?/, "\n"), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "Created missing completed work section.", dryRun: true });

    expect(result).toMatchObject({ ok: true, value: { written: false }, patch: { dryRun: true } });
    expect(result.patch?.preview).toContain("| 2026-05-10 |  |  |  | Created missing completed work section. |");
    await expect(readFile(indexPath, "utf8")).resolves.not.toContain("Created missing completed work section.");

    await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "Created missing completed work section." });
    await expect(readFile(indexPath, "utf8")).resolves.toContain("## 7. Completed Work Log");
  });

  it("inserts before following canonical sections and renumbers them", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const original = await readFile(indexPath, "utf8");
    await writeFile(
      indexPath,
      original.replace(/\n## 5\. Completed Work Log\n\n\| Date \| Target \| Scope \| Requirement IDs \| Summary \|\n\|---\|---\|---\|---\|---\|\n?/, "\n") +
        [
          "",
          "## 7. Cross-scope Dependencies",
          "",
          "| From | To | Relation | Notes |",
          "|---|---|---|---|",
          "",
          "## 8. Open Questions",
          ""
        ].join("\n"),
      "utf8"
    );

    await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "Inserted before canonical sections." });

    const index = await readFile(indexPath, "utf8");
    expect(index).toContain("## 7. Completed Work Log");
    expect(index).toContain("## 8. Cross-scope Dependencies");
    expect(index).toContain("## 9. Open Questions");
    expect(index.indexOf("## 7. Completed Work Log")).toBeLessThan(index.indexOf("## 8. Cross-scope Dependencies"));
  });

  it("rejects invalid dates and pipe-containing cells without changing the index", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");

    await expect(addCompletedWork(await resolveProjectRoot(root), { date: "2026/05/10", summary: "Invalid date." })).resolves.toMatchObject({ ok: false, error: { code: "USAGE" } });
    await expect(addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "Bad | summary." })).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" }
    });
    await expect(readFile(indexPath, "utf8")).resolves.toBe(before);
  });

  it("prevalidates references and requires an explicit incomplete override", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");

    await expect(
      addCompletedWork(await resolveProjectRoot(root), {
        date: "2026-05-10",
        target: "v9.9.9",
        scope: "MISSING",
        requirementIds: ["MISSING-ID"],
        summary: "Unknown references."
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W012" }), expect.objectContaining({ code: "SRS-W013" }), expect.objectContaining({ code: "SRS-W014" })])
    });

    await expect(
      addCompletedWork(await resolveProjectRoot(root), {
        date: "2026-05-10",
        requirementIds: ["FR-ARCH-001"],
        summary: "Incomplete requirement reference."
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "MUTATION_DENIED" },
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W015" })])
    });

    await expect(
      addCompletedWork(await resolveProjectRoot(root), {
        date: "2026-05-10",
        requirementIds: ["FR-ARCH-001"],
        summary: "Intentional incomplete history.",
        allowIncomplete: true,
        dryRun: true
      })
    ).resolves.toMatchObject({ ok: true, value: { written: false }, patch: { dryRun: true } });
    await expect(readFile(indexPath, "utf8")).resolves.toBe(before);
  });

  it("preserves CRLF newline style", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    await writeFile(indexPath, (await readFile(indexPath, "utf8")).replace(/\r?\n/g, "\r\n"), "utf8");

    await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "CRLF completed work row." });

    const index = await readFile(indexPath, "utf8");
    expect(index).toContain("\r\n| 2026-05-10 |  |  |  | CRLF completed work row. |");
  });
});
