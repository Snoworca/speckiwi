import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  BUNDLED_SDS_RULES_FILENAME,
  renderAgentInstructionSnippet
} from "../../../src/core/bootstrap/templates.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-219 — the agent instruction snippet documents the tdd cycle with acceptance lines in
// intent.md and the step SDS written only when the user asks for one.

function item(snippet: string, number: number): string {
  const line = snippet.split("\n").find((candidate) => candidate.startsWith(`${number}. `) && candidate.includes("tdd"));
  return line ?? "";
}

describe("FR-NODE-219 — agent instruction snippet 1.10", () => {
  it("FR-NODE-219 AC-1: the heading carries version 1.10", () => {
    expect(AGENT_INSTRUCTION_VERSION).toBe("1.10");
    expect(renderAgentInstructionSnippet().startsWith(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.10\n`)).toBe(true);
  });

  it("FR-NODE-219 AC-2: the tdd cycle item records acceptance lines in intent.md and writes the step SDS only on request", () => {
    const cycle = item(renderAgentInstructionSnippet(), 3);
    expect(cycle).toContain("`docs/spec/steps/<task>/intent.md`");
    expect(cycle).toContain("`## Acceptance`");
    expect(cycle).toContain("`speckiwi step validate`");
    expect(cycle).toMatch(/translate them into failing tests and confirm they fail/);
    expect(cycle).toMatch(/run regression/);
    expect(cycle).toMatch(/synthesize the step SRS and promote the step requirement with verification evidence/);
    expect(cycle).toMatch(/step SDS .*design\.md.* is written only when the user asks for one/);
    expect(cycle).toContain(`docs/rule/${BUNDLED_SDS_RULES_FILENAME}`);
  });

  it("FR-NODE-219 AC-3: the tdd gates item names STEP_ACCEPTANCE_MISSING and drops the SDS skip record", () => {
    const snippet = renderAgentInstructionSnippet();
    const gates = item(snippet, 4);
    expect(gates).toMatch(/no test before the step's acceptance contract exists/);
    expect(gates).toContain("`STEP_ACCEPTANCE_MISSING` refuses a step without it");
    expect(gates).toMatch(/commit tests first and never weaken a test to reach green/);
    expect(gates).toMatch(/never promote a step requirement without verification evidence/);
    expect(snippet).not.toContain("SDS-E054");
    expect(snippet).not.toContain("## SDS Skip");
  });

  it("FR-NODE-219 AC-4: the coverage item is satisfied by the step's acceptance lines plus the post-hoc promotion", () => {
    const coverage = item(renderAgentInstructionSnippet(), 5);
    expect(coverage).toContain('"do not implement behavior not covered by an SRS requirement"');
    expect(coverage).toMatch(/satisfied for step-scoped work by the step's acceptance lines plus the mandatory post-hoc promotion/);
  });

  describe("FR-NODE-219 AC-5: re-init replaces a 1.9 block with exactly one 1.10 block", () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-219-"));
      await mkdir(path.join(root, ".git"), { recursive: true });
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("upserts by heading pattern, not by version order", async () => {
      const oldBlock = renderAgentInstructionSnippet({ version: "1.9" });
      await writeFile(path.join(root, "CLAUDE.md"), `# My Project\n\n${oldBlock}\n`, "utf8");

      expect((await initProject(await resolveProjectRoot(root), {})).ok).toBe(true);

      const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
      expect(claude.split(AGENT_INSTRUCTION_HEADING_PREFIX).length - 1).toBe(1);
      expect(claude).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.10\n`);
      expect(claude).not.toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.9\n`);
    });
  });
});
