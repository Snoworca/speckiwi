import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";
import { GATE_IDS } from "../../src/core/orchestrator/auto-gate.js";
import { minimalCard, emptyDriftInputs, emptyGitFacts } from "../core/orchestrator/resume-fixtures.js";
import { defaultCatalog, defaultHandoff, defaultLane, defaultRoot } from "../core/orchestrator/handoff-fixtures.js";

// @req FR-NODE-137 — one exit-code table for the whole `orchestrate` namespace:
// 2 on gate refusal, 1 on an operational error, 0 on success, in both normal and --dry-run modes.
//
// Every assertion below reads the number `main` RETURNS. Asserting `command.opts().exitCode`
// instead would pass while the assignment is deleted, because `undefined !== 0`.

function io() {
  return { stdout: new PassThrough() as NodeJS.WriteStream, stderr: new PassThrough() as NodeJS.WriteStream };
}

function drain(stream: NodeJS.WriteStream): string {
  return (stream as unknown as PassThrough).read()?.toString() ?? "";
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

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "speckiwi-orchestrate-exit-"));
}

async function write(root: string, relativePath: string, text: string): Promise<string> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, text, "utf8");
  return absolute;
}

const EMPTY_RESOLUTION = { existingPaths: [], lineCounts: {}, testIds: [], commitShas: [] };

/** A `local-defect` issue with no resolution proof: `closeWave` refuses it. */
const OPEN_ISSUE = [
  {
    issueId: "ISS-1",
    wave: 1,
    class: "local-defect",
    source: "verify",
    resolutionKind: null,
    resolutionRef: null,
    userDecisionRef: null,
    designLockDigest: null,
    deferralReason: null
  }
];

/** A journal line that fails `validateWavesJournal`: a wave `complete` with no passing verify record. */
function invalidLine(runId: string): string {
  return JSON.stringify({
    schema_version: "1.4.0",
    run_id: runId,
    engine: "kiwi-orchestrator",
    verb: "emit-and-finish",
    event: "result",
    wave: "wave-1",
    status: "complete",
    writer: "speckiwi-orchestrate/test"
  });
}

async function seedRun(root: string, runId: string, lines: string[] = []): Promise<void> {
  await write(root, "kiwi/waves.jsonl", lines.length === 0 ? "" : `${lines.join("\n")}\n`);
}

describe("FR-NODE-137 AC-1 / AC-2 — the four gate verbs exit 2 on refusal and 0 on success", () => {
  it("`wave close` refuses with a GateId and succeeds with an empty violation list", async () => {
    const root = await tempRoot();
    await write(root, "issues.json", JSON.stringify(OPEN_ISSUE));
    await write(root, "empty-issues.json", "[]");
    await write(root, "resolution.json", JSON.stringify(EMPTY_RESOLUTION));

    const refused = await run(["--root", root, "orchestrate", "wave", "close", "--wave", "1", "--ledger", "issues.json", "--resolution", "resolution.json"]);
    expect(refused.exit).toBe(2);
    expect(refused.payload.ok).toBe(false);
    expect(GATE_IDS).toContain(refused.payload.gate);
    expect(Array.isArray(refused.payload.violations)).toBe(true);
    expect((refused.payload.violations as unknown[]).length).toBeGreaterThan(0);

    const passed = await run(["--root", root, "orchestrate", "wave", "close", "--wave", "1", "--ledger", "empty-issues.json", "--resolution", "resolution.json"]);
    expect(passed.exit).toBe(0);
    expect(passed.payload.ok).toBe(true);
    expect(passed.payload.violations).toEqual([]);
  });

  it("`validate` refuses with a GateId and succeeds with an empty violation list", async () => {
    const root = await tempRoot();
    await seedRun(root, "run-a", [invalidLine("run-a")]);
    const refused = await run(["--root", root, "orchestrate", "validate", "--run-id", "run-a", "--strict"]);
    expect(refused.exit).toBe(2);
    expect(GATE_IDS).toContain(refused.payload.gate);

    const cleanRoot = await tempRoot();
    await seedRun(cleanRoot, "run-a", []);
    const passed = await run(["--root", cleanRoot, "orchestrate", "validate", "--run-id", "run-a", "--strict"]);
    expect(passed.exit).toBe(0);
    expect(passed.payload.ok).toBe(true);
    expect(passed.payload.violations).toEqual([]);
  });

  it("`resume` refuses with a GateId and succeeds with an empty violation list", async () => {
    const refusedRoot = await tempRoot();
    await seedRun(refusedRoot, "run-a", [invalidLine("run-a")]);
    await write(refusedRoot, "card.json", JSON.stringify(minimalCard()));
    await write(refusedRoot, "facts.json", JSON.stringify({ gitFacts: emptyGitFacts(), driftInputs: emptyDriftInputs() }));
    const refused = await run(["--root", refusedRoot, "orchestrate", "resume", "--run-id", "run-a", "--card", "card.json", "--facts", "facts.json"]);
    expect(refused.exit).toBe(2);
    expect(GATE_IDS).toContain(refused.payload.gate);

    const okRoot = await tempRoot();
    await seedRun(okRoot, "run-a", []);
    await write(okRoot, "card.json", JSON.stringify(minimalCard()));
    await write(okRoot, "facts.json", JSON.stringify({ gitFacts: emptyGitFacts(), driftInputs: emptyDriftInputs() }));
    const passed = await run(["--root", okRoot, "orchestrate", "resume", "--run-id", "run-a", "--card", "card.json", "--facts", "facts.json"]);
    expect(passed.exit, JSON.stringify(passed.payload)).toBe(0);
    expect(passed.payload.violations).toEqual([]);
  });

  it("`handoff validate` refuses with a GateId and succeeds with an empty violation list", async () => {
    const root = await tempRoot();
    await write(root, "lane.json", JSON.stringify(defaultLane()));
    await write(root, "catalog.json", JSON.stringify(defaultCatalog()));
    await write(root, "base.json", JSON.stringify(defaultRoot()));
    await write(root, "good.md", defaultHandoff());
    await write(root, "bad.md", "# not a handoff\n");

    const refused = await run(["--root", root, "orchestrate", "handoff", "validate", "--lane", "lane.json", "--path", "bad.md", "--catalog", "catalog.json", "--base", "base.json"]);
    expect(refused.exit).toBe(2);
    expect(GATE_IDS).toContain(refused.payload.gate);

    const passed = await run(["--root", root, "orchestrate", "handoff", "validate", "--lane", "lane.json", "--path", "good.md", "--catalog", "catalog.json", "--base", "base.json"]);
    expect(passed.exit, JSON.stringify(passed.payload)).toBe(0);
    expect(passed.payload.violations).toEqual([]);
  });
});

describe("FR-NODE-137 AC-3 / AC-4 — an operational error exits 1 and carries no gate", () => {
  it("reports {ok:false, error} without a gate field for an unreadable file and for malformed JSON", async () => {
    const root = await tempRoot();
    await write(root, "resolution.json", JSON.stringify(EMPTY_RESOLUTION));
    await write(root, "broken.json", "{ not json");

    const unreadable = await run(["--root", root, "orchestrate", "wave", "close", "--wave", "1", "--ledger", "issues.json", "--resolution", "missing.json"]);
    expect(unreadable.exit).toBe(1);
    expect(unreadable.payload.ok).toBe(false);
    expect(typeof unreadable.payload.error).toBe("string");
    expect(unreadable.payload).not.toHaveProperty("gate");

    const malformed = await run(["--root", root, "orchestrate", "wave", "close", "--wave", "1", "--ledger", "issues.json", "--resolution", "broken.json"]);
    expect(malformed.exit).toBe(1);
    expect(malformed.payload).not.toHaveProperty("gate");
  });

  it("keeps refusal and operational error on distinct codes for the same verb", async () => {
    const root = await tempRoot();
    await write(root, "issues.json", JSON.stringify(OPEN_ISSUE));
    await write(root, "resolution.json", JSON.stringify(EMPTY_RESOLUTION));

    const refusal = await run(["--root", root, "orchestrate", "wave", "close", "--wave", "1", "--ledger", "issues.json", "--resolution", "resolution.json"]);
    const operational = await run(["--root", root, "orchestrate", "wave", "close", "--wave", "1", "--ledger", "issues.json", "--resolution", "gone.json"]);

    expect(refusal.exit).toBe(2);
    expect(operational.exit).toBe(1);
    expect(refusal.exit).not.toBe(operational.exit);
  });
});

describe("FR-NODE-137 AC-5 — a refused mutation exits 2 with applied:false and a gate", () => {
  it("refuses `journal append` of a line that would invalidate the journal", async () => {
    const root = await tempRoot();
    await seedRun(root, "run-a", []);
    const before = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");

    const refused = await run([
      "--root", root, "orchestrate", "journal", "append", "--run-id", "run-a",
      "--payload", JSON.stringify({ schema_version: "1.4.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "emit-and-finish", event: "result", wave: "wave-1", status: "complete" })
    ]);

    expect(refused.exit).toBe(2);
    expect(refused.payload.applied).toBe(false);
    expect(typeof refused.payload.gate).toBe("string");
    expect(await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).toBe(before);
  });
});

describe("FR-NODE-137 AC-6 — --dry-run produces the same exit codes and writes nothing", () => {
  it("exits 2 on a dry run of a call that would be refused, and writes nothing", async () => {
    const root = await tempRoot();
    await seedRun(root, "run-a", []);
    const before = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");

    const refused = await run([
      "--root", root, "orchestrate", "journal", "append", "--run-id", "run-a", "--dry-run",
      "--payload", JSON.stringify({ schema_version: "1.4.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "emit-and-finish", event: "result", wave: "wave-1", status: "complete" })
    ]);

    expect(refused.exit).toBe(2);
    expect(refused.payload.applied).toBe(false);
    expect(refused.payload.dryRun).toBe(true);
    expect(await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).toBe(before);
  });

  it("exits 0 on a dry run of a call that would succeed, and writes nothing", async () => {
    const root = await tempRoot();
    await seedRun(root, "run-a", []);
    const before = await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8");

    const accepted = await run([
      "--root", root, "orchestrate", "journal", "append", "--run-id", "run-a", "--dry-run",
      "--payload", JSON.stringify({ schema_version: "1.4.0", run_id: "run-a", engine: "kiwi-orchestrator", verb: "author-design", event: "intent", wave: "wave-1" })
    ]);

    expect(accepted.exit, JSON.stringify(accepted.payload)).toBe(0);
    expect(accepted.payload.dryRun).toBe(true);
    expect(await readFile(path.join(root, "kiwi/waves.jsonl"), "utf8")).toBe(before);
    // The candidate file the validation used must not survive the dry run.
    await expect(stat(path.join(root, "kiwi/waves.jsonl.candidate"))).rejects.toThrow();
  });
});
