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
  },
  {
    code: "SRS-W040",
    severity: "warning",
    title: "Target Goal block conflict between index and appendix",
    messageTemplate: "Target Goal block for '{target}' defined in both 00.index.md and 90.appendix.md; appendix value wins",
    sourceRule: "FR-PARSE-018",
    since: "v2.2.2"
  },
  {
    code: "SRS-W041",
    severity: "warning",
    title: "Completed Work Log duplicate source",
    messageTemplate: "Completed Work Log rows exist in both 00.index.md and 05.completed-work.md",
    sourceRule: "FR-PARSE-021",
    since: "v2.3.0"
  },
  {
    code: "SRS-E050",
    severity: "error",
    title: "Workflow artifact path escapes workspace",
    messageTemplate: "Workflow artifact path is outside the project root: {path}",
    sourceRule: "FR-NODE-020",
    since: "v2.3.0"
  },
  {
    code: "SRS-E051",
    severity: "error",
    title: "Ambiguous workflow artifact",
    messageTemplate: "Workflow artifact resolution is ambiguous",
    sourceRule: "FR-NODE-020",
    since: "v2.3.0"
  },
  {
    code: "SRS-W050",
    severity: "warning",
    title: "Workflow artifact parse warning",
    messageTemplate: "Workflow artifact parse warning: {path}",
    sourceRule: "FR-NODE-020",
    since: "v2.3.0"
  },
  {
    code: "SRS-W051",
    severity: "warning",
    title: "Workflow artifact companion missing",
    messageTemplate: "Workflow artifact companion is missing: {path}",
    sourceRule: "FR-NODE-020",
    since: "v2.3.0"
  },
  {
    code: "SRS-W052",
    severity: "warning",
    title: "Invalid workflow JSONL line",
    messageTemplate: "Invalid workflow JSONL line",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0"
  },
  {
    code: "SRS-W053",
    severity: "warning",
    title: "Duplicate workflow JSONL event key",
    messageTemplate: "Duplicate workflow JSONL event key",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0"
  },
  {
    code: "SRS-W054",
    severity: "warning",
    title: "Invalid workflow JSONL correction chain",
    messageTemplate: "Invalid workflow JSONL correction chain",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0"
  },
  {
    code: "SRS-W055",
    severity: "warning",
    title: "Unsupported workflow JSONL schema version",
    messageTemplate: "Unsupported workflow JSONL schema version",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0"
  },
  {
    code: "SRS-W056",
    severity: "warning",
    title: "Workflow JSONL missing trailing LF",
    messageTemplate: "Workflow JSONL file is missing trailing LF",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0"
  },
  {
    code: "SRS-W057",
    severity: "warning",
    title: "Workflow task dependency issue",
    messageTemplate: "Workflow task dependency issue",
    sourceRule: "IR-CLI-031",
    since: "v2.3.0"
  },
  {
    code: "SRS-W058",
    severity: "warning",
    title: "Workflow PM and coder state conflict",
    messageTemplate: "Workflow PM and coder state conflict",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0"
  },
  {
    code: "SRS-W059",
    severity: "warning",
    title: "Workflow artifact hash is stale",
    messageTemplate: "Workflow artifact hash is stale",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0"
  },
  {
    code: "SRS-W060",
    severity: "warning",
    title: "Workflow plan checkbox drift",
    messageTemplate: "Workflow plan checkbox drift",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0"
  },
  {
    code: "SRS-W061",
    severity: "warning",
    title: "Workflow legacy trace field",
    messageTemplate: "Workflow legacy trace field",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0"
  },
  {
    code: "SRS-W062",
    severity: "warning",
    title: "Workflow stale lock",
    messageTemplate: "Workflow stale lock",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0"
  },
  {
    code: "SRS-W063",
    severity: "warning",
    title: "Workflow worklog audit mismatch",
    messageTemplate: "Workflow worklog audit mismatch",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0"
  },
  {
    code: "SRS-W064",
    severity: "warning",
    title: "Workflow task missing req_ids",
    messageTemplate: "Workflow task missing req_ids",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0"
  },
  {
    code: "SRS-E065",
    severity: "error",
    title: "SRS mutation lock active",
    messageTemplate: "SRS mutation lock is active",
    sourceRule: "REL-NODE-005",
    since: "v2.3.0"
  },
  {
    code: "SRS-E070",
    severity: "error",
    title: "Workflow mutation owner denied",
    messageTemplate: "Workflow mutation owner is not allowed",
    sourceRule: "FR-NODE-030",
    since: "v2.3.0"
  },
  {
    code: "SRS-E071",
    severity: "error",
    title: "Invalid workflow mutation request",
    messageTemplate: "Invalid workflow mutation request",
    sourceRule: "FR-NODE-030",
    since: "v2.3.0"
  },
  {
    code: "SRS-E072",
    severity: "error",
    title: "Workflow mutation idempotency mismatch",
    messageTemplate: "Workflow mutation idempotency key is incompatible",
    sourceRule: "FR-NODE-028",
    since: "v2.3.0"
  },
  {
    code: "SRS-E073",
    severity: "error",
    title: "Workflow logical-delete denied",
    messageTemplate: "Workflow logical-delete request is not permitted",
    sourceRule: "FR-NODE-031",
    since: "v2.3.0"
  },
  {
    code: "SRS-E074",
    severity: "error",
    title: "Workflow dependency blocked",
    messageTemplate: "Workflow mutation is blocked by task dependency state",
    sourceRule: "FR-NODE-030",
    since: "v2.3.0"
  },
  {
    code: "SRS-E075",
    severity: "error",
    title: "MCP workspace root override rejected",
    messageTemplate: "MCP per-call workspace root override is not supported",
    sourceRule: "REL-MCP-003",
    since: "v2.3.0"
  },
  {
    code: "SRS-E076",
    severity: "error",
    title: "Ambiguous Requirement ID reference",
    messageTemplate: "Ambiguous Requirement ID references require explicit edits",
    sourceRule: "FR-NODE-032",
    since: "v2.3.0"
  },
  {
    code: "SRS-W065",
    severity: "warning",
    title: "SRS status cache fallback",
    messageTemplate: "SRS status cache ignored",
    sourceRule: "FR-NODE-027",
    since: "v2.3.0"
  },
  {
    code: "SRS-W066",
    severity: "warning",
    title: "SRS status cache write failed",
    messageTemplate: "SRS status cache write failed",
    sourceRule: "FR-NODE-027",
    since: "v2.3.0"
  },
  {
    code: "SRS-W067",
    severity: "warning",
    title: "SRS mutation lock bypassed",
    messageTemplate: "SRS mutation lock bypassed",
    sourceRule: "REL-NODE-005",
    since: "v2.3.0"
  },
  {
    code: "SRS-W068",
    severity: "warning",
    title: "Stale SRS mutation lock recovered",
    messageTemplate: "Stale SRS mutation lock recovered",
    sourceRule: "REL-NODE-005",
    since: "v2.3.0"
  },
  {
    code: "SRS-W069",
    severity: "warning",
    title: "Invalid workflow deleted status",
    messageTemplate: "Workflow JSONL status=DELETED is invalid",
    sourceRule: "FR-NODE-031",
    since: "v2.3.0"
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
