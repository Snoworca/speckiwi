import { splitDiagnostics, summarizeDiagnostics } from "../diagnostic.js";
import type { Diagnostic, ParsedWorkspace, ReadEnvelope, RequirementRecord, TargetSelection, TargetSelectionOptions, TargetSummary } from "../types.js";
import { listCompletedWork } from "./completed-work.js";

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
