import { describe, expect, it } from "vitest";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { computeResumeState, retiredRunMarkers, type DriftInputs } from "../../../src/core/orchestrator/resume.js";
import { emptyDriftInputs, emptyGitFacts, minimalCard } from "./resume-fixtures.js";
import { journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// @req FR-NODE-150 AC-4, FR-NODE-213 AC-6 — digest 4 compared handoff prose against the handoff lock.
// 4.0.0 authors no handoff documents and freezes no handoff lock, so nothing produces either operand:
// a run that supplies neither is not drifting, whatever version it was written under. A run that did
// use the handoff layer is refused as a pre-4.0.0 run before any digest is read.

const V14 = { schema_version: "1.4.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/2.4.1" } as const;
const V20 = { schema_version: "2.0.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/4.0.0" } as const;

async function journalView(lines: Json[]) {
  const root = await journalRoot(lines);
  return parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
}

/** The drift inputs a 4.0.0 caller builds: no handoff lock digests and no handoff prose digests. */
function withoutHandoff(): DriftInputs {
  const inputs = emptyDriftInputs();
  const lockDigests = { ...inputs.lockDigests };
  delete lockDigests.handoff;
  const withoutProse: DriftInputs = { ...inputs, lockDigests };
  delete withoutProse.handoffProseDigests;
  return withoutProse;
}

describe("FR-NODE-150 AC-4 — digest 4 needs no handoff operand", () => {
  it("FR-NODE-150 AC-4: a 2.0.0 run that supplies no handoff digests gets a match on digest 4 and no blocking gate", async () => {
    const view = await journalView([waveVerify(V20)]);
    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), withoutHandoff());

    expect(state.drift.digests.map((entry) => entry.index)).toEqual([1, 2, 3, 4]);
    expect(state.drift.digests[3]).toMatchObject({ index: 4, outcome: "match", gate: null });
    expect(state.blocking).toBeNull();
  });

  it("FR-NODE-150 AC-4 (FR-NODE-213 AC-6): a 1.x run the pre-4.0.0 refusal lets through needs no handoff digest either", async () => {
    const view = await journalView([waveVerify(V14)]);
    expect(retiredRunMarkers(view, minimalCard()), "the run must be one resume accepts").toEqual([]);

    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), withoutHandoff());
    expect(state.drift.digests[3]).toMatchObject({ index: 4, outcome: "match", gate: null });
    expect(state.blocking).toBeNull();
  });

  it("FR-NODE-150 AC-4: prose digests with no handoff lock to compare against are a match, not drift", async () => {
    const view = await journalView([waveVerify(V20)]);
    const inputs = withoutHandoff();
    const state = computeResumeState(view, minimalCard(), emptyGitFacts(), { ...inputs, handoffProseDigests: { "lane-1": "sha256:prose" } });
    expect(state.drift.digests[3]).toMatchObject({ outcome: "match", gate: null });
  });

  it("FR-NODE-213 AC-6: a run that used the handoff layer is named a pre-4.0.0 run before digest 4 could read its handoffs", async () => {
    const view = await journalView([waveVerify({ ...V14, schema_version: "1.5.0" }), result("verify-handoff", { ...V14, schema_version: "1.5.0", stage: 1, lane: "lane-1" })]);
    expect(retiredRunMarkers(view, minimalCard()).join("\n")).toContain("verify-handoff");
  });
});
