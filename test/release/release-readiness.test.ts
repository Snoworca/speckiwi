import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { summarizeReleaseReadiness } from "../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

describe("release readiness and documentation", () => {
  it("summarizes target readiness without creating git tags", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const summary = summarizeReleaseReadiness(workspace, "v1.0.0");
    expect(summary.target).toBe("v1.0.0");
    expect(summary.baselineCommand).toContain("git tag srs-v1.0.0-baseline");
    expect(summary.ready).toBe(false);
  });

  it("documents CLI, MCP, evidence, CI, and baseline workflow", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("speckiwi list");
    expect(readme).toContain("speckiwi add-evidence");
    expect(readme).toContain("list_requirements");
    expect(readme).toContain("git tag srs-v1.0.0-baseline");
  });
});
