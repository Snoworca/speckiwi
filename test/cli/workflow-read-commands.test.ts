import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { createWorkflowFixture } from "../fixtures/workflow-artifacts.js";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

async function runJson(root: string, args: string[]): Promise<Record<string, unknown>> {
  const streams = io();
  const code = await main(["--root", root, ...args, "--json"], streams);
  expect(code).toBe(0);
  return JSON.parse(streams.stdout.read()?.toString() ?? "") as Record<string, unknown>;
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

function workflowEvent(runId: string, status = "TASK_DONE", extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-pm", run_id: runId, status, ...extra });
}

describe("IR-CLI-031 workflow artifact read commands", () => {
  it("exposes compact workflow reads without raw bodies by default", async () => {
    const fixture = await createWorkflowFixture();

    const workspace = await runJson(fixture.root, ["workflow", "workspace"]);
    expect(workspace).toMatchObject({ ok: true, value: { activeTarget: "v1.0.0" }, meta: { workspaceRoot: fixture.root }, diagnosticsSummary: expect.any(Object) });

    const artifacts = await runJson(fixture.root, ["workflow", "artifacts"]);
    expect(artifacts).toMatchObject({ ok: true, artifacts: expect.any(Array), cursor: { returned: expect.any(Number), total: expect.any(Number) } });
    expect(JSON.stringify(artifacts)).not.toContain("SDS-AC-1");
    expect((artifacts.artifacts as Array<{ relativePath: string; legacy: boolean }>).some((item) => item.relativePath === "docs/plan/legacy.plan.md" && item.legacy)).toBe(true);

    const withBody = await runJson(fixture.root, ["workflow", "resolve", "--path", fixture.sdsPath, "--include-body"]);
    expect(JSON.stringify(withBody)).toContain("SDS-AC-1");

    const latestSds = await runJson(fixture.root, ["workflow", "latest", "--kind", "sds", "--run-id", fixture.runId]);
    expect(latestSds).toMatchObject({ ok: true, value: { selected: { relativePath: fixture.sdsPath, kind: "sds" } } });

    const targetMatched = await runJson(fixture.root, ["workflow", "latest", "--kind", "sds", "--run-id", fixture.runId, "--target", "v1.0.0"]);
    expect(targetMatched).toMatchObject({ ok: true, value: { selected: { relativePath: fixture.sdsPath, target: "v1.0.0" } } });

    const pipelineStatus = await runJson(fixture.root, ["workflow", "pipeline-status"]);
    expect(pipelineStatus).toMatchObject({ ok: true, value: { total: 2 }, diagnosticsSummary: { byCode: { "SRS-W052": 1 } } });

    const pipelineTail = await runJson(fixture.root, ["workflow", "pipeline-tail", "--limit", "1"]);
    expect(pipelineTail).toMatchObject({ ok: true, value: { events: [expect.objectContaining({ eventKey: "kiwi-planner|pipeline-a" })] }, cursor: { returned: 1, total: 2, nextOffset: 1 } });

    const nestedPipelineStatus = await runJson(fixture.root, ["workflow", "pipeline", "status"]);
    expect(nestedPipelineStatus.value).toEqual(pipelineStatus.value);

    const nestedPipelineTail = await runJson(fixture.root, ["workflow", "pipeline", "tail", "--limit", "1"]);
    expect(nestedPipelineTail.value).toEqual(pipelineTail.value);

    const pipelineCompact = await runJson(fixture.root, ["workflow", "pipeline", "compact"]);
    expect(pipelineCompact).toMatchObject({ ok: true, value: { projectionKind: "pipeline_compact", latestStatus: "TASK_DONE", total: 2 } });
    expect(JSON.stringify(pipelineCompact)).not.toContain("SDS-AC-1");

    const pipelineNext = await runJson(fixture.root, ["workflow", "pipeline-next"]);
    expect(pipelineNext).toMatchObject({ ok: true, value: { nextHint: "kiwi-pm" } });

    const session = await runJson(fixture.root, ["workflow", "session-status", "--run-id", fixture.runId]);
    expect(session).toMatchObject({ ok: true, value: { state: { run_id: fixture.runId, run: { status: "running" } } } });

    const worklog = await runJson(fixture.root, ["workflow", "worklog-tail", "--run-id", fixture.runId, "--limit", "1"]);
    expect(worklog).toMatchObject({ ok: true, value: { events: [expect.objectContaining({ eventKey: "kiwi-planner|worklog-a" })] } });
  });

  // The plan projections (doctor, diff, schema-check) and next-task selection left with the plan tools
  // (FR-NODE-211 AC-1); ambiguity is still reported rather than guessed.
  it("IR-CLI-031 AC-5: reports an ambiguous artifact instead of guessing", async () => {
    const fixture = await createWorkflowFixture();

    const ambiguous = await runJson(fixture.root, ["workflow", "artifacts", "--kind", "pm-state", "--run-id", "tie-run"]);
    expect(ambiguous).toMatchObject({ ok: true, value: { selected: null }, diagnosticsSummary: { byCode: { "SRS-E051": 1 } } });
  });

  it("treats logically deleted pipeline events as inactive unless include-deleted is requested", async () => {
    const fixture = await createWorkflowFixture();
    await write(
      fixture.root,
      "kiwi/pipeline.jsonl",
      [
        workflowEvent("pipeline-a"),
        workflowEvent("delete-pipeline-a", "CORRECTION", { corrects_run_id: "pipeline-a", operation: { kind: "logical_delete", reason: "obsolete" } })
      ].join("\n") + "\n"
    );

    const status = await runJson(fixture.root, ["workflow", "pipeline-status"]);
    expect(status).toMatchObject({ ok: true, value: { latestEvent: null, total: 2 } });

    const includeDeleted = await runJson(fixture.root, ["workflow", "pipeline-status", "--include-deleted"]);
    expect(includeDeleted).toMatchObject({ ok: true, value: { latestEvent: { event: { run_id: "delete-pipeline-a", status: "CORRECTION" } } } });
  });
});
