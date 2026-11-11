import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { appendWorkflowJsonl } from "../../src/core/workflow/jsonl.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "./support/workspace-root-fixture.js";

// @req FR-NODE-300 — an append answers with its own line's diagnostics and a count per code for the
// lines already in the file, and records the emitting skill as owner.
//
// SSO-run-close-4908 (2026-11-11): one workflow_pipeline_emit answered 31,048 bytes, 139 warnings all of
// older lines, and its kiwi-orchestrator event was written with owner kiwi-pm.

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const JOURNAL = "kiwi/pipeline.jsonl";

function event(runId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema_version: "1.0.0", skill: "kiwi-orchestrator", run_id: runId, status: "TASK_DONE", ...extra };
}

/** 50 unsupported-schema lines, 50 lines of one event key, 40 lines that are not JSON. */
function noisyJournal(): string {
  const lines: string[] = [];
  for (let index = 0; index < 50; index += 1) lines.push(JSON.stringify(event(`old-${index}`, { schema_version: "0.1.0" })));
  for (let index = 0; index < 50; index += 1) lines.push(JSON.stringify(event("dup")));
  for (let index = 0; index < 40; index += 1) lines.push(`{"broken": ${index}`);
  return `${lines.join("\n")}\n`;
}

/** A committed repository holding valid-basic and a journal, checked to be the root in use. */
async function workspace(journal: string): Promise<string> {
  const directory = await gitWorkspaceRepo("fr-node-300-");
  const root = await resolveProjectRoot(directory);
  expect(path.resolve(root.root)).toBe(path.resolve(directory));
  expect(path.resolve(await rawGit(directory, "rev-parse", "--show-toplevel"))).toBe(path.resolve(directory));
  await mkdir(path.join(directory, "kiwi"), { recursive: true });
  await writeFile(path.join(directory, JOURNAL), journal);
  return directory;
}

interface Answer {
  ok: boolean;
  diagnostics?: Array<{ code: string }>;
  diagnosticsSummary?: { warnings: number; byCode: Record<string, number> };
  value?: { existingLineDiagnostics?: { total: number; byCode: Record<string, number> }; journalState?: string };
  error?: { code: string };
}

async function cli(root: string, args: string[]): Promise<{ text: string; answer: Answer }> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  await main(["--root", root, ...args, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { text, answer: JSON.parse(text) as Answer };
}

async function lastLine(root: string): Promise<Record<string, unknown>> {
  const lines = (await readFile(path.join(root, JOURNAL), "utf8")).trim().split("\n");
  return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

const EXISTING = { total: 139, byCode: { "SRS-W055": 50, "SRS-W053": 49, "SRS-W052": 40 } };

describe("FR-NODE-300 AC-1 — the appended line's diagnostics in full, the rest as counts", () => {
  it("MCP workflow_pipeline_emit answers under 4,000 characters over 140 noisy lines", async () => {
    const root = await workspace(noisyJournal());
    const answer = (await createMcpServer({ root }).callTool("workflow_pipeline_emit", { runId: "run-new", event: event("run-new") })) as Answer;
    expect(answer.ok, JSON.stringify(answer).slice(0, 500)).toBe(true);
    expect(answer.diagnostics).toEqual([]);
    expect(answer.value?.existingLineDiagnostics).toEqual(EXISTING);
    expect(answer.diagnosticsSummary).toMatchObject({ warnings: 139, byCode: EXISTING.byCode });
    expect(JSON.stringify(answer).length).toBeLessThan(4000);
  });

  it("the CLI answers the same way", async () => {
    const root = await workspace(noisyJournal());
    const { text, answer } = await cli(root, ["workflow", "pipeline-emit", "--run-id", "run-new", "--event", JSON.stringify(event("run-new"))]);
    expect(answer.ok).toBe(true);
    expect(answer.diagnostics).toEqual([]);
    expect(answer.value?.existingLineDiagnostics).toEqual(EXISTING);
    expect(text.length).toBeLessThan(4000);
  });

  it("keeps the appended line's own warning in diagnostics, and it is not counted as an existing line's", async () => {
    const root = await workspace(noisyJournal());
    const answer = (await createMcpServer({ root }).callTool("workflow_pipeline_emit", {
      runId: "run-new",
      event: event("run-new", { schema_version: "0.0.9" })
    })) as Answer;
    expect(answer.ok).toBe(true);
    expect(answer.diagnostics?.map((entry) => entry.code)).toEqual(["SRS-W055"]);
    expect(answer.value?.existingLineDiagnostics).toEqual(EXISTING);
    expect(answer.diagnosticsSummary?.warnings).toBe(140);
  });

  it("the core append carries the counts on its value", async () => {
    const root = await workspace(noisyJournal());
    const result = await appendWorkflowJsonl(await resolveProjectRoot(root), JOURNAL, event("run-core"));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect((result.value as Answer["value"])?.existingLineDiagnostics).toEqual(EXISTING);
  });
});

describe("FR-NODE-300 AC-2 — a confirmed duplicate reports the existing lines the same way", () => {
  it("answers the second emit of one event with counts, not entries", async () => {
    const root = await workspace(noisyJournal());
    const server = createMcpServer({ root });
    expect(((await server.callTool("workflow_pipeline_emit", { runId: "run-new", event: event("run-new") })) as Answer).ok).toBe(true);
    const again = (await server.callTool("workflow_pipeline_emit", { runId: "run-new", event: event("run-new") })) as Answer;
    expect(again.ok).toBe(true);
    expect(again.value?.journalState).toBe("confirmed");
    expect(again.diagnostics).toEqual([]);
    expect(again.value?.existingLineDiagnostics?.total).toBe(139);
    expect(JSON.stringify(again).length).toBeLessThan(4000);
  });
});

describe("FR-NODE-300 AC-2 — a repeated logical delete reports the existing lines as counts", () => {
  it("answers the second delete of one record with counts, not entries", async () => {
    // logical delete refuses a journal holding an unreadable line, so this one holds only readable warnings.
    const readable = noisyJournal().split("\n").filter((line) => line.startsWith("{\"schema"));
    const root = await workspace(`${[...readable, JSON.stringify(event("target-run"))].join("\n")}\n`);
    const server = createMcpServer({ root });
    const args = { runId: "r-delete", recordType: "pipeline_event", recordId: "target-run", reason: "test" };
    const first = (await server.callTool("workflow_logical_delete", args)) as Answer;
    expect(first.ok, JSON.stringify(first).slice(0, 400)).toBe(true);
    const again = (await server.callTool("workflow_logical_delete", args)) as Answer;
    expect(again.ok, JSON.stringify(again).slice(0, 300)).toBe(true);
    expect(again.value?.journalState).toBe("confirmed");
    expect(again.diagnostics).toEqual([]);
    expect(again.value?.existingLineDiagnostics?.total).toBeGreaterThanOrEqual(99);
    expect(JSON.stringify(again).length).toBeLessThan(4000);
  });
});

describe("FR-NODE-300 AC-3 — a stale refusal still reports what it refused on", () => {
  it("refuses a stale expected hash without writing", async () => {
    const root = await workspace(noisyJournal());
    const before = await readFile(path.join(root, JOURNAL), "utf8");
    const answer = (await createMcpServer({ root }).callTool("workflow_pipeline_emit", {
      runId: "run-new",
      event: event("run-new"),
      expectedSha256: "0".repeat(64)
    })) as Answer;
    expect(answer.ok).toBe(false);
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(before);
  });
});

describe("FR-NODE-300 AC-4 — owner defaults to the event's skill", () => {
  it("writes the skill as owner through MCP when no owner is named", async () => {
    const root = await workspace("");
    expect(((await createMcpServer({ root }).callTool("workflow_pipeline_emit", { runId: "r1", event: event("r1") })) as Answer).ok).toBe(true);
    expect((await lastLine(root)).owner).toBe("kiwi-orchestrator");
  });

  it("writes the skill as owner through the CLI when no owner is named", async () => {
    const root = await workspace("");
    expect((await cli(root, ["workflow", "pipeline-emit", "--run-id", "r1", "--event", JSON.stringify(event("r1"))])).answer.ok).toBe(true);
    expect((await lastLine(root)).owner).toBe("kiwi-orchestrator");
  });

  it("keeps an owner the caller names", async () => {
    const root = await workspace("");
    expect(((await createMcpServer({ root }).callTool("workflow_pipeline_emit", { runId: "r1", owner: "someone", event: event("r1") })) as Answer).ok).toBe(true);
    expect((await lastLine(root)).owner).toBe("someone");
    const cliRoot = await workspace("");
    expect((await cli(cliRoot, ["workflow", "pipeline-emit", "--run-id", "r1", "--owner", "someone", "--event", JSON.stringify(event("r1"))])).answer.ok).toBe(true);
    expect((await lastLine(cliRoot)).owner).toBe("someone");
  });

  it("gives repair-record the same owner through MCP and the CLI (FR-MCP-037 AC-6)", async () => {
    const repair = { schema_version: "1.0.0", skill: "kiwi-hot-fix", run_id: "repair-1", status: "TASK_DONE" };
    const mcpRoot = await workspace("");
    expect(((await createMcpServer({ root: mcpRoot }).callTool("workflow_repair_record", { runId: "r1", event: repair })) as Answer).ok).toBe(true);
    const cliRoot = await workspace("");
    expect((await cli(cliRoot, ["workflow", "repair-record", "--run-id", "r1", "--event", JSON.stringify(repair)])).answer.ok).toBe(true);
    const lastOf = async (root: string) => {
      const lines = (await readFile(path.join(root, ".kiwi/sessions/r1/worklog.jsonl"), "utf8")).trim().split("\n");
      return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
    };
    expect((await lastOf(mcpRoot)).owner).toBe("kiwi-hot-fix");
    expect((await lastOf(cliRoot)).owner).toBe("kiwi-hot-fix");
  });

  it("keeps workflow_logical_delete's kiwi-pm default", async () => {
    const root = await workspace(`${JSON.stringify(event("r0"))}\n`);
    const answer = (await createMcpServer({ root }).callTool("workflow_logical_delete", {
      runId: "r-delete",
      recordType: "pipeline_event",
      recordId: "r0",
      reason: "test"
    })) as Answer;
    expect(answer.ok, JSON.stringify(answer).slice(0, 400)).toBe(true);
    expect((await lastLine(root)).owner).toBe("kiwi-pm");
  });
});
