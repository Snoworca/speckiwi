import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import type { MutationResult, ParsedWorkspace, ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findSectionTableInsertionLine } from "./internal.js";
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
