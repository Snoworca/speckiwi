import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";
import { listRequirements } from "../../src/core/query/lookup.js";
import { workflowArtifacts } from "../../src/core/workflow/read.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

describe("CON-ARCH-003 tooling artifact authority boundary", () => {
  it("does not treat workflow artifacts as canonical requirements and reports artifact source metadata", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await write(
      rootPath,
      "docs/plans/fake-srs.plan.md",
      [
        "---",
        "run_id: fake-srs",
        "target: v1.0.0",
        "plan_contract: \"1.2.0\"",
        "generated_at: 2026-06-29T08:05:04.654Z",
        "---",
        "# Plan",
        "",
        "### FR-ARCH-999 — Fake plan requirement",
        "",
        "This block-shaped content is an operational artifact, not canonical SRS."
      ].join("\n")
    );
    await write(rootPath, "kiwi/pipeline.jsonl", `${JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-planner", run_id: "fake-srs", target: "v1.0.0", status: "TASK_DONE" })}\n`);

    const root = await resolveProjectRoot(rootPath);
    const workspace = await parseWorkspace(root);
    const requirements = listRequirements(workspace, {});
    const artifacts = await workflowArtifacts(root, { runId: "fake-srs", includeBody: true });

    expect(requirements.map((record) => record.id)).toEqual(["FR-ARCH-001"]);
    expect(JSON.stringify(requirements)).not.toContain("FR-ARCH-999");
    expect(artifacts.meta.workspaceRoot).toBe(rootPath);
    expect(artifacts.value.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "docs/plans/fake-srs.plan.md",
          kind: "plan",
          runId: "fake-srs",
          target: "v1.0.0",
          sha256: expect.any(String),
          mtimeMs: expect.any(Number)
        }),
        expect.objectContaining({
          relativePath: "kiwi/pipeline.jsonl",
          kind: "pipeline",
          sha256: expect.any(String),
          mtimeMs: expect.any(Number)
        })
      ])
    );
    expect(artifacts.value.artifacts.find((artifact) => artifact.relativePath === "docs/plans/fake-srs.plan.md")?.body).toContain("FR-ARCH-999");
  });
});
