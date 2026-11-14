import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "./support/workspace-root-fixture.js";

// @req FR-NODE-309 — OG run 5091 (2026-11-13): two workflow_pipeline_emit calls whose event carried no
// run_id answered written:false / confirmed and wrote nothing, because the duplicate key `skill|`
// matched another run's line that this tool had written without run_id.

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const JOURNAL = "kiwi/pipeline.jsonl";

/** An event as OG run 5091 sent it: no run_id. */
function bare(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema_version: "1.0.0", skill: "kiwi-orchestrator", status: "TASK_DONE", summary: "done", next_hint: null, ...extra };
}

/** OG journal line 281: written by this tool without run_id, for another run. */
const OG_LINE_281 = JSON.stringify({ skill: "kiwi-orchestrator", status: "TASK_DONE", summary: "older run", next_hint: null, workflow_run_id: "2026-11-11.sso-unified-login", journal_key: "a".repeat(64), idempotency_key: "a".repeat(64), journal_state: "planned", owner: "kiwi-pm" });

interface Answer {
  ok: boolean;
  diagnostics?: Array<{ code: string }>;
  value?: { written?: boolean; journalState?: string; duplicateOf?: Record<string, unknown> };
  mutation?: { written?: boolean; operations?: unknown[]; journalState?: string };
}

/** A committed repository holding valid-basic, checked to be the root in use, with an optional journal. */
async function workspace(journal?: string): Promise<string> {
  const directory = await gitWorkspaceRepo("fr-node-309-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  if (journal !== undefined) {
    await mkdir(path.join(directory, "kiwi"), { recursive: true });
    await writeFile(path.join(directory, JOURNAL), journal);
  }
  return directory;
}

async function mcp(root: string, args: Record<string, unknown>): Promise<Answer> {
  return (await createMcpServer({ root }).callTool("workflow_pipeline_emit", args)) as Answer;
}

async function cli(root: string, runId: string, event: Record<string, unknown>): Promise<Answer> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", root, "workflow", "pipeline-emit", "--run-id", runId, "--event", JSON.stringify(event), "--json"], pipes);
  return JSON.parse(pipes.stdout.read()?.toString() ?? "") as Answer;
}

type Emit = (root: string, runId: string, event: Record<string, unknown>) => Promise<Answer>;
const SURFACES: Array<[string, Emit]> = [
  ["MCP", (root, runId, event) => mcp(root, { runId, event })],
  ["CLI", cli]
];

async function lines(root: string): Promise<Array<Record<string, unknown>>> {
  const file = path.join(root, JOURNAL);
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8")).split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("FR-NODE-309 AC-1 — an event without run_id takes the call's runId", () => {
  // @req FR-NODE-309 AC-1
  it.each(SURFACES)("FR-NODE-309 AC-1: %s writes run-X and then run-Y into an empty journal, each line carrying its run_id", async (_surface, emit) => {
    const root = await workspace();
    const first = await emit(root, "run-X", bare());
    expect(first.ok, JSON.stringify(first).slice(0, 400)).toBe(true);
    expect(first.value?.written).toBe(true);
    const second = await emit(root, "run-Y", bare());
    expect(second.ok, JSON.stringify(second).slice(0, 400)).toBe(true);
    expect(second.value?.written).toBe(true);
    expect((await lines(root)).map((line) => line.run_id)).toEqual(["run-X", "run-Y"]);
  });

  // @req FR-NODE-309 AC-1
  it("FR-NODE-309 AC-1: an event that names its own run_id keeps it", async () => {
    const root = await workspace();
    const answer = await mcp(root, { runId: "run-call", event: bare({ run_id: "run-event#r2" }) });
    expect(answer.value?.written).toBe(true);
    expect((await lines(root)).map((line) => line.run_id)).toEqual(["run-event#r2"]);
  });
});

describe("FR-NODE-309 AC-2 — a run_id that cannot key the event is refused before writing", () => {
  const CASES: Array<[string, Record<string, unknown>]> = [
    ["a blank event run_id", { runId: "run-X", event: bare({ run_id: "  " }) }],
    ["a non-string event run_id", { runId: "run-X", event: bare({ run_id: 42 }) }],
    ["a null event run_id", { runId: "run-X", event: bare({ run_id: null }) }],
    ["a blank runId", { runId: " ", event: bare() }]
  ];

  // @req FR-NODE-309 AC-2
  it.each(CASES)("FR-NODE-309 AC-2: MCP refuses %s with SRS-E071 and writes nothing", async (_name, args) => {
    const root = await workspace(`${OG_LINE_281}\n`);
    const before = await readFile(path.join(root, JOURNAL), "utf8");
    const answer = await mcp(root, args);
    expect(answer.ok).toBe(false);
    expect(answer.diagnostics?.map((entry) => entry.code)).toContain("SRS-E071");
    expect(answer.mutation?.written).toBe(false);
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(before);
  });

  // @req FR-NODE-309 AC-2
  it("FR-NODE-309 AC-2: the CLI refuses a blank event run_id and creates no journal", async () => {
    const root = await workspace();
    const answer = await cli(root, "run-X", bare({ run_id: "" }));
    expect(answer.ok).toBe(false);
    expect(answer.diagnostics?.map((entry) => entry.code)).toContain("SRS-E071");
    expect(existsSync(path.join(root, JOURNAL))).toBe(false);
  });
});

describe("FR-NODE-309 AC-3 — a line without skill or run_id is never a duplicate", () => {
  // @req FR-NODE-309 AC-3
  it.each(SURFACES)("FR-NODE-309 AC-3: %s appends over OG line 281 instead of confirming without writing", async (_surface, emit) => {
    const root = await workspace(`${OG_LINE_281}\n`);
    const answer = await emit(root, "2026-11-13.og-clone-5091.issue-5091-dns-premise", bare());
    expect(answer.ok, JSON.stringify(answer).slice(0, 400)).toBe(true);
    expect(answer.value?.written).toBe(true);
    expect(answer.value?.duplicateOf).toBeUndefined();
    const written = await lines(root);
    expect(written).toHaveLength(2);
    expect(written[1]?.run_id).toBe("2026-11-13.og-clone-5091.issue-5091-dns-premise");
  });

  // @req FR-NODE-309 AC-3
  it("FR-NODE-309 AC-3: a line without skill does not swallow an event without skill of the same run_id", async () => {
    const root = await workspace(`${JSON.stringify({ schema_version: "1.0.0", run_id: "run-Z", status: "TASK_DONE" })}\n`);
    const answer = await mcp(root, { runId: "run-Z", owner: "kiwi-pm", event: { schema_version: "1.0.0", run_id: "run-Z", status: "TASK_DONE" } });
    expect(answer.ok, JSON.stringify(answer).slice(0, 400)).toBe(true);
    expect(answer.value?.written).toBe(true);
    expect(await lines(root)).toHaveLength(2);
  });
});

describe("FR-NODE-309 AC-4 — a skipped append names the line it matched", () => {
  // @req FR-NODE-309 AC-4
  it.each(SURFACES)("FR-NODE-309 AC-4: %s reports file, line, byte offset, event key and the line's journal_key", async (_surface, emit) => {
    const root = await workspace(`${OG_LINE_281}\n`);
    expect((await emit(root, "run-A", bare())).value?.written).toBe(true);
    const again = await emit(root, "run-A", bare());
    expect(again.value?.written).toBe(false);
    const matched = (await lines(root))[1] as Record<string, unknown>;
    expect(again.value?.duplicateOf).toEqual({
      filePath: JOURNAL,
      line: 2,
      byteOffset: Buffer.byteLength(OG_LINE_281) + 1,
      eventKey: "kiwi-orchestrator|run-A",
      journalKey: matched.journal_key
    });
  });

  // @req FR-NODE-309 AC-4
  it("FR-NODE-309 AC-4: a matched line without journal_key is reported without journalKey", async () => {
    const seeded = JSON.stringify({ schema_version: "1.0.0", skill: "kiwi-srs", run_id: "run-S", status: "TASK_DONE" });
    const root = await workspace(`${seeded}\n`);
    const answer = await mcp(root, { runId: "run-S", event: { schema_version: "1.0.0", skill: "kiwi-srs", run_id: "run-S", status: "TASK_DONE" } });
    expect(answer.value?.written).toBe(false);
    expect(answer.value?.duplicateOf).toEqual({ filePath: JOURNAL, line: 1, byteOffset: 0, eventKey: "kiwi-srs|run-S" });
  });

  // @req FR-NODE-309 AC-4
  it("FR-NODE-309 AC-4: a skipped worklog append names its matched line too", async () => {
    const root = await workspace();
    const server = createMcpServer({ root });
    const args = { runId: "run-W", taskId: "T-1", owner: "kiwi-coder", path: "kiwi/worklog.jsonl", event: { schema_version: "1.0.0", skill: "kiwi-coder", run_id: "run-W", task_id: "T-1" } };
    expect(((await server.callTool("workflow_worklog_emit", args)) as Answer).value?.written).toBe(true);
    const again = (await server.callTool("workflow_worklog_emit", args)) as Answer;
    expect(again.value?.written).toBe(false);
    expect(again.value?.duplicateOf).toMatchObject({ filePath: "kiwi/worklog.jsonl", line: 1, byteOffset: 0, eventKey: "kiwi-coder|run-W" });
  });

  // @req FR-NODE-309 AC-4
  it("FR-NODE-309 AC-4: the answer with duplicateOf stays under FR-NODE-300's 4,000 characters", async () => {
    const root = await workspace(`${OG_LINE_281}\n`);
    await mcp(root, { runId: "run-A", event: bare() });
    const again = await mcp(root, { runId: "run-A", event: bare() });
    expect(again.value?.duplicateOf).toBeDefined();
    expect(JSON.stringify(again).length).toBeLessThan(4000);
  });
});

describe("FR-NODE-309 AC-5 — a real duplicate stays a confirmed no-op", () => {
  // @req FR-NODE-309 AC-5
  it.each(SURFACES)("FR-NODE-309 AC-5: %s answers the second emit of one skill and run_id with written false, confirmed and no operations", async (_surface, emit) => {
    const root = await workspace();
    const first = await emit(root, "run-D", bare({ run_id: "run-D" }));
    expect(first.value?.written).toBe(true);
    expect(first.mutation?.operations?.length).toBeGreaterThan(0);
    const before = await readFile(path.join(root, JOURNAL), "utf8");
    const second = await emit(root, "run-D", bare());
    expect(second.ok).toBe(true);
    expect(second.value?.written).toBe(false);
    expect(second.value?.journalState).toBe("confirmed");
    expect(second.mutation?.operations).toEqual([]);
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(before);
  });
});
