import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { validateWorkspace } from "../../../src/core/validator/validate-workspace.js";
import { compareReqId, computeSemanticSha } from "../../../src/core/mutation/records.js";
import type { RequirementStatus, Stability } from "../../../src/core/types.js";
// The green task (T-PH003-12) introduces src/core/mutation/add-compatibility-check.ts.
// Importing the not-yet-existing module makes the whole suite red until then.
import { addCompatibilityCheck } from "../../../src/core/mutation/add-compatibility-check.js";

// FR-NODE-038 — add_compatibility_check mutation with dedup, frozen, and liveness
// guards plus bidirectional semanticSha pins.
//
// Red-phase suite (T-PH003-11): one test case per acceptance criterion
// (AC-1..AC-5). These cases describe the future contract of
// add_compatibility_check before src/core/mutation/add-compatibility-check.ts
// exists, so the whole suite fails (missing module/export) until the green task
// (T-PH003-12) implements addCompatibilityCheck.
//
// Contract under test (from the requirement body and AC):
//   add_compatibility_check(aReqId, bReqId) inserts a single checked_compatible
//   Trace Links row on the compareReqId-minimum REQ-ID block. The row carries the
//   peer (max-side) REQ-ID as its bare live Reference and encodes the current
//   self and peer semanticSha pins (computeSemanticSha). It is guarded by:
//     - dedup: one row per min-max pair (a second call is rejected),
//     - frozen-block protection (rejected on a frozen min-side block),
//     - endpoint liveness (rejected when either endpoint is discarded,
//       deprecated, or non-existent),
//   and the written Reference is a bare live REQ-ID that passes SRS-E012 and the
//   addTraceLink Requirement-existence guard.

const SCOPE_FILE = path.join("docs", "spec", "50.nodejs-implementation.srs.md");
const BARE_REQ_ID = /^[A-Z]+-[A-Z]+-\d+$/;
const COMPATIBLE_RELATION = "checked_compatible";

/** Renders a single NODE-scope requirement block in the canonical SRS layout. */
function renderRequirementBlock(
  id: string,
  options: { status?: RequirementStatus; stability?: Stability; requirement?: string } = {}
): string {
  const status = options.status ?? "planned";
  const stability = options.stability ?? "evolving";
  const requirement = options.requirement ?? `Requirement statement for ${id}.`;
  return [
    `### ${id} — Requirement ${id}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Type | functional |",
    "| Target | v3.0.0 |",
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
    requirement,
    "",
    "#### Rationale",
    "",
    "-",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Generated criterion.",
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
    "Compatibility-check fixture.",
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
    "# SpecKiwi Compatibility Fixture Index",
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
    "Compatibility-check fixture index.",
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    "| Node.js Implementation | [50.nodejs-implementation.srs.md](./50.nodejs-implementation.srs.md) | NODE | Node |",
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
    "| Node.js Implementation | [50.nodejs-implementation.srs.md](./50.nodejs-implementation.srs.md) | NODE | Node |",
    "",
    "## 5. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    ""
  ].join("\n");
}

/**
 * Writes a self-contained NODE-scope workspace under a fresh temp directory and
 * returns its root path. `blocks` maps a REQ-ID to its desired state.
 */
async function buildWorkspace(
  blocks: Array<{ id: string; status?: RequirementStatus; stability?: Stability }>
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-022-"));
  const specDir = path.join(root, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndexDocument(), "utf8");
  await writeFile(
    path.join(specDir, SCOPE_FILE.split(path.sep).pop() as string),
    renderScopeDocument(blocks.map((block) => renderRequirementBlock(block.id, block))),
    "utf8"
  );
  return root;
}

/** Returns all checked_compatible trace rows in the workspace keyed by holder REQ-ID. */
async function compatibilityRows(rootPath: string): Promise<Array<{ holder: string; reference: string; notes: string }>> {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  const rows: Array<{ holder: string; reference: string; notes: string }> = [];
  for (const record of workspace.records) {
    for (const link of record.traceLinks) {
      if (link.relation === COMPATIBLE_RELATION) {
        rows.push({ holder: record.id, reference: link.reference, notes: link.notes });
      }
    }
  }
  return rows;
}

/** Computes the current semanticSha of a given REQ-ID in the workspace. */
async function currentSha(rootPath: string, id: string): Promise<string> {
  const root = await resolveProjectRoot(rootPath);
  const workspace = await parseWorkspace(root);
  const record = workspace.records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Requirement not found in fixture: ${id}`);
  return computeSemanticSha(record);
}

// The pair (FR-NODE-100, FR-NODE-200): FR-NODE-100 < FR-NODE-200 by raw byte order,
// so FR-NODE-100 is the compareReqId-minimum (self) and FR-NODE-200 is the peer.
const MIN_ID = "FR-NODE-100";
const MAX_ID = "FR-NODE-200";

describe("FR-NODE-038 add_compatibility_check mutation with dedup, frozen, and liveness guards", () => {
  // AC-1: add_compatibility_check writes exactly one checked_compatible row on the
  // compareReqId-minimum block, with self and peer pins set to the current
  // semanticSha values and the peer REQ-ID as the row Reference.
  it("FR-NODE-038 AC-1: writes one checked_compatible row on the min block with self+peer sha pins", async () => {
    // Sanity: MIN_ID really is the compareReqId-minimum of the pair.
    expect(compareReqId(MIN_ID, MAX_ID)).toBeLessThan(0);

    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const selfSha = await currentSha(rootPath, MIN_ID);
    const peerSha = await currentSha(rootPath, MAX_ID);

    const root = await resolveProjectRoot(rootPath);
    const result = await addCompatibilityCheck(root, { aReqId: MAX_ID, bReqId: MIN_ID });
    expect(result.ok).toBe(true);

    const rows = await compatibilityRows(rootPath);
    // Exactly one checked_compatible row in the whole workspace.
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // The single row lives on the compareReqId-minimum block, not the peer block.
    expect(row.holder).toBe(MIN_ID);
    // The Reference is the peer (max-side) REQ-ID.
    expect(row.reference).toBe(MAX_ID);
    // Both the self pin and the peer pin carry the current semanticSha values.
    expect(row.notes).toContain(selfSha);
    expect(row.notes).toContain(peerSha);
  });

  // AC-2: a second add_compatibility_check for the same min-max pair is rejected
  // by the dedup guard (one row per pair).
  it("FR-NODE-038 AC-2: rejects a duplicate compatibility check for the same min-max pair", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    const first = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(first.ok).toBe(true);

    // A second call for the same pair (order independent) must be rejected.
    const second = await addCompatibilityCheck(root, { aReqId: MAX_ID, bReqId: MIN_ID });
    expect(second.ok).toBe(false);

    // The dedup guard must leave exactly one row in place.
    const rows = await compatibilityRows(rootPath);
    expect(rows).toHaveLength(1);
  });

  // AC-3: add_compatibility_check on a frozen min-side block is rejected and the
  // document is left unmodified.
  it("FR-NODE-038 AC-3: rejects a compatibility check when the min-side block is frozen", async () => {
    const rootPath = await buildWorkspace([
      { id: MIN_ID, stability: "frozen" },
      { id: MAX_ID }
    ]);
    const scoped = path.join(rootPath, SCOPE_FILE);
    const before = await readFile(scoped, "utf8");

    const root = await resolveProjectRoot(rootPath);
    const result = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(result.ok).toBe(false);

    // The rejected mutation must not write any row.
    const after = await readFile(scoped, "utf8");
    expect(after).toBe(before);
    expect(await compatibilityRows(rootPath)).toHaveLength(0);
  });

  // AC-4: add_compatibility_check is rejected when either endpoint is discarded,
  // deprecated, or non-existent.
  it("FR-NODE-038 AC-4: rejects a compatibility check when an endpoint is discarded, deprecated, or non-existent", async () => {
    // Discarded peer endpoint.
    const discardedRoot = await resolveProjectRoot(
      await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID, status: "discarded" }])
    );
    const discarded = await addCompatibilityCheck(discardedRoot, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(discarded.ok).toBe(false);

    // Deprecated peer endpoint.
    const deprecatedRoot = await resolveProjectRoot(
      await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID, stability: "deprecated" }])
    );
    const deprecated = await addCompatibilityCheck(deprecatedRoot, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(deprecated.ok).toBe(false);

    // Non-existent peer endpoint (only MIN_ID exists in the workspace).
    const missingRoot = await resolveProjectRoot(await buildWorkspace([{ id: MIN_ID }]));
    const missing = await addCompatibilityCheck(missingRoot, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(missing.ok).toBe(false);
  });

  // Self-pair guard (dedup invariant / graph-pollution prevention): a
  // compatibility check of a requirement against itself (aReqId === bReqId)
  // would write a self-referential checked_compatible row, so it must be
  // rejected and leave the document unmodified.
  it("FR-NODE-038 rejects a self-pair compatibility check (aReqId === bReqId)", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const scoped = path.join(rootPath, SCOPE_FILE);
    const before = await readFile(scoped, "utf8");

    const root = await resolveProjectRoot(rootPath);
    const result = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MIN_ID });
    expect(result.ok).toBe(false);

    // No row written, document untouched.
    const after = await readFile(scoped, "utf8");
    expect(after).toBe(before);
    expect(await compatibilityRows(rootPath)).toHaveLength(0);
  });

  // AC-5: the written Reference is a bare live REQ-ID that passes SRS-E012 and the
  // addTraceLink existence guard — i.e. the workspace validates with no SRS-E012
  // diagnostic after the row is written.
  it("FR-NODE-038 AC-5: written Reference is a bare live REQ-ID that passes SRS-E012", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    const result = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(result.ok).toBe(true);

    const rows = await compatibilityRows(rootPath);
    expect(rows).toHaveLength(1);
    // The Reference is a bare REQ-ID (not a path#anchor or decorated value).
    expect(rows[0].reference).toMatch(BARE_REQ_ID);

    // The written Reference resolves to a live requirement, so SRS-E012
    // (Trace target does not exist) must not be raised.
    const workspace = await parseWorkspace(root);
    const validation = validateWorkspace(workspace);
    const e012 = validation.errors.filter((diag) => diag.code === "SRS-E012");
    expect(e012).toEqual([]);
  });
});
