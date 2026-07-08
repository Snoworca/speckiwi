import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
// The green task (T-PH003-30) introduces a new export `promoteStepRequirement`
// in src/core/mutation/add-requirement.ts. Importing the not-yet-existing export
// makes the whole suite red (missing export) until the green task implements it.
import { promoteStepRequirement } from "../../../src/core/mutation/add-requirement.js";

// FR-NODE-031 — promote_step_requirement mutation with reservation uniqueness
// verbatim insert.
//
// Red-phase suite (T-PH003-29): one test case per acceptance criterion
// (AC-1..AC-3). These cases describe the future contract of
// promoteStepRequirement before src/core/mutation/add-requirement.ts exports it,
// so the whole suite fails (missing export) until the green task (T-PH003-30)
// implements it.
//
// Contract under test (from the requirement body and AC):
//   promoteStepRequirement(root, { id, fromStep, toScope, dryRun? })
//   inserts a step's pre-minted canonical requirement id verbatim into the
//   target body scope after verifying global uniqueness against a reservation
//   view (HEAD body + step + reserved), preserving the step's id rather than
//   auto-generating one:
//     - AC-1: inserts the step requirement into toScope using the step's
//             existing id verbatim.
//     - AC-2: rejects the insert when the id already exists in the reservation
//             view (here, an id colliding with an existing body requirement).
//     - AC-3: does not auto-generate or alter the requirement id (the inserted
//             id equals the step's original id, not a freshly minted next id).

const SPEC_DIR = path.join("docs", "spec");
const ARCH_BODY_FILE = path.join(SPEC_DIR, "10.product-architecture.srs.md");

/**
 * Renders a minimal valid ARCH-scope requirement block (body block shape) so it
 * can be staged inside a step scope file. Only `id` and `title` carry test
 * meaning; the rest are parseable canonical defaults.
 */
function renderReqBlock(options: { id: string; title: string }): string {
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

/**
 * Writes an ARCH-scope step file under docs/spec/steps/<stepName>/ containing one
 * requirement block. The step requirement carries the pre-minted canonical id
 * that promote_step_requirement is expected to insert verbatim into the body.
 */
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

/** Returns the parsed BODY requirement record for `id`, or undefined when absent. */
async function bodyRecordById(rootPath: string, id: string) {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  return workspace.records.find((record) => record.id === id);
}

describe("FR-NODE-031 AC-1 — promote_step_requirement inserts the step id verbatim into toScope", () => {
  it("FR-NODE-031 AC-1: inserts the step requirement into the body scope using its existing id verbatim", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    // A step requirement with a pre-minted canonical id that does NOT collide
    // with any body id, so the promote is allowed.
    const STEP_ID = "FR-ARCH-501";
    await writeStepScopeFile(rootPath, "feature-x", { id: STEP_ID, title: "Promotable step requirement" });
    const root = await resolveProjectRoot(rootPath);

    // Before promotion the id lives only in the step origin, not the body.
    expect(await bodyRecordById(rootPath, STEP_ID)).toBeUndefined();

    const result = await promoteStepRequirement(root, {
      id: STEP_ID,
      fromStep: "feature-x",
      toScope: "ARCH"
    });
    expect(result.ok).toBe(true);

    // The body scope now contains a requirement carrying the step's id verbatim.
    const promoted = await bodyRecordById(rootPath, STEP_ID);
    expect(promoted).toBeDefined();
    expect(promoted?.id).toBe(STEP_ID);
    expect(promoted?.origin ?? "body").toBe("body");

    // The id text appears verbatim in the body scope file on disk.
    const bodyText = await readFile(path.join(rootPath, ARCH_BODY_FILE), "utf8");
    expect(bodyText).toContain(`### ${STEP_ID} `);
  });
});

describe("FR-NODE-031 AC-2 — promote_step_requirement rejects an id that already exists in the reservation view", () => {
  it("FR-NODE-031 AC-2: denies the insert when the step id collides with an existing body requirement", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    // The fixture already contains body requirement FR-ARCH-001. Stage a step
    // requirement re-using that exact id so the reservation view (HEAD body +
    // step + reserved) reports a collision.
    const COLLIDING_ID = "FR-ARCH-001";
    await writeStepScopeFile(rootPath, "feature-x", { id: COLLIDING_ID, title: "Colliding step requirement" });
    const root = await resolveProjectRoot(rootPath);
    const before = await readFile(path.join(rootPath, ARCH_BODY_FILE), "utf8");

    const result = await promoteStepRequirement(root, {
      id: COLLIDING_ID,
      fromStep: "feature-x",
      toScope: "ARCH"
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }

    // The denied collision left the body scope document untouched: the single
    // FR-ARCH-001 heading is not duplicated.
    const after = await readFile(path.join(rootPath, ARCH_BODY_FILE), "utf8");
    expect(after).toBe(before);
    const headingCount = after.split(`### ${COLLIDING_ID} `).length - 1;
    expect(headingCount).toBe(1);
  });
});

describe("FR-NODE-031 AC-3 — promote_step_requirement does not auto-generate or alter the requirement id", () => {
  it("FR-NODE-031 AC-3: preserves the step id rather than minting the next sequential body id", async () => {
    const rootPath = await copyFixtureWorkspace("valid-basic");
    // A non-sequential pre-minted id. If the mutation auto-generated an id it
    // would derive the next ARCH slot (e.g. FR-ARCH-002) instead of preserving
    // this exact value.
    const STEP_ID = "FR-ARCH-777";
    const AUTO_GENERATED_NEXT_ID = "FR-ARCH-002";
    await writeStepScopeFile(rootPath, "feature-x", { id: STEP_ID, title: "Verbatim-preserved step requirement" });
    const root = await resolveProjectRoot(rootPath);

    const result = await promoteStepRequirement(root, {
      id: STEP_ID,
      fromStep: "feature-x",
      toScope: "ARCH"
    });
    expect(result.ok).toBe(true);
    // The returned requirement id equals the step's original id, unaltered.
    if (result.ok === true) {
      expect((result.value as { requirementId: string }).requirementId).toBe(STEP_ID);
    }

    // The promoted body requirement keeps the verbatim id; no auto-generated id
    // was minted in its place.
    expect(await bodyRecordById(rootPath, STEP_ID)).toBeDefined();
    expect(await bodyRecordById(rootPath, AUTO_GENERATED_NEXT_ID)).toBeUndefined();
  });
});
