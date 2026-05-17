import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { isCanonicalStability } from "../schema.js";
import { parseRequirementHeading } from "../parser/block-scanner.js";
import { renderHeadingLine } from "../parser/heading-render.js";
import { findMetadataLine, findSectionTableInsertionLine, loadRecordWithWorkspace } from "./internal.js";
import { mutationFail, mutationOk } from "./guards.js";
import { classifyStabilityTransition, type StabilityTransitionWarning } from "./stability-transition.js";
import { deriveSuccessorSlot, findIncomingTraceRows } from "./trace-search.js";
import type { MutationResult, ProjectRoot, RequirementRecord, Stability } from "../types.js";

/**
 * SRS-MD-Rules v1.1.0 §30.2 — `update_stability` mutation 이 `Stability=draft` 로 전이될 때
 * heading 에 [DRAFT — pending decision] 마커가 자동 적용되고, 그 외 stability 전이 시 기존 마커 제거.
 *
 * FR-PARSE-017 AC-1~AC-8 구현. update-status.ts 와 동형.
 *
 * `reason` 정책 (AC-7):
 *  - max 500 UTF-16 code units
 *  - 제어문자 거부 (TAB/LF/CR 만 허용; DEL \x7F 는 v5.1 §10 ③F5 따라 미차단)
 *
 * frozen 전이 (AC-4): `reason` 인자 부재 시 mutation 거부 (FR-PARSE-015 AC-8 Change Notes 의무 강제).
 * verified+draft (AC-3): FR-PARSE-015 AC-7 에 의거 mutation 거부.
 * Warning only (AC-2): skip-forward / rollback / redundant 전이도 mutation 은 적용하되 warnings 반환.
 */
export interface UpdateStabilityInput {
  id: string;
  stability: Stability;
  reason?: string;
  dryRun?: boolean;
}

export interface UpdateStabilityOutput {
  id: string;
  stability: Stability;
  written: boolean;
  warnings: StabilityTransitionWarning[];
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
const MAX_REASON_LENGTH = 500;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function stabilityChangeLabel(stability: Stability): string {
  return `Stability -> ${stability}`;
}

function buildStabilityHeadingOp(
  file: { lines: readonly string[] },
  headingLine: number,
  nextStability: Stability,
  records: readonly RequirementRecord[],
  targetId: string,
  currentStrikethrough: boolean,
  currentMarker: "DISCARDED" | "DRAFT" | undefined
): PatchOperation | undefined {
  const original = file.lines[headingLine - 1];
  if (original === undefined) return undefined;
  const parsed = parseRequirementHeading(original);
  if (!parsed) return undefined;
  const { id, title } = parsed;
  let replacement: string;
  if (nextStability === "draft") {
    const successorSlot = deriveSuccessorSlot(
      findIncomingTraceRows(records, { type: "Requirement", relation: "conflicts_with", reference: targetId })
    );
    replacement = renderHeadingLine({
      id,
      title,
      strikethrough: currentStrikethrough && currentMarker === "DISCARDED",
      marker: currentMarker === "DISCARDED" ? "DISCARDED" : "DRAFT",
      ...(currentMarker === "DISCARDED" ? {} : (successorSlot ?? {}))
    });
  } else if (currentMarker === "DRAFT") {
    replacement = renderHeadingLine({ id, title });
  } else {
    return undefined;
  }
  if (replacement === original) return undefined;
  return { type: "replaceLine", line: headingLine, original, replacement };
}

export async function updateStability(
  root: ProjectRoot,
  input: UpdateStabilityInput
): Promise<MutationResult<UpdateStabilityOutput>> {
  if (!isCanonicalStability(input.stability)) {
    return mutationFail("USAGE", `Invalid stability: ${input.stability}`);
  }
  if (input.reason !== undefined) {
    if (input.reason.length > MAX_REASON_LENGTH) {
      return mutationFail("USAGE", `reason exceeds ${MAX_REASON_LENGTH} UTF-16 code units`);
    }
    if (CONTROL_CHAR_RE.test(input.reason)) {
      return mutationFail("USAGE", "reason contains forbidden control characters (only TAB/LF/CR allowed)");
    }
  }
  if (input.stability === "frozen" && (input.reason === undefined || input.reason.length === 0)) {
    return mutationFail("USAGE", "frozen transition requires reason");
  }
  const loaded = await loadRecordWithWorkspace(root, input.id);
  if (!loaded) return mutationFail("NOT_FOUND", `Requirement not found: ${input.id}`);
  if (loaded.record.status === "verified" && input.stability === "draft") {
    return mutationFail("MUTATION_DENIED", "verified requirement cannot become draft");
  }
  const warning = classifyStabilityTransition(loaded.record.stability, input.stability);
  const warnings: StabilityTransitionWarning[] = warning ? [warning] : [];

  const stabilityLine = findMetadataLine(loaded.file, loaded.record, "Stability");
  if (!stabilityLine) return mutationFail("MUTATION_DENIED", "Stability metadata row not found");
  const original = loaded.file.lines[stabilityLine - 1];
  if (original === undefined) return mutationFail("MUTATION_DENIED", "Stability metadata row is outside file");

  const operations: PatchOperation[] = [];
  const headingParsed = parseRequirementHeading(loaded.file.lines[loaded.record.headingLine - 1] ?? "");
  const headingOp = buildStabilityHeadingOp(
    loaded.file,
    loaded.record.headingLine,
    input.stability,
    loaded.records,
    input.id,
    headingParsed?.strikethrough ?? false,
    headingParsed?.marker
  );
  if (headingOp) operations.push(headingOp);
  operations.push({
    type: "replaceLine",
    line: stabilityLine,
    original,
    replacement: `| Stability | ${input.stability} |`
  });
  if (input.reason !== undefined && input.reason.length > 0) {
    const insertLine = findSectionTableInsertionLine(loaded.file, loaded.record, "Change Notes");
    if (!insertLine) {
      return mutationFail("MUTATION_DENIED", "Change Notes section not found for reason append");
    }
    const row = `| ${todayIso()} | ${stabilityChangeLabel(input.stability)} | ${input.reason} |`;
    operations.push({ type: "insertLines", line: insertLine, lines: [row] });
  }

  const plan = createPatchPlan(loaded.file, operations);
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });
  return mutationOk({ id: input.id, stability: input.stability, written: applied.written, warnings });
}
