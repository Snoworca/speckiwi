import { describe, expect, it } from "vitest";
import { parseWorkGraph, type WorkGraph } from "../../../src/core/orchestrator/wave-declaration.js";
import { citedAcsOf, deriveWorkGraphState, type StateRecord } from "../../../src/core/orchestrator/work-graph-state.js";
import type { WavesEvent } from "../../../src/core/orchestrator/journal-schema.js";
import type { TestSufficiencyReport } from "../../../src/core/testing/test-sufficiency.js";

// FR-NODE-249 — AC completion and node state are derived from the graph, the requirement records,
// the test citations and the run journal by one pure function.

type Json = Record<string, unknown>;

function node(wave: string, acs: string[], extra: Json = {}): Json {
  return { wave, title: `node ${wave}`, purpose: "why", acs, done_when: [], files: [`src/${wave}.ts`], ...extra };
}

/** wave-1 -> wave-2 -> wave-3, and wave-4 standing alone. */
function graphJson(nodes: Json[] = defaultNodes(), edges: Json[] = defaultEdges()): Json {
  return { schema_version: "2.0.0", run_id: "run-a", title: "g", scope: { target: "5.3.0" }, nodes, edges };
}

function defaultNodes(): Json[] {
  return [
    node("wave-1", ["FR-A-001 AC-1", "FR-A-001 AC-2"], { done_when: [{ id: "DW-1", text: "a demo ran" }] }),
    node("wave-2", ["FR-A-002 AC-1"]),
    node("wave-3", ["FR-A-003 AC-1"]),
    node("wave-4", ["FR-A-004 AC-1"])
  ];
}

function defaultEdges(): Json[] {
  return [
    { from: "wave-1", to: "wave-2" },
    { from: "wave-2", to: "wave-3" }
  ];
}

function parsedGraph(value: Json = graphJson()): WorkGraph {
  const result = parseWorkGraph(value);
  if (!result.ok) throw new Error(result.message);
  return result.graph;
}

/** A requirement whose every listed AC is checked and covered by `all`. */
function record(id: string, acIds: string[], extra: Partial<StateRecord> = {}): StateRecord {
  return {
    id,
    status: "implemented",
    acceptanceCriteria: acIds.map((acId, index) => ({ id: acId, text: "t", checked: true, line: index + 1 })),
    verificationEvidence: [{ id: "VE-1", type: "test", reference: "test/x.test.ts", covers: "all", notes: "" }],
    ...extra
  };
}

function records(): StateRecord[] {
  return [record("FR-A-001", ["AC-1", "AC-2"]), record("FR-A-002", ["AC-1"]), record("FR-A-003", ["AC-1"]), record("FR-A-004", ["AC-1"])];
}

const ALL_CITED = new Set(["FR-A-001 AC-1", "FR-A-001 AC-2", "FR-A-002 AC-1", "FR-A-003 AC-1", "FR-A-004 AC-1"]);

let lineNumber = 0;
function line(wave: string, status: string, extra: Json = {}): WavesEvent {
  lineNumber += 1;
  return { journalLine: lineNumber, ts: `2026-11-04T00:00:${String(lineNumber).padStart(2, "0")}Z`, run_id: "run-a", wave, status, ...extra };
}

function stateOf(input: { graph?: WorkGraph; records?: StateRecord[]; cited?: ReadonlySet<string> | null; journal?: WavesEvent[] }, wave: string) {
  const result = deriveWorkGraphState({
    graph: input.graph ?? parsedGraph(),
    records: input.records ?? records(),
    cited: input.cited === undefined ? ALL_CITED : input.cited,
    journal: input.journal ?? []
  });
  const found = result.nodes.find((entry) => entry.wave === wave);
  if (found === undefined) throw new Error(`no node ${wave}`);
  return { result, node: found };
}

describe("FR-NODE-249 AC-1 — when an acceptance criterion is done", () => {
  // @req FR-NODE-249 AC-1
  it("FR-NODE-249 AC-1: with the scan, done needs checked, covered, cited and live, and the result says cited_checked true", () => {
    const { result, node: wave2 } = stateOf({}, "wave-2");
    expect(result.cited_checked).toBe(true);
    expect(wave2.acs).toEqual([{ ref: "FR-A-002 AC-1", checked: true, covered: true, cited: true, expired: false, done: true }]);

    const uncited = stateOf({ cited: new Set(["FR-A-001 AC-1"]) }, "wave-2").node;
    expect(uncited.acs[0]).toMatchObject({ cited: false, done: false });
  });

  // @req FR-NODE-249 AC-1
  it("FR-NODE-249 AC-1: without the scan, citation is null rather than false and the other three conditions decide", () => {
    const { result, node: wave2 } = stateOf({ cited: null }, "wave-2");
    expect(result.cited_checked).toBe(false);
    expect(wave2.acs[0]).toEqual({ ref: "FR-A-002 AC-1", checked: true, covered: true, cited: null, expired: false, done: true });
  });

  // @req FR-NODE-249 AC-1
  it("FR-NODE-249 AC-1: an unchecked, uncovered or expired criterion is not done whether or not the scan ran", () => {
    const unchecked = record("FR-A-002", ["AC-1"], { acceptanceCriteria: [{ id: "AC-1", text: "t", checked: false, line: 1 }] });
    const uncovered = record("FR-A-002", ["AC-1"], { verificationEvidence: [{ id: "VE-1", type: "test", reference: "r", covers: "AC-2", notes: "" }] });
    const expired = record("FR-A-002", [], { expiredAcceptanceCriteria: [{ id: "AC-1", text: "t", checked: true, line: 1, expiredOn: "2026-11-01" }] });
    for (const cited of [ALL_CITED, null]) {
      for (const changed of [unchecked, uncovered, expired]) {
        const list = records().map((entry) => (entry.id === "FR-A-002" ? changed : entry));
        expect(stateOf({ records: list, cited }, "wave-2").node.acs[0]?.done).toBe(false);
      }
    }
    const list = records().map((entry) => (entry.id === "FR-A-002" ? expired : entry));
    expect(stateOf({ records: list }, "wave-2").node.acs[0]).toMatchObject({ checked: true, expired: true, done: false });
    expect(stateOf({ records: records().map((entry) => (entry.id === "FR-A-002" ? uncovered : entry)) }, "wave-2").node.acs[0]?.covered).toBe(false);
    expect(stateOf({ records: records().map((entry) => (entry.id === "FR-A-002" ? unchecked : entry)) }, "wave-2").node.acs[0]?.checked).toBe(false);
  });

  // @req FR-NODE-249 AC-1
  it("FR-NODE-249 AC-1: Covers naming the criterion one by one covers it, and a missing requirement is not done", () => {
    const named = record("FR-A-002", ["AC-1"], { verificationEvidence: [{ id: "VE-1", type: "test", reference: "r", covers: "AC-2, AC-1", notes: "" }] });
    const list = records().map((entry) => (entry.id === "FR-A-002" ? named : entry));
    expect(stateOf({ records: list }, "wave-2").node.acs[0]?.done).toBe(true);
    expect(stateOf({ records: records().filter((entry) => entry.id !== "FR-A-002") }, "wave-2").node.acs[0]?.done).toBe(false);
  });

  // @req FR-NODE-249 AC-1
  it("FR-NODE-249 AC-1: the cited set is the per-AC citations checkTestSufficiency reports", () => {
    const report = {
      requirements: [
        { requirementId: "FR-A-001", acs: [{ acId: "AC-1", cited: true, citations: [] }, { acId: "AC-2", cited: false, citations: [] }] },
        { requirementId: "FR-A-002", acs: [{ acId: "AC-1", cited: true, citations: [] }] }
      ]
    } as unknown as TestSufficiencyReport;
    expect([...citedAcsOf(report)].sort()).toEqual(["FR-A-001 AC-1", "FR-A-002 AC-1"]);
  });
});

describe("FR-NODE-249 AC-2 — the node state", () => {
  // @req FR-NODE-249 AC-2
  it("FR-NODE-249 AC-2: complete with every AC done and every done_when confirmed is done; a missing confirmation is unverified", () => {
    const confirmed = [line("wave-1", "complete", { done_when_confirmed: ["DW-1"] })];
    expect(stateOf({ journal: confirmed }, "wave-1").node.state).toBe("done");
    const unconfirmed = [line("wave-1", "complete")];
    const { node: wave1 } = stateOf({ journal: unconfirmed }, "wave-1");
    expect(wave1.state).toBe("unverified");
    expect(wave1.done_when_unconfirmed).toEqual(["DW-1"]);
  });

  // @req FR-NODE-249 AC-2
  it("FR-NODE-249 AC-2: a complete node with an uncited AC is done without the scan and unverified with it", () => {
    const journal = [line("wave-2", "complete")];
    const cited = new Set([...ALL_CITED].filter((ref) => ref !== "FR-A-002 AC-1"));
    expect(stateOf({ journal, cited: null }, "wave-2").node.state).toBe("done");
    expect(stateOf({ journal, cited }, "wave-2").node.state).toBe("unverified");
    const unchecked = records().map((entry) =>
      entry.id === "FR-A-002" ? record("FR-A-002", ["AC-1"], { acceptanceCriteria: [{ id: "AC-1", text: "t", checked: false, line: 1 }] }) : entry
    );
    expect(stateOf({ journal, cited: null, records: unchecked }, "wave-2").node.state).toBe("unverified");
  });

  // @req FR-NODE-249 AC-2
  it("FR-NODE-249 AC-2: in_progress is running with its phase, failed is failed, and the latest wave-state line decides", () => {
    const running = stateOf({ journal: [line("wave-1", "in_progress", { phase: "worker" })] }, "wave-1").node;
    expect(running).toMatchObject({ state: "running", phase: "worker" });
    expect(stateOf({ journal: [line("wave-1", "in_progress"), line("wave-1", "failed")] }, "wave-1").node.state).toBe("failed");
    expect(stateOf({ journal: [line("wave-1", "failed"), line("wave-1", "in_progress", { phase: "worker" })] }, "wave-1").node.state).toBe("running");
  });

  // @req FR-NODE-249 AC-2
  it("FR-NODE-249 AC-2: a line that records a round or a graph event is not the node's wave-state line", () => {
    const journal = [
      line("wave-1", "complete", { done_when_confirmed: ["DW-1"] }),
      line("wave-1", "in_progress", { round: 2 }),
      line("wave-1", "in_progress", { verb: "node-complete-action", action_id: "a", completion_ref: "L1", attempt: 1 })
    ];
    expect(stateOf({ journal }, "wave-1").node.state).toBe("done");
  });

  // @req FR-NODE-249 AC-2
  it("FR-NODE-249 AC-2: with no line, blocked under a failed ancestor, ready when every predecessor is complete, waiting otherwise", () => {
    expect(stateOf({ journal: [] }, "wave-1").node.state).toBe("ready");
    expect(stateOf({ journal: [] }, "wave-2").node.state).toBe("waiting");
    expect(stateOf({ journal: [] }, "wave-4").node.state).toBe("ready");
    expect(stateOf({ journal: [line("wave-1", "failed")] }, "wave-3").node.state).toBe("blocked");
    expect(stateOf({ journal: [line("wave-1", "failed")] }, "wave-2").node.state).toBe("blocked");
    expect(stateOf({ journal: [line("wave-1", "in_progress")] }, "wave-2").node.state).toBe("waiting");
    // ready reads the predecessor's latest line, not its derived state: an unverified predecessor still frees it.
    expect(stateOf({ journal: [line("wave-1", "complete")] }, "wave-2").node.state).toBe("ready");
  });
});

describe("FR-NODE-249 AC-3 — start and completion times", () => {
  // @req FR-NODE-249 AC-3
  it("FR-NODE-249 AC-3: start is the first in_progress ts, completion the latest complete ts, each null when absent", () => {
    const first = line("wave-1", "in_progress");
    const second = line("wave-1", "in_progress", { phase: "worker" });
    const done1 = line("wave-1", "complete");
    const done2 = line("wave-1", "complete", { done_when_confirmed: ["DW-1"] });
    const { node: wave1 } = stateOf({ journal: [first, second, done1, line("wave-1", "in_progress"), done2] }, "wave-1");
    expect(wave1.started_at).toBe(first.ts);
    expect(wave1.completed_at).toBe(done2.ts);
    const { node: wave2 } = stateOf({ journal: [first] }, "wave-2");
    expect(wave2).toMatchObject({ started_at: null, completed_at: null });
    const roundOnly = stateOf({ journal: [line("wave-2", "in_progress", { round: 1 })] }, "wave-2").node;
    expect(roundOnly.started_at).toBeNull();
  });
});

describe("FR-NODE-244 — the parsed graph keeps the fields its readers derive from", () => {
  // @req FR-NODE-244 AC-2, AC-4, AC-5, AC-6
  it("FR-NODE-244 AC-2: parseWorkGraph keeps every declared field beside the declaration, blocking defaulting to false", () => {
    const value = graphJson(
      [
        node("wave-2", ["FR-A-002 AC-1"], {
          description: "d",
          github_issues: [7, "o/r#3"],
          cautions: ["c"],
          sds: ["docs/sds/a.sds.md"],
          on_complete: [{ id: "n", kind: "notify", channel: "team", message: "m", blocking: true }]
        }),
        node("wave-1", ["FR-A-001 AC-1"], { done_when: [{ id: "DW-1", text: "a demo ran" }] })
      ],
      [{ from: "wave-1", to: "wave-2", reason: "uses it" }]
    );
    const graph = parsedGraph({ ...value, engine: "kiwi-orchestrator", prd: "docs/prd/x.prd.md", defaults: { on_complete: [{ id: "i", kind: "instruction", text: "t" }] } });
    expect(graph).toMatchObject({ runId: "run-a", title: "g", scope: { target: "5.3.0" }, engine: "kiwi-orchestrator", prd: "docs/prd/x.prd.md" });
    expect(graph.defaultOnComplete).toEqual([{ kind: "instruction", id: "i", text: "t", blocking: false }]);
    expect(graph.edges).toEqual([{ from: "wave-1", to: "wave-2", reason: "uses it" }]);
    expect(graph.nodes.map((entry) => entry.wave)).toEqual(["wave-1", "wave-2"]);
    expect(graph.nodes[0]).toMatchObject({ title: "node wave-1", purpose: "why", acs: ["FR-A-001 AC-1"], requirements: ["FR-A-001"], doneWhen: [{ id: "DW-1", text: "a demo ran" }] });
    expect(graph.nodes[0]).not.toHaveProperty("onComplete");
    expect(graph.nodes[1]).toMatchObject({
      description: "d",
      githubIssues: [7, "o/r#3"],
      cautions: ["c"],
      sds: ["docs/sds/a.sds.md"],
      onComplete: [{ kind: "notify", id: "n", channel: "team", message: "m", blocking: true }]
    });
    expect(graph.declaration.waves.map((entry) => [entry.wave, entry.dependsOn])).toEqual([
      ["wave-1", []],
      ["wave-2", ["wave-1"]]
    ]);
  });
});

describe("FR-NODE-249 AC-4 — a pure function", () => {
  // @req FR-NODE-249 AC-4
  it("FR-NODE-249 AC-4: the same frozen input yields the same output and the input is left as it was", () => {
    const deepFreeze = <T>(value: T): T => {
      if (value !== null && typeof value === "object") {
        for (const inner of Object.values(value as object)) deepFreeze(inner);
        Object.freeze(value);
      }
      return value;
    };
    const input = deepFreeze({
      graph: parsedGraph(),
      records: records(),
      cited: ALL_CITED,
      journal: [line("wave-1", "complete", { done_when_confirmed: ["DW-1"] }), line("wave-2", "in_progress")]
    });
    const before = JSON.stringify(input);
    const first = deriveWorkGraphState(input);
    expect(deriveWorkGraphState(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(first.nodes.map((entry) => [entry.wave, entry.state, entry.ac_done, entry.ac_total])).toEqual([
      ["wave-1", "done", 2, 2],
      ["wave-2", "running", 1, 1],
      ["wave-3", "waiting", 1, 1],
      ["wave-4", "ready", 1, 1]
    ]);
  });
});
