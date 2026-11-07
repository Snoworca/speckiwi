import { diagnostic } from "../diagnostic.js";
import { applyPatchPlan, isStalePatchError } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { summarizePatch } from "../patch/hunk-summary.js";
import type { MutationResult, ParsedWorkspace, ProjectRoot, RequirementRecord, TextFile } from "../types.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { judgeDiscardedTraceTargets } from "../discarded-trace-target.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { mutationFail, mutationOk } from "./guards.js";
import { planMetadataWrite, planSectionRowsInsert } from "./internal.js";
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

interface WrittenTraceRow {
  type: string;
  reference: string;
  relation: string;
}

/**
 * @req FR-NODE-272 AC-5 — the refusal of a `Requirement` row to a discarded requirement that does not
 * record the supersede, decided by the rule links check reports with (SRS-W081).
 */
export function refuseDiscardedTraceTargets<T = unknown>(records: readonly RequirementRecord[], rows: readonly WrittenTraceRow[]): MutationResult<T> | undefined {
  const judge = judgeDiscardedTraceTargets(records);
  for (const row of rows) {
    const discarded = judge.refuses(row);
    if (discarded) {
      return mutationFail(
        "USAGE",
        `Trace target ${discarded.summary}. Point the row at a live requirement, or record the supersede with relation supersedes or superseded_by.`
      ) as MutationResult<T>;
    }
  }
  return undefined;
}

/**
 * @req FR-NODE-272 AC-1, AC-4 — the same refusal, from a workspace read before the SRS lock is taken, so a
 * refused link never takes the lock. The writer checks again inside the lock, for a target discarded
 * between the two reads.
 */
export async function refuseDiscardedTraceTargetsBeforeLock<T = unknown>(root: ProjectRoot, rows: readonly WrittenTraceRow[]): Promise<MutationResult<T> | undefined> {
  if (!rows.some((row) => row.type === "Requirement")) return undefined;
  return refuseDiscardedTraceTargets<T>((await parseWorkspace(root)).records, rows);
}

export async function addTraceLink(root: ProjectRoot, input: AddTraceInput): Promise<MutationResult> {
  const refusal = await refuseDiscardedTraceTargetsBeforeLock(root, [input]);
  if (refusal) return refusal;
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
  const discardedRefusal = refuseDiscardedTraceTargets(workspace.records, [input]);
  if (discardedRefusal) return discardedRefusal;
  const loaded = findLoadedRecord(workspace, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  // @req FR-NODE-259 AC-2 @req FR-NODE-278 AC-1 AC-2 — under the table's own header, the table made when missing.
  const insert = planSectionRowsInsert(loaded.file, loaded.record, "Trace Links", [
    { Type: input.type, Reference: input.reference, Relation: input.relation, Notes: notes }
  ]);
  if (!insert.ok) return mutationFail("MUTATION_DENIED", insert.message);
  try {
    const dryRun = input.dryRun ?? false;
    const plan = createPatchPlan(loaded.file, [insert.operation]);
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

// FR-NODE-063 — setSupersede core.
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

  const operations: PatchOperation[] = [];
  for (const field of fields) {
    const write = planMetadataWrite(file, record, field.label, field.value, { insertWhenMissing: true });
    if (!write.ok) return mutationFail("MUTATION_DENIED", write.message) as MutationResult<SetSupersedeOutput>;
    operations.push(write.operation);
  }

  if (input.syncTrace) {
    const insert = planSectionRowsInsert(
      file,
      record,
      "Trace Links",
      fields.map((field) => ({ Type: "Requirement", Reference: field.value, Relation: field.relation, Notes: "-" }))
    );
    if (!insert.ok) return mutationFail("MUTATION_DENIED", insert.message) as MutationResult<SetSupersedeOutput>;
    operations.push(insert.operation);
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
