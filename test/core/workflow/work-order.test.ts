import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
import { createWorkflowFixture } from "../../fixtures/workflow-artifacts.js";
import { buildNextWorkOrder } from "../../../src/core/workflow/work-order.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function pipelineEvent(status: string): string {
  return JSON.stringify({
    ts: "2026-06-29T00:00:00.000Z",
    schema_version: "1.0.0",
    skill: "kiwi-pm",
    run_id: `pipeline-${status.toLowerCase()}`,
    status,
    summary: status,
    next_hint: null,
    dry_run: false
  });
}

describe("IR-CLI-032 / FR-MCP-024 next work-order core", () => {
  it("returns deterministic work-order actions for plan, session, blocker, and completion states", async () => {
    const fixture = await createWorkflowFixture();

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.idOrderPlanPath })).resolves.toMatchObject({
      action: "execute-task",
      nextAction: { kind: "execute-task", tool: "workflow_next_plan_task" },
      task: { id: "T-PH001-10" },
      blocking: false
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.planPath })).resolves.toMatchObject({
      action: "resume-session",
      nextAction: { kind: "resume-session", tool: "workflow_resume_hint" },
      task: { id: "T-002" },
      blocking: false
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.stalePlanPath })).resolves.toMatchObject({
      action: "fix-artifact",
      blocking: true,
      nextAction: { kind: "fix-artifact" },
      blockingDiagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W059" })])
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.invalidSidecarPlanPath })).resolves.toMatchObject({
      action: "fix-artifact",
      blocking: true,
      nextAction: { kind: "fix-artifact" },
      diagnosticsSummary: { byCode: expect.objectContaining({ "SRS-W050": expect.any(Number) }) }
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.missingSidecarPlanPath })).resolves.toMatchObject({
      action: "fix-artifact",
      blocking: true,
      nextAction: { kind: "fix-artifact" },
      diagnosticsSummary: { byCode: expect.objectContaining({ "SRS-W051": expect.any(Number) }) }
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.blockedPlanPath })).resolves.toMatchObject({
      action: "blocked",
      blocking: true,
      nextAction: { kind: "blocked" },
      reason: expect.stringContaining("dependency")
    });

    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.completePlanPath })).resolves.toMatchObject({
      action: "complete",
      blocking: false,
      nextAction: { kind: "complete" }
    });
  });

  it("returns create-plan, ask-user, and measured compact payloads without raw bodies", async () => {
    const noPlanRoot = await copyFixtureWorkspace("valid-basic");
    const createPlan = await buildNextWorkOrder({ root: noPlanRoot }, { target: "v1.0.0", measure: true });
    expect(createPlan).toMatchObject({
      action: "create-plan",
      target: "v1.0.0",
      nextAction: { kind: "create-plan", tool: "workflow_plan_status" },
      measurement: {
        baselineBytes: expect.any(Number),
        baselineApproxTokens: expect.any(Number),
        compactBytes: expect.any(Number),
        compactApproxTokens: expect.any(Number),
        requiredFieldsPresent: true,
        reductionRatio: expect.any(Number)
      }
    });
    expect(JSON.stringify(createPlan)).not.toContain("#### Requirement");
    expect(createPlan.measurement?.compactBytes).toBeLessThan(createPlan.measurement?.baselineBytes ?? 0);

    const fixture = await createWorkflowFixture();
    await write(fixture.root, "kiwi/pipeline.jsonl", `${pipelineEvent("NEEDS_USER")}\n`);
    await expect(buildNextWorkOrder({ root: fixture.root }, { path: fixture.idOrderPlanPath })).resolves.toMatchObject({
      action: "ask-user",
      blocking: true,
      nextAction: { kind: "ask-user" },
      pipeline: { latestStatus: "NEEDS_USER" }
    });
  });
});
