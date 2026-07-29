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

  it("no packaged file names a rules version the tool does not ship", async () => {
    // skills/ and docs/rule/ both ship in the npm package, and a plain init removes every rules file
    // whose version is not the bundled one, so any surviving mention of an older version sends the
    // reader to a document that is not there. Both the file-path form (`SRS-MD-Rules-v1.0.0.md`) and
    // the prose form (`SRS-MD Authoring Rules v3.0.0`) count: a skill's rule table cites the latter.
    const { readdir } = await import("node:fs/promises");
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".md")) files.push(full);
      }
    };
    await walk("skills");
    await walk("docs/rule");
    expect(files.length).toBeGreaterThan(20);

    const bundledVersion = BUNDLED_SRS_RULES_FILENAME.replace(/^SRS-MD-Rules-v|\.md$/g, "");
    const offenders: string[] = [];
    for (const relPath of files) {
      const text = await read(relPath);
      const cited = new Set(
        [...text.matchAll(/(?:SRS|SDS)-MD(?:-Rules-v| Authoring Rules v)(\d+\.\d+\.\d+)/g)].map((match) => match[1]!)
      );
      for (const version of cited) if (version !== bundledVersion) offenders.push(`${relPath}: v${version}`);
    }
    expect(offenders).toEqual([]);
  });
});
