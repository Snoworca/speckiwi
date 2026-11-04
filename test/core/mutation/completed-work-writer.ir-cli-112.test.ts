import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addCompletedWork } from "../../../src/core/mutation/add-completed-work.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-112 — the Completed Work Log is an index table: add_completed_work appends its row by the
// table's own header, so a log whose columns are in another order (with or without the trailing
// Report Paths column) records the date under Date, the target under Target, and so on, the way the
// parser reads them. add_completed_work writes the split history file (or the external log when
// present), never the index's inline section, so these logs are where the column order matters.

const LOGS = [
  { log: "history", file: path.join("docs", "spec", "91.completed-work-log.md") },
  { log: "external", file: path.join("docs", "spec", "05.completed-work.md") }
] as const;

const HEADERS = {
  "five columns, reordered": ["Target", "Date", "Summary", "Scope", "Requirement IDs"],
  "six columns, reordered": ["Summary", "Target", "Date", "Scope", "Requirement IDs", "Report Paths"]
} as const;

function seed(header: readonly string[]): string {
  const values: Record<string, string> = { Date: "2026-01-01", Target: "v1.0.0", Scope: "ARCH", "Requirement IDs": "FR-ARCH-001", Summary: "Seed row.", "Report Paths": "" };
  return [
    "## 7. Completed Work Log",
    "",
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    `| ${header.map((column) => values[column]).join(" | ")} |`,
    ""
  ].join("\n");
}

const MATRIX = LOGS.flatMap((log) => Object.entries(HEADERS).map(([shape, header]) => ({ ...log, shape, header })));

describe("IR-CLI-112 add_completed_work appends by the log's own header", () => {
  // @req IR-CLI-112
  it.each(MATRIX)("$log log, $shape", async ({ file, header }) => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await writeFile(path.join(rootPath, file), seed(header), "utf8");
    const root = await resolveProjectRoot(rootPath);
    const result = await addCompletedWork(root, {
      date: "2026-06-06",
      target: "v1.1.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      allowIncomplete: true,
      summary: "Appended row."
    });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    const entries = (await parseWorkspace(root)).index.completedWork.map((entry) => `${entry.date}|${entry.target}|${entry.scope}|${entry.requirementIds.join(",")}|${entry.summary}`);
    expect(entries).toContain("2026-01-01|v1.0.0|ARCH|FR-ARCH-001|Seed row.");
    expect(entries).toContain("2026-06-06|v1.1.0|ARCH|FR-ARCH-001|Appended row.");
    // The header is left as it was.
    expect(await readFile(path.join(rootPath, file), "utf8")).toContain(`| ${header.join(" | ")} |`);
  });
});

// The log's own columns decide what a row can hold: Report Paths may be left out (its value is then
// dropped), every other column holds a value the caller is told was recorded, so a log without one
// is refused, naming the column, with nothing written.
describe("IR-CLI-112 add_completed_work on a log missing a column", () => {
  async function run(header: readonly string[], reportPaths?: string[]) {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, LOGS[0].file);
    await writeFile(file, ["## 7. Completed Work Log", "", `| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ""].join("\n"), "utf8");
    const before = await readFile(file, "utf8");
    const root = await resolveProjectRoot(rootPath);
    const result = await addCompletedWork(root, {
      date: "2026-06-06",
      target: "v1.1.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      allowIncomplete: true,
      summary: "Appended row.",
      ...(reportPaths ? { reportPaths } : {})
    });
    return { result, before, after: await readFile(file, "utf8"), root };
  }

  // @req IR-CLI-112
  it.each(["Date", "Target", "Scope", "Requirement IDs", "Summary"])("refuses a log without %s, writing nothing", async (missing) => {
    const header = ["Date", "Target", "Scope", "Requirement IDs", "Summary"].filter((column) => column !== missing);
    const { result, before, after } = await run(header);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error?.message ?? "").toContain(missing);
    expect(after).toBe(before);
  });

  // @req IR-CLI-112
  it("appends to a log without the optional Report Paths column", async () => {
    const { result, root } = await run(["Date", "Target", "Scope", "Requirement IDs", "Summary"]);
    expect(result.ok).toBe(true);
    const entries = (await parseWorkspace(root)).index.completedWork.map((entry) => `${entry.date}|${entry.target}|${entry.scope}|${entry.summary}`);
    expect(entries).toContain("2026-06-06|v1.1.0|ARCH|Appended row.");
  });
});

// Adding the Report Paths column to a log that has none appends one trailing cell to the header, the
// separator and every row: every column the log already has (a standard one in another order, or one of
// its own such as Owner) keeps its place and its values, byte for byte, and the new row is written by
// the extended header.
describe("IR-CLI-112 add_completed_work adds Report Paths at the end of the log as it stands", () => {
  const OWNER_LOG = [
    "## 7. Completed Work Log",
    "",
    "| Target | Date | Scope | Requirement IDs | Summary | Owner |",
    "|:---|---|---|---|---|---|",
    "| v1.0.0 | 2026-11-01 | ARCH | FR-ARCH-001 | earlier | alice |",
    "| v1.0.0 | 2026-11-02 | ARCH |  | second | bob |",
    ""
  ];

  // @req IR-CLI-112
  it.each(LOGS)("$log log keeps its own columns, their order and their values", async ({ file }) => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    await writeFile(path.join(rootPath, file), OWNER_LOG.join("\n"), "utf8");
    const root = await resolveProjectRoot(rootPath);
    const result = await addCompletedWork(root, {
      date: "2026-11-04",
      target: "v1.1.0",
      scope: "ARCH",
      requirementIds: ["FR-ARCH-001"],
      reportPaths: ["docs/report.md"],
      allowIncomplete: true,
      summary: "probe"
    });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    const lines = (await readFile(path.join(rootPath, file), "utf8")).replace(/\r\n/g, "\n").split("\n");
    const at = lines.indexOf("## 7. Completed Work Log");
    expect(lines.slice(at + 2, at + 7)).toEqual([
      "| Target | Date | Scope | Requirement IDs | Summary | Owner | Report Paths |",
      "|:---|---|---|---|---|---|---|",
      "| v1.0.0 | 2026-11-01 | ARCH | FR-ARCH-001 | earlier | alice |  |",
      "| v1.0.0 | 2026-11-02 | ARCH |  | second | bob |  |",
      "| v1.1.0 | 2026-11-04 | ARCH | FR-ARCH-001 | probe |  | docs/report.md |"
    ]);
    const entries = (await parseWorkspace(root)).index.completedWork.map((entry) => `${entry.date}|${entry.target}|${entry.summary}|${entry.reportPaths.join(",")}`);
    expect(entries).toContain("2026-11-04|v1.1.0|probe|docs/report.md");
  });
});

describe("IR-CLI-112 Report Paths migration of a log whose rows leave out the trailing pipe", () => {
  // @req IR-CLI-112
  it("closes each row's last cell before adding the empty Report Paths cell", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, LOGS[0].file);
    const log = ["## 7. Completed Work Log", "", "| Date | Target | Scope | Requirement IDs | Summary | Owner", "|---|---|---|---|---|---", "| 2026-11-01 | v1.0.0 | ARCH | FR-ARCH-001 | earlier | alice", ""];
    await writeFile(file, log.join("\n"), "utf8");
    const root = await resolveProjectRoot(rootPath);
    const result = await addCompletedWork(root, { date: "2026-11-04", target: "v1.1.0", scope: "ARCH", requirementIds: [], reportPaths: ["docs/report.md"], allowIncomplete: true, summary: "probe" });
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    const lines = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").split("\n");
    expect(lines.slice(2, 5)).toEqual([
      "| Date | Target | Scope | Requirement IDs | Summary | Owner| Report Paths |",
      "|---|---|---|---|---|---|---|",
      "| 2026-11-01 | v1.0.0 | ARCH | FR-ARCH-001 | earlier | alice|  |"
    ]);
    const entries = (await parseWorkspace(root)).index.completedWork.map((entry) => `${entry.date}|${entry.summary}|${entry.reportPaths.join(",")}`);
    expect(entries).toEqual(expect.arrayContaining(["2026-11-01|earlier|", "2026-11-04|probe|docs/report.md"]));
  });
});
