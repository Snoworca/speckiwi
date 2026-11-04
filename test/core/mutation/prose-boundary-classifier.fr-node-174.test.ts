import { describe, expect, it } from "vitest";
import { assertOpensNoBlockBoundary, assertPromotableBlock } from "../../../src/core/mutation/block-prose.js";
import { addRequirement } from "../../../src/core/mutation/add-requirement.js";
import { appendSectionNote } from "../../../src/core/mutation/append-section-note.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-174 AC-9: prose written into a requirement block must not move a boundary of the block. The
// guard asks the shared line classifier which lines open a structure, so every structure the readers
// hide (fences in any container, HTML comment blocks) is refused, and ordinary prose is not.

const MOVERS: Record<string, string> = {
  "a comment block opened at line start": "Ordinary.\n<!--\nmore",
  "an indented comment opener": "Ordinary.\n   <!-- note",
  "a fence opened on a list item marker line": "- ```text\n  code",
  "a fence inside a block quote": "> ```text",
  "a top-level fence": "Ordinary.\n```",
  "a balanced comment block": "<!--\nhidden\n-->"
};

const ORDINARY: Record<string, string> = {
  "an inline closed comment": "Before <!-- note --> after.",
  "an unclosed comment in the middle of a line": "Draft notes start with <!-- and are hidden by renderers.",
  "a list": "- one\n- two",
  "an indented code line": "Example:\n\n    code line",
  "inline code spans": "Use `<!--` or ``` `x` ``` inline."
};

describe("FR-NODE-174 AC-9 — the prose guard refuses what the classifier says moves a boundary", () => {
  for (const [shape, value] of Object.entries(MOVERS)) {
    // @req FR-NODE-174 AC-9
    it(`refuses ${shape}`, () => {
      expect(assertOpensNoBlockBoundary("text", value)?.ok).toBe(false);
    });
  }
  for (const [shape, value] of Object.entries(ORDINARY)) {
    // @req FR-NODE-174 AC-9
    it(`accepts ${shape}`, () => {
      expect(assertOpensNoBlockBoundary("text", value)).toBeUndefined();
    });
  }

  // @req FR-NODE-174 AC-9
  it("a refused comment payload leaves every requirement parsed", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("valid-basic"));
    const added = await addRequirement(root, {
      scope: "ARCH",
      type: "functional",
      title: "Written after the carrier",
      statement: "Ordinary.",
      target: "v1.0.0",
      acceptanceCriteria: ["Something."]
    });
    expect(added.ok).toBe(true);
    const before = (await parseWorkspace(root)).records.map((record) => record.id).sort();

    const result = await appendSectionNote(root, { id: "FR-ARCH-001", section: "research", text: "Note.\n<!--\nunfinished" });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("HTML comment");
    expect((await parseWorkspace(root)).records.map((record) => record.id).sort()).toEqual(before);
  });

  // @req FR-NODE-174 AC-9
  it("a promoted block may carry a closed structure but not leave one open", () => {
    const head = "### FR-ARCH-009 — Promoted\n\nText.";
    expect(assertPromotableBlock("block", `${head}\n<!--\nclosed\n-->`)).toBeUndefined();
    expect(assertPromotableBlock("block", `${head}\n<!--\nnever closed`)?.ok).toBe(false);
    expect(assertPromotableBlock("block", `${head}\n- \`\`\`text`)?.ok).toBe(false);
    expect(assertPromotableBlock("block", `${head}\n\`\`\`\ncode`)?.ok).toBe(false);
  });
});
