import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/server.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import {
  GRAPH,
  JOURNAL,
  bytesOf,
  firstLineFor,
  graphOf,
  node,
  orchestrate,
  waveLine,
  workGraphWorkspace,
  type Line,
  type RequirementSpec
} from "./wave-graph-fixtures.js";

// IR-CLI-113 AC-9 — a leaf given `--run-id` and no `--engine` reads, and `round record` writes, that
// run under the engine its journal lines carry.

const WM = "kiwi-wave-master";
const KO = "kiwi-orchestrator";
const DONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }], covers: "all" };
const GRAPH_VALUE = graphOf([node(1, ["FR-ARCH-001 AC-1"], { on_complete: [{ kind: "notify", id: "tell", channel: "team-chat" }] })]);
const GRAPH_TEXT = `${JSON.stringify(GRAPH_VALUE, null, 2)}\n`;
const CITES = { "test/cite.test.ts": "// @req FR-ARCH-001 AC-1\n" };
const PROOF = { kind: "digest", ref: "sha256:0123456789abcdef" };
const ROUND = {
  loop: "P", scope: "wave-1-post", roundIndex: 1, mode: "normal", cap: 5, streakBefore: 0, frozenDenominator: 1,
  verifiers: ["verifier-1"], rows: [{ id: "R-1", verdict: "pass", kept: false, verifier: "verifier-1" }],
  fixAppliedThisRound: false, regression: { failingTests: [], baselineFailingTests: [], exitCode: 0 }, residual: []
};

/** A line as kiwi-wave-master writes it: no `engine` field at all. */
function unstamped(line: Line): Line {
  return Object.fromEntries(Object.entries(line).filter(([key]) => key !== "engine"));
}

/** The run's lines under one engine: the graph line, then wave-1 complete, then a line naming wave-9 (not a node). */
function runLines(engine: string | null): { firstLine: Line; lines: Line[] } {
  const stamp = (line: Line): Line => (engine === null ? unstamped(line) : { ...line, engine });
  return { firstLine: stamp(firstLineFor(GRAPH_TEXT)), lines: [stamp(waveLine(1, "complete")), stamp(waveLine(9, "pending"))] };
}

async function workspace(engine: string | null) {
  const { firstLine, lines } = runLines(engine);
  return (await workGraphWorkspace({ requirements: [DONE], graph: GRAPH_VALUE, firstLine, lines, files: CITES })).root;
}

/** A journal holding run r1 under both engines. */
async function bothEnginesWorkspace() {
  const wm = runLines(null);
  const ko = runLines(KO);
  return (await workGraphWorkspace({ requirements: [DONE], graph: GRAPH_VALUE, firstLine: wm.firstLine, lines: [...wm.lines, ko.firstLine, ...ko.lines], files: CITES })).root;
}

/**
 * A journal whose run r1 lines were appended through `journal append` (so they carry the writer stamp the
 * kiwi-orchestrator checks require), one in-progress wave-1 line per engine; `null` appends a line with no engine.
 */
async function appendedWorkspace(engines: ReadonlyArray<string | null>) {
  const { root } = await workGraphWorkspace({ requirements: [DONE], noJournal: true });
  await writeUnder(root, JOURNAL, "");
  for (const engine of engines) {
    const line = { schema_version: "2.0.0", run_id: "r1", wave: "wave-1", order: 1, target: "v1.0.0", summary: "wave 1", status: "in_progress", phase: "worker", ...(engine === null ? {} : { engine }) };
    const appended = await orchestrate(root, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(line)]);
    if (appended.exit !== 0) throw new Error(`seed append failed: ${JSON.stringify(appended.payload)}`);
  }
  return root;
}

const READ_LEAVES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["wave status", ["wave", "status", "--run-id", "r1"]],
  ["wave show", ["wave", "show", "--wave", "wave-1", "--run-id", "r1"]],
  ["wave actions", ["wave", "actions", "--run-id", "r1"]],
  ["wave check", ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]]
];

function roundRecord(extra: readonly string[] = []): string[] {
  return ["round", "record", "--run-id", "r1", "--payload", JSON.stringify(ROUND), "--proof", JSON.stringify(PROOF), ...extra];
}

async function lastLine(root: string): Promise<Record<string, unknown>> {
  const lines = (await bytesOf(root, JOURNAL)).trimEnd().split("\n");
  return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

describe("IR-CLI-113 AC-9 the engine is read from the run's journal lines", () => {
  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 wave status, show and actions read a run whose lines carry no engine as kiwi-wave-master", async () => {
    const root = await workspace(null);
    for (const [name, argv] of READ_LEAVES.slice(0, 3)) {
      const run = await orchestrate(root, argv);
      expect(run.exit, `${name}: ${JSON.stringify(run.payload)}`).toBe(0);
      expect((run.payload.run as { engine: string }).engine, name).toBe(WM);
    }
    const actions = await orchestrate(root, ["wave", "actions", "--run-id", "r1"]);
    expect((actions.payload.actions as Array<{ state: string }>).map((row) => row.state)).toEqual(["due"]);
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 wave check reads a kiwi-wave-master run's journal and reports the wave it names that is not a node", async () => {
    const root = await workspace(WM);
    const run = await orchestrate(root, ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]);
    expect(JSON.stringify(run.payload)).toContain("journal-wave-missing");
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 round record writes a kiwi-wave-master run's round under kiwi-wave-master", async () => {
    const root = await appendedWorkspace([null]);
    const run = await orchestrate(root, roundRecord());
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((await lastLine(root)).engine).toBe(WM);
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 a kiwi-orchestrator run is still read and written under kiwi-orchestrator", async () => {
    const status = await orchestrate(await workspace(KO), ["wave", "status", "--run-id", "r1"]);
    expect((status.payload.run as { engine: string }).engine).toBe(KO);
    const root = await appendedWorkspace([KO]);
    const recorded = await orchestrate(root, roundRecord());
    expect(recorded.exit, JSON.stringify(recorded.payload)).toBe(0);
    expect((await lastLine(root)).engine).toBe(KO);
  });
});

describe("IR-CLI-113 AC-9 a run no line belongs to takes the default kiwi-orchestrator", () => {
  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 round record of a run the journal does not hold writes under kiwi-orchestrator", async () => {
    const root = await appendedWorkspace([null]);
    const run = await orchestrate(root, ["round", "record", "--run-id", "r2", "--payload", JSON.stringify(ROUND), "--proof", JSON.stringify(PROOF)]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const line = await lastLine(root);
    expect([line.run_id, line.engine]).toEqual(["r2", KO]);
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 wave status of a run the journal does not hold reads it under kiwi-orchestrator", async () => {
    const root = await workspace(null);
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r2"]);
    expect(run.exit).toBe(1);
    expect(run.payload.error).toBe(`run r2 has no ${KO} line in ${JOURNAL}`);
  });
});

describe("IR-CLI-113 AC-9 a run under both engines is refused", () => {
  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 every leaf refuses with a usage error naming both engines", async () => {
    const root = await bothEnginesWorkspace();
    for (const [name, argv] of [...READ_LEAVES, ["round record", roundRecord()] as const]) {
      const run = await orchestrate(root, argv);
      expect(run.exit, name).toBe(1);
      expect(run.payload.error, name).toContain(KO);
      expect(run.payload.error, name).toContain(WM);
    }
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 round record writes nothing when it refuses", async () => {
    const root = await bothEnginesWorkspace();
    const before = await bytesOf(root, JOURNAL);
    expect((await orchestrate(root, roundRecord())).exit).toBe(1);
    expect(await bytesOf(root, JOURNAL)).toBe(before);
  });
});

describe("IR-CLI-113 AC-9 an explicit --engine keeps its behaviour", () => {
  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 with --engine a run under both engines is read under the engine named", async () => {
    const root = await bothEnginesWorkspace();
    for (const engine of [KO, WM]) {
      const run = await orchestrate(root, ["wave", "status", "--run-id", "r1", "--engine", engine]);
      expect(run.exit, JSON.stringify(run.payload)).toBe(0);
      expect((run.payload.run as { engine: string }).engine).toBe(engine);
    }
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 with --engine kiwi-orchestrator a kiwi-wave-master run is read as having no line, as before", async () => {
    const root = await workspace(null);
    const run = await orchestrate(root, ["wave", "actions", "--run-id", "r1", "--engine", KO]);
    expect(run.exit).toBe(1);
    expect(run.payload.error).toBe(`run r1 has no ${KO} line in ${JOURNAL}`);
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 round record --engine writes under the engine named, whatever the journal holds", async () => {
    const root = await appendedWorkspace([null, KO]);
    const run = await orchestrate(root, roundRecord(["--engine", WM]));
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((await lastLine(root)).engine).toBe(WM);
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 round record refuses an --engine outside the two engines", async () => {
    const root = await workspace(null);
    const before = await bytesOf(root, JOURNAL);
    const run = await orchestrate(root, roundRecord(["--engine", "kiwi-other"]));
    expect(run.exit).toBe(1);
    expect(await bytesOf(root, JOURNAL)).toBe(before);
  });
});

describe("IR-CLI-113 AC-9 the MCP tools take the same path", () => {
  async function viaMcp(root: string, tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await createMcpServer({ root }).callTool(tool, input)) as Record<string, unknown>;
  }

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 orchestrate_wave_actions and orchestrate_round_record infer kiwi-wave-master from the run", async () => {
    const actions = await viaMcp(await workspace(null), "orchestrate_wave_actions", { runId: "r1" });
    expect((actions.run as { engine: string } | undefined)?.engine, JSON.stringify(actions)).toBe(WM);
    const root = await appendedWorkspace([null]);
    const recorded = await viaMcp(root, "orchestrate_round_record", { runId: "r1", payload: ROUND, proof: PROOF });
    expect(recorded.ok, JSON.stringify(recorded)).toBe(true);
    expect((await lastLine(root)).engine).toBe(WM);
  });

  // @req IR-CLI-113 AC-9
  it("IR-CLI-113 AC-9 orchestrate_round_record takes engine and writes under it", async () => {
    const root = await appendedWorkspace([null, KO]);
    const recorded = await viaMcp(root, "orchestrate_round_record", { runId: "r1", payload: ROUND, proof: PROOF, engine: WM });
    expect(recorded.ok, JSON.stringify(recorded)).toBe(true);
    expect((await lastLine(root)).engine).toBe(WM);
  });
});

// IR-CLI-113 AC-10, IR-CLI-114 AC-5 — `--waves` names a 2.0.0 graph and `--run-id` a run with no journal line yet.

const TWO_NODES = graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(2, ["FR-ARCH-001 AC-1"])], [{ from: "wave-1", to: "wave-2", reason: "order" }]);
const V1_DECLARATION = { schema_version: "1.0.0", waves: [{ wave: "wave-1", depends_on: [], files: ["src/w1.ts"], requirements: ["FR-ARCH-001"] }] };

/** A journal holding one line of an earlier run r0 and none of r1; `journal: false` writes no journal at all. */
async function linelessWorkspace(journal = true) {
  const earlier = { ...waveLine(1, "pending"), run_id: "r0", engine: WM };
  return (
    await workGraphWorkspace({
      requirements: [DONE],
      graph: TWO_NODES,
      noJournal: true,
      files: { ...(journal ? { [JOURNAL]: `${JSON.stringify(earlier)}\n` } : {}), "waves/v1.json": `${JSON.stringify(V1_DECLARATION)}\n` }
    })
  ).root;
}

type Row = Record<string, unknown>;

describe("IR-CLI-113 AC-10 wave status of a run with no journal line, given a 2.0.0 graph", () => {
  // @req IR-CLI-113 AC-10
  it("IR-CLI-113 AC-10 reports every node, none dispatched, with a journal line count of 0", async () => {
    const root = await linelessWorkspace();
    const run = await orchestrate(root, ["wave", "status", "--waves", GRAPH, "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const waves = run.payload.waves as Row[];
    expect(waves.map((wave) => [wave.wave, wave.dispatched, wave.status])).toEqual([["wave-1", false, null], ["wave-2", false, null]]);
    expect(run.payload.journal_lines).toBe(0);
    expect(run.payload.ready).toEqual(["wave-1"]);
  });

  // @req IR-CLI-113 AC-10
  it("IR-CLI-113 AC-10 reports the nodes when no journal file exists yet", async () => {
    const root = await linelessWorkspace(false);
    const run = await orchestrate(root, ["wave", "status", "--waves", GRAPH, "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((run.payload.waves as Row[]).map((wave) => wave.wave)).toEqual(["wave-1", "wave-2"]);
  });
});

describe("IR-CLI-114 AC-5 wave show of a run with no journal line, given a 2.0.0 graph", () => {
  // @req IR-CLI-114 AC-5
  it("IR-CLI-114 AC-5 reports the selected node with no journal line", async () => {
    const root = await linelessWorkspace();
    const run = await orchestrate(root, ["wave", "show", "--wave", "wave-2", "--waves", GRAPH, "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const nodes = run.payload.nodes as Row[];
    expect(nodes.map((shown) => [shown.wave, shown.journal])).toEqual([["wave-2", []]]);
  });
});

describe("IR-CLI-113 AC-10, IR-CLI-114 AC-5 without a 2.0.0 graph the run with no line is still refused", () => {
  // @req IR-CLI-113 AC-10
  // @req IR-CLI-114 AC-5
  it("IR-CLI-113 AC-10 status and show without --waves, or with a 1.0.0 declaration, refuse the run as having no line", async () => {
    const root = await linelessWorkspace();
    const calls = [
      ["wave", "status", "--run-id", "r1"],
      ["wave", "status", "--waves", "waves/v1.json", "--run-id", "r1"],
      ["wave", "show", "--wave", "wave-1", "--run-id", "r1"],
      ["wave", "show", "--wave", "wave-1", "--waves", "waves/v1.json", "--run-id", "r1"]
    ];
    for (const argv of calls) {
      const run = await orchestrate(root, argv);
      expect(run.exit, argv.join(" ")).toBe(1);
      expect(run.payload.error, argv.join(" ")).toBe(`run r1 has no ${KO} line in ${JOURNAL}`);
    }
  });

  // FR-NODE-251 AC-6 keeps `wave actions` refusing a run with no line, graph or not.
  // @req IR-CLI-113 AC-10
  it("IR-CLI-113 AC-10 wave actions, which shares the reader, still refuses a run with no line given a 2.0.0 graph", async () => {
    const root = await linelessWorkspace();
    const run = await orchestrate(root, ["wave", "actions", "--waves", GRAPH, "--run-id", "r1"]);
    expect(run.exit).toBe(1);
    expect(run.payload.error).toBe(`run r1 has no ${KO} line in ${JOURNAL}`);
  });
});

describe("IR-CLI-113 AC-10, IR-CLI-114 AC-5 the engine of a run with no line", () => {
  // @req IR-CLI-113 AC-10
  // @req IR-CLI-114 AC-5
  it("IR-CLI-113 AC-10 uses an explicit --engine, and the default kiwi-orchestrator without one", async () => {
    const root = await linelessWorkspace();
    for (const [extra, engine] of [[["--engine", WM], WM], [[], KO]] as const) {
      const status = await orchestrate(root, ["wave", "status", "--waves", GRAPH, "--run-id", "r1", ...extra]);
      expect(status.exit, JSON.stringify(status.payload)).toBe(0);
      expect((status.payload.run as { engine: string }).engine).toBe(engine);
      const shown = await orchestrate(root, ["wave", "show", "--wave", "wave-1", "--waves", GRAPH, "--run-id", "r1", ...extra]);
      expect(shown.exit, JSON.stringify(shown.payload)).toBe(0);
      expect((shown.payload.run as { engine: string }).engine).toBe(engine);
    }
  });

  // @req IR-CLI-113 AC-10
  // @req IR-CLI-114 AC-5
  it("IR-CLI-113 AC-10 orchestrate_wave_status and orchestrate_wave_show answer the same over MCP", async () => {
    const root = await linelessWorkspace();
    const server = createMcpServer({ root });
    const status = (await server.callTool("orchestrate_wave_status", { waves: GRAPH, runId: "r1", engine: WM })) as Row;
    expect(status.journal_lines, JSON.stringify(status)).toBe(0);
    expect((status.waves as Row[]).map((wave) => wave.dispatched)).toEqual([false, false]);
    const shown = (await server.callTool("orchestrate_wave_show", { wave: "wave-1", waves: GRAPH, runId: "r1", engine: WM })) as Row;
    expect((shown.nodes as Row[] | undefined)?.map((entry) => entry.journal), JSON.stringify(shown)).toEqual([[]]);
  });
});

// IR-CLI-113 AC-11 — each node row carries `base_sha`, the `isolation.base_sha` of the node's latest line carrying one.

const BASE_A = "a".repeat(40);
const BASE_B = "b".repeat(40);

async function baseShaWorkspace(lines: readonly Line[]) {
  return (await workGraphWorkspace({ requirements: [DONE], graph: TWO_NODES, lines, files: CITES })).root;
}

function baseShas(payload: Record<string, unknown>): unknown[] {
  return (payload.waves as Row[]).map((wave) => (Object.hasOwn(wave, "base_sha") ? wave.base_sha : "absent"));
}

describe("IR-CLI-113 AC-11 wave status carries each node's latest dispatch base", () => {
  // @req IR-CLI-113 AC-11
  it("IR-CLI-113 AC-11 a node dispatched once carries that dispatch's base_sha, a node never dispatched carries null", async () => {
    const root = await baseShaWorkspace([waveLine(1, "in_progress", { phase: "worker", isolation: { base_sha: BASE_A } })]);
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(baseShas(run.payload)).toEqual([BASE_A, null]);
  });

  // @req IR-CLI-113 AC-11
  it("IR-CLI-113 AC-11 a re-entered node carries its latest dispatch's base_sha, not the first, and a later line with no base_sha keeps it", async () => {
    const root = await baseShaWorkspace([
      waveLine(1, "in_progress", { phase: "worker", isolation: { base_sha: BASE_A } }),
      waveLine(1, "failed"),
      waveLine(1, "in_progress", { phase: "worker", isolation: { base_sha: BASE_B } }),
      waveLine(1, "in_progress", { phase: "wave-verify", isolation: { worktree: "lane-r1-wave-1" } }),
      waveLine(1, "complete")
    ]);
    const run = await orchestrate(root, ["wave", "status", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(baseShas(run.payload)).toEqual([BASE_B, null]);
  });

  // @req IR-CLI-113 AC-11
  it("IR-CLI-113 AC-11 a run with no journal line carries base_sha null on every node", async () => {
    const root = await linelessWorkspace();
    const run = await orchestrate(root, ["wave", "status", "--waves", GRAPH, "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(baseShas(run.payload)).toEqual([null, null]);
  });

  // @req IR-CLI-113 AC-11
  it("IR-CLI-113 AC-11 orchestrate_wave_status carries the same base_sha over MCP", async () => {
    const root = await baseShaWorkspace([waveLine(2, "in_progress", { phase: "worker", isolation: { base_sha: BASE_B } })]);
    const answer = (await createMcpServer({ root }).callTool("orchestrate_wave_status", { runId: "r1" })) as Record<string, unknown>;
    expect(answer.exitCode, JSON.stringify(answer)).toBe(0);
    expect(baseShas(answer)).toEqual([null, BASE_B]);
  });
});
