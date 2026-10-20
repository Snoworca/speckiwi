import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { buildCommand } from "../../src/cli/command.js";
import {
  ORCHESTRATE_MCP_TOOLS,
  ORCHESTRATE_TOOL_BINDINGS,
  orchestrateVerbKind,
  registerOrchestrateCommands
} from "../../src/cli/commands/orchestrate.js";
import { createMcpServer, isReadOnlyTool, toolSchemas } from "../../src/mcp/server.js";

// IR-CLI-104 — `speckiwi orchestrate wave status` reports each wave's current state by the predicate
// resume uses, and writes nothing.

const JOURNAL = "kiwi/waves.jsonl";
type Line = Record<string, unknown>;

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function orchestrate(root: string, argv: readonly string[]): Promise<Run> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function rootWith(lines: readonly Line[], files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-ir-cli-104-"));
  await mkdir(path.join(root, "kiwi"), { recursive: true });
  await writeFile(path.join(root, JOURNAL), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8");
  for (const [relativePath, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), text, "utf8");
  }
  return root;
}

function waveLine(runId: string, n: number, status: string, extra: Line = {}): Line {
  return {
    schema_version: "2.0.0",
    ts: `2026-10-20T0${n}:00:00.000Z`,
    run_id: runId,
    engine: "kiwi-orchestrator",
    wave: `wave-${n}`,
    order: n,
    target: "4.1.0",
    status,
    summary: `wave ${n} ${status}`,
    ...extra
  };
}

function abortLine(runId: string): Line {
  return { schema_version: "2.0.0", run_id: runId, engine: "kiwi-orchestrator", verb: "abort-run", event: "result", wave: "all", abort_gate: "run-invariant-drift" };
}

function finalVerifyPass(runId: string): Line {
  return { ...waveLine(runId, 9, "complete"), wave: "all", phase: "final-verify", verification: { verdict: "pass" } };
}

const W1 = waveLine("r1", 1, "complete", { phase: "wave-verify", sds_id: "r1-wave-1", stage: 1, lane: "lane-r1-wave-1" });
const W2 = waveLine("r1", 2, "in_progress", { phase: "execute", stage: 2, lane: "lane-r1-wave-2" });

describe("IR-CLI-104 AC-1 each wave's latest state, and the run's", () => {
  it("IR-CLI-104 AC-1 lists status, phase, sds_id, stage, lane and ts per wave", async () => {
    const root = await rootWith([W1, W2]);
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.waves).toEqual([
      { wave: "wave-1", status: "complete", phase: "wave-verify", sds_id: "r1-wave-1", stage: 1, lane: "lane-r1-wave-1", ts: W1.ts },
      { wave: "wave-2", status: "in_progress", phase: "execute", sds_id: null, stage: 2, lane: "lane-r1-wave-2", ts: W2.ts }
    ]);
    expect(run.payload.run).toEqual({ runId: "r1", engine: "kiwi-orchestrator", complete: false, needsFinalVerify: false, aborted: false });
  });

  it("IR-CLI-104 AC-1 says a run whose waves are all complete needs final verification, and that a passing one completes it", async () => {
    const needs = await rootWith([W1]);
    expect((await orchestrate(needs, ["wave", "status", "--run-id", "r1"])).payload.run).toMatchObject({ complete: false, needsFinalVerify: true });
    const done = await rootWith([W1, finalVerifyPass("r1")]);
    expect((await orchestrate(done, ["wave", "status", "--run-id", "r1"])).payload.run).toMatchObject({ complete: true, needsFinalVerify: false });
  });

  it("IR-CLI-104 AC-1 says when the run was aborted", async () => {
    const root = await rootWith([W2, abortLine("r1")]);
    expect((await orchestrate(root, ["wave", "status", "--run-id", "r1"])).payload.run).toMatchObject({ aborted: true });
  });
});

describe("IR-CLI-104 AC-2 --waves lists the entries schedule waves would plan", () => {
  it("IR-CLI-104 AC-2 reports ready[] from the same function schedule waves --waves plans from", async () => {
    const declaration = JSON.stringify({
      schema_version: "1.0.0",
      waves: [
        { wave: "wave-1", depends_on: [], files: ["src/a.ts"], requirements: ["FR-ARCH-001"] },
        { wave: "wave-2", depends_on: ["wave-1"], files: ["src/b.ts"], requirements: ["FR-ARCH-001"] },
        { wave: "wave-3", depends_on: [], files: ["src/c.ts"], requirements: ["FR-ARCH-001"] },
        { wave: "wave-4", depends_on: ["wave-2"], files: ["src/d.ts"], requirements: ["FR-ARCH-001"] }
      ]
    });
    const root = await rootWith([W1], { "waves/waves.json": declaration });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1", "--waves", "waves/waves.json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.ready).toEqual(["wave-2", "wave-3"]);
  });

  it("IR-CLI-104 AC-2 refuses a malformed declaration as schedule waves does", async () => {
    const root = await rootWith([W1], { "waves/waves.json": JSON.stringify({ schema_version: "1.0.0", waves: [{ wave: "api", files: [], requirements: [] }] }) });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1", "--waves", "waves/waves.json"]);
    expect(run.exit).toBe(1);
    expect(String(run.payload.error)).toContain("api");
  });
});

describe("IR-CLI-104 AC-3 round records and program-counter lines do not change a wave's status", () => {
  it("IR-CLI-104 AC-3 keeps wave-2 in_progress past a round record and a statusless verb result", async () => {
    const round = { ...waveLine("r1", 2, "complete"), round: 1, phase: "wave-verify", verification: { verdict: "pass" } };
    const counter = { schema_version: "2.0.0", run_id: "r1", engine: "kiwi-orchestrator", wave: "wave-2", event: "result", verb: "dispatch-lane", lane: "lane-r1-wave-2", stage: 2 };
    const root = await rootWith([W1, W2, round, counter]);
    const waves = (await orchestrate(root, ["wave", "status", "--run-id", "r1"])).payload.waves as Array<{ wave: string; status: string }>;
    expect(waves.find((wave) => wave.wave === "wave-2")?.status).toBe("in_progress");
  });
});

describe("IR-CLI-104 AC-4 --engine reads a kiwi-wave-master journal on CLI and MCP", () => {
  const masterLine = (n: number, status: string): Line => {
    const line = waveLine("m1", n, status);
    delete line.engine;
    return line;
  };

  it("IR-CLI-104 AC-4 reads lines without an engine under --engine kiwi-wave-master", async () => {
    const root = await rootWith([masterLine(1, "complete"), masterLine(2, "in_progress")]);
    // Under the default engine the run has no line at all, which is an error rather than an empty report.
    const orchestrator = await orchestrate(root, ["wave", "status", "--run-id", "m1"]);
    expect(orchestrator.exit).toBe(1);
    expect(String(orchestrator.payload.error)).toContain("kiwi-orchestrator");
    const master = await orchestrate(root, ["wave", "status", "--run-id", "m1", "--engine", "kiwi-wave-master"]);
    expect((master.payload.waves as Array<{ wave: string }>).map((wave) => wave.wave)).toEqual(["wave-1", "wave-2"]);
  });

  it("IR-CLI-104 AC-4 carries engine in the generated MCP schema and answers the same over MCP", async () => {
    expect(Object.keys(toolSchemas.orchestrate_wave_status ?? {})).toContain("engine");
    const root = await rootWith([masterLine(1, "complete"), masterLine(2, "in_progress")]);
    const answer = (await createMcpServer({ root }).callTool("orchestrate_wave_status", { runId: "m1", engine: "kiwi-wave-master" })) as Record<string, unknown>;
    expect(answer.exitCode).toBe(0);
    expect((answer.waves as Array<{ wave: string }>).map((wave) => wave.wave)).toEqual(["wave-1", "wave-2"]);
  });
});

describe("IR-CLI-104 AC-5 a read leaf, registered read-only", () => {
  function leaf(): Command {
    const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
    const command = buildCommand({ io: pipes });
    registerOrchestrateCommands(command, { io: pipes });
    const orchestrateCommand = command.commands.find((sub) => sub.name() === "orchestrate") as Command;
    const wave = orchestrateCommand.commands.find((sub) => sub.name() === "wave") as Command;
    return wave.commands.find((sub) => sub.name() === "status") as Command;
  }

  it("IR-CLI-104 AC-5 is a read verb with --json and no --dry-run", () => {
    expect(orchestrateVerbKind(["wave", "status"])).toBe("read");
    const flags = leaf().options.map((option) => option.long);
    expect(flags).toContain("--json");
    expect(flags).not.toContain("--dry-run");
    expect([...flags].sort()).toEqual(["--engine", "--journal", "--json", "--run-id", "--waves"]);
  });

  it("IR-CLI-104 AC-5 binds orchestrate_wave_status as a read tool mirroring the leaf", () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((candidate) => candidate.tool === "orchestrate_wave_status");
    expect(binding?.kind).toBe("read");
    expect(binding?.path).toEqual(["wave", "status"]);
    expect(ORCHESTRATE_MCP_TOOLS.orchestrate_wave_status).toBe("wave status");
    expect(isReadOnlyTool("orchestrate_wave_status")).toBe(true);
  });

  it("IR-CLI-104 AC-5 leaves the journal's bytes unchanged", async () => {
    const root = await rootWith([W1, W2]);
    const before = await readFile(path.join(root, JOURNAL));
    await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    await orchestrate(root, ["wave", "status"]);
    expect(await readFile(path.join(root, JOURNAL))).toEqual(before);
  });
});

describe("IR-CLI-104 AC-6 the run is selected as resume selects it", () => {
  it("IR-CLI-104 AC-6 picks the most recent run that is neither complete nor aborted", async () => {
    const root = await rootWith([
      waveLine("old", 1, "in_progress"),
      waveLine("r2", 1, "in_progress"),
      waveLine("done", 1, "complete"),
      finalVerifyPass("done"),
      waveLine("gone", 1, "in_progress"),
      abortLine("gone")
    ]);
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((run.payload.run as { runId: string }).runId).toBe("r2");
  });

  it("IR-CLI-104 AC-6 exits 1 for a --run-id the journal does not hold, rather than an empty report", async () => {
    const root = await rootWith([W1]);
    const status = await orchestrate(root, ["wave", "status", "--run-id", "nope"]);
    expect(status.exit, JSON.stringify(status.payload)).toBe(1);
    expect(status.payload.gate).toBeUndefined();
    expect(String(status.payload.error)).toContain("nope");
  });

  it("IR-CLI-104 AC-6 names the missing journal when there is none", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "speckiwi-ir-cli-104-nojournal-"));
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit).toBe(1);
    expect(String(run.payload.error)).toContain(`no run journal at ${JOURNAL}`);
    expect(String(run.payload.error)).not.toContain("complete or aborted");
  });

  it("IR-CLI-104 AC-6 exits 1 naming that no resumable run exists", async () => {
    const root = await rootWith([waveLine("done", 1, "complete"), finalVerifyPass("done")]);
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit).toBe(1);
    expect(run.payload.gate).toBeUndefined();
    expect(String(run.payload.error)).toContain("no resumable run");
  });
});
