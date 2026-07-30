import type { DiagnosticDefinition } from "./types.js";

export const DIAGNOSTIC_DEFINITIONS: DiagnosticDefinition[] = [
  {
    code: "SRS-E001",
    severity: "error",
    title: "Malformed requirement heading",
    messageTemplate: "Malformed requirement heading",
    sourceRule: "FR-PARSE-002",
    since: "v1.0.0",
    remediation:
      "Rewrite the requirement heading to match `### <ID> — <Title>` with the ID, an em dash, and a title."
  },
  {
    code: "SRS-E002",
    severity: "error",
    title: "Duplicate requirement ID",
    messageTemplate: "Duplicate requirement ID: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation:
      "Resolve the duplicate with `speckiwi repair requirement-id-collisions` so each Requirement ID is unique."
  },
  {
    code: "SRS-E003",
    severity: "error",
    title: "Required metadata field missing",
    messageTemplate: "Missing required metadata field: {field}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Add the missing metadata field to the requirement's metadata table."
  },
  {
    code: "SRS-E004",
    severity: "error",
    title: "Type does not match requirement ID prefix",
    messageTemplate: "Type does not match ID prefix for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Align the Type metadata value with the Requirement ID prefix, or correct the ID prefix."
  },
  {
    code: "SRS-E005",
    severity: "error",
    title: "Invalid requirement status",
    messageTemplate: "Invalid status for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation:
      "Set Status to a supported value (draft, in_progress, blocked, implemented, verified, discarded)."
  },
  {
    code: "SRS-E006",
    severity: "error",
    title: "Invalid requirement priority",
    messageTemplate: "Invalid priority for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Set Priority to a supported value (P0, P1, P2, P3)."
  },
  {
    code: "SRS-E007",
    severity: "error",
    title: "Invalid requirement risk",
    messageTemplate: "Invalid risk for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Set Risk to a supported value (low, medium, high)."
  },
  {
    code: "SRS-E008",
    severity: "error",
    title: "Acceptance Criteria section missing",
    messageTemplate: "Acceptance Criteria missing for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Add an Acceptance Criteria section with at least one checkable criterion to the requirement."
  },
  {
    code: "SRS-E010",
    severity: "error",
    title: "Verified requirement lacks checked AC or evidence",
    messageTemplate: "Verified requirement lacks checked AC or evidence: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Add checked acceptance criteria and verification evidence before marking the requirement verified."
  },
  {
    code: "SRS-E011",
    severity: "error",
    title: "Invalid requirement stability",
    messageTemplate: "Invalid stability for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Set Stability to a supported value (draft, evolving, stable, frozen, deprecated)."
  },
  {
    code: "SRS-E012",
    severity: "error",
    title: "Trace requirement reference missing",
    messageTemplate: "Trace target does not exist: {reference}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Point the trace link at an existing Requirement ID, or remove the dangling reference."
  },
  {
    code: "SRS-E013",
    severity: "error",
    title: "Target Map table missing",
    messageTemplate: "Target Map table is missing",
    sourceRule: "FR-PARSE-010",
    since: "v1.0.0",
    remediation: "Add the Target Map table to 00.index.md so targets can be resolved."
  },
  {
    code: "SRS-E014",
    severity: "error",
    title: "Scope Map table missing",
    messageTemplate: "Scope Map table is missing",
    sourceRule: "FR-PARSE-010",
    since: "v1.0.0",
    remediation: "Add the Scope Map table to 00.index.md so scope prefixes can be resolved."
  },
  {
    code: "SRS-E015",
    severity: "error",
    title: "Scope prefix is not registered",
    messageTemplate: "Scope prefix is not registered: {scope}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Register the scope prefix in the Scope Map, or fix the Requirement ID to use a registered prefix."
  },
  {
    code: "SRS-E016",
    severity: "error",
    title: "Scope document is missing",
    messageTemplate: "Scope document is missing for {scope}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Create the scope SRS document referenced by the Scope Map, or correct its path."
  },
  {
    code: "SRS-E017",
    severity: "error",
    title: "Active Target is not registered",
    messageTemplate: "Active Target is not registered: {target}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Register the Active Target in the Target Map, or set the Active Target to a registered target."
  },
  {
    code: "SRS-E018",
    severity: "error",
    title: "Duplicate requirement section",
    messageTemplate: "Duplicate requirement section: {section}",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0",
    remediation: "Merge or remove the duplicated section so each requirement section appears once."
  },
  {
    code: "SRS-E019",
    severity: "error",
    title: "Nested acceptance criterion",
    messageTemplate: "Nested acceptance criterion is not allowed: {criterionId}",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0",
    remediation: "Flatten the acceptance criterion to a single top-level list item."
  },
  {
    code: "SRS-E020",
    severity: "error",
    title: "Forbidden requirement heading content",
    messageTemplate: "Requirement heading contains forbidden Markdown content: {requirementId}",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0",
    remediation: "Remove inline Markdown formatting from the requirement heading; keep it plain ID, dash, and title."
  },
  {
    code: "SRS-E021",
    severity: "error",
    title: "Malformed metadata table row",
    messageTemplate: "Metadata table row cell count does not match header count",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0",
    remediation: "Fix the metadata table so every row has the same number of cells as the header row."
  },
  {
    code: "SRS-E022",
    severity: "error",
    title: "Duplicate Target Map target",
    messageTemplate: "Duplicate Target Map target: {target}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0",
    remediation: "Remove the duplicate Target Map row so each target appears exactly once."
  },
  {
    code: "SRS-E023",
    severity: "error",
    title: "Duplicate Scope Map prefix",
    messageTemplate: "Duplicate Scope Map prefix: {prefix}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0",
    remediation: "Remove the duplicate Scope Map row so each scope prefix appears exactly once."
  },
  {
    code: "SRS-E024",
    severity: "error",
    title: "Multiple active targets",
    messageTemplate: "Multiple Target Map rows are marked active",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0",
    remediation: "Mark exactly one Target Map row as active."
  },
  {
    code: "SRS-E025",
    severity: "error",
    title: "Scope document file missing",
    messageTemplate: "Scope document file is missing: {document}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0",
    remediation: "Create the missing scope document file, or update the Scope Map path to an existing file."
  },
  {
    code: "SRS-E032",
    severity: "error",
    title: "Stale mutation snapshot",
    messageTemplate: "Mutation snapshot is stale for {filePath}",
    sourceRule: "FR-NODE-013",
    since: "v1.2.0",
    remediation: "Re-read the file to refresh the snapshot before retrying the mutation."
  },
  {
    code: "SRS-E033",
    severity: "error",
    title: "Verified draft requirement",
    messageTemplate: "Verified requirement uses draft stability: {requirementId}",
    sourceRule: "FR-PARSE-015",
    since: "v1.3.0",
    remediation: "Promote the requirement's Stability past draft before marking it verified."
  },
  {
    code: "SRS-W001",
    severity: "warning",
    title: "Rationale section missing",
    messageTemplate: "Rationale section missing for {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Add a Rationale section explaining why the requirement exists."
  },
  {
    code: "SRS-W002",
    severity: "warning",
    title: "Target is not registered",
    messageTemplate: "Target is not registered: {target}",
    sourceRule: "FR-PARSE-010",
    since: "v1.0.0",
    remediation: "Register the target in the Target Map, or correct the referenced target name."
  },
  {
    code: "SRS-W003",
    severity: "warning",
    title: "Related Docs local link missing",
    messageTemplate: "Related Docs local link is missing: {reference}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Create the linked local document, or fix the Related Docs link path."
  },
  {
    code: "SRS-W004",
    severity: "warning",
    title: "GitHub Issue URL format invalid",
    messageTemplate: "GitHub Issue URL format is invalid: {url}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Use a well-formed GitHub issue URL (https://github.com/<owner>/<repo>/issues/<n>)."
  },
  {
    code: "SRS-W008",
    severity: "warning",
    title: "High risk requirement lacks Research / Analysis",
    messageTemplate: "High risk requirement lacks Research / Analysis: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Add a Research or Analysis section for the high-risk requirement."
  },
  {
    code: "SRS-W009",
    severity: "warning",
    title: "Frozen target changed without Change Notes",
    messageTemplate: "Frozen target requirement changed without Change Notes: {requirementId}",
    sourceRule: "FR-PARSE-009",
    since: "v1.0.0",
    remediation: "Add a Change Notes entry documenting the change to the frozen-target requirement."
  },
  {
    code: "SRS-W010",
    severity: "warning",
    title: "Active Target row is not active",
    messageTemplate: "Active Target row is not marked active: {target}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Mark the Active Target's Target Map row as active."
  },
  {
    code: "SRS-W011",
    severity: "warning",
    title: "Completed Work Log date is invalid",
    messageTemplate: "Completed Work Log date is not YYYY-MM-DD: {date}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Format the Completed Work Log date as YYYY-MM-DD."
  },
  {
    code: "SRS-W012",
    severity: "warning",
    title: "Completed Work Log target is not registered",
    messageTemplate: "Completed Work Log target is not registered: {target}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Register the Completed Work Log target in the Target Map, or correct the target name."
  },
  {
    code: "SRS-W013",
    severity: "warning",
    title: "Completed Work Log scope is not registered",
    messageTemplate: "Completed Work Log scope is not registered: {scope}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Register the Completed Work Log scope in the Scope Map, or correct the scope prefix."
  },
  {
    code: "SRS-W014",
    severity: "warning",
    title: "Completed Work Log requirement is missing",
    messageTemplate: "Completed Work Log requirement does not exist: {requirementId}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Reference an existing Requirement ID in the Completed Work Log, or remove the stale row."
  },
  {
    code: "SRS-W015",
    severity: "warning",
    title: "Completed Work Log requirement is not completed",
    messageTemplate: "Completed Work Log requirement is not completed: {requirementId}",
    sourceRule: "FR-PARSE-010",
    since: "v1.1.0",
    remediation: "Advance the requirement to a completed status, or remove it from the Completed Work Log."
  },
  {
    code: "SRS-W016",
    severity: "warning",
    title: "Malformed Verification Evidence table row",
    messageTemplate: "Verification Evidence table row cell count does not match header count",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0",
    remediation: "Fix the Verification Evidence table so every row matches the header cell count."
  },
  {
    code: "SRS-W017",
    severity: "warning",
    title: "Malformed Trace Links table row",
    messageTemplate: "Trace Links table row cell count does not match header count",
    sourceRule: "FR-PARSE-012",
    since: "v1.2.0",
    remediation: "Fix the Trace Links table so every row matches the header cell count."
  },
  {
    code: "SRS-W018",
    severity: "warning",
    title: "Unregistered scope SRS document",
    messageTemplate: "Scope SRS document is not registered in Scope Map: {document}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0",
    remediation: "Register the scope SRS document in the Scope Map, or remove the unregistered file."
  },
  {
    code: "SRS-W019",
    severity: "warning",
    title: "Status Summary drift",
    messageTemplate: "Status Summary count drift for {status}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0",
    remediation: "Regenerate the Status Summary so its counts match the requirement blocks."
  },
  {
    code: "SRS-W020",
    severity: "warning",
    title: "Requirement Type Summary drift",
    messageTemplate: "Requirement Type Summary count drift for {type}",
    sourceRule: "FR-PARSE-014",
    since: "v1.2.0",
    remediation: "Regenerate the Requirement Type Summary so its counts match the requirement blocks."
  },
  {
    code: "SRS-W022",
    severity: "warning",
    title: "Legacy volatile stability",
    messageTemplate: "Legacy volatile stability should be migrated: {requirementId}",
    sourceRule: "FR-PARSE-015",
    since: "v1.3.0",
    remediation: "Migrate the legacy volatile stability value to a supported stability level."
  },
  {
    code: "SRS-W023",
    severity: "warning",
    title: "Draft requirement in active or released target",
    messageTemplate: "Draft requirement is not ready as an implementation contract: {requirementId}",
    sourceRule: "FR-PARSE-015",
    since: "v1.3.0",
    remediation: "Promote the requirement past draft stability before treating it as an implementation contract."
  },
  {
    code: "SRS-W024",
    severity: "warning",
    title: "Malformed Completed Work Log report path",
    messageTemplate: "Completed Work Log report path is malformed: {path}",
    sourceRule: "FR-PARSE-016",
    since: "v2.1.1",
    remediation: "Fix the Completed Work Log report path to a well-formed workspace-relative path."
  },
  {
    code: "SRS-W025",
    severity: "warning",
    title: "Completed Work Log duplicate across index and history",
    messageTemplate: "Completed Work Log row is duplicated across the index and history file: {row}",
    sourceRule: "FR-PARSE-030",
    since: "v2.3.0",
    remediation: "Keep the Completed Work Log row in a single source and remove the duplicate."
  },
  {
    code: "SRS-W040",
    severity: "warning",
    title: "Target Goal block conflict between index and appendix",
    messageTemplate: "Target Goal block for '{target}' defined in both 00.index.md and 90.appendix.md; appendix value wins",
    sourceRule: "FR-PARSE-018",
    since: "v2.2.2",
    remediation: "Define the Target Goal block in a single file to remove the index/appendix conflict."
  },
  {
    code: "SRS-W041",
    severity: "warning",
    title: "Completed Work Log duplicate source",
    messageTemplate: "Completed Work Log rows exist in both 00.index.md and 05.completed-work.md",
    sourceRule: "FR-PARSE-021",
    since: "v2.3.0",
    remediation: "Consolidate Completed Work Log rows into a single source file."
  },
  {
    code: "SRS-E050",
    severity: "error",
    title: "Workflow artifact path escapes workspace",
    messageTemplate: "Workflow artifact path is outside the project root: {path}",
    sourceRule: "FR-NODE-020",
    since: "v2.3.0",
    remediation: "Move the workflow artifact inside the project root and use a workspace-relative path."
  },
  {
    code: "SRS-E051",
    severity: "error",
    title: "Ambiguous workflow artifact",
    messageTemplate: "Workflow artifact resolution is ambiguous",
    sourceRule: "FR-NODE-020",
    since: "v2.3.0",
    remediation: "Remove duplicate workflow artifacts so a single artifact resolves unambiguously."
  },
  {
    code: "SRS-W050",
    severity: "warning",
    title: "Workflow artifact parse warning",
    messageTemplate: "Workflow artifact parse warning: {path}",
    sourceRule: "FR-NODE-020",
    since: "v2.3.0",
    remediation: "Fix the workflow artifact so it parses cleanly, then re-run validation."
  },
  {
    code: "SRS-W051",
    severity: "warning",
    title: "Workflow artifact companion missing",
    messageTemplate: "Workflow artifact companion is missing: {path}",
    sourceRule: "FR-NODE-020",
    since: "v2.3.0",
    remediation: "Create the missing companion workflow artifact, or remove the reference to it."
  },
  {
    code: "SRS-W052",
    severity: "warning",
    title: "Invalid workflow JSONL line",
    messageTemplate: "Invalid workflow JSONL line",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0",
    remediation: "Fix the malformed JSONL line so it is a single valid JSON object."
  },
  {
    code: "SRS-W053",
    severity: "warning",
    title: "Duplicate workflow JSONL event key",
    messageTemplate: "Duplicate workflow JSONL event key",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0",
    remediation: "Remove the duplicate JSONL event so each event key is unique."
  },
  {
    code: "SRS-W054",
    severity: "warning",
    title: "Invalid workflow JSONL correction chain",
    messageTemplate: "Invalid workflow JSONL correction chain",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0",
    remediation: "Repair the correction chain so each correction references a valid prior event."
  },
  {
    code: "SRS-W055",
    severity: "warning",
    title: "Unsupported workflow JSONL schema version",
    messageTemplate: "Unsupported workflow JSONL schema version",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0",
    remediation: "Migrate the JSONL file to a supported schema version."
  },
  {
    code: "SRS-W056",
    severity: "warning",
    title: "Workflow JSONL missing trailing LF",
    messageTemplate: "Workflow JSONL file is missing trailing LF",
    sourceRule: "FR-NODE-021",
    since: "v2.3.0",
    remediation: "Add a trailing LF newline to the end of the JSONL file."
  },
  {
    code: "SRS-W057",
    severity: "warning",
    title: "Workflow task dependency issue",
    messageTemplate: "Workflow task dependency issue",
    sourceRule: "IR-CLI-031",
    since: "v2.3.0",
    remediation: "Resolve the task dependency conflict or missing dependency in the workflow plan."
  },
  {
    code: "SRS-W058",
    severity: "warning",
    title: "Workflow PM and coder state conflict",
    messageTemplate: "Workflow PM and coder state conflict",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0",
    remediation: "Reconcile the PM and coder state files so their task states agree."
  },
  {
    code: "SRS-W059",
    severity: "warning",
    title: "Workflow artifact hash is stale",
    messageTemplate: "Workflow artifact hash is stale",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0",
    remediation: "Recompute and update the workflow artifact hash to match the current content."
  },
  {
    code: "SRS-W060",
    severity: "warning",
    title: "Workflow plan checkbox drift",
    messageTemplate: "Workflow plan checkbox drift",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0",
    remediation: "Sync the plan checkboxes with the recorded task state."
  },
  {
    code: "SRS-W061",
    severity: "warning",
    title: "Workflow legacy trace field",
    messageTemplate: "Workflow legacy trace field",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0",
    remediation: "Migrate the legacy trace field to the current workflow trace format."
  },
  {
    code: "SRS-W062",
    severity: "warning",
    title: "Workflow stale lock",
    messageTemplate: "Workflow stale lock",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0",
    remediation: "Remove the stale workflow lock after confirming no writer is active."
  },
  {
    code: "SRS-W063",
    severity: "warning",
    title: "Workflow worklog audit mismatch",
    messageTemplate: "Workflow worklog audit mismatch",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0",
    remediation: "Reconcile the worklog with the audit trail to resolve the mismatch."
  },
  {
    code: "SRS-W064",
    severity: "warning",
    title: "Workflow task missing req_ids",
    messageTemplate: "Workflow task missing req_ids",
    sourceRule: "REL-NODE-003",
    since: "v2.3.0",
    remediation: "Add the covering Requirement IDs to the workflow task."
  },
  {
    code: "SRS-E065",
    severity: "error",
    title: "SRS mutation lock active",
    messageTemplate: "SRS mutation lock is active",
    sourceRule: "REL-NODE-005",
    since: "v2.3.0",
    remediation: "Wait for the active SRS mutation to finish, or clear the stale lock before retrying."
  },
  {
    code: "SRS-E070",
    severity: "error",
    title: "Workflow mutation owner denied",
    messageTemplate: "Workflow mutation owner is not allowed",
    sourceRule: "FR-NODE-030",
    since: "v2.3.0",
    remediation: "Perform the mutation as an authorized owner for this workflow artifact."
  },
  {
    code: "SRS-E071",
    severity: "error",
    title: "Invalid workflow mutation request",
    messageTemplate: "Invalid workflow mutation request",
    sourceRule: "FR-NODE-030",
    since: "v2.3.0",
    remediation: "Correct the workflow mutation request payload to match the required schema."
  },
  {
    code: "SRS-E072",
    severity: "error",
    title: "Workflow mutation idempotency mismatch",
    messageTemplate: "Workflow mutation idempotency key is incompatible",
    sourceRule: "FR-NODE-028",
    since: "v2.3.0",
    remediation: "Use a fresh idempotency key, or reuse the original request payload for the existing key."
  },
  {
    code: "SRS-E073",
    severity: "error",
    title: "Workflow logical-delete denied",
    messageTemplate: "Workflow logical-delete request is not permitted",
    sourceRule: "FR-NODE-031",
    since: "v2.3.0",
    remediation: "Use an allowed status transition instead of a logical-delete for this workflow entry."
  },
  {
    code: "SRS-E074",
    severity: "error",
    title: "Workflow dependency blocked",
    messageTemplate: "Workflow mutation is blocked by task dependency state",
    sourceRule: "FR-NODE-030",
    since: "v2.3.0",
    remediation: "Complete the blocking dependency tasks before applying this workflow mutation."
  },
  {
    code: "SRS-E075",
    severity: "error",
    title: "MCP workspace root override rejected",
    messageTemplate: "MCP per-call workspace root override is not supported",
    sourceRule: "REL-MCP-003",
    since: "v2.3.0",
    remediation: "Configure the workspace root at server startup instead of passing a per-call root override."
  },
  {
    code: "SRS-E076",
    severity: "error",
    title: "Ambiguous Requirement ID reference",
    messageTemplate: "Ambiguous Requirement ID references require explicit edits",
    sourceRule: "FR-NODE-032",
    since: "v2.3.0",
    remediation: "Disambiguate the reference by specifying explicit filePath, headingLine, and blockHash."
  },
  {
    code: "SRS-W065",
    severity: "warning",
    title: "SRS status cache fallback",
    messageTemplate: "SRS status cache ignored",
    sourceRule: "FR-NODE-027",
    since: "v2.3.0",
    remediation: "Rebuild the SRS status cache to restore fast-path status resolution."
  },
  {
    code: "SRS-W066",
    severity: "warning",
    title: "SRS status cache write failed",
    messageTemplate: "SRS status cache write failed",
    sourceRule: "FR-NODE-027",
    since: "v2.3.0",
    remediation: "Ensure the cache directory is writable so the SRS status cache can persist."
  },
  {
    code: "SRS-W067",
    severity: "warning",
    title: "SRS mutation lock bypassed",
    messageTemplate: "SRS mutation lock bypassed",
    sourceRule: "REL-NODE-005",
    since: "v2.3.0",
    remediation: "Avoid --ignore-lock unless the lock is confirmed stale; prefer waiting for the writer."
  },
  {
    code: "SRS-W068",
    severity: "warning",
    title: "Stale SRS mutation lock recovered",
    messageTemplate: "Stale SRS mutation lock recovered",
    sourceRule: "REL-NODE-005",
    since: "v2.3.0",
    remediation: "No action needed; confirm no other writer was running when the stale lock was recovered."
  },
  {
    code: "SRS-W069",
    severity: "warning",
    title: "Invalid workflow deleted status",
    messageTemplate: "Workflow JSONL status=DELETED is invalid",
    sourceRule: "FR-NODE-031",
    since: "v2.3.0",
    remediation: "Replace the invalid DELETED status with a supported workflow status value."
  },
  {
    code: "SRS-W070",
    severity: "warning",
    title: "Scope documents share a leading number",
    messageTemplate: "Scope SRS documents share the leading number {number}: {documents}",
    sourceRule: "FR-PARSE-034",
    since: "v2.5.0",
    remediation: "Repairing a collision is the one case where a scope document is renamed: give all but one of the colliding documents an unused number above the highest in use, and update the Scope Map and SRS Documents rows that name them."
  },
  {
    code: "SRS-W071",
    severity: "warning",
    title: "Requirement heading outside a Requirements section",
    messageTemplate: "Requirement heading {id} is outside a Requirements section and is not parsed as a requirement",
    sourceRule: "FR-PARSE-035",
    since: "v2.5.1",
    remediation:
      "Move the block into the document's Requirements section so it is parsed, or rename the heading so it is not requirement-shaped when the block is illustrative."
  },
  {
    code: "SRS-W072",
    severity: "warning",
    title: "Numbered document shares a leading number with a scope document",
    messageTemplate: "{document} shares the leading number {number} with the scope document {scopeDocument}",
    sourceRule: "FR-PARSE-037",
    since: "v2.5.1",
    remediation:
      "Rename the non-scope document to an unused number, since the scope document's number is the ordering key its Scope Map row names."
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
