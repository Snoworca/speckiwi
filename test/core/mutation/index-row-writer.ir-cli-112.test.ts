import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { setActiveTarget } from "../../../src/core/mutation/set-active-target.js";
import { setTargetStatus } from "../../../src/core/mutation/set-target-status.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// IR-CLI-112 — the index writers next to the target rename: set_active_target and
// set_target_status rewrite the Active Target metadata row and Target Map rows through the shared
// row writer, so every table shape the index parser reads is written back the way it reads it:
// the parser reads the new values, and every other cell (other columns, extra columns, other rows)
// is left as it was. And a rename refuses a new name that is already in use anywhere the index
// parser would let it collide.

const INDEX = path.join("docs", "spec", "00.index.md");
const APPENDIX = path.join("docs", "spec", "90.appendix.md");

const SHAPES = ["plain", "compact", "no-trailing-pipe", "indented", "columns-reordered", "extra-column", "active-target-last", "compact-active-target-last"] as const;
type Shape = (typeof SHAPES)[number];

/** Rewrites the table that starts after `marker` into a shape the index parser still reads. */
function reshapeTable(text: string, marker: string, shape: Shape): string {
  const start = text.indexOf(marker);
  const end = text.indexOf("\n## ", start + marker.length);
  let seen = 0;
  const block = text
    .slice(start, end)
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|")) return line;
      const kind = seen === 0 ? "header" : seen === 1 ? "separator" : "row";
      seen += 1;
      const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
      switch (shape) {
        case "compact":
          return `|${cells.join("|")}|`;
        case "no-trailing-pipe":
          return kind === "row" ? `| ${cells.join(" | ")}` : line;
        case "indented":
          return `  ${line}`;
        case "columns-reordered":
          return `| ${[cells[1], cells[0], ...cells.slice(2)].join(" | ")} |`;
        case "extra-column":
          return `| ${[...cells, kind === "header" ? "Note" : kind === "separator" ? "---" : "keep-me"].join(" | ")} |`;
        default:
          return line;
      }
    })
    .join("\n");
  return text.slice(0, start) + block + text.slice(end);
}

async function shapedIndex(shape: Shape): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, INDEX);
  let text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  if (shape === "active-target-last") {
    text = text.replace("| Active Target | v1.0.0 |\n| Status | baseline |", "| Status | baseline |\n| Active Target | v1.0.0 |");
  } else if (shape === "compact-active-target-last") {
    text = text.replace("| Active Target | v1.0.0 |\n| Status | baseline |", "| Status | baseline |\n|Active Target|v1.0.0|");
  } else {
    text = reshapeTable(text, "| Field | Value |", shape);
    text = reshapeTable(text, "## 3. Target Map", shape);
  }
  await writeFile(file, text, "utf8");
  return rootPath;
}

async function readIndex(rootPath: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  const text = (await readFile(path.join(rootPath, INDEX), "utf8")).replace(/\r\n/g, "\n");
  return { index: workspace.index, text };
}

const keepMe = (text: string) => text.match(/keep-me/g)?.length ?? 0;

describe("IR-CLI-112 index writers write the rows the index parser reads", () => {
  // @req IR-CLI-112 AC-1
  it.each(SHAPES)("set_active_target moves the Active Target in a %s index", async (shape) => {
    const rootPath = await shapedIndex(shape);
    const before = await readIndex(rootPath);
    expect(before.index.activeTarget).toBe("v1.0.0");
    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v1.1.0" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await readIndex(rootPath);
    expect(after.index.activeTarget).toBe("v1.1.0");
    expect(after.index.targets.map((row) => `${row.target}:${row.type}:${row.status}:${row.description}`)).toEqual([
      "v1.0.0:release:planned:Fixture release",
      "v1.1.0:version:active:Next fixture target"
    ]);
    for (const [field, value] of Object.entries(before.index.metadata)) {
      if (field !== "Active Target") expect(after.index.metadata[field], field).toBe(value);
    }
    expect(keepMe(after.text)).toBe(keepMe(before.text));
  });

  // @req IR-CLI-112 AC-1
  it.each(SHAPES)("set_target_status records a status in a %s index", async (shape) => {
    const rootPath = await shapedIndex(shape);
    const before = await readIndex(rootPath);
    const result = await setTargetStatus(await resolveProjectRoot(rootPath), { target: "v1.1.0", status: "released" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await readIndex(rootPath);
    expect(after.index.targets.map((row) => `${row.target}:${row.type}:${row.status}:${row.description}`)).toEqual([
      "v1.0.0:release:active:Fixture release",
      "v1.1.0:version:released:Next fixture target"
    ]);
    expect(after.index.metadata).toEqual(before.index.metadata);
    expect(keepMe(after.text)).toBe(keepMe(before.text));
  });

  // @req IR-CLI-112 AC-1
  it("set_active_target creating a target writes its row by the Target Map's own header", async () => {
    const rootPath = await shapedIndex("columns-reordered");
    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v2.0.0", create: true, description: "Created row" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await readIndex(rootPath);
    expect(after.index.activeTarget).toBe("v2.0.0");
    expect(after.index.targets.find((row) => row.target === "v2.0.0")).toMatchObject({ type: "version", status: "active", description: "Created row" });
  });
});

/** The fixture with an extra goal heading, or Active Target, already using the name a rename would take. */
async function conflictFixture(edit: (index: string) => string, appendix?: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, INDEX);
  await writeFile(file, edit((await readFile(file, "utf8")).replace(/\r\n/g, "\n")), "utf8");
  if (appendix !== undefined) await writeFile(path.join(rootPath, APPENDIX), appendix, "utf8");
  return rootPath;
}

async function snapshot(rootPath: string): Promise<string[]> {
  const read = async (relative: string) => readFile(path.join(rootPath, relative), "utf8").catch(() => "");
  return Promise.all([INDEX, APPENDIX, path.join("docs", "spec", "10.product-architecture.srs.md")].map(read));
}

const GOAL = (target: string, goal: string) => `### Target: ${target}\n\n**Goal:** ${goal}\n\n`;

describe("IR-CLI-112 rename-target refuses a new name already in use", () => {
  const cases: { kind: string; to: string; setup: () => Promise<string>; mentions: RegExp }[] = [
    { kind: "Target Map row", to: "v1.1.0", setup: () => conflictFixture((t) => t), mentions: /Target Map/ },
    {
      kind: "goal heading in the index",
      to: "v1.0.9",
      setup: () => conflictFixture((t) => t.replace("## 4. Scope Map", `${GOAL("v1.0.0", "Ship the real work.")}${GOAL("v1.0.9", "Stale draft goal.")}## 4. Scope Map`)),
      mentions: /goal heading.*00\.index\.md/
    },
    {
      kind: "goal heading in the appendix",
      to: "v1.0.9",
      setup: () => conflictFixture((t) => t.replace("## 4. Scope Map", `${GOAL("v1.0.0", "Ship the real work.")}## 4. Scope Map`), `# Appendix\n\n${GOAL("v1.0.9", "Stale draft goal.")}`),
      mentions: /goal heading.*90\.appendix\.md/
    },
    {
      kind: "Active Target",
      to: "v1.0.9",
      setup: () => conflictFixture((t) => t.replace("| Active Target | v1.0.0 |", "| Active Target | v1.0.9 |")),
      mentions: /Active Target/
    }
  ];

  // @req IR-CLI-112 AC-2
  it.each(cases)("refuses when the new name is already a $kind, writing nothing", async ({ to, setup, mentions }) => {
    const rootPath = await setup();
    const before = await snapshot(rootPath);
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "v1.0.0", to, dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error?.message ?? "").toMatch(mentions);
    expect(await snapshot(rootPath)).toEqual(before);
  });
});

/** The fixture with the Target Map's `column` dropped from its header, separator and rows. */
async function targetMapWithout(column: "Description" | "Type"): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, INDEX);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  const start = text.indexOf("## 3. Target Map");
  const end = text.indexOf("\n## ", start + 1);
  let drop = -1;
  const block = text
    .slice(start, end)
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|")) return line;
      const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
      if (drop < 0) drop = cells.indexOf(column);
      return `| ${cells.filter((_, index) => index !== drop).join(" | ")} |`;
    })
    .join("\n");
  expect(drop).toBeGreaterThanOrEqual(0);
  await writeFile(file, text.slice(0, start) + block + text.slice(end), "utf8");
  return rootPath;
}

describe("IR-CLI-112 set_active_target --create and the Target Map's columns", () => {
  // @req IR-CLI-112 AC-1
  it("creates the target in a Target Map without the optional Description column", async () => {
    const rootPath = await targetMapWithout("Description");
    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v2.0.0", create: true, description: "Not recorded" });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await readIndex(rootPath);
    expect(after.index.activeTarget).toBe("v2.0.0");
    expect(after.index.targets.find((row) => row.target === "v2.0.0")).toMatchObject({ type: "version", status: "active" });
    expect(after.text).toContain("| v2.0.0 | version | active |");
  });

  // @req IR-CLI-112 AC-1
  it("refuses, naming the column and writing nothing, in a Target Map without the Type column", async () => {
    const rootPath = await targetMapWithout("Type");
    const before = (await readIndex(rootPath)).text;
    const result = await setActiveTarget(await resolveProjectRoot(rootPath), { target: "v2.0.0", create: true });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/Type/);
    expect((await readIndex(rootPath)).text).toBe(before);
  });
});
