import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { updateStepState } from "../../../src/core/mutation/update-step-state.js";
import { createMcpServer } from "../../../src/mcp/server.js";

// FR-NODE-078 — merged step transition enforces the completion contradiction gate.
//
// Red-phase suite: one test case per acceptance criterion (AC-1..AC-5). The suite
// fails while updateStepState performs a dumb rewrite for every status (the
// evaluateVibeCompletionGate of FR-NODE-058/072 has no production caller), until
// the green step wires the gate into the merged transition for vibe/tdd work-modes
// with the TouchesReq-closure dirty-edge filter and the acknowledged override.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-078):
//   - AC-1: vibe/tdd + merged + unacknowledged non-clean closure edge → stable
//           failure code, nothing written.
//   - AC-2: acknowledged=true overrides the block.
//   - AC-3: clean or out-of-closure edges do not block.
//   - AC-4: wait/sdd merged transitions stay unguarded.
//   - AC-5: MCP update_step_state exposes acknowledged.

const SCOPE_FILE = "50.nodejs-implementation.srs.md";
const REQ_A = "FR-NODE-100";
const REQ_B = "FR-NODE-101";
const REQ_C = "FR-NODE-102";

function renderRequirementBlock(id: string, traceRows: string[] = []): string {
  return [
    `### ${id} — Requirement ${id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v3.0.0 |",
    "| Status | planned |",
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    "| Stability | evolving |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Requirement statement for ${id}.`,
    "",
    "#### Rationale",
    "",
    "-",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Fixture criterion.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "",
    "#### Trace Links",
    "",
    "| Type | Reference | Relation | Notes |",
    "| --- | --- | --- | --- |",
    ...traceRows,
    "",
    "#### Research / Analysis",
    "",
    "- -",
    "",
    "#### Implementation Notes",
    "",
    "- -",
    "",
    "#### Change Notes",
    "",
    "| Date | Change | Reason |",
    "| --- | --- | --- |",
    "| 2026-06-04 | Created | Fixture |"
  ].join("\n");
}

function renderScopeDocument(blocks: string[]): string {
  return [
    "# Node.js Implementation",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    "| Scope | NODE |",
    "| Scope Name | Node.js Implementation |",
    "",
    "## 1. Scope Overview",
    "",
    "Completion-gate fixture.",
    "",
    "## 2. Scope Boundaries",
    "",
    "### In Scope",
    "",
    "- Markdown requirements",
    "",
    "### Out of Scope",
    "",
    "- None",
    "",
    "## 3. Assumptions and Constraints",
    "",
    "- None",
    "",
    "## 4. Requirements",
    "",
    blocks.join("\n\n"),
    ""
  ].join("\n");
}

function renderIndexDocument(): string {
  return [
    "# SpecKiwi Completion-Gate Fixture Index",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | srs_index |",
    "| Product | SpecKiwi |",
    "| Product Version | 3.0.0 |",
    "| Active Target | v3.0.0 |",
    "| Status | baseline |",
    "",
    "## 1. Purpose",
    "",
    "Completion-gate fixture index.",
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| Node.js Implementation | [${SCOPE_FILE}](./${SCOPE_FILE}) | NODE | Node |`,
    "",
    "## 3. Target Map",
    "",
    "| Target | Type | Status | Description |",
    "|---|---|---|---|",
    "| v3.0.0 | release | active | Fixture release |",
    "",
    "## 4. Scope Map",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| Node.js Implementation | [${SCOPE_FILE}](./${SCOPE_FILE}) | NODE | Node |`,
    "",
    "## 5. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    ""
  ].join("\n");
}

function renderStateDocument(mode: string, rows: Array<{ step: string; status?: string; touchesReq: string }>): string {
  const rendered = rows.map(
    (r) => `| ${r.step} | ${r.status ?? "active"} | - | NODE | ${r.touchesReq} | 2026-06-01 | 2026-06-02 |`
  );
  return [
    "# Step State",
    "",
    `Mode: ${mode}`,
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rendered,
    ""
  ].join("\n");
}

/** A stale checked_compatible trace row: unparseable notes classify the edge non-clean (dirty). */
function dirtyEdgeRow(peer: string): string {
  return `| Requirement | ${peer} | checked_compatible | stale |`;
}

async function buildWorkspace(options: {
  mode: string;
  rows: Array<{ step: string; status?: string; touchesReq: string }>;
  dirtyEdge?: boolean;
}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-078-"));
  const specDir = path.join(root, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndexDocument(), "utf8");
  const blocks = [
    renderRequirementBlock(REQ_A, options.dirtyEdge ? [dirtyEdgeRow(REQ_B)] : []),
    renderRequirementBlock(REQ_B),
    renderRequirementBlock(REQ_C)
  ];
  await writeFile(path.join(specDir, SCOPE_FILE), renderScopeDocument(blocks), "utf8");
  const stepsDir = path.join(specDir, "steps");
  await mkdir(stepsDir, { recursive: true });
  await writeFile(path.join(stepsDir, "state.md"), renderStateDocument(options.mode, options.rows), "utf8");
  return root;
}

async function stateText(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, "docs", "spec", "steps", "state.md"), "utf8");
}

describe("FR-NODE-078 — merged step transition completion gate", () => {
  it("FR-NODE-078 AC-1: vibe/tdd merged with an unacknowledged non-clean closure edge fails and writes nothing", async () => {
    for (const mode of ["vibe", "tdd"] as const) {
      const root = await buildWorkspace({
        mode,
        rows: [{ step: "feature-x", touchesReq: REQ_A }],
        dirtyEdge: true
      });
      const before = await stateText(root);

      const result = await updateStepState({ root }, { step: "feature-x", status: "merged" });

      expect(result.ok, `${mode} merged must be gate-blocked`).toBe(false);
      if (!result.ok) expect(result.error?.code).toBe("COMPLETION_GATE_BLOCKED");
      expect(await stateText(root)).toBe(before);
    }
  });

  it("FR-NODE-078 AC-2: acknowledged=true overrides the block and merges", async () => {
    const root = await buildWorkspace({
      mode: "vibe",
      rows: [{ step: "feature-x", touchesReq: REQ_A }],
      dirtyEdge: true
    });

    const result = await updateStepState({ root }, { step: "feature-x", status: "merged", acknowledged: true });

    expect(result.ok).toBe(true);
    expect(await stateText(root)).toMatch(/\|\s*feature-x\s*\|\s*merged\s*\|/);
  });

  it("FR-NODE-078 AC-3: clean or out-of-closure edges do not block the merged transition", async () => {
    // No compatibility edges at all → nothing to contradict.
    const cleanRoot = await buildWorkspace({
      mode: "vibe",
      rows: [{ step: "feature-x", touchesReq: REQ_A }],
      dirtyEdge: false
    });
    expect((await updateStepState({ root: cleanRoot }, { step: "feature-x", status: "merged" })).ok).toBe(true);

    // A dirty edge exists between REQ_A and REQ_B, but the step's TouchesReq closure
    // only contains REQ_C — the edge is outside the closure and must not block.
    const outsideRoot = await buildWorkspace({
      mode: "vibe",
      rows: [{ step: "feature-x", touchesReq: REQ_C }],
      dirtyEdge: true
    });
    const result = await updateStepState({ root: outsideRoot }, { step: "feature-x", status: "merged" });
    expect(result.ok).toBe(true);
    expect(await stateText(outsideRoot)).toMatch(/\|\s*feature-x\s*\|\s*merged\s*\|/);
  });

  it("FR-NODE-078 AC-4: wait/sdd merged transitions stay unguarded", async () => {
    for (const mode of ["wait", "sdd"] as const) {
      const root = await buildWorkspace({
        mode,
        rows: [{ step: "feature-x", touchesReq: REQ_A }],
        dirtyEdge: true
      });

      const result = await updateStepState({ root }, { step: "feature-x", status: "merged" });

      expect(result.ok, `${mode} merged must not be gated`).toBe(true);
      expect(await stateText(root)).toMatch(/\|\s*feature-x\s*\|\s*merged\s*\|/);
    }
  });

  it("FR-NODE-078 AC-5: MCP update_step_state exposes the acknowledged input", async () => {
    const root = await buildWorkspace({
      mode: "tdd",
      rows: [{ step: "feature-x", touchesReq: REQ_A }],
      dirtyEdge: true
    });
    const server = createMcpServer({ root });

    // Without acknowledged the gate blocks through the MCP surface.
    const blocked = await server.callTool("update_step_state", { step: "feature-x", status: "merged" });
    expect(blocked).toMatchObject({ ok: false, error: { code: "COMPLETION_GATE_BLOCKED" } });

    // acknowledged=true is forwarded to the core gate and overrides the block.
    const acknowledged = await server.callTool("update_step_state", {
      step: "feature-x",
      status: "merged",
      acknowledged: true
    });
    expect(acknowledged).toMatchObject({ ok: true });
    expect(await stateText(root)).toMatch(/\|\s*feature-x\s*\|\s*merged\s*\|/);
  });
});
