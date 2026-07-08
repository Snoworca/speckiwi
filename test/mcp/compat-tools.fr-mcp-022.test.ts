import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
// FR-MCP-022 — MCP registration of compatibility-check tools and edge read tools.
//
// Red-phase suite (T-PH005-05): one test case per acceptance criterion
// (AC-1..AC-3). These cases describe the future MCP surface of FR-MCP-022 before
// the three compatibility mutation tools (add_compatibility_check,
// refresh_compatibility_check, revoke_compatibility_check) and the two edge read
// tools (list_dirty_edges, list_compat_edges) are registered, so the whole suite
// fails until the green task (T-PH005-06) registers them in the ToolSpec registry
// (src/mcp/schemas.ts) and wires the handlers.
//
// Contract under test (FR-MCP-022 requirement body + AC):
//   - AC-1: the three compatibility MUTATION tools are registered with zod schemas.
//   - AC-2: list_dirty_edges and list_compat_edges are registered MCP READ tools.
//   - AC-3: each compatibility mutation tool forwards its inputs to the
//           corresponding core mutation (addCompatibilityCheck / refreshCompatibilityCheck /
//           revokeCompatibilityCheck, FR-NODE-022 / FR-NODE-023).
import {
  renderToolNames,
  renderToolSchemas,
  renderReadOnlyToolNames,
  renderToolKinds,
  assertZeroDriftToolSurface
} from "../../src/mcp/schemas.js";
import { createMcpServer, isReadOnlyTool } from "../../src/mcp/server.js";
import { resolveProjectRoot } from "../../src/core/project-root.js";
import { parseWorkspace } from "../../src/core/parser/workspace-parser.js";

const COMPAT_MUTATION_TOOLS = [
  "add_compatibility_check",
  "refresh_compatibility_check",
  "revoke_compatibility_check"
] as const;
const EDGE_READ_TOOLS = ["list_dirty_edges", "list_compat_edges"] as const;

const COMPATIBLE_RELATION = "checked_compatible";

/** The MCP tool names actually registered by the running server (resource handlers excluded). */
function registeredMcpToolNames(): string[] {
  const handle = createMcpServer({});
  return Object.keys(handle.tools)
    .filter((name) => !name.startsWith("resource:"))
    .sort();
}

// ── Self-contained NODE-scope workspace builder (AC-3 forwarding fixture) ─────
// Mirrors the FR-NODE-022 core suite fixture so the compatibility mutations have
// two live requirements (FR-NODE-100 < FR-NODE-200) to operate on through the MCP
// tool handlers.

const SCOPE_FILE = path.join("docs", "spec", "50.nodejs-implementation.srs.md");
const MIN_ID = "FR-NODE-100";
const MAX_ID = "FR-NODE-200";

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
    "- [ ] AC-1: Generated criterion.",
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
    "Compatibility-check fixture.",
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
    "# SpecKiwi Compatibility Fixture Index",
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
    "Compatibility-check fixture index.",
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    "| Node.js Implementation | [50.nodejs-implementation.srs.md](./50.nodejs-implementation.srs.md) | NODE | Node |",
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
    "| Node.js Implementation | [50.nodejs-implementation.srs.md](./50.nodejs-implementation.srs.md) | NODE | Node |",
    "",
    "## 5. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    ""
  ].join("\n");
}

async function buildWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-mcp-022-"));
  const specDir = path.join(root, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndexDocument(), "utf8");
  await writeFile(
    path.join(specDir, SCOPE_FILE.split(path.sep).pop() as string),
    renderScopeDocument([renderRequirementBlock(MIN_ID), renderRequirementBlock(MAX_ID)]),
    "utf8"
  );
  return root;
}

/** All checked_compatible trace rows in the workspace. */
async function compatibilityRows(rootPath: string): Promise<Array<{ holder: string; reference: string; notes: string }>> {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  const rows: Array<{ holder: string; reference: string; notes: string }> = [];
  for (const record of workspace.records) {
    for (const link of record.traceLinks) {
      if (link.relation === COMPATIBLE_RELATION) {
        rows.push({ holder: record.id, reference: link.reference, notes: link.notes });
      }
    }
  }
  return rows;
}

describe("FR-MCP-022 — MCP registration of compatibility-check tools and edge read tools", () => {
  // AC-1: The three compatibility mutation tools are registered with zod schemas.
  it("FR-MCP-022 AC-1: the three compatibility mutation tools are registered with zod input schemas", () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const schemas = renderToolSchemas();
    const kinds = renderToolKinds();

    for (const tool of COMPAT_MUTATION_TOOLS) {
      // Registered on the running MCP server, projected through the registry name view.
      expect(registered, `${tool} must be a registered MCP tool`).toContain(tool);
      expect(toolNames.has(tool), `${tool} must appear in renderToolNames()`).toBe(true);

      // A zod input schema is rendered for the tool, and its endpoint args (aReqId, bReqId)
      // are zod schemas (the compatibility mutations take the two REQ-IDs as input).
      const schema = schemas[tool];
      expect(schema, `${tool} must have a rendered zod input schema`).toBeTypeOf("object");
      for (const arg of ["aReqId", "bReqId"]) {
        expect(schema?.[arg] instanceof z.ZodType, `${tool}.${arg} must be a zod schema`).toBe(true);
      }

      // The compatibility tools are MUTATION tools, not read-only.
      expect(["req-scoped", "workspace", "log-append"]).toContain(kinds[tool]);
      expect(isReadOnlyTool(tool), `${tool} must not be a read-only tool`).toBe(false);
    }

    // The zero-drift contract must hold with the new mutation tools registered across
    // every derived surface (FR-ARCH-006 / REL-ARCH-002 STANDING RULE).
    expect(() => assertZeroDriftToolSurface()).not.toThrow();
  });

  // AC-2: list_dirty_edges and list_compat_edges are registered MCP read tools.
  it("FR-MCP-022 AC-2: list_dirty_edges and list_compat_edges are registered as read-only MCP tools", () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const readOnly = new Set(renderReadOnlyToolNames());
    const kinds = renderToolKinds();

    for (const tool of EDGE_READ_TOOLS) {
      expect(registered, `${tool} must be a registered MCP tool`).toContain(tool);
      expect(toolNames.has(tool), `${tool} must appear in renderToolNames()`).toBe(true);
      // The edge listers are read tools: read kind, in the read-only set, and isReadOnlyTool true.
      expect(kinds[tool], `${tool} must be a 'read' kind tool`).toBe("read");
      expect(readOnly.has(tool), `${tool} must be in the read-only tool set`).toBe(true);
      expect(isReadOnlyTool(tool), `isReadOnlyTool('${tool}') must be true`).toBe(true);
    }

    expect(() => assertZeroDriftToolSurface()).not.toThrow();
  });

  // AC-3: Each compatibility mutation tool forwards its inputs to the corresponding core mutation.
  // Verified end-to-end against a real workspace (no mocks): add writes a checked_compatible row,
  // refresh re-pins it in place, revoke removes it — each driven only by the {aReqId, bReqId}
  // inputs the handler forwards to addCompatibilityCheck / refreshCompatibilityCheck /
  // revokeCompatibilityCheck.
  it("FR-MCP-022 AC-3: each compatibility mutation tool forwards aReqId/bReqId to its core mutation", async () => {
    const rootPath = await buildWorkspace();
    const server = createMcpServer({ root: rootPath });

    // add_compatibility_check → core addCompatibilityCheck writes exactly one row on the
    // compareReqId-minimum block referencing the peer.
    const added = await server.callTool("add_compatibility_check", { aReqId: MAX_ID, bReqId: MIN_ID });
    expect(added).toMatchObject({ ok: true });
    let rows = await compatibilityRows(rootPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].holder).toBe(MIN_ID);
    expect(rows[0].reference).toBe(MAX_ID);
    const notesAfterAdd = rows[0].notes;

    // refresh_compatibility_check → core refreshCompatibilityCheck replaces the single row in
    // place (still exactly one row on the same min block referencing the same peer).
    const refreshed = await server.callTool("refresh_compatibility_check", { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(refreshed).toMatchObject({ ok: true });
    rows = await compatibilityRows(rootPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].holder).toBe(MIN_ID);
    expect(rows[0].reference).toBe(MAX_ID);
    expect(rows[0].notes).toContain("fpv1");
    // The refreshed row carries the canonical pin grammar (still a valid checked_compatible row).
    expect(notesAfterAdd).toContain("fpv1");

    // revoke_compatibility_check → core revokeCompatibilityCheck removes the row entirely.
    const revoked = await server.callTool("revoke_compatibility_check", { aReqId: MAX_ID, bReqId: MIN_ID });
    expect(revoked).toMatchObject({ ok: true });
    rows = await compatibilityRows(rootPath);
    expect(rows).toHaveLength(0);

    // Forwarding is order-independent and endpoint-driven: revoking again now reports NOT_FOUND,
    // proving the inputs reached the core mutation (not a stub returning a fixed ok).
    const revokedAgain = await server.callTool("revoke_compatibility_check", { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(revokedAgain).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    // The peer endpoint must also be honored when missing → forwarding reaches the core liveness
    // guard rather than a stub.
    const badEndpoint = await server.callTool("add_compatibility_check", { aReqId: MIN_ID, bReqId: "FR-NODE-999" });
    expect(badEndpoint).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});
