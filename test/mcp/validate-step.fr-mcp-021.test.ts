import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestMcpServer } from "../../src/mcp/adapter.js";
import { registerReadTools } from "../../src/mcp/tools/read-tools.js";
import { renderToolNames, renderToolSchemas, renderReadOnlyToolNames } from "../../src/mcp/schemas.js";
import { copyFixtureWorkspace } from "../fixtures/fixture-utils.js";

// FR-MCP-021 — MCP validate_step tool registration.
//
// Red-phase suite (T-PH005-03): one test case per acceptance criterion (AC-1..AC-3).
// These cases pin the future MCP contract before src/mcp exposes the `validate_step`
// tool, so the whole suite fails until the green task (T-PH005-04) registers the tool
// (server.registerTool("validate_step", ...) in read-tools.ts) AND adds its
// `mcpName: "validate_step"` ToolSpec entry to src/mcp/schemas.ts (STANDING RULE), so
// the registry-derived zero-drift surfaces (toolNames / toolSchemas / read-only set)
// project the new tool.
//
// Contract under test (from the requirement body and AC, SRS
// docs/spec/40.mcp-stdio-interface.srs.md FR-MCP-021):
//
//   An MCP validate_step tool is registered that runs validateWorkspaceScoped for a named
//   step and returns its step-local diagnostics including W044, W045, and STEP_* advisories.
//
//   - AC-1: validate_step accepts a step name and returns diagnostics scoped to that step.
//   - AC-2: validate_step surfaces W044 and W045 warnings when present.
//   - AC-3: validate_step returns STEP_* diagnostics as advisory and never as gate-failing errors.

const SPEC_DIR = path.join("docs", "spec");

interface Diagnostic {
  code: string;
  severity?: string;
}

/**
 * Renders a minimal requirement block compatible with the SRS parser. Only the id carries
 * meaning for the step-validation advisories; the rest are parseable defaults.
 */
function renderReqBlock(id: string, title: string): string {
  return [
    `### ${id} — ${title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
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
    `Fixture requirement ${id}.`,
    "",
    "#### Rationale",
    "",
    "- -",
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

/**
 * Writes a step-origin scope file under docs/spec/steps/<stepName>/ holding the given
 * requirement blocks. The workspace parser flattens these into stepRecords (origin=step,
 * stepName=<stepName>) so the step-local validation pass can reason about them.
 */
async function writeStepScopeFile(root: string, stepName: string, blocks: Array<{ id: string; title: string }>): Promise<void> {
  const dir = path.join(root, SPEC_DIR, "steps", stepName);
  await mkdir(dir, { recursive: true });
  const content = ["# Step Scope", "", "## Requirements", "", blocks.map((b) => renderReqBlock(b.id, b.title)).join("\n\n"), ""].join("\n");
  await writeFile(path.join(dir, "step.srs.md"), content, "utf8");
}

/** Seeds docs/spec/steps/state.md declaring the steps in the step state table. */
async function writeStateMd(root: string, rows: Array<{ step: string; touchesReq: string }>): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const tableRows = rows.map((r) => `| ${r.step} | active | - | ARCH | ${r.touchesReq} | 2026-06-01 | 2026-06-02 |`);
  const content = [
    "# Step State",
    "",
    "Mode: sdd",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...tableRows,
    ""
  ].join("\n");
  await writeFile(path.join(stepsDir, "state.md"), content, "utf8");
}

/**
 * Seeds a named step `step-a` engineered to trigger the step-local validators:
 *   - a step requirement reusing the body id FR-ARCH-001 (SRS-W044 step-shadows-body),
 *   - 7 step requirements total reaching the overload threshold (SRS-W045),
 *   - a direct conflict against another step touching FR-ARCH-001 (STEP_* advisory namespace),
 * and returns the step name.
 */
async function seedStepWithStepLocalDiagnostics(root: string): Promise<string> {
  const stepName = "step-a";
  const blocks = [
    { id: "FR-ARCH-001", title: "Step copy shadowing body id" },
    { id: "FR-ARCH-201", title: "Step req 2" },
    { id: "FR-ARCH-202", title: "Step req 3" },
    { id: "FR-ARCH-203", title: "Step req 4" },
    { id: "FR-ARCH-204", title: "Step req 5" },
    { id: "FR-ARCH-205", title: "Step req 6" },
    { id: "FR-ARCH-206", title: "Step req 7" }
  ];
  await writeStepScopeFile(root, stepName, blocks);
  await writeStepScopeFile(root, "step-b", [{ id: "FR-ARCH-301", title: "Other step req" }]);
  await writeStateMd(root, [
    { step: stepName, touchesReq: "FR-ARCH-001" },
    { step: "step-b", touchesReq: "FR-ARCH-001" }
  ]);
  return stepName;
}

/**
 * Introduces a body-scope structural error by renaming the index Scope Map heading, which drops
 * the table and raises a body-scope SRS-E diagnostic. Used to prove AC-1 scoping: a body-scope
 * error must NOT appear in step-scoped diagnostics returned by validate_step.
 */
async function breakBodyScope(root: string): Promise<void> {
  const indexPath = path.join(root, SPEC_DIR, "00.index.md");
  const original = await readFile(indexPath, "utf8");
  await writeFile(indexPath, original.replace("## 4. Scope Map", "## 4. Scope Mapping"), "utf8");
}

function expectOk<T>(result: unknown): T {
  expect(result).toMatchObject({ ok: true });
  return (result as { ok: true; value: T }).value;
}

/** Collects diagnostics from the standard split read envelope ({ errors, warnings }). */
function envelopeDiagnostics(value: { errors?: Diagnostic[]; warnings?: Diagnostic[] }): { errors: Diagnostic[]; warnings: Diagnostic[] } {
  return { errors: value.errors ?? [], warnings: value.warnings ?? [] };
}

describe("FR-MCP-021 — MCP validate_step tool registration", () => {
  // AC-1: validate_step accepts a step name and returns diagnostics scoped to that step.
  it("FR-MCP-021 AC-1: accepts a step name and returns diagnostics scoped to that step", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepName = await seedStepWithStepLocalDiagnostics(root);
    // A genuine body-scope error must NOT leak into the step-scoped diagnostics.
    await breakBodyScope(root);

    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    // The tool must be registered: callTool throws "Unknown MCP tool: validate_step" until green.
    const value = expectOk<{ errors?: Diagnostic[]; warnings?: Diagnostic[] }>(
      await server.callTool("validate_step", { step: stepName })
    );
    const { errors, warnings } = envelopeDiagnostics(value);
    expect(Array.isArray(errors)).toBe(true);
    expect(Array.isArray(warnings)).toBe(true);

    // Scoped to the named step: the body-scope Scope Map error is absent from the step pass.
    const allCodes = [...errors, ...warnings].map((d) => d.code);
    expect(allCodes).not.toContain("SRS-E014");
  });

  // AC-2: validate_step surfaces W044 and W045 warnings when present.
  it("FR-MCP-021 AC-2: surfaces W044 and W045 warnings when present", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepName = await seedStepWithStepLocalDiagnostics(root);

    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const value = expectOk<{ errors?: Diagnostic[]; warnings?: Diagnostic[] }>(
      await server.callTool("validate_step", { step: stepName })
    );
    const { errors, warnings } = envelopeDiagnostics(value);
    const codes = [...errors, ...warnings].map((d) => d.code);
    expect(codes).toContain("SRS-W044");
    expect(codes).toContain("SRS-W045");
  });

  // AC-3: validate_step returns STEP_* diagnostics as advisory and never as gate-failing errors.
  it("FR-MCP-021 AC-3: returns STEP_* diagnostics as advisory warnings, never as errors", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const stepName = await seedStepWithStepLocalDiagnostics(root);

    const server = createTestMcpServer({ root });
    registerReadTools(server, { root });

    const value = expectOk<{ errors?: Diagnostic[]; warnings?: Diagnostic[] }>(
      await server.callTool("validate_step", { step: stepName })
    );
    const { errors, warnings } = envelopeDiagnostics(value);

    // At least one STEP_* advisory is surfaced for the step.
    const warningCodes = warnings.map((d) => d.code);
    expect(warningCodes.some((code) => code.startsWith("STEP_"))).toBe(true);
    // STEP_* advisories are never gate-failing errors.
    const errorCodes = errors.map((d) => d.code);
    expect(errorCodes.some((code) => code.startsWith("STEP_"))).toBe(false);
  });

  // AC-1 (zero-drift pin): the tool is projected from the single ToolSpec registry, so the
  // registry-derived MCP surfaces (toolNames / toolSchemas / read-only set) carry it. This pins
  // the STANDING RULE that the green task registers `mcpName: "validate_step"` (kind "read").
  it("FR-MCP-021 AC-1: validate_step is a read-only tool projected from the ToolSpec registry", () => {
    expect(renderToolNames()).toContain("validate_step");
    expect(Object.keys(renderToolSchemas())).toContain("validate_step");
    expect(renderReadOnlyToolNames()).toContain("validate_step");
  });
});
