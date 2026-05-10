import { splitDiagnostics, summarizeDiagnostics } from "../diagnostic.js";
import type { Diagnostic, ParsedWorkspace, ReadEnvelope, TargetSelection, TargetSelectionOptions, TargetSummary } from "../types.js";
import { listCompletedWork } from "./completed-work.js";

interface TargetSummaryOptions extends TargetSelectionOptions {
  diagnostics?: Diagnostic[];
}

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

export function summarizeTarget(workspace: ParsedWorkspace, options: TargetSummaryOptions | string = {}): TargetSummary {
  const normalized = typeof options === "string" ? { target: options } : options;
  const selection = resolveTargetSelection(workspace, typeof normalized.target === "string" ? { target: normalized.target } : {});
  const { target } = selection;
  const records = workspace.records.filter((record) => record.target === target);
  const countsByStatus: Record<string, number> = {};
  const countsByType: Record<string, number> = {};
  const blocked: string[] = [];
  const implementedNotVerified: string[] = [];
  const missingEvidence: string[] = [];
  for (const record of records) {
    countsByStatus[record.status] = (countsByStatus[record.status] ?? 0) + 1;
    countsByType[record.type] = (countsByType[record.type] ?? 0) + 1;
    if (record.status === "blocked") blocked.push(record.id);
    if (record.status === "implemented") implementedNotVerified.push(record.id);
    if ((record.status === "implemented" || record.status === "verified") && record.verificationEvidence.length === 0) {
      missingEvidence.push(record.id);
    }
  }
  return {
    target,
    targetSource: selection.targetSource,
    countsByStatus,
    countsByType,
    total: records.length,
    blocked,
    implementedNotVerified,
    missingEvidence,
    diagnosticsSummary: summarizeDiagnostics(normalized.diagnostics ?? workspace.diagnostics),
    completedWork: target ? listCompletedWork(workspace, { target }) : listCompletedWork(workspace)
  };
}
