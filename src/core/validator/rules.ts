import { diagnostic } from "../diagnostic.js";
import {
  PREFIX_TYPE,
  PRIORITY_LEVELS,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  RISK_LEVELS,
  STABILITY_LEVELS,
  type Diagnostic,
  type RequirementRecord
} from "../types.js";
import { registerValidationRule } from "./rule-registry.js";

function includes(values: readonly string[], value: string): boolean {
  return values.includes(value);
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
    const scopes = new Set(workspace.index.scopes.map((scope) => scope.prefix));
    const ids = new Set(workspace.records.map((record) => record.id));

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
      if (record.stability && !includes(STABILITY_LEVELS, record.stability)) {
        diagnostics.push(diagnostic("SRS-E011", "error", `Invalid stability for ${record.id}`, { filePath: record.filePath, line: record.headingLine }));
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
    return diagnostics;
  });
}
