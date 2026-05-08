import type { ParsedWorkspace, RequirementFilter, RequirementRecord } from "../types.js";
import { matchesRequirementFilter } from "./filter.js";

export interface RequirementDetail extends RequirementRecord {
  markdown?: string;
}

export function listRequirements(workspace: ParsedWorkspace, filter: RequirementFilter = {}): RequirementRecord[] {
  return workspace.records.filter((record) => matchesRequirementFilter(record, filter)).sort((a, b) => a.id.localeCompare(b.id));
}

export function getRequirement(workspace: ParsedWorkspace, id: string, options: { includeMarkdown?: boolean } = {}): RequirementDetail {
  const record = workspace.records.find((candidate) => candidate.id === id);
  if (!record) {
    throw new Error(`Requirement not found: ${id}`);
  }
  if (options.includeMarkdown) return record;
  const withoutMarkdown = { ...record };
  delete withoutMarkdown.markdown;
  return withoutMarkdown;
}
