import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// IR-CLI-042 AC-3 — for the pipeline, worklog and repair-record appends, an unreadable or unsupported
// line already in the journal is reported as a warning and does not stop the append (FR-NODE-193).
// Each of the three commands is run over the same damaged journal.

/** One line the parser cannot read, and one written before `schema_version` existed. */
const DAMAGED = `{bad\n${JSON.stringify({ ts: "2026-07-10T00:00:00.000Z", run_id: "old", skill: "kiwi-pm", status: "TASK_DONE" })}\n`;

const COMMANDS = [
  { command: "pipeline-emit", kind: "pipeline_event_append", journal: "kiwi/pipeline.jsonl" },
  { command: "worklog-emit", kind: "worklog_event_append", journal: ".kiwi/sessions/run-a/worklog.jsonl" },
  { command: "repair-record", kind: "workflow_repair_record", journal: ".kiwi/sessions/run-a/worklog.jsonl" }
] as const;

async function runJson(root: string, args: string[]): Promise<{ exit: number; payload: Record<string, unknown> }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, ...args, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("IR-CLI-042 AC-3 — an append over a journal that already holds an unreadable line", () => {
  it.each(COMMANDS)("IR-CLI-042 AC-3: workflow $command reports the unreadable and the unsupported line as warnings and appends after them", async ({ command, kind, journal }) => {
    const root = await copyFixtureWorkspace("valid-basic");
    const absolute = path.join(root, journal);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, DAMAGED, "utf8");

    const event = { schema_version: "1.0.0", skill: "kiwi-pm", run_id: `${command}-event`, status: "TASK_DONE" };
    const result = await runJson(root, ["workflow", command, "--run-id", "run-a", "--event", JSON.stringify(event)]);

    expect(result.exit, JSON.stringify(result.payload)).toBe(0);
    expect(result.payload).toMatchObject({ ok: true, value: { written: true }, mutation: { kind } });
    const diagnostics = (result.payload.diagnostics ?? []) as Array<{ code: string; severity: string }>;
    const warnings = diagnostics.filter((entry) => entry.severity === "warning").map((entry) => entry.code);
    expect(warnings).toEqual(expect.arrayContaining(["SRS-W052", "SRS-W055"]));

    const after = await readFile(absolute, "utf8");
    expect(after.startsWith(DAMAGED), "the lines the command could not read are left as they were").toBe(true);
    const appended = after.slice(DAMAGED.length).trim().split("\n");
    expect(appended).toHaveLength(1);
    expect(JSON.parse(appended[0] as string)).toMatchObject({ run_id: `${command}-event` });
  });
});
