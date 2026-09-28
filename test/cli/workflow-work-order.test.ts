import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
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
  it("IR-CLI-032 AC-1: returns compact deterministic SDS-vocabulary actions and measurement fields", async () => {
    const fixture = await createWorkflowFixture();

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.freshSdsPath])).resolves.toMatchObject({
      action: "execute-sds",
      target: "v1.0.0",
      sds: { relativePath: fixture.freshSdsPath, sdsId: "fresh-run" },
      nextAction: { kind: "execute-sds", tool: "check_sds" }
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.sdsPath])).resolves.toMatchObject({
      action: "resume-session",
      sds: { relativePath: fixture.sdsPath },
      nextAction: { kind: "resume-session", tool: "workflow_session_status" }
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.draftSdsPath])).resolves.toMatchObject({
      action: "create-sds",
      nextAction: { kind: "create-sds", tool: "list_requirements" }
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.invalidSdsPath])).resolves.toMatchObject({
      action: "fix-artifact",
      blocking: true,
      blockingDiagnostics: expect.arrayContaining([expect.objectContaining({ code: "SDS-E062" })])
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.blockedSdsPath])).resolves.toMatchObject({
      action: "blocked",
      blocking: true,
      reason: expect.stringContaining("blocked")
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.completeSdsPath])).resolves.toMatchObject({
      action: "complete",
      blocking: false
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.sdsPath, "--explain", "--context-profile", "compact"])).resolves.toMatchObject({
      action: "resume-session",
      profile: "explain",
      contextProfile: "compact",
      decisionTrace: expect.arrayContaining([expect.objectContaining({ step: "decision", outcome: "resume-session" })]),
      rejectedCandidates: expect.arrayContaining([expect.objectContaining({ action: "execute-sds" })]),
      blockers: expect.any(Array)
    });

    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.freshSdsPath, "--profile", "compact"])).resolves.toMatchObject({
      action: "execute-sds",
      profile: "compact"
    });

    await write(fixture.root, "kiwi/pipeline.jsonl", pipeline("NEEDS_USER"));
    await expect(runJson(fixture.root, ["workflow", "work-order", "next", "--path", fixture.freshSdsPath])).resolves.toMatchObject({
      action: "ask-user",
      blocking: true,
      pipeline: { latestStatus: "NEEDS_USER" }
    });

    const noSdsRoot = await copyFixtureWorkspace("valid-basic");
    const createSds = await runJson(noSdsRoot, ["workflow", "work-order", "next", "--target", "v1.0.0", "--measure"]);
    expect(createSds).toMatchObject({
      action: "create-sds",
      measurement: {
        baselineBytes: expect.any(Number),
        compactBytes: expect.any(Number),
        requiredFieldsPresent: true,
        reductionRatio: expect.any(Number)
      }
    });
    expect(JSON.stringify(createSds)).not.toContain("#### Requirement");
    expect(JSON.stringify(createSds)).not.toContain("create-plan");
  });
});
