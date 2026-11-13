import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import { withSrsMutationLock, srsLockRetry } from "../../src/core/mutation/srs-lock.js";
import { applyReplayPlan, type ReplayDispatchResult } from "../../src/core/orchestrator/replay-apply.js";
import { replayDeferredMutations } from "../../src/core/orchestrator/replay.js";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerMutationTools } from "../../src/mcp/tools/mutation-tools.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { cleanupFixtures, gitWorkspaceRepo, rawGit } from "../mcp/support/workspace-root-fixture.js";

// @req IR-CLI-120 — the replay applier creates its record directory before it dispatches, waits out an
// SRS lock the core will release instead of recording the refusal as failed, and reports the failed
// calls its record still holds instead of answering `applied: 0` as a success.
//
// Reported 2026-11-13 by a kiwi-orchestrator host on 5.5.1: the first replay of every run hit ENOENT
// after its first call had been applied, and concurrent replays lost an evidence row silently.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

afterAll(async () => {
  await cleanupFixtures();
});

const ID = "FR-ARCH-001";
const TRACE = "add_trace_link";
const EVIDENCE = "add_verification_evidence";
const TRACE_ARGS = { id: ID, type: "Code", reference: "src/a.ts", relation: "related_to" };
const TRACE_ARGS_2 = { id: ID, type: "Code", reference: "src/b.ts", relation: "related_to" };
const EVIDENCE_ARGS = { id: ID, type: "test", reference: "docs/spec/90.appendix.md", covers: "AC-1", notes: "first" };
const GATE = "srs-mutation-replay-failed";

function plan(...entries: Array<{ tool: string; args: unknown }>) {
  return replayDeferredMutations(entries, {});
}

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "ir-cli-120-"));
}

function lines(file: string): Array<{ tool: string; argsHash: string; outcome: string }> {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { tool: string; argsHash: string; outcome: string });
}

const LOCKED = (recoverable: boolean, delayMs: number): ReplayDispatchResult => ({
  ok: false,
  error: "SRS mutation lock is active for update_status by otherhost:4242",
  lock: { recoverable, delayMs }
});

/** A dispatch scripted per call: each tool answers from its own queue, then succeeds. */
function scripted(answers: Record<string, ReplayDispatchResult[]> = {}) {
  const seen: string[] = [];
  return {
    seen,
    dispatch: async (tool: string): Promise<ReplayDispatchResult> => {
      seen.push(tool);
      return answers[tool]?.shift() ?? { ok: true };
    }
  };
}

function waiter() {
  const waits: number[] = [];
  return { waits, wait: async (ms: number) => void waits.push(ms) };
}

describe("IR-CLI-120 AC-1..AC-3 — the record's directory", () => {
  it("AC-1 creates a missing parent directory before the first dispatch and records every call", async () => {
    const applied = path.join(await scratch(), "kiwi", "orchestrator", "run1", "replay-applied.jsonl");
    const p = plan({ tool: TRACE, args: TRACE_ARGS }, { tool: EVIDENCE, args: EVIDENCE_ARGS });
    let existedAtFirstDispatch: boolean | undefined;
    const result = await applyReplayPlan(p, {
      appliedPath: applied,
      frozenTarget: null,
      dispatch: async () => {
        existedAtFirstDispatch ??= existsSync(path.dirname(applied));
        return { ok: true };
      }
    });
    expect(result).toMatchObject({ ok: true, applied: 2 });
    expect(existedAtFirstDispatch).toBe(true);
    expect(lines(applied).map((line) => line.outcome)).toEqual(["applied", "applied"]);
  });

  it("AC-2 dispatches nothing when the directory cannot be created", async () => {
    const root = await scratch();
    await writeFile(path.join(root, "kiwi"), "a file where the directory should be", "utf8");
    const applied = path.join(root, "kiwi", "orchestrator", "run1", "replay-applied.jsonl");
    const rec = scripted();
    await expect(
      applyReplayPlan(plan({ tool: TRACE, args: TRACE_ARGS }), { appliedPath: applied, frozenTarget: null, dispatch: rec.dispatch })
    ).rejects.toThrow();
    expect(rec.seen).toEqual([]);
  });

  it("AC-3 a dry run creates neither the record nor its directory and counts the same", async () => {
    const root = await scratch();
    const missing = path.join(root, "kiwi", "orchestrator", "run1", "replay-applied.jsonl");
    const present = path.join(root, "present.jsonl");
    const p = plan({ tool: TRACE, args: TRACE_ARGS }, { tool: EVIDENCE, args: EVIDENCE_ARGS });
    const dry = await applyReplayPlan(p, { appliedPath: missing, frozenTarget: null, dispatch: scripted().dispatch, dryRun: true });
    const control = await applyReplayPlan(p, { appliedPath: present, frozenTarget: null, dispatch: scripted().dispatch, dryRun: true });
    expect(dry).toMatchObject({ ok: true, wouldApply: 2 });
    expect(dry.wouldApply).toBe(control.wouldApply);
    expect(existsSync(path.join(root, "kiwi"))).toBe(false);
  });
});

describe("IR-CLI-120 AC-4, AC-6, AC-7 — a lock refusal is waited out, never recorded", () => {
  it("AC-4 waits as the refusal says, at most 250 ms at a time, then goes on with the rest", async () => {
    const applied = path.join(await scratch(), "applied.jsonl");
    const p = plan({ tool: EVIDENCE, args: EVIDENCE_ARGS }, { tool: TRACE, args: TRACE_ARGS });
    const rec = scripted({ [EVIDENCE]: [LOCKED(true, 1_000), LOCKED(true, 40)] });
    const timer = waiter();
    const result = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: rec.dispatch, wait: timer.wait });
    expect(result).toMatchObject({ ok: true, applied: 2 });
    expect(rec.seen).toEqual([EVIDENCE, EVIDENCE, EVIDENCE, TRACE]);
    expect(timer.waits).toEqual([250, 40]);
    expect(lines(applied).map((line) => [line.tool, line.outcome])).toEqual([
      [EVIDENCE, "applied"],
      [TRACE, "applied"]
    ]);
  });

  it("AC-6 a lock that outlasts the 60 s budget stops the run, writes no line, and the next run dispatches it", async () => {
    const applied = path.join(await scratch(), "applied.jsonl");
    const p = plan({ tool: TRACE, args: TRACE_ARGS }, { tool: EVIDENCE, args: EVIDENCE_ARGS });
    const forever = Array.from({ length: 1_000 }, () => LOCKED(true, 60_000));
    const rec = scripted({ [EVIDENCE]: forever });
    const timer = waiter();
    const result = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: rec.dispatch, wait: timer.wait });
    expect(result).toMatchObject({ ok: false, gate: GATE, applied: 1 });
    expect(timer.waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(60_000);
    expect(timer.waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThan(59_000);
    expect(result.failure?.error).toMatch(/not applied because of the SRS lock/i);
    expect(lines(applied).map((line) => [line.tool, line.outcome])).toEqual([[TRACE, "applied"]]);

    const again = scripted();
    const second = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: again.dispatch, wait: waiter().wait });
    expect(again.seen).toEqual([EVIDENCE]);
    expect(second).toMatchObject({ ok: true, applied: 1 });
  });

  it("AC-6 a lock the core never recovers is not waited for, and writes no line", async () => {
    const applied = path.join(await scratch(), "applied.jsonl");
    const rec = scripted({ [TRACE]: [LOCKED(false, 60_000)] });
    const timer = waiter();
    const result = await applyReplayPlan(plan({ tool: TRACE, args: TRACE_ARGS }), {
      appliedPath: applied,
      frozenTarget: null,
      dispatch: rec.dispatch,
      wait: timer.wait
    });
    expect(result).toMatchObject({ ok: false, gate: GATE, applied: 0 });
    expect(timer.waits).toEqual([]);
    expect(rec.seen).toEqual([TRACE]);
    expect(result.failure?.error).toMatch(/not applied because of the SRS lock/i);
    expect(lines(applied)).toEqual([]);
  });

  it("AC-7 any other refusal is not retried: recorded failed and stops", async () => {
    const applied = path.join(await scratch(), "applied.jsonl");
    const rec = scripted({ [TRACE]: [{ ok: false, error: "requirement not found" }] });
    const timer = waiter();
    const result = await applyReplayPlan(plan({ tool: TRACE, args: TRACE_ARGS }, { tool: EVIDENCE, args: EVIDENCE_ARGS }), {
      appliedPath: applied,
      frozenTarget: null,
      dispatch: rec.dispatch,
      wait: timer.wait
    });
    expect(result).toMatchObject({ ok: false, gate: GATE });
    expect(timer.waits).toEqual([]);
    expect(rec.seen).toEqual([TRACE]);
    expect(lines(applied).map((line) => line.outcome)).toEqual(["failed"]);
  });
});

describe("IR-CLI-120 AC-8, AC-9 — the failed calls a record still holds", () => {
  it("AC-8 applies the calls with no line, then fails naming each failed call and how to go on", async () => {
    const applied = path.join(await scratch(), "applied.jsonl");
    // The failed call is the plan's second, so its reported index is its own position, not the list's.
    const p = plan({ tool: TRACE, args: TRACE_ARGS }, { tool: EVIDENCE, args: EVIDENCE_ARGS });
    const hash = p.calls[1]!.argsHash;
    await writeFile(applied, `${JSON.stringify({ tool: EVIDENCE, argsHash: hash, outcome: "failed" })}\n`, "utf8");
    const rec = scripted();
    const result = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: rec.dispatch });
    expect(rec.seen).toEqual([TRACE]);
    expect(result).toMatchObject({ ok: false, gate: GATE, applied: 1 });
    expect(result.failedCalls).toEqual([{ index: 1, tool: EVIDENCE, argsHash: hash }]);

    const dry = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: scripted().dispatch, dryRun: true });
    expect(dry).toMatchObject({ ok: false, gate: GATE, wouldApply: 0 });
    expect(dry.failedCalls).toEqual([{ index: 1, tool: EVIDENCE, argsHash: hash }]);
  });

  it("AC-9 a failed line that a later applied line supersedes leaves a clean re-run", async () => {
    const applied = path.join(await scratch(), "applied.jsonl");
    const p = plan({ tool: EVIDENCE, args: EVIDENCE_ARGS });
    const hash = p.calls[0]!.argsHash;
    await writeFile(
      applied,
      [{ outcome: "failed" }, { outcome: "applied" }].map((line) => `${JSON.stringify({ tool: EVIDENCE, argsHash: hash, ...line })}\n`).join(""),
      "utf8"
    );
    const rec = scripted();
    const result = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: rec.dispatch });
    expect(rec.seen).toEqual([]);
    expect(result).toMatchObject({ ok: true, applied: 0 });
    expect(result.failedCalls).toBeUndefined();
  });
});

describe("IR-CLI-120 — the lock refusals the core recovers", () => {
  it("a held lock and a torn lock file are recoverable; an unknown-format lock is not", async () => {
    const root = await gitWorkspaceRepo("ir-cli-120-lock-");
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    const lockFile = path.join(root, "kiwi", ".srs.lock");
    const now = Date.now();
    const refusalWith = async (content: string) => {
      await writeFile(lockFile, content, "utf8");
      const refused = await withSrsMutationLock({ root }, { operation: "probe" }, async () => {
        throw new Error("a refused lock must not run the mutation");
      });
      await rm(lockFile, { force: true });
      return srsLockRetry(refused);
    };
    const held = await refusalWith(
      JSON.stringify({ schemaVersion: "1.0.0", owner: "otherhost:4242", operation: "update_status", requestId: "r1", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString() })
    );
    expect(held?.recoverable).toBe(true);
    expect(held?.delayMs).toBeGreaterThan(0);
    expect((await refusalWith(""))?.recoverable).toBe(true);
    expect((await refusalWith(JSON.stringify({ schemaVersion: "9.9.9" })))?.recoverable).toBe(false);
    expect(srsLockRetry({ ok: true, diagnostics: [], diagnosticsSummary: { errors: 0, warnings: 0, byCode: {} } })).toBeUndefined();
  });
});

// ---- the CLI and MCP surfaces, on a real SRS ------------------------------------------------------------------

async function workspace(prefix: string): Promise<string> {
  const root = await gitWorkspaceRepo(prefix);
  expect(path.resolve(await rawGit(root, "rev-parse", "--show-toplevel")).toLowerCase()).toBe(path.resolve(root).toLowerCase());
  return root;
}

async function cli(root: string, argv: string[]): Promise<{ exit: number; text: string }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exit = await main(["--root", root, "orchestrate", ...argv, "--json"], { stdout, stderr });
  return { exit, text: `${stdout.read()?.toString() ?? ""}${stderr.read()?.toString() ?? ""}` };
}

async function writePlan(root: string, name: string, entries: Array<{ tool: string; args: unknown }>): Promise<void> {
  await writeFile(path.join(root, `${name}.queue.jsonl`), entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""), "utf8");
  const planned = await cli(root, ["replay", "plan", "--queue", `${name}.queue.jsonl`]);
  const parsed = JSON.parse(planned.text) as { calls: unknown; indexAfter: unknown };
  await writeFile(path.join(root, `${name}.plan.json`), JSON.stringify({ calls: parsed.calls, indexAfter: parsed.indexAfter }), "utf8");
}

async function spec(root: string): Promise<string> {
  return readFile(path.join(root, "docs", "spec", "10.product-architecture.srs.md"), "utf8");
}

function evidenceRows(text: string): number {
  return text.split("\n").filter((line) => line.startsWith("| VE-") && line.includes("docs/spec/90.appendix.md")).length;
}

describe("IR-CLI-120 on the CLI (AC-1, AC-2, AC-4, AC-5, AC-6, AC-8)", () => {
  it("AC-1 the first replay of a run writes its record under a directory nobody made, applying each call once", async () => {
    const root = await workspace("ir-cli-120-cli-dir-");
    await writePlan(root, "lane", [{ tool: EVIDENCE, args: EVIDENCE_ARGS }, { tool: TRACE, args: TRACE_ARGS }]);
    const record = "kiwi/orchestrator/run1/replay-applied.jsonl";
    const first = await cli(root, ["replay", "apply", "--plan", "lane.plan.json", "--applied", record]);
    expect(first.exit, first.text).toBe(0);
    expect(lines(path.join(root, record)).map((line) => line.outcome)).toEqual(["applied", "applied"]);
    expect(evidenceRows(await spec(root))).toBe(1);
  });

  it("AC-2 a directory that cannot be made leaves the SRS unchanged", async () => {
    const root = await workspace("ir-cli-120-cli-blocked-");
    await writePlan(root, "lane", [{ tool: EVIDENCE, args: EVIDENCE_ARGS }]);
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(path.join(root, "kiwi", "orchestrator"), "not a directory", "utf8");
    const before = await spec(root);
    const result = await cli(root, ["replay", "apply", "--plan", "lane.plan.json", "--applied", "kiwi/orchestrator/run1/replay-applied.jsonl"]);
    expect(result.exit).not.toBe(0);
    expect(await spec(root)).toBe(before);
  });

  it("AC-4 a held lock that expires is waited out, and the record holds no failed line", async () => {
    const root = await workspace("ir-cli-120-cli-held-");
    await writePlan(root, "lane", [{ tool: EVIDENCE, args: EVIDENCE_ARGS }]);
    const now = Date.now();
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    await writeFile(
      path.join(root, "kiwi", ".srs.lock"),
      JSON.stringify({ schemaVersion: "1.0.0", owner: "otherhost:4242", operation: "update_status", requestId: "r1", acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 800).toISOString() }),
      "utf8"
    );
    const result = await cli(root, ["replay", "apply", "--plan", "lane.plan.json", "--applied", "applied.jsonl"]);
    expect(result.exit, result.text).toBe(0);
    expect(lines(path.join(root, "applied.jsonl")).map((line) => line.outcome)).toEqual(["applied"]);
    expect(evidenceRows(await spec(root))).toBe(1);
  });

  it("AC-5 two replays of different plans at once both apply everything", async () => {
    const root = await workspace("ir-cli-120-cli-race-");
    await writePlan(root, "a", [{ tool: EVIDENCE, args: EVIDENCE_ARGS }, { tool: TRACE, args: TRACE_ARGS }]);
    await writePlan(root, "b", [{ tool: TRACE, args: TRACE_ARGS_2 }, { tool: EVIDENCE, args: { ...EVIDENCE_ARGS, notes: "second" } }]);
    const [a, b] = await Promise.all([
      cli(root, ["replay", "apply", "--plan", "a.plan.json", "--applied", "kiwi/orchestrator/a/applied.jsonl"]),
      cli(root, ["replay", "apply", "--plan", "b.plan.json", "--applied", "kiwi/orchestrator/b/applied.jsonl"])
    ]);
    expect(a.exit, a.text).toBe(0);
    expect(b.exit, b.text).toBe(0);
    for (const run of ["a", "b"]) {
      expect(lines(path.join(root, "kiwi", "orchestrator", run, "applied.jsonl")).map((line) => line.outcome)).toEqual(["applied", "applied"]);
    }
    expect(evidenceRows(await spec(root))).toBe(2);
  });

  it("AC-6 an unknown-format lock stops the run without a line, and the call is replayed once it is gone", async () => {
    const root = await workspace("ir-cli-120-cli-unknown-");
    await writePlan(root, "lane", [{ tool: EVIDENCE, args: EVIDENCE_ARGS }]);
    await mkdir(path.join(root, "kiwi"), { recursive: true });
    const lockFile = path.join(root, "kiwi", ".srs.lock");
    await writeFile(lockFile, JSON.stringify({ schemaVersion: "9.9.9" }), "utf8");
    const stopped = await cli(root, ["replay", "apply", "--plan", "lane.plan.json", "--applied", "applied.jsonl"]);
    expect(stopped.exit).not.toBe(0);
    expect(stopped.text).toMatch(/not applied because of the SRS lock/i);
    expect(lines(path.join(root, "applied.jsonl"))).toEqual([]);
    await rm(lockFile, { force: true });
    const resumed = await cli(root, ["replay", "apply", "--plan", "lane.plan.json", "--applied", "applied.jsonl"]);
    expect(resumed.exit, resumed.text).toBe(0);
    expect(evidenceRows(await spec(root))).toBe(1);
  });

  it("AC-8 a re-run over a record holding a failed call fails and says how to go on", async () => {
    const root = await workspace("ir-cli-120-cli-failed-");
    await writePlan(root, "lane", [{ tool: EVIDENCE, args: EVIDENCE_ARGS }]);
    const hash = (JSON.parse(await readFile(path.join(root, "lane.plan.json"), "utf8")) as { calls: Array<{ argsHash: string }> }).calls[0]!.argsHash;
    await writeFile(path.join(root, "applied.jsonl"), `${JSON.stringify({ tool: EVIDENCE, argsHash: hash, outcome: "failed" })}\n`, "utf8");
    const result = await cli(root, ["replay", "apply", "--plan", "lane.plan.json", "--applied", "applied.jsonl"]);
    expect(result.exit).not.toBe(0);
    expect(result.text).toContain(GATE);
    expect(result.text).toContain("#0");
    expect(result.text).toContain(hash);
    // The way on: the call's own applied line, ready to append once the call has been applied by hand.
    expect(result.text).toContain(JSON.stringify(JSON.stringify({ tool: EVIDENCE, argsHash: hash, outcome: "applied" })).slice(1, -1));
  });

  it("AC-8 a dry run over such a record still says what it would apply (IR-CLI-092 AC-7)", async () => {
    const root = await workspace("ir-cli-120-cli-dry-");
    await writePlan(root, "lane", [{ tool: EVIDENCE, args: EVIDENCE_ARGS }, { tool: TRACE, args: TRACE_ARGS }]);
    const hash = (JSON.parse(await readFile(path.join(root, "lane.plan.json"), "utf8")) as { calls: Array<{ argsHash: string }> }).calls[0]!.argsHash;
    await writeFile(path.join(root, "applied.jsonl"), `${JSON.stringify({ tool: EVIDENCE, argsHash: hash, outcome: "failed" })}\n`, "utf8");
    const before = await spec(root);
    const result = await cli(root, ["replay", "apply", "--plan", "lane.plan.json", "--applied", "applied.jsonl", "--dry-run"]);
    expect(result.exit).not.toBe(0);
    expect(result.text).toContain(GATE);
    expect(result.text).toContain("would apply 1");
    expect(await spec(root)).toBe(before);
  });

  it("AC-8 the failure still names each refused call and its reason (IR-CLI-092 AC-4)", async () => {
    const root = await workspace("ir-cli-120-cli-refused-");
    await writePlan(root, "lane", [
      { tool: EVIDENCE, args: EVIDENCE_ARGS },
      { tool: TRACE, args: TRACE_ARGS },
      { tool: "add_requirement", args: { id: ID } }
    ]);
    const hash = (JSON.parse(await readFile(path.join(root, "lane.plan.json"), "utf8")) as { calls: Array<{ argsHash: string }> }).calls[0]!.argsHash;
    await writeFile(path.join(root, "applied.jsonl"), `${JSON.stringify({ tool: EVIDENCE, argsHash: hash, outcome: "failed" })}\n`, "utf8");
    for (const extra of [["--dry-run"], []]) {
      const result = await cli(root, ["replay", "apply", "--plan", "lane.plan.json", "--applied", "applied.jsonl", ...extra]);
      expect(result.exit).not.toBe(0);
      expect(result.text).toContain("#2 add_requirement");
      expect(result.text).toContain("tool-not-deferrable");
    }
  });
});

describe("IR-CLI-120 AC-10 — the MCP tool answers as the CLI does", () => {
  function server(root: string) {
    const handle = createTestMcpServer({ root });
    registerReadTools(handle, { root });
    registerMutationTools(handle, { root });
    return handle;
  }

  it("creates the record's directory, and reports a record's failed call as a failure", async () => {
    const root = await workspace("ir-cli-120-mcp-");
    await writePlan(root, "lane", [{ tool: EVIDENCE, args: EVIDENCE_ARGS }]);
    const record = "kiwi/orchestrator/run1/replay-applied.jsonl";
    const first = (await server(root).callTool("orchestrate_replay_apply", { plan: "lane.plan.json", applied: record })) as { ok: boolean };
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(lines(path.join(root, record)).map((line) => line.outcome)).toEqual(["applied"]);

    const hash = lines(path.join(root, record))[0]!.argsHash;
    await writeFile(path.join(root, record), `${JSON.stringify({ tool: EVIDENCE, argsHash: hash, outcome: "failed" })}\n`, "utf8");
    const second = (await server(root).callTool("orchestrate_replay_apply", { plan: "lane.plan.json", applied: record })) as { ok: boolean; error?: unknown };
    expect(second.ok).toBe(false);
    expect(JSON.stringify(second)).toContain(GATE);
    expect(JSON.stringify(second)).toContain(hash);
  });
});
