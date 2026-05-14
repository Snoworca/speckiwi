import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import type { MutationResult, ProjectRoot, RequirementStatus } from "../types.js";
import { isRequirementStatus } from "../schema.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findMetadataLine, findSectionTableInsertionLine, loadRecord } from "./internal.js";

/**
 * SRS-MD-Rules v1.1.0 §30.3 — `reason` 제공 시 Change Notes row 가 동일 atomic transaction 으로 append.
 * 최대 500 UTF-16 code unit, 제어문자 거부 (CR/LF/TAB 허용) — zod 강제는 mcp/cli 단에서 적용.
 * 본 internal 함수는 type 단계 보장만 부담.
 */
export interface UpdateStatusInput {
  id: string;
  status: RequirementStatus;
  reason?: string;
  dryRun?: boolean;
}

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
const MAX_REASON_LENGTH = 500;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusChangeLabel(status: RequirementStatus): string {
  return `Status -> ${status}`;
}

export async function updateStatus(root: ProjectRoot, input: UpdateStatusInput): Promise<MutationResult> {
  if (!isRequirementStatus(input.status)) return mutationFail("USAGE", `Invalid status: ${input.status}`);
  if (input.reason !== undefined) {
    if (input.reason.length > MAX_REASON_LENGTH) {
      return mutationFail("USAGE", `reason exceeds ${MAX_REASON_LENGTH} UTF-16 code units`);
    }
    if (CONTROL_CHAR_RE.test(input.reason)) {
      return mutationFail("USAGE", "reason contains forbidden control characters (only TAB/LF/CR allowed)");
    }
  }
  const loaded = await loadRecord(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
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
  const operations: PatchOperation[] = [
    { type: "replaceLine", line: statusLine, original, replacement: `| Status | ${input.status} |` }
  ];
  if (input.reason !== undefined && input.reason.length > 0) {
    const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Change Notes");
    if (!insertLine) {
      return mutationFail("MUTATION_DENIED", "Change Notes section not found for reason append");
    }
    const row = `| ${todayIso()} | ${statusChangeLabel(input.status)} | ${input.reason} |`;
    operations.push({ type: "insertLines", line: insertLine, lines: [row] });
  }
  const plan = createPatchPlan(loaded.file, operations);
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });
  return mutationOk({ id: input.id, status: input.status, written: applied.written });
}
