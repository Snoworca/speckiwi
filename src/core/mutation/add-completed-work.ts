import path from "node:path";
import { diagnostic } from "../diagnostic.js";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { parseMarkdownTable } from "../parser/table.js";
import type { Diagnostic, MutationResult, ParsedWorkspace, PatchSummary, ProjectRoot, TextFile } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";

export interface AddCompletedWorkInput {
  date: string;
  summary: string;
  target?: string;
  scope?: string;
  requirementIds?: string[];
  allowIncomplete?: boolean;
  dryRun?: boolean;
}

function findHeadingMatching(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function renderRow(input: Required<Pick<AddCompletedWorkInput, "date" | "summary">> & Pick<AddCompletedWorkInput, "target" | "scope" | "requirementIds">): string {
  return `| ${input.date} | ${input.target ?? ""} | ${input.scope ?? ""} | ${(input.requirementIds ?? []).join(", ")} | ${input.summary} |`;
}

function tableBlock(row: string): string[] {
  return [
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    row
  ];
}

function sectionBlock(row: string): string[] {
  return [
    "## 7. Completed Work Log",
    "",
    "| Date | Target | Scope | Requirement IDs | Summary |",
    "|---|---|---|---|---|",
    row,
    ""
  ];
}

function sectionBlockWithNumber(row: string, sectionNumber: number): string[] {
  const lines = sectionBlock(row);
  lines[0] = `## ${sectionNumber}. Completed Work Log`;
  return lines;
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

function planCompletedWorkPatch(file: TextFile, row: string): PatchOperation[] {
  const completedHeading = findHeadingMatching(file.lines, /^##\s+\d+\.\s+Completed Work Log$/);
  if (completedHeading >= 0) {
    const table = parseMarkdownTable(file.lines, completedHeading + 1);
    if (table) return [insertLinesOperation(file, table.endLine + 1, [row])];
    return [insertLinesOperation(file, completedHeading + 2, tableBlock(row))];
  }

  const insertionHeading = findInsertionHeading(file.lines);
  if (insertionHeading) {
    return [
      ...renumberTopLevelSections(file.lines, insertionHeading.index),
      insertLinesOperation(file, insertionHeading.index + 1, sectionBlockWithNumber(row, insertionHeading.sectionNumber))
    ];
  }
  return [appendLinesOperation(file, ["", ...sectionBlock(row)])];
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
  return { ok: false, error: { code: "STALE_PATCH", message, diagnostics: [staleDiagnostic] }, diagnostics: [staleDiagnostic] };
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
  const date = input.date.trim();
  const summary = input.summary.trim();
  const target = input.target?.trim() ?? "";
  const scope = input.scope?.trim() ?? "";
  const requirementIds = (input.requirementIds ?? []).map((id) => id.trim()).filter(Boolean);

  if (!date) return mutationFail("USAGE", "date is required");
  if (!summary) return mutationFail("USAGE", "summary is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return mutationFail("USAGE", "date must use YYYY-MM-DD");
  const unsafeCell = assertSafeMarkdownTableCells({
    "Completed Work Log date": date,
    "Completed Work Log target": target,
    "Completed Work Log scope": scope,
    "Completed Work Log summary": summary,
    ...Object.fromEntries(requirementIds.map((id, index) => [`Completed Work Log requirementIds[${index}]`, id]))
  });
  if (unsafeCell) return unsafeCell;

  const workspace = await parseWorkspace(root);
  const referenceDiagnostics = validateCompletedWorkInput(workspace, { ...input, target, scope, requirementIds });
  if (referenceDiagnostics.length > 0) {
    return {
      ok: false,
      error: { code: "MUTATION_DENIED", message: "Completed Work Log references failed prevalidation" },
      diagnostics: referenceDiagnostics
    };
  }

  const file = await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
  const row = renderRow({ date, summary, target, scope, requirementIds });
  const operations = planCompletedWorkPatch(file, row);
  const dryRun = input.dryRun ?? false;
  try {
    const applied = await applyPatchPlan(createPatchPlan(file, operations), { dryRun });
    return {
      ...mutationOk({ date, target, scope, requirementIds, summary, written: applied.written }),
      patch: patchSummary(applied.filePath, operations, dryRun)
    };
  } catch (error) {
    const staleFailure = stalePatchMutationFailure(error, file.relativePath);
    if (staleFailure) return staleFailure;
    throw error;
  }
}
