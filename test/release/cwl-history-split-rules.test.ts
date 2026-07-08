import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (relPath: string): Promise<string> => readFile(relPath, "utf8");

// FR-FLOW-021: SRS-MD-Rules §7.4/§7.1 are amended in place (v3.0.0) for the Completed Work Log
// file split, with all repo rules pointers consistent at v3.0.0.
describe("FR-FLOW-021 Completed Work Log file-split rules amendment", () => {
  it("section 7.4 declares the dual-source rule, history file, banner, append-merge, and SRS-W025 dedup (AC-1, AC-2)", async () => {
    const rules = await read("docs/rule/SRS-MD-Rules-v3.0.0.md");
    expect(rules).toContain("91.completed-work-log.md");
    expect(rules).toContain("dual-read");
    expect(rules).toContain("SRS-W025");
    expect(rules).toContain("append-concatenation");
    expect(rules).toContain("read-only summary banner");
  });

  it("section 7.1 marks inline Completed Work Log rows optional while retaining the heading (AC-3)", async () => {
    const rules = await read("docs/rule/SRS-MD-Rules-v3.0.0.md");
    expect(rules).toContain("inline data row는 선택적이다");
  });

  it("all repo rules pointers reference v3.0.0, with no stale v1.0.0 pointer in the index (AC-4)", async () => {
    const claude = await read("CLAUDE.md");
    const appendix = await read("docs/spec/90.appendix.md");
    const index = await read("docs/spec/00.index.md");
    for (const doc of [claude, appendix, index]) {
      expect(doc).toContain("SRS-MD-Rules-v3.0.0.md");
    }
    expect(index).not.toContain("SRS-MD-Rules-v1.0.0.md");

    // kiwi skill rules pointers aligned to the same canonical version (no stale v1.0.0)
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
