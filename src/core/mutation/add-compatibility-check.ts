import type { MutationResult, ProjectRoot, RequirementRecord, TraceLink } from "../types.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { addTraceLink } from "./add-trace.js";
import { mutationFail, mutationOk } from "./guards.js";
import { loadRecord } from "./internal.js";
import { compareReqId, computeSemanticSha } from "./records.js";

// FR-NODE-038 — add_compatibility_check mutation.
//
// Records that two requirements have been checked for mutual compatibility by
// inserting a single `checked_compatible` Trace Links row on the
// compareReqId-minimum (self) block. The row Reference is the peer (max-side)
// bare REQ-ID, and its Notes encode the current self and peer semanticSha pins so
// a later content change on either endpoint can be detected. The mutation is
// guarded by endpoint liveness, frozen-block protection, and per-pair dedup.

export interface AddCompatibilityCheckInput {
  aReqId: string;
  bReqId: string;
  dryRun?: boolean;
}

/** Relation tag for the single normalized compatibility-check row. */
const COMPATIBLE_RELATION = "checked_compatible";

/**
 * Formula/format-version tag pinned by every compatibility row, asserting which
 * semanticSha normalization contract produced the pins (SRS-MD-Rules §23.5).
 */
const COMPATIBILITY_FPV = "fpv1";

/**
 * Renders the Notes cell carrying the format-version tag, the bidirectional
 * semanticSha pins, and the check timestamp in the canonical SRS-MD-Rules §23.5
 * token grammar: `key: value` items separated by `; ` (semicolon-space), keys
 * lowercase-and-hyphen. This is the exact grammar parseCompatibilityNotes
 * accepts, so a writer-produced row round-trips through the reader's clean gate.
 * The ISO `checkedAt` value stays within the §23.5 value charset
 * (alphanumerics, hyphen, colon, dot) and survives the parser's first-colon
 * key/value split. All separators are markdown-table safe (no pipe/newline).
 * @req FR-NODE-038
 */
function renderPins(selfSha: string, peerSha: string, checkedAt: string): string {
  return `fpv: ${COMPATIBILITY_FPV}; self: ${selfSha}; peer: ${peerSha}; checked-at: ${checkedAt}`;
}

/**
 * Reports whether `record` already holds a `checked_compatible` row referencing
 * `peerId`, used by the per-pair dedup guard.
 * @req FR-NODE-038
 */
function hasCompatibilityRow(record: RequirementRecord, peerId: string): boolean {
  return record.traceLinks.some((link) => link.relation === COMPATIBLE_RELATION && link.reference === peerId);
}

/**
 * Inserts one `checked_compatible` Trace Links row on the compareReqId-minimum
 * block of the (aReqId, bReqId) pair, pinning both endpoints' current
 * semanticSha. Order-independent: the same pair always normalizes to the same
 * min-side block. Rejected when either endpoint is non-existent, discarded, or
 * deprecated, when the min-side block is frozen, or when the pair has already
 * been recorded (dedup).
 * @req FR-NODE-038
 */
export async function addCompatibilityCheck(
  root: ProjectRoot,
  input: AddCompatibilityCheckInput
): Promise<MutationResult> {
  // Self-pair guard: a requirement is trivially compatible with itself, and a
  // self-referential checked_compatible row would pollute the trace graph and
  // break the per-pair dedup invariant (the pair has no distinct min/max side).
  if (input.aReqId === input.bReqId) {
    return mutationFail("USAGE", `Cannot check a requirement for compatibility with itself: ${input.aReqId}`);
  }

  const workspace = await parseWorkspace(root);
  const byId = new Map<string, RequirementRecord>();
  for (const record of workspace.records) byId.set(record.id, record);

  // Endpoint liveness: both endpoints must exist and be neither discarded nor
  // deprecated (AC-4).
  for (const id of [input.aReqId, input.bReqId]) {
    const record = byId.get(id);
    if (!record) return mutationFail("NOT_FOUND", `Requirement not found: ${id}`);
    if (record.status === "discarded") {
      return mutationFail("MUTATION_DENIED", `Cannot check compatibility against a discarded requirement: ${id}`);
    }
    if (record.stability === "deprecated") {
      return mutationFail("MUTATION_DENIED", `Cannot check compatibility against a deprecated requirement: ${id}`);
    }
  }

  // Normalize the pair to its compareReqId-minimum (self) and peer (max) side.
  const [selfId, peerId] =
    compareReqId(input.aReqId, input.bReqId) <= 0 ? [input.aReqId, input.bReqId] : [input.bReqId, input.aReqId];
  const selfRecord = byId.get(selfId) as RequirementRecord;
  const peerRecord = byId.get(peerId) as RequirementRecord;

  // Frozen-block protection: the min-side block must not be frozen (AC-3).
  if (selfRecord.stability === "frozen") {
    return mutationFail("MUTATION_DENIED", `Cannot add a compatibility check to a frozen requirement: ${selfId}`);
  }

  // Dedup: one row per min-max pair (AC-2).
  if (hasCompatibilityRow(selfRecord, peerId)) {
    return mutationFail("MUTATION_DENIED", `Compatibility check already recorded for ${selfId} and ${peerId}`);
  }

  const selfSha = computeSemanticSha(selfRecord);
  const peerSha = computeSemanticSha(peerRecord);
  const checkedAt = new Date().toISOString();

  const traceInput: Parameters<typeof addTraceLink>[1] = {
    id: selfId,
    type: "Requirement",
    reference: peerId,
    relation: COMPATIBLE_RELATION,
    notes: renderPins(selfSha, peerSha, checkedAt)
  };
  if (input.dryRun !== undefined) traceInput.dryRun = input.dryRun;
  return addTraceLink(root, traceInput);
}

// FR-NODE-039 — refresh_compatibility_check and revoke_compatibility_check
// mutations.
//
// These operate on the single normalized `checked_compatible` row that
// FR-NODE-038 placed on the compareReqId-minimum (self) block of a pair. Both
// are order-independent: the pair always normalizes to the same min-side block,
// so the caller may pass the two REQ-IDs in either order. refresh recomputes the
// row's self/peer semanticSha pins (so a content change on either endpoint is
// re-pinned) and replaces the row in place; revoke removes the row entirely.

export interface RefreshCompatibilityCheckInput {
  aReqId: string;
  bReqId: string;
  dryRun?: boolean;
}

export interface RevokeCompatibilityCheckInput {
  aReqId: string;
  bReqId: string;
  dryRun?: boolean;
}

/**
 * Normalizes the (aReqId, bReqId) pair to its compareReqId-minimum (self) and
 * peer (max) side so refresh/revoke target the same min-side block regardless of
 * argument order.
 * @req FR-NODE-039
 */
function normalizePair(aReqId: string, bReqId: string): { selfId: string; peerId: string } {
  return compareReqId(aReqId, bReqId) <= 0
    ? { selfId: aReqId, peerId: bReqId }
    : { selfId: bReqId, peerId: aReqId };
}

/**
 * Returns every `checked_compatible` Trace Links row referencing `peerId` on the
 * loaded self record, so callers can enforce the exactly-one-row invariant before
 * editing.
 * @req FR-NODE-039
 */
function matchingCompatibilityRows(record: RequirementRecord, peerId: string): TraceLink[] {
  return record.traceLinks.filter((link) => link.relation === COMPATIBLE_RELATION && link.reference === peerId);
}

/**
 * Recomputes the self/peer semanticSha pins of the single min-side
 * `checked_compatible` row of the (aReqId, bReqId) pair and replaces that row in
 * place via replaceLine. Order-independent. Returns NOT_FOUND when zero matching
 * rows exist (the pair was never checked) and is rejected when two or more
 * matching rows exist (ambiguous target), leaving the file untouched in both
 * rejection cases.
 * @req FR-NODE-039
 */
export async function refreshCompatibilityCheck(
  root: ProjectRoot,
  input: RefreshCompatibilityCheckInput
): Promise<MutationResult> {
  if (input.aReqId === input.bReqId) {
    return mutationFail("USAGE", `Cannot refresh a compatibility check of a requirement with itself: ${input.aReqId}`);
  }

  const { selfId, peerId } = normalizePair(input.aReqId, input.bReqId);
  const loaded = await loadRecord(root, selfId);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${selfId}`);

  const peerLoaded = await loadRecord(root, peerId);
  if (!peerLoaded) return mutationFail("NOT_FOUND", `Requirement not found: ${peerId}`);

  const rows = matchingCompatibilityRows(loaded.record, peerId);
  if (rows.length === 0) {
    return mutationFail("NOT_FOUND", `No compatibility check recorded for ${selfId} and ${peerId}`);
  }
  if (rows.length > 1) {
    return mutationFail(
      "MUTATION_DENIED",
      `Ambiguous compatibility check for ${selfId} and ${peerId}: ${rows.length} matching rows`
    );
  }

  const row = rows[0] as TraceLink;
  if (row.line === undefined) {
    return mutationFail("MUTATION_DENIED", `Compatibility check row line is unknown for ${selfId} and ${peerId}`);
  }

  const selfSha = computeSemanticSha(loaded.record);
  const peerSha = computeSemanticSha(peerLoaded.record);
  const checkedAt = new Date().toISOString();
  const replacement = `| Requirement | ${peerId} | ${COMPATIBLE_RELATION} | ${renderPins(selfSha, peerSha, checkedAt)} |`;
  const original = loaded.file.lines[row.line - 1];

  const operation: PatchOperation = { type: "replaceLine", line: row.line, replacement };
  if (original !== undefined) operation.original = original;
  const applied = await applyPatchPlan(createPatchPlan(loaded.file, [operation]), { dryRun: input.dryRun ?? false });
  return mutationOk({ id: selfId, reference: peerId, written: applied.written });
}

/**
 * Removes the single min-side `checked_compatible` row of the (aReqId, bReqId)
 * pair via a range replacement (dropping the row line). Order-independent.
 * Returns NOT_FOUND when zero matching rows exist and is rejected when two or
 * more matching rows exist (ambiguous target), leaving the file untouched in both
 * rejection cases.
 * @req FR-NODE-039
 */
export async function revokeCompatibilityCheck(
  root: ProjectRoot,
  input: RevokeCompatibilityCheckInput
): Promise<MutationResult> {
  if (input.aReqId === input.bReqId) {
    return mutationFail("USAGE", `Cannot revoke a compatibility check of a requirement with itself: ${input.aReqId}`);
  }

  const { selfId, peerId } = normalizePair(input.aReqId, input.bReqId);
  const loaded = await loadRecord(root, selfId);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${selfId}`);

  const rows = matchingCompatibilityRows(loaded.record, peerId);
  if (rows.length === 0) {
    return mutationFail("NOT_FOUND", `No compatibility check recorded for ${selfId} and ${peerId}`);
  }
  if (rows.length > 1) {
    return mutationFail(
      "MUTATION_DENIED",
      `Ambiguous compatibility check for ${selfId} and ${peerId}: ${rows.length} matching rows`
    );
  }

  const row = rows[0] as TraceLink;
  if (row.line === undefined) {
    return mutationFail("MUTATION_DENIED", `Compatibility check row line is unknown for ${selfId} and ${peerId}`);
  }

  const operation: PatchOperation = { type: "replaceRange", startLine: row.line, endLine: row.line, lines: [] };
  const applied = await applyPatchPlan(createPatchPlan(loaded.file, [operation]), { dryRun: input.dryRun ?? false });
  return mutationOk({ id: selfId, reference: peerId, written: applied.written });
}
