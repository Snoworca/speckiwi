import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { createMcpServer } from "../../src/mcp/server.js";

// @req FR-NODE-320 — found 2026-11-20: `orchestrate run abort --dry-run --reason <not a GateId>`
// answered ok, and only the real call refused the reason with abort-gate-outside-vocabulary.

const execFileAsync = promisify(execFile);
const ILLEGAL = "budget-exhausted";
const LEGAL = "design-contradiction-at-wave-boundary";
const JOURNAL = path.join("kiwi", "waves.jsonl");

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function run(argv: string[]): Promise<Run> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main([...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** A throwaway repository holding the run lock, never this one: the run lock lives inside `.git`. */
async function lockedRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-abort-dry-"));
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  expect(path.resolve((await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: root })).stdout.trim())).toBe(path.resolve(root));
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, JOURNAL), "", "utf8");
  const locked = await run(["--root", root, "orchestrate", "run", "lock", "--owner", "fr-node-320-test"]);
  expect(locked.exit, JSON.stringify(locked.payload)).toBe(0);
  return root;
}

async function holder(root: string): Promise<string | undefined> {
  const status = await run(["--root", root, "orchestrate", "run", "status"]);
  return (status.payload.holder as { owner?: string } | null)?.owner;
}

/** The refusal without the fields only a dry run or a real run can carry. */
function refusal(payload: Record<string, unknown>): unknown {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "dryRun"));
}

describe("FR-NODE-320 AC-1 — the dry run refuses the reason the real call refuses", () => {
  // @req FR-NODE-320 AC-1
  it("exits 2 with the real call's refusal, writes nothing and keeps the lock", async () => {
    expect(GATE_IDS as readonly string[]).not.toContain(ILLEGAL);
    const root = await lockedRoot();
    const before = await readFile(path.join(root, JOURNAL), "utf8");

    const dry = await run(["--root", root, "orchestrate", "run", "abort", "--reason", ILLEGAL, "--run-id", "run-a", "--dry-run"]);
    expect(dry.exit, JSON.stringify(dry.payload)).toBe(2);
    expect(JSON.stringify(dry.payload)).toContain("abort-gate-outside-vocabulary");
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(before);
    expect(await holder(root)).toBe("fr-node-320-test");

    const real = await run(["--root", root, "orchestrate", "run", "abort", "--reason", ILLEGAL, "--run-id", "run-a"]);
    expect(real.exit).toBe(2);
    expect(refusal(dry.payload)).toEqual(refusal(real.payload));
    await run(["--root", root, "orchestrate", "run", "unlock"]);
  });
});

describe("FR-NODE-320 AC-2 — the MCP tool refuses it too", () => {
  // @req FR-NODE-320 AC-2
  it("orchestrate_run_abort with dryRun refuses a reason outside GATE_IDS", async () => {
    const root = await lockedRoot();
    const before = await readFile(path.join(root, JOURNAL), "utf8");
    const answer = (await createMcpServer({ root }).callTool("orchestrate_run_abort", { reason: ILLEGAL, runId: "run-a", dryRun: true })) as { ok: boolean };
    expect(answer.ok).toBe(false);
    expect(JSON.stringify(answer)).toContain("abort-gate-outside-vocabulary");
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(before);
    expect(await holder(root)).toBe("fr-node-320-test");
    await run(["--root", root, "orchestrate", "run", "unlock"]);
  });
});

describe("FR-NODE-320 AC-3 — a GateId reason answers as before", () => {
  // @req FR-NODE-320 AC-3
  it("exits 0, writes nothing and keeps the lock", async () => {
    const root = await lockedRoot();
    const before = await readFile(path.join(root, JOURNAL), "utf8");
    const dry = await run(["--root", root, "orchestrate", "run", "abort", "--reason", LEGAL, "--run-id", "run-a", "--dry-run"]);
    expect(dry.exit, JSON.stringify(dry.payload)).toBe(0);
    expect(JSON.stringify(dry.payload)).toContain('"journalWritten":false');
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(before);
    expect(await holder(root)).toBe("fr-node-320-test");
    await run(["--root", root, "orchestrate", "run", "unlock"]);
  });

  // @req FR-NODE-320 AC-3 — an earlier hand-written line that offends is a warning, not a refusal
  // (FR-NODE-167 AC-5): the real abort appends over it, so the dry run must pass over it too.
  it("passes over an earlier offending line, as the real abort does", async () => {
    const root = await lockedRoot();
    const stale = JSON.stringify({
      ts: "2026-08-01T00:00:00Z",
      schema_version: "1.4.0",
      run_id: "run-a",
      engine: "kiwi-orchestrator",
      writer: "speckiwi-orchestrate/test",
      verb: "abort-run",
      event: "result",
      wave: "all",
      order: 0,
      target: "run",
      status: "failed",
      summary: "hand-written abort",
      abort_gate: ILLEGAL
    });
    await writeFile(path.join(root, JOURNAL), `${stale}\n`, "utf8");
    const before = await readFile(path.join(root, JOURNAL), "utf8");
    const dry = await run(["--root", root, "orchestrate", "run", "abort", "--reason", LEGAL, "--run-id", "run-a", "--dry-run"]);
    expect(dry.exit, JSON.stringify(dry.payload)).toBe(0);
    expect(await readFile(path.join(root, JOURNAL), "utf8")).toBe(before);
    expect(await holder(root)).toBe("fr-node-320-test");
    await run(["--root", root, "orchestrate", "run", "unlock"]);
  });
});
