import { diagnostic } from "../diagnostic.js";
import {
  PREFIX_TYPE,
  LEGACY_STABILITY_LEVELS,
  PRIORITY_LEVELS,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  RISK_LEVELS,
  STABILITY_LEVELS,
  type Diagnostic,
  type ParsedWorkspace,
  type RequirementRecord
} from "../types.js";
import { registerValidationRule } from "./rule-registry.js";

function includes(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function normalizeScopeDocument(document: string): string {
  const withoutAnchor = document.trim().replace(/#.*$/, "").replace(/\\/g, "/");
  if (!withoutAnchor) return "";
  const withoutDot = withoutAnchor.replace(/^\.\//, "");
  return withoutDot.startsWith("docs/spec/") ? withoutDot : `docs/spec/${withoutDot}`;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function compareSummaryCounts(expected: Map<string, number>, actual: Map<string, number>): string[] {
  const drifted = new Set<string>();
  for (const [key, count] of expected) {
    if ((actual.get(key) ?? 0) !== count) drifted.add(key);
  }
  for (const [key, count] of actual) {
    if ((expected.get(key) ?? 0) !== count) drifted.add(key);
  }
  return [...drifted];
}

function isKnownStabilityValue(value: string): boolean {
  return includes(STABILITY_LEVELS, value) || includes(LEGACY_STABILITY_LEVELS, value);
}

function isLegacyStabilityValue(value: string): boolean {
  return includes(LEGACY_STABILITY_LEVELS, value);
}

function targetIsActiveOrReleased(status: string): boolean {
  return status === "active" || status === "released";
}

export function isRequirementInActiveOrReleasedTarget(workspace: ParsedWorkspace, record: RequirementRecord): boolean {
  if (!record.target) return false;
  if (workspace.index.activeTarget === record.target) return true;
  return workspace.index.targets.some((target) => target.target === record.target && targetIsActiveOrReleased(target.status));
}

export function isDraftImplementationContractBlocked(record: RequirementRecord): boolean {
  return record.stability === "draft" && record.status !== "discarded";
}

function isExplicitChangeNoteCell(value: string): boolean {
  const normalized = value.trim();
  return normalized !== "" && normalized !== "-";
}

function hasExplicitChangeNote(record: RequirementRecord): boolean {
  return (record.changeNotes ?? []).some(
    (row) => isExplicitChangeNoteCell(row.date) && isExplicitChangeNoteCell(row.change) && isExplicitChangeNoteCell(row.reason)
  );
}

export function isVerifiedRequirementValid(record: RequirementRecord): boolean {
  return (
    record.acceptanceCriteria.length > 0 &&
    record.acceptanceCriteria.every((criterion) => criterion.checked) &&
    record.verificationEvidence.some((row) => row.reference.trim() !== "")
  );
}

export function registerDefaultRules(): void {
  registerValidationRule((workspace) => {
    const diagnostics: Diagnostic[] = [...workspace.diagnostics];
    const seen = new Map<string, RequirementRecord>();
    const targets = new Set(workspace.index.targets.map((target) => target.target));
    const scopes = new Set(workspace.index.scopes.flatMap((scope) => [scope.prefix, scope.scope]).filter(Boolean));
    const ids = new Set(workspace.records.map((record) => record.id));
    const recordsById = new Map(workspace.records.map((record) => [record.id, record]));
    const explicitActiveTarget = (workspace.index.metadata["Active Target"] ?? "").trim();
    const indexLocation = { filePath: "docs/spec/00.index.md" };

    for (const target of duplicateValues(workspace.index.targets.map((entry) => entry.target))) {
      diagnostics.push(diagnostic("SRS-E022", "error", `Duplicate Target Map target: ${target}`, indexLocation));
    }
    for (const prefix of duplicateValues(workspace.index.scopes.map((entry) => entry.prefix))) {
      diagnostics.push(diagnostic("SRS-E023", "error", `Duplicate Scope Map prefix: ${prefix}`, indexLocation));
    }
    if (workspace.index.targets.filter((target) => target.status === "active").length > 1) {
      diagnostics.push(diagnostic("SRS-E024", "error", "Multiple Target Map rows are marked active", indexLocation));
    }

    const discoveredScopeDocuments = new Set(workspace.files.map((file) => file.relativePath).filter((filePath) => filePath.endsWith(".srs.md")));
    const registeredScopeDocuments = new Set(workspace.index.scopes.map((scope) => normalizeScopeDocument(scope.document)).filter(Boolean));
    for (const scope of workspace.index.scopes) {
      const document = normalizeScopeDocument(scope.document);
      if (document && !discoveredScopeDocuments.has(document)) {
        diagnostics.push(diagnostic("SRS-E025", "error", `Scope document file is missing: ${scope.document}`, indexLocation));
      }
    }
    for (const filePath of discoveredScopeDocuments) {
      if (!registeredScopeDocuments.has(filePath)) {
        diagnostics.push(diagnostic("SRS-W018", "warning", `Scope SRS document is not registered in Scope Map: ${filePath}`, indexLocation));
      }
    }

    if (workspace.index.statusSummary) {
      const expected = new Map(workspace.index.statusSummary.filter((entry) => entry.status.trim()).map((entry) => [entry.status.trim(), entry.count]));
      const actual = countBy(workspace.records.map((record) => record.status));
      for (const status of compareSummaryCounts(expected, actual)) {
        diagnostics.push(diagnostic("SRS-W019", "warning", `Status Summary count drift for ${status}`, indexLocation));
      }
    }
    if (workspace.index.requirementTypeSummary) {
      const expected = new Map(workspace.index.requirementTypeSummary.filter((entry) => entry.type.trim()).map((entry) => [entry.type.trim(), entry.count]));
      const actual = countBy(workspace.records.map((record) => record.type));
      for (const type of compareSummaryCounts(expected, actual)) {
        diagnostics.push(diagnostic("SRS-W020", "warning", `Requirement Type Summary count drift for ${type}`, indexLocation));
      }
    }

    if (explicitActiveTarget) {
      const activeTarget = workspace.index.targets.find((target) => target.target === explicitActiveTarget);
      if (!activeTarget) {
        diagnostics.push(diagnostic("SRS-E017", "error", `Active Target is not registered: ${explicitActiveTarget}`, { filePath: "docs/spec/00.index.md" }));
      } else if (activeTarget.status !== "active") {
        diagnostics.push(diagnostic("SRS-W010", "warning", `Active Target row is not marked active: ${explicitActiveTarget}`, { filePath: "docs/spec/00.index.md" }));
      }
    }

    for (const record of workspace.records) {
      const existing = seen.get(record.id);
      if (existing) {
        diagnostics.push(diagnostic("SRS-E002", "error", `Duplicate requirement ID: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      seen.set(record.id, record);

      for (const field of ["Type", "Target", "Status"]) {
        if (!record.metadata[field]) {
          diagnostics.push(diagnostic("SRS-E003", "error", `Missing required metadata field: ${field}`, { filePath: record.filePath, line: record.headingLine }));
        }
      }

      const prefix = record.id.split("-")[0] as keyof typeof PREFIX_TYPE;
      if (!includes(REQUIREMENT_TYPES, record.type) || PREFIX_TYPE[prefix] !== record.type) {
        diagnostics.push(diagnostic("SRS-E004", "error", `Type does not match ID prefix for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (!includes(REQUIREMENT_STATUSES, record.status)) {
        diagnostics.push(diagnostic("SRS-E005", "error", `Invalid status for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.priority && !includes(PRIORITY_LEVELS, record.priority)) {
        diagnostics.push(diagnostic("SRS-E006", "error", `Invalid priority for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.risk && !includes(RISK_LEVELS, record.risk)) {
        diagnostics.push(diagnostic("SRS-E007", "error", `Invalid risk for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.stability && !isKnownStabilityValue(record.stability)) {
        diagnostics.push(diagnostic("SRS-E011", "error", `Invalid stability for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.stability && isLegacyStabilityValue(record.stability)) {
        diagnostics.push(diagnostic("SRS-W022", "warning", `Legacy volatile stability should be migrated: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.status === "verified" && record.stability === "draft") {
        diagnostics.push(diagnostic("SRS-E033", "error", `Verified requirement uses draft stability: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      } else if (isDraftImplementationContractBlocked(record) && isRequirementInActiveOrReleasedTarget(workspace, record)) {
        diagnostics.push(
          diagnostic("SRS-W023", "warning", `Draft requirement is not ready as an implementation contract: ${record.id}`, {
            filePath: record.filePath,
            line: record.headingLine
          })
        );
      }
      if (record.stability === "frozen" && record.status !== "discarded" && !hasExplicitChangeNote(record)) {
        diagnostics.push(diagnostic("SRS-W009", "warning", `Frozen target requirement changed without Change Notes: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.acceptanceCriteria.length === 0) {
        diagnostics.push(diagnostic("SRS-E008", "error", `Acceptance Criteria missing for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.status === "verified" && !isVerifiedRequirementValid(record)) {
        diagnostics.push(diagnostic("SRS-E010", "error", `Verified requirement lacks checked AC or evidence: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
      for (const trace of record.traceLinks) {
        if (trace.type === "Requirement" && trace.reference && !ids.has(trace.reference)) {
          diagnostics.push(diagnostic("SRS-E012", "error", `Trace target does not exist: ${trace.reference}`, {
            filePath: record.filePath,
            ...(typeof trace.line === "number" ? { line: trace.line } : {})
          }));
        }
      }
      if (record.target && !targets.has(record.target)) {
        diagnostics.push(diagnostic("SRS-W002", "warning", `Target is not registered: ${record.target}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if (record.scope && !scopes.has(record.scope)) {
        diagnostics.push(diagnostic("SRS-E015", "error", `Scope prefix is not registered: ${record.scope}`, { filePath: record.filePath, line: record.headingLine }));
      }
      if ((record.risk === "high" || record.risk === "critical") && !record.markdown?.includes("#### Research / Analysis")) {
        diagnostics.push(diagnostic("SRS-W008", "warning", `High risk requirement lacks Research / Analysis: ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
      }
    }
    for (const scope of workspace.index.scopes) {
      if (!scope.document) {
        diagnostics.push(diagnostic("SRS-E016", "error", `Scope document is missing for ${scope.prefix || scope.scope}`, { filePath: "docs/spec/00.index.md" }));
      }
    }
    for (const entry of workspace.index.completedWork) {
      const location = { filePath: "docs/spec/00.index.md", ...(typeof entry.line === "number" ? { line: entry.line } : {}) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        diagnostics.push(diagnostic("SRS-W011", "warning", `Completed Work Log date is not YYYY-MM-DD: ${entry.date}`, location));
      }
      if (entry.target.trim() && !targets.has(entry.target.trim())) {
        diagnostics.push(diagnostic("SRS-W012", "warning", `Completed Work Log target is not registered: ${entry.target}`, location));
      }
      for (const scope of splitCsv(entry.scope)) {
        if (!scopes.has(scope)) {
          diagnostics.push(diagnostic("SRS-W013", "warning", `Completed Work Log scope is not registered: ${scope}`, location));
        }
      }
      for (const id of entry.requirementIds) {
        const record = recordsById.get(id);
        if (!record) {
          diagnostics.push(diagnostic("SRS-W014", "warning", `Completed Work Log requirement does not exist: ${id}`, location));
        } else if (record.status !== "implemented" && record.status !== "verified") {
          diagnostics.push(diagnostic("SRS-W015", "warning", `Completed Work Log requirement is not completed: ${id}`, location));
        }
      }
    }
    return diagnostics;
  });
}
