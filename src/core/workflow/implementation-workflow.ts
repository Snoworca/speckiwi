import type { ParsedWorkspace, RequirementRecord } from "../types.js";

export interface WorkflowGuide {
  requirementId: string;
  steps: string[];
}

export interface EvidenceWorkflowGuide {
  requirementId: string;
  canMarkVerified: boolean;
  steps: string[];
}

export function summarizeImplementationWorkflow(workspace: ParsedWorkspace, requirementId: string): WorkflowGuide {
  const record = workspace.records.find((candidate) => candidate.id === requirementId);
  return {
    requirementId,
    steps: [
      "Open docs/spec/00.index.md and locate the relevant scope document.",
      `Read the Requirement Block ${requirementId}${record ? ` in ${record.filePath}` : ""}.`,
      "Use Requirement, Rationale, Acceptance Criteria, Trace Links, and Implementation Notes as implementation input.",
      "Implement with tests.",
      "Add Verification Evidence, check satisfied Acceptance Criteria, then update status only after verified guard passes."
    ]
  };
}

export function summarizeEvidenceWorkflow(record: RequirementRecord): EvidenceWorkflowGuide {
  const canMarkVerified =
    record.acceptanceCriteria.length > 0 &&
    record.acceptanceCriteria.every((criterion) => criterion.checked) &&
    record.verificationEvidence.some((evidence) => evidence.reference.trim() !== "");
  return {
    requirementId: record.id,
    canMarkVerified,
    steps: [
      `Add evidence for ${record.id} with speckiwi add-evidence or MCP add_verification_evidence.`,
      "Check each satisfied AC with speckiwi check-ac or MCP check_acceptance_criteria.",
      canMarkVerified ? "Status may be updated to verified." : "Keep status implemented until all AC are checked and evidence exists."
    ]
  };
}
