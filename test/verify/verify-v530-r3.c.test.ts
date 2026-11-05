import { describe, expect, it } from "vitest";
import { JOURNAL_WRITER_STAMP } from "../../src/cli/commands/orchestrate.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { GRAPH, JOURNAL, actionLine, firstLineFor, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type Line, type RequirementSpec } from "../cli/wave-graph-fixtures.js";

// Independent verification, round 3, bundle C. Probes of the one wave-name rule across the readers;
// every test here is green on the tree it was written against (red 0), each in a temporary workspace.

const DONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }], covers: "all" };
const CITE = { "test/cite.test.ts": "// @req FR-ARCH-001 AC-1\n" };
type Row = Record<string, unknown>;
const NOTIFY = { on_complete: [{ id: "tell", kind: "notify", channel: "team" }] };

async function workspace(nodes: Record<string, unknown>[], lines: Line[]): Promise<string> {
  const { root, graphText } = await workGraphWorkspace({ requirements: [DONE], graph: graphOf(nodes), firstLine: null, lines: [], files: CITE });
  await writeUnder(root, JOURNAL, [firstLineFor(graphText, { writer: JOURNAL_WRITER_STAMP }), ...lines].map((line) => `${JSON.stringify(line)}\n`).join(""));
  return root;
}

const verify = (n: number, wave: string): Line => ({ ...waveLine(n, "in_progress", { phase: "wave-verify", verification: { verdict: "pass" } }), wave });

describe("probe A: actions spelled wave-01", () => {
  // @req FR-NODE-251 AC-3
  // input: a wave-01 line `orchestrate journal append` accepts (src/cli/commands/orchestrate.ts, test/verify/verify-v530-r2.c.test.ts)
  it("FR-NODE-251 AC-3 a sent result spelled wave-01 for the complete line spelled wave-01", async () => {
    const root = await workspace(
      [node(1, ["FR-ARCH-001 AC-1"], NOTIFY)],
      [
        verify(1, "wave-01"),
        { ...waveLine(1, "complete"), wave: "wave-01" },
        actionLine(1, "tell", "L3", { wave: "wave-01" }),
        actionLine(1, "tell", "L3", { wave: "wave-01", result: "sent" })
      ]
    );
    const run = await orchestrate(root, ["wave", "actions"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const rows = run.payload.actions as Row[];
    expect(rows.map((row) => [row.wave, row.state, row.key])).toEqual([["wave-1", "sent", "r1:wave-1:tell:L3"]]);
    const status = await orchestrate(root, ["wave", "status", "--with-tests"]);
    expect((status.payload.summary as Row).actions).toMatchObject({ sent: 1, pending: 0, due: 0 });
  });
});

describe("probe B: WG-08 and validate", () => {
  // @req FR-NODE-246 AC-9
  // input: a wave-01 line `orchestrate journal append` accepts (src/cli/commands/orchestrate.ts, test/verify/verify-v530-r2.c.test.ts)
  it("FR-NODE-246 AC-9 a journal that spells node wave-1 as wave-01 names no missing wave", async () => {
    const root = await workspace([node(1, ["FR-ARCH-001 AC-1"])], [{ ...waveLine(1, "in_progress", { phase: "worker" }), wave: "wave-01" }]);
    const run = await orchestrate(root, ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]);
    const codes = ((run.payload.diagnostics as Row[]) ?? []).map((d) => d.code);
    expect(codes).not.toContain("journal-wave-missing");
  });
});

async function viaMcp(root: string, tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const answer = (await createMcpServer({ root }).callTool(tool, input)) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(answer).filter(([key]) => key !== "exitCode" && key !== "mcpWorkspace"));
}

describe("probe C: MCP equals CLI on a wave-01 journal", () => {
  // @req IR-MCP-008 AC-1
  // input: a wave-01 line `orchestrate journal append` accepts (src/cli/commands/orchestrate.ts, test/verify/verify-v530-r2.c.test.ts)
  it("IR-MCP-008 AC-1 status, show, actions and check agree", async () => {
    const root = await workspace(
      [node(1, ["FR-ARCH-001 AC-1"], NOTIFY), node(2, ["FR-ARCH-001 AC-1"])],
      [
        { ...waveLine(1, "in_progress", { phase: "worker" }), wave: "wave-01" },
        verify(1, "wave-01"),
        { ...waveLine(1, "complete", { done_when_confirmed: [] }), wave: "wave-01" },
        actionLine(1, "tell", "L4", { wave: "wave-01" }),
        { ...waveLine(3, "failed"), wave: "wave-03" }
      ]
    );
    const pairs: Array<[string, Record<string, unknown>, string[]]> = [
      ["orchestrate_wave_status", { withTests: true }, ["wave", "status", "--with-tests"]],
      ["orchestrate_wave_status", {}, ["wave", "status"]],
      ["orchestrate_wave_show", { wave: "wave-1", full: true }, ["wave", "show", "--wave", "wave-1", "--full"]],
      ["orchestrate_wave_actions", {}, ["wave", "actions"]],
      ["orchestrate_wave_check", { waves: GRAPH, runId: "r1" }, ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]]
    ];
    for (const [tool, input, argv] of pairs) {
      const cli = await orchestrate(root, argv);
      expect(await viaMcp(root, tool, input), tool).toEqual(cli.payload);
    }
  });
});
