import { diagnostic } from "../diagnostic.js";
import { parseReportPathCell, REPORT_PATHS_COLUMN } from "../completed-work/report-paths.js";
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
import { parseMarkdownTable, parseMetadataRows, splitTableRow } from "./table.js";

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

// @req FR-PARSE-021
export function parseCompletedWork(file: Pick<TextFile, "lines" | "relativePath">): CompletedWorkEntry[] {
  const heading = findHeadingMatching(file.lines, /^##\s+\d+\.\s+Completed Work Log$/);
  const table = heading >= 0 ? parseMarkdownTable(file.lines, heading + 1) : undefined;
  if (!table) return [];
  return table.rows.map((row, index) => {
    const reportPathsIndex = table.headers.at(-1) === REPORT_PATHS_COLUMN ? table.headers.length - 1 : -1;
    const rowLine = table.rowLines[index] ?? table.startLine + 2 + index;
    const sourceCells = splitTableRow(file.lines[rowLine - 1] ?? "");
    const reportPathsCell =
      reportPathsIndex < 0
        ? ""
        : sourceCells.length > table.headers.length
          ? sourceCells.slice(reportPathsIndex).join("|").trim()
          : row[REPORT_PATHS_COLUMN] ?? "";
    const entry: CompletedWorkEntry = {
      date: row.Date ?? "",
      target: row.Target ?? "",
      scope: row.Scope ?? "",
      requirementIds: (row["Requirement IDs"] ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      summary: row.Summary ?? "",
      reportPaths: parseReportPathCell(reportPathsCell).paths,
      filePath: file.relativePath,
      line: rowLine
    };
    Object.defineProperty(entry, "reportPathsCell", { value: reportPathsCell, enumerable: false });
    return entry;
  });
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

  const targets: TargetEntry[] = (targetTable?.rows ?? []).map((row, index) => ({
    target: row.Target ?? "",
    type: row.Type ?? "",
    status: row.Status ?? "",
    description: row.Description ?? "",
    ...(typeof targetTable?.rowLines[index] === "number" ? { line: targetTable.rowLines[index] } : {})
  }));
  const scopes: ScopeEntry[] = (scopeTable?.rows ?? []).map((row, index) => ({
    scope: row.Scope ?? "",
    document: extractLinkTarget(row.Document ?? row["Primary Document"] ?? ""),
    prefix: row.Prefix ?? "",
    description: row.Description ?? row.Notes ?? "",
    ...(typeof scopeTable?.rowLines[index] === "number" ? { line: scopeTable.rowLines[index] } : {})
  }));
  const activeTarget = hasMetadataField(metadata, "Active Target") ? (metadata["Active Target"] ?? "").trim() : legacyActiveTarget(targets);
  const completedWork = parseCompletedWork(file);
  const statusSummary = parseStatusSummary(file.lines);
  const requirementTypeSummary = parseRequirementTypeSummary(file.lines);
  const targetGoals = extractTargetGoals(file.lines);
  const index: IndexDocument = { metadata, activeTarget, targets, scopes, completedWork, targetGoals };
  if (statusSummary) index.statusSummary = statusSummary;
  if (requirementTypeSummary) index.requirementTypeSummary = requirementTypeSummary;

  return { index, diagnostics };
}

const TARGET_HEADING_RE = /^### Target:\s+(\S+)\s*$/;
const GOAL_LABEL_RE = /^\*\*Goal:\*\*\s*(.+)$/;
const LABEL_LINE_RE = /^\*\*[^*]+:\*\*/;
const FORBIDDEN_TOKEN_CHARS = /[/\\]/;

export function extractTargetGoals(lines: readonly string[]): Record<string, string> {
  const goals: Record<string, string> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = TARGET_HEADING_RE.exec(line);
    if (!match) continue;
    const token = match[1];
    if (!token || FORBIDDEN_TOKEN_CHARS.test(token)) continue;
    const bodyEnd = findBlockEnd(lines, i + 1);
    const goalText = readGoalText(lines, i + 1, bodyEnd);
    if (goalText !== undefined) {
      goals[token] = goalText;
    }
  }
  return goals;
}

function findBlockEnd(lines: readonly string[], start: number): number {
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^#{1,3}\s/.test(line) && !TARGET_HEADING_RE.test(line)) return i;
    if (TARGET_HEADING_RE.test(line)) return i;
  }
  return lines.length;
}

function readGoalText(lines: readonly string[], start: number, end: number): string | undefined {
  let goalStart = -1;
  for (let i = start; i < end; i += 1) {
    if (GOAL_LABEL_RE.test(lines[i] ?? "")) {
      goalStart = i;
      break;
    }
  }
  if (goalStart === -1) return undefined;
  const firstMatch = GOAL_LABEL_RE.exec(lines[goalStart] ?? "");
  if (!firstMatch) return undefined;
  const collected: string[] = [firstMatch[1]?.trim() ?? ""];
  for (let i = goalStart + 1; i < end; i += 1) {
    const next = lines[i] ?? "";
    if (next.trim() === "") continue;
    if (LABEL_LINE_RE.test(next)) break;
    collected.push(next.trim());
  }
  return collected.join("\n");
}
