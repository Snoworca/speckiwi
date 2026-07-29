import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import type { MutationResult, ProjectRoot, RequirementStatus } from "../types.js";
import { isRequirementStatus } from "../schema.js";
import { parseRequirementHeading } from "../parser/block-scanner.js";
import { renderHeadingLine } from "../parser/heading-render.js";
import { mutationFail, mutationOk } from "./guards.js";
import { mutationEnvelopeFromPlan, withMutationEnvelope } from "./envelope.js";
import { findMetadataLine, findSectionTableInsertionLine, loadRecordWithWorkspace } from "./internal.js";
import { deriveSuccessorSlot, findIncomingTraceRows } from "./trace-search.js";
import type { RequirementRecord } from "../types.js";
import { syncIndexRollups } from "./sync-index.js";
import { withSrsMutationLock } from "./srs-lock.js";

/**
 * SRS-MD-Rules v1.1.0 §30.3 — `reason` 제공 시 Change Notes row 가 동일 atomic transaction 으로 append.
 * 최대 500 UTF-16 code unit, 제어문자 거부 (CR/LF/TAB 허용) — zod 강제는 mcp/cli 단에서 적용.
 * 본 internal 함수는 type 단계 보장만 부담.
 */
export interface UpdateStatusInput {
  id: string;
  status: RequirementStatus;
  reason?: string;
  confirmDiscardVerified?: boolean;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

/**
 * v5.1 §10 ③F5: DEL (\x7F) is intentionally not rejected. v5/v5.1 leaves it unresolved;
 * matching the JS `.length` (UTF-16 code unit) length budget keeps emojis predictable
 * (a surrogate pair counts as 2 units against MAX_REASON_LENGTH).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
const MAX_REASON_LENGTH = 500;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusChangeLabel(status: RequirementStatus): string {
  return `Status -> ${status}`;
}

/**
 * SRS-MD-Rules §30.1 / §30.2 — a transition to `discarded` applies the strikethrough plus
 * [DISCARDED] heading marker, with the successor slot derived from the rows that point AT this
 * requirement. A transition to any other status removes a [DISCARDED] marker (revival).
 *
 * A status transition says nothing about stability, so a requirement whose Stability is still
 * draft keeps its [DRAFT — pending decision] marker. Rewriting the heading bare would delete it,
 * and §30.2 offers no way back: update_stability writes that marker only on a transition INTO
 * draft, so the heading and the Stability row would disagree permanently.
 */
function buildHeadingMarkerOp(
  file: { lines: readonly string[] },
  headingLine: number,
  nextStatus: RequirementStatus,
  records: readonly RequirementRecord[],
  targetId: string,
  currentStability: string | undefined
): PatchOperation | undefined {
  const original = file.lines[headingLine - 1];
  if (original === undefined) return undefined;
  const parsed = parseRequirementHeading(original);
  if (!parsed) return undefined;
  const { id, title } = parsed;
  let replacement: string;
  if (nextStatus === "discarded") {
    const successorSlot = deriveSuccessorSlot(
      findIncomingTraceRows(records, { type: "Requirement", relation: "supersedes", reference: targetId })
    );
    replacement = renderHeadingLine({
      id,
      title,
      strikethrough: true,
      marker: "DISCARDED",
      ...(successorSlot ?? {})
    });
  } else if (currentStability === "draft") {
    // A status transition says nothing about stability. Rewriting the heading bare here would delete
    // the [DRAFT — pending decision] marker of a requirement that is still draft, leaving the marker
    // and the Stability row disagreeing — and §30.2 gives no way to get the marker back, because
    // update_stability only writes it on a transition INTO draft.
    const successorSlot = deriveSuccessorSlot(
      findIncomingTraceRows(records, { type: "Requirement", relation: "conflicts_with", reference: targetId })
    );
    replacement = renderHeadingLine({ id, title, marker: "DRAFT", ...(successorSlot ?? {}) });
  } else {
    replacement = renderHeadingLine({ id, title });
  }
  if (replacement === original) return undefined;
  return { type: "replaceLine", line: headingLine, original, replacement };
}

export async function updateStatus(root: ProjectRoot, input: UpdateStatusInput): Promise<MutationResult> {
  return withSrsMutationLock(root, { operation: "update_status", dryRun: input.dryRun, ignoreLock: input.ignoreLock, skipLock: input.skipLock }, () => updateStatusUnlocked(root, input));
}

async function updateStatusUnlocked(root: ProjectRoot, input: UpdateStatusInput): Promise<MutationResult> {
  if (!isRequirementStatus(input.status)) return mutationFail("USAGE", `Invalid status: ${input.status}`);
  if (input.reason !== undefined) {
    if (input.reason.length > MAX_REASON_LENGTH) {
      return mutationFail("USAGE", `reason exceeds ${MAX_REASON_LENGTH} UTF-16 code units`);
    }
    if (CONTROL_CHAR_RE.test(input.reason)) {
      return mutationFail("USAGE", "reason contains forbidden control characters (only TAB/LF/CR allowed)");
    }
  }
  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  // FR-NODE-035 — verified-regression EXIT guard: discarding a protected requirement
  // (verified, frozen/stable stability, or implemented-with-evidence) requires an
  // explicit confirmDiscardVerified=true override. Runs before any patch is built so a
  // denied discard leaves the document byte-identical.
  if (input.status === "discarded" && input.confirmDiscardVerified !== true) {
    const record = loaded.record;
    const protectedForDiscard =
      record.status === "verified" ||
      record.stability === "frozen" ||
      record.stability === "stable" ||
      (record.status === "implemented" &&
        record.verificationEvidence.some((row) => row.reference.trim() !== ""));
    if (protectedForDiscard) {
      return mutationFail(
        "MUTATION_DENIED",
        `Cannot discard protected requirement ${input.id} (status=${record.status}, stability=${record.stability ?? "unset"}): set confirmDiscardVerified=true to override this verified-regression guard`
      );
    }
  }
  const nextRecord = { ...loaded.record, status: input.status };
  if (
    input.status === "verified" &&
    !(
      nextRecord.acceptanceCriteria.length > 0 &&
      nextRecord.acceptanceCriteria.every((criterion) => criterion.checked) &&
      nextRecord.verificationEvidence.some((row) => row.reference.trim() !== "")
    )
  ) {
    return mutationFail("MUTATION_DENIED", "Cannot mark verified without checked AC and evidence");
  }
  const statusLine = findMetadataLine(loaded.file, loaded.record, "Status");
  if (!statusLine) return mutationFail("MUTATION_DENIED", "Status metadata row not found");
  const original = loaded.file.lines[statusLine - 1];
  if (original === undefined) return mutationFail("MUTATION_DENIED", "Status metadata row is outside file");
  const operations: PatchOperation[] = [];
  const headingOp = buildHeadingMarkerOp(
    loaded.file,
    loaded.record.headingLine,
    input.status,
    loaded.records,
    input.id,
    loaded.record.stability
  );
  if (headingOp) operations.push(headingOp);
  operations.push({ type: "replaceLine", line: statusLine, original, replacement: `| Status | ${input.status} |` });
  if (input.reason !== undefined && input.reason.length > 0) {
    const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Change Notes");
    if (!insertLine) {
      return mutationFail("MUTATION_DENIED", "Change Notes section not found for reason append");
    }
    const row = `| ${todayIso()} | ${statusChangeLabel(input.status)} | ${input.reason} |`;
    operations.push({ type: "insertLines", line: insertLine, lines: [row] });
  }
  const plan = createPatchPlan(loaded.file, operations);
  const dryRun = input.dryRun ?? false;
  const applied = await applyPatchPlan(plan, { dryRun });
  const indexSync = applied.written ? await syncIndexRollups(root, { skipLock: true }) : undefined;
  if (indexSync && !indexSync.ok) return indexSync;
  return {
    ...withMutationEnvelope(
    mutationOk({ id: input.id, status: input.status, written: applied.written }),
    mutationEnvelopeFromPlan("update_status", plan, dryRun, applied.written)
    ),
    ...(indexSync?.value ? { indexSync: indexSync.value } : {})
  };
}

// FR-NODE-062 — restore core.
//
// Un-discards a requirement: sets its Status to the requested active status (defaulting to
// planned), removes the heading strikethrough and [DISCARDED] marker, and appends exactly one
// Change Notes row carrying the required reason — all through the hardened updateStatus patch.
// A reason is mandatory (no reason / empty reason returns ok=false and writes nothing).
// Restoring a requirement that still carries checked acceptance criteria or verification
// evidence (i.e. was previously verified) surfaces a stale-AC/evidence advisory warning.

export interface RestoreInput {
  id: string;
  status?: RequirementStatus;
  reason: string;
  dryRun?: boolean;
  ignoreLock?: boolean;
  skipLock?: boolean;
}

export interface RestoreOutput {
  id: string;
  status: RequirementStatus;
  written: boolean;
  warnings: string[];
}

export async function restore(root: ProjectRoot, input: RestoreInput): Promise<MutationResult<RestoreOutput>> {
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    return mutationFail("USAGE", "restore requires a non-empty reason") as MutationResult<RestoreOutput>;
  }
  const status: RequirementStatus = input.status ?? "planned";
  if (status === "discarded") {
    return mutationFail("USAGE", "restore cannot set status to discarded") as MutationResult<RestoreOutput>;
  }

  const loaded = await loadRecordWithWorkspace(root, input.id);
  const warnings: string[] = [];
  if (loaded) {
    const hadChecked = loaded.record.acceptanceCriteria.some((criterion) => criterion.checked);
    const hadEvidence = loaded.record.verificationEvidence.some((row) => row.reference.trim() !== "");
    if (hadChecked || hadEvidence) {
      warnings.push(
        `Restored ${input.id} still carries checked acceptance criteria / verification evidence from before it was discarded; these may be stale — re-verify before marking it verified.`
      );
    }
  }

  const statusInput: UpdateStatusInput = { id: input.id, status, reason: input.reason };
  if (input.dryRun !== undefined) statusInput.dryRun = input.dryRun;
  if (input.ignoreLock !== undefined) statusInput.ignoreLock = input.ignoreLock;
  if (input.skipLock !== undefined) statusInput.skipLock = input.skipLock;
  const result = await updateStatus(root, statusInput);
  if (!result.ok) return result as MutationResult<RestoreOutput>;

  const written = (result.value as { written?: boolean } | undefined)?.written ?? false;
  return { ...result, value: { id: input.id, status, written, warnings } } as MutationResult<RestoreOutput>;
}
