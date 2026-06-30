import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { renderAgentInstructionSnippet } from "../../src/core/bootstrap/templates.js";

const RUNBOOK_FILES = ["AGENTS.md", "CLAUDE.md", "agents.md", "docs/next/2026-06-30-merge-time-duplicate-id-repair.md"];

describe("OPS-FLOW-002 merge-time duplicate Requirement ID repair runbook", () => {
  it("documents the validate, diagnose, plan, apply, and final evidence workflow", async () => {
    for (const file of RUNBOOK_FILES) {
      const text = await readFile(file, "utf8");
      expect(text, file).toContain("SRS-E002");
      expect(text, file).toContain("diagnose_requirement_id_collisions");
      expect(text, file).toContain("plan_requirement_id_collision_repair");
      expect(text, file).toContain("apply_requirement_id_collision_repair");
      expect(text, file).toContain("speckiwi repair requirement-id-collisions diagnose --json");
      expect(text, file).toContain("speckiwi validate --fail-on-warning --json");
      expect(text, file).toContain("speckiwi summary --target <target> --json");
      expect(text, file).toContain("speckiwi links check --json");
    }
  });

  it("keeps the generated agent instruction snippet aligned with the root runbook", () => {
    const snippet = renderAgentInstructionSnippet();
    expect(snippet).toContain("Merge-time duplicate Requirement ID repair workflow");
    expect(snippet).toContain("A duplicate ID alone is never enough to write");
    expect(snippet).toContain("Do not use collision repair for general renumbering");
    expect(snippet).toContain("first repair IDs to uniqueness");
    expect(snippet).toContain("`--ignore-lock` is allowed only on apply");
  });
});
