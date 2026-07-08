import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { parseCompatibilityNotes } from "../../../src/core/parser/table.js";
import { compareReqId, computeSemanticSha } from "../../../src/core/mutation/records.js";
import type { RequirementStatus, Stability } from "../../../src/core/types.js";
// FR-NODE-038 — used to seed an initial checked_compatible row that the
// FR-NODE-039 refresh/revoke mutations operate on. This export already exists.
import { addCompatibilityCheck } from "../../../src/core/mutation/add-compatibility-check.js";
// FR-NODE-039 — the green task (T-PH003-14) introduces refreshCompatibilityCheck
// and revokeCompatibilityCheck in src/core/mutation/add-compatibility-check.ts.
// Importing these not-yet-existing exports keeps the whole suite red until then.
import {
  refreshCompatibilityCheck,
  revokeCompatibilityCheck
} from "../../../src/core/mutation/add-compatibility-check.js";

// FR-NODE-039 — refresh_compatibility_check and revoke_compatibility_check
// mutations.
//
// Red-phase suite (T-PH003-13): one test case per acceptance criterion
// (AC-1..AC-4). These cases describe the future contract of the refresh/revoke
// mutations before refreshCompatibilityCheck / revokeCompatibilityCheck exist,
// so the whole suite fails (missing export) until the green task (T-PH003-14)
// implements them.
//
// Contract under test (from the requirement body and AC):
//   refresh_compatibility_check(aReqId, bReqId) locates the single min-side
//   checked_compatible row, recomputes its self/peer semanticSha pins, and
//   replaces it via replaceLine. It returns NOT_FOUND when zero rows match and
//   is rejected when two or more rows match. revoke_compatibility_check(aReqId,
//   bReqId) removes the min-side row via a range replacement.

const SCOPE_FILE = path.join("docs", "spec", "50.nodejs-implementation.srs.md");
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
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-023-"));
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

/**
 * Appends a raw duplicate checked_compatible row directly onto a REQ-ID block's
 * Trace Links table so the workspace holds two min-side rows for the same pair.
 * Used to exercise the "two or more matching rows" rejection (AC-3), which the
 * normal addCompatibilityCheck dedup guard would otherwise prevent.
 */
async function appendRawCompatibilityRow(rootPath: string, holderId: string, peerId: string): Promise<void> {
  const scoped = path.join(rootPath, SCOPE_FILE);
  const text = await readFile(scoped, "utf8");
  const lines = text.split("\n");
  const blockStart = lines.findIndex((line) => line.startsWith(`### ${holderId} `));
  if (blockStart < 0) throw new Error(`Block not found for ${holderId}`);
  // Find this block's Trace Links header, then its table header separator row.
  const traceHeader = lines.findIndex(
    (line, index) => index > blockStart && line.trim() === "#### Trace Links"
  );
  if (traceHeader < 0) throw new Error(`Trace Links section not found for ${holderId}`);
  const separator = lines.findIndex(
    (line, index) => index > traceHeader && line.trim().startsWith("| ---")
  );
  if (separator < 0) throw new Error(`Trace Links table not found for ${holderId}`);
  const rawRow = `| Requirement | ${peerId} | ${COMPATIBLE_RELATION} | self=raw; peer=raw; checked-at=raw |`;
  lines.splice(separator + 1, 0, rawRow);
  await writeFile(scoped, lines.join("\n"), "utf8");
}

// The pair (FR-NODE-100, FR-NODE-200): FR-NODE-100 < FR-NODE-200 by raw byte
// order, so FR-NODE-100 is the compareReqId-minimum (self) and FR-NODE-200 is
// the peer.
const MIN_ID = "FR-NODE-100";
const MAX_ID = "FR-NODE-200";

describe("FR-NODE-039 refresh_compatibility_check and revoke_compatibility_check mutations", () => {
  // AC-1: refresh_compatibility_check locates the single min-side row and
  // recomputes its self/peer pins via replaceLine. After a content change on an
  // endpoint, the refreshed row's pins must differ from the originally recorded
  // ones, while remaining exactly one row on the min-side block.
  it("FR-NODE-039 AC-1: relocates the single min-side row and recomputes its self/peer pins", async () => {
    // Sanity: MIN_ID really is the compareReqId-minimum of the pair.
    expect(compareReqId(MIN_ID, MAX_ID)).toBeLessThan(0);

    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    // Seed the initial checked_compatible row with the pins of the original content.
    const seeded = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(seeded.ok).toBe(true);
    const before = await compatibilityRows(rootPath);
    expect(before).toHaveLength(1);
    const originalNotes = before[0]!.notes;

    // Mutate the peer block's requirement body so its semanticSha changes.
    const scoped = path.join(rootPath, SCOPE_FILE);
    const text = await readFile(scoped, "utf8");
    await writeFile(
      scoped,
      text.replace(`Requirement statement for ${MAX_ID}.`, `Materially changed statement for ${MAX_ID}.`),
      "utf8"
    );

    const result = await refreshCompatibilityCheck(root, { aReqId: MAX_ID, bReqId: MIN_ID });
    expect(result.ok).toBe(true);

    const after = await compatibilityRows(rootPath);
    // Still exactly one row, still on the min-side block, still pointing at the peer.
    expect(after).toHaveLength(1);
    expect(after[0]!.holder).toBe(MIN_ID);
    expect(after[0]!.reference).toBe(MAX_ID);
    // The recomputed pins must differ from the stale originally recorded pins.
    expect(after[0]!.notes).not.toBe(originalNotes);

    // The refreshed Notes cell must parse under the canonical §23.5 tokenizer and
    // its self/peer pins must equal the *current* semanticSha of each endpoint —
    // a real round-trip assertion rather than the "notes changed" tautology, so a
    // writer grammar that the reader rejects (FND-001) is caught here too.
    const parsed = parseCompatibilityNotes(after[0]!.notes);
    expect(parsed.ok).toBe(true);
    expect(parsed.fields?.fpv).toBe("fpv1");
    const refreshedWorkspace = await parseWorkspace(root);
    const minRecord = refreshedWorkspace.records.find((record) => record.id === MIN_ID)!;
    const maxRecord = refreshedWorkspace.records.find((record) => record.id === MAX_ID)!;
    expect(parsed.fields?.self).toBe(computeSemanticSha(minRecord));
    expect(parsed.fields?.peer).toBe(computeSemanticSha(maxRecord));
  });

  // AC-2: refresh_compatibility_check returns NOT_FOUND when no matching row
  // exists (the pair was never checked).
  it("FR-NODE-039 AC-2: returns NOT_FOUND when no matching compatibility row exists", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    // No add_compatibility_check was performed, so there is no row to refresh.
    const result = await refreshCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
    // Nothing was written.
    expect(await compatibilityRows(rootPath)).toHaveLength(0);
  });

  // AC-3: refresh_compatibility_check is rejected when two or more matching rows
  // exist on the min-side block (ambiguous target).
  it("FR-NODE-039 AC-3: is rejected when two or more matching rows exist", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    // Seed one row via the mutation, then inject a raw duplicate to bypass dedup.
    const seeded = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(seeded.ok).toBe(true);
    await appendRawCompatibilityRow(rootPath, MIN_ID, MAX_ID);
    expect(await compatibilityRows(rootPath)).toHaveLength(2);

    const result = await refreshCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(result.ok).toBe(false);

    // The ambiguous refresh must leave both rows untouched (no partial edit).
    expect(await compatibilityRows(rootPath)).toHaveLength(2);
  });

  // AC-4: revoke_compatibility_check removes the compatibility row using a range
  // replacement, leaving the block with no checked_compatible row.
  it("FR-NODE-039 AC-4: removes the compatibility row via a range replacement", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    const seeded = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(seeded.ok).toBe(true);
    expect(await compatibilityRows(rootPath)).toHaveLength(1);

    // Order-independent: revoke using the reversed pair argument order.
    const result = await revokeCompatibilityCheck(root, { aReqId: MAX_ID, bReqId: MIN_ID });
    expect(result.ok).toBe(true);

    // The row is gone after the range replacement.
    expect(await compatibilityRows(rootPath)).toHaveLength(0);
  });
});
