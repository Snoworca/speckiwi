import { describe, expect, it } from "vitest";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import {
  GRAPH,
  actionLine,
  digestOf,
  graphOf,
  node,
  orchestrate,
  waveLine,
  workGraphWorkspace,
  type RequirementSpec
} from "./wave-graph-fixtures.js";

// IR-CLI-113 — `orchestrate wave status` reports every node of a 2.0.0 work graph with its derived
// state, AC progress, action counts and times, and finds the graph by itself without arguments.

const DONE_REQ: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }, { n: 2, checked: true }], covers: "all" };
const OPEN_REQ: RequirementSpec = { id: "FR-ARCH-002", acs: [{ n: 1 }] };

type Wave = Record<string, unknown>;

function wavesOf(payload: Record<string, unknown>): Wave[] {
  return payload.waves as Wave[];
}

describe("IR-CLI-113 AC-1 every node of the graph, with its fields", () => {
  // @req IR-CLI-113 AC-1
  it("IR-CLI-113 AC-1 lists a node the journal does not name, with the existing keys and the new ones", async () => {
    const graph = graphOf([node(1, ["FR-ARCH-001 AC-1", "FR-ARCH-001 AC-2"]), node(2, ["FR-ARCH-002 AC-1"])], [{ from: "wave-1", to: "wave-2", reason: "FR-ARCH-002 needs FR-ARCH-001" }]);
    const { root } = await workGraphWorkspace({
      requirements: [DONE_REQ, OPEN_REQ],
      graph,
      lines: [waveLine(1, "in_progress", { phase: "worker", stage: 1, lane: "lane-r1-wave-1" })]
    });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const waves = wavesOf(run.payload);
    expect(waves.map((wave) => wave.wave)).toEqual(["wave-1", "wave-2"]);
    expect(waves[0]).toEqual({
      wave: "wave-1",
      status: "in_progress",
      phase: "worker",
      sds_id: null,
      stage: 1,
      lane: "lane-r1-wave-1",
      ts: "2026-11-05T01:00:00.000Z",
      title: "node 1",
      state: "running",
      depth: 0,
      ac_total: 2,
      ac_done: 2,
      started_at: "2026-11-05T01:00:00.000Z",
      completed_at: null,
      action_counts: { sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 0 },
      dispatched: true,
      base_sha: null,
      in_graph: true
    });
    expect(waves[1]).toEqual({
      wave: "wave-2",
      status: null,
      phase: null,
      sds_id: null,
      stage: null,
      lane: null,
      ts: null,
      title: "node 2",
      state: "waiting",
      depth: 1,
      ac_total: 1,
      ac_done: 0,
      started_at: null,
      completed_at: null,
      action_counts: { sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 0 },
      dispatched: false,
      base_sha: null,
      in_graph: true
    });
  });

  // @req IR-CLI-113 AC-1
  it("IR-CLI-113 AC-1 carries no description, cautions or per-AC rows", async () => {
    const graph = graphOf([node(1, ["FR-ARCH-001 AC-1"], { description: "long text", cautions: ["careful"] })]);
    const { root } = await workGraphWorkspace({ requirements: [DONE_REQ], graph });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const [wave] = wavesOf(run.payload);
    for (const key of ["description", "cautions", "acs", "purpose"]) expect(wave, key).not.toHaveProperty(key);
    expect(JSON.stringify(run.payload)).not.toContain("long text");
    expect(JSON.stringify(run.payload)).not.toContain("careful");
  });

  // @req IR-CLI-113 AC-1
  it("IR-CLI-113 AC-1 dispatched stays true after a worker line whatever later lines say, and is false without one", async () => {
    const graph = graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(2, ["FR-ARCH-002 AC-1"]), node(3, ["FR-ARCH-002 AC-1"])]);
    const { root } = await workGraphWorkspace({
      requirements: [DONE_REQ, OPEN_REQ],
      graph,
      lines: [
        waveLine(1, "in_progress", { phase: "worker" }),
        waveLine(1, "in_progress", { phase: "wave-verify" }),
        waveLine(1, "failed", { phase: "wave-verify" }),
        waveLine(1, "in_progress", { phase: "execute" }),
        waveLine(2, "in_progress", { phase: "execute" })
      ]
    });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const byWave = new Map(wavesOf(run.payload).map((wave) => [wave.wave, wave]));
    expect(byWave.get("wave-1")?.phase).toBe("execute");
    expect(byWave.get("wave-1")?.dispatched).toBe(true);
    expect(byWave.get("wave-2")?.dispatched).toBe(false);
    expect(byWave.get("wave-3")?.dispatched).toBe(false);
  });

  // @req IR-CLI-113 AC-1
  it("IR-CLI-113 AC-1 a line naming its wave wave-01 is node wave-1's line for dispatched as for its status", async () => {
    const graph = graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(2, ["FR-ARCH-002 AC-1"])]);
    const { root } = await workGraphWorkspace({ requirements: [DONE_REQ, OPEN_REQ], graph, lines: [{ ...waveLine(1, "in_progress", { phase: "worker" }), wave: "wave-01" }] });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const [first] = wavesOf(run.payload);
    expect([first?.wave, first?.phase, first?.state, first?.dispatched]).toEqual(["wave-1", "worker", "running", true]);
  });

  // @req IR-CLI-113 AC-1
  it("IR-CLI-113 AC-1 depth is the longest edge path from a node with no predecessor", async () => {
    const graph = graphOf(
      [node(1, ["FR-ARCH-001 AC-1"]), node(2, ["FR-ARCH-001 AC-2"]), node(3, ["FR-ARCH-002 AC-1"]), node(4, ["FR-ARCH-002 AC-1"])],
      [
        { from: "wave-1", to: "wave-2" },
        { from: "wave-2", to: "wave-3" },
        { from: "wave-1", to: "wave-3" }
      ]
    );
    const { root } = await workGraphWorkspace({ requirements: [DONE_REQ, OPEN_REQ], graph });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(wavesOf(run.payload).map((wave) => [wave.wave, wave.depth])).toEqual([
      ["wave-1", 0],
      ["wave-2", 1],
      ["wave-3", 2],
      ["wave-4", 0]
    ]);
  });
});

describe("IR-CLI-113 AC-1 with IR-CLI-104 AC-1 a wave the journal names stays listed when the graph no longer holds it", () => {
  // @req IR-CLI-113 AC-1
  // @req IR-CLI-104 AC-1
  it("IR-CLI-113 AC-1 lists the union of the graph's nodes and the journal's waves in wave order, marking a wave the graph lacks with in_graph false", async () => {
    const v2 = `${JSON.stringify(graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(4, ["FR-ARCH-001 AC-2"])], [{ from: "wave-1", to: "wave-4" }]))}\n`;
    const { root } = await workGraphWorkspace({
      requirements: [DONE_REQ],
      graph: graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(2, ["FR-ARCH-001 AC-2"]), node(3, ["FR-ARCH-001 AC-2"])]),
      lines: [
        waveLine(1, "complete"),
        waveLine(2, "in_progress", { phase: "worker", stage: 2, lane: "lane-r1-wave-2" }),
        waveLine(2, "failed", { phase: "execute" }),
        waveLine(3, "in_progress", { phase: "execute" }),
        waveLine(1, "in_progress", { phase: "redecompose", graph: { path: "waves/v2.json", digest: digestOf(v2) } })
      ],
      files: { "waves/v2.json": v2 }
    });
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const waves = wavesOf(run.payload);
    expect(waves.map((wave) => [wave.wave, wave.in_graph, wave.state])).toEqual([
      ["wave-1", true, "done"],
      ["wave-2", false, "failed"],
      ["wave-3", false, "running"],
      ["wave-4", true, "ready"]
    ]);
    expect(waves[1]).toEqual({
      wave: "wave-2",
      status: "failed",
      phase: "execute",
      sds_id: null,
      stage: null,
      lane: null,
      ts: "2026-11-05T02:00:00.000Z",
      title: null,
      state: "failed",
      depth: null,
      ac_total: 0,
      ac_done: 0,
      started_at: "2026-11-05T02:00:00.000Z",
      completed_at: null,
      action_counts: { sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 0 },
      dispatched: true,
      base_sha: null,
      in_graph: false
    });
    const summary = run.payload.summary as { nodes: Record<string, number>; attention: string[]; running: string[] };
    expect(summary.attention).toEqual(["wave-2"]);
    expect(summary.running).toEqual(["wave-3"]);
    expect(summary.nodes).toMatchObject({ done: 1, failed: 1, running: 1, ready: 1 });
  });
});

describe("IR-CLI-113 AC-6 a run with no graph or a 1.0.0 declaration keeps the IR-CLI-104 output", () => {
  const V1 = { schema_version: "1.0.0", waves: [{ wave: "wave-1", depends_on: [], files: ["src/w1.ts"], requirements: ["FR-ARCH-001"] }, { wave: "wave-2", depends_on: ["wave-1"], files: ["src/w2.ts"], requirements: ["FR-ARCH-001"] }] };

  // @req IR-CLI-113 AC-6
  it("IR-CLI-113 AC-6 a run whose first line references no graph reports the IR-CLI-104 keys only", async () => {
    const { root } = await workGraphWorkspace({ requirements: [DONE_REQ], firstLine: waveLine(1, "in_progress", { phase: "execute" }) });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(Object.keys(run.payload).sort()).toEqual(["ok", "run", "violations", "waves"]);
    expect(wavesOf(run.payload)).toEqual([{ wave: "wave-1", status: "in_progress", phase: "execute", sds_id: null, stage: null, lane: null, ts: "2026-11-05T01:00:00.000Z" }]);
  });

  // @req IR-CLI-113 AC-6
  it("IR-CLI-113 AC-6 a 1.0.0 declaration given with --waves reports the IR-CLI-104 keys and ready[] only", async () => {
    const { root } = await workGraphWorkspace({
      requirements: [DONE_REQ],
      firstLine: waveLine(1, "complete"),
      files: { [GRAPH]: JSON.stringify(V1) }
    });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1", "--waves", GRAPH]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(Object.keys(run.payload).sort()).toEqual(["ok", "ready", "run", "violations", "waves"]);
    expect(run.payload.ready).toEqual(["wave-2"]);
    expect(wavesOf(run.payload)).toEqual([{ wave: "wave-1", status: "complete", phase: null, sds_id: null, stage: null, lane: null, ts: "2026-11-05T01:00:00.000Z" }]);
  });

  // @req IR-CLI-113 AC-6
  it("IR-CLI-113 AC-6 a 1.0.0 declaration named by the first line's graph reference keeps the IR-CLI-104 keys", async () => {
    const text = JSON.stringify(V1);
    const { root } = await workGraphWorkspace({
      requirements: [DONE_REQ],
      firstLine: { ...waveLine(1, "in_progress"), graph: { path: GRAPH, digest: digestOf(text) } },
      files: { [GRAPH]: text }
    });
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(Object.keys(run.payload).sort()).toEqual(["ok", "run", "violations", "waves"]);
  });
});

const NOTIFY = { kind: "notify", id: "tell", channel: "team" };
const NOTE = { kind: "instruction", id: "note", text: "write it down" };
type Summary = { nodes: Record<string, number>; ac_total: number; ac_done: number; actions: Record<string, number>; ready: string[]; running: string[]; attention: string[] };

/**
 * wave-1 complete (one action sent, one failed), wave-2 failed, wave-3 under wave-2 (blocked), wave-4
 * ready, wave-5 running, wave-6 complete with an interrupted action, wave-7 waiting on wave-5.
 * Journal lines: 1 first line, 2 wave-1 complete, 3..6 wave-1 actions, 7 wave-2 failed, 8 wave-5
 * running, 9 wave-6 complete, 10 wave-6 intent.
 */
function mixedRun(): { graph: Record<string, unknown>; lines: Record<string, unknown>[]; requirements: RequirementSpec[] } {
  const acs = (n: number) => [`FR-ARCH-00${n} AC-1`];
  return {
    requirements: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `FR-ARCH-00${n}`, acs: [{ n: 1, checked: n === 1 || n === 6 }], covers: "all" })),
    graph: graphOf(
      [node(1, acs(1), { on_complete: [NOTIFY, NOTE] }), node(2, acs(2)), node(3, acs(3)), node(4, acs(4)), node(5, acs(5)), node(6, acs(6)), node(7, acs(7))],
      [
        { from: "wave-2", to: "wave-3" },
        { from: "wave-5", to: "wave-7" }
      ],
      { defaults: { on_complete: [NOTIFY] } }
    ),
    lines: [
      waveLine(1, "complete"),
      actionLine(1, "tell", "L2"),
      actionLine(1, "tell", "L2", { result: "sent" }),
      actionLine(1, "note", "L2"),
      actionLine(1, "note", "L2", { result: "failed", error: "no" }),
      waveLine(2, "failed"),
      waveLine(5, "in_progress", { phase: "worker" }),
      waveLine(6, "complete"),
      actionLine(6, "tell", "L9")
    ]
  };
}

describe("IR-CLI-113 AC-2 the run summary", () => {
  // @req IR-CLI-113 AC-2
  it("IR-CLI-113 AC-2 counts nodes per state, ACs and actions, and lists ready, running and attention nodes", async () => {
    const { root } = await workGraphWorkspace(mixedRun());
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const summary = run.payload.summary as Summary;
    expect(summary.nodes).toEqual({ done: 2, unverified: 0, running: 1, failed: 1, blocked: 1, ready: 1, waiting: 1 });
    expect([summary.ac_total, summary.ac_done]).toEqual([7, 2]);
    expect(summary.actions).toEqual({ sent: 1, waived: 0, failed: 1, interrupted: 1, pending: 0 });
    expect(summary.ready).toEqual(["wave-4"]);
    expect(summary.running).toEqual(["wave-5"]);
    expect(summary.attention).toEqual(["wave-1", "wave-2", "wave-3", "wave-6"]);
  });

  // @req IR-CLI-113 AC-2
  it("IR-CLI-113 AC-2 each node's action_counts come from the journal alone, with or without the scan", async () => {
    const { root } = await workGraphWorkspace(mixedRun());
    for (const extra of [[], ["--with-tests"]]) {
      const run = await orchestrate(root, ["wave", "status", "--run-id", "r1", ...extra]);
      expect(run.exit, JSON.stringify(run.payload)).toBe(0);
      const counts = new Map(wavesOf(run.payload).map((wave) => [wave.wave, wave.action_counts as Record<string, number>]));
      expect(counts.get("wave-1")).toMatchObject({ sent: 1, waived: 0, failed: 1, interrupted: 0, pending: 0 });
      expect(counts.get("wave-6")).toMatchObject({ sent: 0, waived: 0, failed: 0, interrupted: 1, pending: 0 });
      expect(counts.get("wave-2")).toMatchObject({ sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 0 });
      expect((run.payload.summary as Summary).attention, extra.join(" ")).toEqual(["wave-1", "wave-2", "wave-3", "wave-6"]);
    }
  });
});

describe("IR-CLI-113 AC-3 change detection without opening either file", () => {
  // @req IR-CLI-113 AC-3
  it("IR-CLI-113 AC-3 carries report_version, the graph path and sha256 digest, and the run's journal line count", async () => {
    const { root, graphText } = await workGraphWorkspace(mixedRun());
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.report_version).toBe("1.0.0");
    expect(run.payload.graph).toEqual({ path: GRAPH, digest: digestOf(graphText) });
    expect(run.payload.journal_lines).toBe(10);
  });
});

describe("IR-CLI-113 AC-4 the citation scan only with --with-tests", () => {
  const CITED: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }, { n: 2, checked: true }], covers: "all" };
  const scanRun = (citations = "// @req FR-ARCH-001 AC-1\n") => ({
    requirements: [CITED],
    graph: graphOf([node(1, ["FR-ARCH-001 AC-1", "FR-ARCH-001 AC-2"], { on_complete: [NOTIFY] }), node(2, ["FR-ARCH-001 AC-2"])]),
    lines: [waveLine(1, "complete")],
    files: { "test/cite.test.ts": citations }
  });

  // @req IR-CLI-113 AC-4
  it("IR-CLI-113 AC-4 without it: cited_checked false, unscanned done-state, no due or held-unverified key, no unverified attention", async () => {
    const { root } = await workGraphWorkspace(scanRun());
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.cited_checked).toBe(false);
    const [first] = wavesOf(run.payload);
    expect([first?.state, first?.ac_done]).toEqual(["done", 2]);
    const summary = run.payload.summary as Summary;
    expect(summary.actions).toEqual({ sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 1 });
    expect(first?.action_counts).toEqual({ sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 1 });
    expect(summary.attention).toEqual([]);
  });

  // @req IR-CLI-113 AC-4
  it("IR-CLI-113 AC-4 with it: cited_checked true, due and held-unverified split pending, and unverified nodes need attention", async () => {
    const { root } = await workGraphWorkspace(scanRun());
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1", "--with-tests"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.cited_checked).toBe(true);
    const [first] = wavesOf(run.payload);
    expect([first?.state, first?.ac_done]).toEqual(["unverified", 1]);
    const summary = run.payload.summary as Summary;
    expect(summary.actions).toEqual({ sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 1, due: 0, "held-unverified": 1 });
    expect(first?.action_counts).toEqual(summary.actions);
    expect(summary.attention).toEqual(["wave-1"]);
    expect(summary.nodes.unverified).toBe(1);
  });

  // @req IR-CLI-113 AC-4
  it("IR-CLI-113 AC-4 a complete node whose AC is unchecked is unverified either way, and listed for attention only with the scan", async () => {
    const { root } = await workGraphWorkspace({
      requirements: [CITED, { id: "FR-ARCH-002", acs: [{ n: 1 }], covers: "all" }],
      graph: graphOf([node(1, ["FR-ARCH-001 AC-1", "FR-ARCH-001 AC-2"]), node(2, ["FR-ARCH-002 AC-1"])]),
      lines: [waveLine(2, "complete")],
      files: { "test/cite.test.ts": "// @req FR-ARCH-002 AC-1\n" }
    });
    const unscanned = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(wavesOf(unscanned.payload)[1]?.state).toBe("unverified");
    expect((unscanned.payload.summary as Summary).attention).toEqual([]);
    const scanned = await orchestrate(root, ["wave", "status", "--run-id", "r1", "--with-tests"]);
    expect((scanned.payload.summary as Summary).attention).toEqual(["wave-2"]);
  });

  // @req IR-CLI-113 AC-4
  it("IR-CLI-113 AC-4 with it, a cited complete node's pending actions are due and need no attention", async () => {
    const { root } = await workGraphWorkspace(scanRun("// @req FR-ARCH-001 AC-1\n// @req FR-ARCH-001 AC-2\n"));
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1", "--with-tests"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const summary = run.payload.summary as Summary;
    expect(summary.actions).toEqual({ sent: 0, waived: 0, failed: 0, interrupted: 0, pending: 1, due: 1, "held-unverified": 0 });
    expect(summary.attention).toEqual([]);
  });
});

describe("IR-CLI-113 AC-5 and AC-8 the argument-free leaf finds the run's latest graph", () => {
  // @req IR-CLI-113 AC-5
  it("IR-CLI-113 AC-5 with no option selects the run and reads the graph its first line references", async () => {
    const { root } = await workGraphWorkspace({ requirements: [DONE_REQ], graph: graphOf([node(1, ["FR-ARCH-001 AC-1"])]) });
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((run.payload.run as Record<string, unknown>).runId).toBe("r1");
    expect(wavesOf(run.payload).map((wave) => wave.title)).toEqual(["node 1"]);
    expect(run.payload.warnings).toEqual([]);
  });

  // @req IR-CLI-113 AC-5 AC-8
  it("IR-CLI-113 AC-5 AC-8 a graph whose bytes changed with no journal line recording it is still read, with graph-digest-mismatch", async () => {
    const { root } = await workGraphWorkspace({ requirements: [DONE_REQ], graph: graphOf([node(1, ["FR-ARCH-001 AC-1"])]) });
    const edited = `${JSON.stringify(graphOf([node(1, ["FR-ARCH-001 AC-1"], { title: "edited by hand" })]))}\n`;
    await writeUnder(root, GRAPH, edited);
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(wavesOf(run.payload).map((wave) => wave.title)).toEqual(["edited by hand"]);
    expect((run.payload.warnings as Array<{ code: string }>).map((entry) => entry.code)).toEqual(["graph-digest-mismatch"]);
    expect((run.payload.graph as Record<string, unknown>).digest).toBe(digestOf(edited));
  });

  // @req IR-CLI-113 AC-5 AC-8
  it("IR-CLI-113 AC-5 AC-8 after a redecompose line naming another path, reads that version and warns of nothing", async () => {
    const v2 = `${JSON.stringify(graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(2, ["FR-ARCH-001 AC-2"], { title: "added" })]))}\n`;
    const { root } = await workGraphWorkspace({
      requirements: [DONE_REQ],
      graph: graphOf([node(1, ["FR-ARCH-001 AC-1"])]),
      lines: [waveLine(1, "in_progress", { phase: "redecompose", graph: { path: "waves/waves.v2.json", digest: digestOf(v2) } })],
      files: { "waves/waves.v2.json": v2 }
    });
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(wavesOf(run.payload).map((wave) => wave.title)).toEqual(["node 1", "added"]);
    expect(run.payload.graph).toEqual({ path: "waves/waves.v2.json", digest: digestOf(v2) });
    expect(run.payload.warnings).toEqual([]);
  });

  // @req IR-CLI-113 AC-8
  it("IR-CLI-113 AC-8 after a redecompose line that overwrote the earlier path, reads it and warns of nothing", async () => {
    const v2 = `${JSON.stringify(graphOf([node(1, ["FR-ARCH-001 AC-1"], { title: "rewritten" })]))}\n`;
    const { root } = await workGraphWorkspace({
      requirements: [DONE_REQ],
      graph: graphOf([node(1, ["FR-ARCH-001 AC-1"])]),
      lines: [waveLine(1, "in_progress", { phase: "redecompose", graph: { path: GRAPH, digest: digestOf(v2) } })]
    });
    await writeUnder(root, GRAPH, v2);
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(wavesOf(run.payload).map((wave) => wave.title)).toEqual(["rewritten"]);
    expect(run.payload.warnings).toEqual([]);
  });
});

describe("IR-CLI-113 AC-7 wave status --with-tests agrees with wave actions", () => {
  // @req IR-CLI-113 AC-7
  it("IR-CLI-113 AC-7 the due and held-unverified counts per node and in the summary equal wave actions'", async () => {
    const spec = mixedRun();
    // Lines: 1 first line, 2 wave-1 complete (both actions pending, cited: due), 3 wave-4 complete
    // (its AC unchecked: held-unverified), 4 wave-6 complete, 5 wave-6's intent (interrupted).
    const lines = [waveLine(1, "complete"), waveLine(4, "complete"), waveLine(6, "complete"), actionLine(6, "tell", "L4")];
    const { root } = await workGraphWorkspace({ ...spec, lines, files: { "test/cite.test.ts": "// FR-ARCH-001 AC-1\n" } });
    const status = await orchestrate(root, ["wave", "status", "--run-id", "r1", "--with-tests"]);
    const actions = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    expect(status.exit, JSON.stringify(status.payload)).toBe(0);
    expect(actions.exit, JSON.stringify(actions.payload)).toBe(0);
    const listed = actions.payload.actions as Array<{ wave: string; state: string }>;
    const count = (state: string, wave?: string) => listed.filter((entry) => entry.state === state && (wave === undefined || entry.wave === wave)).length;
    const summary = status.payload.summary as Summary;
    expect([summary.actions.due, summary.actions["held-unverified"]]).toEqual([count("due"), count("held-unverified")]);
    expect(count("due")).toBeGreaterThan(0);
    expect(count("held-unverified")).toBeGreaterThan(0);
    for (const wave of wavesOf(status.payload)) {
      const counts = wave.action_counts as Record<string, number>;
      expect([counts.due, counts["held-unverified"]], String(wave.wave)).toEqual([count("due", wave.wave as string), count("held-unverified", wave.wave as string)]);
    }
  });
});
