import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { completedWorkReadModel, listCompletedWork } from "../../../src/core/query/completed-work.js";
import { summarizeTarget } from "../../../src/core/query/summary.js";
import { planCompletedWorkMigration } from "../../../src/core/completed-work/migration.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

async function removeIndexCompletedWorkRows(root: string): Promise<void> {
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const original = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    original.replace(
      "| 2026-05-09 |  | ARCH |  | Cross-target fixture setup completed. |\n| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |\n",
      ""
    ),
    "utf8"
  );
}

async function writeExternalCompletedWork(root: string): Promise<void> {
  await writeFile(
    path.join(root, "docs", "spec", "05.completed-work.md"),
    [
      "# Completed Work",
      "",
      "## 1. Completed Work Log",
      "",
      "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |",
      "|---|---|---|---|---|---|",
      "| 2026-06-29 | v1.0.0 | ARCH | FR-ARCH-001 | External work parsed. | docs/reports/external.md |"
    ].join("\n"),
    "utf8"
  );
}

async function appendIndexCompletedWorkRows(root: string, count: number): Promise<void> {
  const indexPath = path.join(root, "docs", "spec", "00.index.md");
  const original = await readFile(indexPath, "utf8");
  const rows = Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `| 2026-06-${day} | v1.0.0 | ARCH | FR-ARCH-001 | Generated summary row ${day}. |`;
  }).join("\n");
  await writeFile(indexPath, original.replace("| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |", `| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. |\n${rows}`), "utf8");
}

describe("completed work query", () => {
  it("filters by target, scope, since, and limit with latest ordering by default", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));

    expect(listCompletedWork(workspace)).toHaveLength(2);
    expect(listCompletedWork(workspace).map((entry) => entry.summary)).toEqual([
      "Fixture parser coverage completed.",
      "Cross-target fixture setup completed."
    ]);
    expect(listCompletedWork(workspace, { target: "v1.0.0" }).map((entry) => entry.summary)).toEqual([
      "Fixture parser coverage completed.",
      "Cross-target fixture setup completed."
    ]);
    expect(listCompletedWork(workspace, { target: "v1.0.0", order: "file" }).map((entry) => entry.summary)).toEqual([
      "Cross-target fixture setup completed.",
      "Fixture parser coverage completed."
    ]);
    expect(listCompletedWork(workspace, { target: "v9.0.0" }).map((entry) => entry.summary)).toEqual(["Cross-target fixture setup completed."]);
    expect(listCompletedWork(workspace, { scope: "ARCH", since: "2026-05-10", limit: 1 })).toEqual([
      expect.objectContaining({ summary: "Fixture parser coverage completed." })
    ]);
  });

  it("includes completed work in target summaries", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));

    expect(summarizeTarget(workspace, "v1.0.0").completedWork).toHaveLength(2);
    expect(summarizeTarget(workspace, "").completedWork).toHaveLength(2);
  });

  it("includes report paths in completed work query results", async () => {
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
          "| 2026-05-10 | v1.0.0 | ARCH | FR-ARCH-001 | Fixture parser coverage completed. | docs/reports/report.md |"
        ),
      "utf8"
    );
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    expect(listCompletedWork(workspace, { target: "v1.0.0", limit: 1 })).toEqual([
      expect.objectContaining({
        summary: "Fixture parser coverage completed.",
        reportPaths: ["docs/reports/report.md"]
      })
    ]);
    expect(summarizeTarget(workspace, "v1.0.0").completedWork[0]).toMatchObject({ reportPaths: ["docs/reports/report.md"] });
  });

  it("FR-PARSE-021 parses external completed work log by fixed path without an index link", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await removeIndexCompletedWorkRows(root);
    await writeExternalCompletedWork(root);

    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    expect(workspace.index.completedWork).toEqual([
      expect.objectContaining({
        date: "2026-06-29",
        target: "v1.0.0",
        scope: "ARCH",
        requirementIds: ["FR-ARCH-001"],
        summary: "External work parsed.",
        reportPaths: ["docs/reports/external.md"],
        filePath: "docs/spec/05.completed-work.md",
        line: 7
      })
    ]);
    expect(listCompletedWork(workspace, { target: "v1.0.0" }).map((entry) => entry.summary)).toEqual(["External work parsed."]);
  });

  it("FR-NODE-026 merges legacy and external completed work rows with source-aware rows", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeExternalCompletedWork(root);

    const workspace = await parseWorkspace(await resolveProjectRoot(root));
    const rows = listCompletedWork(workspace, { target: "v1.0.0", order: "file" });

    expect(rows.map((entry) => ({ summary: entry.summary, filePath: entry.filePath, line: entry.line }))).toEqual([
      expect.objectContaining({ summary: "Cross-target fixture setup completed.", filePath: "docs/spec/00.index.md", line: expect.any(Number) }),
      expect.objectContaining({ summary: "Fixture parser coverage completed.", filePath: "docs/spec/00.index.md", line: expect.any(Number) }),
      expect.objectContaining({ summary: "External work parsed.", filePath: "docs/spec/05.completed-work.md", line: expect.any(Number) })
    ]);
  });

  it("FR-NODE-026 bounds completed work rows in target summaries and exposes continuation metadata", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendIndexCompletedWorkRows(root, 30);
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    const summary = summarizeTarget(workspace, "v1.0.0");

    expect(summary.completedWork).toHaveLength(20);
    expect(summary.completedWorkPage).toEqual({
      total: 32,
      returned: 20,
      limit: 20,
      hasMore: true,
      nextOffset: 20
    });
  });

  it("FR-NODE-026 exposes a separate dry-run migration plan before historical rows move", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeExternalCompletedWork(root);
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    const plan = planCompletedWorkMigration(workspace, { dryRun: true });

    expect(plan).toMatchObject({
      kind: "completed_work_migration_plan",
      dryRun: true,
      sourceFilePath: "docs/spec/00.index.md",
      targetFilePath: "docs/spec/05.completed-work.md",
      rowCount: 2,
      written: false
    });
    expect(plan.rows.map((row) => row.filePath)).toEqual(["docs/spec/00.index.md", "docs/spec/00.index.md"]);
  });

  it("IR-CLI-037 FR-MCP-030 exposes completed-work source and continuation metadata", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeExternalCompletedWork(root);
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    const model = completedWorkReadModel(workspace, { target: "v1.0.0", limit: 1 });

    expect(model.completedWork).toEqual([
      expect.objectContaining({
        summary: "External work parsed.",
        filePath: "docs/spec/05.completed-work.md",
        line: expect.any(Number)
      })
    ]);
    expect(model.completedWorkPage).toEqual({ total: 3, returned: 1, limit: 1, hasMore: true, nextOffset: 1 });
    expect(model.completedWorkSource).toMatchObject({
      mode: "external",
      authoritativeFilePath: "docs/spec/05.completed-work.md",
      sources: expect.arrayContaining(["docs/spec/00.index.md", "docs/spec/05.completed-work.md"]),
      duplicateSources: true,
      migrationRecommended: true
    });
  });
});
