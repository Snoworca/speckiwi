import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/index.js";
import { classifyDocumentLines } from "../../../src/core/parser/document-lines.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-PARSE-050 — the shared classifier follows CommonMark for a blank-start list item and for a
// list item that would interrupt a paragraph, and the index parser reads a Scope Map cell's link as the
// shared link parser does.
//
// Measured on 5.3.8: `-` then a line indented six columns was body (CommonMark: indented code in the
// item), `paragraph` then `2.     code` was indented code (CommonMark: paragraph text), and a Scope Map
// cell with a titled link or a commented-out link before the real one raised SRS-E025 and SRS-W018.

function kinds(lines: string[]): string[] {
  return classifyDocumentLines(lines).map((line) => line.kind);
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function cli(root: string, argv: string[]): Promise<Run> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exit = await main(["--root", root, ...argv, "--json"], { stdout, stderr });
  const text = stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const INDEX = path.join("docs", "spec", "00.index.md");
const SCOPE_CELL = "[10.product-architecture.srs.md](./10.product-architecture.srs.md)";

async function workspaceWithScopeCell(cell: string): Promise<string> {
  const root = await copyFixtureWorkspace("mutation-target");
  const file = path.join(root, INDEX);
  const text = await readFile(file, "utf8");
  expect(text).toContain(SCOPE_CELL);
  // The fixture holds the cell in the SRS Documents table and in the Scope Map; both carry the form.
  await writeFile(file, text.split(SCOPE_CELL).join(cell), "utf8");
  return root;
}

function codes(payload: Record<string, unknown>): string[] {
  const value = (payload.value ?? payload) as { diagnostics?: Array<{ code: string }> };
  return (value.diagnostics ?? (payload.diagnostics as Array<{ code: string }> | undefined) ?? []).map((entry) => entry.code);
}

describe("FR-PARSE-050 AC-1 — a list item that starts blank holds indented code", () => {
  it.each([
    [["-", "      code line"]],
    [["*", "      code line"]],
    [["+", "      code line"]],
    [["1.", "       code line"]]
  ])("classifies the second line of %j as indented code", (lines) => {
    expect(kinds(lines)).toEqual(["body", "indented-code"]);
  });

  // CommonMark §5.2 (spec example 280): an item may begin with at most one blank line, so a second
  // blank line closes the empty item and what follows is read at the top level.
  it("closes an empty item at a blank line, as 5.3.8 read what follows", () => {
    expect(kinds(["-", "", "    code"])).toEqual(["body", "body", "indented-code"]);
    expect(kinds(["-", "", "  ```", "x", "```"])).toEqual(["body", "body", "fence", "fence", "fence"]);
  });

  it("keeps a line indented less than marker width plus five as body text of the item", () => {
    expect(kinds(["-", "  text"])).toEqual(["body", "body"]);
  });
});

describe("FR-PARSE-050 AC-2 — only an ordered item numbered 1 interrupts a paragraph", () => {
  it("reads `2.     code` after a paragraph as paragraph text", () => {
    expect(kinds(["paragraph", "2.     code"])).toEqual(["body", "body"]);
    expect(classifyDocumentLines(["paragraph", "2.     code"])[1]?.continuesParagraph).toBe(true);
  });

  it("still opens an item with `1.` there", () => {
    expect(kinds(["paragraph", "1.     code"])).toEqual(["body", "indented-code"]);
  });

  it("does not let an empty item interrupt a paragraph, so `text` then `-` stays a setext heading", () => {
    expect(kinds(["text", "-"])).toEqual(kinds(["text", "---"]));
    // Had `-` opened an empty item, the next line would continue it as text; after the heading it is code.
    expect(kinds(["text", "-", "    code"])).toEqual(["body", "body", "indented-code"]);
  });

  it("leaves a sibling item of an open list as it was", () => {
    expect(kinds(["1. a", "2.     code"])).toEqual(["body", "indented-code"]);
  });

  it("reports a link inside the AC-1 code as no link and the AC-2 text as a link, through links check", async () => {
    const root = await copyFixtureWorkspace("mutation-target");
    const file = path.join(root, INDEX);
    const text = await readFile(file, "utf8");
    await writeFile(file, `${text.trimEnd()}\n\n-\n      [in code](./missing-ac1.md)\n\nparagraph\n2.     [in text](./missing-ac2.md)\n`, "utf8");
    const run = await cli(root, ["links", "check"]);
    const report = JSON.stringify(run.payload);
    expect(report).toContain("missing-ac2.md");
    expect(report).not.toContain("missing-ac1.md");
  });
});

describe("FR-PARSE-050 AC-3 — a Scope Map cell's link is read by the shared link parser", () => {
  it.each([
    ['[10.product-architecture.srs.md](./10.product-architecture.srs.md "Architecture")'],
    ["<!-- [old](./09.old.srs.md) --> [10.product-architecture.srs.md](./10.product-architecture.srs.md)"]
  ])("validates %s without SRS-E025 or SRS-W018", async (cell) => {
    const root = await workspaceWithScopeCell(cell);
    const run = await cli(root, ["validate"]);
    expect(codes(run.payload)).not.toContain("SRS-E025");
    expect(codes(run.payload)).not.toContain("SRS-W018");
  });

  it("lets rename-scope find the scope behind a titled link", async () => {
    const root = await workspaceWithScopeCell('[10.product-architecture.srs.md](./10.product-architecture.srs.md "Architecture")');
    const run = await cli(root, ["rename-scope", "--from", "10.product-architecture", "--to", "10.product-arch", "--dry-run"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(JSON.stringify(run.payload)).not.toContain("SCOPE_RENAME_SOURCE_NOT_REGISTERED");
  });

  it("still reads a cell that holds no link as a whole", async () => {
    const root = await workspaceWithScopeCell("./10.product-architecture.srs.md");
    const run = await cli(root, ["validate"]);
    expect(codes(run.payload)).not.toContain("SRS-E025");
  });
});
