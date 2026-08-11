import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORCHESTRATE_DEFERRED_VERB_ROWS,
  ORCHESTRATE_PHASE2_VERB_ROWS,
  ORCHESTRATE_REGISTERED_VERB_ROWS,
  ORCHESTRATE_TOOL_BINDINGS
} from "../../src/cli/commands/orchestrate.js";
import { applyReplayPlan } from "../../src/core/orchestrator/replay-apply.js";
import { replayDeferredMutations } from "../../src/core/orchestrator/replay.js";

// @req IR-CLI-092
//
// `orchestrate replay plan` marks calls `apply` and nothing consumes them, so the deferred-mutation
// contract is a queue with a planner and no applier: the four mutations a lane defers are accounted
// for and then lost. The leaf takes the PLAN and not the queue, because re-planning at apply time
// would let the applied set differ from the reviewed one.

const TRACE = "add_trace_link";
const STATUS = "update_status";
const COMPLETED = "add_completed_work";

function plan(...entries: Array<{ tool: string; args: unknown }>) {
  return replayDeferredMutations(entries, {});
}

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "replay-apply-"));
}

/** Records every dispatch so the test can assert what ran, in order, without touching a real SRS. */
function recorder(failOn?: string) {
  const seen: Array<{ tool: string; args: unknown }> = [];
  return {
    seen,
    dispatch: async (tool: string, args: unknown) => {
      seen.push({ tool, args });
      if (tool === failOn) return { ok: false as const, error: `${tool} refused` };
      return { ok: true as const };
    }
  };
}

describe("IR-CLI-092 — the replay applier", () => {
  it("AC-2: applies each admitted call once and skips one the record shows applied", async () => {
    const root = await scratch();
    const applied = path.join(root, "applied.jsonl");
    const p = plan({ tool: TRACE, args: { id: "A" } }, { tool: STATUS, args: { id: "A" } });
    await writeFile(
      applied,
      `${JSON.stringify({ tool: TRACE, argsHash: p.calls[0]!.argsHash, outcome: "applied" })}\n`,
      "utf8"
    );
    const rec = recorder();

    const result = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: rec.dispatch });

    expect(rec.seen.map((entry) => entry.tool)).toEqual([STATUS]);
    expect(result.applied).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("AC-3: appends one line per attempt, naming tool, argsHash and outcome", async () => {
    const root = await scratch();
    const applied = path.join(root, "applied.jsonl");
    const p = plan({ tool: TRACE, args: { id: "A" } }, { tool: COMPLETED, args: { id: "B" } });
    const rec = recorder();

    await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: rec.dispatch });

    const lines = readFileSync(applied, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { tool: TRACE, argsHash: p.calls[0]!.argsHash, outcome: "applied" },
      { tool: COMPLETED, argsHash: p.calls[1]!.argsHash, outcome: "applied" }
    ]);
  });

  it("AC-4: a tool outside the admitted four is not dispatched and is reported", async () => {
    const root = await scratch();
    const p = plan({ tool: "set_active_target", args: { target: "x" } }, { tool: STATUS, args: { id: "A" } });
    const rec = recorder();

    const result = await applyReplayPlan(p, {
      appliedPath: path.join(root, "applied.jsonl"),
      frozenTarget: null,
      dispatch: rec.dispatch
    });

    expect(rec.seen.map((entry) => entry.tool)).toEqual([STATUS]);
    expect(result.refused).toEqual([{ index: 0, tool: "set_active_target", reason: "tool-not-deferrable" }]);
  });

  it("AC-5: a failing mutation stops the run and keeps the lines already written", async () => {
    const root = await scratch();
    const applied = path.join(root, "applied.jsonl");
    const p = plan(
      { tool: TRACE, args: { id: "A" } },
      { tool: STATUS, args: { id: "A" } },
      { tool: COMPLETED, args: { id: "B" } }
    );
    const rec = recorder(STATUS);

    const result = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: rec.dispatch });

    expect(result.ok).toBe(false);
    expect(result.gate).toBe("srs-mutation-replay-failed");
    // The third call is never attempted — stopping is what keeps the record a true account.
    expect(rec.seen.map((entry) => entry.tool)).toEqual([TRACE, STATUS]);
    const lines = readFileSync(applied, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.outcome)).toEqual(["applied", "failed"]);
  });

  it("AC-6: re-running against the same plan and record applies nothing and succeeds", async () => {
    const root = await scratch();
    const applied = path.join(root, "applied.jsonl");
    const p = plan({ tool: TRACE, args: { id: "A" } }, { tool: STATUS, args: { id: "A" } });

    const first = recorder();
    await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: first.dispatch });
    const second = recorder();
    const result = await applyReplayPlan(p, { appliedPath: applied, frozenTarget: null, dispatch: second.dispatch });

    expect(first.seen).toHaveLength(2);
    expect(second.seen).toEqual([]);
    expect(result).toMatchObject({ ok: true, applied: 0 });
  });

  it("AC-7: dry-run dispatches nothing and writes no record", async () => {
    const root = await scratch();
    const applied = path.join(root, "applied.jsonl");
    const p = plan({ tool: TRACE, args: { id: "A" } });
    const rec = recorder();

    const result = await applyReplayPlan(p, {
      appliedPath: applied,
      frozenTarget: null,
      dispatch: rec.dispatch,
      dryRun: true
    });

    expect(rec.seen).toEqual([]);
    expect(existsSync(applied)).toBe(false);
    expect(result).toMatchObject({ ok: true, wouldApply: 1 });
  });
});

describe("IR-CLI-092 AC-8 — the verb is registered and mirrored", () => {
  it("is a phase-2 row and is no longer deferred", () => {
    expect(ORCHESTRATE_PHASE2_VERB_ROWS).toContain("replay apply");
    expect(ORCHESTRATE_DEFERRED_VERB_ROWS).not.toContain("replay apply");
    expect(ORCHESTRATE_REGISTERED_VERB_ROWS).toContain("replay apply");
  });

  it("carries a mutation binding, without which the MCP tool would be absent and nothing would say so", () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_replay_apply");
    expect(binding, "no binding for orchestrate_replay_apply").toBeDefined();
    expect(binding?.path).toEqual(["replay", "apply"]);
    expect(binding?.kind).toBe("mutation");
    const names = binding?.options?.map((option) => option.flag) ?? [];
    expect(names).toContain("--plan");
    expect(names).toContain("--applied");
  });

  it("AC-1: both path options are required, so neither can be defaulted into", () => {
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_replay_apply");
    for (const flag of ["--plan", "--applied"]) {
      const option = binding?.options?.find((entry) => entry.flag === flag);
      expect(option?.required, `${flag} must be required`).toBe(true);
    }
    // A default for either would let a run apply a plan nobody named or lose its attempt record.
    expect(binding?.options?.find((entry) => entry.flag === "--dry-run")?.required).toBeUndefined();
  });
});
