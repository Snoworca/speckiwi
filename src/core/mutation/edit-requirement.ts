import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { PRIORITY_LEVELS, RISK_LEVELS, type MutationResult, type ProjectRoot, type RequirementRecord, type TextFile } from "../types.js";
import { mutationEnvelopeFromPlan, mutationNoopEnvelope, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findMetadataLine, loadRecordWithWorkspace } from "./internal.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";

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

export type RequirementTableSection = "verification_evidence" | "trace_links";

// @req FR-NODE-093 — the columns a row update may set, per section. An evidence row's id is absent
// deliberately: the renderer always writes the existing id, so accepting `id` would silently drop it.
const SETTABLE_ROW_COLUMNS: Record<RequirementTableSection, readonly string[]> = {
  verification_evidence: ["type", "reference", "covers", "notes"],
  trace_links: ["type", "reference", "relation", "notes"]
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

export interface GranularRequirementEditOutput {
  id: string;
  written: boolean;
  updatedFields: string[];
  record?: RequirementRecord;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

function assertEditable(record: RequirementRecord): MutationResult | undefined {
  if (record.status === "verified") return mutationFail("MUTATION_DENIED", "Granular edits cannot modify verified requirements; change status through a guarded status mutation first");
  return undefined;
}

function assertText(label: string, value: string): MutationResult | undefined {
  if (typeof value !== "string") return mutationFail("USAGE", `${label} must be a string`);
  if (value.length === 0) return mutationFail("USAGE", `${label} cannot be empty`);
  if (CONTROL_CHAR_RE.test(value)) return mutationFail("USAGE", `${label} contains forbidden control characters`);
  return undefined;
}

function assertLineText(label: string, value: string): MutationResult | undefined {
  const invalid = assertText(label, value);
  if (invalid) return invalid;
  if (/[\r\n]/.test(value)) return mutationFail("USAGE", `${label} cannot contain newline characters`);
  return undefined;
}

function sectionContentRange(file: TextFile, record: RequirementRecord, heading: string): { startLine: number; endLine: number } | undefined {
  const start = record.sectionLines?.[heading];
  if (!start) return undefined;
  const end = record.blockEndLine ?? file.lines.length;
  let nextHeading = end + 1;
  for (let line = start + 1; line <= end; line += 1) {
    if ((file.lines[line - 1] ?? "").startsWith("#### ")) {
      nextHeading = line;
      break;
    }
  }
  return { startLine: start + 1, endLine: nextHeading - 1 };
}

function metadataValueLine(field: string, value: string): string {
  return `| ${field} | ${value} |`;
}

async function applyGranularPlan(
  root: ProjectRoot,
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
    const loadedAfter = applied.written ? await loadRecordWithWorkspace(root, id) : undefined;
    return withMutationEnvelope(
      mutationOk({
        id,
        written: applied.written,
        updatedFields,
        ...(loadedAfter?.record ? { record: loadedAfter.record } : {})
      }),
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
    const invalid = assertLineText("title", input.title);
    if (invalid) return invalid as MutationResult<GranularRequirementEditOutput>;
  }
  if (input.statement !== undefined) {
    const invalid = assertText("statement", input.statement);
    if (invalid) return invalid as MutationResult<GranularRequirementEditOutput>;
  }

  const operations: PatchOperation[] = [];
  const updatedFields: string[] = [];
  if (input.title !== undefined) {
    const original = loaded.file.lines[loaded.record.headingLine - 1] ?? "";
    operations.push({ type: "replaceLine", line: loaded.record.headingLine, original, replacement: `### ${input.id} — ${input.title}` });
    updatedFields.push("title");
  }
  if (input.statement !== undefined) {
    const range = sectionContentRange(loaded.file, loaded.record, "Requirement");
    if (!range) return mutationFail("MUTATION_DENIED", "Requirement section not found");
    operations.push({ type: "replaceRange", startLine: range.startLine, endLine: range.endLine, lines: ["", ...input.statement.split(/\r?\n/), ""] });
    updatedFields.push("statement");
  }
  for (const [field, value] of Object.entries(tableCells)) {
    const line = findMetadataLine(loaded.file, loaded.record, field);
    if (!line) return mutationFail("MUTATION_DENIED", `${field} metadata row not found`);
    const original = loaded.file.lines[line - 1] ?? "";
    operations.push({ type: "replaceLine", line, original, replacement: metadataValueLine(field, value) });
    updatedFields.push(field);
  }

  return applyGranularPlan(root, input.id, loaded.file, operations, "update_requirement_fields", input.dryRun ?? false, updatedFields);
}

export async function replaceAcceptanceCriteria(root: ProjectRoot, input: ReplaceAcceptanceCriteriaInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  return withSrsMutationLock(root, { operation: "replace_acceptance_criteria", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    replaceAcceptanceCriteriaUnlocked(root, input)
  );
}

async function replaceAcceptanceCriteriaUnlocked(root: ProjectRoot, input: ReplaceAcceptanceCriteriaInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  if (!Array.isArray(input.items)) return mutationFail("USAGE", "items must be an array");
  if (input.items.length === 0) return mutationFail("USAGE", "items must contain at least one acceptance criterion");
  for (const item of input.items) {
    const invalid = assertText("acceptance criterion", item.text);
    if (invalid) return invalid as MutationResult<GranularRequirementEditOutput>;
  }
  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const editable = assertEditable(loaded.record);
  if (editable) return editable as MutationResult<GranularRequirementEditOutput>;
  const range = sectionContentRange(loaded.file, loaded.record, "Acceptance Criteria");
  if (!range) return mutationFail("MUTATION_DENIED", "Acceptance Criteria section not found");
  const lines = [
    "",
    ...input.items.map((item, index) => `- [${item.checked ? "x" : " "}] AC-${index + 1}: ${item.text}`),
    ""
  ];
  const operation: PatchOperation = { type: "replaceRange", startLine: range.startLine, endLine: range.endLine, lines };
  return applyGranularPlan(root, input.id, loaded.file, [operation], "replace_acceptance_criteria", input.dryRun ?? false, ["acceptanceCriteria"]);
}

function evidenceReplacement(values: Record<string, string>, fallback: { id: string; type: string; reference: string; covers: string; notes: string }): string {
  return `| ${fallback.id} | ${values.type ?? fallback.type} | ${values.reference ?? fallback.reference} | ${values.covers ?? fallback.covers} | ${values.notes ?? fallback.notes} |`;
}

function traceReplacement(values: Record<string, string>, fallback: { type: string; reference: string; relation: string; notes: string }): string {
  return `| ${values.type ?? fallback.type} | ${values.reference ?? fallback.reference} | ${values.relation ?? fallback.relation} | ${values.notes ?? fallback.notes} |`;
}

export async function editRequirementTableRows(root: ProjectRoot, input: EditRequirementTableRowsInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  return withSrsMutationLock(root, { operation: "edit_requirement_table_rows", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () =>
    editRequirementTableRowsUnlocked(root, input)
  );
}

async function editRequirementTableRowsUnlocked(root: ProjectRoot, input: EditRequirementTableRowsInput): Promise<MutationResult<GranularRequirementEditOutput>> {
  if (input.section !== "verification_evidence" && input.section !== "trace_links") return mutationFail("USAGE", "section must be verification_evidence or trace_links");
  if (!Array.isArray(input.operations)) return mutationFail("USAGE", "operations must be an array");
  if (input.operations.length === 0) return mutationFail("USAGE", "operations must not be empty");
  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const editable = assertEditable(loaded.record);
  if (editable) return editable as MutationResult<GranularRequirementEditOutput>;

  const operations: PatchOperation[] = [];
  const rows = input.section === "verification_evidence" ? loaded.record.verificationEvidence : loaded.record.traceLinks;
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
    const unsafe = assertSafeMarkdownTableCells(Object.fromEntries(Object.entries(values).map(([field, value]) => [`${input.section} ${field}`, value])));
    if (unsafe) return forwardFailure(unsafe);
    if (input.section === "verification_evidence") {
      const evidence = row as { id: string; type: string; reference: string; covers: string; notes: string };
      operations.push({ type: "replaceLine", line, original, replacement: evidenceReplacement(values, evidence) });
    } else {
      const trace = row as { type: string; reference: string; relation: string; notes: string };
      operations.push({ type: "replaceLine", line, original, replacement: traceReplacement(values, trace) });
    }
  }

  return applyGranularPlan(root, input.id, loaded.file, operations, "edit_requirement_table_rows", input.dryRun ?? false, [input.section, `changed:${todayIso()}`]);
}
