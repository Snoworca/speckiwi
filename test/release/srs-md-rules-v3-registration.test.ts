import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (relPath: string) => readFile(relPath, "utf8");

// FR-FLOW-013: SRS-MD-Rules is promoted to v3.0.0 (version aligned to the product target),
// registering checked_compatible and the compatibility Notes grammar, with all pointers aligned to v3.0.0.
describe("FR-FLOW-013 SRS-MD-Rules v3.0.0 registration", () => {
  it("rules v3.0.0 declares checked_compatible and the compatibility-cache section (AC-1, AC-2)", async () => {
    const rules = await read("docs/rule/SRS-MD-Rules-v3.0.0.md");
    expect(rules).toContain("# SRS-MD Authoring Rules v3.0.0");
    expect(rules).toContain("`checked_compatible`");
    expect(rules).toContain("### 23.5 checked_compatible");
    expect(rules).toContain("semanticSha");
    expect(rules).toContain("checked-at");
    // self-reference consistency: the file names itself, not v1.x
    expect(rules).toContain("docs/rule/SRS-MD-Rules-v3.0.0.md");
  });

  it("appendix Rules row points at v3.0.0 (AC-3)", async () => {
    const appendix = await read("docs/spec/90.appendix.md");
    expect(appendix).toContain("SRS-MD-Rules-v3.0.0.md");
    expect(appendix).not.toContain("[SRS-MD Authoring Rules v1.1.0](../rule/SRS-MD-Rules-v1.1.0.md)");
  });

  it("kiwi-srs allowlists list checked_compatible across agent variants (AC-4)", async () => {
    for (const variant of ["claude", "codex", "etc"]) {
      const skill = await read(`skills/${variant}/kiwi-srs/SKILL.md`);
      expect(skill).toContain("checked_compatible");
    }
  });

  it("repo CLAUDE.md Rules pointer references v3.0.0 (AC-5)", async () => {
    const claude = await read("CLAUDE.md");
    expect(claude).toContain("docs/rule/SRS-MD-Rules-v3.0.0.md");
  });
});
