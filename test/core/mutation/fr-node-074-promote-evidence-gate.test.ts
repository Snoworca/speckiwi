import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promoteStepRequirement } from "../../../src/core/mutation/add-requirement.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// FR-NODE-074 — promote_step_requirement requires verification evidence in tdd
// mode. RED suite (one case per AC). AC-1 and AC-3 fail while the promote path
// ignores the persisted work-mode and the evidence table — a tdd-mode promote
// of an evidence-less block currently succeeds silently — until the gate lands.
//
// Contract under test (docs/spec/50.nodejs-implementation.srs.md FR-NODE-074):
//   - AC-1: tdd + zero evidence → EVIDENCE_REQUIRED, nothing written.
//   - AC-2: tdd + at least one evidence entry → promotes as today.
//   - AC-3: non-tdd + zero evidence → promotes with an advisory warning naming
//           the requirement id.
//   - AC-4: existing promote guards unchanged.

const SPEC_DIR = path.join("docs", "spec");

function renderReqBlock(options: { id: string; title: string; evidenceRows?: string[] }): string {
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
    ...(options.evidenceRows ?? []),
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
    "| 2026-07-16 | Created | Fixture |"
  ].join("\n");
}

async function writeStepScopeFile(
  rootPath: string,
  stepName: string,
  block: Parameters<typeof renderReqBlock>[0]
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
    renderReqBlock(block)
  ].join("\n");
  await writeFile(path.join(stepDir, "10.product-architecture.srs.md"), content, "utf8");
}

async function writeStateMd(rootPath: string, options: { mode: string; activeTask?: string }): Promise<void> {
  const stepsDir = path.join(rootPath, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const lines = [
    "# Step State",
    "",
    `Mode: ${options.mode}`,
    ...(options.activeTask !== undefined ? [`Active Task: ${options.activeTask}`] : []),
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| step-a | active | - | ARCH | - | 2026-06-01 | 2026-06-02 |",
    ""
  ];
  await writeFile(path.join(stepsDir, "state.md"), lines.join("\n"), "utf8");
}

async function bodyRecordById(rootPath: string, id: string) {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  return workspace.records.find((record) => record.id === id);
}

const EVIDENCE_ROW = "| E-1 | test | test/core/mutation/fr-node-074-promote-evidence-gate.test.ts | AC-1 | red-green |";

describe("FR-NODE-074 promote_step_requirement requires verification evidence in tdd mode", () => {
  it("FR-NODE-074 AC-1: refuses a tdd-mode promote of an evidence-less block with EVIDENCE_REQUIRED", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "tdd", activeTask: "feature-x" });
    await writeStepScopeFile(rootPath, "feature-x", { id: "FR-ARCH-511", title: "Evidence-less step requirement" });
    const root = await resolveProjectRoot(rootPath);

    const result = await promoteStepRequirement(root, { id: "FR-ARCH-511", fromStep: "feature-x", toScope: "ARCH" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EVIDENCE_REQUIRED");
    }
    // Nothing was written to the body scope.
    expect(await bodyRecordById(rootPath, "FR-ARCH-511")).toBeUndefined();
  });

  it("FR-NODE-074 AC-2: promotes a tdd-mode block carrying at least one evidence entry", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "tdd", activeTask: "feature-x" });
    await writeStepScopeFile(rootPath, "feature-x", {
      id: "FR-ARCH-512",
      title: "Evidenced step requirement",
      evidenceRows: [EVIDENCE_ROW]
    });
    const root = await resolveProjectRoot(rootPath);

    const result = await promoteStepRequirement(root, { id: "FR-ARCH-512", fromStep: "feature-x", toScope: "ARCH" });

    expect(result.ok).toBe(true);
    expect((await bodyRecordById(rootPath, "FR-ARCH-512"))?.id).toBe("FR-ARCH-512");
  });

  it("FR-NODE-074 AC-3: a non-tdd promote of an evidence-less block succeeds with an advisory warning", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "wait" });
    await writeStepScopeFile(rootPath, "feature-x", { id: "FR-ARCH-513", title: "Legacy evidence-less promote" });
    const root = await resolveProjectRoot(rootPath);

    const result = await promoteStepRequirement(root, { id: "FR-ARCH-513", fromStep: "feature-x", toScope: "ARCH" });

    expect(result.ok).toBe(true);
    expect((await bodyRecordById(rootPath, "FR-ARCH-513"))?.id).toBe("FR-ARCH-513");
    const warning = result.diagnostics.find(
      (item) => item.severity === "warning" && item.message.includes("FR-ARCH-513")
    );
    expect(warning).toBeDefined();
  });

  it("FR-NODE-074 AC-4: existing promote guards stay unchanged (unknown scope still denied)", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    await writeStateMd(rootPath, { mode: "tdd", activeTask: "feature-x" });
    await writeStepScopeFile(rootPath, "feature-x", {
      id: "FR-ARCH-514",
      title: "Unknown scope target",
      evidenceRows: [EVIDENCE_ROW]
    });
    const root = await resolveProjectRoot(rootPath);

    const result = await promoteStepRequirement(root, { id: "FR-ARCH-514", fromStep: "feature-x", toScope: "NOPE" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MUTATION_DENIED");
    }
  });
});
