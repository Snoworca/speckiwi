import { stat } from "node:fs/promises";
import path from "node:path";
import { getWorkMode } from "../mutation/work-mode.js";
import { stepAcceptanceFailure } from "../validator/step-acceptance.js";
import { loadStepDesign, loadStepIntent } from "../validator/validate-scoped.js";
import type { ProjectRoot, StepStateMode } from "../types.js";

// @req FR-MCP-054
/**
 * FR-MCP-054 — the vibe/tdd synthesis-presence gate, extracted from the CLI
 * `vibe-gate check` action (IR-CLI-049/IR-CLI-072) so the CLI and the read-only
 * MCP tool `check_vibe_gate` share one implementation:
 *   - vibe/tdd with an Active Task requires docs/spec/steps/<task>/ to exist;
 *   - tdd additionally requires the step's written acceptance contract — FR-PARSE-042's predicate,
 *     the same one step validation runs;
 *   - wait/sdd (or no Active Task) never block.
 */
export interface VibeGateStatus {
  mode: StepStateMode;
  activeTask?: string;
  blocked: boolean;
  blockedReason?: string;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

// @req FR-MCP-054
export async function evaluateVibeGate(root: ProjectRoot): Promise<VibeGateStatus> {
  const workMode = await getWorkMode(root);
  let blockedReason: string | undefined;
  if ((workMode.mode === "vibe" || workMode.mode === "tdd") && typeof workMode.activeTask === "string") {
    const stepDir = path.join(root.root, "docs", "spec", "steps", workMode.activeTask);
    if (!(await isDirectory(stepDir))) {
      blockedReason = `Active ${workMode.mode} task '${workMode.activeTask}' has no synthesized step directory`;
    } else if (workMode.mode === "tdd") {
      // @req IR-CLI-072 AC-2 @req FR-PARSE-042 AC-5
      const task = workMode.activeTask;
      const failure = stepAcceptanceFailure(await loadStepDesign(root, task), await loadStepIntent(root, task));
      if (failure !== undefined) blockedReason = `Active tdd task '${task}' has no written acceptance contract: ${failure}`;
    }
  }
  return {
    mode: workMode.mode,
    ...(workMode.activeTask !== undefined ? { activeTask: workMode.activeTask } : {}),
    blocked: blockedReason !== undefined,
    ...(blockedReason !== undefined ? { blockedReason } : {})
  };
}
