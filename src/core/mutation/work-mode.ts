import { applyPatchPlan } from "../patch/apply-patch.js";
import { createPatchPlan, type PatchOperation } from "../patch/patch-plan.js";
import { parseStepState } from "../parser/index-parser.js";
import { parseMarkdownTable } from "../parser/table.js";
import { parseWorkspace } from "../parser/workspace-parser.js";
import { mutationFail, mutationOk } from "./guards.js";
import { assertSafeStateCell } from "./table-cell.js";
import type { MutationResult, ProjectRoot, StepStateMode, TextFile } from "../types.js";

// @req FR-NODE-050 @req FR-NODE-071
/**
 * FR-NODE-050 / FR-NODE-071 — work-mode model over docs/spec/steps/state.md.
 *
 * getWorkMode reads the top-of-file work-mode metadata block (the Mode and, for
 * the task-scoped modes vibe and tdd, the Active Task lines above the
 * step-state table) and is fail-open: an absent or invalid state.md (missing
 * file, missing/malformed Mode, or a Mode value outside {sdd, vibe, wait, tdd})
 * yields Mode=wait via parseStepState rather than throwing. setWorkMode
 * persists Mode and, for vibe/tdd, the Active Task name back into that same
 * metadata block.
 */
export interface WorkMode {
  mode: StepStateMode;
  activeTask?: string;
}

export interface SetWorkModeInput {
  mode: StepStateMode;
  activeTask?: string;
  dryRun?: boolean;
}

export interface SetWorkModeValue {
  mode: StepStateMode;
  activeTask?: string;
  written: boolean;
}

// @req FR-NODE-050
/**
 * AC-1 / AC-2 — return the persisted Mode (and, for vibe/tdd, the Active Task)
 * read from the state.md metadata block, falling open to wait when state.md is
 * absent or invalid. parseStepState already encodes the fail-open contract, so an
 * absent stateFile is treated identically to an unparseable one.
 */
export async function getWorkMode(root: ProjectRoot): Promise<WorkMode> {
  const workspace = await parseWorkspace(root);
  const stateFile = workspace.stateFile;
  if (!stateFile) {
    return { mode: "wait" };
  }
  const parsed = parseStepState(stateFile.lines);
  return parsed.activeTask !== undefined && (parsed.mode === "vibe" || parsed.mode === "tdd")
    ? { mode: parsed.mode, activeTask: parsed.activeTask }
    : { mode: parsed.mode };
}

// @req FR-NODE-050
/** The 1-based exclusive end of the work-mode metadata block: the line above the
 * step-state table header, or the whole file when there is no table. */
function metadataEndLine(stateFile: TextFile): number {
  const table = parseMarkdownTable(stateFile.lines, 0, { skipNonTableLeading: true });
  return table ? table.startLine : stateFile.lines.length + 1;
}

// @req FR-NODE-050
/** First line in [1, limit) whose text matches `prefix` (e.g. "Mode:"), or -1. */
function findMetadataField(stateFile: TextFile, limit: number, regex: RegExp): number {
  for (let line = 1; line < limit; line += 1) {
    if (regex.test(stateFile.lines[line - 1] ?? "")) return line;
  }
  return -1;
}

// @req FR-NODE-050
/**
 * AC-3 / AC-4 — persist Mode (and, for vibe/tdd, the Active Task name) into the
 * state.md metadata block. An existing Mode / Active Task line is rewritten in
 * place; a missing one is inserted just above the step-state table header so the
 * block keeps the Mode / Active Task ordering. Active Task is only written for
 * the task-scoped modes vibe and tdd (it is meaningful only there per
 * parseStepState).
 */
export async function setWorkMode(
  root: ProjectRoot,
  input: SetWorkModeInput
): Promise<MutationResult<SetWorkModeValue>> {
  // state.md cells are written verbatim above a pipe-delimited table; reject
  // pipe/newline/control-char injection before any write (FND-003 pattern).
  const modeGuard = assertSafeStateCell<SetWorkModeValue>("mode", input.mode);
  if (modeGuard) return modeGuard;
  if (input.activeTask !== undefined) {
    const activeTaskGuard = assertSafeStateCell<SetWorkModeValue>("activeTask", input.activeTask);
    if (activeTaskGuard) return activeTaskGuard;
  }

  const workspace = await parseWorkspace(root);
  const stateFile = workspace.stateFile;
  if (!stateFile) {
    return mutationFail("NOT_FOUND", "docs/spec/steps/state.md not found");
  }

  const limit = metadataEndLine(stateFile);
  const operations: PatchOperation[] = [];

  const modeLineText = `Mode: ${input.mode}`;
  const modeLine = findMetadataField(stateFile, limit, /^\s*Mode:\s*/);
  if (modeLine >= 1) {
    operations.push({
      type: "replaceLine",
      line: modeLine,
      original: stateFile.lines[modeLine - 1] ?? "",
      replacement: modeLineText
    });
  } else {
    operations.push({ type: "insertLines", line: limit, lines: [modeLineText] });
  }

  if ((input.mode === "vibe" || input.mode === "tdd") && input.activeTask !== undefined) {
    const activeLineText = `Active Task: ${input.activeTask}`;
    const activeLine = findMetadataField(stateFile, limit, /^\s*Active Task:\s*/);
    if (activeLine >= 1) {
      operations.push({
        type: "replaceLine",
        line: activeLine,
        original: stateFile.lines[activeLine - 1] ?? "",
        replacement: activeLineText
      });
    } else {
      operations.push({ type: "insertLines", line: limit, lines: [activeLineText] });
    }
  } else {
    // FND-001: switching to a mode without a task (sdd/wait), or vibe/tdd without an Active Task, must
    // drop any existing Active Task line. Otherwise state.md becomes self-inconsistent (e.g. `Mode: wait`
    // left beside a stale `Active Task: T-OLD`) and the vibe-gate would later evaluate the stale task.
    const activeLine = findMetadataField(stateFile, limit, /^\s*Active Task:\s*/);
    if (activeLine >= 1) {
      operations.push({ type: "replaceRange", startLine: activeLine, endLine: activeLine, lines: [] });
    }
  }

  const plan = createPatchPlan(stateFile, operations);
  const applied = await applyPatchPlan(plan, { dryRun: input.dryRun ?? false });

  const value: SetWorkModeValue = { mode: input.mode, written: applied.written };
  if ((input.mode === "vibe" || input.mode === "tdd") && input.activeTask !== undefined) {
    value.activeTask = input.activeTask;
  }
  return mutationOk<SetWorkModeValue>(value);
}
