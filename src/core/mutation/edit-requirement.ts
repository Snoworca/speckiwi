import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { replaceHeadingTitle } from "../parser/heading-render.js";
import { PRIORITY_LEVELS, RISK_LEVELS, type MutationResult, type ProjectRoot, type RequirementRecord, type TextFile } from "../types.js";
import { assertOpensNoBlockBoundary, assertRequirementTitle } from "./block-prose.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findSectionTable, loadRecordWithWorkspace, planMetadataWrite, planTableRowUpdate, sectionEndLine, type RowSection } from "./internal.js";
import { acceptanceCriterionLine, refuseExpiredMarker } from "./render-requirement.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { assertSafeMarkdownTableCells, tableCellText } from "./table-cell.js";
import { todayStamp } from "../date-stamp.js";
import { splitTableRow } from "../parser/table.js";

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

export interface UpdateRequirementFieldsInput {
  id: string;
  title?: string;
  statement?: string;
  priority?: string;
  risk?: string;
  tags?: string[];
  relatedDocs?: string[];
  verificationMethod?: string;
  githubIssue?: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface ReplaceAcceptanceCriteriaInput {
  id: string;
  items: Array<{ text: string; checked?: boolean }>;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export type RequirementTableSection = "verification_evidence" | "trace_links" | "change_notes";

// @req FR-NODE-093 — the columns a row update may set, per section. An evidence row's id is absent
// deliberately: the renderer always writes the existing id, so accepting `id` would silently drop it.
// @req FR-NODE-222 — Change Notes rows are editable too, so a row split by a pipe can be repaired.
const SETTABLE_ROW_COLUMNS: Record<RequirementTableSection, readonly string[]> = {
  verification_evidence: ["type", "reference", "covers", "notes"],
  trace_links: ["type", "reference", "relation", "notes"],
  change_notes: ["date", "change", "reason"]
};

export interface RequirementTableRowOperation {
  kind: "update" | "delete";
  rowId?: string;
  rowIndex?: number;
  values?: Record<string, string>;
}

export interface EditRequirementTableRowsInput {
  id: string;
  section: RequirementTableSection;
  operations: RequirementTableRowOperation[];
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

/**
 * What a granular edit answers: the mutation summary, as every other write does. The whole requirement
 * is not re-read and attached — its Markdown and parsed form together made one cell edit answer tens of
 * thousands of characters — because `get_requirement` reads it. @req FR-NODE-294 AC-1 AC-2
 */
export interface GranularRequirementEditOutput {
  id: string;
  written: boolean;
  updatedFields: string[];
}

function staleFailure(error: unknown, filePath: string): MutationResult | undefined {
  if (!isStalePatchError(error)) return undefined;
  const message = `Mutation snapshot is stale for ${filePath}; rerun the command to retry against the latest file.`;
  const staleDiagnostic = diagnostic("SRS-E032", "error", message, { filePath });
  return mutationFail("STALE_PATCH", message, [staleDiagnostic], { staleGuard: { filePath, retry: "rerun the command" } });
}

function forwardFailure<T>(result: MutationResult): MutationResult<T> {
  return mutationFail(
    result.error?.code ?? "MUTATION_DENIED",
    result.error?.message ?? "Mutation failed",
    result.diagnostics,
    result.error?.staleGuard ? { staleGuard: result.error.staleGuard } : {}
  );
}

/** The refusal every criterion and field edit gives a verified block. @req FR-NODE-041 AC-5 */
export function assertEditable(record: RequirementRecord): MutationResult | undefined {
  if (record.status === "verified") return mutationFail("MUTATION_DENIED", "Granular edits cannot modify verified requirements; change status through a guarded status mutation first");
  return undefined;
}

function assertText(label: string, value: string): MutationResult | undefined {
  if (typeof value !== "string") return mutationFail("USAGE", `${label} must be a string`);
  if (value.length === 0) return mutationFail("USAGE", `${label} cannot be empty`);
  if (CONTROL_CHAR_RE.test(value)) return mutationFail("USAGE", `${label} contains forbidden control characters`);
  return undefined;
}

function assertTitleText(label: string, value: string): MutationResult | undefined {
  const invalid = assertText(label, value);
  if (invalid) return invalid;
  // The newline rule used to live here as its own copy. `add_requirement` writes the same heading
  // line from the same kind of value and did not have it, which is how a title carrying a forged
  // `verified` block reached the file — the rule was right, and only one of the two writers held it.
  // @req FR-NODE-266 AC-2 — the SRS-E020 rule likewise, through the parser's own predicate.
  return assertRequirementTitle(label, value);
}

function sectionContentRange(file: TextFile, record: RequirementRecord, heading: string): { startLine: number; endLine: number } | undefined {
  const start = record.sectionLines?.[heading];
  if (!start) return undefined;
  return { startLine: start + 1, endLine: sectionEndLine(file, record, start) };
}

async function applyGranularPlan(
  id: string,
  file: TextFile,
  operations: PatchOperation[],
  kind: string,
  dryRun: boolean,
  updatedFields: string[]
): Promise<MutationResult<GranularRequirementEditOutput>> {
  if (operations.length === 0) {
    return withMutationEnvelope(mutationOk({ id, written: false, updatedFields }), mutationNoopEnvelope(kind, file.relativePath, dryRun));
  }
  const plan = createPatchPlan(file, operations);
  try {
    const applied = await applyPatchPlan(plan, { dryRun });
    return withMutationEnvelope(
      mutationOk({ id, written: applied.written, updatedFields }),
      mutationEnvelopeFromPlan(kind, plan, dryRun, applied.written)
    );
  } catch (error) {
    const stale = staleFailure(error, file.relativePath);
    if (stale) return stale as MutationResult<GranularRequirementEditOutput>;
    throw error;
  }
}

export async function updateRequirementFields(root: ProjectRoot, input: UpdateRequirementFieldsInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  return withSrsMutationLock(root, { operation: "update_requirement_fields", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    updateRequirementFieldsUnlocked(root, input)
  );
}

async function updateRequirementFieldsUnlocked(root: ProjectRoot, input: UpdateRequirementFieldsInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const editable = assertEditable(loaded.record);
  if (editable) return editable as MutationResult<GranularRequirementEditOutput>;

  const tableCells: Record<string, string> = {};
  if (input.priority !== undefined) {
    if (!PRIORITY_LEVELS.includes(input.priority as never)) return mutationFail("USAGE", `unknown priority: ${input.priority}`);
    tableCells.Priority = input.priority;
  }
  if (input.risk !== undefined) {
    if (!RISK_LEVELS.includes(input.risk as never)) return mutationFail("USAGE", `unknown risk: ${input.risk}`);
    tableCells.Risk = input.risk;
  }
  if (input.tags !== undefined) tableCells.Tags = input.tags.join(", ") || "-";
  if (input.relatedDocs !== undefined) tableCells["Related Docs"] = input.relatedDocs.join(", ") || "-";
  if (input.verificationMethod !== undefined) tableCells["Verification Method"] = input.verificationMethod;
  if (input.githubIssue !== undefined) tableCells["GitHub Issue"] = input.githubIssue || "-";
  const unsafe = assertSafeMarkdownTableCells(Object.fromEntries(Object.entries(tableCells).map(([field, value]) => [`Requirement ${field}`, value])));
  if (unsafe) return forwardFailure(unsafe);
  if (input.title !== undefined) {
    const invalid = assertTitleText("title", input.title);
    if (invalid) return invalid as MutationResult<GranularRequirementEditOutput>;
  }
  if (input.statement !== undefined) {
    const invalid = assertText("statement", input.statement);
    if (invalid) return invalid as MutationResult<GranularRequirementEditOutput>;
    const opensSection = assertOpensNoBlockBoundary<GranularRequirementEditOutput>("statement", input.statement);
    if (opensSection) return opensSection;
  }

  const operations: PatchOperation[] = [];
  const updatedFields: string[] = [];
  if (input.title !== undefined) {
    const original = loaded.file.lines[loaded.record.headingLine - 1] ?? "";
    // @req FR-NODE-267 AC-1 AC-2 — only the title changes; the strikethrough and the draft or
    // discarded marker belong to the status and stability mutations, and update_stability writes the
    // draft marker only on a transition INTO draft, so a dropped one never comes back.
    const replacement = replaceHeadingTitle(original, input.title);
    if (replacement === undefined) return mutationFail("MUTATION_DENIED", `Requirement heading not recognised: ${input.id}`);
    operations.push({ type: "replaceLine", line: loaded.record.headingLine, original, replacement });
    updatedFields.push("title");
  }
  if (input.statement !== undefined) {
    const range = sectionContentRange(loaded.file, loaded.record, "Requirement");
    if (!range) return mutationFail("MUTATION_DENIED", "Requirement section not found");
    operations.push({ type: "replaceRange", startLine: range.startLine, endLine: range.endLine, lines: ["", ...input.statement.split(/\r?\n/), ""] });
    updatedFields.push("statement");
  }
  for (const [field, value] of Object.entries(tableCells)) {
    const write = planMetadataWrite(loaded.file, loaded.record, field, value);
    if (!write.ok) return mutationFail("MUTATION_DENIED", write.message);
    operations.push(write.operation);
    updatedFields.push(field);
  }

  return applyGranularPlan(input.id, loaded.file, operations, "update_requirement_fields", input.dryRun ?? false, updatedFields);
}

export async function replaceAcceptanceCriteria(root: ProjectRoot, input: ReplaceAcceptanceCriteriaInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  return withSrsMutationLock(root, { operation: "replace_acceptance_criteria", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    replaceAcceptanceCriteriaUnlocked(root, input)
  );
}

/**
 * @req FR-NODE-243 AC-5 — the new items are numbered from 1, skipping every number an expired
 * criterion holds, and each expired line is carried over byte-for-byte; lines are ordered by number.
 * Reusing an expired number would bind its old test citations and `Covers` cells to the new item.
 */
function acceptanceCriteriaLines(file: TextFile, record: RequirementRecord, items: ReplaceAcceptanceCriteriaInput["items"]): string[] {
  const numberOf = (acId: string): number => Number(acId.slice("AC-".length));
  const numbered = (record.expiredAcceptanceCriteria ?? []).map((criterion) => ({ number: numberOf(criterion.id), line: file.lines[criterion.line - 1] ?? "" }));
  const held = new Set(numbered.map((entry) => entry.number));
  let next = 1;
  for (const item of items) {
    while (held.has(next)) next += 1;
    numbered.push({ number: next, line: acceptanceCriterionLine(`AC-${next}`, item.text, item.checked === true) });
    next += 1;
  }
  return numbered.sort((left, right) => left.number - right.number).map((entry) => entry.line);
}

async function replaceAcceptanceCriteriaUnlocked(root: ProjectRoot, input: ReplaceAcceptanceCriteriaInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  if (!Array.isArray(input.items)) return mutationFail("USAGE", "items must be an array");
  if (input.items.length === 0) return mutationFail("USAGE", "items must contain at least one acceptance criterion");
  for (const item of input.items) {
    const invalid = assertText("acceptance criterion", item.text);
    if (invalid) return invalid as MutationResult<GranularRequirementEditOutput>;
    const opensSection = assertOpensNoBlockBoundary<GranularRequirementEditOutput>("acceptance criterion", item.text);
    if (opensSection) return opensSection;
  }
  const forged = refuseExpiredMarker<GranularRequirementEditOutput>("acceptance criterion", input.items.map((item) => item.text));
  if (forged) return forged;
  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const editable = assertEditable(loaded.record);
  if (editable) return editable as MutationResult<GranularRequirementEditOutput>;
  const range = sectionContentRange(loaded.file, loaded.record, "Acceptance Criteria");
  if (!range) return mutationFail("MUTATION_DENIED", "Acceptance Criteria section not found");
  const lines = ["", ...acceptanceCriteriaLines(loaded.file, loaded.record, input.items), ""];
  const operation: PatchOperation = { type: "replaceRange", startLine: range.startLine, endLine: range.endLine, lines };
  return applyGranularPlan(input.id, loaded.file, [operation], "replace_acceptance_criteria", input.dryRun ?? false, ["acceptanceCriteria"]);
}

/**
 * The section and header column each settable key of an evidence or trace row is written under: the
 * row is re-rendered by the table's own header, so a reordered table keeps every value under its
 * heading and a column no key names keeps its cell. @req FR-NODE-259 AC-2 AC-4
 */
const ROW_TABLES: Record<"verification_evidence" | "trace_links", { section: RowSection; columns: Readonly<Record<string, string>> }> = {
  verification_evidence: { section: "Verification Evidence", columns: { type: "Type", reference: "Reference", covers: "Covers", notes: "Notes" } },
  trace_links: { section: "Trace Links", columns: { type: "Type", reference: "Reference", relation: "Relation", notes: "Notes" } }
};

/**
 * @req FR-NODE-222 AC-1 AC-2 — the Change Notes data rows straight from the source lines, placeholder
 * rows included (the parsed record drops a row whose cells are all placeholders, which would leave it
 * undeletable), with every cell of a row a pipe split: the fragments after the second are joined back
 * into the reason, so a partial update keeps them (review r1 L5).
 */
function changeNoteSourceRows(file: TextFile, record: RequirementRecord): Array<{ line: number; date: string; change: string; reason: string }> {
  const range = sectionContentRange(file, record, "Change Notes");
  if (!range) return [];
  const rows: Array<{ line: number; date: string; change: string; reason: string }> = [];
  let seenHeader = false;
  for (let line = range.startLine; line <= range.endLine; line += 1) {
    const text = (file.lines[line - 1] ?? "").trim();
    if (!text.startsWith("|")) continue;
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    if (/^\|\s*:?-{3,}/.test(text)) continue;
    const cells = splitTableRow(text);
    rows.push({ line, date: cells[0] ?? "", change: cells[1] ?? "", reason: cells.slice(2).join(" / ") });
  }
  return rows;
}

// @req FR-NODE-222 AC-2 AC-4 — rebuilt as exactly three cells, every one through tableCellText.
function changeNoteReplacement(values: Record<string, string>, fallback: { date: string; change: string; reason: string }): string {
  const cell = (key: "date" | "change" | "reason"): string => tableCellText(values[key] ?? fallback[key]);
  return `| ${cell("date")} | ${cell("change")} | ${cell("reason")} |`;
}

export async function editRequirementTableRows(root: ProjectRoot, input: EditRequirementTableRowsInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  return withSrsMutationLock(root, { operation: "edit_requirement_table_rows", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    editRequirementTableRowsUnlocked(root, input)
  );
}

async function editRequirementTableRowsUnlocked(root: ProjectRoot, input: EditRequirementTableRowsInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  if (!Object.hasOwn(SETTABLE_ROW_COLUMNS, input.section)) return mutationFail("USAGE", "section must be verification_evidence, trace_links or change_notes");
  if (!Array.isArray(input.operations)) return mutationFail("USAGE", "operations must be an array");
  if (input.operations.length === 0) return mutationFail("USAGE", "operations must not be empty");
  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const editable = assertEditable(loaded.record);
  if (editable) return editable as MutationResult<GranularRequirementEditOutput>;

  const operations: PatchOperation[] = [];
  const rows: ReadonlyArray<{ line?: number }> =
    input.section === "verification_evidence"
      ? loaded.record.verificationEvidence
      : input.section === "trace_links"
        ? loaded.record.traceLinks
        : changeNoteSourceRows(loaded.file, loaded.record);
  for (const rowOperation of input.operations) {
    if (rowOperation.kind !== "update" && rowOperation.kind !== "delete") return mutationFail("USAGE", "operation kind must be update or delete");
    if (rowOperation.values !== undefined && (typeof rowOperation.values !== "object" || rowOperation.values === null || Array.isArray(rowOperation.values))) {
      return mutationFail("USAGE", "operation values must be an object");
    }
    // @req FR-NODE-093 — an unrecognised key must fail rather than be ignored. The row is rebuilt as
    // `values.covers ?? fallback.covers`, so a key the builder never reads yields a replacement
    // identical to the original and still reports ok/written: a governance edit the caller believes
    // happened and did not. The capitalised header spelling (`Covers`) is the likely mistake.
    const settable = SETTABLE_ROW_COLUMNS[input.section];
    for (const [field, value] of Object.entries(rowOperation.values ?? {})) {
      if (typeof value !== "string") return mutationFail("USAGE", `${field} value must be a string`);
      if (!settable.includes(field)) {
        return mutationFail("USAGE", `unknown ${input.section} column '${field}'; settable columns are ${settable.join(", ")}`);
      }
    }
    const rowIndex =
      rowOperation.rowIndex ??
      (input.section === "verification_evidence" && rowOperation.rowId ? loaded.record.verificationEvidence.findIndex((row) => row.id === rowOperation.rowId) : -1);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) return mutationFail("NOT_FOUND", `Table row not found for ${input.section}`);
    const row = rows[rowIndex]!;
    const line = row.line;
    if (!line) return mutationFail("MUTATION_DENIED", "Selected table row has no source line");
    const original = loaded.file.lines[line - 1] ?? "";
    if (rowOperation.kind === "delete") {
      operations.push({ type: "replaceRange", startLine: line, endLine: line, lines: [] });
      continue;
    }
    const values = rowOperation.values ?? {};
    if (input.section === "change_notes") {
      const note = row as { date: string; change: string; reason: string };
      operations.push({ type: "replaceLine", line, original, replacement: changeNoteReplacement(values, note) });
      continue;
    }
    const unsafe = assertSafeMarkdownTableCells(Object.fromEntries(Object.entries(values).map(([field, value]) => [`${input.section} ${field}`, value])));
    if (unsafe) return forwardFailure(unsafe);
    const { section, columns } = ROW_TABLES[input.section];
    const table = findSectionTable(loaded.file, loaded.record, section);
    const tableRow = table?.rowLines.indexOf(line) ?? -1;
    if (!table || tableRow < 0) return mutationFail("MUTATION_DENIED", `Selected row is not in the ${section} table`);
    const write = planTableRowUpdate(loaded.file, table, tableRow, Object.fromEntries(Object.entries(values).map(([field, value]) => [columns[field] ?? field, value])));
    if (!write.ok) return mutationFail("MUTATION_DENIED", write.message);
    operations.push(write.operation);
  }

  return applyGranularPlan(input.id, loaded.file, operations, "edit_requirement_table_rows", input.dryRun ?? false, [input.section, `changed:${todayStamp()}`]);
}
