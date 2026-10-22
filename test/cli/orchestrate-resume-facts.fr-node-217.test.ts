import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { ORCHESTRATE_TOOL_BINDINGS } from "../../src/cli/commands/orchestrate.js";
import { resumeCardPath, type ResumeCard } from "../../src/core/orchestrator/resume-card.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { frozenBlock, minimalCard } from "../core/orchestrator/resume-fixtures.js";
import { sdsWorkspace, writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { pinResumeRunRoot } from "./support/resume-run-root.js";

// FR-NODE-217 — `orchestrate resume` collects its own git facts and drift inputs when `--facts` is
// absent, and selects the run when `--run-id` is absent, so the command the skill names runs as written.

const RUN = "r1";
const JOURNAL = "kiwi/waves.jsonl";
const DECLARATION = "waves/waves.json";
const LANES_LOCK = "waves/stage-1/lanes.lock.json";
const DESIGN_LOCK = "design/00.design.lock.json";
const LANE = `lane-${RUN}-wave-1`;
const WRITER = "speckiwi-orchestrate/test";
type Line = Record<string, unknown>;

interface Run {
  readonly exit: number;
  readonly payload: Record<string, unknown>;
}

async function cli(argv: string[]): Promise<Run> {
  const pipes = { stdout: new PassThrough(), stderr: new PassThrough() };
  const exit = await main(argv, pipes);
  const text = pipes.stdout.read()?.toString() ?? "";
  return { exit, payload: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { stdio: "pipe" }).toString().trim();
}

async function sha256Of(root: string, relativePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(path.join(root, relativePath))).digest("hex");
}

async function pointer(root: string, relativePath: string): Promise<string> {
  return `${relativePath}@sha256:${await sha256Of(root, relativePath)}`;
}

function waveLine(runId: string, n: number, status: string, extra: Line = {}): Line {
  return { schema_version: "2.0.0", ts: "2026-10-20T00:00:00.000Z", run_id: runId, engine: "kiwi-orchestrator", writer: WRITER, wave: `wave-${n}`, order: n, target: "4.1.0", status, summary: status, ...extra };
}

async function appendJournal(root: string, lines: readonly Line[]): Promise<void> {
  const absolute = path.join(root, JOURNAL);
  const existing = await readFile(absolute, "utf8").catch(() => "");
  await writeUnder(root, JOURNAL, `${existing}${lines.map((line) => `${JSON.stringify(line)}\n`).join("")}`);
}

/**
 * A resumable run: a git repository on its integration branch, a wave declaration scheduled into a
 * stage lock by the real command, a design lock, and a card naming all three by pointer.
 */
async function resumableRun(extraJournal: readonly Line[] = []): Promise<{ root: string; branch: string }> {
  const root = await sdsWorkspace([]);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "seed");
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");

  await writeUnder(root, DECLARATION, JSON.stringify({ schema_version: "1.0.0", waves: [{ wave: "wave-1", files: ["src/w1.ts"], requirements: ["FR-ARCH-001"] }] }));
  await writeUnder(root, "existing.json", "[]");
  await appendJournal(root, [waveLine(RUN, 1, "in_progress"), ...extraJournal]);
  const scheduled = await cli(["--root", root, "orchestrate", "schedule", "waves", "--waves", DECLARATION, "--run-id", RUN, "--existing-paths", "existing.json", "--out", LANES_LOCK, "--json"]);
  expect(scheduled.exit, JSON.stringify(scheduled.payload)).toBe(0);
  await writeUnder(root, "design-body.json", JSON.stringify({ design_items: [], integration_items: [], out_of_scope: [] }));
  const head = git(root, "rev-parse", "HEAD");
  const designFrozen = await cli(["--root", root, "orchestrate", "freeze", "design", "--body", "design-body.json", "--document", "docs/spec/00.index.md", "--head", head, "--run-id", RUN, "--out", DESIGN_LOCK, "--json"]);
  expect(designFrozen.exit, JSON.stringify(designFrozen.payload)).toBe(0);

  // The card records the pointers the tools reported, which is what an agent copies (review M1).
  const frozen = frozenBlock({
    integration_branch: branch,
    design_lock: designFrozen.payload.pointer,
    waves_lock: undefined,
    lane_lock: { "wave-1": scheduled.payload.pointer }
  });
  delete (frozen as Record<string, unknown>).waves_lock;
  const card = await pinResumeRunRoot(minimalCard({ run_id: RUN, frozen } as Partial<ResumeCard>), root);
  await writeUnder(root, resumeCardPath(RUN), `${JSON.stringify(card, null, 2)}\n`);
  return { root, branch };
}

describe("FR-NODE-217 AC-5 the command the skill names exits 0 on a resumable run", () => {
  it("FR-NODE-217 AC-5 runs `speckiwi orchestrate resume --json` as written", async () => {
    const { root } = await resumableRun();
    const run = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.ok).toBe(true);
    expect((run.payload.resume as { blocking: unknown }).blocking).toBeNull();
  });
});

describe("FR-NODE-217 AC-2 the pointer a write verb reports is the one resume recomputes", () => {
  it("FR-NODE-217 AC-2 freeze and schedule waves report <path>@sha256:<sha256 of the written file's bytes>", async () => {
    const { root } = await resumableRun();
    const card = JSON.parse(await readFile(path.join(root, resumeCardPath(RUN)), "utf8")) as ResumeCard;
    expect(card.frozen.design_lock).toBe(await pointer(root, DESIGN_LOCK));
    expect(card.frozen.lane_lock["wave-1"]).toBe(await pointer(root, LANES_LOCK));
  });
});

describe("FR-NODE-217 AC-1 --engine, and the run chosen when --run-id is absent", () => {
  it("FR-NODE-217 AC-1 declares --engine defaulting to kiwi-orchestrator", async () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((candidate) => candidate.tool === "orchestrate_resume");
    expect(binding?.options.map((option) => option.dest)).toEqual(expect.arrayContaining(["runId", "engine", "journal", "card", "facts"]));
    const { root } = await resumableRun();
    const wrongEngine = await cli(["--root", root, "orchestrate", "resume", "--engine", "kiwi-wave-master", "--json"]);
    expect(wrongEngine.exit).toBe(1);
    expect(String(wrongEngine.payload.error)).toContain("no resumable run");
  });

  it("FR-NODE-217 AC-1 picks the most recent run that is neither complete nor aborted", async () => {
    const { root } = await resumableRun();
    await appendJournal(root, [
      waveLine("later-aborted", 1, "in_progress"),
      { schema_version: "2.0.0", run_id: "later-aborted", engine: "kiwi-orchestrator", writer: WRITER, verb: "abort-run", event: "result", wave: "all", abort_gate: "run-invariant-drift" },
      waveLine("later-complete", 1, "complete"),
      { ...waveLine("later-complete", 9, "complete"), wave: "all", phase: "final-verify", verification: { verdict: "pass" } }
    ]);
    const run = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.runId).toBe(RUN);
  });

  it("FR-NODE-217 AC-1 exits 1 naming that no resumable run exists, as a usage error and not a gate", async () => {
    const root = await sdsWorkspace([]);
    await appendJournal(root, [waveLine("gone", 1, "in_progress"), { schema_version: "2.0.0", run_id: "gone", engine: "kiwi-orchestrator", writer: WRITER, verb: "abort-run", event: "result", wave: "all", abort_gate: "run-invariant-drift" }]);
    const run = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(run.exit).toBe(1);
    expect(run.payload.gate).toBeUndefined();
    expect(String(run.payload.error)).toContain("no resumable run");
  });
});

describe("FR-NODE-217 AC-2 the tool collects the facts from the repository", () => {
  it("FR-NODE-217 AC-2 reads a changed declaration entry as lane-plan-drift naming the wave", async () => {
    const { root } = await resumableRun();
    await writeUnder(root, DECLARATION, JSON.stringify({ schema_version: "1.0.0", waves: [{ wave: "wave-1", files: ["src/w1.ts", "src/more.ts"], requirements: ["FR-ARCH-001"] }] }));
    const run = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(run.payload.gate).toBe("lane-plan-drift");
    expect(JSON.stringify(run.payload.violations)).toContain(`${RUN}-wave-1`);
  });

  it("FR-NODE-217 AC-2 reads a changed design lock as run-invariant-drift", async () => {
    const { root } = await resumableRun();
    await writeUnder(root, DESIGN_LOCK, `${JSON.stringify({ design: "edited" })}\n`);
    const run = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(2);
    expect(run.payload.gate).toBe("run-invariant-drift");
  });

  it("FR-NODE-217 AC-2 reads the integration branch's Orch-* trailer commits: a landed lane the journal has not integrated diverges", async () => {
    const dispatched = { schema_version: "2.0.0", run_id: RUN, engine: "kiwi-orchestrator", writer: WRITER, wave: "wave-1", stage: 1, lane: LANE, event: "result", verb: "dispatch-lane", proof: { kind: "digest", ref: "sha256:x" } };
    const { root } = await resumableRun([dispatched]);

    const before = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(before.exit, JSON.stringify(before.payload)).toBe(0);
    expect((before.payload.resume as { nextAction: { verb: string } }).nextAction.verb).toBe("dispatch-lane");

    git(root, "commit", "-q", "--allow-empty", "-m", "unit", "-m", `Orch-Run: ${RUN}\nOrch-Wave: 1\nOrch-Stage: 1\nOrch-Lane: ${LANE}`);
    const after = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(after.exit, JSON.stringify(after.payload)).toBe(2);
    expect(after.payload.gate).toBe("ledger-reconciliation-divergent");
  });
});

describe("FR-NODE-217 AC-3 digest 2 is unchecked when the tool collected the facts", () => {
  it("FR-NODE-217 AC-3 reports digest 2 as unchecked with a warning, never as a self-comparison", async () => {
    const { root } = await resumableRun();
    const run = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const digests = (run.payload.resume as { drift: { digests: Array<{ index: number; outcome: string; gate: unknown }> } }).drift.digests;
    expect(digests.find((entry) => entry.index === 2)).toMatchObject({ outcome: "unchecked", gate: null });
    expect(run.payload.warnings).toEqual([expect.objectContaining({ code: "intent-digest-unchecked" })]);
  });
});

describe("FR-NODE-217 AC-4 --facts keeps its behaviour", () => {
  it("FR-NODE-217 AC-4 still refuses --facts missing either half", async () => {
    const { root } = await resumableRun();
    await writeUnder(root, "facts.json", JSON.stringify({ gitFacts: {} }));
    const run = await cli(["--root", root, "orchestrate", "resume", "--run-id", RUN, "--facts", "facts.json", "--json"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(1);
    expect(String(run.payload.error)).toContain("--facts must supply both");
  });
});

describe("FR-NODE-217 AC-6 the MCP tool takes neither run_id nor facts", () => {
  it("FR-NODE-217 AC-6 returns the outcome the CLI returns", async () => {
    const { root } = await resumableRun();
    const viaCli = await cli(["--root", root, "orchestrate", "resume", "--json"]);
    const viaMcp = (await createMcpServer({ root }).callTool("orchestrate_resume", {})) as Record<string, unknown>;
    expect(viaMcp.exitCode).toBe(0);
    expect(viaMcp.resume).toEqual(viaCli.payload.resume);
    expect(viaMcp.runId).toBe(RUN);
  });
});
