import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { parseMarkdownTable } from "../parser/table.js";
import { mutationFail, mutationOk } from "./guards.js";
import { assertSafeStateCell } from "./table-cell.js";
import { getWorkMode } from "./work-mode.js";
import { evaluateVibeCompletionGate } from "./internal.js";
import { listDirtyEdges } from "../query/summary.js";
import type { MutationResult, ProjectRoot, StepStateStatus } from "../types.js";

// @req FR-NODE-043
/**
 * FR-NODE-043 — update_step_state mutation.
 *
 * Updates an existing docs/spec/steps/state.md step row in place:
 *   - AC-1: rewrites the Status cell to a value in {active, merging, merged, abandoned}
 *           (an out-of-enum status is rejected and nothing is written);
 *   - AC-2: rewrites the DependsOn cell and refreshes the Updated stamp to today;
 *   - AC-3: targeting a step row that does not exist returns NOT_FOUND and writes nothing.
 */
export interface UpdateStepStateInput {
  step: string;
  status?: string;
  dependsOn?: string;
  /** FR-NODE-078 — explicit override for the merged completion gate (vibe/tdd only). */
  acknowledged?: boolean;
  dryRun?: boolean;
}

export interface UpdateStepStateValue {
  step: string;
  status: string;
  dependsOn: string;
  updated: string;
  written: boolean;
}

// @req FR-NODE-043
/** The Status enum a step row may transition into (FR-PARSE-026 / StepStateStatus). */
const ALLOWED_STATUSES: readonly StepStateStatus[] = ["active", "merging", "merged", "abandoned"];

// @req FR-NODE-043
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// @req FR-NODE-043
/** Split a pipe-delimited table row into its trimmed cells (between the outer pipes). */
function rowCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

export async function updateStepState(
  root: ProjectRoot,
  input: UpdateStepStateInput
): Promise<MutationResult<UpdateStepStateValue>> {
  if (input.status !== undefined && !ALLOWED_STATUSES.includes(input.status as StepStateStatus)) {
    return mutationFail(
      "INVALID_STATUS",
      `Status '${input.status}' must be one of ${ALLOWED_STATUSES.join(", ")}`
    );
  }

  // FND-003: dependsOn is written verbatim into a pipe-delimited row, so reject
  // pipe/newline/control-char injection before any write.
  if (input.dependsOn !== undefined) {
    const dependsOnGuard = assertSafeStateCell<UpdateStepStateValue>("dependsOn", input.dependsOn);
    if (dependsOnGuard) return dependsOnGuard;
  }

  const workspace = await parseWorkspace(root);
  const stateFile = workspace.stateFile;
  if (!stateFile) {
    return mutationFail("NOT_FOUND", "docs/spec/steps/state.md not found");
  }

  // FND-008: identify the target row by the Step column using the shared table
  // parser, which skips the header and separator rows so they can never be
  // mistaken for a step row, and tolerates rows with a differing column count.
  const table = parseMarkdownTable(stateFile.lines, 0, { skipNonTableLeading: true });
  const rowIndex = table?.rows.findIndex((row) => (row.Step ?? "") === input.step) ?? -1;
  if (!table || rowIndex < 0) {
    return mutationFail("NOT_FOUND", `Step '${input.step}' not found in docs/spec/steps/state.md`);
  }
  const rowLine = table.rowLines[rowIndex] ?? -1;
  if (rowLine < 1) {
    return mutationFail("NOT_FOUND", `Step '${input.step}' not found in docs/spec/steps/state.md`);
  }

  // @req FR-NODE-078 — the merged transition is completion-gated in vibe/tdd work-modes:
  // the step's TouchesReq closure must be free of non-clean compatibility edges (or the
  // caller must explicitly acknowledge them). Other work-modes stay unguarded.
  if (input.status === "merged") {
    const workMode = await getWorkMode(root);
    if (workMode.mode === "vibe" || workMode.mode === "tdd") {
      const touches = (table.rows[rowIndex]?.TouchesReq ?? "")
        .split(",")
        .map((token) => token.trim())
        .filter((token) => token !== "" && token !== "-");
      const { edges } = await listDirtyEdges(root);
      const closureEdges = edges.filter((edge) => touches.includes(edge.self) || touches.includes(edge.peer));
      const gate = evaluateVibeCompletionGate({
        vibe: workMode.mode === "vibe",
        tdd: workMode.mode === "tdd",
        stepDirectoryExists: true,
        dirtyEdges: closureEdges,
        acknowledged: input.acknowledged === true
      });
      if (!gate.allowed) {
        const contradictions = closureEdges
          .filter((edge) => edge.classification !== "clean")
          .map((edge) => `${edge.self}~${edge.peer} (${edge.classification})`)
          .join(", ");
        return mutationFail(
          "COMPLETION_GATE_BLOCKED",
          `Step '${input.step}' cannot be merged: unacknowledged non-clean compatibility edges in its TouchesReq closure — ${contradictions}. Re-check compatibility or retry with acknowledged.`
        );
      }
    }
  }

  const original = stateFile.lines[rowLine - 1] ?? "";
  const cells = rowCells(original);
  const stamp = todayIso();
  // Columns: Step, Status, DependsOn, TouchesScope, TouchesReq, Created, Updated.
  const updatedColumn = table.headers.indexOf("Updated");
  if (input.status !== undefined) cells[1] = input.status;
  if (input.dependsOn !== undefined) cells[2] = input.dependsOn;
  if (updatedColumn >= 0) cells[updatedColumn] = stamp;
  const replacement = `| ${cells.join(" | ")} |`;

  const operations: PatchOperation[] = [
    { type: "replaceLine", line: rowLine, original, replacement }
  ];
  const plan = createPatchPlan(stateFile, operations);
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });

  return mutationOk<UpdateStepStateValue>({
    step: input.step,
    status: cells[1] ?? "",
    dependsOn: cells[2] ?? "",
    updated: stamp,
    written: applied.written
  });
}
