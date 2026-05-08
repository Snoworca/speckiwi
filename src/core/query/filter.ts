import type { RequirementFilter, RequirementRecord } from "../types.js";

export function matchesRequirementFilter(record: RequirementRecord, filter: RequirementFilter): boolean {
  if (filter.target && record.target !== filter.target) return false;
  if (filter.status && record.status !== filter.status) return false;
  if (filter.type && record.type !== filter.type) return false;
  if (filter.scope && record.scope !== filter.scope) return false;
  if (filter.tag && !record.tags.includes(filter.tag)) return false;
  return true;
}
