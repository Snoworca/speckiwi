import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
// FR-MCP-023 — MCP registration of gap mutation tools statement and AC edit.
//
// Red-phase suite (T-PH005-07): one test case per acceptance criterion (AC-1, AC-2).
// These cases describe the future MCP surface of FR-MCP-023 before the two gap
// mutation tools (update_requirement_statement, edit_acceptance_criteria) are
// registered, so the whole suite fails until the green task (T-PH005-08) gives the
// IR-CLI-040 / IR-CLI-041 ToolSpec entries (src/mcp/schemas.ts) an mcpName and wires
// the handlers in registerMutationTools (src/mcp/tools/mutation-tools.ts).
//
// Contract under test (FR-MCP-023 requirement body + AC):
//   - AC-1: update_requirement_statement is a registered MCP tool with a zod schema
//           forwarding to the core mutation updateRequirementStatement (FR-NODE-025).
//   - AC-2: edit_acceptance_criteria is a registered MCP tool with a zod schema
//           forwarding to the core mutation editAcceptanceCriteria (FR-NODE-026).
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

const STATEMENT_TOOL = "update_requirement_statement";
const AC_TOOL = "edit_acceptance_criteria";

/** The MCP tool names actually registered by the running server (resource handlers excluded). */
function registeredMcpToolNames(): string[] {
  const handle = createMcpServer({});
  return Object.keys(handle.tools)
    .filter((name) => !name.startsWith("resource:"))
    .sort();
}

// ── Self-contained NODE-scope workspace builder (forwarding fixture) ──────────
// Mirrors the FR-MCP-022 MCP suite fixture so the gap mutations have one live
// requirement (FR-NODE-100) — with an editable statement paragraph and an editable
// acceptance criterion (AC-1) — to operate on through the MCP tool handlers.

const SCOPE_FILE = "50.nodejs-implementation.srs.md";
const REQ_ID = "FR-NODE-100";
const ORIGINAL_STATEMENT = `Requirement statement for ${REQ_ID}.`;
const ORIGINAL_AC_PROSE = "Generated criterion.";

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
    ORIGINAL_STATEMENT,
    "",
    "#### Rationale",
    "",
    "-",
    "",
    "#### Acceptance Criteria",
    "",
    `- [ ] AC-1: ${ORIGINAL_AC_PROSE}`,
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
    "Gap-mutation fixture.",
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
    "# SpecKiwi Gap-Mutation Fixture Index",
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
    "Gap-mutation fixture index.",
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

async function buildWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-mcp-023-"));
  const specDir = path.join(root, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndexDocument(), "utf8");
  await writeFile(
    path.join(specDir, SCOPE_FILE),
    renderScopeDocument([renderRequirementBlock(REQ_ID)]),
    "utf8"
  );
  return root;
}

/** The full scope-document text after a mutation (the source of truth the core mutations rewrite). */
async function scopeText(rootPath: string): Promise<string> {
  return readFile(path.join(rootPath, "docs", "spec", SCOPE_FILE), "utf8");
}

/** The parsed AC-1 prose for REQ_ID (statement text after `AC-1:`), via the real parser. */
async function acProse(rootPath: string): Promise<string> {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  const record = workspace.records.find((r) => r.id === REQ_ID);
  const criterion = record?.acceptanceCriteria.find((c) => c.id === "AC-1");
  return criterion?.text ?? "";
}

describe("FR-MCP-023 — MCP registration of gap mutation tools statement and AC edit", () => {
  // AC-1: update_requirement_statement is a registered MCP tool with a zod schema
  // forwarding to the core mutation.
  it("FR-MCP-023 AC-1: update_requirement_statement is a registered MCP tool whose zod schema forwards to the core mutation", async () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const schemas = renderToolSchemas();
    const kinds = renderToolKinds();
    const readOnly = new Set(renderReadOnlyToolNames());

    // Registered on the running MCP server, projected through the registry name view.
    expect(registered, `${STATEMENT_TOOL} must be a registered MCP tool`).toContain(STATEMENT_TOOL);
    expect(toolNames.has(STATEMENT_TOOL), `${STATEMENT_TOOL} must appear in renderToolNames()`).toBe(true);

    // A zod input schema is rendered for the tool, and its `id` arg is a zod schema.
    const schema = schemas[STATEMENT_TOOL];
    expect(schema, `${STATEMENT_TOOL} must have a rendered zod input schema`).toBeTypeOf("object");
    expect(schema?.id instanceof z.ZodType, `${STATEMENT_TOOL}.id must be a zod schema`).toBe(true);

    // It is a mutation tool, not read-only.
    expect(["req-scoped", "workspace", "log-append"]).toContain(kinds[STATEMENT_TOOL]);
    expect(readOnly.has(STATEMENT_TOOL), `${STATEMENT_TOOL} must not be in the read-only set`).toBe(false);
    expect(isReadOnlyTool(STATEMENT_TOOL), `${STATEMENT_TOOL} must not be a read-only tool`).toBe(false);

    // The zero-drift contract must still hold with the new tool registered across every
    // derived surface (FR-ARCH-006 / REL-ARCH-002 STANDING RULE).
    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    // Forwarding (no mocks): the handler reaches the core updateRequirementStatement
    // (FR-NODE-025), which rewrites the requirement's statement paragraph in place while
    // leaving the Acceptance Criteria untouched.
    const rootPath = await buildWorkspace();
    const server = createMcpServer({ root: rootPath });
    const newStatement = "Rewritten statement body via MCP forwarding.";
    const result = await server.callTool(STATEMENT_TOOL, { id: REQ_ID, text: newStatement });
    expect(result).toMatchObject({ ok: true });

    const after = await scopeText(rootPath);
    expect(after).toContain(newStatement);
    expect(after).not.toContain(ORIGINAL_STATEMENT);
    // The AC section is left intact (forwarding hit the statement mutation, not a stub).
    expect(after).toContain(`AC-1: ${ORIGINAL_AC_PROSE}`);

    // The core USAGE guard is reached through the handler: empty text is rejected by the
    // core mutation, proving forwarding rather than a fixed-ok stub.
    const rejected = await server.callTool(STATEMENT_TOOL, { id: REQ_ID, text: "" });
    expect(rejected).toMatchObject({ ok: false, error: { code: "USAGE" } });

    // A missing requirement reaches the core liveness guard (NOT_FOUND), not a stub.
    const missing = await server.callTool(STATEMENT_TOOL, { id: "FR-NODE-999", text: "x" });
    expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  // AC-2: edit_acceptance_criteria is a registered MCP tool with a zod schema forwarding
  // to the core mutation.
  it("FR-MCP-023 AC-2: edit_acceptance_criteria is a registered MCP tool whose zod schema forwards to the core mutation", async () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const schemas = renderToolSchemas();
    const kinds = renderToolKinds();
    const readOnly = new Set(renderReadOnlyToolNames());

    expect(registered, `${AC_TOOL} must be a registered MCP tool`).toContain(AC_TOOL);
    expect(toolNames.has(AC_TOOL), `${AC_TOOL} must appear in renderToolNames()`).toBe(true);

    // A zod input schema is rendered for the tool, and its `id` and `acId` args are zod schemas.
    const schema = schemas[AC_TOOL];
    expect(schema, `${AC_TOOL} must have a rendered zod input schema`).toBeTypeOf("object");
    for (const arg of ["id", "acId"]) {
      expect(schema?.[arg] instanceof z.ZodType, `${AC_TOOL}.${arg} must be a zod schema`).toBe(true);
    }

    expect(["req-scoped", "workspace", "log-append"]).toContain(kinds[AC_TOOL]);
    expect(readOnly.has(AC_TOOL), `${AC_TOOL} must not be in the read-only set`).toBe(false);
    expect(isReadOnlyTool(AC_TOOL), `${AC_TOOL} must not be a read-only tool`).toBe(false);

    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    // Forwarding (no mocks): the handler reaches the core editAcceptanceCriteria
    // (FR-NODE-026), which rewrites only the prose of AC-1, preserving the checkbox and id.
    const rootPath = await buildWorkspace();
    const server = createMcpServer({ root: rootPath });
    const newProse = "Rewritten AC prose via MCP forwarding.";
    const result = await server.callTool(AC_TOOL, { id: REQ_ID, acId: "AC-1", text: newProse });
    expect(result).toMatchObject({ ok: true });

    // The parsed AC-1 prose now equals the new text (forwarding hit the AC mutation).
    expect(await acProse(rootPath)).toBe(newProse);
    const after = await scopeText(rootPath);
    expect(after).toContain(`- [ ] AC-1: ${newProse}`);
    expect(after).not.toContain(ORIGINAL_AC_PROSE);
    // The statement paragraph is left intact (the edit was scoped to the AC line).
    expect(after).toContain(ORIGINAL_STATEMENT);

    // The core guards are reached through the handler: a missing AC id is MUTATION_DENIED,
    // empty text is USAGE — proving forwarding rather than a fixed-ok stub.
    const badAc = await server.callTool(AC_TOOL, { id: REQ_ID, acId: "AC-9", text: "x" });
    expect(badAc).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
    const rejected = await server.callTool(AC_TOOL, { id: REQ_ID, acId: "AC-1", text: "" });
    expect(rejected).toMatchObject({ ok: false, error: { code: "USAGE" } });
  });
});
