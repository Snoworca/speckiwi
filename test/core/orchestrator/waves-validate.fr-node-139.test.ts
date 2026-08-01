import { describe, expect, it } from "vitest";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { computeResumeState } from "../../../src/core/orchestrator/resume.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "./resume-fixtures.js";
import { complete, finalVerify, intent, journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// FR-NODE-139 — an unmatched intent is never a diagnostic, and lane terminality is evaluated only on
// a wave `complete` or a `final-verify` line.

const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;

async function view(lines: Json[]) {
  const root = await journalRoot(lines);
  return parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
}

async function codes(lines: Json[]): Promise<string[]> {
  return validateWavesJournal(await view(lines)).map((item) => item.code);
}

describe("FR-NODE-139 unmatched intent and lane terminality", () => {
  it("AC-1 validates a journal whose last line is an unmatched intent with zero diagnostics", async () => {
    const lines = [
      waveVerify(V14),
      result("execute-unit", { stage: 1, lane: "lane-1" }),
      intent("execute-unit", { stage: 1, lane: "lane-2" })
    ];

    expect(await codes(lines)).toEqual([]);
  });

  it("AC-1 keeps validating cleanly after every intent append of the write-ahead discipline", async () => {
    // Each prefix is a journal state the validate-on-every-append host must accept, or the very
    // first write of every verb is refused and the design executes no step at all.
    const full = [
      intent("freeze-lane-plan", {}),
      result("freeze-lane-plan", {}),
      intent("execute-unit", { stage: 1, lane: "lane-1" }),
      result("execute-unit", { stage: 1, lane: "lane-1" })
    ];
    for (let cut = 1; cut <= full.length; cut += 1) {
      expect(await codes(full.slice(0, cut)), `prefix of length ${cut}`).toEqual([]);
    }
  });

  it("AC-2 classifies the same journal as an interrupted verb in computeResumeState", async () => {
    const journal = await view([
      waveVerify(V14),
      result("execute-unit", { stage: 1, lane: "lane-1" }),
      intent("execute-unit", { stage: 1, lane: "lane-2" })
    ]);

    const state = computeResumeState(journal, minimalCard(), emptyGitFacts(), emptyDriftInputs());

    expect(state.nextAction.interrupted).toBe(true);
    expect(state.nextAction.verb).toBe("execute-unit");
    expect(state.nextAction.args.lane).toBe("lane-2");
  });

  it("AC-3 refuses a non-terminal lane on a complete line and stays silent on other lines", async () => {
    const lanePlan = { lock_path: "l.json", digest: "sha256:1", lane_count: 2, stage_count: 1 };
    const settled = result("integrate-lane", { stage: 1, lane: "lane-1", isolation: { profile: "none-serial", merge_sha: "aaa" } });

    // Identical journal state, evaluated on a `complete` line.
    expect(await codes([waveVerify(V14), settled, complete({ ...V14, lane_plan: lanePlan }), finalVerify(V14)])).toEqual([
      "lane-not-terminal"
    ]);

    // The same state with no `complete` and no `final-verify`: no terminality diagnostic.
    expect(await codes([waveVerify(V14), settled, result("execute-unit", { stage: 1, lane: "lane-2", lane_plan: lanePlan })])).toEqual(
      []
    );
  });

  it("AC-3 applies the terminality rule to a final-verify line as well", async () => {
    const lanePlan = { lock_path: "l.json", digest: "sha256:1", lane_count: 2, stage_count: 1 };
    const refused = await codes([
      waveVerify(V14),
      result("integrate-lane", { stage: 1, lane: "lane-1", isolation: { profile: "none-serial", merge_sha: "aaa" } }),
      finalVerify({ ...V14, lane_plan: lanePlan })
    ]);

    expect(refused).toContain("lane-not-terminal");
  });

  it("AC-4 refuses a complete naming an integrated lane that carries no merge_sha", async () => {
    const refused = await codes([
      waveVerify(V14),
      result("integrate-lane", { stage: 1, lane: "lane-1", isolation: { profile: "none-serial" } }),
      complete({ ...V14, lane_plan: { lock_path: "l.json", digest: "sha256:1", lane_count: 1, stage_count: 1 } }),
      finalVerify(V14)
    ]);

    expect(refused).toContain("integrated-lane-without-merge-sha");
  });

  it("AC-5 accepts an append made while a unit is still running", async () => {
    const lines = [
      waveVerify(V14),
      result("integrate-lane", { stage: 1, lane: "lane-1", isolation: { profile: "none-serial", merge_sha: "aaa" } }),
      intent("execute-unit", {
        stage: 1,
        lane: "lane-2",
        lane_plan: { lock_path: "l.json", digest: "sha256:1", lane_count: 2, stage_count: 1 }
      })
    ];

    expect(await codes(lines)).toEqual([]);
  });

  it("counts a terminal lane_disposition as settled for the terminality rule", async () => {
    const accepted = await codes([
      waveVerify(V14),
      result("integrate-lane", { stage: 1, lane: "lane-1", isolation: { profile: "none-serial", merge_sha: "aaa" } }),
      result("execute-unit", {
        stage: 1,
        lane: "lane-2",
        lane_disposition: { kind: "refuted", reason: "design item false", at: "2026-08-02T00:00:00Z" }
      }),
      complete({ ...V14, lane_plan: { lock_path: "l.json", digest: "sha256:1", lane_count: 2, stage_count: 1 } }),
      finalVerify(V14)
    ]);

    expect(accepted).toEqual([]);
  });
});
