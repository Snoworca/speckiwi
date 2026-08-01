import { describe, expect, it } from "vitest";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { computeRunProgress, validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { complete, finalVerify, journalRoot, waveVerify, type Json } from "./waves-fixtures.js";

// FR-NODE-142 — the wave completion gate and its run-scoped downgrade-bypass closure.

async function view(lines: Json[], runId = "run-a") {
  const root = await journalRoot(lines);
  return parseWavesJournal(root, { runId, engine: "kiwi-wave-master" });
}

async function codes(lines: Json[], runId = "run-a"): Promise<string[]> {
  return validateWavesJournal(await view(lines, runId)).map((item) => item.code);
}

describe("FR-NODE-142 wave completion gate", () => {
  it("AC-1 refuses a complete whose run and wave carry no wave-verify record", async () => {
    expect(await codes([complete(), finalVerify()])).toContain("complete-without-latest-pass");
  });

  it("AC-1 accepts the same complete once its wave-verify pass is recorded", async () => {
    expect(await codes([waveVerify(), complete(), finalVerify()])).toEqual([]);
  });

  it("AC-2 refuses pass-then-in-progress-then-complete because the gate reads only the latest record", async () => {
    const refused = await codes([
      waveVerify({ verification: { rounds: 1, verdict: "pass" } }),
      waveVerify({ verification: { rounds: 2, verdict: "in-progress" } }),
      complete(),
      finalVerify()
    ]);
    expect(refused).toContain("complete-without-latest-pass");

    // The mirror ordering is legal: the latest record before the complete is the passing one.
    const accepted = await codes([
      waveVerify({ verification: { rounds: 1, verdict: "in-progress" } }),
      waveVerify({ verification: { rounds: 2, verdict: "pass" } }),
      complete(),
      finalVerify()
    ]);
    expect(accepted).toEqual([]);
  });

  it("AC-3 subjects a 1.0.0 complete to the gate when any line in the run is 1.1.0 or higher", async () => {
    const refused = await codes([
      waveVerify({ schema_version: "1.1.0", verification: { verdict: "in-progress" } }),
      complete({ schema_version: "1.0.0", verification: undefined })
    ]);
    // The downgrade-bypass closure: the event's own version is 1.0.0 and the gate still applies.
    expect(refused).toContain("complete-without-latest-pass");
  });

  it("AC-4 respects a complete in a run recorded entirely below 1.1.0 and reports it unverified", async () => {
    const diagnostics = validateWavesJournal(
      await view([complete({ schema_version: "1.0.0", verification: undefined })])
    );

    expect(diagnostics.map((item) => item.code)).toEqual(["complete-without-verification"]);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(computeRunProgress(await view([complete({ schema_version: "1.0.0", verification: undefined })])).waveStatuses.get(1)).toBe(
      "complete"
    );
  });

  it("AC-5 exempts wave=\"all\" from the gate and from per-wave status", async () => {
    const lines = [waveVerify(), complete(), finalVerify()];
    expect(await codes(lines)).toEqual([]);

    const progress = computeRunProgress(await view(lines));
    // A phantom wave would show up here as an extra key that is never complete.
    expect([...progress.waveStatuses.keys()]).toEqual([1]);
    expect(progress.runComplete).toBe(true);
  });

  it("does not let a later wave's verify record satisfy an earlier wave's complete", async () => {
    const refused = await codes([
      waveVerify({ wave: "wave-2", order: 2, target: "wave-2" }),
      complete({ wave: "wave-1" }),
      finalVerify()
    ]);
    expect(refused).toContain("complete-without-latest-pass");
  });

  it("does not let a wave-verify record appended after the complete satisfy it", async () => {
    const refused = await codes([complete(), waveVerify(), finalVerify()]);
    expect(refused).toContain("complete-without-latest-pass");
  });
});
