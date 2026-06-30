import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type { MutationResult, ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findSectionTableInsertionLine } from "./internal.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";
import { withSrsMutationLock } from "./srs-lock.js";

export interface AddEvidenceInput {
  id: string;
  type: string;
  reference: string;
  covers?: string;
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

function generateNextEvidenceId(record: RequirementRecord): string {
  const used = record.verificationEvidence
    .map((row) => /^VE-(\d+)$/.exec(row.id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number.parseInt(value, 10));
  return `VE-${Math.max(0, ...used) + 1}`;
}

async function loadFreshRecord(root: ProjectRoot, id: string): Promise<{ record: RequirementRecord; file: TextFile } | undefined> {
  const workspace = await parseWorkspace(root);
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

export async function addVerificationEvidence(root: ProjectRoot, input: AddEvidenceInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "add_verification_evidence", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => addVerificationEvidenceUnlocked(root, input));
}

async function addVerificationEvidenceUnlocked(root: ProjectRoot, input: AddEvidenceInput): Promise<MutationResult> {
  if (!input.reference.trim()) return mutationFail("USAGE", "Evidence reference is required");
  const covers = input.covers ?? "all";
  const notes = input.notes ?? "-";
  const unsafeCell = assertSafeMarkdownTableCells({
    "Verification Evidence type": input.type,
    "Verification Evidence reference": input.reference,
    "Verification Evidence covers": covers,
    "Verification Evidence notes": notes
  });
  if (unsafeCell) return unsafeCell;
  const loaded = await loadFreshRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const next = generateNextEvidenceId(loaded.record);
  const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Verification Evidence");
  if (!insertLine) return mutationFail("MUTATION_DENIED", "Verification Evidence table not found");
  const row = `| ${next} | ${input.type} | ${input.reference} | ${covers} | ${notes} |`;
  try {
    const dryRun = input.dryRun ?? false;
    const plan = createPatchPlan(loaded.file, [insertLinesOperation(loaded.file, insertLine, [row])]);
    const applied = await applyPatchPlan(plan, { dryRun });
    return withMutationEnvelope(
      mutationOk({ id: input.id, evidenceId: next, written: applied.written }),
      mutationEnvelopeFromPlan("add_verification_evidence", plan, dryRun, applied.written)
    );
  } catch (error) {
    const staleFailure = stalePatchMutationFailure(error, loaded.file.relativePath);
    if (staleFailure) return staleFailure;
    throw error;
  }
}
