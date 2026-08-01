import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseWavesJournal, type WavesJournalView } from "../../../src/core/orchestrator/waves-journal.js";
import { computeRunProgress } from "../../../src/core/orchestrator/waves-validate.js";

// @req FR-NODE-159 — a program-counter line never alters the run's computed wave status.
//
// Both failure directions were live when this file was written. A verb line with no `status` removes
// its wave from `waveStatuses` entirely, so a resumed run cannot find the unfinished wave and
// advances to final verification without it. A verb line stamped `status: "in_progress"` — the
// obvious repair — reopens a wave that had completed. The cause is `latestPerWave`
// (`waves-journal.ts:76`), which is set by every line carrying a `wave-{n}` value; a program-counter
// line is a record that a verb ran, not an assertion about the wave's state.

const RUN = "run-a";
const BASE = { schema_version: "1.4.0", run_id: RUN, engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/test" } as const;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function progress(lines: Record<string, unknown>[]): Promise<ReturnType<typeof computeRunProgress>> {
  const root = mkdtempSync(path.join(tmpdir(), "fr-node-159-"));
  roots.push(root);
  mkdirSync(path.join(root, "kiwi"), { recursive: true });
  writeFileSync(path.join(root, "kiwi/waves.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  const view: WavesJournalView = await parseWavesJournal(
    { root },
    { runId: RUN, engine: "kiwi-orchestrator", relativePath: "kiwi/waves.jsonl" }
  );
  return computeRunProgress(view);
}

/** wave-1 verified and complete, wave-2 still running: a journal whose waves are not all complete. */
const MIXED: Record<string, unknown>[] = [
  { ...BASE, wave: "wave-1", order: 1, target: "wave-1", phase: "wave-verify", status: "in_progress", summary: "verify", verification: { verdict: "pass" } },
  { ...BASE, wave: "wave-1", order: 1, target: "wave-1", status: "complete", summary: "done", verification: { verdict: "pass" } },
  { ...BASE, wave: "wave-2", order: 2, target: "wave-2", status: "in_progress", summary: "working" }
];

/** Exactly what `orchestrate journal append` writes today: a verb, an event, a wave, nothing else. */
function verbLine(wave: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE, wave, verb: "author-design", event: "intent", ...extra };
}

describe("FR-NODE-159 — a program-counter line leaves the computed wave status alone", () => {
  it("AC-5: the baseline is not vacuous — the journal has two waves and one of them is unfinished", async () => {
    const before = await progress(MIXED);
    expect([...before.waveStatuses]).toEqual([
      [1, "complete"],
      [2, "in_progress"]
    ]);
    expect(before.firstIncompleteWave).toBe(2);
    expect(before.needsFinalVerify).toBe(false);
  });

  it("AC-1: a verb line on an in-progress wave leaves that wave in the map, unchanged", async () => {
    const before = await progress(MIXED);
    const after = await progress([...MIXED, verbLine("wave-2")]);
    expect([...after.waveStatuses], "wave-2 must not vanish from the computation").toEqual([...before.waveStatuses]);
    expect(after.firstIncompleteWave, "the run must still resume at wave-2").toBe(before.firstIncompleteWave);
  });

  it("AC-2: a verb line on a completed wave does not reopen it", async () => {
    const before = await progress(MIXED);
    const after = await progress([...MIXED, verbLine("wave-1")]);
    expect([...after.waveStatuses], "wave-1 must stay complete").toEqual([...before.waveStatuses]);
    expect(after.firstIncompleteWave, "a finished wave must not become the first incomplete one").toBe(before.firstIncompleteWave);
  });

  it("AC-2: the same holds when the verb line carries a status of its own", async () => {
    const before = await progress(MIXED);
    const after = await progress([...MIXED, verbLine("wave-1", { status: "in_progress" })]);
    expect([...after.waveStatuses]).toEqual([...before.waveStatuses]);
    expect(after.firstIncompleteWave).toBe(before.firstIncompleteWave);
  });

  it("AC-3: no verb line changes whether a final verification is still owed", async () => {
    const before = await progress(MIXED);
    for (const line of [verbLine("wave-1"), verbLine("wave-2"), verbLine("wave-1", { status: "in_progress" }), verbLine("wave-2", { status: "complete" })]) {
      const after = await progress([...MIXED, line]);
      expect(after.needsFinalVerify, `${JSON.stringify(line.wave)} ${JSON.stringify(line.status)}`).toBe(before.needsFinalVerify);
    }
  });

  it("AC-4: a wave-progress line still moves the computation, so the rule narrows rather than silences", async () => {
    const after = await progress([...MIXED, { ...BASE, wave: "wave-2", order: 2, target: "wave-2", status: "complete", summary: "done", verification: { verdict: "pass" } }]);
    expect([...after.waveStatuses]).toEqual([
      [1, "complete"],
      [2, "complete"]
    ]);
    expect(after.firstIncompleteWave).toBeNull();
  });
});
