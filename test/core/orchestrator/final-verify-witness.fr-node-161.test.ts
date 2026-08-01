import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { computeRunProgress } from "../../../src/core/orchestrator/waves-validate.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";

// @req FR-NODE-161 — a program-counter line is not the run's final verification record.
//
// `FR-NODE-159` closed `latestPerWave` and left its sibling open: `latestFinalVerify` filtered on
// `phase` alone, so a loop-F round record carrying `phase: "final-verify"` and a passing verdict
// became the run's final verification — indistinguishable from the run-scope line that actually
// asserts one. The discriminator is the same `event` field, for the same reason: `kiwi-wave-master`
// writes none, so no already-recorded line reads differently.

const RUN = "run-a";
const BASE = { schema_version: "1.4.0", run_id: RUN, engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;

/** Every wave complete; no run-scope final verification written. */
const COMPLETE: Record<string, unknown>[] = [
  { ...BASE, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } },
  { ...BASE, wave: "wave-1", order: 1, target: "wave-1", status: "complete", summary: "done", verification: { verdict: "pass" } }
];

/** A loop-F round record: a program counter that happens to carry the final-verify phase. */
const ROUND_F = { ...BASE, wave: "all", verb: "final-verify", event: "result", phase: "final-verify", verification: { verdict: "pass" } };

/** §5's third emit: a run-scope line asserting a status, with no program-counter fields. */
const REAL_FINAL = { ...BASE, wave: "all", order: 0, target: "all", phase: "final-verify", status: "complete", summary: "final", verification: { verdict: "pass" } };

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function progress(lines: Record<string, unknown>[]): Promise<ReturnType<typeof computeRunProgress>> {
  const root = mkdtempSync(path.join(tmpdir(), "fr-node-161-"));
  roots.push(root);
  mkdirSync(path.join(root, "kiwi"), { recursive: true });
  writeFileSync(path.join(root, "kiwi/waves.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  const view = await parseWavesJournal({ root }, { runId: RUN, engine: "kiwi-orchestrator", relativePath: "kiwi/waves.jsonl" });
  return computeRunProgress(view);
}

describe("FR-NODE-161 — a program counter cannot stand in for the final verification", () => {
  it("AC-3: with no final-verify line at all, the run still owes one", async () => {
    const state = await progress(COMPLETE);
    expect(state.needsFinalVerify).toBe(true);
    expect(state.runComplete).toBe(false);
  });

  it("AC-1: a loop-F round record does not discharge the run's final verification", async () => {
    const state = await progress([...COMPLETE, ROUND_F]);
    expect(state.needsFinalVerify, "a program-counter line must not discharge the final verification").toBe(true);
    expect(state.runComplete, "and must not complete the run").toBe(false);
  });

  it("AC-2: a genuine run-scope final-verification line does discharge it", async () => {
    const state = await progress([...COMPLETE, REAL_FINAL]);
    expect(state.needsFinalVerify, "the rule must distinguish the two, not refuse both").toBe(false);
    expect(state.runComplete).toBe(true);
  });

  it("AC-4: the two readers agree on what a program-counter line is", async () => {
    // FR-NODE-159's reader already excludes it from wave status; this one must exclude it from the
    // run's final verification. A journal carrying only the program-counter line exercises both.
    const state = await progress([...COMPLETE, ROUND_F]);
    expect([...state.waveStatuses], "the wave status must be unmoved by the same line").toEqual([[1, "complete"]]);
    expect(state.needsFinalVerify).toBe(true);
  });
});
