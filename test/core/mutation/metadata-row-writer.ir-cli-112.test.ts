import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_SRS_RULES_FILENAME } from "../../../src/core/bootstrap/templates.js";
import { renameTarget } from "../../../src/core/mutation/rename-target.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseMarkdownTable } from "../../../src/core/parser/table.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { METADATA_VALUE_CASES, STALE_RULES_LINK, type MetadataValueCase } from "./metadata-value-cases.ir-cli-112.js";

// IR-CLI-112 AC-3 — retarget, and every other metadata writer, edits the metadata table through one
// writer that reads and renders rows the way the parser does. Each caller runs against five table
// shapes the parser reads: the field it sets must read the new value afterwards, every other value
// and every extra cell must survive, and validate must report nothing the plain table would not.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");
const ID = "FR-ARCH-001";
const SHAPES = ["plain", "no-trailing-pipe", "indented", "compact", "value-first", "extra-column"] as const;
type Shape = (typeof SHAPES)[number];

/** Rewrites FR-ARCH-001's metadata table (header, separator and rows) into the given shape. */
function reshape(text: string, shape: Shape): string {
  const start = text.indexOf(`### ${ID}`);
  return reshapeTable(text, start, text.indexOf("#### Requirement", start), shape);
}

/** Rewrites the first table between `start` and `end` (header, separator and rows) into the given shape. */
function reshapeTable(text: string, start: number, end: number, shape: Shape): string {
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
        case "plain":
          return line;
        case "no-trailing-pipe":
          return kind === "row" ? `| ${cells.join(" | ")}` : line;
        case "indented":
          return `  ${line}`;
        case "compact":
          return `|${cells.join("|")}|`;
        case "value-first":
          return `| ${cells[1]} | ${cells[0]} |`;
        case "extra-column":
          return `| ${[...cells, kind === "header" ? "Note" : kind === "separator" ? "---" : "keep-me"].join(" | ")} |`;
      }
    })
    .join("\n");
  return text.slice(0, start) + block + text.slice(end);
}

async function shapedFixture(shape: Shape, field: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, SPEC);
  let text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  if (field === "Related Docs") text = text.replace("| Related Docs | - |", `| Related Docs | ${STALE_RULES_LINK} |`);
  await writeFile(file, reshape(text, shape), "utf8");
  await mkdir(path.join(rootPath, "docs", "rule"), { recursive: true });
  await writeFile(path.join(rootPath, "docs", "rule", BUNDLED_SRS_RULES_FILENAME), "# Rules\n", "utf8");
  return rootPath;
}

async function observe(rootPath: string): Promise<{ metadata: Record<string, string>; diagnostics: string[]; text: string }> {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  const metadata = workspace.records.find((record) => record.id === ID)?.metadata ?? {};
  const diagnostics = [...workspace.diagnostics, ...validateWorkspace(workspace).diagnostics].map((item) => item.code).sort();
  return { metadata, diagnostics, text: (await readFile(path.join(rootPath, SPEC), "utf8")).replace(/\r\n/g, "\n") };
}

/** Diagnostic codes present after the call that were not present before it. */
function added(before: string[], after: string[]): string[] {
  const pool = [...before];
  return after.filter((code) => {
    const at = pool.indexOf(code);
    if (at < 0) return true;
    pool.splice(at, 1);
    return false;
  });
}

async function runCase(shape: Shape, item: MetadataValueCase) {
  const rootPath = await shapedFixture(shape, item.field);
  const before = await observe(rootPath);
  await item.run(await resolveProjectRoot(rootPath));
  const after = await observe(rootPath);
  return { before, after, added: added(before.diagnostics, after.diagnostics) };
}

/** The Field of the last row in FR-ARCH-001's metadata table, read with the parser's table reader. */
function lastMetadataField(text: string): string | undefined {
  const lines = text.split("\n");
  const heading = lines.findIndex((line) => line.startsWith(`### ${ID}`));
  return parseMarkdownTable(lines, heading + 1)?.rows.at(-1)?.Field;
}

const MATRIX = SHAPES.filter((shape) => shape !== "plain").flatMap((shape) => METADATA_VALUE_CASES.map((item) => ({ shape, ...item })));

describe("IR-CLI-112 metadata writers agree with the parser on every table shape", () => {
  // @req IR-CLI-112 AC-3
  it.each(MATRIX)("$caller sets $field in a $shape metadata table", async ({ shape, ...item }) => {
    const shaped = await runCase(shape, item);
    // The parser read the table before the call, and reads the new value after it.
    expect(shaped.before.metadata.Status).toBe("planned");
    expect(shaped.after.metadata[item.field]).toContain(item.value);
    if (item.kind === "append") expect(shaped.after.metadata[item.field]).toContain(shaped.before.metadata[item.field]);
    // Every other metadata value is untouched.
    for (const [field, value] of Object.entries(shaped.before.metadata)) {
      if (field !== item.field) expect(shaped.after.metadata[field], field).toBe(value);
    }
    // A row the table lacked is appended after the last existing row, not slotted in among them.
    if (!(item.field in shaped.before.metadata)) expect(lastMetadataField(shaped.after.text)).toBe(item.field);
    // Extra cells survive the rewrite.
    const keep = (text: string) => text.match(/keep-me/g)?.length ?? 0;
    expect(keep(shaped.after.text)).toBe(keep(shaped.before.text));
    // validate reports nothing beyond what the same call adds to the plain table.
    const plain = await runCase("plain", item);
    expect(shaped.added).toEqual(plain.added);
  });
});

// IR-CLI-112 AC-3 — rows the parser reads cut short. The parser splits cells on every `|`, an escaped
// `\|` and a pipe inside a code span included, so the value it reads stops early. What a writer may do
// then depends on what it writes:
// - replace: sets the whole value and carries nothing over, so it writes, unless the table has columns
//   besides Field and Value that would be re-rendered from the cut cells, where it refuses;
// - append: derives the value from the cut one, so it refuses;
// - text-edit: rewrites a token in the row's own text, so it writes and the rest of the row survives.
// Every refusal reaches the caller's result (ok: false) and leaves the file byte for byte as it was.
const ESCAPED_VALUE = String.raw`[A \| B](a.md)`;
const CODE_SPAN_VALUE = "`a|b`";
const CUT_SHAPES = [
  // The escape adds a cell, so the row no longer has one cell per column (SRS-E021).
  { shape: "escaped", table: "plain", raw: ESCAPED_VALUE },
  // A pipe inside a code span does the same.
  { shape: "code-span", table: "plain", raw: CODE_SPAN_VALUE },
  // With an extra column the escape takes the Note cell's place, so only the escape shows the cut.
  { shape: "escaped+extra-column", table: "extra-column", raw: ESCAPED_VALUE }
] as const;

async function cutFixture(table: "plain" | "extra-column", field: string, raw: string): Promise<{ rootPath: string; row: string }> {
  const rootPath = await shapedFixture(table, "none");
  const file = path.join(rootPath, SPEC);
  const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  // Target keeps a parsed value of v1.0.0 (the cut text follows it as extra cells), so the target
  // commands still select the requirement; the cut lies in the same row either way.
  const value = field === "Related Docs" ? `${STALE_RULES_LINK}, ${raw}` : field === "Target" ? `v1.0.0 | ${raw}` : raw;
  const row = `| ${field} | ${value} |`;
  const existing = new RegExp(`^\\| ${field} \\| .*$`, "m").exec(text.slice(text.indexOf(`### ${ID}`)))?.[0];
  const next = existing ? text.replace(existing, row) : text.replace(/^(\| Related Docs \| .*)$/m, (line) => `${line}\n${row}`);
  await writeFile(file, next, "utf8");
  return { rootPath, row };
}

function expectation(kind: MetadataValueCase["kind"], table: "plain" | "extra-column"): "writes" | "refuses" {
  if (kind === "text-edit") return "writes";
  if (kind === "append") return "refuses";
  return table === "plain" ? "writes" : "refuses";
}

const CUT_MATRIX = CUT_SHAPES.flatMap((shape) => METADATA_VALUE_CASES.map((item) => ({ ...shape, ...item })));

describe("IR-CLI-112 metadata writers on rows the parser reads cut short", () => {
  // @req IR-CLI-112 AC-3
  it.each(CUT_MATRIX)("$caller ($kind) on $field in a $shape row", async ({ table, raw, kind, field, value, run }) => {
    const { rootPath, row } = await cutFixture(table, field, raw);
    const file = path.join(rootPath, SPEC);
    const before = await readFile(file, "utf8");
    expect(before).toContain(row);
    const result = (await run(await resolveProjectRoot(rootPath))) as { ok: boolean; error?: { message?: string } };
    const after = await readFile(file, "utf8");
    if (expectation(kind, table) === "refuses") {
      expect(result.ok).toBe(false);
      expect(result.error?.message ?? "").not.toBe("");
      expect(after).toBe(before);
      return;
    }
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const parsed = (await observe(rootPath)).metadata[field];
    expect(parsed).toContain(value);
    // A text edit keeps every part of the row it did not rename, the cut-off tail included.
    if (kind === "text-edit") expect(after).toContain(raw);
  });
});

// IR-CLI-112 AC-1 — the index's own metadata table: renaming the active target rewrites its Active
// Target row through the same writer, on every shape the parser reads. A row it cannot rewrite is a
// refusal, never a success that leaves the old name.
const INDEX = path.join("docs", "spec", "00.index.md");

/** The index with its metadata table (before the first `## ` section) in the given shape. */
async function indexFixture(shape: Shape, activeRow?: string): Promise<string> {
  const rootPath = await copyFixtureWorkspace("mutation-target");
  const file = path.join(rootPath, INDEX);
  let text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  text = reshapeTable(text, 0, text.indexOf("\n## "), shape);
  if (activeRow) text = text.replace(/^.*Active Target.*$/m, activeRow);
  await writeFile(file, text, "utf8");
  return rootPath;
}

async function indexMetadata(rootPath: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(rootPath));
  return { activeTarget: workspace.index.activeTarget, metadata: workspace.index.metadata };
}

describe("IR-CLI-112 rename-target rewrites the index Active Target row the parser reads", () => {
  // @req IR-CLI-112 AC-1
  it.each(SHAPES)("renames the Active Target in a %s index metadata table", async (shape) => {
    const rootPath = await indexFixture(shape);
    const before = await indexMetadata(rootPath);
    expect(before.activeTarget).toBe("v1.0.0");
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "v1.0.0", to: "v9.0.0", dryRun: false });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = await indexMetadata(rootPath);
    expect(after.activeTarget).toBe("v9.0.0");
    for (const [field, value] of Object.entries(before.metadata)) {
      if (field !== "Active Target") expect(after.metadata[field], field).toBe(value);
    }
    const text = await readFile(path.join(rootPath, INDEX), "utf8");
    if (shape === "extra-column") expect(text.match(/keep-me/g)?.length).toBe(5);
  });

  // @req IR-CLI-112 AC-1
  it("refuses, writing nothing, when the Active Target row cannot be rewritten whole", async () => {
    const rootPath = await indexFixture("extra-column", String.raw`| Active Target | v1.0.0 | a \| b |`);
    expect((await indexMetadata(rootPath)).activeTarget).toBe("v1.0.0");
    const before = await readFile(path.join(rootPath, INDEX), "utf8");
    const result = await renameTarget(await resolveProjectRoot(rootPath), { from: "v1.0.0", to: "v9.0.0", dryRun: false });
    expect(result.ok).toBe(false);
    expect(await readFile(path.join(rootPath, INDEX), "utf8")).toBe(before);
  });
});

describe("IR-CLI-112 rename-target rewrites a Target cell the parser reads at the end of a row", () => {
  // @req IR-CLI-112 AC-1
  it("renames a Target Map row whose Target column is last and has no closing pipe", async () => {
    const rootPath = await copyFixtureWorkspace("mutation-target");
    const file = path.join(rootPath, INDEX);
    const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    await writeFile(
      file,
      text
        .replace("| Target | Type | Status | Description |\n|---|---|---|---|", "| Type | Status | Description | Target |\n|---|---|---|---|")
        .replace("| v1.0.0 | release | active | Fixture release |", "| release | active | Fixture release | v1.0.0")
        .replace("| v1.1.0 | version | planned | Next fixture target |", "| version | planned | Next fixture target | v1.1.0 |"),
      "utf8"
    );
    const root = await resolveProjectRoot(rootPath);
    expect((await parseWorkspace(root)).index.targets.map((entry) => entry.target)).toEqual(["v1.0.0", "v1.1.0"]);
    const result = await renameTarget(root, { from: "v1.0.0", to: "v9.0.0", dryRun: false });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect((await parseWorkspace(root)).index.targets.map((entry) => entry.target)).toEqual(["v9.0.0", "v1.1.0"]);
  });
});
