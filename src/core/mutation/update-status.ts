import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import type { MutationResult, ProjectRoot, RequirementStatus } from "../types.js";
import { isRequirementStatus } from "../schema.js";
import { parseRequirementHeading } from "../parser/block-scanner.js";
import { renderHeadingLine } from "../parser/heading-render.js";
import { mutationFail, mutationOk } from "./guards.js";
import { findMetadataLine, findSectionTableInsertionLine, loadRecordWithWorkspace } from "./internal.js";
import { deriveSuccessorSlot, findIncomingTraceRows } from "./trace-search.js";
import type { RequirementRecord } from "../types.js";

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

/**
 * SRS-MD-Rules v1.1.0 §30.1 — `discarded` 전이 시 heading 에 마커 자동 적용,
 * 그 외 Status 로 전이 시 기존 [DISCARDED] / [DRAFT] 마커 자동 제거 (부활).
 *
 * §30.2 Draft 마커는 Status enum 이 아닌 Stability field 와 연결되어야 자연스러우나,
 * speckiwi 현재 `update_stability` mutation 미제공 — 본 PR-B 의 update-status 트리거 범위 밖.
 * §30.2 Draft 마커 적용은 future PR (updateStability 또는 update_stability 신설 후).
 * 단 본 update-status 가 부활 (discarded → 그 외) 처리 시 기존 [DRAFT] 마커 가 잔존하면
 * 함께 제거하여 fail-safe (수기 [DRAFT] 정리도 포함).
 *
 * 본 단계 (C2b-β) 는 successor (`→ see Y +N`) 미반영 — successor 추출/적용은
 * 후속 단계 (trace-search + marker inner sub-parser) 에서 추가.
 */
function buildHeadingMarkerOp(
  file: { lines: readonly string[] },
  headingLine: number,
  nextStatus: RequirementStatus,
  records: readonly RequirementRecord[],
  targetId: string
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
  } else {
    replacement = renderHeadingLine({ id, title });
  }
  if (replacement === original) return undefined;
  return { type: "replaceLine", line: headingLine, original, replacement };
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
  const loaded = await loadRecordWithWorkspace(root, input.id);
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
  const operations: PatchOperation[] = [];
  const headingOp = buildHeadingMarkerOp(
    loaded.file,
    loaded.record.headingLine,
    input.status,
    loaded.records,
    input.id
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
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });
  return mutationOk({ id: input.id, status: input.status, written: applied.written });
}
