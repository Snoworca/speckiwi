import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { workflowPipelineCompact } from "../../../src/core/workflow/read.js";
import { createWorkflowFixture } from "../../fixtures/workflow-artifacts.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function workflowEvent(runId: string, status = "TASK_DONE", extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-pm", run_id: runId, status, ...extra });
}

describe("REL-NODE-006 workflow diagnostic projection contracts", () => {
  // The doctor, diff and schema-check projections left with their tools and the validator they
  // composed (FR-NODE-211 AC-1, AC-3); the compact pipeline projection is what REL-NODE-006 keeps.
  it("REL-NODE-006 AC-2: a clean pipeline journal projects no_actionable_drift and nothing blocking", async () => {
    const fixture = await createWorkflowFixture();
    await write(fixture.root, "kiwi/pipeline.jsonl", `${workflowEvent("pipeline-a")}\n`);

    const compact = await workflowPipelineCompact({ root: fixture.root });

    expect(compact.value).toMatchObject({ projectionKind: "pipeline_compact", outcomeCodes: ["no_actionable_drift"], blocking: false, total: 1, active: 1 });
    expect(JSON.stringify(compact)).not.toContain("\"body\"");
  });

  it("REL-NODE-006 AC-2: a malformed journal line projects invalid_artifact and blocks", async () => {
    const fixture = await createWorkflowFixture();

    const compact = await workflowPipelineCompact({ root: fixture.root });

    expect(compact.value.outcomeCodes).toContain("invalid_artifact");
    expect(compact.value.blocking).toBe(true);
  });

  it("computes compact pipeline state after logical-delete filtering", async () => {
    const fixture = await createWorkflowFixture();
    await write(
      fixture.root,
      "kiwi/pipeline.jsonl",
      [
        workflowEvent("pipeline-a"),
        workflowEvent("delete-pipeline-a", "CORRECTION", { corrects_run_id: "pipeline-a", operation: { kind: "logical_delete", reason: "obsolete" } })
      ].join("\n") + "\n"
    );

    await expect(workflowPipelineCompact({ root: fixture.root })).resolves.toMatchObject({
      value: {
        projectionKind: "pipeline_compact",
        outcomeCodes: expect.arrayContaining(["deleted_record_filtered"]),
        latestEvent: null,
        total: 2,
        active: 0,
        deletedFiltered: 1
      }
    });

    await expect(workflowPipelineCompact({ root: fixture.root }, { includeDeleted: true })).resolves.toMatchObject({
      value: {
        projectionKind: "pipeline_compact",
        latestEvent: { event: { run_id: "delete-pipeline-a", status: "CORRECTION" } },
        active: 2
      }
    });
  });
});
