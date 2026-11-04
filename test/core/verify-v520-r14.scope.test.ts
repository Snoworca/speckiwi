import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { classifyDocumentLines } from "../../src/core/parser/document-lines.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function elapsedMs(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe("verify v5.2.0 r14 — classifier time and the append position", () => {
  // CommonMark 0.31 §4.6 (HTML blocks, start condition 2): a line starting with `<!--` opens an HTML
  // block that ends at the first line holding `-->`; where it ends is found by one forward scan, so a
  // CommonMark reader is linear in the document's length. The classifier instead re-scans to the end
  // of the enclosing container for every `<!--` line that never closes (document-lines.ts classifyDocumentLines, through
  // structureEnd), which is quadratic: measured 0.6 s at 2,000, 2.7 s at 4,000 and 13.2 s
  // at 8,000 quoted lines, against 8 ms for 8,000 lines of list-item fences. Every SRS read
  // (block-scanner, section-parser, ac-parser, index-parser, markdown-links) runs the classifier.
  // @req FR-NODE-233 AC-1
  it("classifies a block quote of 6,000 never-closed `<!--` lines in linear time", () => {
    const lines = Array.from({ length: 6000 }, (_, index) => `> <!-- draft note ${index}`);

    const ms = elapsedMs(() => classifyDocumentLines(lines));

    expect(ms).toBeLessThan(1000);
  }, 120_000);

  // Same cause at the top level, where each scan runs to the end of the document: 1.4 s at 8,000 lines.
  // @req FR-NODE-233 AC-1
  it("classifies 16,000 top-level never-closed `<!--` lines in linear time", () => {
    const lines = Array.from({ length: 16000 }, (_, index) => `<!-- draft note ${index}`);

    const ms = elapsedMs(() => classifyDocumentLines(lines));

    expect(ms).toBeLessThan(1000);
  }, 120_000);

  // CommonMark 0.31 §4.2: an ATX heading may be indented one to three spaces (the section's example
  // ` ### foo` / `  ## foo` / `   # foo` renders three headings), and the block scanner reads section
  // headings from the trimmed line (block-scanner.ts parseTopLevelSectionTitle, as FR-NODE-174 AC-9 records), so
  // ` ## 5. Appendix` ends the Requirements section. add_requirement looks for that end with
  // `lines[index]?.startsWith("## ")` (add-requirement.ts findRequirementsAppendLine), misses the indented heading and appends
  // the new block at the end of the file, inside the Appendix: the call reports ok and the parser drops
  // the record with SRS-W071. The list-item case is the same disagreement: the scanner takes the item's
  // `  ## 5. Sub` for a section boundary and the writer does not.
  const BOUNDARIES: Record<string, string[]> = {
    "a heading indented one space": [" ## 5. Appendix", "", "Notes."],
    "a heading indented three spaces": ["   ## 5. Appendix", "", "Notes."],
    "a heading inside a list item": ["- note", "  ## 5. Sub", "", "Notes."]
  };
  for (const [shape, example] of Object.entries(BOUNDARIES)) {
    // @req FR-NODE-233 AC-1
    it(`add_requirement appends a parsed requirement when the section ends at ${shape}`, async () => {
      const rootPath = await copyFixtureWorkspace("mutation-target");
      const file = path.join(rootPath, "docs", "spec", "10.product-architecture.srs.md");
      const lines = (await readFile(file, "utf8")).replace(/(\r?\n)*$/, "").split(/\r?\n/);
      await writeFile(file, [...lines, "", ...example, ""].join("\n"));
      const root = await resolveProjectRoot(rootPath);

      const result = await addRequirement(root, {
        type: "functional",
        scope: "ARCH",
        target: "v1.0.0",
        title: "Probe append",
        statement: "The new block must be parsed as a requirement.",
        acceptanceCriteria: ["it is parsed"]
      });

      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      const workspace = await parseWorkspace(root);
      expect(workspace.diagnostics.filter((entry) => entry.code === "SRS-W071")).toEqual([]);
      expect(workspace.records.some((record) => record.title === "Probe append")).toBe(true);
    });
  }
});
