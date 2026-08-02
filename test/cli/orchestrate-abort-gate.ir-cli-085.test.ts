import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { registerOrchestrateCommands } from "../../src/cli/commands/orchestrate.js";
import { buildCommand } from "../../src/cli/command.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";

// @req IR-CLI-085 — `orchestrate run abort --reason` takes a `GateId` and nothing else.
// @req FR-NODE-167 AC-1 — the line it writes carries `abort_gate`, never a top-level `reason_class`.
//
// A refused abort must leave the lock HELD: releasing it on a refused append would end the run with
// nothing in the journal saying why. The operator retries with a gate id.

const execFileAsync = promisify(execFile);

/** A `GateId` member the shipped skill names as ending a run through `abort-run`. */
const LEGAL = "design-contradiction-at-wave-boundary";

/** A `reason_class` member and not a gate id — the exact value the pre-existing fixture passed. */
const ILLEGAL = "budget-exhausted";

function io() {
  return { stdout: new PassThrough(), stderr: new PassThrough() };
}

function drain(stream: PassThrough): string {
  return stream.read()?.toString() ?? "";
}

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function run(argv: string[]): Promise<Run> {
  const pipes = io();
  const exit = await main([...argv, "--json"], pipes);
  const text = drain(pipes.stdout);
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
}

/** A throwaway repository, never this one: the run lock lives inside `.git`. */
async function lockedRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-abort-gate-"));
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await write(root, "kiwi/waves.jsonl", "");
  const locked = await run(["--root", root, "orchestrate", "run", "lock", "--owner", "ir-cli-085-test"]);
  expect(locked.exit, JSON.stringify(locked.payload)).toBe(0);
  return root;
}

function journalPath(root: string): string {
  return path.join(root, "kiwi/waves.jsonl");
}

describe("IR-CLI-085 AC-1 — a GateId reason aborts and releases", () => {
  it("exits 0, writes one line and releases the lock", async () => {
    const root = await lockedRoot();

    const aborted = await run(["--root", root, "orchestrate", "run", "abort", "--reason", LEGAL, "--run-id", "run-a"]);
    expect(aborted.exit, JSON.stringify(aborted.payload)).toBe(0);

    const written = (await readFile(journalPath(root), "utf8")).trim().split("\n").filter(Boolean);
    expect(written, "abort writes exactly one line").toHaveLength(1);

    const released = await run(["--root", root, "orchestrate", "run", "status"]);
    expect(released.payload.holder, "abort must release the lock").toBeNull();

    const reacquired = await run(["--root", root, "orchestrate", "run", "lock", "--owner", "ir-cli-085-test-2"]);
    expect(reacquired.exit, JSON.stringify(reacquired.payload)).toBe(0);
    await run(["--root", root, "orchestrate", "run", "unlock"]);
  });
});

describe("FR-NODE-167 AC-1 — the abort line carries abort_gate and no reason_class", () => {
  it("names the field abort_gate and leaves the colliding name unwritten", async () => {
    const root = await lockedRoot();
    await run(["--root", root, "orchestrate", "run", "abort", "--reason", LEGAL, "--run-id", "run-a"]);

    const text = (await readFile(journalPath(root), "utf8")).trim();
    expect(text.length, "the abort must have written something to read").toBeGreaterThan(0);
    const record = JSON.parse(text) as Record<string, unknown>;

    expect(record.abort_gate).toBe(LEGAL);
    expect(Object.keys(record), "reason_class is owned by verification.residual[] and must not appear here").not.toContain(
      "reason_class"
    );
  });
});

describe("IR-CLI-085 AC-2 / AC-3 / AC-4 — a non-GateId reason is refused and changes nothing", () => {
  it("exits 2, leaves the journal byte-identical and leaves the lock held", async () => {
    expect(GATE_IDS as readonly string[]).not.toContain(ILLEGAL);
    const root = await lockedRoot();
    const before = await readFile(journalPath(root), "utf8");

    const refused = await run(["--root", root, "orchestrate", "run", "abort", "--reason", ILLEGAL, "--run-id", "run-a"]);

    expect(refused.exit, JSON.stringify(refused.payload)).toBe(2);
    expect(await readFile(journalPath(root), "utf8"), "a refused abort writes nothing").toBe(before);

    const held = await run(["--root", root, "orchestrate", "run", "status"]);
    expect((held.payload.holder as { owner?: string } | null)?.owner, "a refused abort must not release the lock").toBe(
      "ir-cli-085-test"
    );

    // AC-4: the refusal names the rule, not just some journal invariant.
    expect(JSON.stringify(refused.payload)).toContain("abort-gate-outside-vocabulary");

    await run(["--root", root, "orchestrate", "run", "unlock"]);
  });
});

describe("FR-NODE-167 AC-5 — a run holding a bad line can still be aborted", () => {
  it("appends and releases the lock over a journal whose earlier line offends", async () => {
    const root = await lockedRoot();
    // The failure mode the severity split exists to prevent, and the one nothing exercised: a line
    // written by hand — waves-event.md §5 has agents append with `echo >>`, bypassing validation —
    // carries a reason_class value in `abort_gate`. If the rule were error over history, the whole
    // journal would fail validation, every append would refuse, and `run abort` could never release
    // the lock. Nothing else in the suite performs an append at all.
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
    await write(root, "kiwi/waves.jsonl", `${stale}\n`);
    expect(GATE_IDS as readonly string[]).not.toContain(ILLEGAL);

    const before = await readFile(journalPath(root), "utf8");
    const aborted = await run(["--root", root, "orchestrate", "run", "abort", "--reason", LEGAL, "--run-id", "run-a"]);
    expect(aborted.exit, JSON.stringify(aborted.payload)).toBe(0);

    const after = await readFile(journalPath(root), "utf8");
    expect(after.length, "the abort must actually have been appended").toBeGreaterThan(before.length);
    const written = JSON.parse(after.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
    expect(written.abort_gate).toBe(LEGAL);

    // And the lock is released, which is the consequence that matters: a run that cannot abort is a
    // run whose lock nothing can free.
    const status = await run(["--root", root, "orchestrate", "run", "status"]);
    expect((status.payload as { holder?: unknown }).holder, "the lock must be released").toBeNull();
  });
});

describe("IR-CLI-085 AC-5 — the option help names the vocabulary", () => {
  it("does not describe --reason as free text alone", () => {
    const sink = { write: () => true } as unknown as NodeJS.WriteStream;
    const context = { io: { stdout: sink, stderr: sink } };
    const command = buildCommand(context);
    registerOrchestrateCommands(command, context);
    const abort = command.commands
      .find((entry) => entry.name() === "orchestrate")
      ?.commands.find((entry) => entry.name() === "run")
      ?.commands.find((entry) => entry.name() === "abort");
    expect(abort, "`orchestrate run abort` is registered").toBeDefined();

    const reason = abort?.options.find((option) => option.long === "--reason");
    expect(reason, "--reason is declared").toBeDefined();
    expect(reason?.description ?? "", "the help must name the vocabulary").toMatch(/gate/i);
  });
});
