import { describe, expect, it } from "vitest";
import { parseWorkGraph, type WorkGraph } from "../../../src/core/orchestrator/wave-declaration.js";
import { deriveWorkGraphState, type NodeState, type StateRecord } from "../../../src/core/orchestrator/work-graph-state.js";
import type { WavesEvent } from "../../../src/core/orchestrator/journal-schema.js";
import { actionCounts, completionActionsOf, completionActionKey, renderActionMessage, reportedActionState } from "../../../src/core/orchestrator/completion-actions.js";

// FR-NODE-251 — which completion actions of finished nodes are due, read from the graph and the run
// journal alone, at most once, under an idempotency key a re-completion renews.

type Json = Record<string, unknown>;

const NOTIFY = { kind: "notify", id: "tell", channel: "team" };
const NOTE = { kind: "instruction", id: "note", text: "write the note" };

function node(wave: string, acs: string[], extra: Json = {}): Json {
  return { wave, title: `node ${wave}`, purpose: "why", acs, done_when: [], files: [`src/${wave}.ts`], ...extra };
}

function graphOf(nodes: Json[], extra: Json = {}): WorkGraph {
  const result = parseWorkGraph({ schema_version: "2.0.0", run_id: "run-a", title: "g", scope: { target: "5.3.0" }, nodes, edges: [], ...extra });
  if (!result.ok) throw new Error(result.message);
  return result.graph;
}

const GRAPH = (): WorkGraph =>
  graphOf([node("wave-1", ["FR-A-001 AC-1"], { on_complete: [NOTIFY, NOTE] }), node("wave-2", ["FR-A-002 AC-1"])], { defaults: { on_complete: [NOTIFY] } });

let counter = 0;
function at(event: Json): WavesEvent {
  counter += 1;
  return { journalLine: counter, run_id: "run-a", ...event } as WavesEvent;
}
function wave(n: number, status: string, extra: Json = {}): WavesEvent {
  return at({ wave: `wave-${n}`, status, ...extra });
}
function action(n: number, actionId: string, ref: string, extra: Json = {}): WavesEvent {
  return at({ verb: "node-complete-action", wave: `wave-${n}`, action_id: actionId, completion_ref: ref, attempt: 1, ...extra });
}

function statesOf(journal: WavesEvent[], graph = GRAPH()): Record<string, string> {
  return Object.fromEntries(completionActionsOf({ graph, runId: "run-a", journal }).map((entry) => [`${entry.wave}:${entry.action.id}`, entry.state]));
}

describe("FR-NODE-251 AC-2 the idempotency key", () => {
  // @req FR-NODE-251 AC-2
  it("FR-NODE-251 AC-2: is {run_id}:{wave}:{action_id}:L{n}, n the line of the node's latest complete line", () => {
    expect(completionActionKey("run-a", "wave-1", "tell", 7)).toBe("run-a:wave-1:tell:L7");
    counter = 0;
    const journal = [wave(1, "in_progress"), wave(1, "complete")];
    const [first] = completionActionsOf({ graph: GRAPH(), runId: "run-a", journal });
    expect(first?.key).toBe("run-a:wave-1:tell:L2");
    expect(first?.completionRef).toBe("L2");
  });

  // @req FR-NODE-251 AC-2
  it("FR-NODE-251 AC-2: a node completed again after a re-entry yields a new key", () => {
    counter = 0;
    const journal = [wave(1, "complete"), action(1, "tell", "L1"), action(1, "tell", "L1", { result: "sent" }), wave(1, "in_progress"), wave(1, "complete")];
    const tell = completionActionsOf({ graph: GRAPH(), runId: "run-a", journal }).find((entry) => entry.action.id === "tell");
    expect(tell?.key).toBe("run-a:wave-1:tell:L5");
    expect(tell?.state).toBe("pending");
  });
});

describe("FR-NODE-251 AC-3 the journal state of each action, without the citation scan", () => {
  // @req FR-NODE-251 AC-3
  it("FR-NODE-251 AC-3: only a node whose latest wave-state line is complete has actions, the node's own or the defaults", () => {
    counter = 0;
    const journal = [wave(1, "complete"), wave(2, "complete"), wave(2, "in_progress")];
    expect(statesOf(journal)).toEqual({ "wave-1:tell": "pending", "wave-1:note": "pending" });
    counter = 0;
    expect(statesOf([wave(2, "complete")])).toEqual({ "wave-2:tell": "pending" });
  });

  // @req FR-NODE-251 AC-3
  it("FR-NODE-251 AC-3: pending, sent, waived, interrupted and failed come from the key's latest line", () => {
    counter = 0;
    const journal = [wave(1, "complete")];
    expect(statesOf(journal)["wave-1:tell"]).toBe("pending");
    expect(statesOf([...journal, action(1, "tell", "L1")])["wave-1:tell"]).toBe("interrupted");
    expect(statesOf([...journal, action(1, "tell", "L1"), action(1, "tell", "L1", { result: "sent" })])["wave-1:tell"]).toBe("sent");
    expect(statesOf([...journal, action(1, "tell", "L1"), action(1, "tell", "L1", { result: "waived" })])["wave-1:tell"]).toBe("waived");
    expect(statesOf([...journal, action(1, "tell", "L1"), action(1, "tell", "L1", { result: "failed", error: "boom" })])["wave-1:tell"]).toBe("failed");
    expect(statesOf([...journal, action(1, "tell", "L1", { result: "sent" }), action(1, "tell", "L1")])["wave-1:tell"]).toBe("interrupted");
  });

  // @req FR-NODE-251 AC-3
  it("FR-NODE-251 AC-3: a line naming the node's wave wave-01 carries the node's key", () => {
    counter = 0;
    const journal = [wave(1, "complete"), action(1, "tell", "L1", { wave: "wave-01" }), action(1, "tell", "L1", { wave: "wave-01", result: "sent" })];
    expect(statesOf(journal)["wave-1:tell"]).toBe("sent");
  });

  // @req FR-NODE-251 AC-3
  it("FR-NODE-251 AC-3: a line of another action, another node or another completion does not carry the key", () => {
    counter = 0;
    const journal = [wave(1, "complete"), action(1, "note", "L1", { result: "sent" }), action(2, "tell", "L1", { result: "sent" }), action(1, "tell", "L9", { result: "sent" })];
    expect(statesOf(journal)).toEqual({ "wave-1:tell": "pending", "wave-1:note": "sent" });
  });

  // @req FR-NODE-251 AC-3
  it("FR-NODE-251 AC-3: a sent, waived, interrupted or failed action is never due again, whatever the node's state", () => {
    for (const journalState of ["sent", "waived", "interrupted", "failed"] as const) {
      expect(reportedActionState(journalState, "done")).toBe(journalState);
      expect(reportedActionState(journalState, "unverified")).toBe(journalState);
    }
  });
});

describe("FR-NODE-251 AC-5 the message", () => {
  // @req FR-NODE-251 AC-5
  it("FR-NODE-251 AC-5: substitutes the template's placeholders in one scan, never placeholder text inside a substituted value", () => {
    counter = 0;
    const graph = graphOf([node("wave-1", ["FR-A-001 AC-1"], { title: "Fix {purpose} in {wave}", purpose: "{title} of {run_id}" })]);
    const state = deriveWorkGraphState({ graph, records: [], cited: null, journal: [] });
    const rendered = renderActionMessage("{title} / {purpose} / {github_issues} / {nope} / {wave}", "run-a", graph.nodes[0] as WorkGraph["nodes"][number], state.nodes[0] as NodeState);
    expect(rendered).toBe("Fix {purpose} in {wave} / {title} of {run_id} /  / {nope} / wave-1");
  });
});

describe("FR-NODE-251 AC-4 the scanned split of pending", () => {
  function stateRecord(id: string, checked: boolean): StateRecord {
    return { id, status: "implemented", acceptanceCriteria: [{ id: "AC-1", text: "t", checked, line: 1 }], verificationEvidence: [{ id: "VE-1", type: "test", reference: "t", covers: "all", notes: "" }] };
  }

  // @req FR-NODE-251 AC-4
  it("FR-NODE-251 AC-4: pending is due when the scanned node state is done and held-unverified when it is unverified", () => {
    expect(reportedActionState("pending", "done")).toBe("due");
    expect(reportedActionState("pending", "unverified")).toBe("held-unverified");
  });

  // @req FR-NODE-251 AC-4
  it("FR-NODE-251 AC-4: an uncited AC holds the node's actions instead of making them due", () => {
    counter = 0;
    const graph = GRAPH();
    const journal = [wave(1, "complete")];
    const records = [stateRecord("FR-A-001", true), stateRecord("FR-A-002", true)];
    const actions = completionActionsOf({ graph, runId: "run-a", journal });
    const scanned = (cited: Set<string>) => {
      const state = deriveWorkGraphState({ graph, records, cited, journal });
      return actionCounts(actions, state);
    };
    expect(scanned(new Set(["FR-A-001 AC-1"]))).toEqual({ sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 2, due: 2, "held-unverified": 0 });
    expect(scanned(new Set())).toEqual({ sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 2, due: 0, "held-unverified": 2 });
  });

  // @req FR-NODE-251 AC-3
  it("FR-NODE-251 AC-3: without the scan the counts carry the journal states alone, with no due or held-unverified key", () => {
    counter = 0;
    const graph = GRAPH();
    const journal = [wave(1, "complete"), action(1, "tell", "L1"), action(1, "note", "L1", { result: "failed", error: "x" })];
    const state = deriveWorkGraphState({ graph, records: [stateRecord("FR-A-001", true)], cited: null, journal });
    expect(actionCounts(completionActionsOf({ graph, runId: "run-a", journal }), state)).toEqual({ sent: 0, waived: 0, failed: 1, interrupted: 1, pending: 0 });
  });
});
