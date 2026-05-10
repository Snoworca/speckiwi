import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type {
  AcCoverageGap,
  CommandEvidencePolicyViolation,
  DiagnosticsSummary,
  EvidenceReferenceIssue,
  EvidenceRow,
  ParsedWorkspace,
  ReleaseReadinessSummary,
  RequirementRecord,
  ValidationResult
} from "../types.js";
import { resolveTargetSelection } from "../query/summary.js";
import { validateWorkspace } from "../validator/validate-workspace.js";

export type { DiagnosticsSummary, ReleaseReadinessSummary } from "../types.js";

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

function coveredAcIds(row: EvidenceRow): Set<string> {
  return new Set(
    row.covers
      .split(/[,\s;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function coversAcceptanceCriterion(row: EvidenceRow, acId: string): boolean {
  const covered = coveredAcIds(row);
  return covered.has("all") || covered.has(acId.toLowerCase());
}

export function collectAcCoverageGaps(records: RequirementRecord[]): AcCoverageGap[] {
  const gaps: AcCoverageGap[] = [];
  for (const record of records) {
    if (record.status !== "verified") continue;
    const missingAcIds = record.acceptanceCriteria
      .filter((criterion) => !criterion.checked || !record.verificationEvidence.some((row) => coversAcceptanceCriterion(row, criterion.id)))
      .map((criterion) => criterion.id);
    if (missingAcIds.length > 0) {
      gaps.push({ requirementId: record.id, missingAcIds });
    }
  }
  return gaps;
}

function fullMarkdownLinkTarget(value: string): string {
  const match = /^\[[^\]]+]\(([^)]+)\)$/.exec(value.trim());
  return match?.[1] ?? value.trim();
}

function splitEvidenceReferences(row: EvidenceRow): string[] {
  const reference = row.reference.trim();
  if (reference === "") return [];
  return reference
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function evidenceType(row: EvidenceRow): string {
  return row.type.trim().toLowerCase();
}

function isCommandReference(row: EvidenceRow, reference: string): boolean {
  const type = evidenceType(row);
  const normalized = reference.trim().replace(/^\$\s*/, "");
  return type === "command" || type === "cmd" || type === "shell" || reference.trim().startsWith("$") || /^(npm|npx|node|pnpm|yarn|vitest|tsc|python|python3|bash|sh|pwsh|powershell|make|git|go|cargo|pytest|uv)\b/.test(normalized);
}

function isUrlReference(row: EvidenceRow, reference: string): boolean {
  const type = evidenceType(row);
  return type === "url" || type === "link" || /^https?:\/\//i.test(fullMarkdownLinkTarget(reference));
}

function isValidHttpUrl(reference: string): boolean {
  try {
    const url = new URL(fullMarkdownLinkTarget(reference));
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isPathLikeReference(row: EvidenceRow, reference: string): boolean {
  const type = evidenceType(row);
  const value = fullMarkdownLinkTarget(reference);
  return (
    type === "file" ||
    type === "path" ||
    type === "test" ||
    type === "inspection" ||
    type === "artifact" ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    path.isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    /\.[A-Za-z0-9]{1,8}$/.test(value)
  );
}

function localEvidencePath(root: string, reference: string): string {
  let candidate = fullMarkdownLinkTarget(reference).replace(/#.*$/, "");
  if (!path.isAbsolute(candidate)) {
    candidate = candidate.replace(/:\d+(?::\d+)?$/, "");
  }
  return path.resolve(root, candidate);
}

function isUnderRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realPathIfExists(candidate: string): string | undefined {
  try {
    return realpathSync(candidate);
  } catch {
    return undefined;
  }
}

function evidenceReferenceIssue(record: RequirementRecord, row: EvidenceRow, reference: string, issue: string): EvidenceReferenceIssue {
  const result: EvidenceReferenceIssue = { requirementId: record.id, reference, issue };
  if (row.id.trim()) result.evidenceId = row.id;
  return result;
}

export function collectMissingEvidenceReferences(workspace: ParsedWorkspace): EvidenceReferenceIssue[] {
  const issues: EvidenceReferenceIssue[] = [];
  const root = realPathIfExists(path.resolve(workspace.root.root)) ?? path.resolve(workspace.root.root);
  for (const record of workspace.records) {
    if (record.status !== "verified") continue;
    for (const row of record.verificationEvidence) {
      if (row.reference.trim() === "") {
        issues.push(evidenceReferenceIssue(record, row, row.reference, "empty"));
        continue;
      }
      for (const reference of splitEvidenceReferences(row)) {
        if (isCommandReference(row, reference)) continue;
        if (isUrlReference(row, reference)) {
          if (!isValidHttpUrl(reference)) {
            issues.push(evidenceReferenceIssue(record, row, reference, "invalid-url"));
          }
          continue;
        }
        if (!isPathLikeReference(row, reference)) continue;
        const resolved = localEvidencePath(root, reference);
        if (!isUnderRoot(root, resolved)) {
          issues.push(evidenceReferenceIssue(record, row, reference, "outside-project-root"));
        } else if (!existsSync(resolved)) {
          issues.push(evidenceReferenceIssue(record, row, reference, "missing"));
        } else {
          const realPath = realPathIfExists(resolved);
          if (realPath && !isUnderRoot(root, realPath)) {
            issues.push(evidenceReferenceIssue(record, row, reference, "outside-project-root"));
          }
        }
      }
    }
  }
  return issues;
}

function commandPolicyViolation(record: RequirementRecord, row: EvidenceRow, reference: string, policy: string): CommandEvidencePolicyViolation {
  const result: CommandEvidencePolicyViolation = { requirementId: record.id, reference, policy };
  if (row.id.trim()) result.evidenceId = row.id;
  return result;
}

function satisfiesCommandEvidencePolicy(reference: string): boolean {
  const normalized = reference.trim().replace(/^\$\s*/, "");
  if (/[;&|`<>]|\$\(/.test(normalized)) return false;
  return (
    /^npm\s+test(?:\s|$)/.test(normalized) ||
    /^npm\s+run\s+(build|typecheck|lint|test|test:integration|release:acceptance|release:check|perf:srs)(?:\s|$)/.test(normalized) ||
    /^npx\s+vitest\s+run(?:\s|$)/.test(normalized)
  );
}

export function collectCommandEvidencePolicyViolations(records: RequirementRecord[]): CommandEvidencePolicyViolation[] {
  const violations: CommandEvidencePolicyViolation[] = [];
  for (const record of records) {
    if (record.status !== "verified") continue;
    for (const row of record.verificationEvidence) {
      for (const reference of splitEvidenceReferences(row)) {
        if (isCommandReference(row, reference) && !satisfiesCommandEvidencePolicy(reference)) {
          violations.push(commandPolicyViolation(record, row, reference, "command evidence must use npm test, npm run release gates, or npx vitest run without shell operators"));
        }
      }
    }
  }
  return violations;
}

export function collectBrokenTraceLinks(records: RequirementRecord[], allRecords: RequirementRecord[] = records): string[] {
  const requirementIds = new Set(allRecords.map((record) => record.id));
  const broken: string[] = [];
  for (const record of records) {
    for (const trace of record.traceLinks) {
      if (trace.type.trim().toLowerCase() === "requirement" && trace.reference.trim() && !requirementIds.has(trace.reference.trim())) {
        broken.push(`${record.id} -> ${trace.reference.trim()}`);
      }
    }
  }
  return broken;
}

function isNonDiscarded(record: RequirementRecord): boolean {
  return record.status !== "discarded";
}

export function collectDraftRequirements(records: RequirementRecord[]): string[] {
  return records.filter((record) => isNonDiscarded(record) && record.stability === "draft").map((record) => record.id);
}

export function collectDeprecatedRequirements(records: RequirementRecord[]): string[] {
  return records.filter((record) => isNonDiscarded(record) && record.stability === "deprecated").map((record) => record.id);
}

export function collectStabilityBlockers(records: RequirementRecord[]): string[] {
  return collectDraftRequirements(records);
}

export function collectStabilityWarnings(records: RequirementRecord[]): string[] {
  return records.filter((record) => isNonDiscarded(record) && (record.stability === "deprecated" || record.stability === "volatile")).map((record) => record.id);
}

export function summarizeReleaseReadiness(workspace: ParsedWorkspace, options: { target?: string } | string = {}): ReleaseReadinessSummary {
  const validation = validateWorkspace(workspace);
  const diagnosticsSummary = formatDiagnosticsSummary(validation);
  const targetSelection = resolveTargetSelection(workspace, typeof options === "string" ? { target: options } : options);
  const { target, targetSource } = targetSelection;
  const records = workspace.records.filter((record) => record.target === target);
  const blocked = records.filter((record) => record.status === "blocked").map((record) => record.id);
  const plannedOrInProgress = records.filter((record) => record.status === "planned" || record.status === "in_progress").map((record) => record.id);
  const implementedNotVerified = records.filter((record) => record.status === "implemented").map((record) => record.id);
  const draftRequirements = collectDraftRequirements(records);
  const deprecatedRequirements = collectDeprecatedRequirements(records);
  const stabilityBlockers = collectStabilityBlockers(records);
  const stabilityWarnings = collectStabilityWarnings(records);
  const criticalHighUnverified = records
    .filter((record) => (record.priority === "critical" || record.priority === "high") && record.status !== "verified" && record.status !== "discarded")
    .map((record) => record.id);
  const missingEvidence = records.filter((record) => (record.status === "implemented" || record.status === "verified") && record.verificationEvidence.length === 0).map((record) => record.id);
  const acCoverageGaps = collectAcCoverageGaps(records);
  const missingEvidenceReferences = collectMissingEvidenceReferences({ ...workspace, records });
  const brokenTraceLinks = collectBrokenTraceLinks(records, workspace.records);
  const commandEvidencePolicyViolations = collectCommandEvidencePolicyViolations(records);
  const warnings = validation.warnings.map((diagnostic) => diagnostic.message);
  if (!target) {
    warnings.unshift("Release target is empty; provide an explicit target or set Active Target.");
  }
  return {
    target,
    targetSource,
    ready:
      target.length > 0 &&
      diagnosticsSummary.errors === 0 &&
      blocked.length === 0 &&
      plannedOrInProgress.length === 0 &&
      implementedNotVerified.length === 0 &&
      stabilityBlockers.length === 0 &&
      missingEvidence.length === 0 &&
      acCoverageGaps.length === 0 &&
      missingEvidenceReferences.length === 0 &&
      brokenTraceLinks.length === 0 &&
      commandEvidencePolicyViolations.length === 0,
    diagnosticsSummary,
    validationErrors: diagnosticsSummary.errors,
    blocked,
    plannedOrInProgress,
    implementedNotVerified,
    draftRequirements,
    deprecatedRequirements,
    stabilityBlockers,
    stabilityWarnings,
    criticalHighUnverified,
    missingEvidence,
    acCoverageGaps,
    missingEvidenceReferences,
    brokenTraceLinks,
    commandEvidencePolicyViolations,
    warnings,
    baselineCommand: target ? `git tag srs-${target}-baseline` : ""
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
