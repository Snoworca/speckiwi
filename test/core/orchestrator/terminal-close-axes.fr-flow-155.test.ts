import { describe, expect, it } from "vitest";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { computeRunProgress, validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { complete, finalVerify, journalRoot, waveVerify, type Json } from "./waves-fixtures.js";

// FR-FLOW-155 AC-7 — what the terminal-line rules do NOT catch, each axis measured rather than
// claimed: an absent close raises nothing; a line that does not close the run is invisible to the
// rule but leaves the run open (runComplete false, needsFinalVerify true), so no false completion;
// a close stamped 1.4.0 silences the rule while runComplete stays true — the one false completion,
// deliberate; a close under another run_id is invisible to the reader given this one; and closing
// the run is not the final-verify phase alone — a delegated-complete dispatch result is judged too.

const PASS: Json = { verification: { rounds: 1, verdict: "pass" } };
const WRITER = "speckiwi-orchestrate/2.10.0";
const TERMINAL_CODES = /^terminal-review-/;

/** A close that owes a terminal review and carries none. */
function reviewlessClose(overrides: Json = {}): Json {
  const close = finalVerify({ schema_version: "1.5.0", writer: WRITER, ...PASS, ...overrides }) as Record<string, unknown>;
  delete close.terminal_review;
  return close as Json;
}

async function judge(lines: Json[], runId = "run-a", engine: "kiwi-wave-master" | "kiwi-orchestrator" = "kiwi-wave-master") {
  const view = await parseWavesJournal(await journalRoot(lines), { runId, engine });
  return { codes: validateWavesJournal(view).map((entry) => entry.code), progress: computeRunProgress(view) };
}

describe("FR-FLOW-155 AC-7 — the axes the terminal-line rules do not judge", () => {
  it("FR-FLOW-155 AC-7: a run that never wrote a terminal line raises nothing, and is not complete", async () => {
    const { codes, progress } = await judge([waveVerify(PASS), complete()]);
    expect(codes).toEqual([]);
    expect(progress.runComplete).toBe(false);
    expect(progress.needsFinalVerify).toBe(true);
  });

  it("FR-FLOW-155 AC-7: a line that does not close the run is not judged, and leaves the run open rather than falsely complete", async () => {
    // The same run-scope line, minus the one thing that makes it close the run: its final-verify phase.
    const notClosing = reviewlessClose() as Record<string, unknown>;
    delete notClosing.phase;
    const { codes, progress } = await judge([complete(), notClosing as Json]);
    expect(codes.filter((code) => TERMINAL_CODES.test(code))).toEqual([]);
    expect(progress.runComplete).toBe(false);
    expect(progress.needsFinalVerify).toBe(true);
  });

  it("FR-FLOW-155 AC-7: stamping the close 1.4.0 silences the diagnostic while runComplete stays true — the one false completion", async () => {
    const at15 = await judge([complete(), reviewlessClose()]);
    expect(at15.codes, "the control: the same close at 1.5.0 is judged").toContain("terminal-review-loop-missing");
    expect(at15.progress.runComplete).toBe(true);

    const at14 = await judge([complete(), reviewlessClose({ schema_version: "1.4.0" })]);
    expect(at14.codes.filter((code) => TERMINAL_CODES.test(code))).toEqual([]);
    expect(at14.progress.runComplete, "the silenced run still reports complete").toBe(true);
    expect(at14.progress.needsFinalVerify).toBe(false);
  });

  it("FR-FLOW-155 AC-7: a close written under another run_id is invisible to the reader given this one", async () => {
    const lines = [complete(), reviewlessClose({ run_id: "run-b" })];
    expect((await judge(lines, "run-a")).codes.filter((code) => TERMINAL_CODES.test(code))).toEqual([]);
    expect((await judge(lines, "run-b")).codes, "the reader given that run_id judges it").toContain("terminal-review-loop-missing");
  });

  it("FR-FLOW-155 AC-7: a delegated-complete dispatch result closes the run and is judged, as the final-verify phase is", async () => {
    const dispatch = (outcome: string): Json => ({
      ts: "2026-08-13T00:00:00.000Z",
      schema_version: "1.5.0",
      writer: WRITER,
      engine: "kiwi-orchestrator",
      run_id: "run-a",
      wave: "all",
      order: 0,
      verb: "dispatch-route",
      event: "result",
      outcome
    });
    expect((await judge([dispatch("delegated-complete")], "run-a", "kiwi-orchestrator")).codes).toContain("terminal-review-loop-missing");
    expect((await judge([dispatch("delegated")], "run-a", "kiwi-orchestrator")).codes.filter((code) => TERMINAL_CODES.test(code))).toEqual([]);
  });
});
