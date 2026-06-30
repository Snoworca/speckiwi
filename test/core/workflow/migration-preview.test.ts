import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { workflowMigrationPreview } from "../../../src/core/workflow/read.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function legacyPlan(runId: string, target: string): string {
  return [
    "---",
    `run_id: ${runId}`,
    `target: ${target}`,
    "generated_at: 2026-06-29T08:05:04.654Z",
    "---",
    "# Legacy plan"
  ].join("\n");
}

describe("FR-NODE-029 read-only legacy workflow migration preview", () => {
  it("classifies legacy artifacts, reports migration risks, omits bodies by default, and never writes", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await write(rootPath, "docs/plan/legacy.plan.md", legacyPlan("legacy-run", "v9.9.9"));
    await write(
      rootPath,
      ".snoworca/sessions/legacy-run/state.json",
      JSON.stringify({ run_id: "legacy-run", target: "v9.9.9", tasks: [{ task_id: "T-001", traces: [{ req_id: "FR-ARCH-001" }] }], legacy_only: true }, null, 2)
    );
    await write(rootPath, ".snoworca/sessions/bad/state.json", "{not valid json\n");
    await write(rootPath, "docs/plans/current.plan.md", legacyPlan("current-run", "v1.0.0"));
    const files = ["docs/plan/legacy.plan.md", ".snoworca/sessions/legacy-run/state.json", ".snoworca/sessions/bad/state.json"].map((file) => path.join(rootPath, file));
    const before = await Promise.all(files.map(sha256));

    const root = await resolveProjectRoot(rootPath);
    const preview = await workflowMigrationPreview(root, { target: "v1.0.0" });
    const after = await Promise.all(files.map(sha256));

    expect(after).toEqual(before);
    expect(preview.value.written).toBe(false);
    expect(preview.value.currentArtifacts).toEqual(expect.arrayContaining([expect.objectContaining({ relativePath: "docs/plans/current.plan.md", legacy: false })]));

    const legacyPlanPreview = preview.value.legacyArtifacts.find((item) => item.source.relativePath === "docs/plan/legacy.plan.md");
    expect(legacyPlanPreview).toMatchObject({
      proposedDestination: "docs/plans/legacy.plan.md",
      targetMismatch: true,
      pathDrift: true,
      source: {
        legacy: true,
        confidence: expect.any(Number),
        sha256: expect.any(String)
      }
    });
    expect(legacyPlanPreview?.source).not.toHaveProperty("body");
    expect(legacyPlanPreview?.requiredManualDecisions).toEqual(expect.arrayContaining(["choose target mapping", "confirm proposed destination path"]));

    const legacyStatePreview = preview.value.legacyArtifacts.find((item) => item.source.relativePath === ".snoworca/sessions/legacy-run/state.json");
    expect(legacyStatePreview).toMatchObject({
      proposedDestination: ".kiwi/sessions/legacy-run/state.json",
      unsupportedFields: expect.arrayContaining(["legacy_only", "tasks[].traces"]),
      lossyTransforms: expect.arrayContaining(["legacy traces[] require manual req_ids mapping"]),
      dataLossRisks: expect.arrayContaining(["unsupported legacy fields cannot be mapped automatically"])
    });

    const malformedPreview = preview.value.legacyArtifacts.find((item) => item.source.relativePath === ".snoworca/sessions/bad/state.json");
    expect(malformedPreview).toMatchObject({
      schemaMismatch: true,
      requiredManualDecisions: expect.arrayContaining(["repair malformed legacy artifact before migration"])
    });
    expect(preview.diagnosticsSummary.byCode).toMatchObject({ "SRS-W050": 1 });

    const withBody = await workflowMigrationPreview(root, { runId: "legacy-run", includeBody: true });
    expect(withBody.value.legacyArtifacts.find((item) => item.source.relativePath === "docs/plan/legacy.plan.md")?.source.body).toContain("# Legacy plan");
  });
});
