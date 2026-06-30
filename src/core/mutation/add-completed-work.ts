import { access } from "node:fs/promises";
import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { normalizeReportPathsInput, REPORT_PATHS_COLUMN } from "../completed-work/report-paths.js";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { parseMarkdownTable, splitTableRow, type ParsedTable } from "../parser/table.js";
import { completedWorkSourceInfo } from "../query/completed-work.js";
import type { Diagnostic, MutationResult, ParsedWorkspace, PatchSummary, ProjectRoot, TextFile } from "../types.js";
import { validateWorkspace } from "../validator/validate-workspace.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";
import { withSrsMutationLock } from "./srs-lock.js";

export interface AddCompletedWorkInput {
  date: string;
  summary: string;
  target?: string;
  scope?: string;
  requirementIds?: string[];
  reportPaths?: string[] | null;
  allowIncomplete?: boolean;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

function findHeadingMatching(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function renderRow(
  input: Required<Pick<AddCompletedWorkInput, "date" | "summary">> & Pick<AddCompletedWorkInput, "target" | "scope" | "requirementIds" | "reportPaths">,
  includeReportPaths: boolean
): string {
  const cells = [input.date, input.target ?? "", input.scope ?? "", (input.requirementIds ?? []).join(", "), input.summary];
  if (includeReportPaths) cells.push((input.reportPaths ?? []).join(", "));
  return `| ${cells.join(" | ")} |`;
}

function tableHeader(includeReportPaths: boolean): string {
  return includeReportPaths ? "| Date | Target | Scope | Requirement IDs | Summary | Report Paths |" : "| Date | Target | Scope | Requirement IDs | Summary |";
}

function tableSeparator(includeReportPaths: boolean): string {
  return includeReportPaths ? "|---|---|---|---|---|---|" : "|---|---|---|---|---|";
}

function tableBlock(row: string, includeReportPaths: boolean): string[] {
  return ["", tableHeader(includeReportPaths), tableSeparator(includeReportPaths), row];
}

function sectionBlock(row: string, includeReportPaths: boolean, sectionNumber = 7): string[] {
  return [
    `## ${sectionNumber}. Completed Work Log`,
    "",
    tableHeader(includeReportPaths),
    tableSeparator(includeReportPaths),
    row,
    ""
  ];
}

function sectionBlockWithNumber(row: string, sectionNumber: number, includeReportPaths: boolean): string[] {
  return sectionBlock(row, includeReportPaths, sectionNumber);
}

function findInsertionHeading(lines: string[]): { index: number; sectionNumber: number } | undefined {
  const following = /^(##\s+)(\d+)(\.\s+)(Cross-scope Dependencies|Open Questions|Reference Documents|Change Notes)$/;
  for (const [index, line] of lines.entries()) {
    const match = following.exec(line.trim());
    if (match?.[2]) return { index, sectionNumber: Number(match[2]) };
  }
  return undefined;
}

function renumberTopLevelSections(lines: string[], startIndex: number): PatchOperation[] {
  const operations: PatchOperation[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(##\s+)(\d+)(\.\s+.+)$/.exec(line);
    if (!match?.[2]) continue;
    operations.push({
      type: "replaceLine",
      line: index + 1,
      original: line,
      replacement: `${match[1]}${Number(match[2]) + 1}${match[3]}`
    });
  }
  return operations;
}

function insertLinesOperation(file: TextFile, line: number, lines: string[]): PatchOperation {
  const operation: PatchOperation = { type: "insertLines", line, lines };
  const expectedBefore = file.lines[line - 2];
  if (expectedBefore !== undefined) operation.expectedBefore = expectedBefore;
  const expectedAfter = file.lines[line - 1];
  if (expectedAfter !== undefined) operation.expectedAfter = expectedAfter;
  return operation;
}

function appendLinesOperation(file: TextFile, lines: string[]): PatchOperation {
  const operation: PatchOperation = { type: "appendLines", lines };
  const expectedLastLine = file.lines.at(-1);
  if (expectedLastLine !== undefined) operation.expectedLastLine = expectedLastLine;
  return operation;
}

function replaceLineOperation(line: number, original: string | undefined, replacement: string): PatchOperation {
  const operation: PatchOperation = { type: "replaceLine", line, replacement };
  if (original !== undefined) operation.original = original;
  return operation;
}

function tableHasReportPaths(table: ParsedTable): boolean {
  return table.headers.at(-1) === REPORT_PATHS_COLUMN;
}

function tableHasMisplacedReportPaths(table: ParsedTable): boolean {
  const index = table.headers.indexOf(REPORT_PATHS_COLUMN);
  return index >= 0 && index !== table.headers.length - 1;
}

function renderExistingRowWithReportPaths(row: Record<string, string>): string {
  return renderRow(
    {
      date: row.Date ?? "",
      target: row.Target ?? "",
      scope: row.Scope ?? "",
      requirementIds: (row["Requirement IDs"] ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      summary: row.Summary ?? "",
      reportPaths: []
    },
    true
  );
}

function upgradeCompletedWorkTableOperations(file: TextFile, table: ParsedTable): PatchOperation[] {
  return [
    replaceLineOperation(table.startLine, file.lines[table.startLine - 1], tableHeader(true)),
    replaceLineOperation(table.startLine + 1, file.lines[table.startLine], tableSeparator(true)),
    ...table.rows.map((row, index): PatchOperation => {
      const line = table.rowLines[index] ?? table.startLine + 2 + index;
      return replaceLineOperation(line, file.lines[line - 1], renderExistingRowWithReportPaths(row));
    })
  ];
}

function validateCompletedWorkTableForMutation(file: TextFile, table: ParsedTable, includeReportPaths: boolean): MutationResult | undefined {
  if (tableHasMisplacedReportPaths(table)) {
    return mutationFail("MUTATION_DENIED", "Completed Work Log Report Paths column must be trailing");
  }

  if (!includeReportPaths || tableHasReportPaths(table)) return undefined;

  for (const line of table.rowLines) {
    const sourceCells = splitTableRow(file.lines[line - 1] ?? "");
    if (sourceCells.length !== table.headers.length) {
      return mutationFail("MUTATION_DENIED", "Completed Work Log legacy row has unexpected cells; fix the row before Report Paths migration");
    }
  }
  return undefined;
}

function planCompletedWorkPatch(file: TextFile, row: string, includeReportPaths: boolean, defaultSectionNumber = 7): PatchOperation[] {
  const completedHeading = findHeadingMatching(file.lines, /^##\s+\d+\.\s+Completed Work Log$/);
  if (completedHeading >= 0) {
    const table = parseMarkdownTable(file.lines, completedHeading + 1);
    if (table) {
      const needsMigration = includeReportPaths && !tableHasReportPaths(table);
      return [...(needsMigration ? upgradeCompletedWorkTableOperations(file, table) : []), insertLinesOperation(file, table.endLine + 1, [row])];
    }
    return [insertLinesOperation(file, completedHeading + 2, tableBlock(row, includeReportPaths))];
  }

  const insertionHeading = findInsertionHeading(file.lines);
  if (insertionHeading) {
    return [
      ...renumberTopLevelSections(file.lines, insertionHeading.index),
      insertLinesOperation(file, insertionHeading.index + 1, sectionBlockWithNumber(row, insertionHeading.sectionNumber, includeReportPaths))
    ];
  }
  return [appendLinesOperation(file, ["", ...sectionBlock(row, includeReportPaths, defaultSectionNumber)])];
}

function operationPreview(operations: PatchOperation[]): string[] {
  return operations.flatMap((operation) => {
    if (operation.type === "insertLines" || operation.type === "appendLines") return operation.lines;
    if (operation.type === "replaceLine") return [operation.replacement];
    return operation.lines;
  });
}

function patchSummary(filePath: string, operations: PatchOperation[], dryRun: boolean): PatchSummary {
  return { filePath, operations: operations.length, dryRun, preview: operationPreview(operations) };
}

function stalePatchMutationFailure(error: unknown, filePath: string): MutationResult | undefined {
  if (!isStalePatchError(error)) return undefined;
  const message = `Mutation snapshot is stale for ${filePath}; rerun the command to retry against the latest file.`;
  const staleDiagnostic = diagnostic("SRS-E032", "error", message, { filePath });
  return mutationFail("STALE_PATCH", message, [staleDiagnostic], { staleGuard: { filePath, retry: "rerun the command" } });
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function readCompletedWorkMutationTarget(root: ProjectRoot): Promise<{ file: TextFile; external: boolean }> {
  const externalPath = path.join(root.root, "docs", "spec", "05.completed-work.md");
  if (await fileExists(externalPath)) {
    return { file: await readUtf8File(externalPath, root.root), external: true };
  }
  return { file: await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root), external: false };
}

function splitScopeTokens(scope: string): string[] {
  return scope
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function validateCompletedWorkInput(workspace: ParsedWorkspace, input: AddCompletedWorkInput): Diagnostic[] {
  const target = input.target?.trim() ?? "";
  const scopeTokens = splitScopeTokens(input.scope?.trim() ?? "");
  const requirementIds = (input.requirementIds ?? []).map((id) => id.trim()).filter(Boolean);
  const targets = new Set(workspace.index.targets.map((entry) => entry.target));
  const scopes = new Set(workspace.index.scopes.flatMap((entry) => [entry.prefix, entry.scope]).filter(Boolean));
  const recordsById = new Map(workspace.records.map((record) => [record.id, record]));
  const diagnostics: Diagnostic[] = [];
  const location = { filePath: "docs/spec/00.index.md" };

  if (target && !targets.has(target)) {
    diagnostics.push(diagnostic("SRS-W012", "warning", `Completed Work Log target is not registered: ${target}`, location));
  }
  for (const scope of scopeTokens) {
    if (!scopes.has(scope)) {
      diagnostics.push(diagnostic("SRS-W013", "warning", `Completed Work Log scope is not registered: ${scope}`, location));
    }
  }
  for (const id of requirementIds) {
    const record = recordsById.get(id);
    if (!record) {
      diagnostics.push(diagnostic("SRS-W014", "warning", `Completed Work Log requirement does not exist: ${id}`, location));
    } else if (!input.allowIncomplete && record.status !== "implemented" && record.status !== "verified") {
      diagnostics.push(diagnostic("SRS-W015", "warning", `Completed Work Log requirement is not completed: ${id}`, location));
    }
  }
  return diagnostics;
}

export async function addCompletedWork(root: ProjectRoot, input: AddCompletedWorkInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "add_completed_work", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => addCompletedWorkUnlocked(root, input));
}

async function addCompletedWorkUnlocked(root: ProjectRoot, input: AddCompletedWorkInput): Promise<MutationResult> {
  const date = input.date.trim();
  const summary = input.summary.trim();
  const target = input.target?.trim() ?? "";
  const scope = input.scope?.trim() ?? "";
  const requirementIds = (input.requirementIds ?? []).map((id) => id.trim()).filter(Boolean);
  const reportPathParse = normalizeReportPathsInput(input.reportPaths);
  const reportPaths = reportPathParse.paths;

  if (!date) return mutationFail("USAGE", "date is required");
  if (!summary) return mutationFail("USAGE", "summary is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return mutationFail("USAGE", "date must use YYYY-MM-DD");
  if (reportPathParse.issues.length > 0) {
    const issue = reportPathParse.issues[0]!;
    return mutationFail("MUTATION_DENIED", `Completed Work Log report path is malformed: ${issue.token || issue.reason}`);
  }
  const unsafeCell = assertSafeMarkdownTableCells({
    "Completed Work Log date": date,
    "Completed Work Log target": target,
    "Completed Work Log scope": scope,
    "Completed Work Log summary": summary,
    ...Object.fromEntries(requirementIds.map((id, index) => [`Completed Work Log requirementIds[${index}]`, id])),
    ...Object.fromEntries(reportPaths.map((reportPath, index) => [`Completed Work Log reportPaths[${index}]`, reportPath]))
  });
  if (unsafeCell) return unsafeCell;

  const workspace = await parseWorkspace(root);
  const referenceDiagnostics = validateCompletedWorkInput(workspace, { ...input, target, scope, requirementIds });
  if (referenceDiagnostics.length > 0) {
    return mutationFail("MUTATION_DENIED", "Completed Work Log references failed prevalidation", referenceDiagnostics);
  }
  const source = completedWorkSourceInfo(workspace);
  const sourceDiagnostics = validateWorkspace(workspace).diagnostics.filter((item) => item.code === "SRS-W041");

  const { file, external } = await readCompletedWorkMutationTarget(root);
  const completedHeading = findHeadingMatching(file.lines, /^##\s+\d+\.\s+Completed Work Log$/);
  const table = completedHeading >= 0 ? parseMarkdownTable(file.lines, completedHeading + 1) : undefined;
  const includeReportPaths = reportPaths.length > 0 || Boolean(table && tableHasReportPaths(table));
  const tableFailure = table ? validateCompletedWorkTableForMutation(file, table, includeReportPaths) : undefined;
  if (tableFailure) return tableFailure;
  const row = renderRow({ date, summary, target, scope, requirementIds, reportPaths }, includeReportPaths);
  const operations = planCompletedWorkPatch(file, row, includeReportPaths, external ? 1 : 7);
  const dryRun = input.dryRun ?? false;
  try {
    const plan = createPatchPlan(file, operations);
    const applied = await applyPatchPlan(plan, { dryRun });
    return withMutationEnvelope(
      mutationOk(
        {
          date,
          target,
          scope,
          requirementIds,
          summary,
          reportPaths,
          completedWorkMode: external ? "external-log" : "legacy-index",
          completedWorkSource: source,
          written: applied.written
        },
        sourceDiagnostics
      ),
      mutationEnvelopeFromPlan("add_completed_work", plan, dryRun, applied.written),
      patchSummary(file.relativePath, operations, dryRun)
    );
  } catch (error) {
    const staleFailure = stalePatchMutationFailure(error, file.relativePath);
    if (staleFailure) return staleFailure;
    throw error;
  }
}
