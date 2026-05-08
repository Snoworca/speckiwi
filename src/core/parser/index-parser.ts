import { diagnostic } from "../diagnostic.js";
import type { Diagnostic, IndexDocument, ScopeEntry, TargetEntry, TextFile } from "../types.js";
import { parseMarkdownTable } from "./table.js";

function extractLinkTarget(value: string): string {
  const match = /\[[^\]]+]\(([^)]+)\)/.exec(value);
  return match?.[1] ?? value;
}

function findHeading(lines: string[], heading: string): number {
  return lines.findIndex((line) => line.trim() === heading);
}

export function parseIndexDocument(file: TextFile): { index: IndexDocument; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const targetStart = findHeading(file.lines, "## 3. Target Map");
  const scopeStart = findHeading(file.lines, "## 4. Scope Map");
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

  return { index: { targets, scopes }, diagnostics };
}
