import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATE_TOOL_BINDINGS, orchestrateVerbKind } from "../../src/cli/commands/orchestrate.js";
import { GRAPH, JOURNAL, actionLine, bytesOf, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type RequirementSpec } from "./wave-graph-fixtures.js";

// IR-CLI-114 — `orchestrate wave show` reports one work-graph node in full, selected by node, by
// acceptance criterion or by requirement, within bounded responses.

const PRD = "docs/prd/rbac.prd.md";

const REQS: RequirementSpec[] = [
  { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }, { n: 2, checked: true }], covers: "AC-1", rationale: `PRD: ${PRD}. AC-1 ← PRD-3. AC-2 ← PRD-1. Not this one: docs/prd/other.prd.md#PRD-2.` },
  { id: "FR-ARCH-002", acs: [{ n: 1, checked: true }], covers: "all", rationale: "AC-1 ← PRD-3, PRD-4, PRD-99." },
  { id: "FR-ARCH-003", acs: [{ n: 1 }] }
];

const NOTIFY = { kind: "notify", id: "tell", channel: "team" };

function threeNodes(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return graphOf(
    [
      node(1, ["FR-ARCH-001 AC-1"], { description: "the long description", github_issues: [7], cautions: ["mind the lock"], sds: ["docs/sds/a.sds.md"], done_when: [{ id: "DW-1", text: "demo ran" }, { id: "DW-2", text: "doc written" }], on_complete: [NOTIFY] }),
      node(2, ["FR-ARCH-001 AC-2", "FR-ARCH-002 AC-1"]),
      node(3, ["FR-ARCH-003 AC-1"])
    ],
    [
      { from: "wave-1", to: "wave-2", reason: "FR-ARCH-002 extends FR-ARCH-001" },
      { from: "wave-2", to: "wave-3" }
    ],
    { prd: PRD, ...extra }
  );
}

async function workspace(lines: Record<string, unknown>[] = [waveLine(1, "complete", { done_when_confirmed: ["DW-1"] })], files: Record<string, string> = {}) {
  const prdText = await readFile(path.join(process.cwd(), "test/fixtures/prd/rbac.prd.md"), "utf8");
  return workGraphWorkspace({
    requirements: REQS,
    graph: threeNodes(),
    lines,
    files: { [PRD]: prdText, "test/a.test.ts": "// @req FR-ARCH-001 AC-1\n", "test/b.test.ts": "x\n// @req FR-ARCH-001 AC-1\n", ...files }
  });
}

type ShownNode = Record<string, unknown> & { wave: string };

function nodesOf(payload: Record<string, unknown>): ShownNode[] {
  return payload.nodes as ShownNode[];
}

describe("IR-CLI-114 AC-1 exactly one selector", () => {
  // @req IR-CLI-114 AC-1
  it("IR-CLI-114 AC-1 refuses no selector and every pair of selectors at parse time with exit 1, before reading anything", async () => {
    const { root } = await workGraphWorkspace({ requirements: REQS, noJournal: true });
    for (const argv of [[], ["--wave", "wave-1", "--req", "FR-ARCH-001"], ["--wave", "wave-1", "--ac", "FR-ARCH-001 AC-1"], ["--ac", "FR-ARCH-001 AC-1", "--req", "FR-ARCH-001"]]) {
      const run = await orchestrate(root, ["wave", "show", ...argv]);
      expect(run.exit, argv.join(" ")).toBe(1);
      expect(String(run.payload.error), argv.join(" ")).toMatch(/exactly one of --wave, --ac or --req/);
    }
  });

  // @req IR-CLI-114 AC-1
  it("IR-CLI-114 AC-1 --wave selects that node, and --ac and --req select every node holding the criterion or the requirement", async () => {
    const { root } = await workspace();
    const selected = async (argv: string[]) => nodesOf((await orchestrate(root, ["wave", "show", ...argv])).payload).map((shown) => shown.wave);
    expect(await selected(["--wave", "wave-2"])).toEqual(["wave-2"]);
    expect(await selected(["--ac", "FR-ARCH-001 AC-2"])).toEqual(["wave-2"]);
    expect(await selected(["--req", "FR-ARCH-001"])).toEqual(["wave-1", "wave-2"]);
  });

  // @req IR-CLI-114 AC-1
  it("IR-CLI-114 AC-1 without --waves the graph is found through the run's latest graph reference", async () => {
    const { root } = await workspace();
    const run = await orchestrate(root, ["wave", "show", "--wave", "wave-1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((run.payload.graph as Record<string, unknown>).path).toBe(GRAPH);
    expect(run.payload.warnings).toEqual([]);
  });

  // @req IR-CLI-114 AC-1
  it("IR-CLI-114 AC-1 a selector no node matches is an error naming it", async () => {
    const { root } = await workspace();
    const run = await orchestrate(root, ["wave", "show", "--wave", "wave-9"]);
    expect(run.exit).toBe(1);
    expect(String(run.payload.error)).toMatch(/wave-9/);
  });
});

describe("IR-CLI-114 AC-2 a node in full", () => {
  // @req IR-CLI-114 AC-2
  it("IR-CLI-114 AC-2 carries the static fields, the computed requirements and PRD items, done_when, state and times", async () => {
    const { root } = await workspace();
    const run = await orchestrate(root, ["wave", "show", "--wave", "wave-1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const [shown] = nodesOf(run.payload);
    expect(shown).toMatchObject({
      wave: "wave-1",
      title: "node 1",
      purpose: "purpose 1",
      description: "the long description",
      github_issues: [7],
      cautions: ["mind the lock"],
      files: ["src/w1.ts"],
      sds: ["docs/sds/a.sds.md"],
      requirements: ["FR-ARCH-001"],
      prd_items: ["PRD-1", "PRD-3"],
      done_when: [
        { id: "DW-1", text: "demo ran", confirmed: true },
        { id: "DW-2", text: "doc written", confirmed: false }
      ],
      state: "unverified",
      started_at: null,
      completed_at: "2026-11-05T01:00:00.000Z"
    });
    const [second] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-2"])).payload);
    expect(second).toMatchObject({ description: null, github_issues: [], cautions: [], sds: [], requirements: ["FR-ARCH-001", "FR-ARCH-002"], prd_items: ["PRD-1", "PRD-3", "PRD-4"] });
  });

  // @req IR-CLI-114 AC-2
  it("IR-CLI-114 AC-2 one row per AC with checked, covered, cited_count, first_citation, expired and done", async () => {
    const { root } = await workspace();
    const [second] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-2"])).payload);
    expect(second?.acs).toEqual([
      { ac: "FR-ARCH-001 AC-2", checked: true, covered: false, cited_count: 0, first_citation: null, expired: false, done: false },
      { ac: "FR-ARCH-002 AC-1", checked: true, covered: true, cited_count: 0, first_citation: null, expired: false, done: false }
    ]);
    const [first] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-1"])).payload);
    expect(first?.acs).toEqual([{ ac: "FR-ARCH-001 AC-1", checked: true, covered: true, cited_count: 2, first_citation: { file: "test/a.test.ts", line: 1 }, expired: false, done: true }]);
  });

  // @req IR-CLI-114 AC-2
  it("IR-CLI-114 AC-2 its actions in their FR-NODE-251 state, and its neighbours with each edge's reason", async () => {
    const { root } = await workspace([waveLine(1, "complete", { done_when_confirmed: ["DW-1", "DW-2"] }), actionLine(1, "tell", "L2")]);
    const [first] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-1"])).payload);
    expect(first?.state).toBe("done");
    expect(first?.actions).toEqual([{ wave: "wave-1", action_id: "tell", kind: "notify", key: "r1:wave-1:tell:L2", state: "interrupted", blocking: false, channel: "team" }]);
    expect(first?.predecessors).toEqual([]);
    expect(first?.successors).toEqual([{ wave: "wave-2", reason: "FR-ARCH-002 extends FR-ARCH-001" }]);
    const [second] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-2"])).payload);
    expect(second?.predecessors).toEqual([{ wave: "wave-1", reason: "FR-ARCH-002 extends FR-ARCH-001" }]);
    expect(second?.successors).toEqual([{ wave: "wave-3", reason: null }]);
    expect(second?.actions).toEqual([]);
  });
});

describe("IR-CLI-114 AC-3 bounded responses", () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => waveLine(1, "in_progress", { summary: `step ${index + 1}` }));

  // @req IR-CLI-114 AC-3
  it("IR-CLI-114 AC-3 carries the latest 20 journal lines of the node with {total, returned, limit}, and --full returns all", async () => {
    const { root } = await workspace([...many(25), waveLine(2, "in_progress")]);
    const [first] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-1"])).payload);
    const journal = first?.journal as Array<Record<string, unknown>>;
    expect(journal).toHaveLength(20);
    expect(journal[19]?.summary).toBe("step 25");
    expect(journal[0]?.summary).toBe("step 6");
    expect(journal[19]?.line).toBe(26);
    expect(first?.journal_truncation).toEqual({ total: 26, returned: 20, limit: 20 });
    const [full] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-1", "--full"])).payload);
    expect(full?.journal).toHaveLength(26);
    expect(full).not.toHaveProperty("journal_truncation");
  });

  // @req IR-CLI-114 AC-3
  it("IR-CLI-114 AC-3 the node's journal lines include a line that names its wave wave-01", async () => {
    const { root } = await workspace([waveLine(1, "in_progress", { phase: "worker", wave: "wave-01" })]);
    const [first] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-1"])).payload);
    expect((first?.journal as Array<Record<string, unknown>>).map((line) => [line.line, line.wave])).toEqual([
      [1, "wave-1"],
      [2, "wave-01"]
    ]);
  });

  // @req IR-CLI-114 AC-3
  it("IR-CLI-114 AC-3 an uncut list carries no truncation descriptor", async () => {
    const { root } = await workspace();
    const [first] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-1"])).payload);
    expect(first?.journal).toHaveLength(2);
    expect(first).not.toHaveProperty("journal_truncation");
  });

  // @req IR-CLI-114 AC-3
  it("IR-CLI-114 AC-3 carries only the citation count and the first citation per AC row, and --full every citation", async () => {
    const { root } = await workspace();
    const [first] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-1"])).payload);
    expect(first?.acs).toEqual([expect.not.objectContaining({ citations: expect.anything() })]);
    const [full] = nodesOf((await orchestrate(root, ["wave", "show", "--wave", "wave-1", "--full"])).payload);
    expect((full?.acs as Array<Record<string, unknown>>)[0]?.citations).toEqual([
      { file: "test/a.test.ts", line: 1 },
      { file: "test/b.test.ts", line: 2 }
    ]);
  });
});

describe("IR-CLI-114 AC-4 a read verb that scans and writes nothing", () => {
  // @req IR-CLI-114 AC-4
  it("IR-CLI-114 AC-4 runs the citation scan, is a read verb, and leaves the journal and the graph unchanged", async () => {
    expect(orchestrateVerbKind(["wave", "show"])).toBe("read");
    expect(ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_wave_show")?.kind).toBe("read");
    const { root, graphText } = await workspace();
    const journal = await bytesOf(root, JOURNAL);
    const run = await orchestrate(root, ["wave", "show", "--req", "FR-ARCH-001", "--full"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.cited_checked).toBe(true);
    expect(await bytesOf(root, JOURNAL)).toBe(journal);
    expect(await bytesOf(root, GRAPH)).toBe(graphText);
  });
});
