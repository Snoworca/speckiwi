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
  const stdout = new PassThrough() as NodeJS.WriteStream;
  const stderr = new PassThrough() as NodeJS.WriteStream;
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
    await write(root, "docs/plans/run-a.plan.md", "# Plan\n\n- [ ] **T-PH001-01** Implement task\n");
    await write(root, "kiwi/pipeline.jsonl", `${event("event-a")}\n`);
    const planHash = await sha256(root, "docs/plans/run-a.plan.md");

    const dryRun = await runJson(root, ["workflow", "task-check", "T-PH001-01", "--run-id", "run-a", "--path", "docs/plans/run-a.plan.md", "--expected-sha256", planHash, "--dry-run"]);
    expect(dryRun).toMatchObject({ ok: true, value: { written: false, journalState: "skipped_dry_run" }, mutation: { kind: "plan_checkbox_check", written: false } });
    expect(await read(root, "docs/plans/run-a.plan.md")).toContain("- [ ] **T-PH001-01**");

    const checked = await runJson(root, ["workflow", "task-check", "T-PH001-01", "--run-id", "run-a", "--path", "docs/plans/run-a.plan.md", "--expected-sha256", planHash]);
    expect(checked).toMatchObject({ ok: true, value: { written: true, journalKey: expect.any(String) }, mutation: { journalState: "confirmed" } });
    expect(await read(root, "docs/plans/run-a.plan.md")).toContain("- [x] **T-PH001-01**");

    const checklist = await runJson(root, ["workflow", "checklist-set", "T-PH001-01", "--run-id", "run-a", "--path", "docs/plans/run-a.plan.md", "--checked", "false"]);
    expect(checklist).toMatchObject({ ok: true, value: { written: true }, mutation: { kind: "plan_checklist_item_update" } });
    expect(await read(root, "docs/plans/run-a.plan.md")).toContain("- [ ] **T-PH001-01**");

    await write(root, ".kiwi/sessions/run-a/pm-state.json", JSON.stringify({ run_id: "run-a", tasks: [{ task_id: "T-PH001-01", status: "pending" }] }, null, 2));
    const statusSet = await runJson(root, ["workflow", "task-status-set", "T-PH001-01", "done", "--run-id", "run-a", "--pm-state-path", ".kiwi/sessions/run-a/pm-state.json"]);
    expect(statusSet).toMatchObject({ ok: true, value: { written: true }, mutation: { kind: "pm_task_status_update" } });
    expect(JSON.parse(await read(root, ".kiwi/sessions/run-a/pm-state.json")).tasks[0].status).toBe("done");

    const forbidden = await runJson(root, ["workflow", "task-uncheck", "T-PH001-01", "--run-id", "run-a", "--path", "docs/plans/run-a.plan.md", "--owner", "kiwi-coder"], 5);
    expect(forbidden).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" }, diagnosticsSummary: { byCode: { "SRS-E070": 1 } } });

    const emit = await runJson(root, ["workflow", "pipeline-emit", "--run-id", "run-a", "--event", event("event-b")]);
    expect(emit).toMatchObject({ ok: true, value: { written: true }, mutation: { kind: "pipeline_event_append" } });
    const duplicate = await runJson(root, ["workflow", "pipeline-emit", "--run-id", "run-a", "--event", event("event-b")]);
    expect(duplicate).toMatchObject({ ok: true, value: { written: false }, mutation: { operations: [] } });

    await write(root, ".kiwi/sessions/run-a/worklog.jsonl", "{bad\n");
    const invalidWorklog = await runJson(root, ["workflow", "worklog-emit", "--run-id", "run-a", "--event", event("worklog-a")], 5);
    expect(invalidWorklog).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" }, diagnosticsSummary: { byCode: { "SRS-W052": 1 } } });

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
