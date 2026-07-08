import type { MutationResult, ProjectRoot, RequirementRecord } from "../types.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { addRequirement, type AddRequirementInput } from "./add-requirement.js";
import { updateStatus } from "./update-status.js";
import { revokeCompatibilityCheck } from "./add-compatibility-check.js";
import { mutationFail, mutationOk } from "./guards.js";

// FR-NODE-045 — supersede_requirement strict two-call mutation with guards and A1
// invalidation.
//
// supersede_requirement performs the strict ordered two-call sequence
//   T1 add_requirement (id unspecified, a `supersedes oldId` trace row), capturing
//      the newly minted newId from T1, then
//   T2 hardened updateStatus(oldId, "discarded").
// It enforces the self-reference, reverse-direction-duplicate, and N>1 successor
// ambiguity guards before any mutation, keeps journal resumption idempotent (no
// duplicate Change Notes row on re-run), and invalidates the oldId endpoint's
// `checked_compatible` rows via revoke_compatibility_check after supersede.

const SUPERSEDES_RELATION = "supersedes";
const COMPATIBLE_RELATION = "checked_compatible";

/**
 * Input for {@link supersedeRequirement}. The new-requirement payload (scope,
 * target, title, statement, acceptanceCriteria, …) feeds T1 add_requirement; the
 * optional guard hints (successorId, reverseOf) let a caller assert the intended
 * successor identity so the self-reference and reverse-direction-duplicate guards
 * can reject an ill-formed supersede before any mutation. reason /
 * confirmDiscardVerified flow into the hardened T2 discard.
 * @req FR-NODE-045
 */
export interface SupersedeRequirementInput {
  oldId: string;
  scope: string;
  target: string;
  title: string;
  statement: string;
  acceptanceCriteria: string[];
  reason?: string;
  confirmDiscardVerified?: boolean;
  dryRun?: boolean;
  /**
   * The intended successor identity. When it equals oldId the supersede is
   * self-referential and rejected (AC-2). Otherwise it pins the reverse-direction
   * duplicate guard's candidate successor.
   */
  successorId?: string;
  /**
   * Reverse-direction duplicate hint: the candidate successor identity whose
   * existing outgoing `supersedes oldId` edge would make this supersede a
   * reverse-direction duplicate (AC-2).
   */
  reverseOf?: string;
}

/**
 * Result value surfaced on a successful supersede: the newId minted by T1
 * add_requirement (undefined only when an idempotent resumption skipped T1), and
 * the discarded oldId.
 * @req FR-NODE-045
 */
export interface SupersedeRequirementOutput {
  oldId: string;
  newId?: string;
  written: boolean;
}

/**
 * Counts how many requirements in the workspace carry an outgoing
 * `supersedes oldId` trace row, i.e. how many successors already supersede oldId.
 * @req FR-NODE-045
 */
function countIncomingSupersedes(records: readonly RequirementRecord[], oldId: string): number {
  let count = 0;
  for (const record of records) {
    for (const link of record.traceLinks) {
      if (link.type === "Requirement" && link.relation === SUPERSEDES_RELATION && link.reference === oldId) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Reports whether `candidateId` already has an outgoing `supersedes oldId` edge,
 * which would make a fresh supersede in that direction a reverse-direction
 * duplicate.
 * @req FR-NODE-045
 */
function hasOutgoingSupersedes(records: readonly RequirementRecord[], candidateId: string, oldId: string): boolean {
  const candidate = records.find((record) => record.id === candidateId);
  if (!candidate) return false;
  return candidate.traceLinks.some(
    (link) => link.type === "Requirement" && link.relation === SUPERSEDES_RELATION && link.reference === oldId
  );
}

/**
 * Collects the distinct peer REQ-IDs of every `checked_compatible` row that
 * touches `oldId` — whether oldId holds the row (peer = row reference) or is the
 * referenced peer (peer = row holder). Each pair is revoked after supersede so no
 * compatibility row referencing oldId survives (AC-5).
 * @req FR-NODE-045
 */
function compatibilityPeers(records: readonly RequirementRecord[], oldId: string): string[] {
  const peers = new Set<string>();
  for (const record of records) {
    for (const link of record.traceLinks) {
      if (link.relation !== COMPATIBLE_RELATION) continue;
      if (record.id === oldId) peers.add(link.reference);
      else if (link.reference === oldId) peers.add(record.id);
    }
  }
  return [...peers];
}

/**
 * Strict ordered two-call supersede: guard, then T1 add_requirement (minting the
 * successor and its `supersedes oldId` trace), then T2 hardened
 * updateStatus(oldId, discarded), then revoke the oldId endpoint's compatibility
 * rows. Guards (self-reference, reverse-direction duplicate, N>1 successor
 * ambiguity) run before any mutation so a rejected supersede leaves the workspace
 * untouched. Journal resumption is idempotent: when oldId is already discarded
 * with a successor, T1 is skipped and the T2 reason is omitted so no duplicate
 * Change Notes row is appended.
 * @req FR-NODE-045
 */
export async function supersedeRequirement(
  root: ProjectRoot,
  input: SupersedeRequirementInput
): Promise<MutationResult<SupersedeRequirementOutput>> {
  const { oldId } = input;

  // Self-reference guard (AC-2): the successor cannot be the very requirement it
  // supersedes.
  if (input.successorId !== undefined && input.successorId === oldId) {
    return mutationFail(
      "MUTATION_DENIED",
      `Cannot supersede ${oldId} with itself: the successor must be a distinct requirement`
    ) as MutationResult<SupersedeRequirementOutput>;
  }

  const workspace = await parseWorkspace(root);
  const oldRecord = workspace.records.find((record) => record.id === oldId);
  if (!oldRecord) {
    return mutationFail("NOT_FOUND", `Requirement not found: ${oldId}`) as MutationResult<SupersedeRequirementOutput>;
  }

  // Reverse-direction-duplicate guard (AC-2): superseding oldId with a successor
  // identity that already supersedes oldId would create a duplicate edge.
  if (input.reverseOf !== undefined && hasOutgoingSupersedes(workspace.records, input.reverseOf, oldId)) {
    return mutationFail(
      "MUTATION_DENIED",
      `Cannot supersede ${oldId} with ${input.reverseOf}: a reverse-direction supersedes edge already exists`
    ) as MutationResult<SupersedeRequirementOutput>;
  }

  const incomingBefore = countIncomingSupersedes(workspace.records, oldId);

  // Idempotent resumption: when oldId is already discarded and already has a
  // successor, the supersede was completed by a prior run. Skip T1 (do not mint a
  // duplicate successor) and omit the T2 reason so no duplicate Change Notes row
  // is appended, but still re-assert the discarded status and revoke compat rows.
  const resuming = oldRecord.status === "discarded" && incomingBefore >= 1;

  // N>1 successor ambiguity guard (AC-2): when two or more requirements already
  // supersede oldId the successor is ambiguous and a further supersede is denied.
  // Skipped on idempotent resumption, where the single prior successor is expected.
  if (!resuming && incomingBefore > 1) {
    return mutationFail(
      "MUTATION_DENIED",
      `Cannot supersede ${oldId}: it already has ${incomingBefore} successors (ambiguous)`
    ) as MutationResult<SupersedeRequirementOutput>;
  }

  let newId: string | undefined;
  let written = false;

  // T1 — add_requirement minting the successor with a `supersedes oldId` trace row.
  if (!resuming) {
    const addInput: AddRequirementInput = {
      type: "functional",
      scope: input.scope,
      target: input.target,
      title: input.title,
      statement: input.statement,
      acceptanceCriteria: input.acceptanceCriteria,
      trace: [{ type: "Requirement", reference: oldId, relation: SUPERSEDES_RELATION }],
      dryRun: input.dryRun ?? false
    };
    const added = await addRequirement(root, addInput);
    if (!added.ok) {
      return {
        ok: false,
        error: added.error ?? { code: "MUTATION_DENIED", message: `Failed to add successor for ${oldId}` },
        diagnostics: added.diagnostics,
        diagnosticsSummary: added.diagnosticsSummary
      };
    }
    newId = added.value?.requirementId;
    written = written || (added.value?.written ?? false);
  }

  // T2 — hardened updateStatus(oldId, discarded), ordered strictly after T1. On
  // idempotent resumption the reason is omitted so no duplicate Change Notes row
  // is appended.
  const discardInput: Parameters<typeof updateStatus>[1] = {
    id: oldId,
    status: "discarded",
    dryRun: input.dryRun ?? false
  };
  if (!resuming && input.reason !== undefined) discardInput.reason = input.reason;
  if (input.confirmDiscardVerified !== undefined) discardInput.confirmDiscardVerified = input.confirmDiscardVerified;
  const discarded = await updateStatus(root, discardInput);
  if (!discarded.ok) {
    return {
      ok: false,
      error: discarded.error ?? { code: "MUTATION_DENIED", message: `Failed to discard ${oldId}` },
      diagnostics: discarded.diagnostics,
      diagnosticsSummary: discarded.diagnosticsSummary
    };
  }
  written = written || ((discarded.value as { written?: boolean } | undefined)?.written ?? false);

  // A1 invalidation (AC-5) — revoke every compatibility check touching oldId so no
  // `checked_compatible` row referencing it survives the supersede.
  const peers = compatibilityPeers(workspace.records, oldId);
  for (const peerId of peers) {
    const revoked = await revokeCompatibilityCheck(root, {
      aReqId: oldId,
      bReqId: peerId,
      dryRun: input.dryRun ?? false
    });
    if (!revoked.ok) {
      return {
        ok: false,
        error: revoked.error ?? { code: "MUTATION_DENIED", message: `Failed to revoke compatibility for ${oldId}` },
        diagnostics: revoked.diagnostics,
        diagnosticsSummary: revoked.diagnosticsSummary
      };
    }
    written = written || ((revoked.value as { written?: boolean } | undefined)?.written ?? false);
  }

  const value: SupersedeRequirementOutput = { oldId, written };
  if (newId !== undefined) value.newId = newId;
  return mutationOk(value);
}
