import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { scaffoldScope } from "../../src/core/mutation/scaffold-scope.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function indexPath(rootPath: string): string {
  return path.join(rootPath, "docs", "spec", "00.index.md");
}

async function insertAfterPurpose(rootPath: string, block: string[]): Promise<void> {
  const lines = (await readFile(indexPath(rootPath), "utf8")).split(/\r?\n/);
  const purpose = lines.findIndex((line) => /^## 1\. Purpose/.test(line));
  lines.splice(purpose + 3, 0, "", ...block);
  await writeFile(indexPath(rootPath), lines.join("\n"), "utf8");
}

// CommonMark: a `<!--` that is code (tab-indented code block, a fence inside a block quote) or that
// starts mid-paragraph without a closing `-->` is not an HTML comment, so the real tables after it
// stay document text and every renderer shows them.
const COMMENT_OPENERS_THAT_ARE_NOT_COMMENTS: Record<string, string[]> = {
  "a tab-indented code line holding `<!--`": ["\t<!-- an example of a comment opener"],
  "a fence inside a block quote holding `<!--`": ["> ```html", "> <!-- an example of a comment opener", "> ```"],
  "an unclosed `<!--` in the middle of a paragraph line": ["Draft notes start with <!-- and are hidden by renderers."]
};

describe("verify r11: a `<!--` that is not a comment does not hide the real index tables", () => {
  for (const [shape, block] of Object.entries(COMMENT_OPENERS_THAT_ARE_NOT_COMMENTS)) {
    it(`scaffold-scope registers the scope after ${shape}`, async () => {
      const rootPath = await copyFixtureWorkspace("valid-basic");
      await insertAfterPurpose(rootPath, block);
      const root = await resolveProjectRoot(rootPath);
      const result = await scaffoldScope(root, { name: "Billing", prefix: "BILL", apply: true });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const after = await readFile(indexPath(rootPath), "utf8");
      expect(after.slice(after.lastIndexOf("## 4. Scope Map"))).toContain("| BILL |");
    });
  }
});

const SPEC = path.join("docs", "spec", "10.product-architecture.srs.md");

// A level-2 heading the writer skips (HTML comment, indented code) is still a section boundary for the
// record parser (block-scanner trims the line and has no comment state), so the writer appends the new
// block past a boundary only the parser sees and the new requirement is stranded outside the section.
const HIDDEN_LEVEL_TWO_HEADINGS: Record<string, string[]> = {
  "an HTML comment": ["<!--", "## 5. Draft Appendix", "-->"],
  "an indented code block": ["    ## 5. Draft Appendix"]
};

describe("verify r11: add_requirement and the record parser agree on where the Requirements section ends", () => {
  for (const [shape, block] of Object.entries(HIDDEN_LEVEL_TWO_HEADINGS)) {
    it(`the appended requirement is parsed when ${shape} at the end of the section holds a ## heading`, async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const file = path.join(rootPath, SPEC);
      const text = await readFile(file, "utf8");
      const newline = text.includes("\r\n") ? "\r\n" : "\n";
      await writeFile(file, `${text.replace(/(\r?\n)*$/, "")}${newline}${newline}${block.join(newline)}${newline}`, "utf8");
      const root = await resolveProjectRoot(rootPath);
      const result = await addRequirement(root, {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "Hidden boundary append",
        statement: "The new block must be parsed as a requirement.",
        acceptanceCriteria: ["it is parsed"]
      });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      const workspace = await parseWorkspace(root);
      const stranded = workspace.diagnostics.filter((d) => d.code === "SRS-W071").map((d) => d.message);
      expect(stranded, "the new block landed past a boundary only the parser sees").toEqual([]);
      expect(workspace.records.some((record) => record.title === "Hidden boundary append")).toBe(true);
    });
  }
});
