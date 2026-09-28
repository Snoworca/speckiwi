import { describe, expect, it } from "vitest";
import { readLaneDisposition } from "../../../src/core/orchestrator/lane-state.js";
import { computeResumeState } from "../../../src/core/orchestrator/resume.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import type { WavesEvent } from "../../../src/core/orchestrator/journal-schema.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "./resume-fixtures.js";
import { journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// FR-NODE-107 AC-2 — on a line at 2.0.0 or later the disposition reader takes `lane_disposition.kind`
// from the closed two-value enum, so ANY other value — not only the two retired kinds — is rejected; a
// lane whose disposition the reader rejects classifies `divergent` unless it is `lane-possibly-live`,
// and the reconciliation is `ledger-reconciliation-divergent` unless another lane of the stage is
// `lane-possibly-live`.

const V20 = { schema_version: "2.0.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/4.0.0" } as const;

/** Values outside `quarantined | refuted` that were never retired: no enum ever held them. */
const NEVER_MEMBERS = ["abandoned", "Refuted", "quarantine", ""];

function disposed(lane: string, kind: string): Json {
  return result("collect-lane", { ...V20, stage: 1, lane, lane_disposition: { kind, reason: "left the run" } });
}

async function journalView(lines: Json[]) {
  return parseWavesJournal(await journalRoot(lines), { runId: "run-a", engine: "kiwi-orchestrator" });
}

/** A locked workspace on the lane's ref: §4.6's `L(k) = live`. */
function liveWorktree(lane: string) {
  return { path: `/tmp/wt-${lane}`, branch: `kiwi/orch/run-a/${lane}`, locked: true };
}

describe("FR-NODE-107 AC-2 — a 2.0.0 line takes its kind from the two-value enum", () => {
  it("FR-NODE-107 AC-2: the reader rejects a 2.0.0 line whose kind is any value outside quarantined | refuted, and accepts the two", () => {
    let journalLine = 0;
    const line = (kind: string): WavesEvent =>
      ({ journalLine: (journalLine += 1), run_id: "run-a", wave: "wave-1", stage: 1, lane: "lane-1", event: "result", verb: "collect-lane", status: "complete", ...V20, lane_disposition: { kind } }) as WavesEvent;
    const key = { wave: 1, stage: 1, lane: "lane-1" };

    for (const kind of NEVER_MEMBERS) {
      const read = readLaneDisposition([line(kind)], key);
      expect(read.ok, JSON.stringify(kind)).toBe(false);
      if (read.ok) throw new Error("unreachable");
      expect(read.code, JSON.stringify(kind)).toBe("lane-disposition-kind-invalid");
    }
    for (const kind of ["quarantined", "refuted"]) {
      const read = readLaneDisposition([line(kind)], key);
      expect(read.ok && read.disposition?.kind, kind).toBe(kind);
    }
  });

  it("FR-NODE-107 AC-2: a lane whose 2.0.0 disposition is rejected classifies divergent with no next action, and the stage reconciles ledger-reconciliation-divergent", async () => {
    for (const kind of NEVER_MEMBERS) {
      const view = await journalView([waveVerify(V20), disposed("lane-1", kind)]);
      const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());
      const lane = state.classification.find((entry) => entry.lane === "lane-1");
      expect(lane?.klass, JSON.stringify(kind)).toBe("divergent");
      expect(lane?.nextVerb, JSON.stringify(kind)).toBeNull();
      expect(state.nextAction.reconciliation, JSON.stringify(kind)).toBe("ledger-reconciliation-divergent");
      expect(state.blocking, JSON.stringify(kind)).toBe("ledger-reconciliation-divergent");
    }
  });

  it("FR-NODE-107 AC-2: a rejected-disposition lane that is possibly live classifies lane-possibly-live, not divergent", async () => {
    const view = await journalView([waveVerify(V20), disposed("lane-1", "abandoned")]);
    const state = computeResumeState(view, minimalCard(), emptyGitFacts({ worktrees: [liveWorktree("lane-1")] }), emptyDriftInputs());
    const lane = state.classification.find((entry) => entry.lane === "lane-1");
    expect(lane?.klass).toBe("lane-possibly-live");
    expect(lane?.nextVerb).toBeNull();
    expect(state.nextAction.reconciliation).toBe("interrupted-external-action");
  });

  it("FR-NODE-107 AC-2: another possibly-live lane of the stage keeps a divergent lane from making the reconciliation ledger-reconciliation-divergent", async () => {
    const lines = [waveVerify(V20), disposed("lane-1", "abandoned"), result("dispatch-lane", { ...V20, stage: 1, lane: "lane-2" })];
    const view = await journalView(lines);

    const alone = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());
    expect(alone.classification.find((entry) => entry.lane === "lane-1")?.klass).toBe("divergent");
    expect(alone.nextAction.reconciliation, "with no live lane, the divergent lane decides").toBe("ledger-reconciliation-divergent");

    const withLive = computeResumeState(view, minimalCard(), emptyGitFacts({ worktrees: [liveWorktree("lane-2")] }), emptyDriftInputs());
    expect(withLive.classification.map((entry) => [entry.lane, entry.klass])).toEqual([
      ["lane-1", "divergent"],
      ["lane-2", "lane-possibly-live"]
    ]);
    expect(withLive.nextAction.reconciliation).toBe("interrupted-external-action");
  });
});
