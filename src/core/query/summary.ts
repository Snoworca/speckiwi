import { splitDiagnostics, summarizeDiagnostics } from "../diagnostic.js";
import type { Diagnostic, ParsedWorkspace, ProjectRoot, ReadEnvelope, RequirementRecord, TargetSelection, TargetSelectionOptions, TargetSummary } from "../types.js";
import { listCompletedWork } from "./completed-work.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { parseCompatibilityNotes } from "../parser/table.js";
import { compareReqId, computeSemanticSha } from "../mutation/records.js";

interface TargetSummaryOptions extends TargetSelectionOptions {
  diagnostics?: Diagnostic[];
}

const TARGET_SUMMARY_COMPLETED_WORK_LIMIT = 20;

export function resolveActiveTarget(workspace: ParsedWorkspace): string {
  return workspace.index.activeTarget;
}

function hasExplicitTarget(options: TargetSelectionOptions): boolean {
  return Object.prototype.hasOwnProperty.call(options, "target");
}

export function resolveTargetSelection(workspace: ParsedWorkspace, options: TargetSelectionOptions = {}): TargetSelection {
  const explicit = hasExplicitTarget(options);
  const rawTarget = explicit ? options.target ?? "" : resolveActiveTarget(workspace);
  return {
    target: rawTarget.trim(),
    targetSource: explicit ? "explicit" : "active-target"
  };
}

export function buildReadEnvelope<T extends object>(workspace: ParsedWorkspace, value: T, diagnostics: Diagnostic[] = workspace.diagnostics): ReadEnvelope<T> {
  return {
    ...value,
    ...splitDiagnostics(diagnostics),
    diagnosticsSummary: summarizeDiagnostics(diagnostics)
  } as ReadEnvelope<T>;
}

export function isNewWorkCandidate(record: RequirementRecord): boolean {
  return (record.status === "planned" || record.status === "in_progress" || record.status === "blocked") && record.stability !== "draft" && record.stability !== "deprecated";
}

// FR-NODE-040 — list_dirty_edges read path with clean whitelist gate.
//
// One DirtyEdge describes a single `checked_compatible` compatibility edge as
// discovered from a fresh parse: `self` is the holder block (the block that
// physically carries the row) bare REQ-ID and `peer` is the referenced bare
// REQ-ID. Classification follows a whitelist gate — an edge is clean ONLY when
// every condition holds; otherwise it is dirty (no blacklist path). An edge
// whose referenced peer was deleted is orphaned; an edge whose canonical
// source/holder endpoint is missing is missing.
export interface DirtyEdge {
  self: string;
  peer: string;
  classification: "clean" | "dirty" | "orphaned" | "missing";
  reason?: string;
}

const COMPATIBLE_RELATION = "checked_compatible";
const COMPATIBILITY_FPV = "fpv1";

/** Cache-live: the endpoint exists and is neither discarded nor deprecated. */
function isCacheLive(record: RequirementRecord): boolean {
  return record.status !== "discarded" && record.stability !== "deprecated";
}

/** Canonical unordered pair key so both min→max and max→min rows share a count. */
function pairKey(a: string, b: string): string {
  return compareReqId(a, b) <= 0 ? `${a}::${b}` : `${b}::${a}`;
}

// @req FR-NODE-040
export async function listDirtyEdges(root: ProjectRoot, options: { target?: string } = {}): Promise<{ edges: DirtyEdge[] }> {
  const workspace = await parseWorkspace(root);
  const byId = new Map<string, RequirementRecord>();
  for (const record of workspace.records) byId.set(record.id, record);

  const holders = options.target
    ? workspace.records.filter((record) => record.target === options.target)
    : workspace.records;

  interface RawRow {
    holder: string;
    reference: string;
    notes: string;
  }
  const rows: RawRow[] = [];
  for (const record of holders) {
    for (const link of record.traceLinks) {
      if (link.relation === COMPATIBLE_RELATION) {
        rows.push({ holder: record.id, reference: link.reference, notes: link.notes ?? "" });
      }
    }
  }

  const rowCountByPair = new Map<string, number>();
  for (const row of rows) {
    const key = pairKey(row.holder, row.reference);
    rowCountByPair.set(key, (rowCountByPair.get(key) ?? 0) + 1);
  }

  const edges: DirtyEdge[] = [];
  for (const row of rows) {
    const holderRecord = byId.get(row.holder) as RequirementRecord;
    const peerRecord = byId.get(row.reference);
    const minId = compareReqId(row.holder, row.reference) <= 0 ? row.holder : row.reference;

    // A referenced endpoint that does not exist: the holder either lost its peer
    // (orphaned) or is itself the max-side of an edge whose canonical min-side
    // source is gone (missing).
    if (!peerRecord) {
      if (row.holder === minId) {
        edges.push({ self: row.holder, peer: row.reference, classification: "orphaned", reason: `referenced peer ${row.reference} was deleted` });
      } else {
        edges.push({ self: row.holder, peer: row.reference, classification: "missing", reason: `source endpoint ${row.reference} is missing` });
      }
      continue;
    }

    const parsed = parseCompatibilityNotes(row.notes);
    const selfSha = computeSemanticSha(holderRecord);
    const peerSha = computeSemanticSha(peerRecord);
    const clean =
      rowCountByPair.get(pairKey(row.holder, row.reference)) === 1 &&
      parsed.ok &&
      parsed.fields?.fpv === COMPATIBILITY_FPV &&
      parsed.fields?.self === selfSha &&
      parsed.fields?.peer === peerSha &&
      isCacheLive(holderRecord) &&
      isCacheLive(peerRecord);

    edges.push(
      clean
        ? { self: row.holder, peer: row.reference, classification: "clean" }
        : { self: row.holder, peer: row.reference, classification: "dirty", reason: "one or more clean-gate conditions failed" }
    );
  }

  return { edges };
}

export function summarizeTarget(workspace: ParsedWorkspace, options: TargetSummaryOptions | string = {}): TargetSummary {
  const normalized = typeof options === "string" ? { target: options } : options;
  const selection = resolveTargetSelection(workspace, typeof normalized.target === "string" ? { target: normalized.target } : {});
  const { target } = selection;
  const records = workspace.records.filter((record) => record.target === target);
  const countsByStatus: Record<string, number> = {};
  const countsByType: Record<string, number> = {};
  const countsByStability: Record<string, number> = {};
  const blocked: string[] = [];
  const implementedNotVerified: string[] = [];
  const missingEvidence: string[] = [];
  const draftRequirements: string[] = [];
  const deprecatedRequirements: string[] = [];
  const newWorkCandidates: string[] = [];
  const stabilityBlockers: string[] = [];
  const stabilityWarnings: string[] = [];
  for (const record of records) {
    countsByStatus[record.status] = (countsByStatus[record.status] ?? 0) + 1;
    countsByType[record.type] = (countsByType[record.type] ?? 0) + 1;
    if (record.stability) countsByStability[record.stability] = (countsByStability[record.stability] ?? 0) + 1;
    if (record.status === "blocked") blocked.push(record.id);
    if (record.status === "implemented") implementedNotVerified.push(record.id);
    if ((record.status === "implemented" || record.status === "verified") && record.verificationEvidence.length === 0) {
      missingEvidence.push(record.id);
    }
    if (record.stability === "draft") draftRequirements.push(record.id);
    if (record.stability === "deprecated") deprecatedRequirements.push(record.id);
    if (isNewWorkCandidate(record)) newWorkCandidates.push(record.id);
    if (record.status !== "discarded" && (record.stability === "draft" || record.stability === "deprecated")) stabilityBlockers.push(record.id);
    if (record.status !== "discarded" && record.stability === "volatile") stabilityWarnings.push(record.id);
  }
  const completedWorkRows = target ? listCompletedWork(workspace, { target }) : listCompletedWork(workspace);
  const completedWork = completedWorkRows.slice(0, TARGET_SUMMARY_COMPLETED_WORK_LIMIT);
  return {
    target,
    targetSource: selection.targetSource,
    countsByStatus,
    countsByType,
    countsByStability,
    total: records.length,
    blocked,
    implementedNotVerified,
    missingEvidence,
    draftRequirements,
    deprecatedRequirements,
    newWorkCandidates,
    stabilityBlockers,
    stabilityWarnings,
    diagnosticsSummary: summarizeDiagnostics(normalized.diagnostics ?? workspace.diagnostics),
    completedWork,
    completedWorkPage: {
      total: completedWorkRows.length,
      returned: completedWork.length,
      limit: TARGET_SUMMARY_COMPLETED_WORK_LIMIT,
      hasMore: completedWorkRows.length > completedWork.length,
      nextOffset: completedWorkRows.length > completedWork.length ? completedWork.length : null
    },
    goal: target && workspace.index.targetGoals[target] ? workspace.index.targetGoals[target] : null
  };
}
