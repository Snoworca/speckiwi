import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { copyFixtureWorkspace } from "../../fixtures/fixture-utils.js";
// The green task (T-PH003-22) introduces a new export `claimStep` in
// src/core/mutation/claim-step.ts. Importing the not-yet-existing module makes
// the whole suite red until the green task implements it.
import { claimStep } from "../../../src/core/mutation/claim-step.js";

// FR-NODE-027 — claim_step mutation with write-skew two-stage gate.
//
// Red-phase suite (T-PH003-21): one test case per acceptance criterion
// (AC-1..AC-5). These cases describe the future contract of claimStep before
// src/core/mutation/claim-step.ts exports it, so the whole suite fails
// (missing module/export) until the green task (T-PH003-22) implements it.
//
// Contract under test (from the requirement body and AC):
//   claimStep(root, { step, touchesScope, touchesReq, force?, supersede? })
//   declares TouchesScope/TouchesReq and appends a docs/spec/steps/state.md
//   row, enforcing a two-stage gate:
//     - AC-1: appends a state.md row with the declared TouchesScope/TouchesReq.
//     - AC-2: a TouchesReq that directly intersects an active step's TouchesReq
//             is a HARD-BLOCK STEP_DIRECT_CONFLICT and cannot be forced.
//     - AC-3: a transitive-only intersection (via the depends_on closure) is a
//             SOFT-BLOCK STEP_OVERLAP; force pins an overlaps marker.
//     - AC-4: a claim against a verified/frozen supersede target yields
//             STEP_SUPERSEDE_PROTECTED.
//     - AC-5: when the closure is unavailable the gate degrades to a 1-hop
//             direct hard-block with transitive treated as advisory.

const SPEC_DIR = path.join("docs", "spec");
const STATE_MD_REL = path.join(SPEC_DIR, "steps", "state.md");

/**
 * Renders a minimal requirement block compatible with the SRS parser. Only the
 * fields exercised by the claim_step gate (id, Stability, Status, and a
 * depends_on Trace Link) carry meaning; the rest are sensible parseable
 * defaults.
 */
function renderReqBlock(options: {
  id: string;
  title: string;
  status?: string;
  stability?: string;
  dependsOn?: string[];
}): string {
  const status = options.status ?? "planned";
  const stability = options.stability ?? "evolving";
  const traceRows = (options.dependsOn ?? []).map(
    (ref) => `| Requirement | ${ref} | depends_on | - |`
  );
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
    ...traceRows,
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
 * Appends one or more requirement blocks (with explicit depends_on topology and
 * stability) to the ARCH scope file of a fixture workspace so the claim_step
 * gate has a closure graph and supersede targets to reason about.
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

/**
 * Writes a docs/spec/steps/state.md table seeded with the supplied active steps.
 * Columns match the FR-PARSE-023 layout
 * (Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated).
 */
async function writeStateMd(
  root: string,
  rows: Array<{
    step: string;
    status?: string;
    dependsOn?: string;
    touchesScope: string;
    touchesReq: string;
  }>
): Promise<void> {
  const stepsDir = path.join(root, SPEC_DIR, "steps");
  await mkdir(stepsDir, { recursive: true });
  const rendered = rows.map(
    (r) =>
      `| ${r.step} | ${r.status ?? "active"} | ${r.dependsOn ?? "-"} | ${r.touchesScope} | ${r.touchesReq} | 2026-06-01 | 2026-06-02 |`
  );
  const content = [
    "# Step State",
    "",
    "Mode: sdd",
    "",
    "| Step | Status | DependsOn | TouchesScope | TouchesReq | Created | Updated |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rendered,
    ""
  ].join("\n");
  await writeFile(path.join(stepsDir, "state.md"), content, "utf8");
}

async function readStateMd(root: string): Promise<string> {
  return readFile(path.join(root, STATE_MD_REL), "utf8");
}

describe("FR-NODE-027 AC-1 — claim_step appends a state.md row with declared TouchesScope/TouchesReq", () => {
  it("appends a row carrying the declared TouchesScope and TouchesReq to state.md", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(root, [{ id: "FR-ARCH-010", title: "Claim target" }]);
    // No active steps yet: the claim is unconflicted and must succeed.
    await writeStateMd(root, []);

    const result = await claimStep(await resolveProjectRoot(root), {
      step: "feature-x",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-010"]
    });

    expect(result.ok).toBe(true);
    const after = await readStateMd(root);
    // A new step row appears with the declared TouchesScope and TouchesReq.
    expect(after).toContain("feature-x");
    expect(after).toContain("ARCH");
    expect(after).toContain("FR-ARCH-010");
    // The new row is parseable as a state.md table row (pipe-delimited).
    expect(after).toMatch(/\|\s*feature-x\s*\|.*\|\s*ARCH\s*\|\s*FR-ARCH-010\s*\|/);
  });
});

describe("FR-NODE-027 AC-2 — direct same-REQ intersection is a HARD-BLOCK STEP_DIRECT_CONFLICT that cannot be forced", () => {
  it("hard-blocks a claim whose TouchesReq directly intersects an active step, even with force", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(root, [{ id: "FR-ARCH-010", title: "Shared target" }]);
    // An active step already touches FR-ARCH-010.
    await writeStateMd(root, [
      { step: "incumbent", touchesScope: "ARCH", touchesReq: "FR-ARCH-010" }
    ]);
    const projectRoot = await resolveProjectRoot(root);
    const before = await readStateMd(root);

    // Without force: direct intersection hard-blocks.
    const blocked = await claimStep(projectRoot, {
      step: "challenger",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-010"]
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("STEP_DIRECT_CONFLICT");

    // With force: a direct conflict still cannot be forced (HARD-BLOCK).
    const forced = await claimStep(projectRoot, {
      step: "challenger",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-010"],
      force: true
    });
    expect(forced.ok).toBe(false);
    expect(forced.error?.code).toBe("STEP_DIRECT_CONFLICT");

    // No challenger row was written by either attempt.
    const after = await readStateMd(root);
    expect(after).toBe(before);
    expect(after).not.toContain("challenger");
  });
});

describe("FR-NODE-027 AC-3 — transitive-only intersection is a SOFT-BLOCK STEP_OVERLAP and force pins an overlaps marker", () => {
  it("soft-blocks a transitive-only intersection and force pins an overlaps marker", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    // Closure topology: FR-ARCH-020 depends_on FR-ARCH-021. The incumbent step
    // touches FR-ARCH-021; the claim touches FR-ARCH-020, so they do NOT share a
    // REQ directly but intersect transitively through the depends_on closure.
    await appendReqBlocks(root, [
      { id: "FR-ARCH-020", title: "Claimant target", dependsOn: ["FR-ARCH-021"] },
      { id: "FR-ARCH-021", title: "Closure neighbor" }
    ]);
    await writeStateMd(root, [
      { step: "incumbent", touchesScope: "ARCH", touchesReq: "FR-ARCH-021" }
    ]);
    const projectRoot = await resolveProjectRoot(root);

    // Without force: transitive overlap soft-blocks.
    const blocked = await claimStep(projectRoot, {
      step: "claimant",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-020"]
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("STEP_OVERLAP");

    // With force: the claim proceeds and pins an overlaps marker recording the
    // transitive overlap with the incumbent.
    const forced = await claimStep(projectRoot, {
      step: "claimant",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-020"],
      force: true
    });
    expect(forced.ok).toBe(true);
    const after = await readStateMd(root);
    expect(after).toContain("claimant");
    // An overlaps marker is pinned referencing the overlapping incumbent step.
    expect(after.toLowerCase()).toContain("overlap");
    expect(after).toContain("incumbent");
  });
});

describe("FR-NODE-027 AC-4 — claim against a verified OR frozen supersede target yields STEP_SUPERSEDE_PROTECTED", () => {
  // The protection condition is `verified OR frozen`. Seeding a target that is
  // BOTH would let a buggy `verified AND frozen` implementation pass too, so each
  // disjunct is exercised independently, plus a non-protected target that must be
  // allowed to supersede.
  it("blocks a claim whose supersede target is verified (but NOT frozen)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(root, [
      { id: "FR-ARCH-030", title: "Verified supersede target", status: "verified", stability: "evolving" }
    ]);
    await writeStateMd(root, []);
    const projectRoot = await resolveProjectRoot(root);
    const before = await readStateMd(root);

    const result = await claimStep(projectRoot, {
      step: "superseder",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-030"],
      supersede: "FR-ARCH-030"
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("STEP_SUPERSEDE_PROTECTED");
    // The protected claim writes nothing.
    const after = await readStateMd(root);
    expect(after).toBe(before);
    expect(after).not.toContain("superseder");
  });

  it("blocks a claim whose supersede target is frozen (but NOT verified)", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(root, [
      { id: "FR-ARCH-031", title: "Frozen supersede target", status: "planned", stability: "frozen" }
    ]);
    await writeStateMd(root, []);
    const projectRoot = await resolveProjectRoot(root);
    const before = await readStateMd(root);

    const result = await claimStep(projectRoot, {
      step: "superseder",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-031"],
      supersede: "FR-ARCH-031"
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("STEP_SUPERSEDE_PROTECTED");
    const after = await readStateMd(root);
    expect(after).toBe(before);
    expect(after).not.toContain("superseder");
  });

  it("allows a claim whose supersede target is neither verified nor frozen", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(root, [
      { id: "FR-ARCH-032", title: "Non-protected supersede target", status: "planned", stability: "evolving" }
    ]);
    await writeStateMd(root, []);
    const projectRoot = await resolveProjectRoot(root);

    const result = await claimStep(projectRoot, {
      step: "superseder",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-032"],
      supersede: "FR-ARCH-032"
    });

    expect(result.ok).toBe(true);
    const after = await readStateMd(root);
    expect(after).toContain("superseder");
  });
});

describe("FR-NODE-027 AC-5 — when closure is unavailable the gate degrades to 1-hop direct hard-block with transitive advisory", () => {
  it("hard-blocks a direct conflict but only advises on a transitive one when closure is unavailable", async () => {
    const root = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(root, [
      { id: "FR-ARCH-040", title: "Claimant target", dependsOn: ["FR-ARCH-041"] },
      { id: "FR-ARCH-041", title: "Closure neighbor" }
    ]);
    await writeStateMd(root, [
      { step: "incumbent", touchesScope: "ARCH", touchesReq: "FR-ARCH-041" }
    ]);
    const projectRoot = await resolveProjectRoot(root);

    // Closure unavailable: a transitive-only intersection degrades to advisory,
    // so the claim is NOT soft-blocked — it proceeds (transitive is advisory).
    const transitive = await claimStep(projectRoot, {
      step: "claimant",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-040"],
      closureUnavailable: true
    });
    expect(transitive.ok).toBe(true);
    expect(transitive.error?.code).not.toBe("STEP_OVERLAP");
    const afterTransitive = await readStateMd(root);
    expect(afterTransitive).toContain("claimant");

    // Closure unavailable: a 1-hop DIRECT conflict still hard-blocks.
    const directRoot = await copyFixtureWorkspace("valid-basic");
    await appendReqBlocks(directRoot, [{ id: "FR-ARCH-040", title: "Shared target" }]);
    await writeStateMd(directRoot, [
      { step: "incumbent", touchesScope: "ARCH", touchesReq: "FR-ARCH-040" }
    ]);
    const directResult = await claimStep(await resolveProjectRoot(directRoot), {
      step: "challenger",
      touchesScope: "ARCH",
      touchesReq: ["FR-ARCH-040"],
      closureUnavailable: true
    });
    expect(directResult.ok).toBe(false);
    expect(directResult.error?.code).toBe("STEP_DIRECT_CONFLICT");
  });
});
