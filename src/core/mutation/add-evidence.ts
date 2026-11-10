import { diagnostic } from "../diagnostic.js";
import { COVERS_ACCEPTED_FORMS, coversRangeIn } from "../evidence-covers.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import type { MutationResult, ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { planSectionRowsInsert } from "./internal.js";
import { assertSafeMarkdownTableCells } from "./table-cell.js";
import { withSrsMutationLock } from "./srs-lock.js";
import { collectEvidenceReferenceIssuesForRecord, describeEvidenceIssues } from "../workflow/release-readiness.js";

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

/**
 * @req IR-CLI-118 AC-4 — the refusals that read no SRS, in one place: the mutation calls it, and
 * `orchestrate replay` calls it on every deferred call before it applies the first.
 */
export function evidenceInputRefusal(input: Pick<AddEvidenceInput, "type" | "reference" | "covers" | "notes">): MutationResult | undefined {
  if (!input.reference.trim()) return mutationFail("USAGE", "Evidence reference is required");
  const covers = input.covers ?? "all";
  // @req FR-NODE-248 AC-1 — a range reads as two criteria to every coverage reader.
  const range = coversRangeIn(covers);
  if (range !== null) {
    return mutationFail("USAGE", `Verification Evidence covers holds the range ${range}; name ${COVERS_ACCEPTED_FORMS}, one criterion at a time`);
  }
  return assertSafeMarkdownTableCells({
    "Verification Evidence type": input.type,
    "Verification Evidence reference": input.reference,
    "Verification Evidence covers": covers,
    "Verification Evidence notes": input.notes ?? "-"
  });
}

async function addVerificationEvidenceUnlocked(root: ProjectRoot, input: AddEvidenceInput): Promise<MutationResult> {
  const refused = evidenceInputRefusal(input);
  if (refused) return refused;
  const covers = input.covers ?? "all";
  const notes = input.notes ?? "-";
  const loaded = await loadFreshRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  const next = generateNextEvidenceId(loaded.record);
  // @req FR-NODE-287 AC-3, AC-4 — the rule the `verified` transition applies, judged on the new row alone:
  // a verified requirement may not gain a row it could not have been promoted with, while a requirement
  // still in work may record evidence for a file the same change is about to add.
  const row = { id: next, type: input.type, reference: input.reference, covers, notes };
  const unresolved = collectEvidenceReferenceIssuesForRecord(root.root, { ...loaded.record, verificationEvidence: [row] });
  if (unresolved.length > 0 && loaded.record.status === "verified") {
    return mutationFail("MUTATION_DENIED", `${input.id} is verified, so its evidence must resolve: ${describeEvidenceIssues(unresolved)}`);
  }
  const warnings =
    unresolved.length === 0
      ? []
      : [diagnostic("SRS-W082", "warning", `${input.id} Verification Evidence ${next} does not resolve yet: ${describeEvidenceIssues(unresolved)}`, { filePath: loaded.record.filePath, requirementId: input.id })];
  // @req FR-NODE-259 AC-2 @req FR-NODE-278 AC-3 — under the table's own header, the table made when missing.
  const insert = planSectionRowsInsert(loaded.file, loaded.record, "Verification Evidence", [
    { "Evidence ID": next, Type: input.type, Reference: input.reference, Covers: covers, Notes: notes }
  ]);
  if (!insert.ok) return mutationFail("MUTATION_DENIED", insert.message);
  try {
    const dryRun = input.dryRun ?? false;
    const plan = createPatchPlan(loaded.file, [insert.operation]);
    const applied = await applyPatchPlan(plan, { dryRun });
    return withMutationEnvelope(
      mutationOk({ id: input.id, evidenceId: next, written: applied.written }, warnings),
      mutationEnvelopeFromPlan("add_verification_evidence", plan, dryRun, applied.written)
    );
  } catch (error) {
    const staleFailure = stalePatchMutationFailure(error, loaded.file.relativePath);
    if (staleFailure) return staleFailure;
    throw error;
  }
}
