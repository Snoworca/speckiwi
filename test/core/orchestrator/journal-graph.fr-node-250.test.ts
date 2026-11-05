import { describe, expect, it } from "vitest";
import {
  CURRENT_WAVES_SCHEMA_VERSION,
  JOURNAL_RULES,
  VERB_RECOVERY_CLASS,
  WAVE_PHASES,
  WAVES_EVENT_FIELDS,
  eventScopeOf
} from "../../../src/core/orchestrator/journal-schema.js";
import { latestGraphReference, parseWavesJournal } from "../../../src/core/orchestrator/waves-journal.js";
import { computeRunProgress, validateWavesJournal } from "../../../src/core/orchestrator/waves-validate.js";
import { complete, journalRoot, waveVerify, type Json } from "./waves-fixtures.js";

// @req FR-NODE-250 — the run journal takes the lines a work-graph run writes: the graph reference on
// the run's first line and on each redecompose line, the confirmed completion conditions on a
// complete line, the redecompose phase and the node-complete-action verb.

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const GRAPH = { path: "kiwi/orchestrator/run-a/waves/waves.json", digest: DIGEST_A };

const STAMP = {
  ts: "2026-11-04T00:00:00Z",
  schema_version: CURRENT_WAVES_SCHEMA_VERSION,
  run_id: "run-a",
  engine: "kiwi-orchestrator",
  writer: "speckiwi-orchestrate/test"
} as const;

/** A wave-state line, legal on its own. */
function state(extra: Json = {}): Json {
  return { ...STAMP, wave: "wave-1", order: 1, target: "wave-1", status: "in_progress", summary: "line", ...extra };
}

/** The wave's passing verification and its legal complete line, which the completion gate requires. */
function verified(extra: Json = {}): Json[] {
  return [waveVerify({ ...STAMP }), complete({ ...STAMP, ...extra })];
}

/** A node-complete-action intent line carrying every required field. */
function action(extra: Json = {}): Json {
  return { ...STAMP, verb: "node-complete-action", wave: "wave-1", action_id: "report", completion_ref: "L2", attempt: 1, ...extra };
}

type Found = { code: string; severity: string; line?: number };

async function viewOf(lines: Json[]) {
  const root = await journalRoot(lines);
  return parseWavesJournal(root, { runId: "run-a", engine: "kiwi-orchestrator" });
}

async function diagnose(lines: Json[]): Promise<Found[]> {
  return validateWavesJournal(await viewOf(lines)) as unknown as Found[];
}

describe("FR-NODE-250 AC-1 — graph on the first line, done_when_confirmed on a complete line", () => {
  // @req FR-NODE-250 AC-1
  it("FR-NODE-250 AC-1: accepts a graph reference on the run's first line and a DW list on a complete line", async () => {
    expect(await diagnose([state({ graph: GRAPH }), ...verified({ done_when_confirmed: ["DW-1", "DW-2"] })])).toEqual([]);
  });

  // @req FR-NODE-250 AC-1
  it("FR-NODE-250 AC-1: refuses a malformed graph reference on the newest line", async () => {
    for (const graph of [
      { path: GRAPH.path },
      { digest: DIGEST_A },
      { path: "", digest: DIGEST_A },
      { path: GRAPH.path, digest: "sha256:abc" },
      { path: GRAPH.path, digest: DIGEST_A.toUpperCase() },
      { path: GRAPH.path, digest: DIGEST_A, extra: 1 },
      "kiwi/waves.json",
      null
    ]) {
      const found = await diagnose([state({ graph })]);
      expect(found, JSON.stringify(graph)).toEqual([expect.objectContaining({ code: "journal-graph-malformed", severity: "error", line: 1 })]);
    }
  });

  // @req FR-NODE-250 AC-1
  it("FR-NODE-250 AC-1: refuses a graph reference on a line that is neither the first nor a redecompose line", async () => {
    const found = await diagnose([state({ graph: GRAPH }), state({ graph: { ...GRAPH, digest: DIGEST_B } })]);
    expect(found).toEqual([expect.objectContaining({ code: "journal-graph-misplaced", severity: "error", line: 2 })]);
  });

  // @req FR-NODE-250 AC-1 — kiwi-orchestrator journals intake decision lines before it decomposes, so its
  // graph rides the run's first graph line, not the run's first line; a later graph still needs redecompose.
  it("FR-NODE-250 AC-1: accepts the graph on the run's first graph line after lines that carry none", async () => {
    expect(await diagnose([state(), state({ graph: GRAPH })])).toEqual([]);
    expect(await diagnose([state(), state({ graph: GRAPH }), state({ graph: { ...GRAPH, digest: DIGEST_B } })])).toEqual([
      expect.objectContaining({ code: "journal-graph-misplaced", severity: "error", line: 3 })
    ]);
  });

  // @req FR-NODE-250 AC-1
  it("FR-NODE-250 AC-1: refuses a malformed done_when_confirmed value", async () => {
    for (const value of ["DW-1", ["DW-0"], ["dw-1"], ["DW-1", 2], [{ id: "DW-1" }], ["AC-1"]]) {
      const found = await diagnose(verified({ done_when_confirmed: value }));
      expect(found, JSON.stringify(value)).toEqual([expect.objectContaining({ code: "done-when-confirmed-malformed", severity: "error", line: 2 })]);
    }
  });

  // @req FR-NODE-250 AC-1
  it("FR-NODE-250 AC-1: declares graph and done_when_confirmed as optional journal fields", () => {
    expect(WAVES_EVENT_FIELDS.optional).toEqual(expect.arrayContaining(["graph", "done_when_confirmed"]));
  });
});

describe("FR-NODE-250 AC-2 — the redecompose phase and the run's latest graph reference", () => {
  // @req FR-NODE-250 AC-2
  it("FR-NODE-250 AC-2: the closed phase enum accepts redecompose", () => {
    expect(WAVE_PHASES as readonly string[]).toContain("redecompose");
  });

  // @req FR-NODE-250 AC-2
  it("FR-NODE-250 AC-2: accepts a redecompose line carrying the new version's graph, over the same path or another", async () => {
    const samePath = { ...GRAPH, digest: DIGEST_B };
    const otherPath = { path: "kiwi/orchestrator/run-a/waves/waves.v2.json", digest: DIGEST_B };
    for (const graph of [samePath, otherPath]) {
      expect(await diagnose([state({ graph: GRAPH }), state({ phase: "redecompose", graph })])).toEqual([]);
    }
  });

  // @req FR-NODE-250 AC-2
  it("FR-NODE-250 AC-2: refuses a redecompose line whose graph is missing or malformed", async () => {
    expect(await diagnose([state({ graph: GRAPH }), state({ phase: "redecompose" })])).toEqual([
      expect.objectContaining({ code: "journal-graph-malformed", severity: "error", line: 2 })
    ]);
    expect(await diagnose([state({ graph: GRAPH }), state({ phase: "redecompose", graph: { path: GRAPH.path } })])).toEqual([
      expect.objectContaining({ code: "journal-graph-malformed", severity: "error", line: 2 })
    ]);
  });

  // @req FR-NODE-250 AC-2
  it("FR-NODE-250 AC-2: a redecompose line does not change any wave's reported status", async () => {
    const lines = [state({ graph: GRAPH }), ...verified()];
    const before = computeRunProgress(await viewOf(lines));
    const after = computeRunProgress(await viewOf([...lines, state({ phase: "redecompose", status: "in_progress", graph: { ...GRAPH, digest: DIGEST_B } })]));
    expect([...before.waveStatuses]).toEqual([[1, "complete"]]);
    expect([...after.waveStatuses]).toEqual([...before.waveStatuses]);
  });

  // @req FR-NODE-250 AC-2
  it("FR-NODE-250 AC-2: the latest graph reference is the first line's until a redecompose line, then the latest redecompose line's", async () => {
    const second = { path: "kiwi/orchestrator/run-a/waves/waves.v2.json", digest: DIGEST_B };
    const third = { path: GRAPH.path, digest: "c".repeat(64) };
    expect(latestGraphReference(await viewOf([state({ graph: GRAPH }), ...verified()]))).toEqual(GRAPH);
    expect(latestGraphReference(await viewOf([state({ graph: GRAPH }), state({ phase: "redecompose", graph: second })]))).toEqual(second);
    expect(
      latestGraphReference(await viewOf([state({ graph: GRAPH }), state({ phase: "redecompose", graph: second }), state(), state({ phase: "redecompose", graph: third })]))
    ).toEqual(third);
    expect(latestGraphReference(await viewOf([state()]))).toBeNull();
  });

  // @req FR-NODE-250 AC-2 — with no redecompose line the latest graph is the first graph line's.
  it("FR-NODE-250 AC-2: the latest graph reference is the first graph line's when the run's first line carries none", async () => {
    expect(latestGraphReference(await viewOf([state(), state({ graph: GRAPH }), ...verified()]))).toEqual(GRAPH);
  });
});

describe("FR-NODE-250 AC-3 — verb node-complete-action", () => {
  // @req FR-NODE-250 AC-3
  it("FR-NODE-250 AC-3: the closed verb enum carries node-complete-action as externally-visible", () => {
    expect((VERB_RECOVERY_CLASS as Record<string, string | null>)["node-complete-action"]).toBe("externally-visible");
    expect(WAVES_EVENT_FIELDS.optional).toEqual(expect.arrayContaining(["action_id", "completion_ref", "attempt", "result", "error"]));
  });

  // @req FR-NODE-250 AC-3
  it("FR-NODE-250 AC-3: accepts the intent line and a result line of sent, failed or waived with an error", async () => {
    expect(await diagnose([action()])).toEqual([]);
    for (const result of ["sent", "failed", "waived"]) {
      expect(await diagnose([action(), action({ result, error: "timeout" })]), result).toEqual([]);
    }
  });

  // @req FR-NODE-250 AC-3
  it("FR-NODE-250 AC-3: a node-complete-action line is judged by its own required set, not the wave-state set", () => {
    expect(eventScopeOf(action())).toBeNull();
  });

  // @req FR-NODE-250 AC-3
  it("FR-NODE-250 AC-3: refuses a line missing a required field, a result outside the three, or a non-string error", async () => {
    for (const field of ["wave", "action_id", "completion_ref", "attempt"]) {
      const line = action();
      delete line[field];
      expect(await diagnose([line]), field).toEqual([expect.objectContaining({ code: "node-complete-action-malformed", severity: "error", line: 1 })]);
    }
    expect(await diagnose([action({ result: "delivered" })])).toEqual([expect.objectContaining({ code: "node-complete-action-malformed", severity: "error" })]);
    expect(await diagnose([action({ result: "failed", error: { message: "x" } })])).toEqual([
      expect.objectContaining({ code: "node-complete-action-malformed", severity: "error" })
    ]);
  });

  // @req FR-NODE-250 AC-1 AC-3
  it("FR-NODE-250 AC-1 AC-3: every new code has a diagnostic JOURNAL_RULES row naming FR-NODE-250", () => {
    for (const code of ["journal-graph-malformed", "journal-graph-misplaced", "done-when-confirmed-malformed", "node-complete-action-malformed"]) {
      const rule = JOURNAL_RULES.find((entry) => entry.code === code);
      expect(rule?.enforcement, code).toBe("diagnostic");
      expect(rule?.source, code).toContain("FR-NODE-250");
    }
  });
});

describe("FR-NODE-250 AC-4 — a node-complete-action line leaves the wave's status alone", () => {
  // @req FR-NODE-250 AC-4
  it("FR-NODE-250 AC-4: neither a status-free nor a status-bearing action line changes the reported status", async () => {
    const lines = [state({ graph: GRAPH }), ...verified()];
    const before = computeRunProgress(await viewOf(lines));
    expect([...before.waveStatuses]).toEqual([[1, "complete"]]);
    for (const extra of [{}, { status: "in_progress" }, { result: "failed", status: "failed" }]) {
      const after = computeRunProgress(await viewOf([...lines, action(extra)]));
      expect([...after.waveStatuses], JSON.stringify(extra)).toEqual([...before.waveStatuses]);
    }
  });
});
