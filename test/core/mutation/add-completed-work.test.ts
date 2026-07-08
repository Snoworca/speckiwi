import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-045 — addCompletedWork retargets new rows to the history file
// docs/spec/91.completed-work-log.md (never 00.index.md). A pre-existing external
// docs/spec/05.completed-work.md still takes precedence (FR-NODE-026). These tests exercise the
// history-file table lifecycle: append, table/section creation, canonical-section insertion +
// renumbering, CRLF preservation, and the five-to-six column Report Paths migration guards.
const historyPath = (root: string) => path.join(root, "docs", "spec", "91.completed-work-log.md");

const seedHistory = (rows: string[]) =>
  ["## 7. Completed Work Log", "", "| Date | Target | Scope | Requirement IDs | Summary |", "|---|---|---|---|---|", ...rows, ""].join("\n");

async function markArchImplemented(root: string): Promise<void> {
  const srsPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
  await writeFile(srsPath, (await readFile(srsPath, "utf8")).replace("| Status | planned |", "| Status | implemented |"), "utf8");
}

async function writeExternalCompletedWorkFile(root: string): Promise<string> {
  const externalPath = path.join(root, "docs", "spec", "05.completed-work.md");
  await writeFile(
    externalPath,
    [
      "# Completed Work",
      "",
      "## 1. Completed Work Log",
      "",
      "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
      "|---|---|---|---|---|---|",
      "| 2026-05-09 | v1.0.0 | ARCH | FR-ARCH-001 | Existing external completed row. | docs/reports/existing.md |"
    ].join("\n"),
    "utf8"
  );
  return externalPath;
}

describe("add completed work mutation", () => {
  it("appends a row to an existing history Completed Work Log table", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await markArchImplemented(root);
    await writeFile(historyPath(root), seedHistory(["| 2026-05-01 | v1.0.0 | ARCH | FR-ARCH-001 | Seed row. |"]), "utf8");
    const indexBefore = await readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-05-10",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      summary: "Completed work mutation added."
    });

    expect(result).toMatchObject({ ok: true, value: { written: true, reportPaths: [] } });
    expect(result.value).toMatchObject({
      date: "2026-05-10",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      summary: "Completed work mutation added.",
      written: true,
      reportPaths: []
    });
    expect(result.patch).toMatchObject({ operations: 1, dryRun: false });
    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("| 2026-05-01 | v1.0.0 | ARCH | FR-ARCH-001 | Seed row. |");
    expect(history).toContain("| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Completed work mutation added. |");
    // 00.index.md is never touched by the retargeted mutation.
    await expect(readFile(path.join(root, "docs", "spec", "00.index.md"), "utf8")).resolves.toBe(indexBefore);
  });

  it("creates a table when the history heading exists without one", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await writeFile(historyPath(root), ["## 7. Completed Work Log", ""].join("\n"), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "Created missing completed work table." });

    expect(result.ok).toBe(true);
    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("| Date | Target | Scope | Requirement IDs | Summary |");
    expect(history).toContain("| 2026-05-10 |  |  |  | Created missing completed work table. |");
  });

  it("creates the section when it is missing from an existing history file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await writeFile(historyPath(root), ["## 1. Notes", "", "Existing history content.", ""].join("\n"), "utf8");
    const before = await readFile(historyPath(root), "utf8");

    const dryRun = await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "Created missing completed work section.", dryRun: true });

    expect(dryRun).toMatchObject({ ok: true, value: { written: false }, patch: { dryRun: true } });
    expect(dryRun.patch?.preview).toContain("| 2026-05-10 |  |  |  | Created missing completed work section. |");
    await expect(readFile(historyPath(root), "utf8")).resolves.toBe(before);

    await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "Created missing completed work section." });
    await expect(readFile(historyPath(root), "utf8")).resolves.toContain("## 7. Completed Work Log");
  });

  it("inserts before following canonical sections and renumbers them", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await writeFile(
      historyPath(root),
      [
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

    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("## 7. Completed Work Log");
    expect(history).toContain("## 8. Cross-scope Dependencies");
    expect(history).toContain("## 9. Open Questions");
    expect(history.indexOf("## 7. Completed Work Log")).toBeLessThan(history.indexOf("## 8. Cross-scope Dependencies"));
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

  it("preserves CRLF newline style in the history file", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await writeFile(historyPath(root), seedHistory(["| 2026-05-01 | v1.0.0 | ARCH | FR-ARCH-001 | Seed row. |"]).replace(/\n/g, "\r\n"), "utf8");

    await addCompletedWork(await resolveProjectRoot(root), { date: "2026-05-10", summary: "CRLF completed work row." });

    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("\r\n| 2026-05-10 |  |  |  | CRLF completed work row. |");
  });

  it("migrates a legacy history Completed Work Log table when report paths are provided", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await markArchImplemented(root);
    await writeFile(historyPath(root), seedHistory([]), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-05-10",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      summary: "Completed work mutation added report paths.",
      reportPaths: ["docs/reports/report-a.md", "docs/reports/report-a.md"]
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        written: true,
        reportPaths: ["docs/reports/report-a.md", "docs/reports/report-a.md"]
      },
      patch: { operations: 3, dryRun: false }
    });
    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("| Date | Target | Scope | Requirement IDs | Summary | Report Paths |");
    expect(history).toContain("|---|---|---|---|---|---|");
    expect(history).toContain("| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Completed work mutation added report paths. | docs/reports/report-a.md, docs/reports/report-a.md |");
  });

  it("treats null and empty report path arrays as no report paths for legacy tables", async () => {
    const nullRoot = await copyFixtureWorkspace("mutation-target");
    const emptyRoot = await copyFixtureWorkspace("mutation-target");

    await expect(
      addCompletedWork(await resolveProjectRoot(nullRoot), {
        date: "2026-05-10",
        summary: "Null report paths remain legacy.",
        reportPaths: null
      })
    ).resolves.toMatchObject({ ok: true, value: { reportPaths: [] } });
    await expect(readFile(path.join(nullRoot, "docs", "spec", "00.index.md"), "utf8")).resolves.not.toContain("Report Paths");

    await expect(
      addCompletedWork(await resolveProjectRoot(emptyRoot), {
        date: "2026-05-10",
        summary: "Empty report paths remain legacy.",
        reportPaths: []
      })
    ).resolves.toMatchObject({ ok: true, value: { reportPaths: [] } });
    await expect(readFile(path.join(emptyRoot, "docs", "spec", "00.index.md"), "utf8")).resolves.not.toContain("Report Paths");
  });

  it("preserves existing legacy rows while migrating to Report Paths", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await writeFile(historyPath(root), seedHistory(["| 2026-05-09 | v1.0.0 | ARCH | FR-ARCH-001 | Existing completed work row. |"]), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-05-10",
      summary: "Migrated with existing rows.",
      reportPaths: ["docs/reports/new.md"]
    });

    expect(result).toMatchObject({ ok: true, patch: { operations: 4 } });
    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("| 2026-05-09 | v1.0.0 | ARCH | FR-ARCH-001 | Existing completed work row. |  |");
    expect(history).toContain("| 2026-05-10 |  |  |  | Migrated with existing rows. | docs/reports/new.md |");
  });

  it("writes a blank Report Paths cell when a six-column history table already exists", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await writeFile(
      historyPath(root),
      [
        "## 7. Completed Work Log",
        "",
        "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
        "|---|---|---|---|---|---|",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-05-10",
      summary: "Six-column blank report paths cell."
    });

    expect(result).toMatchObject({ ok: true, value: { reportPaths: [] } });
    await expect(readFile(historyPath(root), "utf8")).resolves.toContain("| 2026-05-10 |  |  |  | Six-column blank report paths cell. |  |");
  });

  it("rejects invalid report paths without changing the index", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const before = await readFile(indexPath, "utf8");

    for (const reportPath of [
      "",
      "   ",
      "/absolute.md",
      "./local.md",
      "../escape.md",
      "docs/../escape.md",
      "https://example.com/report.md",
      String.raw`docs\report.md`,
      "docs/report|bad.md",
      "docs/report,extra.md",
      "docs/report\nbad.md",
      "docs/report#fragment.md"
    ]) {
      await expect(
        addCompletedWork(await resolveProjectRoot(root), {
          date: "2026-05-10",
          summary: "Invalid report path.",
          reportPaths: [reportPath]
        })
      ).resolves.toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
      await expect(readFile(indexPath, "utf8")).resolves.toBe(before);
    }
  });

  it("refuses to migrate malformed legacy history rows that would lose cells", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await writeFile(historyPath(root), seedHistory(["| 2026-05-09 | v1.0.0 | ARCH | FR-ARCH-001 | Existing summary | stray cell |"]), "utf8");
    const before = await readFile(historyPath(root), "utf8");

    await expect(
      addCompletedWork(await resolveProjectRoot(root), {
        date: "2026-05-10",
        summary: "Would migrate legacy table.",
        reportPaths: ["docs/reports/new.md"]
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    await expect(readFile(historyPath(root), "utf8")).resolves.toBe(before);
  });

  it("refuses non-trailing Report Paths columns before appending rows", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    await writeFile(
      historyPath(root),
      [
        "## 7. Completed Work Log",
        "",
        "| Date | Target | Scope | Report Paths | Requirement IDs | Summary |",
        "|---|---|---|---|---|---|",
        ""
      ].join("\n"),
      "utf8"
    );
    const before = await readFile(historyPath(root), "utf8");

    await expect(
      addCompletedWork(await resolveProjectRoot(root), {
        date: "2026-05-10",
        summary: "Non-trailing Report Paths header."
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    await expect(readFile(historyPath(root), "utf8")).resolves.toBe(before);
  });

  it("uses the same report path patch preview for dry-run and write modes", async () => {
    const dryRunRoot = await copyFixtureWorkspace("mutation-target");
    const writeRoot = await copyFixtureWorkspace("mutation-target");
    const input = {
      date: "2026-05-10",
      summary: "Previewed report path migration.",
      reportPaths: ["docs/reports/report.md"]
    };

    const dryRun = await addCompletedWork(await resolveProjectRoot(dryRunRoot), { ...input, dryRun: true });
    const write = await addCompletedWork(await resolveProjectRoot(writeRoot), input);

    expect(dryRun).toMatchObject({ ok: true, value: { written: false, reportPaths: ["docs/reports/report.md"] }, patch: { dryRun: true } });
    expect(write).toMatchObject({ ok: true, value: { written: true, reportPaths: ["docs/reports/report.md"] }, patch: { dryRun: false } });
    expect(write.patch?.preview).toEqual(dryRun.patch?.preview);
  });

  it("FR-NODE-026 writes new rows only to external Completed Work Log when present", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const externalPath = await writeExternalCompletedWorkFile(root);
    const indexPath = path.join(root, "docs", "spec", "00.index.md");
    const srsPath = path.join(root, "docs", "spec", "10.product-architecture.srs.md");
    await writeFile(srsPath, (await readFile(srsPath, "utf8")).replace("| Status | planned |", "| Status | implemented |"), "utf8");
    const beforeIndex = await readFile(indexPath, "utf8");

    const dryRun = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-05-10",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      summary: "External-only completed row.",
      reportPaths: ["docs/reports/external-only.md"],
      dryRun: true
    });

    expect(dryRun).toMatchObject({
      ok: true,
      value: { written: false },
      mutation: { filePath: "docs/spec/05.completed-work.md", dryRun: true, written: false },
      patch: { filePath: "docs/spec/05.completed-work.md", dryRun: true }
    });
    await expect(readFile(indexPath, "utf8")).resolves.toBe(beforeIndex);
    await expect(readFile(externalPath, "utf8")).resolves.not.toContain("External-only completed row.");

    const written = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-05-10",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      summary: "External-only completed row.",
      reportPaths: ["docs/reports/external-only.md"]
    });

    expect(written).toMatchObject({
      ok: true,
      value: { written: true },
      mutation: { filePath: "docs/spec/05.completed-work.md", dryRun: false, written: true },
      patch: { filePath: "docs/spec/05.completed-work.md", dryRun: false }
    });
    await expect(readFile(indexPath, "utf8")).resolves.toBe(beforeIndex);
    await expect(readFile(externalPath, "utf8")).resolves.toContain("| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | External-only completed row. | docs/reports/external-only.md |");
  });
});
