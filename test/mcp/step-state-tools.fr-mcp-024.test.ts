import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
// FR-MCP-024 — MCP registration of step state tools.
//
// Red-phase suite (T-PH005-09): one test case per acceptance criterion (AC-1, AC-2).
// These cases describe the future MCP surface of FR-MCP-024 before the three step
// state tools (claim_step, update_step_state, list_steps) are registered, so the
// whole suite fails until the green task (T-PH005-10) gives the ToolSpec entries
// (src/mcp/schemas.ts) an mcpName and wires the handlers in registerMutationTools /
// registerReadTools (src/mcp/tools/*.ts) forwarding to the core implementations
// claimStep (FR-NODE-027), updateStepState (FR-NODE-028), and listSteps (FR-NODE-029).
//
// Contract under test (FR-MCP-024 requirement body + AC):
//   - AC-1: claim_step, update_step_state, and list_steps are registered MCP tools
//           with zod schemas.
//   - AC-2: each step-state tool forwards its inputs to the corresponding core
//           implementation.
import {
  renderToolNames,
  renderToolSchemas,
  renderReadOnlyToolNames,
  renderToolKinds,
  assertZeroDriftToolSurface
} from "../../src/mcp/schemas.js";
import { createMcpServer, isReadOnlyTool } from "../../src/mcp/server.js";

const CLAIM_TOOL = "claim_step";
const UPDATE_TOOL = "update_step_state";
const LIST_TOOL = "list_steps";

// claim_step and update_step_state are step-mutation tools; list_steps is a read tool.
const STEP_MUTATION_TOOLS = [CLAIM_TOOL, UPDATE_TOOL] as const;
const STEP_STATE_TOOLS = [CLAIM_TOOL, UPDATE_TOOL, LIST_TOOL] as const;

/** The MCP tool names actually registered by the running server (resource handlers excluded). */
function registeredMcpToolNames(): string[] {
  const handle = createMcpServer({});
  return Object.keys(handle.tools)
    .filter((name) => !name.startsWith("resource:"))
    .sort();
}

// ── Self-contained NODE-scope workspace builder (AC-2 forwarding fixture) ─────
// Mirrors the FR-MCP-023 MCP suite fixture, adding a docs/spec/steps/state.md so
// the step state tools have a live state table and a requirement (FR-NODE-100) to
// reason about through the MCP tool handlers.

const SCOPE_FILE = "50.nodejs-implementation.srs.md";
const REQ_ID = "FR-NODE-100";

function renderRequirementBlock(id: string): string {
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
    "Step-state fixture.",
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
    "# SpecKiwi Step-State Fixture Index",
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
    "Step-state fixture index.",
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

// FR-PARSE-023 state.md columns: Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated.
function renderStateDocument(
  rows: Array<{ step: string; status?: string; dependsOn?: string; touchesScope: string; touchesReq: string }>
): string {
  const rendered = rows.map(
    (r) =>
      `| ${r.step} | ${r.status ?? "active"} | ${r.dependsOn ?? "-"} | ${r.touchesScope} | ${r.touchesReq} | 2026-06-01 | 2026-06-02 |`
  );
  return [
    "# Step State",
    "",
    "Mode: sdd",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rendered,
    ""
  ].join("\n");
}

async function buildWorkspace(
  stateRows: Array<{ step: string; status?: string; dependsOn?: string; touchesScope: string; touchesReq: string }>
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-mcp-024-"));
  const specDir = path.join(root, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndexDocument(), "utf8");
  await writeFile(
    path.join(specDir, SCOPE_FILE),
    renderScopeDocument([renderRequirementBlock(REQ_ID)]),
    "utf8"
  );
  const stepsDir = path.join(specDir, "steps");
  await mkdir(stepsDir, { recursive: true });
  await writeFile(path.join(stepsDir, "state.md"), renderStateDocument(stateRows), "utf8");
  return root;
}

/** The full state.md text (the file the step mutations rewrite). */
async function stateText(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, "docs", "spec", "steps", "state.md"), "utf8");
}

describe("FR-MCP-024 — MCP registration of step state tools", () => {
  // AC-1: claim_step, update_step_state, and list_steps are registered MCP tools with zod schemas.
  it("FR-MCP-024 AC-1: claim_step, update_step_state, and list_steps are registered MCP tools with zod schemas", () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const schemas = renderToolSchemas();
    const kinds = renderToolKinds();
    const readOnly = new Set(renderReadOnlyToolNames());

    for (const tool of STEP_STATE_TOOLS) {
      // Registered on the running MCP server, projected through the registry name view.
      expect(registered, `${tool} must be a registered MCP tool`).toContain(tool);
      expect(toolNames.has(tool), `${tool} must appear in renderToolNames()`).toBe(true);

      // A zod input schema is rendered for the tool, and its `step` arg is a zod schema.
      const schema = schemas[tool];
      expect(schema, `${tool} must have a rendered zod input schema`).toBeTypeOf("object");
      expect(schema?.step instanceof z.ZodType, `${tool}.step must be a zod schema`).toBe(true);

      // Each tool has a declared kind (one of the registry tool kinds).
      expect(["read", "req-scoped", "workspace", "log-append"]).toContain(kinds[tool]);
    }

    // claim_step / update_step_state are mutation tools (not read-only).
    for (const tool of STEP_MUTATION_TOOLS) {
      expect(["req-scoped", "workspace", "log-append"]).toContain(kinds[tool]);
      expect(readOnly.has(tool), `${tool} must not be in the read-only set`).toBe(false);
      expect(isReadOnlyTool(tool), `${tool} must not be a read-only tool`).toBe(false);
    }

    // list_steps is a read tool (read-only): it never writes state.md.
    expect(kinds[LIST_TOOL]).toBe("read");
    expect(readOnly.has(LIST_TOOL), `${LIST_TOOL} must be in the read-only set`).toBe(true);
    expect(isReadOnlyTool(LIST_TOOL), `${LIST_TOOL} must be a read-only tool`).toBe(true);

    // The zero-drift contract must still hold with the new tools registered across every
    // derived surface (FR-ARCH-006 / REL-ARCH-002 STANDING RULE).
    expect(() => assertZeroDriftToolSurface()).not.toThrow();
  });

  // AC-2: each step-state tool forwards its inputs to the corresponding core implementation.
  it("FR-MCP-024 AC-2: each step-state tool forwards its inputs to the corresponding core implementation", async () => {
    // ── claim_step → core claimStep (FR-NODE-027) ────────────────────────────
    // An unconflicted claim appends a state.md row carrying the declared TouchesScope/TouchesReq.
    {
      const rootPath = await buildWorkspace([]);
      const server = createMcpServer({ root: rootPath });
      const result = await server.callTool(CLAIM_TOOL, {
        step: "feature-x",
        touchesScope: "NODE",
        touchesReq: [REQ_ID]
      });
      expect(result).toMatchObject({ ok: true });
      const after = await stateText(rootPath);
      // The forwarding hit the real claimStep mutation: a new active row is written.
      expect(after).toContain("feature-x");
      expect(after).toMatch(/\|\s*feature-x\s*\|\s*active\s*\|.*\|\s*NODE\s*\|\s*FR-NODE-100\s*\|/);
    }

    // The core write-skew gate is reached through the handler (not a fixed-ok stub): a claim that
    // directly intersects an active step's TouchesReq HARD-BLOCKs with STEP_DIRECT_CONFLICT and
    // writes nothing.
    {
      const rootPath = await buildWorkspace([
        { step: "incumbent", touchesScope: "NODE", touchesReq: REQ_ID }
      ]);
      const server = createMcpServer({ root: rootPath });
      const before = await stateText(rootPath);
      const blocked = await server.callTool(CLAIM_TOOL, {
        step: "challenger",
        touchesScope: "NODE",
        touchesReq: [REQ_ID]
      });
      expect(blocked).toMatchObject({ ok: false, error: { code: "STEP_DIRECT_CONFLICT" } });
      // No challenger row was written (forwarding reached the gate, not a stub).
      expect(await stateText(rootPath)).toBe(before);
      expect(await stateText(rootPath)).not.toContain("challenger");
    }

    // ── update_step_state → core updateStepState (FR-NODE-028) ───────────────
    // Rewrites the Status cell of an existing step row in place.
    {
      const rootPath = await buildWorkspace([
        { step: "feature-y", status: "active", touchesScope: "NODE", touchesReq: REQ_ID }
      ]);
      const server = createMcpServer({ root: rootPath });
      const result = await server.callTool(UPDATE_TOOL, { step: "feature-y", status: "merging" });
      expect(result).toMatchObject({ ok: true });
      const after = await stateText(rootPath);
      // The forwarding hit the real updateStepState mutation: the row Status is now merging.
      expect(after).toMatch(/\|\s*feature-y\s*\|\s*merging\s*\|/);

      // The core enum guard is reached through the handler (not a stub): an out-of-enum status is
      // rejected with INVALID_STATUS and writes nothing.
      const badStatus = await server.callTool(UPDATE_TOOL, { step: "feature-y", status: "bogus" });
      expect(badStatus).toMatchObject({ ok: false, error: { code: "INVALID_STATUS" } });

      // The core liveness guard is reached: updating a non-existent step is NOT_FOUND.
      const missing = await server.callTool(UPDATE_TOOL, { step: "no-such-step", status: "merged" });
      expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }

    // ── list_steps → core listSteps (FR-NODE-029) ────────────────────────────
    // Returns the Kahn topological order honouring DependsOn edges. step-b depends on step-a,
    // so step-a must be ordered before step-b.
    {
      const rootPath = await buildWorkspace([
        { step: "step-a", touchesScope: "NODE", touchesReq: REQ_ID },
        { step: "step-b", dependsOn: "step-a", touchesScope: "NODE", touchesReq: "-" }
      ]);
      const server = createMcpServer({ root: rootPath });
      const result = (await server.callTool(LIST_TOOL, {})) as {
        ok: boolean;
        value: { steps: Array<{ step: string }>; cycle: boolean };
      };
      expect(result.ok).toBe(true);
      // The forwarding hit the real listSteps query: the ordered step names reflect the topology.
      const order = result.value.steps.map((s) => s.step);
      expect(order).toContain("step-a");
      expect(order).toContain("step-b");
      expect(order.indexOf("step-a")).toBeLessThan(order.indexOf("step-b"));
      expect(result.value.cycle).toBe(false);
    }
  });
});
