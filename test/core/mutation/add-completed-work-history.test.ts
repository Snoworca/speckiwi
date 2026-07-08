import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const posix = (p: string) => p.replace(/\\/g, "/");
const HISTORY_SEG = ["docs", "spec", "91.completed-work-log.md"] as const;
const HISTORY_REL = "docs/spec/91.completed-work-log.md";
const indexPath = (root: string) => path.join(root, "docs", "spec", "00.index.md");
const historyPath = (root: string) => path.join(root, ...HISTORY_SEG);

const seedHistory = (rows: string[]) =>
  ["## 7. Completed Work Log", "", "| Date | Target | Scope | Requirement IDs | Summary |", "|---|---|---|---|---|", ...rows, ""].join("\n");

// FR-NODE-045: addCompletedWork appends new rows to docs/spec/91.completed-work-log.md instead of
// 00.index.md, bootstrapping the file (heading + read-only banner + table header) when absent,
// while retaining prevalidation and the Report Paths five-to-six column migration.
describe("FR-NODE-045 add_completed_work retarget + bootstrap", () => {
  it("bootstraps the history file with heading, read-only banner, and table header when absent (AC-1, AC-2)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const indexBefore = await readFile(indexPath(root), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-06-06",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      allowIncomplete: true,
      summary: "History retarget smoke."
    });
    expect(result.ok).toBe(true);
    expect(posix(result.patch!.filePath).endsWith(HISTORY_REL)).toBe(true);

    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("## 7. Completed Work Log");
    expect(history.toLowerCase()).toContain("not a source of truth"); // read-only banner
    expect(history).toContain("| Date | Target | Scope | Requirement IDs | Summary |");
    expect(history).toContain("History retarget smoke.");

    // AC-1: 00.index.md is not touched
    expect(await readFile(indexPath(root), "utf8")).toBe(indexBefore);

    // bootstrapped file round-trips through the dual-read parser (banner placement is parser-safe)
    const ws = await parseWorkspace(await resolveProjectRoot(root));
    const entry = ws.index.completedWork.find((e) => e.summary === "History retarget smoke.");
    expect(entry).toBeDefined();
    expect(posix(entry!.sourceFile!)).toBe(HISTORY_REL);
  });

  it("appends to an existing history file rather than 00.index.md (AC-1)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeFile(historyPath(root), seedHistory(["| 2026-05-01 | v1.0.0 | ARCH | FR-ARCH-001 | Seed row. |"]), "utf8");
    const indexBefore = await readFile(indexPath(root), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-06-06",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      allowIncomplete: true,
      summary: "Second history row."
    });
    expect(result.ok).toBe(true);

    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("Seed row.");
    expect(history).toContain("Second history row.");
    expect(await readFile(indexPath(root), "utf8")).toBe(indexBefore);
  });

  it("still runs reference prevalidation against the workspace (AC-3)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-06-06",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-NOPE-999"],
      summary: "Bad reference."
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics?.some((d) => d.code === "SRS-W014")).toBe(true);
    // no history file created on prevalidation failure
    expect(await access(historyPath(root)).then(() => true).catch(() => false)).toBe(false);
  });

  it("migrates a legacy five-column history table to six columns when report paths are supplied (AC-4)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await writeFile(historyPath(root), seedHistory(["| 2026-05-01 | v1.0.0 | ARCH | FR-ARCH-001 | Seed row. |"]), "utf8");

    const result = await addCompletedWork(await resolveProjectRoot(root), {
      date: "2026-06-06",
      target: "v1.0.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      allowIncomplete: true,
      summary: "Row with report.",
      reportPaths: ["docs/next/example.md"]
    });
    expect(result.ok).toBe(true);

    const history = await readFile(historyPath(root), "utf8");
    expect(history).toContain("Report Paths");
    expect(history).toContain("docs/next/example.md");
  });
});
