import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_INSTRUCTION_HEADING_PREFIX, AGENT_INSTRUCTION_VERSION, renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";

// @req FR-FLOW-234 — user request 2026-11-20: code comments off keeps @req ("@req 를 남기고 코멘트만
// 꺼야합니다"). One shared contract states what off means; every code-writing skill cites it.

const repo = (file: string) => path.resolve(import.meta.dirname, "../..", file);
const read = async (file: string) => (await readFile(repo(file), "utf8")).replace(/\r\n/g, "\n");
const TREES = ["claude", "codex", "etc"] as const;
const CONTRACT = "_shared/kiwi/code-comments.md";

/** The body under the heading whose text carries `(marker)`, up to the next heading of the same level. */
function section(text: string, marker: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#{2,3}\s/.test(line) && line.includes(`(${marker})`));
  expect(start, `heading with (${marker})`).toBeGreaterThanOrEqual(0);
  const level = /^#+/.exec(lines[start] ?? "")?.[0].length ?? 2;
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s`).test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n");
}

describe("FR-FLOW-234 AC-1 AC-2 — the shared contract in each tree", () => {
  for (const tree of TREES) {
    // @req FR-FLOW-234 AC-1
    it(`${tree}: off omits explanatory comments and keeps the tags, the test citations and directives`, async () => {
      const text = await read(`skills/${tree}/${CONTRACT}`);
      expect(text).toContain("codeComments");
      expect(text).toContain("get_work_mode");
      const omit = section(text, "omit");
      for (const kind of ["JSDoc", "docstring", "TODO"]) expect(omit, kind).toContain(kind);
      expect(omit).not.toContain("@req");
      expect(omit).not.toContain("AC-<n>");
      const keep = section(text, "keep");
      for (const kept of ["@req", "kiwi-tdd", "<REQ-ID> AC-<n>", "eslint-disable", "shebang"]) expect(keep, kept).toContain(kept);
      // The @req bullet keeps the tag and says the tag line carries the tag only.
      const reqBullet = keep.split("\n").find((line) => line.includes("@req")) ?? "";
      expect(reqBullet).not.toMatch(/쓰지 않|not write|never write|omit/i);
    });

    // @req FR-FLOW-234 AC-2
    it(`${tree}: existing comments stay, a comment the change made untrue may be fixed, and on is unchanged`, async () => {
      const text = await read(`skills/${tree}/${CONTRACT}`);
      const korean = tree === "claude";
      const existing = section(text, "existing");
      expect(existing).toContain(korean ? "이미 있는 주석은 지우지 않는다" : "Existing comments are not removed");
      expect(existing).toContain(korean ? "그 주석만 고치거나 지울 수 있다" : "may be corrected or removed, that comment only");
      expect(section(text, "on")).toContain(korean ? "1절은 적용하지 않는다" : "section 1 does not apply");
    });
  }
});

describe("FR-FLOW-234 AC-3 — every code-writing skill reads the setting and cites the contract", () => {
  const SKILLS = ["kiwi-coder", "kiwi-tdd", "kiwi-hot-fix", "kiwi-bug-repro", "kiwi-step", "kiwi-review-fix-loop", "kiwi-orchestrator", "kiwi-wave-master"];
  for (const tree of TREES) {
    // @req FR-FLOW-234 AC-3
    it(`${tree}: the skills and the parallel-waves worker instruction cite it`, async () => {
      for (const skill of SKILLS) {
        const text = await read(`skills/${tree}/${skill}/SKILL.md`);
        expect(text, skill).toContain(CONTRACT);
        expect(text, skill).toContain("codeComments");
      }
      const waves = await read(`skills/${tree}/_shared/kiwi/parallel-waves.md`);
      expect(waves).toContain(CONTRACT);
    });

    // @req FR-FLOW-234 AC-3
    it(`${tree}: the review loop raises no missing-comment finding and its fixer adds none when off`, async () => {
      const text = await read(`skills/${tree}/kiwi-review-fix-loop/SKILL.md`);
      const line = text.split("\n").find((candidate) => candidate.includes("codeComments") && candidate.includes(CONTRACT)) ?? "";
      expect(line).toMatch(/finding/);
      expect(line).toMatch(/fixer/);
    });
  }
});

describe("FR-FLOW-234 AC-4 — the root instruction block 1.13", () => {
  const OFF_LINE =
    "When `get_work_mode` reports `codeComments: off`, write no explanatory comment in code you write or change: keep the `@req` and task-name trace tags (the tag alone on its line), the `<REQ-ID> AC-<n>` citations on test lines and the directive comments a language or tool needs, and leave existing comments in place. Change the setting (`speckiwi comments on|off`) only when the user asks.";

  // @req FR-FLOW-234 AC-4
  it("raises the block to 1.13 and carries the off rule", () => {
    expect(AGENT_INSTRUCTION_VERSION).toBe("1.13");
    expect(renderAgentInstructionSnippet().split("\n")).toContain(OFF_LINE);
  });

  // @req FR-FLOW-234 AC-4
  it("names speckiwi comments among the CLI-only SRS mutations", () => {
    const cliOnly = renderAgentInstructionSnippet().split("\n").find((line) => line.includes("may use the CLI:")) ?? "";
    expect(cliOnly).toContain("`speckiwi rename-target`");
    expect(cliOnly).toContain("`speckiwi comments`");
  });

  // @req FR-FLOW-234 AC-4
  it.each(["CLAUDE.md", "AGENTS.md"])("the repository's own %s carries the 1.13 block", async (file) => {
    const text = await read(file);
    expect(text).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.13`);
    expect(text).toContain(OFF_LINE);
  });
});
