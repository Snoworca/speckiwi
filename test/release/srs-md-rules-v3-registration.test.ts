import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BUNDLED_RULES_VERSION, BUNDLED_SRS_RULES_FILENAME } from "../../src/core/bootstrap/templates.js";

const read = (relPath: string) => readFile(relPath, "utf8");

// FR-FLOW-013 registered `checked_compatible` and the compatibility Notes grammar in the authoring
// rules and required every repository pointer to name the same rules document.
//
// FR-NODE-087 made the bundled document the one canonical rules document and moved it to 2.5.0, so
// the assertions below follow the shipped version constant instead of a literal. The substance is
// unchanged: the rules document declares the relation and its grammar, and every pointer agrees.
describe("FR-FLOW-013 rules registration of checked_compatible", () => {
  it("the bundled rules document declares checked_compatible and the compatibility-cache section (AC-1, AC-2)", async () => {
    const rules = await read(`docs/rule/${BUNDLED_SRS_RULES_FILENAME}`);
    expect(rules).toContain(`# SRS-MD Authoring Rules v${BUNDLED_RULES_VERSION}`);
    expect(rules).toContain("`checked_compatible`");
    expect(rules).toContain("### 23.5 checked_compatible");
    expect(rules).toContain("semanticSha");
    expect(rules).toContain("checked-at");
    // Self-reference consistency: the file names itself at its own version.
    expect(rules).toContain(`docs/rule/${BUNDLED_SRS_RULES_FILENAME}`);
  });

  it("the appendix Rules row points at the bundled document (AC-3)", async () => {
    const appendix = await read("docs/spec/90.appendix.md");
    expect(appendix).toContain(BUNDLED_SRS_RULES_FILENAME);
    // No superseded rules document is still named as a governing one.
    const superseded = [...appendix.matchAll(/\.\.\/rule\/(SRS-MD-Rules-v\d+\.\d+\.\d+\.md)/g)]
      .map((match) => match[1])
      .filter((name) => name !== BUNDLED_SRS_RULES_FILENAME);
    expect(superseded).toEqual([]);
  });

  it("kiwi-srs allowlists list checked_compatible across agent variants (AC-4)", async () => {
    for (const variant of ["claude", "codex", "etc"]) {
      const skill = await read(`skills/${variant}/kiwi-srs/SKILL.md`);
      expect(skill).toContain("checked_compatible");
    }
  });

  it("every repository pointer names the bundled document, including the agent files (AC-5)", async () => {
    // The agent files are the first thing a human or an agent reads, and their rules pointer sits
    // outside the managed block, so no init repairs it. A pointer at a document the tool deleted is
    // an ENOENT on the first instruction in the repository.
    for (const relPath of ["docs/spec/00.index.md", "docs/spec/90.appendix.md", "CLAUDE.md", "AGENTS.md"]) {
      const text = await read(relPath);
      expect(text, relPath).toContain(BUNDLED_SRS_RULES_FILENAME);
      const superseded = [...text.matchAll(/(SRS-MD-Rules-v\d+\.\d+\.\d+\.md)/g)]
        .map((match) => match[1])
        .filter((name) => name !== BUNDLED_SRS_RULES_FILENAME);
      expect(superseded, relPath).toEqual([]);
    }
  });

  it("no shipped skill points at a rules document that init prunes", async () => {
    // skills/ ships in the npm package, and a plain init removes every rules file whose version is
    // not the bundled one, so a skill naming an older document sends the agent to a missing file.
    const variants = ["claude", "codex", "etc"] as const;
    const skills = ["kiwi-srs", "kiwi-srs-from-code", "kiwi-pipeline"] as const;
    for (const variant of variants) {
      for (const skill of skills) {
        const relPath = `skills/${variant}/${skill}/SKILL.md`;
        const superseded = [...(await read(relPath)).matchAll(/(SRS-MD-Rules-v\d+\.\d+\.\d+\.md)/g)]
          .map((match) => match[1])
          .filter((name) => name !== BUNDLED_SRS_RULES_FILENAME);
        expect(superseded, relPath).toEqual([]);
      }
    }
  });
});
