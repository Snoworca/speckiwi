import { describe, expect, it } from "vitest";
import { parseWorkGraph } from "../../../src/core/orchestrator/wave-declaration.js";
import { graphOf, node, orchestrate, workGraphWorkspace, type RequirementSpec } from "../../cli/wave-graph-fixtures.js";

// @req FR-NODE-289 — a work-graph node may carry its own verification_cmd as a quick check inside
// its wave, and `wave show` reports it. Landing and promotion keep the run's pinned command.
//
// SB15 (5.3.7): a Gradle multi-module run had only the one slow full-suite command for every wave,
// because the 2.0.0 graph refused any per-node command.

const NODE_COMMAND = "./gradlew :core:test --tests 'x.*'";

function graphWith(extra: Record<string, unknown>): Record<string, unknown> {
  return graphOf([node(1, ["FR-ARCH-001 AC-1"], extra)]);
}

describe("FR-NODE-289 AC-1 — a node's single-line verification_cmd is parsed and kept", () => {
  it.each([[NODE_COMMAND], ["x"], ["y".repeat(500)]])("keeps %j on the node", (command) => {
    const parsed = parseWorkGraph(graphWith({ verification_cmd: command }));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.graph.nodes[0]?.verificationCmd).toBe(command);
  });

  it("leaves a node without one as it was", () => {
    const parsed = parseWorkGraph(graphWith({}));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.graph.nodes[0]).not.toHaveProperty("verificationCmd");
  });
});

describe("FR-NODE-289 AC-2 — any other verification_cmd value refuses the graph", () => {
  it.each([[""], ["z".repeat(501)], ["npm test\nrm -rf x"], ["npm test\r"], [7], [["npm", "test"]], [null]])("refuses %j naming wave-1.verification_cmd", (command) => {
    const parsed = parseWorkGraph(graphWith({ verification_cmd: command }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("wave-1.verification_cmd");
  });
});

describe("FR-NODE-289 AC-3 — wave show reports the node's command, or null", () => {
  const REQS: RequirementSpec[] = [{ id: "FR-ARCH-001", acs: [{ n: 1 }] }];

  it("reports the declared command", async () => {
    const { root } = await workGraphWorkspace({ requirements: REQS, graph: graphWith({ verification_cmd: NODE_COMMAND }) });
    const run = await orchestrate(root, ["wave", "show", "--wave", "wave-1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((run.payload.nodes as Array<Record<string, unknown>>)[0]?.verification_cmd).toBe(NODE_COMMAND);
  });

  it("reports null when the node declares none", async () => {
    const { root } = await workGraphWorkspace({ requirements: REQS, graph: graphWith({}) });
    const run = await orchestrate(root, ["wave", "show", "--wave", "wave-1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect((run.payload.nodes as Array<Record<string, unknown>>)[0]).toHaveProperty("verification_cmd", null);
  });
});
