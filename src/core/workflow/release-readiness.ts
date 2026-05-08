import type { ParsedWorkspace, ValidationResult } from "../types.js";
import { validateWorkspace } from "../validator/validate-workspace.js";

export interface DiagnosticsSummary {
  errors: number;
  warnings: number;
  byCode: Record<string, number>;
}

export interface ReleaseReadinessSummary {
  target: string;
  ready: boolean;
  validationErrors: number;
  blocked: string[];
  plannedOrInProgress: string[];
  implementedNotVerified: string[];
  missingEvidence: string[];
  baselineCommand: string;
}

export interface TraceabilityCoverage {
  total: number;
  covered: number;
  coveragePercent: number;
  missing: string[];
}

export function formatDiagnosticsSummary(result: ValidationResult): DiagnosticsSummary {
  const byCode: Record<string, number> = {};
  for (const diagnostic of result.diagnostics) {
    byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
  }
  return { errors: result.errors.length, warnings: result.warnings.length, byCode };
}

export function summarizeReleaseReadiness(workspace: ParsedWorkspace, target: string): ReleaseReadinessSummary {
  const validation = validateWorkspace(workspace);
  const records = workspace.records.filter((record) => record.target === target);
  const blocked = records.filter((record) => record.status === "blocked").map((record) => record.id);
  const plannedOrInProgress = records.filter((record) => record.status === "planned" || record.status === "in_progress").map((record) => record.id);
  const implementedNotVerified = records.filter((record) => record.status === "implemented").map((record) => record.id);
  const missingEvidence = records.filter((record) => (record.status === "implemented" || record.status === "verified") && record.verificationEvidence.length === 0).map((record) => record.id);
  return {
    target,
    ready: validation.errors.length === 0 && blocked.length === 0 && plannedOrInProgress.length === 0 && implementedNotVerified.length === 0 && missingEvidence.length === 0,
    validationErrors: validation.errors.length,
    blocked,
    plannedOrInProgress,
    implementedNotVerified,
    missingEvidence,
    baselineCommand: `git tag srs-${target}-baseline`
  };
}

export function renderCiValidationExample(): string {
  return ["# CI Spec Validation Example", "", "Use Node.js LTS and run:", "", "```sh", "npm ci", "npx speckiwi validate --json", "```"].join("\n");
}

export function collectTraceabilityCoverage(requirementIds: string[], evidenceIndex: Record<string, string[]>): TraceabilityCoverage {
  const missing = requirementIds.filter((id) => (evidenceIndex[id] ?? []).length === 0);
  const covered = requirementIds.length - missing.length;
  return {
    total: requirementIds.length,
    covered,
    coveragePercent: requirementIds.length === 0 ? 100 : Math.round((covered / requirementIds.length) * 100),
    missing
  };
}
