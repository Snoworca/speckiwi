import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("workspace parser", () => {
  it("discovers SRS files and returns normalized records", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    expect(workspace.index.targets.map((target) => target.target)).toContain("v1.0.0");
    expect(workspace.index.scopes.map((scope) => scope.prefix)).toContain("ARCH");
    expect(workspace.records.map((record) => record.id)).toContain("FR-ARCH-001");
    expect(JSON.parse(JSON.stringify(workspace.records[0]))).toHaveProperty("id");
  });

  it("keeps valid neighboring records when diagnostics are present", async () => {
    const root = await copyFixtureWorkspace("invalid-structure");
    const workspace = await parseWorkspace(await resolveProjectRoot(root));

    expect(workspace.records.length).toBeGreaterThan(0);
    expect(workspace.diagnostics.length).toBeGreaterThan(0);
  });
});
