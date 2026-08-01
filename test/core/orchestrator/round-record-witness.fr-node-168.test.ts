import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WAVES_EVENT_FIELDS } from "../../../src/core/orchestrator/journal-schema.js";
import { isRoundRecord, parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { computeRunProgress } from "../../../src/core/orchestrator/waves-validate.js";
import { journalRoot, type Json } from "./waves-fixtures.js";

// @req FR-NODE-168 — a round record says what it is, and neither run-state reader mistakes it.
//
// `FR-NODE-159` and `FR-NODE-161` both exclude a round record because "a round record asserts no
// status". Measured, that footing cannot survive `orchestrate round record` writing a real line:
// `status` is the only required field the validator enforces, so a line carrying `verification`
// cannot be written status-free. The discriminator moves to `round`, which the verb already writes.

const COPIES = [
  "skills/claude/_shared/kiwi/waves-event.md",
  "skills/codex/_shared/kiwi/waves-event.md",
  "skills/etc/_shared/kiwi/waves-event.md",
  ".agents/skills/_shared/kiwi/waves-event.md"
];

const BASE = {
  ts: "2026-08-02T00:00:00Z",
  schema_version: "1.4.0",
  run_id: "run-a",
  engine: "kiwi-orchestrator",
  writer: "speckiwi-orchestrate/test",
  summary: "line"
};

function waveLine(wave: number, status: string, extra: Record<string, unknown> = {}): Json {
  return { ...BASE, wave: `wave-${wave}`, order: wave, target: `wave-${wave}`, status, ...extra } as unknown as Json;
}

/** wave-1 verified and complete, wave-2 in progress: the shape FR-NODE-159's own fixture uses. */
function mixed(): Json[] {
  return [
    waveLine(1, "in_progress", { phase: "wave-verify", verification: { verdict: "pass" } }),
    waveLine(1, "complete", { verification: { verdict: "pass" } }),
    waveLine(2, "in_progress")
  ];
}

async function progress(lines: Json[]) {
  const root = await journalRoot(lines);
  return computeRunProgress(await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" }));
}

async function section22(copy: string): Promise<string[]> {
  const body = await readFile(path.join(process.cwd(), copy), "utf8");
  const lines = body.split("\n");
  const start = lines.findIndex((entry) => entry.startsWith("### 2.2"));
  if (start < 0) throw new Error(`${copy} has no "### 2.2" heading`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((entry) => entry.startsWith("### ") || entry.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

describe("FR-NODE-168 AC-1 — `round` is declared", () => {
  it("carries a §2.2 row in every copy and is in WAVES_EVENT_FIELDS.optional", async () => {
    expect(COPIES).toHaveLength(4);
    for (const copy of COPIES) {
      const row = (await section22(copy)).find((entry) => /^\s*\|\s*`round`\s*\|/.test(entry));
      expect(row, `${copy} declares no round row in §2.2`).toBeDefined();
      const cells = (row ?? "").split("|").map((cell) => cell.trim());
      expect(cells[2], `${copy}: round has an empty type cell`).not.toBe("");
      expect(cells[3], `${copy}: round has an empty purpose cell`).not.toBe("");
    }
    expect([...WAVES_EVENT_FIELDS.optional]).toContain("round");
    expect([...WAVES_EVENT_FIELDS.required]).not.toContain("round");
  });
});

describe("FR-NODE-168 AC-2 — a round record is not a wave status", () => {
  it("leaves the wave-status map and the first incomplete wave unchanged", async () => {
    const before = await progress(mixed());
    // Non-vacuity: the baseline must actually hold two waves in different states, or "unchanged"
    // would be satisfied by an empty map.
    expect([...before.waveStatuses]).toEqual([
      [1, "complete"],
      [2, "in_progress"]
    ]);
    expect(before.firstIncompleteWave).toBe(2);

    const roundRecord = waveLine(1, "in_progress", {
      event: "result",
      verb: "post-merge-verify",
      phase: "wave-verify",
      round: 2,
      verification: { verdict: "in-progress" }
    });
    const after = await progress([...mixed(), roundRecord]);

    expect([...after.waveStatuses], "a round record must not reopen wave-1").toEqual([...before.waveStatuses]);
    expect(after.firstIncompleteWave).toBe(before.firstIncompleteWave);
  });
});

describe("FR-NODE-168 AC-3 — a round record is not the run's final verification", () => {
  it("leaves the run still owing one", async () => {
    const complete = [waveLine(1, "in_progress", { phase: "wave-verify", verification: { verdict: "pass" } }), waveLine(1, "complete", { verification: { verdict: "pass" } })];
    const before = await progress(complete);
    expect(before.needsFinalVerify, "the baseline must actually owe a final verification").toBe(true);

    const loopF = {
      ...BASE,
      wave: "all",
      order: 0,
      target: "all",
      status: "in_progress",
      event: "result",
      verb: "final-verify",
      phase: "final-verify",
      round: 1,
      verification: { verdict: "pass" }
    } as unknown as Json;

    const after = await progress([...complete, loopF]);
    expect(after.needsFinalVerify, "a round record must not discharge the run").toBe(true);
    expect(after.runComplete).toBe(false);
  });
});

describe("FR-NODE-168 AC-4 / AC-5 — every other line reads exactly as before", () => {
  it("still honours a status-bearing line that carries no round (FR-NODE-159 AC-2)", async () => {
    const honoured = waveLine(1, "in_progress", { event: "result", verb: "emit-and-finish" });
    const after = await progress([...mixed(), honoured]);
    expect([...after.waveStatuses], "an explicit status assertion is still taken at its word").toEqual([
      [1, "in_progress"],
      [2, "in_progress"]
    ]);
  });

  it("still discharges the run on a genuine run-scope final verification (FR-NODE-161 AC-2)", async () => {
    const complete = [waveLine(1, "in_progress", { phase: "wave-verify", verification: { verdict: "pass" } }), waveLine(1, "complete", { verification: { verdict: "pass" } })];
    // Non-vacuity: `needsFinalVerify` is also false when the wave map is EMPTY, so asserting false
    // after the append proves nothing on its own. Pin the baseline first — measured: a predicate
    // that excluded every line passed the post-condition while the wave never completed at all.
    const before = await progress(complete);
    expect([...before.waveStatuses], "the baseline must hold a completed wave").toEqual([[1, "complete"]]);
    expect(before.needsFinalVerify, "the baseline must actually owe a final verification").toBe(true);

    const genuine = {
      ...BASE,
      wave: "all",
      order: 0,
      target: "all",
      status: "complete",
      phase: "final-verify",
      verification: { verdict: "pass" }
    } as unknown as Json;

    const after = await progress([...complete, genuine]);
    expect(after.needsFinalVerify, "the genuine run-scope line must still discharge the run").toBe(false);
  });
});

describe("FR-NODE-168 AC-6 — one predicate, two call sites", () => {
  it("exports isRoundRecord and both readers use it", async () => {
    expect(isRoundRecord({ journalLine: 1, round: 2 })).toBe(true);
    expect(isRoundRecord({ journalLine: 1 })).toBe(false);
    // A non-numeric `round` is not a round record: the field is the index, not a flag.
    expect(isRoundRecord({ journalLine: 1, round: "2" } as never)).toBe(false);

    const sources = ["src/core/orchestrator/waves-journal.ts", "src/core/orchestrator/waves-validate.ts"];
    let calls = 0;
    for (const source of sources) {
      const body = await readFile(path.join(process.cwd(), source), "utf8");
      calls += (body.match(/isRoundRecord\(/g) ?? []).length;
    }
    // One definition site plus two call sites; a third reader copying the test instead of importing
    // the predicate would move this number.
    expect(calls, "isRoundRecord must be defined once and called exactly twice").toBe(3);
  });
});
