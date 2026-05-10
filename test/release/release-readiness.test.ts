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
    expect(summary.stabilityBlockers).toEqual([]);
    expect(summary.stabilityWarnings).toEqual([]);
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

  it("reports stability blockers and warnings separately from status blockers", async () => {
    const workspace = await parseWorkspace(await resolveProjectRoot(await copyFixtureWorkspace("valid-basic")));
    const [base] = workspace.records;
    workspace.records = [
      {
        ...base,
        id: "FR-ARCH-001",
        status: "planned",
        stability: "draft",
        metadata: { ...base.metadata, Status: "planned", Stability: "draft" },
        traceLinks: []
      },
      {
        ...base,
        id: "FR-ARCH-002",
        status: "verified",
        stability: "deprecated",
        metadata: { ...base.metadata, Status: "verified", Stability: "deprecated" },
        acceptanceCriteria: base.acceptanceCriteria.map((criterion) => ({ ...criterion, checked: true })),
        verificationEvidence: [{ id: "VE-1", type: "test", reference: "docs/spec/10.product-architecture.srs.md", covers: "all", notes: "-", line: 47 }],
        traceLinks: []
      },
      {
        ...base,
        id: "FR-ARCH-003",
        status: "discarded",
        stability: "draft",
        metadata: { ...base.metadata, Status: "discarded", Stability: "draft" },
        traceLinks: []
      }
    ];

    const summary = summarizeReleaseReadiness(workspace, { target: "v1.0.0" });

    expect(summary.ready).toBe(false);
    expect(summary.plannedOrInProgress).toEqual(["FR-ARCH-001"]);
    expect(summary.draftRequirements).toEqual(["FR-ARCH-001"]);
    expect(summary.deprecatedRequirements).toEqual(["FR-ARCH-002"]);
    expect(summary.stabilityBlockers).toEqual(["FR-ARCH-001"]);
    expect(summary.stabilityWarnings).toEqual(["FR-ARCH-002"]);
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
    expect(summary).toMatchObject({
      draftRequirements: [],
      deprecatedRequirements: [],
      stabilityBlockers: [],
      stabilityWarnings: []
    });
  });

  it("documents CLI, MCP, evidence, CI, and baseline workflow", async () => {
    const readme = await readFile("README.md", "utf8");
    const baselineExampleCount = readme.split("git tag srs-v1.0.0-baseline").length - 1;
    expect(readme).toContain("speckiwi list");
    expect(readme).toContain("speckiwi add-evidence");
    expect(readme).toContain("list_requirements");
    expect(baselineExampleCount).toBe(2);
    expect(readme).not.toContain("git tag srs-v1.2.0-baseline");
  });
});
