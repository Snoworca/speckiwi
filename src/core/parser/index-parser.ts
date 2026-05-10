import { diagnostic } from "../diagnostic.js";
import type {
  CompletedWorkEntry,
  Diagnostic,
  IndexDocument,
  RequirementTypeSummaryEntry,
  ScopeEntry,
  StatusSummaryEntry,
  TargetEntry,
  TextFile
} from "../types.js";
import { parseMarkdownTable, parseMetadataRows } from "./table.js";

function extractLinkTarget(value: string): string {
  const match = /\[[^\]]+]\(([^)]+)\)/.exec(value);
  return match?.[1] ?? value;
}

function findHeadingMatching(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function hasMetadataField(metadata: Record<string, string>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(metadata, field);
}

function legacyActiveTarget(targets: TargetEntry[]): string {
  return targets.find((target) => target.status === "active")?.target ?? targets[0]?.target ?? "";
}

function parseCompletedWork(lines: string[]): CompletedWorkEntry[] {
  const heading = findHeadingMatching(lines, /^##\s+\d+\.\s+Completed Work Log$/);
  const table = heading >= 0 ? parseMarkdownTable(lines, heading + 1) : undefined;
  if (!table) return [];
  return table.rows.map((row, index) => ({
    date: row.Date ?? "",
    target: row.Target ?? "",
    scope: row.Scope ?? "",
    requirementIds: (row["Requirement IDs"] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    summary: row.Summary ?? "",
    line: table.startLine + 2 + index
  }));
}

function parseCount(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseStatusSummary(lines: string[]): StatusSummaryEntry[] | undefined {
  const heading = findHeadingMatching(lines, /^##\s+\d+\.\s+Status Summary$/);
  const table = heading >= 0 ? parseMarkdownTable(lines, heading + 1) : undefined;
  if (!table) return undefined;
  return table.rows.map((row, index) => ({
    status: row.Status ?? "",
    count: parseCount(row.Count ?? ""),
    line: table.startLine + 2 + index
  }));
}

function parseRequirementTypeSummary(lines: string[]): RequirementTypeSummaryEntry[] | undefined {
  const heading = findHeadingMatching(lines, /^##\s+\d+\.\s+Requirement Type Summary$/);
  const table = heading >= 0 ? parseMarkdownTable(lines, heading + 1) : undefined;
  if (!table) return undefined;
  return table.rows.map((row, index) => ({
    type: row.Type ?? "",
    prefix: row.Prefix ?? "",
    count: parseCount(row.Count ?? ""),
    line: table.startLine + 2 + index
  }));
}

export function parseIndexDocument(file: TextFile): { index: IndexDocument; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const { metadata } = parseMetadataRows(file.lines, 1);
  const targetStart = findHeadingMatching(file.lines, /^##\s+\d+\.\s+Target Map$/);
  const scopeStart = findHeadingMatching(file.lines, /^##\s+\d+\.\s+Scope Map$/);
  const targetTable = targetStart >= 0 ? parseMarkdownTable(file.lines, targetStart + 1) : undefined;
  const scopeTable = scopeStart >= 0 ? parseMarkdownTable(file.lines, scopeStart + 1) : undefined;

  if (!targetTable) {
    diagnostics.push(diagnostic("SRS-E013", "error", "Target Map table is missing", { filePath: file.relativePath }));
  }
  if (!scopeTable) {
    diagnostics.push(diagnostic("SRS-E014", "error", "Scope Map table is missing", { filePath: file.relativePath }));
  }

  const targets: TargetEntry[] = (targetTable?.rows ?? []).map((row) => ({
    target: row.Target ?? "",
    type: row.Type ?? "",
    status: row.Status ?? "",
    description: row.Description ?? ""
  }));
  const scopes: ScopeEntry[] = (scopeTable?.rows ?? []).map((row) => ({
    scope: row.Scope ?? "",
    document: extractLinkTarget(row.Document ?? row["Primary Document"] ?? ""),
    prefix: row.Prefix ?? "",
    description: row.Description ?? row.Notes ?? ""
  }));
  const activeTarget = hasMetadataField(metadata, "Active Target") ? (metadata["Active Target"] ?? "").trim() : legacyActiveTarget(targets);
  const completedWork = parseCompletedWork(file.lines);
  const statusSummary = parseStatusSummary(file.lines);
  const requirementTypeSummary = parseRequirementTypeSummary(file.lines);
  const index: IndexDocument = { metadata, activeTarget, targets, scopes, completedWork };
  if (statusSummary) index.statusSummary = statusSummary;
  if (requirementTypeSummary) index.requirementTypeSummary = requirementTypeSummary;

  return { index, diagnostics };
}
