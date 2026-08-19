import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectLocationCitations,
  extractLocationCitations,
  formatLocationCitations
} from "../support/location-citations.js";

// @req FR-FLOW-141 — comments do not cite locations by absolute line number.
//
// Measured rather than argued: stamping the FR-FLOW-137 notice onto the research documents added
// four lines to each of them, and six comments citing the charter's prohibition on running
// `speckiwi init` against this repository silently came to point at the rules four lines above it.
// The whole suite stayed green. A number attached to a file is a claim that something unrelated
// cannot be edited, and this repository edits those files constantly.

const NUL = String.fromCharCode(0);
const REPO_ROOT = process.cwd();

/** The shipped variants of the instructions that tell an agent how to write a comment. */
const AUTHORING_SKILLS = [
  "skills/claude/kiwi-coder/SKILL.md",
  "skills/codex/kiwi-coder/SKILL.md",
  "skills/etc/kiwi-coder/SKILL.md",
  ".agents/skills/kiwi-coder/SKILL.md"
];

describe("FR-FLOW-141 AC-1 — the check finds a line-number citation and names where it is", () => {
  it("reports the citation with its file and line", () => {
    const found = extractLocationCitations("// see docs/rule/SRS-MD-Rules-v2.5.0.md:412 for the shape\n", "a.ts");
    expect(found).toEqual([{ file: "a.ts", line: 1, citation: "docs/rule/SRS-MD-Rules-v2.5.0.md:412" }]);
  });

  it("finds one written as a range, and one inside a block comment", () => {
    const found = extractLocationCitations("/**\n * see helper.ts:40-52\n */\n", "b.ts");
    expect(found.map((entry) => entry.citation)).toEqual(["helper.ts:40-52"]);
  });

  it("reads a file a text search would skip", async () => {
    // A NUL byte ahead of the citation is what makes grep drop the whole file without a word.
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-cites-"));
    await writeFile(path.join(root, "binaryish.ts"), `const m = "${NUL}";\n// see SKILL.md:569\n`, "utf8");
    const found = await collectLocationCitations([root], { root });
    expect(found.map((entry) => entry.citation)).toEqual(["SKILL.md:569"]);
  });

  it("formats a report a reader can act on without searching", () => {
    expect(formatLocationCitations([{ file: "a.ts", line: 7, citation: "x.md:3" }])).toBe("a.ts:7 cites x.md:3");
  });
});

describe("FR-FLOW-141 AC-5 — a number that is data is not a citation", () => {
  it("ignores a line number the code reports rather than points at", () => {
    const prose = "// the parser reports line 42 and column 8, and the diagnostic carries both\n";
    expect(extractLocationCitations(prose, "a.ts")).toEqual([]);
  });

  it("ignores code, so a fixture or a parsed position is never flagged", () => {
    // Only comment lines are scanned. Forbidding the shape in code would make the rule unusable in
    // the parser and mutation tests, which are most of this suite.
    expect(extractLocationCitations('const at = "docs/spec/00.index.md:12";\n', "a.ts")).toEqual([]);
  });

  it("honours a same-line exemption and nothing wider", () => {
    const text = ["// keep SKILL.md:569 @cite-lint: ignore", "// but not helper.ts:12"].join("\n");
    expect(extractLocationCitations(text, "a.ts").map((entry) => entry.citation)).toEqual(["helper.ts:12"]);
  });
});

describe("FR-FLOW-141 AC-2 — the trees are clean, so the check cannot ship inert", () => {
  it("no comment under src/ or test/ cites a location by line number", async () => {
    const found = await collectLocationCitations([path.join(REPO_ROOT, "src"), path.join(REPO_ROOT, "test")], {
      root: REPO_ROOT
    });
    expect(formatLocationCitations(found), "a comment cites a line number that will move without it").toBe("");
  });
});

describe("FR-FLOW-141 AC-3/AC-4 — the rule tells an author what to write instead", () => {
  it.each(AUTHORING_SKILLS)("%s names the replacement forms", async (relPath) => {
    const text = await readFile(path.join(REPO_ROOT, relPath), "utf8");
    // Naming only the prohibition leaves an author with nothing to write, and an author with nothing
    // to write writes the prohibited thing.
    expect(text, "the rule against line-number citations is absent").toMatch(/줄번호|라인 번호/);
    for (const form of ["심볼", "헤딩", "@req"]) {
      expect(text, `the replacement form "${form}" is not offered`).toContain(form);
    }
  });

  it.each(AUTHORING_SKILLS)("%s forbids restating a count of an enumerated set", async (relPath) => {
    const text = await readFile(path.join(REPO_ROOT, relPath), "utf8");
    expect(text, "the rule against duplicating a count is absent").toMatch(/개수를 (?:다시 )?적지|개수 복제|개수를 옮겨 적/);
  });
});
