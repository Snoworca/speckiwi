import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

describe("validation registry", () => {
  it("passes the valid fixture", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const result = validateWorkspace(workspace);
    expect(result.errors).toHaveLength(0);
  });

  it("detects duplicate IDs, missing metadata, and verified guard failures", async () => {
    const duplicate = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("duplicate-id"))));
    expect(duplicate.diagnostics.map((d) => d.code)).toContain("SRS-E002");

    const missing = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("missing-metadata"))));
    expect(missing.diagnostics.map((d) => d.code)).toContain("SRS-E003");

    const guard = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("verified-guard-failure"))));
    expect(guard.diagnostics.map((d) => d.code)).toContain("SRS-E010");

    const invalid = validateWorkspace(await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("invalid-structure"))));
    expect(invalid.diagnostics.map((d) => d.code)).toContain("SRS-E001");
  });
});
