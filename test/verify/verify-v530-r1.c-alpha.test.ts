import { describe, expect, it } from "vitest";
import { digestOf, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type RequirementSpec } from "../cli/wave-graph-fixtures.js";

// Independent verification, round 1, bundle c-alpha: IR-CLI-113, IR-CLI-114, FR-NODE-251 through the CLI.

const DONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1, checked: true }], covers: "all" };
const CITE = { "test/cite.test.ts": "// @req FR-ARCH-001 AC-1\n" };
const NOTIFY = { kind: "notify", id: "tell", channel: "team-chat" };

type Row = Record<string, unknown>;

describe("verify v5.3.0 r1 c-alpha", () => {
  // @req FR-NODE-251 AC-5
  it("FR-NODE-251 AC-5 substitutes the placeholders of the template only, not placeholder text inside a substituted value", async () => {
    const { root } = await workGraphWorkspace({
      requirements: [DONE],
      graph: graphOf([node(1, ["FR-ARCH-001 AC-1"], { title: "Fix {purpose} text", purpose: "P", on_complete: [{ ...NOTIFY, message: "T={title}" }] })]),
      lines: [waveLine(1, "complete")],
      files: CITE
    });
    const run = await orchestrate(root, ["wave", "actions"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((run.payload.actions as Row[])[0]?.message).toBe("T=Fix {purpose} text");
  });

  // @req IR-CLI-113 AC-1
  // @req IR-CLI-104 AC-1
  it("IR-CLI-113 AC-1 with IR-CLI-104 AC-1: a wave the journal names stays listed after a redecomposition dropped it from the graph", async () => {
    const graph2 = graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(3, ["FR-ARCH-001 AC-1"])], [{ from: "wave-1", to: "wave-3" }]);
    const text2 = `${JSON.stringify(graph2, null, 2)}\n`;
    const { root } = await workGraphWorkspace({
      requirements: [DONE],
      graph: graphOf([node(1, ["FR-ARCH-001 AC-1"]), node(2, ["FR-ARCH-001 AC-1"])], [{ from: "wave-1", to: "wave-2" }]),
      lines: [waveLine(1, "complete"), waveLine(2, "failed"), { ...waveLine(2, "failed"), phase: "redecompose", graph: { path: "waves/v2.json", digest: digestOf(text2) } }],
      files: { ...CITE, "waves/v2.json": text2 }
    });
    const run = await orchestrate(root, ["wave", "status"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const waves = (run.payload.waves as Row[]).map((row) => [row.wave, row.status]);
    expect(waves).toContainEqual(["wave-2", "failed"]);
  });
});
