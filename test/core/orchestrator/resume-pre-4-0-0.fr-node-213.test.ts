import { describe, expect, it } from "vitest";
import type { CardPrecondition, VerbName } from "../../../src/core/orchestrator/journal-schema.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { computeResumeState, retiredRunMarkers } from "../../../src/core/orchestrator/resume.js";
import type { ResumeCard } from "../../../src/core/orchestrator/resume-card.js";
import { emptyDriftInputs, emptyGitFacts, frozenBlock, minimalCard } from "./resume-fixtures.js";
import { journalRoot, result, waveVerify, type Json } from "./waves-fixtures.js";

// FR-NODE-213 AC-6 — a journal line written before 4.0.0 is not re-validated against the new contract,
// and a run written in the R-PLAN and handoff era is refused on resume rather than read as a 4.0.0 run.

const V15 = { schema_version: "1.5.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/3.0.1" } as const;
const V20 = { schema_version: "2.0.0", engine: "kiwi-orchestrator", writer: "speckiwi-orchestrate/4.0.0" } as const;

async function journalView(lines: Json[]) {
  return parseWavesJournal(await journalRoot(lines), { runId: "run-a", engine: "kiwi-orchestrator" });
}

function demotedLane(version: Json, kind = "demoted"): Json {
  return result("collect-lane", { ...version, stage: 1, lane: "lane-1", lane_disposition: { kind, reason: "left the run" } });
}

describe("FR-NODE-213 AC-6 resume never dispatches a lane a pre-4.0.0 line settled", () => {
  it("FR-NODE-213 AC-6 classifies a lane demoted or coupling-reset on a 1.5.0 line as settled, not as not-dispatched", async () => {
    for (const kind of ["demoted", "coupling-reset"]) {
      const view = await journalView([waveVerify(V15), demotedLane(V15, kind)]);
      const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());
      const lane = state.classification.find((entry) => entry.lane === "lane-1");
      expect(lane?.klass, kind).toBe("lane-quarantined");
      expect(lane?.nextVerb, kind).toBeNull();
      expect(state.nextAction.verb, kind).not.toBe("dispatch-lane");
    }
  });

  it("FR-NODE-213 AC-6 halts rather than dispatching a lane whose 2.0.0 line carries a retired disposition kind", async () => {
    for (const kind of ["demoted", "coupling-reset"]) {
      const view = await journalView([waveVerify(V20), demotedLane(V20, kind)]);
      const state = computeResumeState(view, minimalCard(), emptyGitFacts(), emptyDriftInputs());
      const lane = state.classification.find((entry) => entry.lane === "lane-1");
      expect(lane?.nextVerb, kind).toBeNull();
      expect(state.nextAction.verb, kind).not.toBe("dispatch-lane");
      expect(state.blocking, kind).toBe("ledger-reconciliation-divergent");
    }
  });
});

describe("FR-NODE-213 AC-6 retiredRunMarkers names what makes a run pre-4.0.0", () => {
  it("FR-NODE-213 AC-6 finds nothing in a 4.0.0 run or in a 1.x run that used no retired vocabulary", async () => {
    expect(retiredRunMarkers(await journalView([waveVerify(V20), result("dispatch-lane", { ...V20, stage: 1, lane: "lane-1" })]), minimalCard())).toEqual([]);
    expect(retiredRunMarkers(await journalView([waveVerify(V15), result("dispatch-lane", { ...V15, stage: 1, lane: "lane-1" })]), minimalCard())).toEqual([]);
  });

  it("FR-NODE-213 AC-6 names a retired disposition kind on a line below 2.0.0", async () => {
    const markers = retiredRunMarkers(await journalView([waveVerify(V15), demotedLane(V15)]), minimalCard());
    expect(markers.join("\n")).toContain("demoted");
  });

  it("FR-NODE-213 AC-6 does not call a 2.0.0 line with retired vocabulary pre-4.0.0: it breaks the new contract instead", async () => {
    const lines = [waveVerify(V20), demotedLane(V20), result("execute-unit", { ...V20, stage: 1, lane: "lane-2" })];
    expect(retiredRunMarkers(await journalView(lines), minimalCard())).toEqual([]);
  });

  it("FR-NODE-213 AC-6 names a retired verb on a line below 2.0.0", async () => {
    for (const verb of ["plan-wave", "execute-unit", "author-handoff", "verify-handoff", "commit-dispatch-base", "run-serial-epilogue"]) {
      const markers = retiredRunMarkers(await journalView([waveVerify(V15), result(verb, { ...V15, stage: 1, lane: "lane-1" })]), minimalCard());
      expect(markers.join("\n"), verb).toContain(verb);
    }
  });

  it("FR-NODE-213 AC-6 names a card whose next verb, precondition or frozen rung left in 4.0.0", async () => {
    const view = await journalView([waveVerify(V20)]);
    const card = (overrides: Partial<ResumeCard>) => minimalCard(overrides);
    expect(retiredRunMarkers(view, card({ next_action: { verb: "plan-wave" as VerbName, args: {}, preconditions: [] } })).join("\n")).toContain("plan-wave");
    expect(
      retiredRunMarkers(view, card({ next_action: { verb: "dispatch-lane", args: {}, preconditions: ["P-HANDOFF-VERIFIED" as CardPrecondition] } })).join("\n")
    ).toContain("P-HANDOFF-VERIFIED");
    const rPlan = frozenBlock({ route: { rung: "R-PLAN", lock: "routing/route.lock.json@sha256:1", probe_digest: "sha256:2" } });
    expect(retiredRunMarkers(view, card({ frozen: rPlan })).join("\n")).toContain("R-PLAN");
  });
});
