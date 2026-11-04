import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// add_requirement appends the new block at the end of the scope document's `## 4. Requirements`
// section, and the record parser decides where that section ends. Both read the section headings on
// body lines only (classifyDocumentLines), so a `## ` heading shown as an example can neither stand in
// for the section nor end it, and the appended block is parsed as a requirement. Each example below
// must come back byte for byte.

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

const HEADINGS = ["## 4. Requirements", "", "Example text.", "", "## 5. Example Appendix"];
const indent = (prefix: string) => HEADINGS.map((line) => (line === "" ? "" : `${prefix}${line}`));

const SHAPES: Record<string, string[]> = {
  "a fence": ["```markdown", ...HEADINGS, "```"],
  "a top-level fence holding `>` lines": ["```text", "> quoted line", ">>> repl prompt", ...HEADINGS, "```"],
  "a fence opened on a list item marker line": ["- ```markdown", ...indent("  "), "  ```"],
  "an HTML comment": ["<!--", ...HEADINGS, "-->"],
  "an indented code block": indent("    "),
  "a tab-indented code block": indent("\t"),
  "a fence inside a block quote": ["> ```markdown", ...HEADINGS.map((line) => (line === "" ? ">" : `> ${line}`)), "> ```"],
  // Unclosed structures hide nothing; they carry no heading, so the section still ends where it did.
  "unclosed structures": ["<!-->", "<!--->", "", "Draft notes start with <!-- and are hidden by renderers.", "", "<!-- never closed", "", "- ```text", "  never closed"]
};

/** Places the example before the real section, or at the end of it (after the last requirement). */
const PLACES: Record<string, (lines: string[]) => number> = {
  "before the real section": (lines) => lines.findIndex((line) => /^## 1\. Scope Overview/.test(line)),
  "at the end of the real section": (lines) => lines.length
};

describe("add_requirement appends a parsed requirement and leaves examples of headings alone", () => {
  for (const [shape, example] of Object.entries(SHAPES)) {
    for (const [place, at] of Object.entries(PLACES)) {
      it(`${shape}, ${place}`, async () => {
        const rootPath = await copyFixtureWorkspace("mutation-target");
        const file = path.join(rootPath, SPEC);
        const text = await readFile(file, "utf8");
        const newline = text.includes("\r\n") ? "\r\n" : "\n";
        const lines = text.replace(/(\r?\n)*$/, "").split(/\r?\n/);
        const position = at(lines);
        expect(position).toBeGreaterThan(0);
        lines.splice(position, 0, "", ...example, "");
        await writeFile(file, `${lines.join(newline)}${newline}`, "utf8");
        const root = await resolveProjectRoot(rootPath);

        const result = await addRequirement(root, {
          type: "functional",
          scope: "ARCH",
          target: "v1.0.0",
          title: "Fence-safe append",
          statement: "The new block must be parsed as a requirement.",
          acceptanceCriteria: ["it is parsed"]
        });

        expect(result.ok, JSON.stringify(result.error)).toBe(true);
        expect((await readFile(file, "utf8")).split(/\r?\n/).join("\n")).toContain(example.join("\n"));
        const workspace = await parseWorkspace(root);
        expect(workspace.diagnostics.filter((entry) => entry.code === "SRS-W071")).toEqual([]);
        expect(workspace.records.some((record) => record.title === "Fence-safe append")).toBe(true);
      });
    }
  }
});
