import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseMarkdownTable } from "../parser/table.js";
import type { MutationResult, ProjectRoot, TargetEntry, TextFile } from "../types.js";
import { mutationFail, mutationOk } from "./guards.js";

export interface SetActiveTargetInput {
  target: string;
  dryRun?: boolean;
}

function findHeadingMatching(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function findMetadataRowLine(file: TextFile, field: string): number | undefined {
  for (let index = 0; index < file.lines.length; index += 1) {
    const line = file.lines[index] ?? "";
    if (line.startsWith(`| ${field} |`)) return index + 1;
    if (index > 0 && line.startsWith("## ")) break;
  }
  return undefined;
}

function renderTargetRow(row: TargetEntry, status: string): string {
  return `| ${row.target} | ${row.type} | ${status} | ${row.description} |`;
}

export async function setActiveTarget(root: ProjectRoot, input: SetActiveTargetInput): Promise<MutationResult> {
  const target = input.target.trim();
  if (!target) return mutationFail("USAGE", "target is required");

  const file = await readUtf8File(path.join(root.root, "docs", "spec", "00.index.md"), root.root);
  const metadataTable = parseMarkdownTable(file.lines, 1);
  if (!metadataTable) return mutationFail("MUTATION_DENIED", "Index metadata table is missing");

  const targetHeading = findHeadingMatching(file.lines, /^##\s+\d+\.\s+Target Map$/);
  const targetTable = targetHeading >= 0 ? parseMarkdownTable(file.lines, targetHeading + 1) : undefined;
  if (!targetTable) return mutationFail("MUTATION_DENIED", "Target Map table is missing");

  const rows: TargetEntry[] = targetTable.rows.map((row) => ({
    target: row.Target ?? "",
    type: row.Type ?? "",
    status: row.Status ?? "",
    description: row.Description ?? ""
  }));
  if (!rows.some((row) => row.target === target)) {
    return mutationFail("NOT_FOUND", `Target is not registered: ${target}`);
  }

  const previousActiveTarget = findExistingActiveTarget(file, rows);
  const operations: PatchOperation[] = [];
  const metadataLine = findMetadataRowLine(file, "Active Target");
  if (metadataLine) {
    const original = file.lines[metadataLine - 1];
    if (original === undefined) return mutationFail("MUTATION_DENIED", "Active Target metadata row is outside file");
    const replacement = `| Active Target | ${target} |`;
    if (original !== replacement) operations.push({ type: "replaceLine", line: metadataLine, original, replacement });
  } else {
    operations.push({ type: "insertLines", line: metadataTable.endLine, lines: [`| Active Target | ${target} |`] });
  }

  for (const [index, row] of rows.entries()) {
    const nextStatus = row.target === target ? "active" : row.status === "active" ? "planned" : row.status;
    if (nextStatus === row.status) continue;
    const line = targetTable.startLine + 2 + index;
    const original = file.lines[line - 1];
    if (original === undefined) return mutationFail("MUTATION_DENIED", "Target Map row is outside file");
    operations.push({ type: "replaceLine", line, original, replacement: renderTargetRow(row, nextStatus) });
  }

  if (operations.length === 0) {
    return mutationOk({ activeTarget: target, previousActiveTarget, written: false });
  }

  const plan = createPatchPlan(file, operations);
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });
  return mutationOk({ activeTarget: target, previousActiveTarget, written: applied.written });
}

function findExistingActiveTarget(file: TextFile, rows: TargetEntry[]): string {
  const metadataLine = findMetadataRowLine(file, "Active Target");
  if (metadataLine) {
    const cells = (file.lines[metadataLine - 1] ?? "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells[1]) return cells[1];
  }
  return rows.find((row) => row.status === "active")?.target ?? rows[0]?.target ?? "";
}
