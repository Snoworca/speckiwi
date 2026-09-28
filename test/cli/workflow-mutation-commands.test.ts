import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text, "utf8");
}

async function read(root: string, relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

async function sha256(root: string, relativePath: string): Promise<string> {
  return createHash("sha256").update(await read(root, relativePath)).digest("hex");
}

async function runJson(root: string, args: string[], expectedCode = 0): Promise<Record<string, unknown>> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const code = await main(["--root", root, ...args, "--json"], { stdout, stderr });
  expect(code).toBe(expectedCode);
  return JSON.parse(stdout.read()?.toString() ?? "") as Record<string, unknown>;
}

function event(runId: string): string {
  return JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-pm", run_id: runId, status: "TASK_DONE" });
}

describe("IR-CLI-042 / IR-CLI-043 workflow mutation commands", () => {
  it("runs guarded workflow mutations with dry-run, no-op, stale, and logical-delete behavior", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await write(root, "kiwi/pipeline.jsonl", `${event("event-a")}\n`);
    const pipelineHash = await sha256(root, "kiwi/pipeline.jsonl");

    // The plan checkbox, checklist and PM task status commands left with plan mode (FR-NODE-211 AC-1);
    // the guards they exercised are exercised here on the journal writers that remain.
    const dryRun = await runJson(root, ["workflow", "pipeline-emit", "--run-id", "run-a", "--event", event("event-b"), "--expected-sha256", pipelineHash, "--dry-run"]);
    expect(dryRun).toMatchObject({ ok: true, value: { written: false, journalState: "skipped_dry_run" }, mutation: { kind: "pipeline_event_append", written: false } });
    expect(await sha256(root, "kiwi/pipeline.jsonl")).toBe(pipelineHash);

    const forbidden = await runJson(root, ["workflow", "logical-delete", "--run-id", "run-a", "--record-type", "pipeline_event", "--record-id", "event-a", "--reason", "obsolete", "--owner", "kiwi-coder"], 5);
    expect(forbidden).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" }, diagnosticsSummary: { byCode: { "SRS-E070": 1 } } });

    const emit = await runJson(root, ["workflow", "pipeline-emit", "--run-id", "run-a", "--event", event("event-b")]);
    expect(emit).toMatchObject({ ok: true, value: { written: true }, mutation: { kind: "pipeline_event_append" } });
    const duplicate = await runJson(root, ["workflow", "pipeline-emit", "--run-id", "run-a", "--event", event("event-b")]);
    expect(duplicate).toMatchObject({ ok: true, value: { written: false }, mutation: { operations: [] } });

    // @req FR-NODE-193 — an unreadable line is a warning: the emit reports it and proceeds. It used
    // to exit 5, which is what left an operator unable to record anything once their journal held a
    // single line the parser could not read.
    await write(root, ".kiwi/sessions/run-a/worklog.jsonl", "{bad\n");
    const invalidWorklog = await runJson(root, ["workflow", "worklog-emit", "--run-id", "run-a", "--event", event("worklog-a")]);
    expect(invalidWorklog).toMatchObject({ ok: true, value: { written: true }, diagnosticsSummary: { byCode: { "SRS-W052": 1 } } });

    await write(root, ".kiwi/sessions/run-a/worklog.jsonl", "");
    const repair = await runJson(root, ["workflow", "repair-record", "--run-id", "run-a", "--event", event("repair-a")]);
    expect(repair).toMatchObject({ ok: true, value: { written: true }, mutation: { kind: "workflow_repair_record" } });

    const deleted = await runJson(root, ["workflow", "logical-delete", "--run-id", "run-a", "--record-type", "pipeline_event", "--record-id", "event-a", "--reason", "obsolete"]);
    expect(deleted).toMatchObject({ ok: true, value: { written: true, targetRecord: { desiredState: "deleted", recordId: "event-a" } } });
    const pipelineText = await read(root, "kiwi/pipeline.jsonl");
    expect(pipelineText).toContain('"run_id":"event-a"');
    expect(pipelineText).toContain('"kind":"logical_delete"');

    const repeatedDelete = await runJson(root, ["workflow", "logical-delete", "--run-id", "run-a", "--record-type", "pipeline_event", "--record-id", "event-a", "--reason", "obsolete"]);
    expect(repeatedDelete).toMatchObject({ ok: true, value: { written: false }, mutation: { operations: [] } });
  });
});
