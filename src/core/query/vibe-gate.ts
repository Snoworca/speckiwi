import { stat } from "node:fs/promises";
import path from "node:path";
import { getWorkMode } from "../mutation/work-mode.js";
import type { ProjectRoot, StepStateMode } from "../types.js";

// @req FR-MCP-054
/**
 * FR-MCP-054 — the vibe/tdd synthesis-presence gate, extracted from the CLI
 * `vibe-gate check` action (IR-CLI-049/IR-CLI-072) so the CLI and the read-only
 * MCP tool `check_vibe_gate` share one implementation:
 *   - vibe/tdd with an Active Task requires docs/spec/steps/<task>/ to exist;
 *   - tdd additionally requires <task>/design.md (the SDS);
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

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
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
    } else if (workMode.mode === "tdd" && !(await isFile(path.join(stepDir, "design.md")))) {
      // IR-CLI-072 AC-2 — the tdd gate additionally requires the SDS (design.md).
      blockedReason = `Active tdd task '${workMode.activeTask}' has no design.md (SDS)`;
    }
  }
  return {
    mode: workMode.mode,
    ...(workMode.activeTask !== undefined ? { activeTask: workMode.activeTask } : {}),
    blocked: blockedReason !== undefined,
    ...(blockedReason !== undefined ? { blockedReason } : {})
  };
}
