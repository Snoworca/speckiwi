import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";
import { toolSchemas } from "../../src/mcp/server.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SKILL_ROOTS = ["skills/claude", "skills/codex", "skills/etc", ".agents/skills"] as const;
const ROLE_AWARE_SKILLS = ["kiwi-orchestrator", "kiwi-wave-master"] as const;

function read(relativePath: string): string {
  try {
    return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  } catch {
    return "";
  }
}

// @req REL-MCP-005 AC-8 — the argument is useless to an agent that is never told which families take
// it, and dangerous to one that assumes the answer came from the root it meant.
describe("REL-MCP-005 AC-8 — documentation and agent instructions name the per-call workspace root", () => {
  it("the README states which tool families accept workspaceRoot, in both language sections", () => {
    const readme = read("README.md");
    expect(readme).not.toBe("");
    // Both the English (§ MCP tools) and Korean (§ MCP 도구) tables are shipped documentation.
    for (const [anchor, refusal] of [
      ["### MCP tools", /refus/i],
      ["### MCP 도구", /거부/]
    ] as const) {
      const start = readme.indexOf(anchor);
      expect(start, `${anchor} must exist`).toBeGreaterThan(-1);
      // Bounded by the next same-level heading rather than by a byte count. A fixed window is a
      // proxy for the section that fails in both directions: it had 143 characters of slack before
      // the SRS query tools were named here, so a correct update to this very section reddened it,
      // and on a shorter section it reaches into the next one and finds these names there.
      const rest = readme.slice(start + anchor.length);
      const nextHeading = rest.search(/\n### /);
      const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
      expect(section, `${anchor} must name the argument`).toContain("workspaceRoot");
      expect(section, `${anchor} must name the workflow_* family as an acceptor`).toMatch(/workflow_\*/);
      expect(section, `${anchor} must name the orchestrate_* family as an acceptor`).toMatch(/orchestrate_\*/);
      expect(section, `${anchor} must say the SRS tools refuse it`).toMatch(refusal);
      expect(section, `${anchor} must name the envelope field a caller confirms identity with`).toContain("rootSource");
    }
  });

  it("the managed agent instructions require confirming workspace identity from the envelope", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(snippet).toContain("workspaceRoot");
    expect(snippet).toContain("rootSource");
    expect(snippet).toMatch(/workflow_\*/);
    expect(snippet).toMatch(/orchestrate_\*/);
    // The instruction has to bind the confirmation to target-scoped work, not merely mention a field.
    expect(snippet).toMatch(/confirm[\s\S]{0,200}target-scoped/i);
  });

  it("kiwi-orchestrator and kiwi-wave-master name the MCP argument beside the CLI flags they teach", () => {
    // `.agents/skills` deliberately excludes some skills (FR-NODE-083 AC-5/AC-6); the exclusion
    // list is read rather than mirrored into this test so the two cannot drift.
    const excluded = new Set<string>(
      (JSON.parse(read(".agents/skills/.speckiwi-mirror-exclusions.json") || '{"excluded":[]}') as { excluded: string[] }).excluded
    );
    for (const root of SKILL_ROOTS) {
      for (const skill of ROLE_AWARE_SKILLS) {
        if (root === ".agents/skills" && excluded.has(skill)) continue;
        const text = read(path.posix.join(root, skill, "SKILL.md"));
        expect(text, `${root}/${skill}/SKILL.md must exist`).not.toBe("");
        expect(text, `${root}/${skill} teaches --mcp-root today`).toContain("--mcp-root");
        expect(text, `${root}/${skill} must also name the MCP workspaceRoot argument`).toContain("workspaceRoot");
        expect(text, `${root}/${skill} must name the MCP preflight role arguments`).toMatch(/orchestrate_preflight/);
      }
    }
  });
});

// @req REL-MCP-005 AC-8 · FR-MCP-064 AC-1 — the SRS query tools a document tells an agent it may aim
// at a worktree are exactly the ones the registry opens, derived from the schemas rather than listed,
// so a tool added to the family (check_sds and check_test_sufficiency in 4.0.0) cannot be left out of
// the documentation, and a tool that leaves cannot linger in it.
describe("REL-MCP-005 AC-8 · FR-MCP-064 AC-1 — the documented SRS query family equals the registry's", () => {
  const opened = Object.entries(toolSchemas)
    .filter(([name, shape]) => "workspaceRoot" in shape && !name.startsWith("workflow_") && !name.startsWith("orchestrate_"))
    .map(([name]) => name)
    .sort();
  const names = (text: string): string[] => [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1] as string).sort();

  it("the registry opens a non-empty family", () => {
    expect(opened.length).toBeGreaterThan(0);
  });

  it("the managed agent instructions list exactly that family", () => {
    const line = renderAgentInstructionSnippet()
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith("3. The SRS query tools also accept it:"));
    expect(line, "the snippet's SRS query line").toBeDefined();
    const listed = names((line ?? "").split(" — ")[0] ?? "");
    expect(listed).toEqual(opened);
  });

  it("both README tables list exactly that family", () => {
    const rows = read("README.md")
      .split(/\r?\n/)
      .filter((row) => row.startsWith("| The SRS query tools — ") || row.startsWith("| SRS 조회 도구 — "));
    expect(rows.length, "one row per language").toBe(2);
    for (const row of rows) expect(names(row.split(" | ")[0] ?? "")).toEqual(opened);
  });
});
