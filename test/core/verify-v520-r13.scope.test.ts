import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanRequirementBlocks } from "../../src/core/parser/block-scanner.js";
import { renameScope } from "../../src/core/mutation/rename-scope.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function ids(text: string): string[] {
  return scanRequirementBlocks(text.split("\n"), "docs/spec/10.x.srs.md").blocks.map((block) => block.heading.id);
}

function doc(...body: string[]): string {
  return ["# X", "", "## 4. Requirements", "", ...body, "", "## 5. Appendix", ""].join("\n");
}

const block = (id: string, ...lines: string[]) => [`### ${id} — Title ${id}`, "", "| Field | Value |", "| --- | --- |", "| Status | planned |", "", "#### Requirement", "", ...lines, ""];

const OLD = "10.product-architecture.srs.md";

/** Inserts lines into the fixture index right after its `## 1. Purpose` paragraph, renames, returns the inserted lines after. */
async function renameWithIndexLines(inserted: string[]): Promise<{ ok: boolean; lines: string[] }> {
  const dir = await copyFixtureWorkspace("valid-basic");
  const indexPath = path.join(dir, "docs", "spec", "00.index.md");
  const lines = (await readFile(indexPath, "utf8")).split("\n");
  const at = lines.findIndex((line) => line === "Fixture index.") + 1;
  lines.splice(at, 0, "", ...inserted);
  await writeFile(indexPath, lines.join("\n"));
  const result = await renameScope(await resolveProjectRoot(dir), { from: "10.product-architecture", to: "10.product-core", apply: true });
  const after = (await readFile(indexPath, "utf8")).split("\n");
  return { ok: result.ok, lines: after.slice(at + 1, at + 1 + inserted.length) };
}

describe("verify v5.2.0 r13 — classifyDocumentLines against CommonMark containers", () => {
  // CommonMark 0.31 §5.2: a list marker is followed by spaces or a tab (spec example 7, `-\t\tfoo`).
  // The item below opens a fence on its marker line and closes it with `  ```` at the item's offset.
  // The classifier's list pattern takes spaces only, so it sees no item, takes the item's closing
  // fence for a new top-level fence that never closes, and hides every requirement after it.
  // Lead correction (round 13): the tab after `-` expands from column 1 to column 4, so the item's
  // content offset is 4, not 2. With 2-space continuation lines cmark-gfm itself ends the item and
  // opens an unclosed top-level fence, so the original premise was not CommonMark. The continuation
  // lines are indented to the item's real offset; the kept property is that a tab-separated marker
  // opens an item whose fence closes inside it.
  // @req FR-NODE-174 AC-9
  it("a fenced example opened after a tab-separated list marker does not hide the requirements after it", () => {
    const text = doc(
      ...block("FR-AAA-001", "Example:", "", "-\t```md", "    sample", "    ```"),
      ...block("FR-AAA-002", "Second."),
      ...block("FR-AAA-003", "Third.")
    );

    expect(ids(text)).toEqual(["FR-AAA-001", "FR-AAA-002", "FR-AAA-003"]);
  });

  // CommonMark §4.4: an indented code block may follow any block but a paragraph; a thematic break
  // is a block, so `    ## Notes` after `***` is code, and the classifier comment in document-lines.ts states the same
  // ("following a blank line, a heading or another block"). The classifier only lets code start after
  // a blank line or an ATX heading, so the scanner reads the code line as a `##` section, closes the
  // Requirements section there and drops the requirement after it.
  // @req FR-NODE-174 AC-9
  it("an indented `##` line right after a thematic break is code and does not end the Requirements section", () => {
    const text = doc(...block("FR-AAA-001", "Text.", "", "***", "    ## Notes"), ...block("FR-AAA-002", "Second."));

    expect(ids(text)).toEqual(["FR-AAA-001", "FR-AAA-002"]);
  });

  // CommonMark §5.1 and §2.2: after `> ` the tab starts at column 2 and reaches only column 4, two
  // columns of indentation, so the line is a paragraph holding a rendered link. The classifier strips
  // `> ` and expands the tab from column 0 to four columns, takes the line for indented code, and the
  // rename leaves the rendered link pointing at the old file.
  // @req FR-NODE-232 AC-1
  it("rewrites an index link on a block-quote line whose content is indented by a tab", async () => {
    const { ok, lines } = await renameWithIndexLines([">", `> \tSee [architecture](./${OLD}).`]);

    expect(ok).toBe(true);
    expect(lines[1]).not.toContain(OLD);
  });

  // CommonMark §5.2: `- > ```` is a list item holding a block quote that opens a fence; the second
  // line is code and the third closes the fence, so the fourth is a paragraph with a rendered link.
  // The classifier does not open the fence on the marker line (it looks for a fence after the list
  // marker but not after a quote marker), so it takes the closing `  > ```` for an opener and hides
  // the rendered link after it, which the rename then leaves pointing at the old file.
  // @req FR-NODE-232 AC-1
  it("rewrites the index link after a fenced example opened by a block quote on a list marker line", async () => {
    const { ok, lines } = await renameWithIndexLines(["- > ```md", "  > example", "  > ```", `  > See [architecture](./${OLD}).`]);

    expect(ok).toBe(true);
    expect(lines[3]).not.toContain(OLD);
  });
});
