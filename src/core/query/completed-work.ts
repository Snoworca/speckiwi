import type { CompletedWorkEntry, ParsedWorkspace } from "../types.js";

export interface CompletedWorkFilter {
  target?: string;
  scope?: string;
  since?: string;
  limit?: number;
  order?: "latest" | "file";
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
  return typeof filter.limit === "number" && Number.isInteger(filter.limit) && filter.limit > 0 ? rows.slice(0, filter.limit) : rows;
}
