import type { CompletedWorkEntry, CompletedWorkReadModel, CompletedWorkSourceInfo, ParsedWorkspace } from "../types.js";

const LEGACY_COMPLETED_WORK_PATH = "docs/spec/00.index.md";
const EXTERNAL_COMPLETED_WORK_PATH = "docs/spec/05.completed-work.md";

export interface CompletedWorkFilter {
  target?: string;
  scope?: string;
  since?: string;
  limit?: number;
  offset?: number;
  order?: "latest" | "file";
}

export interface CompletedWorkReadModelOptions {
  defaultLimit?: number;
}

function splitScopeTokens(scope: string): string[] {
  return scope
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesTarget(entry: CompletedWorkEntry, target?: string): boolean {
  if (!target) return true;
  return entry.target === target || entry.target.trim() === "";
}

function matchesScope(entry: CompletedWorkEntry, scope?: string): boolean {
  if (!scope) return true;
  return splitScopeTokens(entry.scope).includes(scope);
}

function matchesSince(entry: CompletedWorkEntry, since?: string): boolean {
  if (!since) return true;
  return entry.date >= since;
}

function compareLatest(a: CompletedWorkEntry, b: CompletedWorkEntry): number {
  const byDate = b.date.localeCompare(a.date);
  if (byDate !== 0) return byDate;
  return (b.line ?? 0) - (a.line ?? 0);
}

export function listCompletedWork(workspace: ParsedWorkspace, filter: CompletedWorkFilter = {}): CompletedWorkEntry[] {
  const rows = workspace.index.completedWork.filter((entry) => matchesTarget(entry, filter.target) && matchesScope(entry, filter.scope) && matchesSince(entry, filter.since));
  if (filter.order !== "file") rows.sort(compareLatest);
  const offset = typeof filter.offset === "number" && Number.isInteger(filter.offset) && filter.offset > 0 ? filter.offset : 0;
  const limited = rows.slice(offset);
  return typeof filter.limit === "number" && Number.isInteger(filter.limit) && filter.limit > 0 ? limited.slice(0, filter.limit) : limited;
}

export function completedWorkSourceInfo(workspace: ParsedWorkspace): CompletedWorkSourceInfo {
  const hasExternalFile = workspace.files.some((file) => file.relativePath === EXTERNAL_COMPLETED_WORK_PATH);
  const sources = Array.from(new Set(workspace.index.completedWork.map((entry) => entry.filePath ?? LEGACY_COMPLETED_WORK_PATH))).sort();
  const hasLegacyRows = sources.includes(LEGACY_COMPLETED_WORK_PATH);
  const hasExternalRows = sources.includes(EXTERNAL_COMPLETED_WORK_PATH);
  return {
    mode: hasExternalFile ? "external" : "legacy",
    authoritativeFilePath: hasExternalFile ? EXTERNAL_COMPLETED_WORK_PATH : LEGACY_COMPLETED_WORK_PATH,
    sources,
    hasExternalFile,
    hasLegacyRows,
    hasExternalRows,
    duplicateSources: hasLegacyRows && hasExternalRows,
    migrationRecommended: hasExternalFile && hasLegacyRows
  };
}

export function completedWorkReadModel(workspace: ParsedWorkspace, filter: CompletedWorkFilter = {}, options: CompletedWorkReadModelOptions = {}): CompletedWorkReadModel {
  const rows = workspace.index.completedWork.filter((entry) => matchesTarget(entry, filter.target) && matchesScope(entry, filter.scope) && matchesSince(entry, filter.since));
  if (filter.order !== "file") rows.sort(compareLatest);
  const offset = typeof filter.offset === "number" && Number.isInteger(filter.offset) && filter.offset > 0 ? filter.offset : 0;
  const limit = typeof filter.limit === "number" && Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : options.defaultLimit ?? Math.max(rows.length - offset, 0);
  const completedWork = limit > 0 ? rows.slice(offset, offset + limit) : [];
  const nextOffset = offset + completedWork.length;
  const hasMore = nextOffset < rows.length;
  return {
    completedWork,
    completedWorkPage: {
      total: rows.length,
      returned: completedWork.length,
      limit,
      hasMore,
      nextOffset: hasMore ? nextOffset : null
    },
    completedWorkSource: completedWorkSourceInfo(workspace)
  };
}
