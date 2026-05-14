import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import type { ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { parseWorkspace } from "../parser/workspace-parser.js";

export async function loadRecord(root: ProjectRoot, id: string): Promise<{ record: RequirementRecord; file: TextFile } | undefined> {
  const workspace = await parseWorkspace(root);
  const record = workspace.records.find((candidate) => candidate.id === id);
  if (!record) return undefined;
  const file = await readUtf8File(path.join(root.root, record.filePath), root.root);
  return { record, file };
}

export async function loadRecordWithWorkspace(
  root: ProjectRoot,
  id: string
): Promise<{ record: RequirementRecord; file: TextFile; records: readonly RequirementRecord[] } | undefined> {
  const workspace = await parseWorkspace(root);
  const record = workspace.records.find((candidate) => candidate.id === id);
  if (!record) return undefined;
  const file = await readUtf8File(path.join(root.root, record.filePath), root.root);
  return { record, file, records: workspace.records };
}

export function findMetadataLine(file: TextFile, record: RequirementRecord, field: string): number | undefined {
  for (let line = record.headingLine; line <= (record.blockEndLine ?? file.lines.length); line += 1) {
    if ((file.lines[line - 1] ?? "").startsWith(`| ${field} |`)) return line;
  }
  return undefined;
}

export function findSectionTableInsertionLine(file: TextFile, record: RequirementRecord, sectionName: string): number | undefined {
  const start = record.sectionLines?.[sectionName];
  if (!start) return undefined;
  const end = record.blockEndLine ?? file.lines.length;
  let lastTableLine: number | undefined;
  for (let line = start + 1; line <= end; line += 1) {
    const text = file.lines[line - 1] ?? "";
    if (line > start + 1 && text.startsWith("#### ")) break;
    if (text.trim().startsWith("|")) lastTableLine = line;
  }
  return lastTableLine ? lastTableLine + 1 : start + 1;
}
