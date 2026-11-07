import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkGraph } from "../../src/core/orchestrator/wave-declaration.js";
import { rawGit } from "../core/orchestrator/support/git-fixture.js";
import { cliJson, PRD_PATH, prdWorkspace } from "./prd-surface-fixture.js";
import { orchestrate } from "./wave-graph-fixtures.js";

// FR-FLOW-230 AC-2 — the tool half of the reproduction. A target whose requirements already cite
// every PRD item reaches work-graph decomposition through `orchestrate wave propose --target` with
// the SRS byte-identical before and after: the tool needs no authoring step to draft the graph.

const SCOPE = path.join("docs", "spec", "10.product-architecture.srs.md");

describe("FR-FLOW-230 AC-2 — an already-authored target reaches decomposition without an SRS change", () => {
  it("drafts the graph from the existing requirements and leaves the SRS untouched", async () => {
    // @req FR-FLOW-230 AC-2
    const root = await prdWorkspace();
    const file = path.join(root, SCOPE);
    const authored = (await readFile(file, "utf8")).replace(
      "The parser needs a small valid workspace.",
      "AC-1 ← PRD-1. AC-2 ← PRD-2."
    );
    await writeFile(file, authored, "utf8");
    await rawGit(root, "init", "--initial-branch", "main");
    await rawGit(root, "config", "user.name", "Existing SRS Fixture");
    await rawGit(root, "config", "user.email", "existing-srs@example.invalid");
    await rawGit(root, "config", "commit.gpgsign", "false");
    await rawGit(root, "add", "--", ".");
    await rawGit(root, "commit", "-m", "authored");
    await writeFile(path.join(root, "files.json"), JSON.stringify({ "FR-ARCH-001": ["src/a.ts"] }), "utf8");

    const coverage = await cliJson<{ uncitedItems: unknown[] }>(root, "coverage", PRD_PATH, "--target", "v1.0.0");
    expect(coverage.json.uncitedItems, "the fixture target must already cover its PRD").toEqual([]);

    const before = await readFile(file, "utf8");
    const run = await orchestrate(root, ["wave", "propose", "--target", "v1.0.0", "--files", "files.json", "--run-id", "r1"]);
    expect(run.exit, JSON.stringify(run.payload)).toBe(0);
    const parsed = parseWorkGraph(run.payload.graph);
    expect(parsed.ok, JSON.stringify(run.payload.graph)).toBe(true);
    const nodes = (run.payload.graph as { nodes: Array<{ acs: string[] }> }).nodes;
    expect(nodes.flatMap((node) => node.acs).sort()).toEqual(["FR-ARCH-001 AC-1", "FR-ARCH-001 AC-2"]);
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
