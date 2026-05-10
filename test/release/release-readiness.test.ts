import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { summarizeReleaseReadiness } from "../../src/core/workflow/release-readiness.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const execFileAsync = promisify(execFile);

describe("release readiness and documentation", () => {
  it("summarizes target readiness without creating git tags", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const summary = summarizeReleaseReadiness(workspace, { target: "v1.0.0" });
    expect(summary.target).toBe("v1.0.0");
    expect(summary.targetSource).toBe("explicit");
    expect(summary.diagnosticsSummary.errors).toBe(0);
    expect(summary.baselineCommand).toContain("git tag srs-v1.0.0-baseline");
    expect(summary.ready).toBe(false);
  });

  it("uses the active target when an explicit target is absent", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const summary = summarizeReleaseReadiness(workspace);
    expect(summary.target).toBe("v1.0.0");
    expect(summary.targetSource).toBe("active-target");
    expect(summary.plannedOrInProgress).toEqual(["FR-ARCH-001"]);
  });

  it("keeps an explicit target from falling back to the active target", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    workspace.index.activeTarget = "v9.9.9";
    const summary = summarizeReleaseReadiness(workspace, { target: "v1.0.0" });
    expect(summary.target).toBe("v1.0.0");
    expect(summary.targetSource).toBe("explicit");
    expect(summary.plannedOrInProgress).toEqual(["FR-ARCH-001"]);
  });

  it("blocks readiness when no explicit target exists and active target is empty", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    workspace.index.activeTarget = "";
    const summary = summarizeReleaseReadiness(workspace);
    expect(summary.target).toBe("");
    expect(summary.targetSource).toBe("active-target");
    expect(summary.ready).toBe(false);
    expect(summary.baselineCommand).toBe("");
    expect(summary.warnings).toContain("Release target is empty; provide an explicit target or set Active Target.");
  });

  it("prints targetSource from the release-check script without a hard-coded target fallback", async () => {
    await execFileAsync("npm", ["run", "build", "--silent"], { cwd: process.cwd() });
    const env = { ...process.env };
    delete env.SPECKIWI_TARGET;
    delete env.SPECKIWI_STRICT_READY;
    const { stdout } = await execFileAsync(process.execPath, [join(process.cwd(), "scripts/release-check.mjs")], {
      cwd: await copyFixtureWorkspace("valid-basic"),
      env
    });
    const summary = JSON.parse(stdout);
    expect(summary.target).toBe("v1.0.0");
    expect(summary.targetSource).toBe("active-target");
  });

  it("documents CLI, MCP, evidence, CI, and baseline workflow", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("speckiwi list");
    expect(readme).toContain("speckiwi add-evidence");
    expect(readme).toContain("list_requirements");
    expect(readme).toContain("git tag srs-v1.0.0-baseline");
  });
});
