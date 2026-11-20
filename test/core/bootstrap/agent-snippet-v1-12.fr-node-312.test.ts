import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_INSTRUCTION_HEADING_PREFIX, AGENT_INSTRUCTION_VERSION, renderAgentInstructionSnippet } from "../../../src/core/bootstrap/templates.js";

// @req FR-NODE-312 — block v1.12: the ID rule names existing ids, and parallel worktrees are told how to
// pass an agreed free number and what the tool does not check.

const repo = (file: string) => path.resolve(import.meta.dirname, "../../..", file);
const PARALLEL_LINE =
  "Parallel worktrees that agreed their Requirement ID numbers beforehand pass the agreed free number to MCP `add_requirement` as `requirementId` (CLI `add-requirement --requirement-id`); the tool checks it against this checkout only, so the agreement itself is what keeps worktrees apart.";

describe("FR-NODE-312 — agent instruction block 1.12", () => {
  // @req FR-NODE-312 AC-10
  // The block has moved on since 1.12 (FR-FLOW-234 raised it to 1.13); the heading carries the current version.
  it("raised the block past 1.11, and the heading carries the current version", () => {
    expect(AGENT_INSTRUCTION_VERSION).not.toBe("1.11");
    expect(renderAgentInstructionSnippet().split("\n")[0]).toBe(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
  });

  // @req FR-NODE-312 AC-10
  it("forbids changing an existing requirement's ID, not choosing a new one", () => {
    const lines = renderAgentInstructionSnippet().split("\n");
    const mustNot = lines.slice(lines.indexOf("Agents MUST NOT:"));
    expect(mustNot.slice(0, mustNot.indexOf(""))).toContain("- Change an existing requirement's ID by hand.");
    expect(lines).not.toContain("- Change requirement IDs manually.");
  });

  // @req FR-NODE-312 AC-10
  it("tells parallel worktrees to pass the agreed number and that only this checkout is checked", () => {
    expect(renderAgentInstructionSnippet().split("\n")).toContain(PARALLEL_LINE);
  });

  // @req FR-NODE-312 AC-10
  it.each(["CLAUDE.md", "AGENTS.md"])("the repository's own %s carries the current block with the parallel line", async (file) => {
    const text = await readFile(repo(file), "utf8");
    expect(text).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
    expect(text).toContain(PARALLEL_LINE);
  });
});
