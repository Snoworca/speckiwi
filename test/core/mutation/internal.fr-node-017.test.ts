import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { loadRecord, loadRecordWithWorkspace } from "../../../src/core/mutation/internal.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import type { ProjectRoot, RequirementRecord, TextFile } from "../../../src/core/types.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

const posix = (p: string) => p.replace(/\\/g, "/");

// FR-NODE-033: loadRecord / loadRecordWithWorkspace gain optional origin and stepName
// parameters. When omitted they prefer body records (backward compatible). When
// origin=step + stepName are supplied the lookup routes to step records. These signatures
// do not exist yet, so we describe the future widened call shape and cast through it so the
// suite stays type-clean today while the green task (T-PH003-02) materializes the real types.
const STEP_NAME = "beta";

type OriginAwareLoadRecord = (
  root: ProjectRoot,
  id: string,
  origin?: "body" | "step",
  stepName?: string
) => Promise<{ record: RequirementRecord; file: TextFile } | undefined>;

type OriginAwareLoadRecordWithWorkspace = (
  root: ProjectRoot,
  id: string,
  origin?: "body" | "step",
  stepName?: string
) => Promise<{ record: RequirementRecord; file: TextFile; records: readonly RequirementRecord[] } | undefined>;

const loadRecordOriginAware = loadRecord as unknown as OriginAwareLoadRecord;
const loadRecordWithWorkspaceOriginAware = loadRecordWithWorkspace as unknown as OriginAwareLoadRecordWithWorkspace;

// Render an FR-ARCH-001 requirement block whose title is supplied by the caller, so the body
// copy and the step copy of the same id are distinguishable by their parsed title.
function archBlock(title: string): string {
  return [
    `### FR-ARCH-001 — ${title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | planned |",
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    "| Stability | stable |",
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `${title} statement.`,
    "",
    "#### Rationale",
    "",
    "- -",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: A criterion.",
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

// Build a workspace where FR-ARCH-001 exists in BOTH the body scope file and a step file
// (docs/spec/steps/<STEP_NAME>/...). The body copy already lives in the valid-basic fixture
// (title "Fixture requirement"); we add a same-id step copy with a different title.
async function workspaceWithBodyAndStep(): Promise<ProjectRoot> {
  const dir = await copyFixtureWorkspace("valid-basic");
  const stepDir = path.join(dir, "docs", "spec", "steps", STEP_NAME);
  await mkdir(stepDir, { recursive: true });
  await writeFile(
    path.join(stepDir, "10.product-architecture.srs.md"),
    [
      "# Product Architecture (step)",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Document Type | scope_srs |",
      "| Scope | ARCH |",
      "| Scope Name | Product Architecture |",
      "",
      "## 4. Requirements",
      "",
      archBlock("Step requirement")
    ].join("\n"),
    "utf8"
  );
  return resolveProjectRoot(dir);
}

describe("FR-NODE-033 — Origin-aware record loading for mutation routing", () => {
  // AC-1: loadRecord with no origin returns the body record for an id present in both body and step.
  it("FR-NODE-033 AC-1: loadRecord with no origin returns the body record when id is in both body and step", async () => {
    const root = await workspaceWithBodyAndStep();

    // Precondition: the id genuinely exists in both partitions.
    const workspace = await parseWorkspace(root);
    expect(workspace.records.some((r) => r.id === "FR-ARCH-001")).toBe(true);
    expect((workspace.stepRecords ?? []).some((r) => r.id === "FR-ARCH-001")).toBe(true);

    const loaded = await loadRecordOriginAware(root, "FR-ARCH-001");
    expect(loaded).toBeTruthy();
    expect(loaded?.record.origin === "step").toBe(false);
    expect(loaded?.record.title).toBe("Fixture requirement");
    expect(posix(loaded?.record.filePath ?? "")).not.toContain("/docs/spec/steps/");
  });

  // AC-2: loadRecord with origin=step and a stepName returns the matching step record.
  it("FR-NODE-033 AC-2: loadRecord with origin=step and a stepName returns the matching step record", async () => {
    const root = await workspaceWithBodyAndStep();

    const loaded = await loadRecordOriginAware(root, "FR-ARCH-001", "step", STEP_NAME);
    expect(loaded).toBeTruthy();
    expect(loaded?.record.origin).toBe("step");
    expect(loaded?.record.stepName).toBe(STEP_NAME);
    expect(loaded?.record.title).toBe("Step requirement");
    expect(posix(loaded?.record.filePath ?? "")).toContain(`/docs/spec/steps/${STEP_NAME}/`);
  });

  // AC-3: Existing callers that pass no origin/stepName resolve body records identically to current behavior.
  it("FR-NODE-033 AC-3: existing no-arg callers resolve the body record identically to parseWorkspace", async () => {
    const root = await workspaceWithBodyAndStep();
    const workspace = await parseWorkspace(root);
    const expectedBody = workspace.records.find((r) => r.id === "FR-ARCH-001");
    expect(expectedBody).toBeTruthy();

    const viaLoadRecord = await loadRecord(root, "FR-ARCH-001");
    expect(viaLoadRecord?.record.filePath).toBe(expectedBody?.filePath);
    expect(viaLoadRecord?.record.title).toBe(expectedBody?.title);
    expect(viaLoadRecord?.record.origin === "step").toBe(false);

    const viaWorkspace = await loadRecordWithWorkspaceOriginAware(root, "FR-ARCH-001");
    expect(viaWorkspace?.record.filePath).toBe(expectedBody?.filePath);
    expect(viaWorkspace?.record.title).toBe(expectedBody?.title);
    expect(viaWorkspace?.record.origin === "step").toBe(false);
  });
});
