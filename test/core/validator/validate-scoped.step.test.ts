import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspaceScoped } from "../../../src/core/validator/validate-scoped.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-PARSE-024 / FR-PARSE-025 — core step-local validation pass.
//
// These cases pin the CORE contract that the CLI `speckiwi step validate <name>`
// (IR-CLI-028) and MCP `validate_step` (FR-MCP-021) surfaces both compose over:
// validateWorkspaceScoped(workspace, { step }) runs a single step-local pass whose
// diagnostics are scoped to docs/spec/steps/<step>/ and adds the step advisory rules
// SRS-W044 (step-shadows-body), SRS-W045 (step-overload >= 7), and a STEP_* namespace
// advisory (direct same-requirement conflict), all as non-gate-failing warnings.

const SPEC_DIR = path.join("docs", "spec");

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

async function writeStepScopeFile(root: string, stepName: string, blocks: Array<{ id: string; title: string }>): Promise<void> {
  const dir = path.join(root, SPEC_DIR, "steps", stepName);
  await mkdir(dir, { recursive: true });
  const content = ["# Step Scope", "", "## Requirements", "", blocks.map((b) => renderReqBlock(b.id, b.title)).join("\n\n"), ""].join("\n");
  await writeFile(path.join(dir, "step.srs.md"), content, "utf8");
}

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

async function seedStepWithStepLocalError(root: string, stepName: string): Promise<void> {
  const dir = path.join(root, SPEC_DIR, "steps", stepName);
  await mkdir(dir, { recursive: true });
  const goodBlock = renderReqBlock("FR-ARCH-401", "Well-formed step req");
  const content = ["# Step Scope", "", "## Requirements", "", goodBlock, "", "### not a valid requirement heading", ""].join("\n");
  await writeFile(path.join(dir, "step.srs.md"), content, "utf8");
  await writeStateMd(root, [{ step: stepName, touchesReq: "FR-ARCH-401" }]);
}

async function breakBodyScope(root: string): Promise<void> {
  const indexPath = path.join(root, SPEC_DIR, "00.index.md");
  const original = await readFile(indexPath, "utf8");
  await writeFile(indexPath, original.replace("## 4. Scope Map", "## 4. Scope Mapping"), "utf8");
}

async function scopedFor(root: string, step: string) {
  const workspace = await parseWorkspace(await resolveProjectRoot(root));
  return validateWorkspaceScoped(workspace, { step });
}

describe("validateWorkspaceScoped — step-local validation pass", () => {
  it("returns a split-diagnostics envelope scoped to the named step (excludes body-scope errors)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const step = await seedStepWithStepLocalDiagnostics(root);
    await breakBodyScope(root);

    const result = await scopedFor(root, step);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    const codes = [...result.errors, ...result.warnings].map((d) => d.code);
    expect(codes).not.toContain("SRS-E014");
  });

  it("emits SRS-W044, SRS-W045, and a STEP_* advisory for a shadowing overloaded conflicting step", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const step = await seedStepWithStepLocalDiagnostics(root);

    const result = await scopedFor(root, step);
    const codes = [...result.errors, ...result.warnings].map((d) => d.code);
    expect(codes).toContain("SRS-W044");
    expect(codes).toContain("SRS-W045");
    expect(codes.some((c) => c.startsWith("STEP_"))).toBe(true);
  });

  it("keeps STEP_* advisories as warnings, never as gate-failing errors", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const step = await seedStepWithStepLocalDiagnostics(root);

    const result = await scopedFor(root, step);
    expect(result.warnings.map((d) => d.code).some((c) => c.startsWith("STEP_"))).toBe(true);
    expect(result.errors.map((d) => d.code).some((c) => c.startsWith("STEP_"))).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it("surfaces a step-anchored structural error (SRS-E001) as a step-local error", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await seedStepWithStepLocalError(root, "step-err");

    const result = await scopedFor(root, "step-err");
    expect(result.errors.map((d) => d.code)).toContain("SRS-E001");
  });

  it("a body-only structural error does not leak into an unrelated clean step pass", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    const step = await seedStepWithStepLocalDiagnostics(root);
    await breakBodyScope(root);

    const result = await scopedFor(root, step);
    expect(result.errors).toHaveLength(0);
  });
});
