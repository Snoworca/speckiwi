import { describe, expect, it } from "vitest";
import { createMcpServer } from "../../src/mcp/server.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import {
  GRAPH,
  JOURNAL,
  digestOf,
  firstLineFor,
  graphOf,
  node,
  orchestrate,
  waveLine,
  workGraphWorkspace,
  type Line,
  type RequirementSpec
} from "../cli/wave-graph-fixtures.js";

const DONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }, { n: 2, checked: true }], covers: "all" };
const GRAPH_VALUE = graphOf([node(1, ["FR-ARCH-001 AC-1"])]);
const GRAPH_TEXT = `${JSON.stringify(GRAPH_VALUE, null, 2)}\n`;

/** A kiwi-wave-master line: no `engine` field (skills/claude/_shared/kiwi/waves-event.md, engine absent = kiwi-wave-master). */
function unstamped(line: Line): Line {
  return Object.fromEntries(Object.entries(line).filter(([key]) => key !== "engine"));
}

async function viaMcp(root: string, tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await createMcpServer({ root }).callTool(tool, input)) as Record<string, unknown>;
}

describe("r2 tools: --run-id picks the run's engine on every MCP reader", () => {
  // @req IR-CLI-113 AC-9
  // Input: a kiwi-wave-master run journal (lines without engine), as skills/claude/kiwi-wave-master/SKILL.md writes it.
  it("IR-CLI-113 AC-9 orchestrate_wave_check without engine reads a kiwi-wave-master run and reports the wave it names that is not a node", async () => {
    const { root } = await workGraphWorkspace({
      requirements: [DONE],
      graph: GRAPH_VALUE,
      firstLine: unstamped(firstLineFor(GRAPH_TEXT)),
      lines: [unstamped(waveLine(9, "pending"))]
    });
    const result = await viaMcp(root, "orchestrate_wave_check", { waves: GRAPH, runId: "r1" });
    expect(JSON.stringify(result)).toContain("journal-wave-missing");
  });
});

describe("r2 tools: the run's first graph line and the latest graph reference through the CLI", () => {
  // @req IR-CLI-113 AC-5
  // Input: kiwi-orchestrator journals intake decision lines before decomposing
  // (skills/claude/kiwi-orchestrator/SKILL.md §1, waves-event.md `decision`), then the first graph line
  // (skills/claude/_shared/kiwi/wave-decomposition.md §8).
  it("IR-CLI-113 AC-5 the argument-free leaf reads the graph of a first graph line that follows intake lines written through journal append", async () => {
    const { root } = await workGraphWorkspace({ requirements: [DONE], graph: GRAPH_VALUE, noJournal: true });
    await writeUnder(root, JOURNAL, "");
    const intake = {
      ...waveLine(1, "in_progress", { phase: "intake" }),
      wave: "all",
      order: 0,
      summary: "intake decision",
      decision: { question: "q", options: ["a", "b"], decision: "a", rule: "r", committee_size: 5, confidence: 0.9, origin: "intake" }
    };
    const first = await orchestrate(root, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(intake)]);
    expect(first.exit, JSON.stringify(first.payload)).toBe(0);
    const graphLine = await orchestrate(root, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(firstLineFor(GRAPH_TEXT))]);
    expect(graphLine.exit, JSON.stringify(graphLine.payload)).toBe(0);
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(run.payload.graph).toEqual({ path: GRAPH, digest: digestOf(GRAPH_TEXT) });
    expect(run.payload.warnings).toEqual([]);
  });
});
