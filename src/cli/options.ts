import type { RequirementFilter, RequirementStatus, RequirementType } from "../core/types.js";

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

export function parseFilter(raw: Record<string, unknown>): RequirementFilter {
  const filter: RequirementFilter = {};
  if (typeof raw.target === "string") filter.target = raw.target;
  if (typeof raw.status === "string") filter.status = raw.status as RequirementStatus;
  if (typeof raw.type === "string") filter.type = raw.type as RequirementType;
  if (typeof raw.scope === "string") filter.scope = raw.scope;
  if (typeof raw.tag === "string") filter.tag = raw.tag;
  return filter;
}
