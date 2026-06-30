import type { Priority, RequirementFilter, RequirementStatus, RequirementType, Stability } from "../core/types.js";

export interface CommonOptions {
  root?: string;
  json?: boolean;
  noColor?: boolean;
  quiet?: boolean;
}

export function parseCommonOptions(raw: Record<string, unknown>): CommonOptions {
  return {
    ...(typeof raw.root === "string" ? { root: raw.root } : {}),
    ...(typeof raw.json === "boolean" ? { json: raw.json } : {}),
    ...(typeof raw.noColor === "boolean" ? { noColor: raw.noColor } : {}),
    ...(typeof raw.quiet === "boolean" ? { quiet: raw.quiet } : {})
  };
}

// @req FR-PARSE-019
function parseBooleanFilter(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return undefined;
}

export function parseFilter(raw: Record<string, unknown>): RequirementFilter {
  const filter: RequirementFilter = {};
  if (typeof raw.target === "string") filter.target = raw.target;
  if (typeof raw.status === "string") filter.status = raw.status as RequirementStatus;
  if (typeof raw.type === "string") filter.type = raw.type as RequirementType;
  if (typeof raw.scope === "string") filter.scope = raw.scope;
  if (typeof raw.tag === "string") filter.tag = raw.tag;
  if (typeof raw.stability === "string") filter.stability = raw.stability as Stability;
  if (typeof raw.priority === "string") filter.priority = raw.priority as Priority;
  if (typeof raw.relatedDoc === "string") filter.relatedDoc = raw.relatedDoc;
  if (typeof raw.evidenceReference === "string") filter.evidenceReference = raw.evidenceReference;
  if (typeof raw.traceReference === "string") filter.traceReference = raw.traceReference;
  const missingEvidence = parseBooleanFilter(raw.missingEvidence);
  if (missingEvidence !== undefined) filter.missingEvidence = missingEvidence;
  const newWorkCandidate = parseBooleanFilter(raw.newWorkCandidate);
  if (newWorkCandidate !== undefined) filter.newWorkCandidate = newWorkCandidate;
  return filter;
}
