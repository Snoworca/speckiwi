import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BUNDLED_SRS_RULES_FILENAME } from "../../src/core/bootstrap/templates.js";

const read = (relPath: string): Promise<string> => readFile(relPath, "utf8");

// FR-FLOW-021: the authoring rules §7.4 / §7.1 carry the Completed Work Log file split, and every
// repository rules pointer names the same document. The document is now the bundled one at the
// shipped version (FR-NODE-087), so the assertions follow the constant rather than a literal.
describe("FR-FLOW-021 Completed Work Log file-split rules amendment", () => {
  it("section 7.4 declares the dual-source rule, history file, banner, append-merge, and SRS-W025 dedup (AC-1, AC-2)", async () => {
    const rules = await read(`docs/rule/${BUNDLED_SRS_RULES_FILENAME}`);
    expect(rules).toContain("91.completed-work-log.md");
    expect(rules).toContain("dual-read");
    expect(rules).toContain("SRS-W025");
    expect(rules).toContain("append-concatenation");
    expect(rules).toContain("read-only summary banner");
  });

  it("section 7.1 marks inline Completed Work Log rows optional while retaining the heading (AC-3)", async () => {
    const rules = await read(`docs/rule/${BUNDLED_SRS_RULES_FILENAME}`);
    expect(rules).toContain("its inline data rows are optional");
  });

  it("all repo rules pointers reference the bundled document, with no superseded pointer left (AC-4)", async () => {
    const appendix = await read("docs/spec/90.appendix.md");
    const index = await read("docs/spec/00.index.md");
    const claude = await read("CLAUDE.md");
    for (const doc of [appendix, index, claude]) {
      expect(doc).toContain(BUNDLED_SRS_RULES_FILENAME);
      const superseded = [...doc.matchAll(/(SRS-MD-Rules-v\d+\.\d+\.\d+\.md)/g)]
        .map((match) => match[1])
        .filter((name) => name !== BUNDLED_SRS_RULES_FILENAME);
      expect(superseded).toEqual([]);
    }

    // kiwi skill rules pointers aligned to the same canonical version.
    for (const variant of ["claude", "codex", "etc"]) {
      const skill = await read(`skills/${variant}/kiwi-srs/SKILL.md`);
      expect(skill).not.toContain("SRS-MD-Rules-v1.0.0.md");
      expect(skill).not.toContain("SRS-MD Authoring Rules v1.0.0");
    }
  });
});

// FR-FLOW-022: the agent workflow treats the Completed Work Log history file as a read-only summary,
// reaffirming the Requirement Block as the completion source of truth.
describe("FR-FLOW-022 agent workflow treats the history file as a read-only summary", () => {
  it("CLAUDE.md names the history file as a read-only summary and reaffirms the Requirement Block SSOT", async () => {
    const claude = await read("CLAUDE.md");
    expect(claude).toContain("91.completed-work-log.md");
    expect(claude).toContain("read-only summary for agents");
    expect(claude).toContain("source of truth for completion");
  });
});
