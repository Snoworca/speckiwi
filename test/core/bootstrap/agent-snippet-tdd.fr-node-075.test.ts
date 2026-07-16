import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_INSTRUCTION_HEADING_PREFIX,
  AGENT_INSTRUCTION_VERSION,
  renderAgentInstructionSnippet
} from "../../../src/core/bootstrap/templates.js";
import { initProject } from "../../../src/core/bootstrap/init-project.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-075 — agent instruction snippet v1.5 documents the tdd work-mode.
// RED suite (one case per AC). AC-1..AC-3 fail while AGENT_INSTRUCTION_VERSION
// is "1.4" and the snippet carries no tdd work-mode section; AC-4 fails while
// re-init leaves the v1.4 block in place instead of upserting a single v1.5
// block.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-075):
//   - AC-1: heading `# SpecKiwi SRS 워크플로 v1.5`, constant "1.5".
//   - AC-2: work-mode check instruction + tdd cycle + the three tdd gates.
//   - AC-3: sdd fallback for body-scope work + the boundary rule.
//   - AC-4: idempotent upsert replaces a v1.4 block with exactly one v1.5 block.

describe("FR-NODE-075 agent instruction snippet v1.5 documents the tdd work-mode", () => {
  // Version literal note: FR-NODE-075 shipped as v1.5; FR-NODE-077 bumped the snippet to
  // v1.6 (FR-FLOW-016 AC-2 bump contract). This suite keeps testing the FR-NODE-075
  // mechanics against the CURRENT version constant so it stays bump-proof.
  it("FR-NODE-075 AC-1: the constant and the heading carry the current bumped version", () => {
    expect(AGENT_INSTRUCTION_VERSION).toMatch(/^1\.\d+$/);
    const snippet = renderAgentInstructionSnippet();
    expect(snippet.startsWith(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`)).toBe(true);
  });

  it("FR-NODE-075 AC-2: documents the work-mode check, the tdd cycle, and the three tdd gates", () => {
    const snippet = renderAgentInstructionSnippet();
    // (a) work-mode check before starting work.
    expect(snippet).toContain("speckiwi mode");
    // (b) the tdd cycle: SDS design.md → failing tests → green → regression → promote.
    expect(snippet).toContain("design.md");
    expect(snippet).toContain("SDS");
    expect(snippet).toContain("failing tests");
    // (c) the three gates.
    expect(snippet).toMatch(/do not write tests before .*SDS/i);
    expect(snippet).toContain("never weaken");
    expect(snippet).toContain("verification evidence");
  });

  it("FR-NODE-075 AC-3: states the sdd fallback and the boundary rule", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(snippet).toContain("sdd");
    expect(snippet).toContain("existing body requirements");
    expect(snippet).toContain("large architecture changes");
  });

  describe("FR-NODE-075 AC-4: re-init upserts a v1.4 block into exactly one v1.5 block", () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-075-"));
      await mkdir(path.join(root, ".git"), { recursive: true });
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("replaces the old block idempotently", async () => {
      const oldBlock = renderAgentInstructionSnippet({ version: "1.4" });
      await writeFile(path.join(root, "AGENTS.md"), `# My Project\n\n${oldBlock}\n`, "utf8");

      const result = await initProject(await resolveProjectRoot(root), {});
      expect(result.ok).toBe(true);

      const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
      const headings = agents.split(AGENT_INSTRUCTION_HEADING_PREFIX).length - 1;
      expect(headings).toBe(1);
      expect(agents).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}${AGENT_INSTRUCTION_VERSION}`);
      expect(agents).not.toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.4`);
    });
  });
});
