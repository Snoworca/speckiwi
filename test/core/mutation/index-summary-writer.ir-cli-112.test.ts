import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncIndexRollups } from "../../../src/core/mutation/sync-index.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-112 — every index table writer goes through the shared row writer, the rollup tables
// included: sync-index rewrites Status Summary and Requirement Type Summary rows by each table's own
// header, so a table whose columns are in another order, or carry an extra column, is written back
// the way the index parser reads it. The fixture holds one planned functional requirement.

const INDEX = path.join("docs", "spec", "00.index.md");
const SHAPES = ["plain", "count-first", "extra-column", "compact", "no-trailing-pipe"] as const;
type Shape = (typeof SHAPES)[number];

/** Renders a table (header first) in the given shape. */
function table(shape: Shape, header: string[], rows: string[][]): string {
  const order = shape === "count-first" ? [header.indexOf("Count"), ...header.map((_, index) => index).filter((index) => header[index] !== "Count")] : header.map((_, index) => index);
  const extra = (cells: string[], value: string) => (shape === "extra-column" ? [...cells, value] : cells);
  const render = (cells: string[], kind: "header" | "separator" | "row") => {
    const ordered = extra(order.map((index) => cells[index] ?? ""), kind === "header" ? "Note" : kind === "separator" ? "---" : "keep-me");
    if (shape === "compact") return `|${ordered.join("|")}|`;
    if (shape === "no-trailing-pipe" && kind === "row") return `| ${ordered.join(" | ")}`;
    return `| ${ordered.join(" | ")} |`;
  };
  return [render(header, "header"), render(header.map(() => "---"), "separator"), ...rows.map((row) => render(row, "row"))].join("\n");
}

async function rollupFixture(shape: Shape): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, INDEX);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").trimEnd();
  // Stale counts, plus a status the workspace has (planned) missing from its table.
  const status = table(shape, ["Status", "Count"], [["implemented", "3"]]);
  const type = table(shape, ["Type", "Prefix", "Count"], [["functional", "FR", "99"]]);
  await writeFile(file, `${text}\n\n## 6. Status Summary\n\n${status}\n\n## 7. Requirement Type Summary\n\n${type}\n`, "utf8");
  return rootPath;
}

describe("IR-CLI-112 sync-index writes rollup rows by each table's own header", () => {
  // @req IR-CLI-112 AC-1
  it.each(SHAPES)("rewrites and appends rollup rows in a %s table", async (shape) => {
    const rootPath = await rollupFixture(shape);
    const root = await resolveProjectRoot(rootPath);
    const before = (await readFile(path.join(rootPath, INDEX), "utf8")).match(/keep-me/g)?.length ?? 0;
    const result = await syncIndexRollups(root, {});
    expect(result.ok, JSON.stringify(result.ok ? "" : result.error)).toBe(true);
    const index = (await parseWorkspace(root)).index;
    expect(index.statusSummary?.map((entry) => `${entry.status}:${entry.count}`)).toEqual(["implemented:0", "planned:1"]);
    expect(index.requirementTypeSummary?.map((entry) => `${entry.type}:${entry.prefix}:${entry.count}`)).toEqual(["functional:FR:1"]);
    // Every line the parser points at is the row it read.
    const lines = (await readFile(path.join(rootPath, INDEX), "utf8")).replace(/\r\n/g, "\n").split("\n");
    for (const entry of index.statusSummary ?? []) expect(lines[(entry.line ?? 0) - 1]).toContain(entry.status);
    // Existing extra cells survive; an appended row leaves the extra column empty.
    expect((await readFile(path.join(rootPath, INDEX), "utf8")).match(/keep-me/g)?.length ?? 0).toBe(before);
  });
});

// A rollup table holds its key and Count columns; Prefix is the one column a Type Summary may leave out.
// The writer writes the columns a table has, drops a value for an optional column it lacks, and
// refuses, writing nothing, a table missing a column that holds the rollup itself.
describe("IR-CLI-112 sync-index on rollup tables missing a column", () => {
  async function withTables(statusTable: string, typeTable: string): Promise<string> {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, INDEX);
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").trimEnd();
    await writeFile(file, `${text}\n\n## 6. Status Summary\n\n${statusTable}\n\n## 7. Requirement Type Summary\n\n${typeTable}\n`, "utf8");
    return rootPath;
  }

  // @req IR-CLI-112 AC-1
  it("syncs a Type Summary without its optional Prefix column", async () => {
    const rootPath = await withTables("| Status | Count |\n|---|---:|\n| planned | 9 |", "| Type | Count |\n|---|---:|\n| functional | 9 |");
    const root = await resolveProjectRoot(rootPath);
    expect((await syncIndexRollups(root, {})).ok).toBe(true);
    const index = (await parseWorkspace(root)).index;
    expect(index.statusSummary?.map((entry) => `${entry.status}:${entry.count}`)).toEqual(["planned:1"]);
    expect(index.requirementTypeSummary?.map((entry) => `${entry.type}:${entry.count}`)).toEqual(["functional:1"]);
    expect(await readFile(path.join(rootPath, INDEX), "utf8")).toContain("| Type | Count |");
  });

  // @req IR-CLI-112 AC-1
  it.each([
    ["Status Summary without Count", "| Status | Note |\n|---|---|\n| planned | x |", "| Type | Prefix | Count |\n|---|---|---:|\n| functional | FR | 9 |", /Count/],
    ["Type Summary without Count", "| Status | Count |\n|---|---:|\n| planned | 9 |", "| Type | Prefix |\n|---|---|\n| functional | FR |", /Count/]
  ])("refuses a %s, naming the column and writing nothing", async (_name, statusTable, typeTable, column) => {
    const rootPath = await withTables(statusTable, typeTable);
    const before = await readFile(path.join(rootPath, INDEX), "utf8");
    const result = await syncIndexRollups(await resolveProjectRoot(rootPath), {});
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error?.message ?? "").toMatch(column);
    expect(await readFile(path.join(rootPath, INDEX), "utf8")).toBe(before);
  });
});

describe("IR-CLI-112 sync-index leaves correct rows alone", () => {
  // @req IR-CLI-112 AC-1
  it("reports no change and writes nothing when the only update is a dropped optional value", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, INDEX);
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").trimEnd();
    // Both counts are already right; the Type Summary has no Prefix column to fill.
    await writeFile(file, `${text}\n\n## 6. Status Summary\n\n| Status | Count |\n|---|---:|\n| planned | 1 |\n\n## 7. Requirement Type Summary\n\n| Type | Count |\n|---|---:|\n| functional | 1 |\n`, "utf8");
    const result = await syncIndexRollups(await resolveProjectRoot(rootPath), {});
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ written: false, statusSummaryChanged: false, typeSummaryChanged: false });
  });
});

describe("IR-CLI-112 sync-index fills an empty Prefix only with a prefix it knows", () => {
  // @req IR-CLI-112 AC-1
  it("leaves an unknown type's empty Prefix, and every correct row, unwritten", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, INDEX);
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").trimEnd();
    await writeFile(file, `${text}\n\n## 6. Status Summary\n\n| Status | Count |\n|---|---:|\n| planned | 1 |\n\n## 7. Requirement Type Summary\n\n| Type | Prefix | Count |\n|---|---|---:|\n| functional | FR | 1 |\n|custom||0|\n`, "utf8");
    const before = await readFile(file, "utf8");
    const result = await syncIndexRollups(await resolveProjectRoot(rootPath), {});
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ written: false, statusSummaryChanged: false, typeSummaryChanged: false });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  // @req IR-CLI-112 AC-1
  it("still fills a known type's empty Prefix", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, INDEX);
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").trimEnd();
    await writeFile(file, `${text}\n\n## 7. Requirement Type Summary\n\n| Type | Prefix | Count |\n|---|---|---:|\n| functional |  | 1 |\n`, "utf8");
    const result = await syncIndexRollups(await resolveProjectRoot(rootPath), {});
    expect(result.value).toMatchObject({ written: true, typeSummaryChanged: true });
    expect(await readFile(file, "utf8")).toContain("| functional | FR | 1 |");
  });
});
