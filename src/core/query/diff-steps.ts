import { parseWorkspace } from "../parser/workspace-parser.js";
import { computeSemanticSha } from "../mutation/records.js";
import type {
  DiffStepsOptions,
  DiffStepsResult,
  ProjectRoot,
  RequirementRecord,
  StepDiffEntry
} from "../types.js";

// FR-NODE-034 — diff_steps four-way classification keyed on semanticSha.

/**
 * Reports whether a body endpoint is protected — the updateStatus EXIT guard
 * surface (FR-NODE-019): status verified, stability frozen or stable, or status
 * implemented with verification evidence. A conflicting change against a
 * protected endpoint is classified CONFLICT-FULL-GUARDED; against an unprotected
 * endpoint, CONFLICT-PARTIAL.
 * @req FR-NODE-034
 */
function isProtectedEndpoint(record: RequirementRecord): boolean {
  const hasEvidence = record.verificationEvidence.some((row) => row.reference.trim() !== "");
  return (
    record.status === "verified" ||
    record.stability === "frozen" ||
    record.stability === "stable" ||
    (record.status === "implemented" && hasEvidence)
  );
}

/**
 * Reports whether a step record represents a contradicting change rather than a
 * clean additive update (design §2.2). A step that discards/replaces the body
 * content is a conflict; any other content change is an in-place UPDATE.
 * @req FR-NODE-034
 */
function isConflictingStep(step: RequirementRecord): boolean {
  return step.status === "discarded";
}

/**
 * Classifies each step requirement against its body counterpart into NEW,
 * UPDATE, CONFLICT-PARTIAL, or CONFLICT-FULL-GUARDED using computeSemanticSha as
 * the equality key. A step whose semanticSha equals its body counterpart is
 * unchanged and is not reported. For draft/evolving same-rank peers the later
 * step wins: when multiple step files touch the same id, the later step (last in
 * the discovery-ordered stepRecords) is the one diffed against the body.
 *
 * The handler performs its own parse from the ProjectRoot rather than accepting a
 * pre-parsed workspace, mirroring listDirtyEdges, so the diff reflects on-disk
 * state.
 * @req FR-NODE-034
 */
export async function diffSteps(root: ProjectRoot, options: DiffStepsOptions = {}): Promise<DiffStepsResult> {
  const workspace = await parseWorkspace(root);

  const bodyById = new Map<string, RequirementRecord>();
  for (const record of workspace.records) bodyById.set(record.id, record);

  // Later step wins for same-rank peers: iterate step records in discovery order
  // (stepFiles are sorted by relative path) so the last occurrence of an id is the
  // later step. An optional stepName narrows the diff to a single step file.
  const stepById = new Map<string, RequirementRecord>();
  for (const step of workspace.stepRecords ?? []) {
    if (options.stepName !== undefined && step.stepName !== options.stepName) continue;
    stepById.set(step.id, step);
  }

  const entries: StepDiffEntry[] = [];
  for (const [id, step] of stepById) {
    const stepSha = computeSemanticSha(step);
    const body = bodyById.get(id);

    if (!body) {
      entries.push({ id, classification: "NEW", stepSha });
      continue;
    }

    const bodySha = computeSemanticSha(body);
    if (stepSha === bodySha) continue;

    if (isConflictingStep(step)) {
      entries.push({
        id,
        classification: isProtectedEndpoint(body) ? "CONFLICT-FULL-GUARDED" : "CONFLICT-PARTIAL",
        stepSha,
        bodySha
      });
      continue;
    }

    entries.push({ id, classification: "UPDATE", stepSha, bodySha });
  }

  return { entries };
}
