import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectRoot } from "../../../src/core/project-root.js";
import { parseWorkspace } from "../../../src/core/parser/workspace-parser.js";
import { computeSemanticSha } from "../../../src/core/mutation/records.js";
import type { RequirementStatus, Stability } from "../../../src/core/types.js";
// The green task (T-PH003-16) introduces the listDirtyEdges read handler in
// src/core/query/summary.ts. Importing the not-yet-existing export makes the
// whole suite red until then.
import { listDirtyEdges } from "../../../src/core/query/summary.js";

// FR-NODE-040 — list_dirty_edges read path with clean whitelist gate.
//
// Red-phase suite (T-PH003-15): one test case per acceptance criterion
// (AC-1..AC-4). These cases describe the future contract of listDirtyEdges
// before the export exists, so the whole suite fails (missing module/export)
// until the green task (T-PH003-16) implements it.
//
// Contract under test (from the requirement body, AC, and the A1/A3
// incremental-contradiction-cache design doc §1.2):
//
//   listDirtyEdges(root: ProjectRoot, options?: { target?: string }):
//     Promise<{ edges: DirtyEdge[] }>
//
//   where each DirtyEdge describes one checked_compatible compatibility edge as
//   discovered from a fresh parse + inverse index:
//
//     interface DirtyEdge {
//       self: string;            // holder block (compareReqId-minimum) bare REQ-ID
//       peer: string;            // referenced bare REQ-ID
//       classification: "clean" | "dirty" | "orphaned" | "missing";
//       reason?: string;         // optional human-readable detail
//     }
//
//   Classification whitelist gate (clean only when ALL conditions hold, design
//   §1.2): exactly one row for the pair, self pin equals current self
//   semanticSha, peer pin equals current peer semanticSha, both endpoints
//   cache-live (exist & status != discarded & stability != deprecated), Notes
//   parse (parseCompatibilityNotes), and fpv matches. Otherwise dirty — there is
//   no blacklist path. An edge whose referenced peer was deleted is orphaned; an
//   edge whose source/holder endpoint is missing is missing.
//
//   Notes cell uses the canonical SRS-MD-Rules-v3.0.0 §23.5 token grammar
//   ("key: value" items separated by "; "; recognized keys fpv/self/peer/
//   checked-at; restricted value charset) so the clean gate's "Notes parse" and
//   "fpv match" conditions are satisfiable.

const SCOPE_DOC = "50.nodejs-implementation.srs.md";
const COMPATIBLE_RELATION = "checked_compatible";
const FPV_VALUE = "fpv1";

// The pair (FR-NODE-100, FR-NODE-200): FR-NODE-100 < FR-NODE-200 by raw byte
// order, so FR-NODE-100 is the compareReqId-minimum (self / holder) and
// FR-NODE-200 is the peer.
const MIN_ID = "FR-NODE-100";
const MAX_ID = "FR-NODE-200";

interface BlockSpec {
  id: string;
  status?: RequirementStatus;
  stability?: Stability;
  requirement?: string;
  /** Raw checked_compatible Trace Links rows to embed in this block. */
  compatRows?: Array<{ reference: string; notes: string }>;
}

/** Renders one canonical checked_compatible Trace Links table row. */
function renderCompatRow(reference: string, notes: string): string {
  return `| Requirement | ${reference} | ${COMPATIBLE_RELATION} | ${notes} |`;
}

/** Renders the canonical pin Notes cell in SRS-MD-Rules-v3.0.0 §23.5 grammar. */
function renderPinNotes(selfSha: string, peerSha: string): string {
  return `fpv: ${FPV_VALUE}; self: ${selfSha}; peer: ${peerSha}; checked-at: 2026-06-17`;
}

/** Renders a single NODE-scope requirement block in the canonical SRS layout. */
function renderRequirementBlock(spec: BlockSpec): string {
  const status = spec.status ?? "planned";
  const stability = spec.stability ?? "evolving";
  const requirement = spec.requirement ?? `Requirement statement for ${spec.id}.`;
  const compatRows = (spec.compatRows ?? []).map((row) => renderCompatRow(row.reference, row.notes));
  return [
    `### ${spec.id} — Requirement ${spec.id}`,
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
    ...compatRows,
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
    "Dirty-edge fixture.",
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
    "# SpecKiwi Dirty-Edge Fixture Index",
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
    "Dirty-edge fixture index.",
    "",
    "## 2. SRS Documents",
    "",
    "| Scope | Document | Prefix | Description |",
    "|---|---|---|---|",
    `| Node.js Implementation | [${SCOPE_DOC}](./${SCOPE_DOC}) | NODE | Node |`,
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
    `| Node.js Implementation | [${SCOPE_DOC}](./${SCOPE_DOC}) | NODE | Node |`,
    "",
    "## 5. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    ""
  ].join("\n");
}

/**
 * Writes a self-contained NODE-scope workspace under a fresh temp directory from
 * the given block specs and returns the resolved ProjectRoot.
 */
async function buildWorkspace(blocks: BlockSpec[]) {
  const root = await mkdtemp(path.join(tmpdir(), "speckiwi-fr-node-024-"));
  const specDir = path.join(root, "docs", "spec");
  await mkdir(specDir, { recursive: true });
  await writeFile(path.join(specDir, "00.index.md"), renderIndexDocument(), "utf8");
  await writeFile(
    path.join(specDir, SCOPE_DOC),
    renderScopeDocument(blocks.map(renderRequirementBlock)),
    "utf8"
  );
  return resolveProjectRoot(root);
}

/** Computes the current semanticSha of a REQ-ID by parsing the on-disk workspace. */
async function currentSha(root: Awaited<ReturnType<typeof resolveProjectRoot>>, id: string): Promise<string> {
  const workspace = await parseWorkspace(root);
  const record = workspace.records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Requirement not found in fixture: ${id}`);
  return computeSemanticSha(record);
}

/** Returns the single edge matching the (self, peer) pair, failing if absent/ambiguous. */
function edgeFor(
  edges: ReadonlyArray<{ self: string; peer: string; classification: string }>,
  self: string,
  peer: string
) {
  const matches = edges.filter((edge) => edge.self === self && edge.peer === peer);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe("FR-NODE-040 list_dirty_edges read path with clean whitelist gate", () => {
  // AC-1: An edge is reported clean only when row count is exactly 1 and both
  // pins equal current semanticSha and both endpoints are cache-live and Notes
  // parse and fpv matches. The fixture authors a single canonical row whose self
  // and peer pins are the live shas, both endpoints planned/evolving (cache-live).
  it("FR-NODE-040 AC-1: classifies an edge clean only when every whitelist condition holds", async () => {
    // First materialize the two requirements (no rows) so their current shas can
    // be computed, then rebuild with a row pinned to exactly those shas.
    const shaRoot = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const selfSha = await currentSha(shaRoot, MIN_ID);
    const peerSha = await currentSha(shaRoot, MAX_ID);

    const root = await buildWorkspace([
      { id: MIN_ID, compatRows: [{ reference: MAX_ID, notes: renderPinNotes(selfSha, peerSha) }] },
      { id: MAX_ID }
    ]);

    const result = await listDirtyEdges(root);
    const edge = edgeFor(result.edges, MIN_ID, MAX_ID);
    expect(edge.classification).toBe("clean");
  });

  // AC-2: Any edge failing one or more clean conditions is reported dirty with no
  // blacklist path. Here the self pin is stale (does not equal the current self
  // semanticSha), so the single failing condition flips the edge to dirty.
  it("FR-NODE-040 AC-2: reports an edge with a stale pin as dirty (no blacklist path)", async () => {
    const shaRoot = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const peerSha = await currentSha(shaRoot, MAX_ID);
    // A stale self pin: a well-formed but non-current sha (40 hex zeros).
    const staleSelfSha = "0".repeat(40);

    const root = await buildWorkspace([
      { id: MIN_ID, compatRows: [{ reference: MAX_ID, notes: renderPinNotes(staleSelfSha, peerSha) }] },
      { id: MAX_ID }
    ]);

    const result = await listDirtyEdges(root);
    const edge = edgeFor(result.edges, MIN_ID, MAX_ID);
    expect(edge.classification).toBe("dirty");
    // The whitelist gate is the only path: the failing-condition edge must not be
    // silently treated as clean.
    expect(edge.classification).not.toBe("clean");
  });

  // AC-3: An edge whose endpoint is missing is classified missing and an edge
  // whose peer was deleted is classified orphaned.
  it("FR-NODE-040 AC-3: classifies a deleted peer as orphaned and a missing endpoint as missing", async () => {
    // Orphaned: a well-formed live edge whose referenced peer (FR-NODE-200) does
    // not exist in the workspace at all — the peer was deleted, leaving the
    // holder's row pointing at a removed counterpart.
    const orphanRoot = await buildWorkspace([
      {
        id: MIN_ID,
        compatRows: [{ reference: MAX_ID, notes: renderPinNotes("a".repeat(40), "b".repeat(40)) }]
      }
      // MAX_ID intentionally absent.
    ]);
    const orphanResult = await listDirtyEdges(orphanRoot);
    const orphanEdge = edgeFor(orphanResult.edges, MIN_ID, MAX_ID);
    expect(orphanEdge.classification).toBe("orphaned");

    // Missing: an edge whose source/holder endpoint is missing. The holder block
    // FR-NODE-100 references peer FR-NODE-200, but FR-NODE-100 (the source
    // endpoint of the edge as seen through the inverse index keyed on the peer)
    // is absent — only the peer exists, and it carries an incoming compatibility
    // reference from a now-missing holder.
    const missingRoot = await buildWorkspace([
      {
        id: MAX_ID,
        compatRows: [{ reference: MIN_ID, notes: renderPinNotes("c".repeat(40), "d".repeat(40)) }]
      }
      // MIN_ID intentionally absent: the edge's other endpoint is missing.
    ]);
    const missingResult = await listDirtyEdges(missingRoot);
    const missingEdge = edgeFor(missingResult.edges, MAX_ID, MIN_ID);
    expect(missingEdge.classification).toBe("missing");
  });

  // AC-4: list_dirty_edges performs its own fresh parse rather than relying on
  // summarizeTarget to parse. The handler accepts a ProjectRoot (not a
  // pre-parsed workspace), so calling it with only a root must surface the
  // on-disk edges — proving it parsed the workspace itself.
  it("FR-NODE-040 AC-4: performs its own fresh parse from the ProjectRoot", async () => {
    const shaRoot = await buildWorkspace([{ id: MIN_ID }, { id: MAX_ID }]);
    const selfSha = await currentSha(shaRoot, MIN_ID);
    const peerSha = await currentSha(shaRoot, MAX_ID);

    const root = await buildWorkspace([
      { id: MIN_ID, compatRows: [{ reference: MAX_ID, notes: renderPinNotes(selfSha, peerSha) }] },
      { id: MAX_ID }
    ]);

    // No pre-parsed workspace is passed — only the root. The edge can only appear
    // if listDirtyEdges parsed the workspace from disk itself.
    const result = await listDirtyEdges(root);
    expect(result.edges.some((edge) => edge.self === MIN_ID && edge.peer === MAX_ID)).toBe(true);
  });
});
