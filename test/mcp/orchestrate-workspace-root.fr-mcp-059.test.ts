import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { cleanupFixtures, gitWorkspaceRepo, linkedWorktree } from "./support/workspace-root-fixture.js";

const JOURNAL = path.posix.join("kiwi", "waves.jsonl");

const LANE_LINE = {
  schema_version: "1.4.0",
  run_id: "run-lane",
  engine: "kiwi-orchestrator",
  verb: "author-design",
  event: "intent",
  wave: "wave-1"
};

function serverFor(root: string) {
  const server = createTestMcpServer({ root });
  registerReadTools(server, { root });
  registerMutationTools(server, { root });
  return server;
}

async function seedJournal(root: string): Promise<void> {
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, JOURNAL), "", "utf8");
}

afterAll(async () => {
  await cleanupFixtures();
});

describe("FR-MCP-059 AC-5 — the run a journal append lands in is the worktree's run", { timeout: 180_000 }, () => {
  it("appends to the worktree's journal and leaves the startup root's journal unchanged", async () => {
    const host = await gitWorkspaceRepo("frmcp059-ac5");
    const lane = await linkedWorktree(host, "frmcp059-ac5-wt", "lane-059-ac5");
    await seedJournal(host);
    await seedJournal(lane);
    const server = serverFor(host);

    const appended = await server.callTool("orchestrate_journal_append", {
      workspaceRoot: lane,
      runId: "run-lane",
      payload: LANE_LINE,
      journal: JOURNAL
    });
    expect(appended, JSON.stringify(appended)).toMatchObject({ applied: true, written: true, exitCode: 0 });

    const laneJournal = await readFile(path.join(lane, JOURNAL), "utf8");
    expect(laneJournal.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(laneJournal.trim()) as { run_id: string }).toMatchObject({ run_id: "run-lane" });

    expect(await readFile(path.join(host, JOURNAL), "utf8"), "the startup root's journal must be untouched").toBe("");
  });
});
