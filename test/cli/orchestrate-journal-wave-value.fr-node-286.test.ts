import { describe, expect, it } from "vitest";
import { writeUnder } from "../core/orchestrator/sds-fixtures.js";
import { GRAPH, JOURNAL, bytesOf, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type Line, type RequirementSpec } from "./wave-graph-fixtures.js";

// @req FR-NODE-286 — `journal append` accepts a wave only as `wave-<n>` or `all`, and `wave check`
// leaves intake lines out of the node comparison.
//
// SB15 (5.3.7): intake decisions journalled with `wave: "wave-0"` made every later
// `wave check --run-id` report `journal-wave-missing`, so dispatch stayed blocked for good.

const ONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1 }] };
const GRAPH_VALUE = graphOf([node(1, ["FR-ARCH-001 AC-1"])]);
const DECISION = { gate_id: "intake-qna", recommended: "a", alternatives: ["b"], rationale: "r", decided_by: "committee", decided_at: "2026-11-10T00:00:00.000Z", origin: "intake" };

function intakeLine(wave: unknown): Line {
  return { schema_version: "2.0.0", run_id: "r1", engine: "kiwi-orchestrator", wave, order: 0, target: "all", summary: "intake decision", status: "in_progress", phase: "intake", decision: DECISION };
}

/** An empty journal, so the run's validation sees only the lines `journal append` writes (each carries the writer stamp). */
async function appendWorkspace(): Promise<string> {
  const { root } = await workGraphWorkspace({ requirements: [ONE], graph: GRAPH_VALUE, noJournal: true });
  await writeUnder(root, JOURNAL, "");
  return root;
}

function codes(payload: Record<string, unknown>): string[] {
  return ((payload.diagnostics ?? []) as Array<{ code: string }>).map((entry) => entry.code);
}

describe("FR-NODE-286 AC-1 — append refuses a wave the graph could never hold", () => {
  it.each([["wave-0"], ["wave-01"], ["intake"], [1], ["Wave-1"], [""]])("refuses wave %j and leaves the journal untouched", async (wave) => {
    const root = await appendWorkspace();
    const before = await bytesOf(root, JOURNAL);
    for (const dryRun of [[], ["--dry-run"]]) {
      const answer = await orchestrate(root, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(intakeLine(wave)), ...dryRun]);
      expect(answer.exit, JSON.stringify(answer.payload)).toBe(2);
      expect(answer.payload.gate).toBe("run-invariant-drift");
      expect(answer.payload.violations).toEqual([expect.objectContaining({ code: "journal-wave-invalid", wave })]);
    }
    expect(await bytesOf(root, JOURNAL)).toBe(before);
  });
});

describe("FR-NODE-286 AC-2 — append still writes wave-<n>, all, and a line with no wave", () => {
  it.each([["all"], ["wave-1"], ["wave-12"]])("writes wave %j", async (wave) => {
    const root = await appendWorkspace();
    const answer = await orchestrate(root, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(intakeLine(wave))]);
    expect(answer.exit, JSON.stringify(answer.payload)).toBe(0);
    expect(await bytesOf(root, JOURNAL)).toContain(`"wave":"${wave as string}"`);
  });

  it("writes a result line that carries no wave", async () => {
    const root = await appendWorkspace();
    const line = { schema_version: "2.0.0", run_id: "r1", engine: "kiwi-orchestrator", verb: "intake-qna", event: "result", status: "complete", proof: { kind: "digest", ref: "sha256:0123456789abcdef" }, decision: DECISION };
    const answer = await orchestrate(root, ["journal", "append", "--run-id", "r1", "--payload", JSON.stringify(line)]);
    expect(answer.exit, JSON.stringify(answer.payload)).toBe(0);
  });
});

describe("FR-NODE-286 AC-3 — wave check leaves intake lines out of the node comparison", () => {
  it("passes a run whose intake line names wave-0, as 5.3.7 let it be written", async () => {
    const { root } = await workGraphWorkspace({ requirements: [ONE], graph: GRAPH_VALUE, lines: [intakeLine("wave-0")] });
    const answer = await orchestrate(root, ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]);
    expect(codes(answer.payload)).not.toContain("journal-wave-missing");
    expect(answer.exit, JSON.stringify(answer.payload)).toBe(0);
  });

  it("still reports a wave outside the graph on a line that is not intake", async () => {
    const { root } = await workGraphWorkspace({ requirements: [ONE], graph: GRAPH_VALUE, lines: [intakeLine("wave-0"), waveLine(4, "in_progress")] });
    const answer = await orchestrate(root, ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]);
    expect(codes(answer.payload)).toEqual(["journal-wave-missing"]);
    expect(answer.payload.diagnostics).toEqual([expect.objectContaining({ details: { wave: "wave-4" } })]);
  });
});
