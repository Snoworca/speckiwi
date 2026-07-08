import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncCounts } from "../../../src/core/mutation/sync-counts.js";
import { resolveProjectRoot } from "../../../src/core/project-root.js";

// FR-NODE-050 — sync-counts core recomputes index summary cells from records.
//
// The core layer provides a syncCounts mutation that recomputes the 00.index Status Summary
// and Requirement Type Summary count cells from the FULL (cross-target, no target filter) set
// of Requirement Block records, rewrites only those summary cells in place, and defaults to a
// check that reports drift without writing.
//
// Implementation Note (2026-06-08): the index Status/Type summaries are GLOBAL (cross-target)
// counts. Select ALL workspace.records with NO target filter, unlike summarizeTarget which
// filters by target. The fixture below intentionally spreads records across v1.0.0 and v2.0.0
// so a target-filtered count would diverge from the GLOBAL expectation, pinning that behavior.

const SPEC_DIR_PARTS = ["docs", "spec"] as const;

// Declared (stale) summary cells. Actual record counts (see fixture below) are deliberately
// different so drift detection (AC-1) and the rewrite (AC-2) have concrete, pinned targets.
//
// Actual GLOBAL record counts produced by the fixture:
//   status: planned=1, verified=1   (and 0 for in_progress/blocked/implemented/discarded)
//   type:   functional=1, interface=1
const INDEX_MARKDOWN = [
  "# SpecKiwi Sync-Counts Fixture Index",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | srs_index |",
  "| Product | SpecKiwi |",
  "| Active Target | v1.0.0 |",
  "| Status | baseline |",
  "",
  "## 1. Purpose",
  "",
  "Sync-counts fixture index.",
  "",
  "## 2. SRS Documents",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  "| Product Architecture | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | ARCH | Architecture |",
  "",
  "## 3. Target Map",
  "",
  "| Target | Type | Status | Description |",
  "|---|---|---|---|",
  "| v1.0.0 | release | active | Fixture release |",
  "| v2.0.0 | version | planned | Second fixture target |",
  "",
  "## 4. Scope Map",
  "",
  "| Scope | Document | Prefix | Description |",
  "|---|---|---|---|",
  "| Product Architecture | [10.product-architecture.srs.md](./10.product-architecture.srs.md) | ARCH | Architecture |",
  "",
  "## 5. Status Summary",
  "",
  "| Status | Count |",
  "|---|---:|",
  "| planned | 5 |",
  "| in_progress | 0 |",
  "| blocked | 0 |",
  "| implemented | 0 |",
  "| verified | 9 |",
  "| discarded | 0 |",
  "",
  "## 6. Requirement Type Summary",
  "",
  "| Type | Prefix | Count |",
  "|---|---|---:|",
  "| functional | FR | 7 |",
  "| interface | IR | 3 |",
  "",
  "## 7. Completed Work Log",
  "",
  "| Date | Target | Scope | Requirement IDs | Summary |",
  "|---|---|---|---|---|"
].join("\n");

function requirementBlock(options: {
  id: string;
  title: string;
  type: string;
  target: string;
  status: string;
  stability: string;
}): string {
  return [
    `### ${options.id} — ${options.title}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Type | ${options.type} |`,
    `| Target | ${options.target} |`,
    `| Status | ${options.status} |`,
    "| Priority | high |",
    "| Tags | fixture |",
    "| Risk | low |",
    `| Stability | ${options.stability} |`,
    "| Verification Method | test |",
    "| GitHub Issue | - |",
    "| Related Docs | - |",
    "",
    "#### Requirement",
    "",
    `Statement for ${options.id}.`,
    "",
    "#### Rationale",
    "",
    "-",
    "",
    "#### Acceptance Criteria",
    "",
    "- [ ] AC-1: Something holds.",
    "",
    "#### Verification Evidence",
    "",
    "| Evidence ID | Type | Reference | Covers | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| VE-1 | test | test/x.test.ts | AC-1 | - |",
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
    "| 2026-06-08 | Created | Fixture |"
  ].join("\n");
}

// Two records spread across two targets, so a GLOBAL (no-filter) recount differs from any
// single-target count. Actual counts: planned=1, verified=1, functional=1, interface=1.
const SRS_MARKDOWN = [
  "# Product Architecture",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Document Type | scope_srs |",
  "| Scope | ARCH |",
  "| Scope Name | Product Architecture |",
  "",
  "## 1. Scope Overview",
  "",
  "Fixture scope.",
  "",
  "## 2. Scope Boundaries",
  "",
  "### In Scope",
  "",
  "- Markdown requirements",
  "",
  "### Out of Scope",
  "",
  "- External database",
  "",
  "## 3. Assumptions and Constraints",
  "",
  "- None",
  "",
  "## 4. Requirements",
  "",
  requirementBlock({
    id: "FR-ARCH-001",
    title: "Planned functional requirement",
    type: "functional",
    target: "v1.0.0",
    status: "planned",
    stability: "evolving"
  }),
  "",
  requirementBlock({
    id: "IR-ARCH-002",
    title: "Verified interface requirement",
    type: "interface",
    target: "v2.0.0",
    status: "verified",
    stability: "stable"
  })
].join("\n");

let workspaceRoot: string;

async function indexContents(): Promise<string> {
  return readFile(path.join(workspaceRoot, ...SPEC_DIR_PARTS, "00.index.md"), "utf8");
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-050-"));
  const specDir = path.join(workspaceRoot, ...SPEC_DIR_PARTS);
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), INDEX_MARKDOWN, "utf8");
  await writeFile(path.join(specDir, "10.product-architecture.srs.md"), SRS_MARKDOWN, "utf8");
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("FR-NODE-050 sync-counts core recomputes index summary cells from records", () => {
  it("FR-NODE-050 AC-1: defaults to a check that returns expected vs actual per cell and writes no file", async () => {
    // TC-REQ-FR-NODE-050-AC1-01
    const root = await resolveProjectRoot(workspaceRoot);
    const before = await indexContents();

    // Default mode is a check (no apply) — it reports drift but must not write.
    const result = await syncCounts(root, {});

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ written: false });

    // The check reports each drifting summary cell as expected (declared) vs actual (recount),
    // counted GLOBALLY across all targets. Declared planned=5/verified=9, actual planned=1/verified=1.
    const cells = (result.value as { cells: Array<Record<string, unknown>> }).cells;
    expect(cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ section: "status", key: "planned", expected: 5, actual: 1 }),
        expect.objectContaining({ section: "status", key: "verified", expected: 9, actual: 1 }),
        expect.objectContaining({ section: "type", key: "functional", expected: 7, actual: 1 }),
        expect.objectContaining({ section: "type", key: "interface", expected: 3, actual: 1 })
      ])
    );

    // Check mode writes nothing: the on-disk index is byte-identical and still carries the stale cells.
    expect(await indexContents()).toBe(before);
    expect(await indexContents()).toContain("| planned | 5 |");
    expect(await indexContents()).toContain("| functional | FR | 7 |");
  });

  it("FR-NODE-050 AC-2: apply rewrites only the summary cells to actual counts and changes no other line", async () => {
    // TC-REQ-FR-NODE-050-AC2-01
    const root = await resolveProjectRoot(workspaceRoot);
    const beforeLines = (await indexContents()).split("\n");

    const result = await syncCounts(root, { apply: true });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ written: true });

    const after = await indexContents();
    const afterLines = after.split("\n");

    // Summary cells are rewritten to the GLOBAL actual record counts.
    expect(after).toContain("| planned | 1 |");
    expect(after).toContain("| verified | 1 |");
    expect(after).toContain("| functional | FR | 1 |");
    expect(after).toContain("| interface | IR | 1 |");

    // The stale declared cells are gone.
    expect(after).not.toContain("| planned | 5 |");
    expect(after).not.toContain("| verified | 9 |");
    expect(after).not.toContain("| functional | FR | 7 |");
    expect(after).not.toContain("| interface | IR | 3 |");

    // Only the four drifting count cells changed; every other line is byte-identical.
    const changed: number[] = [];
    expect(afterLines.length).toBe(beforeLines.length);
    for (let i = 0; i < beforeLines.length; i += 1) {
      if (beforeLines[i] !== afterLines[i]) changed.push(i);
    }
    expect(changed.length).toBe(4);
  });

  it("FR-NODE-050 AC-3: modifies no Requirement Block Status, Stability, or id and does not change the Active Target", async () => {
    // TC-REQ-FR-NODE-050-AC3-01
    const root = await resolveProjectRoot(workspaceRoot);
    const srsPath = path.join(workspaceRoot, ...SPEC_DIR_PARTS, "10.product-architecture.srs.md");
    const srsBefore = await readFile(srsPath, "utf8");

    await syncCounts(root, { apply: true });

    // No Requirement Block content (Status / Stability / id) is touched.
    const srsAfter = await readFile(srsPath, "utf8");
    expect(srsAfter).toBe(srsBefore);

    // Active Target metadata is untouched.
    const index = await indexContents();
    expect(index).toContain("| Active Target | v1.0.0 |");
    expect(index).toContain("| v1.0.0 | release | active | Fixture release |");
    expect(index).toContain("| v2.0.0 | version | planned | Second fixture target |");
  });

  it("FR-NODE-050 AC-4: when declared counts already equal actual counts it performs zero write operations", async () => {
    // TC-REQ-FR-NODE-050-AC4-01
    const root = await resolveProjectRoot(workspaceRoot);

    // First apply makes declared == actual.
    await syncCounts(root, { apply: true });
    const settled = await indexContents();

    // Second apply must be a no-op: nothing drifts, so zero writes occur.
    const result = await syncCounts(root, { apply: true });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ written: false });
    expect((result.value as { cells: unknown[] }).cells).toEqual([]);
    expect(await indexContents()).toBe(settled);
  });

  it("FR-NODE-050 AC-5: reuses the patch-plan stale-snapshot guard so a concurrent edit yields a stale-patch failure", async () => {
    // TC-REQ-FR-NODE-050-AC5-01
    const root = await resolveProjectRoot(workspaceRoot);
    const indexPath = path.join(workspaceRoot, ...SPEC_DIR_PARTS, "00.index.md");

    // syncCounts must reject when the index file changed on disk after its snapshot was taken,
    // reusing the existing patch-plan stale-snapshot guard (STALE_PATCH). Force the race by
    // mutating the file inside an injected pre-write hook so the on-disk sha diverges from the
    // snapshot the patch plan was built against.
    const result = await syncCounts(root, {
      apply: true,
      onBeforeWrite: async () => {
        await writeFile(indexPath, `${INDEX_MARKDOWN}\n<!-- concurrent edit -->\n`, "utf8");
      }
    } as Parameters<typeof syncCounts>[1]);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("STALE_PATCH");
  });
});
