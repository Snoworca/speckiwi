import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { parseCompatibilityNotes } from "../../../src/core/parser/table.js";
import { computeSemanticSha } from "../../../src/core/mutation/records.js";
import {
  addCompatibilityCheck,
  refreshCompatibilityCheck
} from "../../../src/core/mutation/add-compatibility-check.js";
import { listDirtyEdges } from "../../../src/core/query/summary.js";
import type { RequirementStatus, Stability } from "../../../src/core/types.js";

// FR-NODE-022 / FR-NODE-023 / FR-NODE-024 — writer→reader integration.
//
// FND-002 regression guard: the FR-NODE-024 unit suite and the FR-NODE-023 AC-1
// unit case both hand-author the canonical pin Notes grammar (or assert only
// "notes changed"), so neither exercises the actual addCompatibilityCheck /
// refreshCompatibilityCheck *writer* output flowing through the listDirtyEdges
// *reader* clean gate. This suite closes that gap: it drives the production
// writer end to end and asserts the resulting on-disk row classifies clean,
// goes dirty on a content change, and returns to clean after a refresh.
//
// This is the test that fails under FND-001 (renderPins emitting the legacy
// `self=...; peer=...` `=`-delimited, fpv-less grammar that parseCompatibilityNotes
// rejects, permanently flipping every writer-produced edge to dirty).

const SCOPE_FILE = path.join("docs", "spec", "50.nodejs-implementation.srs.md");
const COMPATIBLE_RELATION = "checked_compatible";

// The pair (FR-NODE-100, FR-NODE-200): FR-NODE-100 < FR-NODE-200 by raw byte
// order, so FR-NODE-100 is the compareReqId-minimum (self / holder) and
// FR-NODE-200 is the peer.
const MIN_ID = "FR-NODE-100";
const MAX_ID = "FR-NODE-200";

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
    "Compatibility-check integration fixture.",
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
    "# SpecKiwi Compatibility Integration Fixture Index",
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
    "Compatibility-check integration fixture index.",
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

/** Writes a self-contained NODE-scope workspace and returns its root path. */
async function buildWorkspace(
  blocks: Array<{ id: string; status?: RequirementStatus; stability?: Stability }>
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-dirty-edges-integration-"));
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

describe("list_dirty_edges writer→reader integration (FND-002)", () => {
  // The core regression: a row produced by the production addCompatibilityCheck
  // writer must be classified clean by the listDirtyEdges reader. Under FND-001
  // the writer emits a Notes grammar that parseCompatibilityNotes rejects, so the
  // reader's clean gate (Notes-parse + fpv match) can never be satisfied and the
  // edge is permanently dirty.
  it("classifies a freshly added compatibility edge as clean", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    const added = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(added.ok).toBe(true);

    const result = await listDirtyEdges(root);
    const edges = result.edges.filter((edge) => edge.self === MIN_ID && edge.peer === MAX_ID);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.classification).toBe("clean");
  });

  // The writer's Notes cell must itself parse under the canonical tokenizer and
  // carry the live pins — guarding the grammar contract directly rather than only
  // through the reader's clean classification.
  it("emits a Notes cell that parses with canonical grammar and live pins", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    const added = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(added.ok).toBe(true);

    const workspace = await parseWorkspace(root);
    const holder = workspace.records.find((record) => record.id === MIN_ID);
    const row = holder?.traceLinks.find(
      (link) => link.relation === COMPATIBLE_RELATION && link.reference === MAX_ID
    );
    expect(row).toBeDefined();

    const parsed = parseCompatibilityNotes(row!.notes);
    expect(parsed.ok).toBe(true);
    expect(parsed.fields?.fpv).toBe("fpv1");

    const minRecord = workspace.records.find((record) => record.id === MIN_ID)!;
    const maxRecord = workspace.records.find((record) => record.id === MAX_ID)!;
    expect(parsed.fields?.self).toBe(computeSemanticSha(minRecord));
    expect(parsed.fields?.peer).toBe(computeSemanticSha(maxRecord));
  });

  // Full lifecycle: add → clean, mutate an endpoint → dirty (stale-pin), refresh →
  // clean again. This proves the writer/reader agree on the pin grammar across
  // the stale-detection cycle the cache exists to support.
  it("cycles clean → dirty (stale-pin) → clean across an endpoint content change and refresh", async () => {
    const rootPath = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const root = await resolveProjectRoot(rootPath);

    const added = await addCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(added.ok).toBe(true);

    const cleanResult = await listDirtyEdges(root);
    expect(
      cleanResult.edges.find((edge) => edge.self === MIN_ID && edge.peer === MAX_ID)?.classification
    ).toBe("clean");

    // Mutate the peer block's requirement body so its semanticSha changes; the
    // recorded peer pin is now stale.
    const scoped = path.join(rootPath, SCOPE_FILE);
    const text = await readFile(scoped, "utf8");
    await writeFile(
      scoped,
      text.replace(`Requirement statement for ${MAX_ID}.`, `Materially changed statement for ${MAX_ID}.`),
      "utf8"
    );

    const dirtyResult = await listDirtyEdges(root);
    expect(
      dirtyResult.edges.find((edge) => edge.self === MIN_ID && edge.peer === MAX_ID)?.classification
    ).toBe("dirty");

    // Refresh re-pins both endpoints to the current shas; the edge is clean again.
    const refreshed = await refreshCompatibilityCheck(root, { aReqId: MIN_ID, bReqId: MAX_ID });
    expect(refreshed.ok).toBe(true);

    const recleanResult = await listDirtyEdges(root);
    expect(
      recleanResult.edges.find((edge) => edge.self === MIN_ID && edge.peer === MAX_ID)?.classification
    ).toBe("clean");
  });
});
