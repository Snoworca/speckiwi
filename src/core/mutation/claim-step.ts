import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseStepState } from "../parser/index-parser.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { computeBlastRadius } from "./records.js";
import { mutationFail, mutationOk } from "./guards.js";
import { assertSafeStateCell } from "./table-cell.js";
import type { MutationResult, ProjectRoot, RequirementRecord, StepStateEntry } from "../types.js";

// @req FR-NODE-042
/**
 * FR-NODE-042 — claim_step mutation with a write-skew two-stage gate.
 *
 * A claim declares the scope and requirements a step touches and appends a row to
 * docs/spec/steps/state.md. Before writing, it screens the claim against the active
 * steps already recorded in state.md using a two-stage intersection gate:
 *   - direct same-REQ intersection → HARD-BLOCK STEP_DIRECT_CONFLICT (force never wins);
 *   - transitive-only intersection (via the depends_on closure from computeBlastRadius)
 *     → SOFT-BLOCK STEP_OVERLAP, which force overrides while pinning an overlaps marker;
 *   - a supersede target whose requirement is verified/frozen → STEP_SUPERSEDE_PROTECTED.
 * When the closure is unavailable the gate degrades to a 1-hop direct hard-block and the
 * transitive stage is treated as advisory (no soft-block).
 */
export interface ClaimStepInput {
  step: string;
  touchesScope: string;
  touchesReq: string[];
  force?: boolean;
  supersede?: string;
  closureUnavailable?: boolean;
  dryRun?: boolean;
}

export interface ClaimStepValue {
  step: string;
  touchesScope: string;
  touchesReq: string[];
  overlaps: string[];
  written: boolean;
}

// @req FR-NODE-042
/** Only steps that are still in flight participate in the intersection gate. */
function isActiveStep(entry: StepStateEntry): boolean {
  return entry.status === "active" || entry.status === "merging";
}

// @req FR-NODE-042
/** Split a TouchesReq cell (comma/space separated) into its requirement ids. */
function parseReqCell(cell: string): string[] {
  return cell
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token !== "" && token !== "-");
}

// @req FR-NODE-042
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// @req FR-NODE-042
/** Resolve a requirement record by id across body and step records. */
function findRecord(records: readonly RequirementRecord[], id: string): RequirementRecord | undefined {
  return records.find((record) => record.id === id);
}

export async function claimStep(root: ProjectRoot, input: ClaimStepInput): Promise<MutationResult<ClaimStepValue>> {
  // FND-003: step / touchesScope / TouchesReq tokens are written verbatim into a
  // pipe-delimited state.md row, so reject pipe/newline/control-char injection
  // before any read or write.
  const stepGuard = assertSafeStateCell<ClaimStepValue>("step", input.step);
  if (stepGuard) return stepGuard;
  const scopeGuard = assertSafeStateCell<ClaimStepValue>("touchesScope", input.touchesScope);
  if (scopeGuard) return scopeGuard;
  for (const req of input.touchesReq) {
    const reqGuard = assertSafeStateCell<ClaimStepValue>("touchesReq", req);
    if (reqGuard) return reqGuard;
  }

  const workspace = await parseWorkspace(root);
  const stateFile = workspace.stateFile;
  if (!stateFile) {
    return mutationFail("NOT_FOUND", "docs/spec/steps/state.md not found");
  }

  const records: readonly RequirementRecord[] = [
    ...workspace.records,
    ...(workspace.stepRecords ?? [])
  ];

  // AC-4: a supersede target that is verified or frozen is protected; refuse and write nothing.
  if (input.supersede !== undefined && input.supersede !== "") {
    const target = findRecord(records, input.supersede);
    if (target && (target.status === "verified" || target.stability === "frozen")) {
      return mutationFail(
        "STEP_SUPERSEDE_PROTECTED",
        `Cannot supersede ${input.supersede}: it is verified or frozen`
      );
    }
  }

  const claimReqs = input.touchesReq.map((req) => req.trim()).filter((req) => req !== "");
  const claimReqSet = new Set(claimReqs);

  // The transitive closure of the claim's requirements via depends_on (2-hop bounded).
  // When the caller signals the closure is unavailable, the closure degrades to the claim
  // requirements themselves so only direct (1-hop) intersections are detected.
  const claimClosure = input.closureUnavailable
    ? new Set(claimReqs)
    : computeBlastRadius(claimReqs, records);

  const activeSteps = parseStepState(stateFile.lines).filter(isActiveStep);

  const transitiveOverlaps: string[] = [];
  for (const active of activeSteps) {
    const activeReqs = parseReqCell(active.touchesReq);
    // Stage 1: direct same-REQ intersection is an unforceable hard-block.
    if (activeReqs.some((req) => claimReqSet.has(req))) {
      return mutationFail(
        "STEP_DIRECT_CONFLICT",
        `Step '${input.step}' directly conflicts with active step '${active.step}' on a shared requirement`
      );
    }
    // Stage 2: transitive-only intersection through the depends_on closure.
    if (activeReqs.some((req) => claimClosure.has(req))) {
      transitiveOverlaps.push(active.step);
    }
  }

  // Stage 2 soft-block: a transitive overlap blocks unless forced. force pins an overlaps marker.
  if (transitiveOverlaps.length > 0 && input.force !== true) {
    return mutationFail(
      "STEP_OVERLAP",
      `Step '${input.step}' transitively overlaps active step(s): ${transitiveOverlaps.join(", ")}`
    );
  }

  const stamp = todayIso();
  const reqCell = claimReqs.length > 0 ? claimReqs.join(", ") : "-";
  const row = `| ${input.step} | active | - | ${input.touchesScope} | ${reqCell} | ${stamp} | ${stamp} |`;
  const operations: PatchOperation[] = [{ type: "appendLines", lines: [row] }];

  // AC-3: when a forced claim proceeds over a transitive overlap, pin an overlaps marker
  // recording the overlapping incumbent step(s) below the table.
  if (transitiveOverlaps.length > 0) {
    operations.push({
      type: "appendLines",
      lines: [`<!-- overlaps: ${input.step} -> ${transitiveOverlaps.join(", ")} -->`]
    });
  }

  const plan = createPatchPlan(stateFile, operations);
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });

  return mutationOk<ClaimStepValue>({
    step: input.step,
    touchesScope: input.touchesScope,
    touchesReq: claimReqs,
    overlaps: transitiveOverlaps,
    written: applied.written
  });
}
