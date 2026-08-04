import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promoteStepRequirement } from "../../../src/core/mutation/add-requirement.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";

// @req FR-NODE-174 AC-7 — the gate cannot be walked around.
//
// A verifier probed the third writer of a body Status row and got through it: promote_step_requirement
// copies the step block into the scope file verbatim, so a block already reading `| Status | verified |`
// lands verified with no reference resolution at all. Measured on the probe, the promoted row carried
// `C:/Users/nobody/.claude/skills/kiwi-x/SKILL.md` — the exact class the requirement exists to refuse —
// and granular edits are refused afterwards, so it could not be repaired.

const SPEC_DIR = path.join("docs", "spec");
const STEP = "step-a";
const REQ_ID = "FR-ARCH-900";
const OUTSIDE = "C:/Users/nobody/.claude/skills/kiwi-x/SKILL.md";
/** Exists in the `valid-basic` fixture. */
const RESOLVABLE = "docs/spec/90.appendix.md";

function stepBlock(reference: string): string {
  return [
    `### ${REQ_ID} — Promoted straight to verified`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    "| Status | verified |",
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
    "Step-scoped requirement promoted at verified.",
    "",
    "#### Rationale",
    "",
    "- -",
    "",
    "#### Acceptance Criteria",
    "",
    "- [x] AC-1: Step criterion.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    `| VE-1 | inspection | ${reference} | AC-1 | measured |`,
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
    "| 2026-08-04 | Created | Fixture |"
  ].join("\n");
}

async function stepWorkspace(reference: string): Promise<Awaited<ReturnType<typeof resolveProjectRoot>>> {
  const rootPath = await copyFixtureWorkspace("valid-basic");
  const stepDir = path.join(rootPath, SPEC_DIR, "steps", STEP);
  await mkdir(stepDir, { recursive: true });
  await writeFile(
    path.join(stepDir, "10.product-architecture.srs.md"),
    [
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
      stepBlock(reference)
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(rootPath, SPEC_DIR, "steps", "state.md"),
    [
      "# Step State",
      "",
      "Mode: sdd",
      "",
      "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      `| ${STEP} | active | - | ARCH | - | 2026-08-01 | 2026-08-04 |`,
      ""
    ].join("\n"),
    "utf8"
  );
  return resolveProjectRoot(rootPath);
}

describe("FR-NODE-174 AC-7 — promotion is the third writer of a Status row and is guarded too", () => {
  it("refuses to promote a step block that is already verified on an unresolvable reference", async () => {
    const projectRoot = await stepWorkspace(OUTSIDE);

    const result = await promoteStepRequirement(projectRoot, { id: REQ_ID, fromStep: STEP, toScope: "ARCH" });

    expect(result.ok, "a verified row was minted in the body pointing outside the checkout").toBe(false);

    const workspace = await parseWorkspace(projectRoot);
    expect(workspace.records.find((record) => record.id === REQ_ID), "the block landed despite the refusal").toBeUndefined();
  });

  it("promotes a verified step block whose reference resolves", async () => {
    const projectRoot = await stepWorkspace(RESOLVABLE);

    const result = await promoteStepRequirement(projectRoot, { id: REQ_ID, fromStep: STEP, toScope: "ARCH" });

    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    const workspace = await parseWorkspace(projectRoot);
    expect(workspace.records.find((record) => record.id === REQ_ID)?.status).toBe("verified");
  });
});
