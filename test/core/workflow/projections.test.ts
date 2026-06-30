import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { workflowDiff, workflowDoctor, workflowPipelineCompact, workflowSchemaCheck } from "../../../src/core/workflow/read.js";
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
  it("projects validator outcomes without raw bodies or mutation state", async () => {
    const fixture = await createWorkflowFixture();

    const doctor = await workflowDoctor({ root: fixture.root }, { path: fixture.stalePlanPath });
    expect(doctor).toMatchObject({
      ok: true,
      value: {
        projectionKind: "workflow_doctor",
        outcomeCodes: expect.arrayContaining(["stale_artifact"]),
        blocking: true,
        artifacts: expect.arrayContaining([expect.objectContaining({ relativePath: fixture.stalePlanPath, sha256: expect.any(String), mtimeMs: expect.any(Number) })])
      },
      diagnosticsSummary: { byCode: { "SRS-W059": 2 } }
    });
    expect(JSON.stringify(doctor)).not.toContain("Workflow fixture plan");

    const diff = await workflowDiff({ root: fixture.root }, { path: fixture.checkboxDriftPlanPath });
    expect(diff).toMatchObject({
      value: {
        projectionKind: "workflow_diff",
        outcomeCodes: expect.arrayContaining(["repairable_drift"]),
        diffs: expect.arrayContaining([expect.objectContaining({ class: "display_drift", code: "SRS-W060" })])
      }
    });

    const schemaCheck = await workflowSchemaCheck({ root: fixture.root }, { path: fixture.invalidSidecarPlanPath });
    expect(schemaCheck).toMatchObject({
      value: {
        projectionKind: "workflow_schema_check",
        outcomeCodes: expect.arrayContaining(["invalid_artifact"]),
        blocking: true
      },
      diagnosticsSummary: { byCode: { "SRS-W050": expect.any(Number) } }
    });
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
