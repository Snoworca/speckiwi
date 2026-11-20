import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "./support/workspace-root-fixture.js";

// @req FR-NODE-310 — OG run 5091 (2026-11-14): three worklog events of one run without run_id and
// with task_id T-1, T-2, T-3 wrote only T-1; the other two answered confirmed and were dropped,
// because the append keyed every line by `skill|run_id`. Of two repair records with different
// reasons, only one was written.

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const RUN = "run-310";
const WORKLOG = `.kiwi/sessions/${RUN}/worklog.jsonl`;

interface Answer {
  ok: boolean;
  diagnostics?: Array<{ code: string }>;
  value?: { written?: boolean; journalState?: string; duplicateOf?: { line?: number; journalKey?: string } };
  mutation?: { written?: boolean; operations?: unknown[]; journalState?: string };
}

/** A committed repository holding valid-basic, checked to be the root in use. */
async function workspace(): Promise<string> {
  const directory = await gitWorkspaceRepo("fr-node-310-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  return directory;
}

type Tool = "workflow_worklog_emit" | "workflow_repair_record" | "workflow_pipeline_emit";
const COMMAND: Record<Tool, string> = { workflow_worklog_emit: "worklog-emit", workflow_repair_record: "repair-record", workflow_pipeline_emit: "pipeline-emit" };

async function viaMcp(root: string, tool: Tool, runId: string, event: Record<string, unknown>): Promise<Answer> {
  return (await createMcpServer({ root }).callTool(tool, { runId, event })) as Answer;
}

async function viaCli(root: string, tool: Tool, runId: string, event: Record<string, unknown>): Promise<Answer> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", root, "workflow", COMMAND[tool], "--run-id", runId, "--event", JSON.stringify(event), "--json"], pipes);
  return JSON.parse(pipes.stdout.read()?.toString() ?? "") as Answer;
}

type Emit = typeof viaMcp;
const SURFACES: Array<[string, Emit]> = [
  ["MCP", viaMcp],
  ["CLI", viaCli]
];

async function lines(root: string, relative = WORKLOG): Promise<Array<Record<string, unknown>>> {
  const file = path.join(root, relative);
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8")).split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function task(id: string): Record<string, unknown> {
  return { schema_version: "1.0.0", skill: "kiwi-coder", status: "TASK_DONE", task_id: id, summary: `task ${id}` };
}

describe("FR-NODE-310 AC-1 AC-2 — distinct lines of one run are all written", () => {
  // @req FR-NODE-310 AC-1
  it.each(SURFACES)("FR-NODE-310 AC-1: %s writes three worklog events that differ only in task_id", async (_surface, emit) => {
    const root = await workspace();
    for (const id of ["T-1", "T-2", "T-3"]) {
      const answer = await emit(root, "workflow_worklog_emit", RUN, task(id));
      expect(answer.ok, JSON.stringify(answer).slice(0, 400)).toBe(true);
      expect(answer.value?.written, id).toBe(true);
    }
    expect((await lines(root)).map((line) => line.task_id)).toEqual(["T-1", "T-2", "T-3"]);
  });

  // @req FR-NODE-310 AC-2
  it.each(SURFACES)("FR-NODE-310 AC-2: %s writes two repair records with different reasons", async (_surface, emit) => {
    const root = await workspace();
    for (const reason of ["lock file left behind", "stale artifact hash"]) {
      const answer = await emit(root, "workflow_repair_record", RUN, { schema_version: "1.0.0", skill: "kiwi-pm", status: "REPAIRED", reason });
      expect(answer.value?.written, reason).toBe(true);
    }
    expect((await lines(root)).map((line) => line.reason)).toEqual(["lock file left behind", "stale artifact hash"]);
  });
});

describe("FR-NODE-310 AC-3 — the same line twice is confirmed, not written", () => {
  // @req FR-NODE-310 AC-3
  it.each(SURFACES)("FR-NODE-310 AC-3: %s answers the repeated worklog event as a confirmed no-op naming the line", async (_surface, emit) => {
    const root = await workspace();
    expect((await emit(root, "workflow_worklog_emit", RUN, task("T-1"))).value?.written).toBe(true);
    const again = await emit(root, "workflow_worklog_emit", RUN, task("T-1"));
    expect(again.ok).toBe(true);
    expect(again.value?.written).toBe(false);
    expect(again.value?.journalState).toBe("confirmed");
    expect(again.mutation?.operations ?? []).toEqual([]);
    const written = await lines(root);
    expect(written).toHaveLength(1);
    expect(again.value?.duplicateOf).toMatchObject({ line: 1, journalKey: written[0]?.journal_key });
  });

  // @req FR-NODE-310 AC-3
  it("FR-NODE-310 AC-3: the repeated repair record is confirmed too", async () => {
    const root = await workspace();
    const record = { schema_version: "1.0.0", skill: "kiwi-pm", status: "REPAIRED", reason: "lock file left behind" };
    expect((await viaMcp(root, "workflow_repair_record", RUN, record)).value?.written).toBe(true);
    const again = await viaMcp(root, "workflow_repair_record", RUN, record);
    expect(again.value).toMatchObject({ written: false, journalState: "confirmed" });
    expect(await lines(root)).toHaveLength(1);
  });
});

describe("FR-NODE-310 AC-4 — run ids are checked before writing", () => {
  for (const tool of ["workflow_worklog_emit", "workflow_repair_record"] as const) {
    // @req FR-NODE-310 AC-4
    it(`FR-NODE-310 AC-4: ${tool} refuses a blank runId and a blank or non-string run_id with SRS-E071, writing nothing`, async () => {
      const root = await workspace();
      for (const [runId, event] of [["  ", task("T-1")], [RUN, { ...task("T-1"), run_id: "" }], [RUN, { ...task("T-1"), run_id: 7 }]] as const) {
        const answer = await viaMcp(root, tool, runId, event);
        expect(answer.ok, JSON.stringify(event)).toBe(false);
        expect((answer.diagnostics ?? []).map((item) => item.code)).toContain("SRS-E071");
      }
      expect(await lines(root)).toEqual([]);
      expect(existsSync(path.join(root, ".kiwi", "sessions", "  "))).toBe(false);
    });
  }

  // @req FR-NODE-310 AC-4
  it("FR-NODE-310 AC-4: an event without run_id is written without one, the run named by workflow_run_id", async () => {
    const root = await workspace();
    await viaMcp(root, "workflow_worklog_emit", RUN, task("T-1"));
    const [line] = await lines(root);
    expect(line && Object.hasOwn(line, "run_id")).toBe(false);
    expect(line?.workflow_run_id).toBe(RUN);
  });
});

describe("FR-NODE-310 AC-5 AC-6 — keyless lines and the pipeline rule", () => {
  // @req FR-NODE-310 AC-5
  it("FR-NODE-310 AC-5: a hand-written line with the same skill is never the duplicate", async () => {
    const root = await workspace();
    await mkdir(path.dirname(path.join(root, WORKLOG)), { recursive: true });
    await writeFile(path.join(root, WORKLOG), `${JSON.stringify(task("T-1"))}\n`, "utf8");
    const answer = await viaMcp(root, "workflow_worklog_emit", RUN, task("T-1"));
    expect(answer.value?.written).toBe(true);
    expect(await lines(root)).toHaveLength(2);
  });

  // @req FR-NODE-310 AC-6
  it.each(SURFACES)("FR-NODE-310 AC-6: %s keeps the pipeline's one-event-per-skill-and-run rule", async (_surface, emit) => {
    const root = await workspace();
    const event = { schema_version: "1.0.0", skill: "kiwi-orchestrator", status: "TASK_DONE", summary: "first", next_hint: null };
    expect((await emit(root, "workflow_pipeline_emit", "run-A", event)).value?.written).toBe(true);
    const sameRun = await emit(root, "workflow_pipeline_emit", "run-A", { ...event, summary: "second" });
    expect(sameRun.value).toMatchObject({ written: false, journalState: "confirmed" });
    expect((await emit(root, "workflow_pipeline_emit", "run-B", event)).value?.written).toBe(true);
    expect(await lines(root, "kiwi/pipeline.jsonl")).toHaveLength(2);
  });
});
