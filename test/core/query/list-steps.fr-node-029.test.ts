import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
// The green task (T-PH003-26) introduces a new export `listSteps` in
// src/core/query/list-steps.ts. Importing the not-yet-existing module makes the
// whole suite red until the green task implements it.
import { listSteps } from "../../../src/core/query/list-steps.js";

// FR-NODE-029 — list_steps topological ordering with cycle detection and advisories.
//
// Red-phase suite (T-PH003-25): one test case per acceptance criterion
// (AC-1..AC-3). These cases describe the future contract of listSteps before
// src/core/query/list-steps.ts exports it, so the whole suite fails (missing
// module/export) until the green task (T-PH003-26) implements it.
//
// Contract under test (from the requirement body and AC, SRS
// docs/spec/50.nodejs-implementation.srs.md FR-NODE-029):
//
//   listSteps(root: ProjectRoot, options?: { target?: string }):
//     Promise<{ steps: StepListEntry[]; advisories: StepAdvisory[]; cycle: boolean }>
//
//   where the handler fresh-parses docs/spec/steps/state.md (FR-PARSE-023 row
//   columns Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated)
//   and:
//     - AC-1: returns `steps` in a valid Kahn topological order honoring the
//             DependsOn edges (a step depending on another is ordered AFTER it).
//     - AC-2: when DependsOn forms a dependency cycle, sets `cycle` true and emits
//             a STEP_CYCLE advisory rather than silently producing a partial order.
//     - AC-3: emits STEP_SUPERSEDE_PROTECTED (a step superseding a verified/frozen
//             requirement), an orphan advisory (a DependsOn edge pointing at a
//             non-existent step), and a STEP_DRIFT advisory where applicable.
//
//   Each StepListEntry exposes at least { step: string }; each StepAdvisory
//   exposes at least { code: string; step?: string; message?: string }. The
//   STEP_* advisory codes are the advisory-only namespace from
//   src/core/diagnostic-registry.ts STEP_DIAGNOSTIC_CODES.

const SPEC_DIR = path.join("docs", "spec");

/**
 * Renders a minimal requirement block compatible with the SRS parser. Only the
 * fields exercised by the advisory gate (id, Status, Stability) carry meaning;
 * the rest are sensible parseable defaults.
 */
function renderReqBlock(options: {
  id: string;
  title: string;
  status?: string;
  stability?: string;
}): string {
  const status = options.status ?? "planned";
  const stability = options.stability ?? "evolving";
  return [
    `### ${options.id} — ${options.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v1.0.0 |",
    `| Status | ${status} |`,
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    `| Stability | ${stability} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Fixture requirement ${options.id}.`,
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
 * Appends one or more requirement blocks to the ARCH scope file of a fixture
 * workspace so the supersede-protected advisory has verified/frozen targets to
 * reason about.
 */
async function appendReqBlocks(
  root: string,
  blocks: Array<Parameters<typeof renderReqBlock>[0]>
): Promise<void> {
  const archFile = path.join(root, SPEC_DIR, "10.product-architecture.srs.md");
  const existing = await readFile(archFile, "utf8");
  const rendered = blocks.map((b) => renderReqBlock(b)).join("\n\n");
  await writeFile(archFile, `${existing}\n\n${rendered}\n`, "utf8");
}

interface StateRow {
  step: string;
  status?: string;
  dependsOn?: string;
  touchesScope?: string;
  touchesReq?: string;
  /** Optional supersede target rendered as a trailing marker comment line. */
  supersede?: string;
}

/**
 * Writes a docs/spec/steps/state.md table seeded with the supplied steps.
 * Columns match the FR-PARSE-023 layout
 * (Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated). When a
 * row declares a supersede target, a marker comment is appended below the table
 * so the supersede-protected advisory can discover it.
 */
async function writeStateMd(root: string, rows: StateRow[]): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const tableRows = rows.map(
    (r) =>
      `| ${r.step} | ${r.status ?? "active"} | ${r.dependsOn ?? "-"} | ${r.touchesScope ?? "ARCH"} | ${
        r.touchesReq ?? "-"
      } | 2026-06-01 | 2026-06-02 |`
  );
  const supersedeMarkers = rows
    .filter((r) => r.supersede !== undefined && r.supersede !== "")
    .map((r) => `<!-- supersede: ${r.step} -> ${r.supersede} -->`);
  const content = [
    "# Step State",
    "",
    "Mode: sdd",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...tableRows,
    "",
    ...supersedeMarkers,
    ""
  ].join("\n");
  await writeFile(path.join(stepsDir, "state.md"), content, "utf8");
}

/** Returns the 0-based position of a step name in an ordered step list. */
function orderIndex(steps: ReadonlyArray<{ step: string }>, name: string): number {
  return steps.findIndex((entry) => entry.step === name);
}

/**
 * Writes a step-origin requirement block under docs/spec/steps/<stepName>/ so the workspace
 * parser flattens it into stepRecords (origin=step). Used to seed a same-id step copy that
 * could shadow a protected body requirement of the same id.
 */
async function writeStepReqBlock(
  root: string,
  stepName: string,
  block: Parameters<typeof renderReqBlock>[0]
): Promise<void> {
  const dir = path.join(root, SPEC_DIR, "steps", stepName);
  await mkdir(dir, { recursive: true });
  // The block-scanner only recognizes requirement blocks inside a `## ...Requirements`
  // section, so wrap the block in a minimal one (mirrors a real scope/step file layout).
  const content = ["# Step Scope", "", "## Requirements", "", renderReqBlock(block), ""].join("\n");
  await writeFile(path.join(dir, `${block.id}.srs.md`), content, "utf8");
}

describe("FR-NODE-029 AC-1 — list_steps returns steps in valid topological order honoring DependsOn", () => {
  it("FR-NODE-029 AC-1: orders dependent steps after the steps they depend on", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // Topology: c depends_on b; b depends_on a. A valid Kahn order must place
    // a before b and b before c. The state.md row insertion order (c, a, b) is
    // deliberately NOT the topological order so a pass-through (insertion-order)
    // implementation cannot accidentally satisfy the assertion.
    await writeStateMd(root, [
      { step: "c", dependsOn: "b" },
      { step: "a", dependsOn: "-" },
      { step: "b", dependsOn: "a" }
    ]);

    const result = await listSteps(await resolveProjectRoot(root));

    expect(result.cycle).toBe(false);
    const a = orderIndex(result.steps, "a");
    const b = orderIndex(result.steps, "b");
    const c = orderIndex(result.steps, "c");
    // All three steps are present.
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(c).toBeGreaterThanOrEqual(0);
    // DependsOn edges are honored: dependency precedes dependent.
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe("FR-NODE-029 AC-2 — list_steps detects a dependency cycle and reports STEP_CYCLE", () => {
  it("FR-NODE-029 AC-2: flags a DependsOn cycle as STEP_CYCLE instead of a silent partial order", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // Cycle: x depends_on y and y depends_on x. No valid total order exists.
    await writeStateMd(root, [
      { step: "x", dependsOn: "y" },
      { step: "y", dependsOn: "x" }
    ]);

    const result = await listSteps(await resolveProjectRoot(root));

    // The cycle must be surfaced rather than silently producing a partial order.
    expect(result.cycle).toBe(true);
    const codes = result.advisories.map((advisory) => advisory.code);
    expect(codes).toContain("STEP_CYCLE");
  });
});

describe("FR-NODE-029 AC-3 — list_steps emits STEP_SUPERSEDE_PROTECTED, orphan, and drift advisories", () => {
  it("FR-NODE-029 AC-3: emits a supersede-protected, an orphan, and a drift advisory where applicable", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // A verified requirement is a protected supersede target.
    await appendReqBlocks(root, [
      { id: "FR-ARCH-050", title: "Verified supersede target", status: "verified", stability: "evolving" }
    ]);
    await writeStateMd(root, [
      // protected: supersedes a verified requirement → STEP_SUPERSEDE_PROTECTED.
      { step: "protected", supersede: "FR-ARCH-050", touchesReq: "FR-ARCH-050" },
      // orphan: DependsOn points at a step name that does not exist in state.md.
      { step: "dangling", dependsOn: "ghost-step" },
      // drift: a merged step whose touched requirements have moved on → STEP_DRIFT.
      { step: "stale", status: "merged", touchesReq: "FR-ARCH-050" }
    ]);

    const result = await listSteps(await resolveProjectRoot(root));

    const codes = result.advisories.map((advisory) => advisory.code);
    // Documented advisory codes are emitted verbatim.
    expect(codes).toContain("STEP_SUPERSEDE_PROTECTED");
    expect(codes).toContain("STEP_DRIFT");
    // The orphan advisory references the dangling DependsOn edge. It is emitted under the
    // registered STEP_ORPHAN code (advisory-only STEP_DIAGNOSTIC_CODES namespace) and must
    // point at the dangling step / missing dependency.
    expect(codes).toContain("STEP_ORPHAN");
    const orphanAdvisory = result.advisories.find((advisory) => advisory.code === "STEP_ORPHAN");
    expect(orphanAdvisory).toBeDefined();
    expect(`${orphanAdvisory?.step ?? ""} ${orphanAdvisory?.message ?? ""}`).toMatch(/dangling|ghost-step/);
  });

  it("FR-NODE-029 AC-3: a same-id unprotected step copy does not shadow a protected body requirement", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // Body requirement FR-ARCH-050 is verified → protected.
    await appendReqBlocks(root, [
      { id: "FR-ARCH-050", title: "Verified body target", status: "verified", stability: "evolving" }
    ]);
    // A same-id step-origin copy is UNPROTECTED (planned/evolving). If protection is judged
    // from the last-wins merged record map, this step copy shadows the verified body record and
    // the supersede-protected advisory is wrongly suppressed.
    await writeStepReqBlock(root, "shadowstep", {
      id: "FR-ARCH-050",
      title: "Unprotected step copy",
      status: "planned",
      stability: "evolving"
    });
    await writeStateMd(root, [
      { step: "guardstep", supersede: "FR-ARCH-050", touchesReq: "FR-ARCH-050" }
    ]);

    const result = await listSteps(await resolveProjectRoot(root));

    // Protection is judged from the body record, so the advisory is still emitted.
    const codes = result.advisories.map((advisory) => advisory.code);
    expect(codes).toContain("STEP_SUPERSEDE_PROTECTED");
  });
});
