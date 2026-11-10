import { diagnostic } from "../diagnostic.js";
import { parseReportPathCell, REPORT_PATHS_COLUMN } from "../completed-work/report-paths.js";
import type {
  CompletedWorkEntry,
  Diagnostic,
  IndexDocument,
  RequirementTypeSummaryEntry,
  ScopeEntry,
  StatusSummaryEntry,
  StepStateEntry,
  StepStateMode,
  StepStateParseResult,
  TargetEntry,
  TextFile
} from "../types.js";
import { parseMarkdownTable, parseMarkdownTableResult, parseMetadataRows, splitTableRow } from "./table.js";
import { classifyDocumentLines, maskInlineComments, type ClassifyOptions } from "./document-lines.js";
import { findMarkdownLinks } from "./markdown-links.js";

const STEP_STATUS_ENUM = new Set<string>(["active", "merging", "merged", "abandoned"]);
const STEP_MODE_ENUM = new Set<string>(["sdd", "vibe", "wait", "tdd"]);
const STEP_MODE_RE = /^\s*Mode:\s*(.*)$/;
const STEP_ACTIVE_TASK_RE = /^\s*Active Task:\s*(.*)$/;

// @req FR-PARSE-026 @req FR-PARSE-031 @req FR-PARSE-032
export function parseStepState(lines: readonly string[]): StepStateParseResult {
  const src = lines as string[];
  const result = parseMarkdownTableResult(src, 0, { skipNonTableLeading: true });
  const table = result.table;

  const entries: StepStateEntry[] = (table?.rows ?? []).map((row) => {
    const status = row.Status ?? "";
    const entry: StepStateEntry = {
      step: row.Step ?? "",
      status,
      dependsOn: row.DependsOn ?? "",
      touchesScope: row.TouchesScope ?? "",
      touchesReq: row.TouchesReq ?? "",
      created: row.Created ?? "",
      updated: row.Updated ?? ""
    };
    if (!STEP_STATUS_ENUM.has(status)) entry.invalidStatus = true;
    return entry;
  });

  // Scan the metadata block preceding the table (or the whole input when no table
  // was found) for the Mode and Active Task keys in the same pass.
  const metaCount = table ? table.startLine - 1 : lines.length;
  let modeRaw: string | undefined;
  let activeTaskRaw: string | undefined;
  for (let i = 0; i < metaCount; i += 1) {
    const l = lines[i] ?? "";
    if (modeRaw === undefined) {
      const m = STEP_MODE_RE.exec(l);
      if (m) modeRaw = (m[1] ?? "").trim();
    }
    if (activeTaskRaw === undefined) {
      const m = STEP_ACTIVE_TASK_RE.exec(l);
      if (m) activeTaskRaw = (m[1] ?? "").trim();
    }
  }

  let mode: StepStateMode = "wait";
  let modeInvalid = false;
  if (modeRaw !== undefined && modeRaw !== "") {
    if (STEP_MODE_ENUM.has(modeRaw)) mode = modeRaw as StepStateMode;
    else modeInvalid = true;
  }
  // The Active Task line is meaningful for the task-scoped modes (vibe and tdd).
  const activeTask = mode === "vibe" || mode === "tdd" ? activeTaskRaw : undefined;

  return Object.assign(entries, {
    mode,
    ...(activeTask !== undefined ? { activeTask } : {}),
    ...(modeInvalid ? { modeInvalid: true } : {})
  }) as StepStateParseResult;
}

/**
 * Column names of a scope row by field. The init template names the Scope Map columns like the SRS
 * Documents ones, while older indexes (this repository's own) use `Primary Document` and `Notes`;
 * the first name is the canonical one. The index reader and the scope-row writers share this table.
 */
export const SCOPE_ROW_COLUMNS = {
  scope: ["Scope"],
  document: ["Document", "Primary Document"],
  prefix: ["Prefix"],
  description: ["Description", "Notes"]
} as const satisfies Record<string, readonly [string, ...string[]]>;

export type ScopeRowField = keyof typeof SCOPE_ROW_COLUMNS;

function scopeCell(row: Record<string, string>, field: ScopeRowField): string {
  for (const name of SCOPE_ROW_COLUMNS[field]) {
    const value = row[name];
    if (value !== undefined) return value;
  }
  return "";
}

/**
 * @req FR-PARSE-050 AC-3 — the destination the shared link parser reads in the cell, past any inline
 * comment and without a title; a cell that holds no inline link is read whole, as a bare path is.
 */
function extractLinkTarget(value: string): string {
  const link = findMarkdownLinks(maskInlineComments(value)).find((candidate) => candidate.kind === "inline");
  return link?.kind === "inline" ? link.destination.value : value;
}

export const TARGET_MAP_HEADING = /^##\s+\d+\.\s+Target Map$/;
export const COMPLETED_WORK_LOG_HEADING = /^##\s+\d+\.\s+Completed Work Log$/;
/** Up to three leading spaces, because CommonMark permits them and every renderer draws the heading. */
export const RELEASE_RESIDUE_HEADING = /^ {0,3}##\s+(?:\d+\.\s+)?Release Residue\s*$/;

// @req FR-PARSE-044 AC-6
/**
 * For each line, whether it is document text (classifyDocumentLines): false for fenced and indented
 * code and for a line wholly inside an HTML comment. A heading or a table there is an example an
 * author shows, not the document's own structure.
 */
export function linesOutsideFences(lines: readonly string[], options: ClassifyOptions = {}): boolean[] {
  return classifyDocumentLines(lines, options).map((line) => line.body);
}

/**
 * The first body line that is an unindented ATX heading matching `pattern` (tested with trailing
 * blanks removed), or -1. An indented `## …` line is not taken for a heading.
 */
export function findHeadingMatching(lines: readonly string[], pattern: RegExp, options: ClassifyOptions = {}): number {
  const classified = classifyDocumentLines(lines, options);
  return classified.findIndex(
    (line) => line.body && line.text.startsWith("#") && pattern.test(line.text.trimEnd())
  );
}

function hasMetadataField(metadata: Record<string, string>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(metadata, field);
}

function legacyActiveTarget(targets: TargetEntry[]): string {
  return targets.find((target) => target.status === "active")?.target ?? targets[0]?.target ?? "";
}

// @req FR-PARSE-021
export function parseCompletedWork(file: Pick<TextFile, "lines" | "relativePath">): CompletedWorkEntry[] {
  const heading = findHeadingMatching(file.lines, COMPLETED_WORK_LOG_HEADING);
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
    // FR-PARSE-030: attribute each entry to its originating file so dual-read merge and
    // diagnostics can report the true source (index vs history) rather than a hardcoded path.
    // Non-enumerable so existing deep-equality assertions over completedWork are unaffected.
    Object.defineProperty(entry, "sourceFile", { value: file.relativePath, enumerable: false });
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
    line: table.rowLines[index] ?? table.startLine + 2 + index
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
    line: table.rowLines[index] ?? table.startLine + 2 + index
  }));
}

export function parseIndexDocument(file: TextFile): { index: IndexDocument; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const { metadata } = parseMetadataRows(file.lines, 1);
  const targetStart = findHeadingMatching(file.lines, TARGET_MAP_HEADING);
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
    scope: scopeCell(row, "scope"),
    document: extractLinkTarget(scopeCell(row, "document")),
    prefix: scopeCell(row, "prefix"),
    description: scopeCell(row, "description"),
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
/** The `**Goal:** <text>` line of a target's goal block. */
const GOAL_LABEL_RE = /^\*\*Goal:\*\*\s*(.+)$/;
/** A heading of level one to three, another target's included, ends a target's goal block. */
const GOAL_BLOCK_END_RE = /^#{1,3}\s/;
const LABEL_LINE_RE = /^\*\*[^*]+:\*\*/;
const FORBIDDEN_TOKEN_CHARS = /[/\\]/;

/** A `### Target: <token>` goal block of the index; line numbers are 0-based. */
export interface TargetGoalBlock {
  target: string;
  /** The `### Target:` heading line. */
  heading: number;
  /** The block's first `**Goal:**` line, when it has one. */
  goal?: number;
  /** The line the block ends before: the next heading of level one to three, or the line count. */
  end: number;
}

/**
 * The target goal blocks of `lines`, read from document-text lines only: a target heading, a block end
 * or a Goal line inside fenced code, indented code or an HTML comment is an example the author shows,
 * not the index's own. The one reader of goal blocks: the parser and set-target-goal both ask it, so a
 * goal the mutation writes is the goal the parser returns. @req FR-NODE-260 AC-2
 */
export function findTargetGoalBlocks(lines: readonly string[]): TargetGoalBlock[] {
  return goalBlocks(lines, linesOutsideFences(lines));
}

function goalBlocks(lines: readonly string[], text: readonly boolean[]): TargetGoalBlock[] {
  const blocks: TargetGoalBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const target = text[i] === true ? TARGET_HEADING_RE.exec(lines[i] ?? "")?.[1] : undefined;
    if (target === undefined) continue;
    let goal: number | undefined;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (text[j] !== true) continue;
      const line = lines[j] ?? "";
      if (GOAL_BLOCK_END_RE.test(line)) {
        end = j;
        break;
      }
      if (goal === undefined && GOAL_LABEL_RE.test(line)) goal = j;
    }
    blocks.push({ target, heading: i, end, ...(goal === undefined ? {} : { goal }) });
  }
  return blocks;
}

export function extractTargetGoals(lines: readonly string[]): Record<string, string> {
  const text = linesOutsideFences(lines);
  const goals: Record<string, string> = {};
  for (const block of goalBlocks(lines, text)) {
    if (block.goal === undefined || FORBIDDEN_TOKEN_CHARS.test(block.target)) continue;
    goals[block.target] = readGoalText(lines, text, block.goal, block.end);
  }
  return goals;
}

/** The goal text from the Goal line through the block's end, document-text lines only, up to the next label line. */
function readGoalText(lines: readonly string[], text: readonly boolean[], goal: number, end: number): string {
  const collected: string[] = [GOAL_LABEL_RE.exec(lines[goal] ?? "")?.[1]?.trim() ?? ""];
  for (let i = goal + 1; i < end; i += 1) {
    const next = lines[i] ?? "";
    if (text[i] !== true || next.trim() === "") continue;
    if (LABEL_LINE_RE.test(next)) break;
    collected.push(next.trim());
  }
  return collected.join("\n");
}
