import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

async function runJson(root: string, args: string[]): Promise<Record<string, unknown>> {
  const streams = io();
  expect(await main(["--root", root, ...args, "--json"], streams)).toBe(0);
  return JSON.parse(streams.stdout.read()?.toString() ?? "") as Record<string, unknown>;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function pipeline(status: string): string {
  return `${JSON.stringify({ ts: "2026-06-29T00:00:00.000Z", schema_version: "1.0.0", skill: "kiwi-pm", run_id: status.toLowerCase(), status, summary: status, dry_run: false })}\n`;
}

describe("IR-CLI-032 workflow work-order next command", () => {
  it("returns compact deterministic actions and measurement fields", async () => {
    const fixture = await createWorkflowFixture();

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.idOrderPlanPath])).resolves.toMatchObject({
      action: "execute-task",
      target: "v1.0.0",
      task: { id: "T-PH001-10" },
      nextAction: { kind: "execute-task", tool: "workflow_next_plan_task" }
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.planPath])).resolves.toMatchObject({
      action: "resume-session",
      task: { id: "T-002" },
      nextAction: { kind: "resume-session", tool: "workflow_resume_hint" }
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.stalePlanPath])).resolves.toMatchObject({
      action: "fix-artifact",
      blocking: true,
      blockingDiagnostics: expect.arrayContaining([expect.objectContaining({ code: "SRS-W059" })])
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.blockedPlanPath])).resolves.toMatchObject({
      action: "blocked",
      blocking: true,
      reason: expect.stringContaining("dependency")
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.completePlanPath])).resolves.toMatchObject({
      action: "complete",
      blocking: false
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.planPath, "--explain", "--context-profile", "compact"])).resolves.toMatchObject({
      action: "resume-session",
      profile: "explain",
      contextProfile: "compact",
      decisionTrace: expect.arrayContaining([expect.objectContaining({ step: "decision", outcome: "resume-session" })]),
      rejectedCandidates: expect.arrayContaining([expect.objectContaining({ action: "execute-task" })]),
      blockers: expect.any(Array)
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.idOrderPlanPath, "--profile", "compact"])).resolves.toMatchObject({
      action: "execute-task",
      profile: "compact"
    });

    await write(fixture.root, "kiwi/pipeline.jsonl", pipeline("NEEDS_USER"));
    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.idOrderPlanPath])).resolves.toMatchObject({
      action: "ask-user",
      blocking: true,
      pipeline: { latestStatus: "NEEDS_USER" }
    });

    const noPlanRoot = await copyFixtureWorkspace("valid-basic");
    const createPlan = await runJson(noPlanRoot, ["workflow", "work-order", "next", "--target", "v1.0.0", "--measure"]);
    expect(createPlan).toMatchObject({
      action: "create-plan",
      measurement: {
        baselineBytes: expect.any(Number),
        compactBytes: expect.any(Number),
        requiredFieldsPresent: true,
        reductionRatio: expect.any(Number)
      }
    });
    expect(JSON.stringify(createPlan)).not.toContain("#### Requirement");
  });
});
