import path from "node:path";
import { readUtf8File } from "../fs/read-text.js";
import type { ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import type { DirtyEdge } from "../query/summary.js";
import { parseWorkspace } from "../parser/workspace-parser.js";

// FR-NODE-017: origin-aware record lookup. When origin/stepName are omitted the lookup
// prefers the body scope records (backward compatible). When origin=step and a stepName are
// supplied the lookup routes to the matching step record, tagging it with origin/stepName so
// mutation routing can distinguish a promoted step copy from the body copy of the same id.
type RecordOrigin = "body" | "step";

function selectRecord(
  workspace: { records: readonly RequirementRecord[]; stepRecords?: readonly RequirementRecord[] },
  id: string,
  origin?: RecordOrigin,
  stepName?: string
): RequirementRecord | undefined {
  if (origin === "step") {
    const stepRecord = (workspace.stepRecords ?? []).find(
      (candidate) => candidate.id === id && (stepName === undefined || candidate.stepName === stepName)
    );
    if (!stepRecord) return undefined;
    return { ...stepRecord, origin: "step" } as RequirementRecord;
  }
  return workspace.records.find((candidate) => candidate.id === id);
}

function resolveLoadedRecord(record: RequirementRecord, file: TextFile, origin?: RecordOrigin): RequirementRecord {
  // A step record's parsed filePath is the step-scope relative path; surface the absolute
  // path of the file actually loaded so callers can distinguish the step origin on disk.
  if (origin === "step") return { ...record, filePath: file.path } as RequirementRecord;
  return record;
}

export async function loadRecord(
  root: ProjectRoot,
  id: string,
  origin?: RecordOrigin,
  stepName?: string
): Promise<{ record: RequirementRecord; file: TextFile } | undefined> {
  const workspace = await parseWorkspace(root);
  const record = selectRecord(workspace, id, origin, stepName);
  if (!record) return undefined;
  const file = await readUtf8File(path.join(root.root, record.filePath), root.root);
  return { record: resolveLoadedRecord(record, file, origin), file };
}

export async function loadRecordWithWorkspace(
  root: ProjectRoot,
  id: string,
  origin?: RecordOrigin,
  stepName?: string
): Promise<{ record: RequirementRecord; file: TextFile; records: readonly RequirementRecord[] } | undefined> {
  const workspace = await parseWorkspace(root);
  const record = selectRecord(workspace, id, origin, stepName);
  if (!record) return undefined;
  const file = await readUtf8File(path.join(root.root, record.filePath), root.root);
  return { record: resolveLoadedRecord(record, file, origin), file, records: workspace.records };
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

// FR-NODE-043 — vibe merge contradiction hard-gate. A vibe synthesis/merge flow
// may only be marked complete once its touched dirty-edge closure is
// contradiction-verified (empty) or the remaining contradictions are explicitly
// acknowledged. Being SYNTHESIZED (a step directory exists) is orthogonal to
// being contradiction-verified, so stepDirectoryExists never, by itself, grants
// completion. For non-vibe STEP namespace flows the diagnostic stays advisory:
// the gate is never enforced and never blocks.
export interface VibeCompletionGateResult {
  allowed: boolean;
  blockedReason?: "dirty-edges-unacknowledged";
  enforced: boolean;
}

export function evaluateVibeCompletionGate(input: {
  vibe: boolean;
  stepDirectoryExists: boolean;
  dirtyEdges: DirtyEdge[];
  acknowledged: boolean;
}): VibeCompletionGateResult {
  // Advisory-only for non-vibe flows: the hard-gate never governs the decision.
  if (!input.vibe) {
    return { allowed: true, enforced: false };
  }
  // An edge is a contradiction unless its classification is "clean".
  const hasContradiction = input.dirtyEdges.some((edge) => edge.classification !== "clean");
  if (hasContradiction && !input.acknowledged) {
    return { allowed: false, blockedReason: "dirty-edges-unacknowledged", enforced: true };
  }
  return { allowed: true, enforced: true };
}

export function findRequirementStatementRange(
  file: TextFile,
  record: RequirementRecord
): { startLine: number; endLine: number } | undefined {
  const start = record.sectionLines?.["Requirement"];
  if (!start) return undefined;
  const end = record.blockEndLine ?? file.lines.length;
  let statementStart = start + 1;
  while (statementStart <= end && (file.lines[statementStart - 1] ?? "").trim() === "") statementStart += 1;
  if (statementStart > end) return undefined;
  const first = file.lines[statementStart - 1] ?? "";
  const trimmedFirst = first.trim();
  if (first.startsWith("#### ") || trimmedFirst === "" || trimmedFirst.startsWith("|") || trimmedFirst.startsWith("```")) {
    return undefined;
  }
  // Capture the whole prose block, spanning blank lines between paragraphs, up to the next
  // section boundary (heading, GFM table, or fenced code block). A multi-paragraph statement
  // must be replaced as a unit so no stale later paragraph survives (FR-NODE-025 FND-004).
  let statementEnd = statementStart;
  for (let line = statementStart + 1; line <= end; line += 1) {
    const text = file.lines[line - 1] ?? "";
    const trimmed = text.trim();
    if (text.startsWith("#### ") || trimmed.startsWith("|") || trimmed.startsWith("```")) break;
    if (trimmed !== "") statementEnd = line;
  }
  return { startLine: statementStart, endLine: statementEnd };
}
