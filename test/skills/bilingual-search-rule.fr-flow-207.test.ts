import { describe, expect, it } from "vitest";

import { BILINGUAL_SEARCH_EXAMPLE, BILINGUAL_SEARCH_RULE, renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";
import { RENDERINGS, flat, markdownFiles, readRepoFile } from "./kiwi-renderings.js";
import { COMPACTION_TOKEN_BUDGET, tokensThrough } from "./skill-token-estimate.js";

// FR-FLOW-207 — every requirement search an agent is told to send carries the query's words in both
// Korean and English. The rule is one sentence, held once in `BILINGUAL_SEARCH_RULE`, and every place
// that tells an agent to search states that sentence verbatim beside the instruction.

/** A line that tells the agent to search requirements: the MCP tool or the CLI command. */
const SEARCH_INSTRUCTION = /search_requirements|speckiwi search\b/;

/** How many lines after a search instruction the rule may start, so a wrapped list item still counts. */
const RULE_WINDOW = 2;

interface SearchSite {
  readonly file: string;
  readonly line: number;
  readonly nearby: string;
}

/** Every search instruction in `text`, with the instruction line and the next RULE_WINDOW lines flattened. */
function searchSites(file: string, text: string): SearchSite[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines.flatMap((lineText, index) =>
    SEARCH_INSTRUCTION.test(lineText) ? [{ file, line: index + 1, nearby: flat(lines.slice(index, index + 1 + RULE_WINDOW).join("\n")) }] : []
  );
}

/** The denominator: every search instruction in every markdown file of every shipped rendering. */
const SKILL_SITES: readonly SearchSite[] = RENDERINGS.flatMap((rendering) =>
  markdownFiles(rendering).flatMap((file) => searchSites(file, readRepoFile(file)))
);

describe("FR-FLOW-207 — one bilingual search rule, both directions", () => {
  // @req FR-FLOW-207 AC-2
  it("the rule covers both directions and puts the original words and their translations in one query string", () => {
    expect(BILINGUAL_SEARCH_RULE).toContain("put the words you would search for and their equivalents in the other language");
    expect(BILINGUAL_SEARCH_RULE).toContain("same query string");
    expect(BILINGUAL_SEARCH_RULE).toContain("add English words to a Korean request");
    expect(BILINGUAL_SEARCH_RULE).toContain("add Korean words to an English request or to a requirement you are writing in English");
    // The block that carries the rule must stay English (FR-NODE-086 AC-3).
    expect(BILINGUAL_SEARCH_RULE).not.toMatch(/[가-힣]/);
  });

  // @req FR-FLOW-207 AC-1 @req FR-FLOW-207 AC-3
  it("the example query carries Korean and English words together", () => {
    expect(BILINGUAL_SEARCH_EXAMPLE).toMatch(/[가-힣]/);
    expect(BILINGUAL_SEARCH_EXAMPLE).toMatch(/[A-Za-z]/);
  });
});

describe("FR-FLOW-207 AC-2 — the agent instruction block states the rule where it sends the agent to search", () => {
  const block = renderAgentInstructionSnippet().split("\n");
  const workspaceRootSection = block.indexOf("Per-call workspace root:");
  const workspaceRootEnd = block.indexOf("", workspaceRootSection + 1);
  // The per-call workspace root section lists the tools that accept a parameter; it sends no search.
  const instructions = block
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => SEARCH_INSTRUCTION.test(line) && !(index > workspaceRootSection && index < workspaceRootEnd));

  // @req FR-FLOW-207 AC-2
  it("the requirement lookup step names the search tool and the CLI command", () => {
    const lookup = block.find((line) => line.startsWith("2. Find the relevant Requirement ID"));
    expect(lookup).toBeDefined();
    expect(lookup).toContain("`search_requirements`");
    expect(lookup).toContain("`speckiwi search`");
  });

  // @req FR-FLOW-207 AC-2
  it("every search instruction in the block carries the rule beside it", () => {
    expect(instructions.length).toBeGreaterThan(0);
    for (const { index } of instructions) {
      expect(flat(block.slice(index, index + 1 + RULE_WINDOW).join("\n")), `block line ${index + 1}`).toContain(BILINGUAL_SEARCH_RULE);
    }
  });
});

describe("FR-FLOW-207 AC-2/AC-4 — every skill rendering that sends a search states the identical rule beside it", () => {
  // @req FR-FLOW-207 AC-4
  it("the denominator is read from the renderings and includes kiwi-bug-repro in every rendering", () => {
    for (const rendering of RENDERINGS) {
      expect(SKILL_SITES.some((site) => site.file === `${rendering}/kiwi-bug-repro/SKILL.md`), rendering).toBe(true);
    }
  });

  // @req FR-FLOW-207 AC-2 @req FR-FLOW-207 AC-4
  it.each(SKILL_SITES.map((site) => [`${site.file}:${site.line}`, site] as const))("%s states the rule verbatim", (_label, site) => {
    expect(site.nearby).toContain(BILINGUAL_SEARCH_RULE);
  });

  // Claude Code re-attaches only the first 5,000 tokens of a skill after a compaction.
  // @req FR-FLOW-207 AC-2
  it.each([...new Set(SKILL_SITES.map((site) => site.file))])("%s states the rule within the compaction budget", (file) => {
    const used = tokensThrough(readRepoFile(file), BILINGUAL_SEARCH_RULE);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(COMPACTION_TOKEN_BUDGET);
  });
});
