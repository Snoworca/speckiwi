import { describe, expect, it } from "vitest";
import { JOURNAL_WRITER_STAMP } from "../../src/cli/commands/orchestrate.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { JOURNAL, firstLineFor, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type RequirementSpec } from "../cli/wave-graph-fixtures.js";

// Independent verification, round 2, bundle c: IR-CLI-113, IR-CLI-114, FR-NODE-251, FR-NODE-253,
// IR-MCP-008, the CLI bindings of FR-NODE-246/247/252 and the exit-code table. Every test here is red
// on the tree it was written against; each works in a temporary workspace.

const DONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }], covers: "all" };
const CITE = { "test/cite.test.ts": "// @req FR-ARCH-001 AC-1\n" };
type Row = Record<string, unknown>;

/**
 * A run whose worker line names its wave `wave-01`: `journal append` accepts the line, and the readers
 * attribute it to node `wave-1` (its status, phase, state and start time all come from it).
 */
async function workerLineAsWave01(): Promise<string> {
  const { root, graphText } = await workGraphWorkspace({ requirements: [DONE], graph: graphOf([node(1, ["FR-ARCH-001 AC-1"])]), firstLine: null, lines: [], files: CITE });
  await writeUnder(root, JOURNAL, `${JSON.stringify(firstLineFor(graphText, { writer: JOURNAL_WRITER_STAMP }))}\n`);
  const { ts: _ts, ...line } = { ...waveLine(1, "in_progress", { phase: "worker" }), wave: "wave-01" };
  const appended = await orchestrate(root, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(line)]);
  expect(appended.exit, JSON.stringify(appended.payload)).toBe(0);
  return root;
}

describe("a worker line the readers attribute to a node by its wave number", () => {
  // @req IR-CLI-113 AC-1
  it("IR-CLI-113 AC-1 dispatched is true for the node whose own row shows the worker line's phase", async () => {
    const root = await workerLineAsWave01();
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const [row] = run.payload.waves as Row[];
    // The row is built from that line: status in_progress, phase worker, state running.
    expect([row?.wave, row?.status, row?.phase, row?.state]).toEqual(["wave-1", "in_progress", "worker", "running"]);
    expect(row?.dispatched).toBe(true);
  });

  // @req IR-CLI-114 AC-3
  it("IR-CLI-114 AC-3 the node's journal lines include the line its state and start time come from", async () => {
    const root = await workerLineAsWave01();
    const run = await orchestrate(root, ["wave", "show", "--wave", "wave-1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const [shown] = run.payload.nodes as Row[];
    expect(shown?.state).toBe("running");
    const phases = (shown?.journal as Row[]).map((line) => line.phase ?? null);
    expect(phases).toContain("worker");
  });
});
