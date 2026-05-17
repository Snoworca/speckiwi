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

const CANONICAL_SECTION_ORDER: readonly string[] = [
  "Requirement",
  "Rationale",
  "Acceptance Criteria",
  "Verification Evidence",
  "Trace Links",
  "Research / Analysis",
  "Implementation Notes",
  "Change Notes"
];

export interface SectionInsertionTarget {
  mode: "append";
  line: number;
}

export interface SectionInsertionCreate {
  mode: "create";
  insertAtLine: number;
}

export function findSectionInsertionLine(
  file: TextFile,
  record: RequirementRecord,
  headingText: "Rationale" | "Research / Analysis" | "Implementation Notes"
): SectionInsertionTarget | SectionInsertionCreate | undefined {
  const start = record.sectionLines?.[headingText];
  const end = record.blockEndLine ?? file.lines.length;
  if (start) {
    let lastBodyLine = start;
    for (let line = start + 1; line <= end; line += 1) {
      const text = file.lines[line - 1] ?? "";
      if (text.startsWith("#### ")) break;
      if (text.trim() !== "") lastBodyLine = line;
    }
    return { mode: "append", line: lastBodyLine + 1 };
  }
  const targetIndex = CANONICAL_SECTION_ORDER.indexOf(headingText);
  if (targetIndex < 0) return undefined;
  for (let i = targetIndex + 1; i < CANONICAL_SECTION_ORDER.length; i += 1) {
    const nextHeading = CANONICAL_SECTION_ORDER[i];
    const nextStart = record.sectionLines?.[nextHeading ?? ""];
    if (nextStart) {
      return { mode: "create", insertAtLine: nextStart };
    }
  }
  const changeNotesLine = record.sectionLines?.["Change Notes"];
  if (changeNotesLine) return { mode: "create", insertAtLine: changeNotesLine };
  return { mode: "create", insertAtLine: end };
}

export function findSectionBodyRange(
  file: TextFile,
  record: RequirementRecord,
  headingText: "Rationale" | "Research / Analysis" | "Implementation Notes"
): { startLine: number; endLine: number } | undefined {
  const start = record.sectionLines?.[headingText];
  if (!start) return undefined;
  const end = record.blockEndLine ?? file.lines.length;
  let bodyStart = start + 1;
  while (bodyStart <= end && (file.lines[bodyStart - 1] ?? "").trim() === "") bodyStart += 1;
  let bodyEnd = bodyStart;
  for (let line = bodyStart; line <= end; line += 1) {
    const text = file.lines[line - 1] ?? "";
    if (text.startsWith("#### ")) break;
    if (text.trim() !== "") bodyEnd = line;
  }
  return { startLine: bodyStart, endLine: bodyEnd };
}
