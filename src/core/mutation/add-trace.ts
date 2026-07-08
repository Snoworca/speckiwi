import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import type { MutationResult, ParsedWorkspace, ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findMetadataLine, findSectionTableInsertionLine } from "./internal.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";
import { withSrsMutationLock } from "./srs-lock.js";

export interface AddTraceInput {
  id: string;
  type: string;
  reference: string;
  relation: string;
  notes?: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

function insertLinesOperation(file: TextFile, line: number, lines: string[]): PatchOperation {
  const operation: PatchOperation = { type: "insertLines", line, lines };
  const expectedBefore = file.lines[line - 2];
  if (expectedBefore !== undefined) operation.expectedBefore = expectedBefore;
  const expectedAfter = file.lines[line - 1];
  if (expectedAfter !== undefined) operation.expectedAfter = expectedAfter;
  return operation;
}

function findLoadedRecord(workspace: ParsedWorkspace, id: string): { record: RequirementRecord; file: TextFile } | undefined {
  const record = workspace.records.find((candidate) => candidate.id === id);
  if (!record) return undefined;
  const file = workspace.files.find((candidate) => candidate.relativePath === record.filePath);
  if (!file) return undefined;
  return { record, file };
}

function stalePatchMutationFailure(error: unknown, filePath: string): MutationResult | undefined {
  if (!isStalePatchError(error)) return undefined;
  const message = `Mutation snapshot is stale for ${filePath}; rerun the command to retry against the latest file.`;
  const staleDiagnostic = diagnostic("SRS-E032", "error", message, { filePath });
  return mutationFail("STALE_PATCH", message, [staleDiagnostic], { staleGuard: { filePath, retry: "rerun the command" } });
}

export async function addTraceLink(root: ProjectRoot, input: AddTraceInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "add_trace_link", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => addTraceLinkUnlocked(root, input));
}

async function addTraceLinkUnlocked(root: ProjectRoot, input: AddTraceInput): Promise<MutationResult> {
  const notes = input.notes ?? "-";
  const unsafeCell = assertSafeMarkdownTableCells({
    "Trace Link type": input.type,
    "Trace Link reference": input.reference,
    "Trace Link relation": input.relation,
    "Trace Link notes": notes
  });
  if (unsafeCell) return unsafeCell;
  const workspace = await parseWorkspace(root);
  if (input.type === "Requirement" && !workspace.records.some((record) => record.id === input.reference)) {
    return mutationFail("MUTATION_DENIED", `Trace target not found: ${input.reference}`);
  }
  const loaded = findLoadedRecord(workspace, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Trace Links");
  if (!insertLine) return mutationFail("MUTATION_DENIED", "Trace Links table not found");
  const row = `| ${input.type} | ${input.reference} | ${input.relation} | ${notes} |`;
  try {
    const dryRun = input.dryRun ?? false;
    const plan = createPatchPlan(loaded.file, [insertLinesOperation(loaded.file, insertLine, [row])]);
    const applied = await applyPatchPlan(plan, { dryRun });
    return withMutationEnvelope(
      mutationOk({ id: input.id, reference: input.reference, written: applied.written }),
      mutationEnvelopeFromPlan("add_trace_link", plan, dryRun, applied.written)
    );
  } catch (error) {
    const staleFailure = stalePatchMutationFailure(error, loaded.file.relativePath);
    if (staleFailure) return staleFailure;
    throw error;
  }
}

// FR-NODE-052 — setSupersede core.
//
// Writes the Supersedes / Superseded By metadata field on a requirement and, when trace sync
// is enabled, the matching `supersedes` / `superseded_by` Trace Link row — in a single patch,
// without disturbing any other metadata line. Re-setting an existing field replaces its row
// rather than appending a duplicate (FND-006), and every successful call surfaces an advisory
// warning that the endpoint's compatibility cache may be stale (FND-004).

export interface SetSupersedeInput {
  id: string;
  supersedes?: string;
  supersededBy?: string;
  syncTrace?: boolean;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface SetSupersedeOutput {
  id: string;
  written: boolean;
  warnings: string[];
}

interface SupersedeField {
  label: "Supersedes" | "Superseded By";
  value: string;
  relation: "supersedes" | "superseded_by";
}

/**
 * Finds the line just after the last row of the requirement's `| Field | Value |` metadata
 * table so a new metadata row can be appended without disturbing any existing line.
 * @req FR-NODE-052
 */
function findMetadataTableInsertionLine(file: TextFile, record: RequirementRecord): number | undefined {
  const end = record.blockEndLine ?? file.lines.length;
  let headerLine = -1;
  for (let line = record.headingLine; line <= end; line += 1) {
    if ((file.lines[line - 1] ?? "").startsWith("| Field | Value |")) {
      headerLine = line;
      break;
    }
  }
  if (headerLine < 0) return undefined;
  let lastRow = headerLine + 1; // the `| --- | --- |` separator row
  for (let line = headerLine + 2; line <= end; line += 1) {
    if ((file.lines[line - 1] ?? "").startsWith("|")) lastRow = line;
    else break;
  }
  return lastRow + 1;
}

export async function setSupersede(root: ProjectRoot, input: SetSupersedeInput): Promise<MutationResult<SetSupersedeOutput>> {
  return withSrsMutationLock(
    root,
    { operation: "set_supersede", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock },
    () => setSupersedeUnlocked(root, input)
  );
}

async function setSupersedeUnlocked(root: ProjectRoot, input: SetSupersedeInput): Promise<MutationResult<SetSupersedeOutput>> {
  const fields: SupersedeField[] = [];
  if (input.supersedes !== undefined) fields.push({ label: "Supersedes", value: input.supersedes, relation: "supersedes" });
  if (input.supersededBy !== undefined) fields.push({ label: "Superseded By", value: input.supersededBy, relation: "superseded_by" });
  if (fields.length === 0) {
    return mutationFail("USAGE", "supersedes or supersededBy is required") as MutationResult<SetSupersedeOutput>;
  }
  const unsafe = assertSafeMarkdownTableCells<SetSupersedeOutput>(
    Object.fromEntries(fields.map((field) => [`${field.label} value`, field.value]))
  );
  if (unsafe) return unsafe;

  const workspace = await parseWorkspace(root);
  const loaded = findLoadedRecord(workspace, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`) as MutationResult<SetSupersedeOutput>;
  const { record, file } = loaded;

  const metadataInsertLine = findMetadataTableInsertionLine(file, record);
  if (metadataInsertLine === undefined) {
    return mutationFail("MUTATION_DENIED", "Requirement metadata table not found") as MutationResult<SetSupersedeOutput>;
  }

  const operations: PatchOperation[] = [];
  for (const field of fields) {
    const row = `| ${field.label} | ${field.value} |`;
    const existing = findMetadataLine(file, record, field.label);
    if (existing) {
      const original = file.lines[existing - 1];
      operations.push(original !== undefined ? { type: "replaceLine", line: existing, original, replacement: row } : { type: "replaceLine", line: existing, replacement: row });
    } else {
      operations.push(insertLinesOperation(file, metadataInsertLine, [row]));
    }
  }

  if (input.syncTrace) {
    const traceInsertLine = findSectionTableInsertionLine(file, record, "Trace Links");
    if (traceInsertLine) {
      for (const field of fields) {
        operations.push(insertLinesOperation(file, traceInsertLine, [`| Requirement | ${field.value} | ${field.relation} | - |`]));
      }
    }
  }

  const warnings = [
    `Compatibility cache may be stale for ${input.id} after this supersede change; re-run any compatibility checks that touch it.`
  ];
  try {
    const dryRun = input.dryRun ?? false;
    const plan = createPatchPlan(file, operations);
    const applied = await applyPatchPlan(plan, { dryRun });
    return {
      ...mutationOk({ id: input.id, written: applied.written, warnings }),
      patch: summarizePatch(plan, dryRun),
      mutation: mutationEnvelopeFromPlan("set_supersede", plan, dryRun, applied.written)
    };
  } catch (error) {
    const staleFailure = stalePatchMutationFailure(error, file.relativePath);
    if (staleFailure) return staleFailure as MutationResult<SetSupersedeOutput>;
    throw error;
  }
}
