import type { RequirementFilter, RequirementRecord } from "../types.js";

// @req FR-PARSE-019
// Exported for FR-NODE-112: the routing probe's anchored-requirement set stands in for a
// `list_requirements({traceReference})` call, so it must normalize a path exactly as this filter does.
export function normalizeFilterReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed.replace(/#.*$/, "");
  const withoutFragment = trimmed.replace(/#.*$/, "").replace(/\\/g, "/");
  if (withoutFragment.startsWith("../")) return `docs/${withoutFragment.replace(/^\.\.\//, "")}`;
  return withoutFragment.replace(/^\.\//, "").replace(/^\/+/, "");
}

// @req FR-PARSE-019
function normalizedReferencesInclude(values: readonly string[] | undefined, reference: string): boolean {
  const normalized = normalizeFilterReference(reference);
  return Boolean(normalized && values?.includes(normalized));
}

// @req FR-PARSE-019
function recordNewWorkCandidate(record: RequirementRecord): boolean {
  return (record.status === "planned" || record.status === "in_progress" || record.status === "blocked") && record.stability !== "draft" && record.stability !== "deprecated";
}

export function matchesRequirementFilter(record: RequirementRecord, filter: RequirementFilter): boolean {
  if (filter.target && record.target !== filter.target) return false;
  if (filter.status && record.status !== filter.status) return false;
  if (filter.type && record.type !== filter.type) return false;
  if (filter.scope && record.scope !== filter.scope) return false;
  if (filter.tag && !record.tags.includes(filter.tag)) return false;
  if (filter.stability && record.stability !== filter.stability) return false;
  if (filter.priority && record.priority !== filter.priority) return false;
  if (typeof filter.missingEvidence === "boolean" && (record.verificationEvidence.length === 0) !== filter.missingEvidence) return false;
  if (filter.relatedDoc && !normalizedReferencesInclude(record.relatedDocs, filter.relatedDoc)) return false;
  if (filter.evidenceReference && !normalizedReferencesInclude(record.evidenceReferences, filter.evidenceReference)) return false;
  if (filter.traceReference && !normalizedReferencesInclude(record.traceReferences, filter.traceReference)) return false;
  if (typeof filter.newWorkCandidate === "boolean" && recordNewWorkCandidate(record) !== filter.newWorkCandidate) return false;
  return true;
}
