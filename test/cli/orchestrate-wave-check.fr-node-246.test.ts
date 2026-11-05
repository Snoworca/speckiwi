import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATE_TOOL_BINDINGS, orchestrateVerbKind } from "../../src/cli/commands/orchestrate.js";
import { GRAPH, JOURNAL, bytesOf, graphOf, node, orchestrate, waveLine, workGraphWorkspace, type RequirementSpec } from "./wave-graph-fixtures.js";

// FR-NODE-246 AC-1 — `orchestrate wave check --waves <file>` reports each work-graph defect under a
// named code, exits 0 without an error diagnostic and 1 with one, and writes nothing.

const ONE: RequirementSpec = { id: "FR-ARCH-001", acs: [{ n: 1 }, { n: 2 }] };
const TWO: RequirementSpec = { id: "FR-ARCH-002", acs: [{ n: 1 }] };
const CLEAN = graphOf([node(1, ["FR-ARCH-001 AC-1", "FR-ARCH-001 AC-2"]), node(2, ["FR-ARCH-002 AC-1"])], [{ from: "wave-1", to: "wave-2" }]);

type Diagnostic = { code: string; severity: string };

function codes(payload: Record<string, unknown>): string[] {
  return (payload.diagnostics as Diagnostic[]).map((entry) => entry.code);
}

async function exists(root: string, relativePath: string): Promise<boolean> {
  return access(path.join(root, relativePath)).then(
    () => true,
    () => false
  );
}

describe("FR-NODE-246 AC-1 orchestrate wave check", () => {
  // @req FR-NODE-246 AC-1
  it("FR-NODE-246 AC-1 exits 0 on a clean graph and 1 when it reports an error diagnostic", async () => {
    const clean = await workGraphWorkspace({ requirements: [ONE, TWO], graph: CLEAN, firstLine: null });
    const passed = await orchestrate(clean.root, ["wave", "check", "--waves", GRAPH]);
    expect(passed.exit, JSON.stringify(passed.payload)).toBe(0);
    expect(passed.payload.ok).toBe(true);
    expect(codes(passed.payload)).toEqual([]);
    expect(passed.payload.stages).toEqual([
      { stage: 1, waves: ["wave-1"] },
      { stage: 2, waves: ["wave-2"] }
    ]);

    const broken = await workGraphWorkspace({ requirements: [ONE], graph: graphOf([node(1, ["FR-ARCH-001 AC-1"])]), firstLine: null });
    const failed = await orchestrate(broken.root, ["wave", "check", "--waves", GRAPH]);
    expect(failed.exit, JSON.stringify(failed.payload)).toBe(1);
    expect(failed.payload.ok).toBe(false);
    expect(codes(failed.payload)).toEqual(["ac-unassigned"]);
    expect(failed.payload).not.toHaveProperty("gate");
  });

  // @req FR-NODE-246 AC-1
  it("FR-NODE-246 AC-1 a warning leaves the exit code at 0", async () => {
    const { root } = await workGraphWorkspace({ requirements: [{ ...ONE, stability: "draft" }, TWO], graph: CLEAN, firstLine: null });
    const run = await orchestrate(root, ["wave", "check", "--waves", GRAPH]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    expect(codes(run.payload)).toEqual(["requirement-draft"]);
  });

  // @req FR-NODE-246 AC-1
  it("FR-NODE-246 AC-1 reads the run journal only with --run-id, and with it names a journal wave the graph lacks", async () => {
    const { root } = await workGraphWorkspace({ requirements: [ONE, TWO], graph: CLEAN, lines: [waveLine(3, "in_progress")] });
    const unchecked = await orchestrate(root, ["wave", "check", "--waves", GRAPH]);
    expect(unchecked.exit, JSON.stringify(unchecked.payload)).toBe(0);
    expect(unchecked.payload.journal_checked).toBe(false);
    const checked = await orchestrate(root, ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]);
    expect(checked.exit, JSON.stringify(checked.payload)).toBe(1);
    expect(checked.payload.journal_checked).toBe(true);
    expect(codes(checked.payload)).toEqual(["journal-wave-missing"]);
  });

  // @req FR-NODE-246 AC-1 AC-9
  it("FR-NODE-246 AC-1 AC-9 a journal line naming wave-01 names node wave-1, so it is no missing wave", async () => {
    const { root } = await workGraphWorkspace({ requirements: [ONE, TWO], graph: CLEAN, lines: [{ ...waveLine(1, "in_progress"), wave: "wave-01" }, { ...waveLine(3, "in_progress"), wave: "wave-03" }] });
    const run = await orchestrate(root, ["wave", "check", "--waves", GRAPH, "--run-id", "r1"]);
    expect(codes(run.payload)).toEqual(["journal-wave-missing"]);
    expect((run.payload.diagnostics as Array<{ message: string }>)[0]?.message).toMatch(/wave-03/);
  });

  // @req FR-NODE-246 AC-1
  it("FR-NODE-246 AC-1 --all-diagnostics lifts the bound of 50", async () => {
    const many: RequirementSpec = { id: "FR-ARCH-003", acs: Array.from({ length: 60 }, (_, index) => ({ n: index + 1 })) };
    const { root } = await workGraphWorkspace({ requirements: [ONE, TWO, many], graph: CLEAN, firstLine: null });
    const bounded = await orchestrate(root, ["wave", "check", "--waves", GRAPH]);
    expect(bounded.exit).toBe(1);
    expect(codes(bounded.payload)).toHaveLength(50);
    expect(bounded.payload.diagnosticsTruncation).toEqual({ total: 60, returned: 50, limit: 50 });
    const all = await orchestrate(root, ["wave", "check", "--waves", GRAPH, "--all-diagnostics"]);
    expect(codes(all.payload)).toHaveLength(60);
  });

  // @req FR-NODE-246 AC-1
  it("FR-NODE-246 AC-1 is a read verb that writes no lanes lock and no journal line and leaves every file's bytes unchanged", async () => {
    expect(orchestrateVerbKind(["wave", "check"])).toBe("read");
    const binding = ORCHESTRATE_TOOL_BINDINGS.find((entry) => entry.tool === "orchestrate_wave_check");
    expect(binding?.kind).toBe("read");
    expect(binding?.options.map((option) => option.flag).sort()).toEqual(["--all-diagnostics", "--engine", "--journal", "--run-id", "--waves"]);
    const { root, graphText } = await workGraphWorkspace({ requirements: [ONE, TWO], graph: CLEAN, lines: [waveLine(1, "in_progress")] });
    const journal = await bytesOf(root, JOURNAL);
    for (const extra of [[], ["--run-id", "r1"]]) {
      const run = await orchestrate(root, ["wave", "check", "--waves", GRAPH, ...extra]);
      expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    }
    expect(await bytesOf(root, JOURNAL)).toBe(journal);
    expect(await bytesOf(root, GRAPH)).toBe(graphText);
    expect(await exists(root, "waves/lanes.lock.json")).toBe(false);
  });

  // @req FR-NODE-246 AC-1
  it("FR-NODE-246 AC-1 a file that is not JSON is an operational error at exit 1", async () => {
    const { root } = await workGraphWorkspace({ requirements: [ONE, TWO], files: { [GRAPH]: "{ not json" }, firstLine: null });
    const run = await orchestrate(root, ["wave", "check", "--waves", GRAPH]);
    expect(run.exit).toBe(1);
    expect(String(run.payload.error)).toMatch(/not valid JSON/);
  });
});
