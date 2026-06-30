import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { runPackageDoctor } from "../../src/doctor/package-doctor.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("OPS-NODE-003 package and MCP doctor", () => {
  it("checks package identity, skill entrypoints, MCP reads, and a dry-run mutation", async () => {
    const root = await resolveProjectRoot(await copyFixtureWorkspace("mutation-target"));
    const report = await runPackageDoctor(root);

    expect(report.ok).toBe(true);
    expect(report.package).toMatchObject({ name: "speckiwi", version: expect.stringMatching(/^\d+\.\d+\.\d+/) });
    expect(report.workspace).toMatchObject({ activeTarget: "v1.0.0" });
    expect(report.mcp.metadata).toMatchObject({ name: report.package.name, version: report.package.version });
    expect(report.mcp.tools).toEqual(expect.arrayContaining(["get_active_target", "validate_spec", "set_target_goal"]));
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "package-json-version", status: "pass" }),
        expect.objectContaining({ id: "package-lock-version", status: "pass" }),
        expect.objectContaining({ id: "packed-skill-entrypoints", status: "pass" }),
        expect.objectContaining({ id: "mcp-tool-schema-listing", status: "pass" }),
        expect.objectContaining({ id: "mcp-active-target-read", status: "pass" }),
        expect.objectContaining({ id: "mcp-validation-read", status: "pass" }),
        expect.objectContaining({ id: "mcp-dry-run-mutation", status: "pass" })
      ])
    );
    expect(report.summary.fail).toBe(0);
  });
});
