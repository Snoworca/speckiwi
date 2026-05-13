import type { DiagnosticDefinition } from "./types.js";

export const DIAGNOSTIC_DEFINITIONS: DiagnosticDefinition[] = [
  {
    code: "SRS-E001",
    severity: "error",
    title: "Malformed requirement heading",
    messageTemplate: "Malformed requirement heading",
    sourceRule: "FR-PARSE-002",
    since: "v1.0.0"
  },
  {
    code: "SRS-E002",
    severity: "error",
    title: "Duplicate requirement ID",
    messageTemplate: "Duplicate requirement ID: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E003",
    severity: "error",
    title: "Required metadata field missing",
    messageTemplate: "Missing required metadata field: {field}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E004",
    severity: "error",
    title: "Type does not match requirement ID prefix",
    messageTemplate: "Type does not match ID prefix for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E005",
    severity: "error",
    title: "Invalid requirement status",
    messageTemplate: "Invalid status for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E006",
    severity: "error",
    title: "Invalid requirement priority",
    messageTemplate: "Invalid priority for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E007",
    severity: "error",
    title: "Invalid requirement risk",
    messageTemplate: "Invalid risk for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E008",
    severity: "error",
    title: "Acceptance Criteria section missing",
    messageTemplate: "Acceptance Criteria missing for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E009",
    severity: "error",
    title: "Verified requirement has unchecked acceptance criteria",
    messageTemplate: "Verified requirement has unchecked acceptance criteria: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E010",
    severity: "error",
    title: "Verified requirement lacks checked AC or evidence",
    messageTemplate: "Verified requirement lacks checked AC or evidence: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E011",
    severity: "error",
    title: "Invalid requirement stability",
    messageTemplate: "Invalid stability for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E012",
    severity: "error",
    title: "Trace requirement reference missing",
    messageTemplate: "Trace target does not exist: {reference}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-E013",
    severity: "error",
    title: "Target Map table missing",
    messageTemplate: "Target Map table is missing",
    sourceRule: "FR-PARSE-010",
    since: "v1.0.0"
  },
  {
    code: "SRS-E014",
    severity: "error",
    title: "Scope Map table missing",
    messageTemplate: "Scope Map table is missing",
    sourceRule: "FR-PARSE-010",
    since: "v1.0.0"
  },
  {
    code: "SRS-E015",
    severity: "error",
    title: "Scope prefix is not registered",
    messageTemplate: "Scope prefix is not registered: {scope}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-E016",
    severity: "error",
    title: "Scope document is missing",
    messageTemplate: "Scope document is missing for {scope}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-E017",
    severity: "error",
    title: "Active Target is not registered",
    messageTemplate: "Active Target is not registered: {target}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-E018",
    severity: "error",
    title: "Duplicate requirement section",
    messageTemplate: "Duplicate requirement section: {section}",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0"
  },
  {
    code: "SRS-E019",
    severity: "error",
    title: "Nested acceptance criterion",
    messageTemplate: "Nested acceptance criterion is not allowed: {criterionId}",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0"
  },
  {
    code: "SRS-E020",
    severity: "error",
    title: "Forbidden requirement heading content",
    messageTemplate: "Requirement heading contains forbidden Markdown content: {requirementId}",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0"
  },
  {
    code: "SRS-E021",
    severity: "error",
    title: "Malformed metadata table row",
    messageTemplate: "Metadata table row cell count does not match header count",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0"
  },
  {
    code: "SRS-E022",
    severity: "error",
    title: "Duplicate Target Map target",
    messageTemplate: "Duplicate Target Map target: {target}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0"
  },
  {
    code: "SRS-E023",
    severity: "error",
    title: "Duplicate Scope Map prefix",
    messageTemplate: "Duplicate Scope Map prefix: {prefix}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0"
  },
  {
    code: "SRS-E024",
    severity: "error",
    title: "Multiple active targets",
    messageTemplate: "Multiple Target Map rows are marked active",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0"
  },
  {
    code: "SRS-E025",
    severity: "error",
    title: "Scope document file missing",
    messageTemplate: "Scope document file is missing: {document}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0"
  },
  {
    code: "SRS-E026",
    severity: "error",
    title: "Release target is empty",
    messageTemplate: "Release readiness target is empty",
    sourceRule: "FR-FLOW-007",
    since: "v1.2.0"
  },
  {
    code: "SRS-E027",
    severity: "error",
    title: "Acceptance Criteria coverage gap",
    messageTemplate: "Requirement has uncovered acceptance criteria: {requirementId}",
    sourceRule: "FR-FLOW-008",
    since: "v1.2.0"
  },
  {
    code: "SRS-E028",
    severity: "error",
    title: "Evidence reference missing",
    messageTemplate: "Evidence reference does not exist: {reference}",
    sourceRule: "FR-FLOW-008",
    since: "v1.2.0"
  },
  {
    code: "SRS-E029",
    severity: "error",
    title: "Evidence URL invalid",
    messageTemplate: "Evidence URL is invalid: {reference}",
    sourceRule: "FR-FLOW-008",
    since: "v1.2.0"
  },
  {
    code: "SRS-E030",
    severity: "error",
    title: "Command evidence violates policy",
    messageTemplate: "Command evidence violates release policy: {reference}",
    sourceRule: "FR-FLOW-008",
    since: "v1.2.0"
  },
  {
    code: "SRS-E031",
    severity: "error",
    title: "Trace link target is broken",
    messageTemplate: "Trace link target is broken: {reference}",
    sourceRule: "FR-FLOW-008",
    since: "v1.2.0"
  },
  {
    code: "SRS-E032",
    severity: "error",
    title: "Stale mutation snapshot",
    messageTemplate: "Mutation snapshot is stale for {filePath}",
    sourceRule: "FR-NODE-013",
    since: "v1.2.0"
  },
  {
    code: "SRS-E033",
    severity: "error",
    title: "Verified draft requirement",
    messageTemplate: "Verified requirement uses draft stability: {requirementId}",
    sourceRule: "FR-PARSE-015",
    since: "v1.3.0"
  },
  {
    code: "SRS-W001",
    severity: "warning",
    title: "Rationale section missing",
    messageTemplate: "Rationale section missing for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-W002",
    severity: "warning",
    title: "Target is not registered",
    messageTemplate: "Target is not registered: {target}",
    sourceRule: "FR-PARSE-010",
    since: "v1.0.0"
  },
  {
    code: "SRS-W003",
    severity: "warning",
    title: "Related Docs local link missing",
    messageTemplate: "Related Docs local link is missing: {reference}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-W004",
    severity: "warning",
    title: "GitHub Issue URL format invalid",
    messageTemplate: "GitHub Issue URL format is invalid: {url}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-W005",
    severity: "warning",
    title: "Heading dash is not an em dash",
    messageTemplate: "Requirement heading dash is not an em dash: {requirementId}",
    sourceRule: "FR-PARSE-002",
    since: "v1.0.0"
  },
  {
    code: "SRS-W006",
    severity: "warning",
    title: "Discouraged wording used",
    messageTemplate: "Discouraged wording used: {phrase}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-W007",
    severity: "warning",
    title: "Too many tags",
    messageTemplate: "Too many tags for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-W008",
    severity: "warning",
    title: "High risk requirement lacks Research / Analysis",
    messageTemplate: "High risk requirement lacks Research / Analysis: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-W009",
    severity: "warning",
    title: "Frozen target changed without Change Notes",
    messageTemplate: "Frozen target requirement changed without Change Notes: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0"
  },
  {
    code: "SRS-W010",
    severity: "warning",
    title: "Active Target row is not active",
    messageTemplate: "Active Target row is not marked active: {target}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-W011",
    severity: "warning",
    title: "Completed Work Log date is invalid",
    messageTemplate: "Completed Work Log date is not YYYY-MM-DD: {date}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-W012",
    severity: "warning",
    title: "Completed Work Log target is not registered",
    messageTemplate: "Completed Work Log target is not registered: {target}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-W013",
    severity: "warning",
    title: "Completed Work Log scope is not registered",
    messageTemplate: "Completed Work Log scope is not registered: {scope}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-W014",
    severity: "warning",
    title: "Completed Work Log requirement is missing",
    messageTemplate: "Completed Work Log requirement does not exist: {requirementId}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-W015",
    severity: "warning",
    title: "Completed Work Log requirement is not completed",
    messageTemplate: "Completed Work Log requirement is not completed: {requirementId}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0"
  },
  {
    code: "SRS-W016",
    severity: "warning",
    title: "Malformed Verification Evidence table row",
    messageTemplate: "Verification Evidence table row cell count does not match header count",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0"
  },
  {
    code: "SRS-W017",
    severity: "warning",
    title: "Malformed Trace Links table row",
    messageTemplate: "Trace Links table row cell count does not match header count",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0"
  },
  {
    code: "SRS-W018",
    severity: "warning",
    title: "Unregistered scope SRS document",
    messageTemplate: "Scope SRS document is not registered in Scope Map: {document}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0"
  },
  {
    code: "SRS-W019",
    severity: "warning",
    title: "Status Summary drift",
    messageTemplate: "Status Summary count drift for {status}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0"
  },
  {
    code: "SRS-W020",
    severity: "warning",
    title: "Requirement Type Summary drift",
    messageTemplate: "Requirement Type Summary count drift for {type}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0"
  },
  {
    code: "SRS-W021",
    severity: "warning",
    title: "Release readiness warning",
    messageTemplate: "Release readiness warning: {message}",
    sourceRule: "FR-FLOW-007",
    since: "v1.2.0"
  },
  {
    code: "SRS-W022",
    severity: "warning",
    title: "Legacy volatile stability",
    messageTemplate: "Legacy volatile stability should be migrated: {requirementId}",
    sourceRule: "FR-PARSE-015",
    since: "v1.3.0"
  },
  {
    code: "SRS-W023",
    severity: "warning",
    title: "Draft requirement in active or released target",
    messageTemplate: "Draft requirement is not ready as an implementation contract: {requirementId}",
    sourceRule: "FR-PARSE-015",
    since: "v1.3.0"
  },
  {
    code: "SRS-W024",
    severity: "warning",
    title: "Malformed Completed Work Log report path",
    messageTemplate: "Completed Work Log report path is malformed: {path}",
    sourceRule: "FR-PARSE-016",
    since: "v2.1.1"
  }
];

const definitionsByCode = new Map(DIAGNOSTIC_DEFINITIONS.map((definition) => [definition.code, definition]));

export function getDiagnosticDefinition(code: string): DiagnosticDefinition {
  const definition = definitionsByCode.get(code);
  if (!definition) {
    throw new Error(`Unknown diagnostic code: ${code}`);
  }
  return definition;
}
