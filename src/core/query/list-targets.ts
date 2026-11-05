import type { Diagnostic, ParsedWorkspace, TargetEntry, TargetSummary } from "../types.js";
import { summarizeTarget } from "./summary.js";

export interface TargetListing {
  activeTarget: string;
  targets: Array<TargetEntry & { summary: TargetSummary }>;
}

/**
 * Every Target Map row with its target summary. @req IR-MCP-010 AC-1 — `speckiwi targets` and MCP
 * `list_targets` both answer from this one function, so the two cannot list different targets.
 */
export function listTargets(workspace: ParsedWorkspace, diagnostics: Diagnostic[]): TargetListing {
  return {
    activeTarget: workspace.index.activeTarget,
    targets: workspace.index.targets.map((target) => ({ ...target, summary: summarizeTarget(workspace, { target: target.target, diagnostics }) }))
  };
}
