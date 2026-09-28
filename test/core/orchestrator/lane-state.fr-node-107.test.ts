import { describe, expect, it } from "vitest";
import { LANE_DISPOSITION_KINDS, type WavesEvent } from "../../../src/core/orchestrator/journal-schema.js";
import {
  MERGE_WITNESS_TRAILERS,
  classifyLaneDisposition,
  evaluatePriorStagesIntegrated,
  hasMergeWitness,
  readLaneDisposition,
  type LaneKey,
  type OrchTrailerCommit
} from "../../../src/core/orchestrator/lane-state.js";

// @req FR-NODE-107 — a lane carrying a terminal `lane_disposition` and not merged into
// `frozen.integration_branch` classifies `lane-quarantined` and emits no next action; and
// `P-PRIOR-STAGES-INTEGRATED` is satisfied by a lane that is either merged **or** so dispositioned.

const RUN_ID = "2026-08-02.speckiwi.v260";

function key(overrides: Partial<LaneKey> = {}): LaneKey {
  return { wave: 1, stage: 1, lane: "lane-1", ...overrides };
}

let line = 0;

function result(overrides: Partial<WavesEvent>): WavesEvent {
  line += 1;
  return {
    journalLine: line,
    run_id: RUN_ID,
    wave: "wave-1",
    stage: 1,
    lane: "lane-1",
    event: "result",
    verb: "collect-lane",
    status: "complete",
    ...overrides
  };
}

function trailerCommit(overrides: Partial<Record<string, string>> = {}, commit = "b71c904"): OrchTrailerCommit {
  return {
    commit,
    trailers: {
      "Orch-Run": RUN_ID,
      "Orch-Wave": "1",
      "Orch-Stage": "1",
      "Orch-Lane": "lane-1",
      ...overrides
    } as Record<string, string>
  };
}

function ok<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(`expected ok, got ${JSON.stringify(value)}`);
  return value as Extract<T, { ok: true }>;
}

describe("FR-NODE-107 AC-2 — lane_disposition.kind is a closed two-value enum", () => {
  it("FR-NODE-107 AC-2 declares exactly quarantined | refuted", () => {
    expect([...LANE_DISPOSITION_KINDS]).toEqual(["quarantined", "refuted"]);
  });

  it("FR-NODE-107 AC-2 rejects the kinds that left with the handoff layer and the coupling check on a 2.0.0 line", () => {
    for (const kind of ["demoted", "coupling-reset"]) {
      const read = readLaneDisposition([result({ schema_version: "2.0.0", lane_disposition: { kind } })], key());
      expect(read.ok, kind).toBe(false);
      if (read.ok) throw new Error("unreachable");
      expect(read.code).toBe("lane-disposition-kind-invalid");
    }
  });

  it("FR-NODE-107 AC-2 reads demoted and coupling-reset on a line below 2.0.0 as the terminal kinds they were written as", () => {
    for (const schema_version of ["1.5.0", "1.4.0", undefined]) {
      for (const kind of ["demoted", "coupling-reset"]) {
        const line = result({ lane_disposition: { kind, reason: "left the run" }, ...(schema_version === undefined ? {} : { schema_version }) });
        expect(ok(readLaneDisposition([line], key())).disposition?.kind, `${kind} @ ${schema_version}`).toBe(kind);
      }
    }
  });

  it("FR-NODE-107 AC-2 still rejects a value outside the four-value enum on a line below 2.0.0", () => {
    const read = readLaneDisposition([result({ schema_version: "1.5.0", lane_disposition: { kind: "abandoned" } })], key());
    expect(read.ok).toBe(false);
  });

  it("FR-NODE-107 AC-2 settles an old demoted lane for P-PRIOR-STAGES-INTEGRATED", () => {
    const verdict = evaluatePriorStagesIntegrated({
      runId: RUN_ID,
      wave: 1,
      stage: 2,
      waveLanes: [{ lane: "lane-1", stage: 1 }],
      integrationCommits: [],
      events: [result({ schema_version: "1.5.0", lane_disposition: { kind: "demoted" } })]
    });
    expect(ok(verdict).satisfied).toBe(true);
  });

  it("reads every one of the kinds back", () => {
    for (const kind of LANE_DISPOSITION_KINDS) {
      const read = ok(readLaneDisposition([result({ lane_disposition: { kind, reason: "r", at: "2026-08-02T09:00:00.000Z" } })], key()));
      expect(read.disposition?.kind).toBe(kind);
    }
  });

  it("rejects a kind outside the enum rather than reading it as terminal", () => {
    const read = readLaneDisposition([result({ lane_disposition: { kind: "abandoned" } })], key());
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error("unreachable");
    expect(read.code).toBe("lane-disposition-kind-invalid");
    expect(read.detail).toContain("abandoned");
  });

  it("rejects a lane_disposition carrying no kind at all", () => {
    const read = readLaneDisposition([result({ lane_disposition: { reason: "no kind" } })], key());
    expect(read.ok).toBe(false);
  });

  it("reads null when no line for the key carries a disposition", () => {
    expect(ok(readLaneDisposition([result({})], key())).disposition).toBeNull();
    expect(ok(readLaneDisposition([], key())).disposition).toBeNull();
  });

  it("reads only its own (wave, stage, lane) key", () => {
    const events = [
      result({ wave: "wave-2", lane_disposition: { kind: "refuted" } }),
      result({ stage: 2, lane_disposition: { kind: "quarantined" } }),
      result({ lane: "lane-9", lane_disposition: { kind: "quarantined" } })
    ];
    expect(ok(readLaneDisposition(events, key())).disposition).toBeNull();
    expect(ok(readLaneDisposition(events, key({ wave: 2 }))).disposition?.kind).toBe("refuted");
    expect(ok(readLaneDisposition(events, key({ stage: 2 }))).disposition?.kind).toBe("quarantined");
    expect(ok(readLaneDisposition(events, key({ lane: "lane-9" }))).disposition?.kind).toBe("quarantined");
  });
});

describe("FR-NODE-107 AC-3 — the reader is result-line-agnostic", () => {
  it("FR-NODE-107 AC-3 reads a disposition on a collect-lane result exactly as on verify-lane or remediate-lane", () => {
    const dispositions = ["collect-lane", "verify-lane", "remediate-lane"].map(
      (verb) => ok(readLaneDisposition([result({ verb, lane_disposition: { kind: "refuted", reason: "design refuted at 3.g" } })], key())).disposition
    );
    expect(dispositions[0]).toEqual(dispositions[1]);
    expect(dispositions[1]).toEqual(dispositions[2]);
    expect(dispositions[0]?.kind).toBe("refuted");
  });

  it("ignores a disposition carried on an intent line, because only a result records a fact", () => {
    expect(ok(readLaneDisposition([result({ event: "intent", lane_disposition: { kind: "refuted" } })], key())).disposition).toBeNull();
  });
});

describe("FR-NODE-107 AC-1/AC-4 — the lane-quarantined classification", () => {
  it("classifies an unmerged, dispositioned lane as lane-quarantined with no next action", () => {
    const verdict = ok(
      classifyLaneDisposition({ key: key(), events: [result({ lane_disposition: { kind: "quarantined", reason: "quarantined at 3.h" } })], merged: false })
    );
    expect(verdict.applies).toBe(true);
    if (!verdict.applies) throw new Error("unreachable");
    expect(verdict.klass).toBe("lane-quarantined");
    expect(verdict.nextVerb).toBeNull();
    expect(verdict.disposition.kind).toBe("quarantined");
  });

  it("does not apply to a lane that merged, however it was dispositioned", () => {
    const verdict = ok(classifyLaneDisposition({ key: key(), events: [result({ lane_disposition: { kind: "quarantined" } })], merged: true }));
    expect(verdict.applies).toBe(false);
  });

  it("does not apply to an unmerged lane with no disposition, which stays available to the other classes", () => {
    const verdict = ok(classifyLaneDisposition({ key: key(), events: [result({})], merged: false }));
    expect(verdict.applies).toBe(false);
  });

  it("FR-NODE-107 AC-4: a commitless, action-line-free worker whose collect-lane result carries kind refuted classifies lane-quarantined, not not-dispatched", () => {
    // No dispatch line, no branch, no commit — exactly the shape §4.6 would otherwise read as
    // `not-dispatched` and re-enter `/kiwi-pm` for.
    const verdict = ok(
      classifyLaneDisposition({
        key: key(),
        events: [result({ verb: "collect-lane", lane_disposition: { kind: "refuted", reason: "design item refuted at 3.g" } })],
        merged: false
      })
    );
    expect(verdict.applies).toBe(true);
    if (!verdict.applies) throw new Error("unreachable");
    expect(verdict.klass).toBe("lane-quarantined");
    // The reduction emits no next action for this lane: no re-execution of the refuted unit.
    expect(verdict.nextVerb).toBeNull();
  });

  it("propagates an out-of-enum kind as a refusal rather than classifying the lane at all", () => {
    const verdict = classifyLaneDisposition({ key: key(), events: [result({ lane_disposition: { kind: "abandoned" } })], merged: false });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.code).toBe("lane-disposition-kind-invalid");
  });
});

describe("FR-NODE-107 AC-7 — the phase-1 merge witness is the git-trailer kind", () => {
  it("requires all four Orch-* trailers, and names exactly those four", () => {
    expect([...MERGE_WITNESS_TRAILERS]).toEqual(["Orch-Run", "Orch-Wave", "Orch-Stage", "Orch-Lane"]);
    expect(hasMergeWitness([trailerCommit()], RUN_ID, key())).toBe(true);
    for (const trailer of MERGE_WITNESS_TRAILERS) {
      const stripped = { ...trailerCommit().trailers };
      delete stripped[trailer];
      expect(hasMergeWitness([{ commit: "deadbee", trailers: stripped }], RUN_ID, key()), `${trailer} is required`).toBe(false);
    }
  });

  it("refuses a witness whose Orch-Run names a different run", () => {
    expect(hasMergeWitness([trailerCommit({ "Orch-Run": "some-other-run" })], RUN_ID, key())).toBe(false);
  });

  it("refuses a witness whose wave, stage or lane names a different unit", () => {
    expect(hasMergeWitness([trailerCommit({ "Orch-Wave": "2" })], RUN_ID, key())).toBe(false);
    expect(hasMergeWitness([trailerCommit({ "Orch-Stage": "2" })], RUN_ID, key())).toBe(false);
    expect(hasMergeWitness([trailerCommit({ "Orch-Lane": "lane-2" })], RUN_ID, key())).toBe(false);
  });

  it("accepts the witness among many commits, and none at all is not a witness", () => {
    expect(hasMergeWitness([trailerCommit({ "Orch-Lane": "lane-2" }, "aaa"), trailerCommit({}, "bbb")], RUN_ID, key())).toBe(true);
    expect(hasMergeWitness([], RUN_ID, key())).toBe(false);
  });
});

describe("FR-NODE-107 AC-5/AC-6 — P-PRIOR-STAGES-INTEGRATED", () => {
  const waveLanes = [
    { lane: "lane-1", stage: 1 },
    { lane: "lane-2", stage: 1 },
    { lane: "lane-3", stage: 2 }
  ];

  function priorStages(overrides: Partial<Parameters<typeof evaluatePriorStagesIntegrated>[0]> = {}) {
    return evaluatePriorStagesIntegrated({
      runId: RUN_ID,
      wave: 1,
      stage: 2,
      waveLanes,
      integrationCommits: [],
      events: [],
      ...overrides
    });
  }

  it("AC-5: true when one stage-1 lane is unmerged but terminally dispositioned and every other prior lane has a merge witness", () => {
    const verdict = ok(
      priorStages({
        integrationCommits: [trailerCommit({ "Orch-Lane": "lane-2" }, "a1b2c3d")],
        events: [result({ lane: "lane-1", lane_disposition: { kind: "quarantined", reason: "legally quarantined at 3.h" } })]
      })
    );
    expect(verdict.satisfied).toBe(true);
    expect(verdict.unsettled).toEqual([]);
  });

  it("true when every prior lane carries a merge witness", () => {
    const verdict = ok(
      priorStages({ integrationCommits: [trailerCommit({ "Orch-Lane": "lane-1" }, "aaa"), trailerCommit({ "Orch-Lane": "lane-2" }, "bbb")] })
    );
    expect(verdict.satisfied).toBe(true);
  });

  it("AC-6: false when one lane of a prior stage carries neither a merge witness nor a terminal disposition", () => {
    const verdict = ok(priorStages({ integrationCommits: [trailerCommit({ "Orch-Lane": "lane-1" }, "aaa")] }));
    expect(verdict.satisfied).toBe(false);
    expect(verdict.unsettled).toEqual([{ stage: 1, lane: "lane-2" }]);
  });

  it("names every unsettled lane, not just the first", () => {
    const verdict = ok(priorStages({}));
    expect(verdict.unsettled).toEqual([
      { stage: 1, lane: "lane-1" },
      { stage: 1, lane: "lane-2" }
    ]);
  });

  it("quantifies over stages strictly below s only — stage s's own lanes and later ones are not prior", () => {
    const verdict = ok(priorStages({ stage: 1 }));
    expect(verdict.satisfied, "stage 1 has no prior stage, so the precondition holds vacuously").toBe(true);
    expect(verdict.unsettled).toEqual([]);
  });

  it("does not settle a lane on a disposition recorded against a different wave", () => {
    const verdict = ok(
      priorStages({
        integrationCommits: [trailerCommit({ "Orch-Lane": "lane-2" }, "a1b2c3d")],
        events: [result({ wave: "wave-9", lane: "lane-1", lane_disposition: { kind: "refuted" } })]
      })
    );
    expect(verdict.satisfied).toBe(false);
    expect(verdict.unsettled).toEqual([{ stage: 1, lane: "lane-1" }]);
  });

  it("fails closed and loud on an out-of-enum disposition kind rather than reading the lane as unsettled", () => {
    const verdict = priorStages({
      integrationCommits: [trailerCommit({ "Orch-Lane": "lane-2" }, "a1b2c3d")],
      events: [result({ lane: "lane-1", lane_disposition: { kind: "abandoned" } })]
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.code).toBe("lane-disposition-kind-invalid");
  });

  it("AC-7: needs no ref pair — its whole git input is a list of trailered commits", () => {
    const input = {
      runId: RUN_ID,
      wave: 1,
      stage: 2,
      waveLanes,
      integrationCommits: [trailerCommit({ "Orch-Lane": "lane-1" }, "aaa"), trailerCommit({ "Orch-Lane": "lane-2" }, "bbb")],
      events: []
    };
    // No `laneHeadRef`, no `integrationBranch`, no ancestry flag: there is nothing a `git-ancestor`
    // proof between two named refs could have been passed through.
    expect(Object.keys(input).sort()).toEqual(["events", "integrationCommits", "runId", "stage", "wave", "waveLanes"]);
    expect(ok(evaluatePriorStagesIntegrated(input)).satisfied).toBe(true);
  });
});
