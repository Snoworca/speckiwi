import { describe, expect, it } from "vitest";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { computeRunProgress, validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { complete, finalVerify, journalRoot, waveVerify, type Json } from "./waves-fixtures.js";

// FR-NODE-143 — run scoping with no version exemption, and the run-completion predicate.

async function view(lines: Json[], runId: string) {
  const root = await journalRoot(lines);
  return parseWavesJournal(root, { runId, engine: "kiwi-wave-master" });
}

describe("FR-NODE-143 run scoping and the run-completion predicate", () => {
  it("AC-1 reports wave 1 of run B incomplete when only run A completed it", async () => {
    const lines = [waveVerify({ run_id: "run-a" }), complete({ run_id: "run-a" }), waveVerify({ run_id: "run-b" })];

    const runA = computeRunProgress(await view(lines, "run-a"));
    expect(runA.waveStatuses.get(1)).toBe("complete");

    const runB = computeRunProgress(await view(lines, "run-b"));
    expect(runB.waveStatuses.get(1)).toBe("in_progress");
    expect(runB.firstIncompleteWave).toBe(1);
    expect(runB.runComplete).toBe(false);
  });

  it("AC-2 refuses a 1.0.0 complete from another run as evidence for this run", async () => {
    // Run scoping carries no version exemption: the oldest schema version is still another run's.
    const lines = [
      complete({ run_id: "run-a", schema_version: "1.0.0", verification: undefined }),
      waveVerify({ run_id: "run-b", schema_version: "1.0.0" })
    ];

    const runB = computeRunProgress(await view(lines, "run-b"));

    expect(runB.waveStatuses.get(1)).not.toBe("complete");
    expect(runB.runComplete).toBe(false);
  });

  it("AC-3 does not report a run complete when the latest final-verify did not pass", async () => {
    const progress = computeRunProgress(
      await view([waveVerify(), complete(), finalVerify({ status: "failed", verification: { verdict: "fail-residual" } })], "run-a")
    );

    expect(progress.runComplete).toBe(false);
    expect(progress.firstIncompleteWave).toBeNull();
    // Resume targets the final verification rather than reporting the run done.
    expect(progress.needsFinalVerify).toBe(true);
  });

  it("AC-4 reports a run complete when every wave is complete and the latest final-verify passed", async () => {
    const progress = computeRunProgress(await view([waveVerify(), complete(), finalVerify()], "run-a"));

    expect(progress.runComplete).toBe(true);
    expect(progress.needsFinalVerify).toBe(false);
    expect(progress.firstIncompleteWave).toBeNull();
  });

  it("AC-4 reads the latest final-verify, so an earlier failure does not block a later pass", async () => {
    const progress = computeRunProgress(
      await view(
        [
          waveVerify(),
          complete(),
          finalVerify({ status: "failed", verification: { verdict: "fail-residual" } }),
          finalVerify()
        ],
        "run-a"
      )
    );

    expect(progress.runComplete).toBe(true);
  });

  it("AC-5 refuses a non-passing final-verify recorded as complete and accepts it as failed", async () => {
    const refusedLines = [waveVerify(), complete(), finalVerify({ verification: { verdict: "fail-residual" } })];
    const refused = validateWavesJournal(await view(refusedLines, "run-a")).map((item) => item.code);
    expect(refused).toContain("final-verify-not-passed-complete");

    const acceptedLines = [
      waveVerify(),
      complete(),
      finalVerify({ status: "failed", verification: { verdict: "fail-residual" } })
    ];
    const accepted = validateWavesJournal(await view(acceptedLines, "run-a")).map((item) => item.code);
    expect(accepted).toEqual([]);
  });

  it("AC-6 applies the final-verify conjunct per run, not per line", async () => {
    // Entirely below 1.2.0: all waves complete is enough.
    const legacy = computeRunProgress(
      await view([waveVerify({ schema_version: "1.1.0" }), complete({ schema_version: "1.1.0" })], "run-a")
    );
    expect(legacy.runComplete).toBe(true);

    // One 1.2.0 line anywhere in the run subjects it to the conjunct, even though every other line
    // — including the completes — is recorded at 1.1.0.
    const mixed = computeRunProgress(
      await view(
        [
          waveVerify({ schema_version: "1.2.0", wave: "wave-1" }),
          waveVerify({ schema_version: "1.1.0", wave: "wave-1" }),
          complete({ schema_version: "1.1.0", wave: "wave-1" })
        ],
        "run-a"
      )
    );
    expect(mixed.runComplete).toBe(false);
    expect(mixed.needsFinalVerify).toBe(true);
  });

  it("reports the first incomplete wave rather than the lowest-numbered one", async () => {
    const progress = computeRunProgress(
      await view(
        [
          waveVerify({ wave: "wave-1" }),
          complete({ wave: "wave-1" }),
          waveVerify({ wave: "wave-2", order: 2, target: "wave-2" }),
          complete({ wave: "wave-2", order: 2, target: "wave-2" }),
          waveVerify({ wave: "wave-3", order: 3, target: "wave-3" })
        ],
        "run-a"
      )
    );

    expect(progress.firstIncompleteWave).toBe(3);
  });
});
