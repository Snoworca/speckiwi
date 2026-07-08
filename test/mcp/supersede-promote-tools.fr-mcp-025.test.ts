import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
// FR-MCP-043 — MCP registration of supersede and promote mutation tools.
//
// Red-phase suite (T-PH005-11): one test case per acceptance criterion (AC-1, AC-2).
// These cases describe the future MCP surface of FR-MCP-043 before the two mutation
// tools (supersede_requirement, promote_step_requirement) are registered, so the whole
// suite fails until the green task (T-PH005-12) gives the supersede / promote ToolSpec
// entries (src/mcp/schemas.ts) an mcpName and wires the handlers in registerMutationTools
// (src/mcp/tools/mutation-tools.ts) forwarding to the core supersedeRequirement
// (FR-NODE-045) / promoteStepRequirement (FR-NODE-046).
//
// Contract under test (FR-MCP-043 requirement body + AC):
//   - AC-1: supersede_requirement is a registered MCP tool with a zod schema
//           forwarding to the core mutation supersedeRequirement (FR-NODE-045).
//   - AC-2: promote_step_requirement is a registered MCP tool with a zod schema
//           forwarding to the core mutation promoteStepRequirement (FR-NODE-046).
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
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

const SUPERSEDE_TOOL = "supersede_requirement";
const PROMOTE_TOOL = "promote_step_requirement";

const SPEC_DIR = path.join("docs", "spec");
const ARCH_BODY_FILE = path.join(SPEC_DIR, "10.product-architecture.srs.md");

/** The MCP tool names actually registered by the running server (resource handlers excluded). */
function registeredMcpToolNames(): string[] {
  const handle = createMcpServer({});
  return Object.keys(handle.tools)
    .filter((name) => !name.startsWith("resource:"))
    .sort();
}

/** Returns the parsed BODY requirement record for `id`, or undefined when absent. */
async function bodyRecordById(rootPath: string, id: string) {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  return workspace.records.find((record) => record.id === id);
}

// ── Step-scope fixture writer (FR-NODE-046 promote forwarding fixture) ─────────
// Mirrors the FR-NODE-046 core suite: stages an ARCH-scope step file under
// docs/spec/steps/<stepName>/ carrying one requirement block whose pre-minted
// canonical id promote_step_requirement is expected to insert verbatim into the body.

function renderStepReqBlock(options: { id: string; title: string }): string {
  return [
    `### ${options.id} — ${options.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "| Priority | high |",
    "| Tags | step, fixture |",
    "| Risk | low |",
    "| Stability | evolving |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Step-scoped requirement ${options.id}.`,
    "",
    "#### Rationale",
    "",
    "- -",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Step criterion.",
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

async function writeStepScopeFile(
  rootPath: string,
  stepName: string,
  block: { id: string; title: string }
): Promise<void> {
  const stepDir = path.join(rootPath, SPEC_DIR, "steps", stepName);
  await mkdir(stepDir, { recursive: true });
  const content = [
    "# Step Architecture",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Document Type | scope_srs |",
    "| Scope | ARCH |",
    "| Scope Name | Product Architecture |",
    "",
    "## 4. Requirements",
    "",
    renderStepReqBlock(block)
  ].join("\n");
  await writeFile(path.join(stepDir, "10.product-architecture.srs.md"), content, "utf8");
}

describe("FR-MCP-043 — MCP registration of supersede and promote mutation tools", () => {
  // AC-1: supersede_requirement is a registered MCP tool with a zod schema forwarding
  // to the core mutation supersedeRequirement (FR-NODE-045).
  it("FR-MCP-043 AC-1: supersede_requirement is a registered MCP tool whose zod schema forwards to the core mutation", async () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const schemas = renderToolSchemas();
    const kinds = renderToolKinds();
    const readOnly = new Set(renderReadOnlyToolNames());

    // Registered on the running MCP server, projected through the registry name view.
    expect(registered, `${SUPERSEDE_TOOL} must be a registered MCP tool`).toContain(SUPERSEDE_TOOL);
    expect(toolNames.has(SUPERSEDE_TOOL), `${SUPERSEDE_TOOL} must appear in renderToolNames()`).toBe(true);

    // A zod input schema is rendered for the tool, and its supersede args are zod schemas.
    const schema = schemas[SUPERSEDE_TOOL];
    expect(schema, `${SUPERSEDE_TOOL} must have a rendered zod input schema`).toBeTypeOf("object");
    for (const arg of ["oldId", "scope", "target", "title", "statement", "acceptanceCriteria"]) {
      expect(schema?.[arg] instanceof z.ZodType, `${SUPERSEDE_TOOL}.${arg} must be a zod schema`).toBe(true);
    }

    // It is a mutation tool, not read-only.
    expect(["req-scoped", "workspace", "log-append"]).toContain(kinds[SUPERSEDE_TOOL]);
    expect(readOnly.has(SUPERSEDE_TOOL), `${SUPERSEDE_TOOL} must not be in the read-only set`).toBe(false);
    expect(isReadOnlyTool(SUPERSEDE_TOOL), `${SUPERSEDE_TOOL} must not be a read-only tool`).toBe(false);

    // The zero-drift contract must still hold with the new tool registered across every
    // derived surface (FR-ARCH-006 / REL-ARCH-002 STANDING RULE).
    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    // Forwarding (no mocks): the handler reaches the core supersedeRequirement (FR-NODE-045),
    // which performs the strict two-call sequence — T1 mints a successor carrying a
    // `supersedes oldId` trace, T2 discards the old requirement.
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const OLD_ID = "FR-ARCH-001";
    const server = createMcpServer({ root: rootPath });
    const result = await server.callTool(SUPERSEDE_TOOL, {
      oldId: OLD_ID,
      scope: "ARCH",
      target: "v1.0.0",
      title: `Successor of ${OLD_ID}`,
      statement: `Replacement statement superseding ${OLD_ID}.`,
      acceptanceCriteria: ["Successor criterion."]
    });
    expect(result).toMatchObject({ ok: true });

    // T1 minted a distinct successor id and surfaced it through the envelope.
    const newId = (result as { ok: true; value: { newId?: string } }).value.newId;
    expect(typeof newId).toBe("string");
    expect(newId).not.toBe(OLD_ID);

    // The successor exists in the body with a `supersedes oldId` trace row, and the old
    // requirement is now discarded — proving forwarding rather than a fixed-ok stub.
    const successor = await bodyRecordById(rootPath, newId as string);
    expect(successor).toBeDefined();
    expect(
      successor?.traceLinks.some(
        (link) => link.type === "Requirement" && link.relation === "supersedes" && link.reference === OLD_ID
      )
    ).toBe(true);
    expect((await bodyRecordById(rootPath, OLD_ID))?.status).toBe("discarded");

    // The core self-reference guard is reachable through the handler: a successor pinned to
    // oldId is MUTATION_DENIED, proving forwarding (not a stub).
    const denied = await server.callTool(SUPERSEDE_TOOL, {
      oldId: OLD_ID,
      scope: "ARCH",
      target: "v1.0.0",
      title: "Self-referential successor",
      statement: "x",
      acceptanceCriteria: ["c"],
      successorId: OLD_ID
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "MUTATION_DENIED" } });
  });

  // AC-2: promote_step_requirement is a registered MCP tool with a zod schema forwarding
  // to the core mutation promoteStepRequirement (FR-NODE-046).
  it("FR-MCP-043 AC-2: promote_step_requirement is a registered MCP tool whose zod schema forwards to the core mutation", async () => {
    const registered = registeredMcpToolNames();
    const toolNames = new Set(renderToolNames());
    const schemas = renderToolSchemas();
    const kinds = renderToolKinds();
    const readOnly = new Set(renderReadOnlyToolNames());

    expect(registered, `${PROMOTE_TOOL} must be a registered MCP tool`).toContain(PROMOTE_TOOL);
    expect(toolNames.has(PROMOTE_TOOL), `${PROMOTE_TOOL} must appear in renderToolNames()`).toBe(true);

    // A zod input schema is rendered for the tool, and its promote args are zod schemas.
    const schema = schemas[PROMOTE_TOOL];
    expect(schema, `${PROMOTE_TOOL} must have a rendered zod input schema`).toBeTypeOf("object");
    for (const arg of ["id", "fromStep", "toScope"]) {
      expect(schema?.[arg] instanceof z.ZodType, `${PROMOTE_TOOL}.${arg} must be a zod schema`).toBe(true);
    }

    expect(["req-scoped", "workspace", "log-append"]).toContain(kinds[PROMOTE_TOOL]);
    expect(readOnly.has(PROMOTE_TOOL), `${PROMOTE_TOOL} must not be in the read-only set`).toBe(false);
    expect(isReadOnlyTool(PROMOTE_TOOL), `${PROMOTE_TOOL} must not be a read-only tool`).toBe(false);

    expect(() => assertZeroDriftToolSurface()).not.toThrow();

    // Forwarding (no mocks): the handler reaches the core promoteStepRequirement
    // (FR-NODE-046), which inserts a step's pre-minted id verbatim into the target body
    // scope after a reservation-uniqueness check.
    const rootPath = await copyFixtureWorkspace("valid-basic");
    const STEP_ID = "FR-ARCH-501";
    await writeStepScopeFile(rootPath, "feature-x", { id: STEP_ID, title: "Promotable step requirement" });
    const server = createMcpServer({ root: rootPath });

    // Before promotion the id lives only in the step origin, not the body.
    expect(await bodyRecordById(rootPath, STEP_ID)).toBeUndefined();

    const result = await server.callTool(PROMOTE_TOOL, { id: STEP_ID, fromStep: "feature-x", toScope: "ARCH" });
    expect(result).toMatchObject({ ok: true });
    expect((result as { ok: true; value: { requirementId: string } }).value.requirementId).toBe(STEP_ID);

    // The body scope now contains a requirement carrying the step's id verbatim.
    const promoted = await bodyRecordById(rootPath, STEP_ID);
    expect(promoted).toBeDefined();
    expect(promoted?.id).toBe(STEP_ID);
    const bodyText = await readFile(path.join(rootPath, ARCH_BODY_FILE), "utf8");
    expect(bodyText).toContain(`### ${STEP_ID} `);

    // The core reservation guard is reachable through the handler: an id colliding with an
    // existing body requirement is denied, proving forwarding (not a stub).
    const collideRoot = await copyFixtureWorkspace("valid-basic");
    const COLLIDING_ID = "FR-ARCH-001";
    await writeStepScopeFile(collideRoot, "feature-x", { id: COLLIDING_ID, title: "Colliding step requirement" });
    const collideServer = createMcpServer({ root: collideRoot });
    const denied = await collideServer.callTool(PROMOTE_TOOL, {
      id: COLLIDING_ID,
      fromStep: "feature-x",
      toScope: "ARCH"
    });
    expect(denied).toMatchObject({ ok: false });
  });
});
