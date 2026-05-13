import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { listCompletedWork } from "../../../src/core/query/completed-work.js";
import { summarizeTarget } from "../../../src/core/query/summary.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

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
});
