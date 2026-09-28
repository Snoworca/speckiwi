import { describe, expect, it } from "vitest";
import {
  CURRENT_WAVES_SCHEMA_VERSION,
  JOURNAL_RULES,
  JOURNAL_RULE_CODES,
  LANE_DISPOSITION_KINDS_RETIRED_IN_4_0_0,
  VERBS_RETIRED_IN_4_0_0,
  WAVE_PHASES_RETIRED_IN_4_0_0
} from "../../../src/core/orchestrator/journal-schema.js";
import { GATE_IDS_RETIRED_IN_4_0_0 } from "../../../src/core/orchestrator/auto-gate.js";
import { parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { journalRoot, type Json } from "./waves-fixtures.js";

// @req FR-NODE-213 AC-6 — a line stamped 2.0.0 is written under the 4.0.0 contract, so a verb, a lane
// disposition or a phase that 4.0.0 retired is refused on it; a line below 2.0.0 keeps the vocabulary
// it was written under. Retired gates keep their own code (FR-NODE-167 AC-4).

const CODE = "vocabulary-retired-in-4-0-0";

function line(extra: Json): Json {
  return {
    ts: "2026-09-28T00:00:00Z",
    schema_version: CURRENT_WAVES_SCHEMA_VERSION,
    run_id: "run-a",
    engine: "kiwi-orchestrator",
    writer: "speckiwi-orchestrate/test",
    event: "intent",
    verb: "dispatch-lane",
    wave: "wave-1",
    order: 1,
    target: "wave-1",
    status: "in_progress",
    summary: "line",
    ...extra
  };
}

async function diagnose(lines: Json[]): Promise<Array<{ code: string; severity: string; line?: number }>> {
  const root = await journalRoot(lines);
  const view = await parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
  return validateWavesJournal(view) as unknown as Array<{ code: string; severity: string; line?: number }>;
}

describe("FR-NODE-213 AC-6 — a 2.0.0 line cannot carry vocabulary 4.0.0 retired", () => {
  it("FR-NODE-213 AC-6: the code is a JOURNAL_RULE_CODES member with a JOURNAL_RULES row naming its source", () => {
    expect([...JOURNAL_RULE_CODES]).toContain(CODE);
    const rule = JOURNAL_RULES.find((entry) => entry.code === CODE);
    expect(rule?.enforcement).toBe("diagnostic");
    expect(rule?.source.length ?? 0).toBeGreaterThan(0);
  });

  it("FR-NODE-213 AC-6: the retired phases are handoff and pipeline", () => {
    expect([...WAVE_PHASES_RETIRED_IN_4_0_0].sort()).toEqual(["handoff", "pipeline"]);
  });

  for (const verb of VERBS_RETIRED_IN_4_0_0) {
    it(`FR-NODE-213 AC-5 AC-6: refuses verb ${verb} on a 2.0.0 line and accepts it on a 1.5.0 line`, async () => {
      expect(await diagnose([line({ verb })])).toEqual([{ code: CODE, severity: "error", line: 1, message: expect.any(String), details: { field: "verb", value: verb } }]);
      expect(await diagnose([line({ verb, schema_version: "1.5.0" })])).toEqual([]);
    });
  }

  for (const kind of LANE_DISPOSITION_KINDS_RETIRED_IN_4_0_0) {
    it(`FR-NODE-213 AC-6 (FR-NODE-107 AC-2): refuses lane_disposition.kind ${kind} on a 2.0.0 line and accepts it on a 1.5.0 line`, async () => {
      const disposed = { event: "result", lane: "lane-1", lane_disposition: { kind } };
      expect((await diagnose([line(disposed)])).map((entry) => [entry.code, entry.severity])).toEqual([[CODE, "error"]]);
      expect(await diagnose([line({ ...disposed, schema_version: "1.5.0" })])).toEqual([]);
    });
  }

  for (const phase of ["handoff", "pipeline"]) {
    it(`FR-NODE-213 AC-6 (FR-FLOW-104 AC-6): refuses phase ${phase} on a 2.0.0 line and accepts it on a 1.5.0 line`, async () => {
      expect((await diagnose([line({ phase })])).map((entry) => [entry.code, entry.severity])).toEqual([[CODE, "error"]]);
      expect(await diagnose([line({ phase, schema_version: "1.5.0" })])).toEqual([]);
    });
  }

  it("FR-NODE-213 AC-6: the live members accept on a 2.0.0 line — sds-wave, refuted, quarantined, sds, worker", async () => {
    expect(await diagnose([line({ verb: "sds-wave" })])).toEqual([]);
    expect(await diagnose([line({ event: "result", lane: "lane-1", lane_disposition: { kind: "refuted" } })])).toEqual([]);
    expect(await diagnose([line({ event: "result", lane: "lane-1", lane_disposition: { kind: "quarantined" } })])).toEqual([]);
    expect(await diagnose([line({ phase: "sds" })])).toEqual([]);
    expect(await diagnose([line({ phase: "worker" })])).toEqual([]);
  });

  it("FR-NODE-213 AC-6: a line that carries no schema_version reads as 1.0.0 and keeps the old vocabulary", async () => {
    const unversioned = line({ verb: "execute-unit", phase: "handoff" });
    delete unversioned.schema_version;
    delete unversioned.writer;
    expect(await diagnose([unversioned])).toEqual([]);
  });

  it("FR-NODE-213 AC-6: one line naming three retired terms is reported once per term", async () => {
    const found = await diagnose([line({ verb: "execute-unit", phase: "handoff", event: "result", lane: "lane-1", lane_disposition: { kind: "demoted" } })]);
    expect(found.map((entry) => entry.code)).toEqual([CODE, CODE, CODE]);
  });

  // Same positional severity as `abort-gate-outside-vocabulary` and for the same reason: the append
  // validates the whole resulting journal, so an error over history would refuse every later append
  // into that run — `run abort` included.
  it("FR-NODE-213 AC-6 (FR-NODE-167): the newest line is an error and an earlier line a warning", async () => {
    const found = await diagnose([line({ verb: "execute-unit" }), line({ verb: "dispatch-lane" })]);
    expect(found.map((entry) => [entry.code, entry.severity, entry.line])).toEqual([[CODE, "warning", 1]]);
  });

  it("FR-NODE-213 AC-6 (FR-NODE-167 AC-4): a retired gate keeps abort-gate-outside-vocabulary and is not reported twice", async () => {
    const gate = GATE_IDS_RETIRED_IN_4_0_0[0];
    const found = await diagnose([line({ verb: "abort-run", event: "result", wave: "all", abort_gate: gate })]);
    expect(found.map((entry) => entry.code)).toEqual(["abort-gate-outside-vocabulary"]);
  });
});
