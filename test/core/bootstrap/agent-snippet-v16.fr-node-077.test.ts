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

// FR-NODE-077 — agent instruction snippet v1.6: MCP-first work-mode with
// switching guidance and the SDS rules reference. RED suite (one case per AC).
// AC-1..AC-3 fail while AGENT_INSTRUCTION_VERSION is "1.5" and the work-mode
// section names only the CLI; AC-4 fails while re-init leaves the v1.5 block.

describe("FR-NODE-077 agent instruction snippet v1.6", () => {
  it("FR-NODE-077 AC-1: bumps the version to 1.6 in the constant and the heading", () => {
    expect(AGENT_INSTRUCTION_VERSION).toBe("1.6");
    const snippet = renderAgentInstructionSnippet();
    expect(snippet.startsWith(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.6`)).toBe(true);
  });

  it("FR-NODE-077 AC-2: documents MCP-first read/switch with the CLI fallback and switching semantics", () => {
    const snippet = renderAgentInstructionSnippet();
    // MCP-first read + switch tools, CLI fallback.
    expect(snippet).toContain("get_work_mode");
    expect(snippet).toContain("set_work_mode");
    expect(snippet).toContain("speckiwi mode");
    // Switching semantics: any-to-any, stale Active Task drop, INVALID_MODE rejection.
    expect(snippet).toMatch(/any (other|of the modes)/i);
    expect(snippet).toContain("Active Task");
    expect(snippet).toContain("INVALID_MODE");
  });

  it("FR-NODE-077 AC-3: references the installed SDS rules path and keeps the v1.5 tdd content", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(snippet).toContain("docs/rule/SDS-MD-Rules-v1.0.0.md");
    // v1.5 tdd content retained: cycle, gates, sdd fallback, boundary rule.
    expect(snippet).toContain("design.md");
    expect(snippet).toContain("EARS");
    expect(snippet).toContain("never weaken");
    expect(snippet).toContain("verification evidence");
    expect(snippet).toContain("existing body requirements");
    expect(snippet).toContain("large architecture changes");
  });

  describe("FR-NODE-077 AC-4: re-init upserts a v1.5 block into exactly one v1.6 block", () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-077-"));
      await mkdir(path.join(root, ".git"), { recursive: true });
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("replaces the old block idempotently", async () => {
      const oldBlock = renderAgentInstructionSnippet({ version: "1.5" });
      await writeFile(path.join(root, "CLAUDE.md"), `# My Project\n\n${oldBlock}\n`, "utf8");

      const result = await initProject(await resolveProjectRoot(root), {});
      expect(result.ok).toBe(true);

      const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
      const headings = claude.split(AGENT_INSTRUCTION_HEADING_PREFIX).length - 1;
      expect(headings).toBe(1);
      expect(claude).toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.6`);
      expect(claude).not.toContain(`${AGENT_INSTRUCTION_HEADING_PREFIX}1.5`);
    });
  });
});
