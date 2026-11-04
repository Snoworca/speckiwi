import { describe, expect, it } from "vitest";
import { scanRequirementBlocks } from "../../src/core/parser/block-scanner.js";
import { addRequirement } from "../../src/core/mutation/add-requirement.js";
import { updateRequirementFields } from "../../src/core/mutation/edit-requirement.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

function ids(text: string): string[] {
  return scanRequirementBlocks(text.split("\n"), "docs/spec/10.x.srs.md").blocks.map((block) => block.heading.id);
}

function doc(...body: string[]): string {
  return ["# X", "", "## 4. Requirements", "", ...body, "", "## 5. Appendix", ""].join("\n");
}

const block = (id: string, ...lines: string[]) => [`### ${id} — Title ${id}`, "", "| Field | Value |", "| --- | --- |", "| Status | planned |", "", "#### Requirement", "", ...lines, ""];

describe("verify v5.2.0 r12 — classifyDocumentLines and the record boundaries", () => {
  // CommonMark: inside a top-level fenced code block every line is code until the closing fence; a
  // line starting with `>` there is not a block quote. HEAD's block-scanner kept the fence open.
  it("a `>` line inside a top-level fence does not end the fence", () => {
    const text = doc(
      ...block("FR-AAA-001", "Example:", "", "```md", "> quoted line in an example", "### FR-AAA-999 — Example only", "```"),
      ...block("FR-AAA-002", "Second.")
    );

    expect(ids(text)).toEqual(["FR-AAA-001", "FR-AAA-002"]);
  });

  // CommonMark 0.31 §4.6 type 2 ends on the line containing `-->`; `<!-->` contains it, so it is a
  // one-line comment. HEAD hid nothing here.
  it("a `<!-->` line is a complete comment and does not hide the requirements after it", () => {
    const text = doc(...block("FR-AAA-001", "<!-->", "Text."), ...block("FR-AAA-002", "Second."), ...block("FR-AAA-003", "<!-- note -->"));

    expect(ids(text)).toEqual(["FR-AAA-001", "FR-AAA-002", "FR-AAA-003"]);
  });

  // FR-NODE-174 AC-9: a prose field must not move a boundary of the block it is written into. The
  // guard refuses headings and fences; since the classifier hides HTML comment blocks, a bare `<!--`
  // line is a third boundary mover that passes it.
  it("a statement holding a `<!--` line cannot make a later requirement disappear", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));
    const added = await addRequirement(root, {
      scope: "ARCH",
      type: "functional",
      title: "Second",
      statement: "The flow goes A --> B.",
      target: "v1.0.0",
      acceptanceCriteria: ["Something."]
    });
    expect(added.ok).toBe(true);
    const secondId = (await parseWorkspace(root)).records.map((record) => record.id).find((id) => id !== "FR-ARCH-001")!;

    const edited = await updateRequirementFields(root, { id: "FR-ARCH-001", statement: "Ordinary.\n<!--\nmore" });

    const present = (await parseWorkspace(root)).records.some((record) => record.id === secondId);
    expect({ refused: !edited.ok, present }).not.toEqual({ refused: false, present: false });
  });
});
