import type { ParsedWorkspace, TargetSummary } from "../types.js";

export function resolveActiveTarget(workspace: ParsedWorkspace): string {
  return workspace.index.targets.find((target) => target.status === "active")?.target ?? workspace.index.targets[0]?.target ?? "";
}

export function summarizeTarget(workspace: ParsedWorkspace, target = resolveActiveTarget(workspace)): TargetSummary {
  const records = workspace.records.filter((record) => record.target === target);
  const countsByStatus: Record<string, number> = {};
  const implementedNotVerified: string[] = [];
  const missingEvidence: string[] = [];
  for (const record of records) {
    countsByStatus[record.status] = (countsByStatus[record.status] ?? 0) + 1;
    if (record.status === "implemented") implementedNotVerified.push(record.id);
    if ((record.status === "implemented" || record.status === "verified") && record.verificationEvidence.length === 0) {
      missingEvidence.push(record.id);
    }
  }
  return { target, countsByStatus, total: records.length, implementedNotVerified, missingEvidence };
}
