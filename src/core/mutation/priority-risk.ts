import { oneOf } from "../closed-values.js";
import { PRIORITY_LEVELS, RISK_LEVELS } from "../types.js";
import { mutationFail } from "./guards.js";

/**
 * @req FR-NODE-319 AC-1 AC-2 — the refusal of a priority or risk outside its set, one for every tool
 * that writes the cell: add_requirement wrote any value while edit_requirement_fields refused it.
 */
export function priorityRiskRefusal(input: { priority?: string; risk?: string }): ReturnType<typeof mutationFail> | undefined {
  if (input.priority !== undefined && !(PRIORITY_LEVELS as readonly string[]).includes(input.priority)) {
    return mutationFail("USAGE", `unknown priority: ${input.priority}; expected ${oneOf(PRIORITY_LEVELS)}`);
  }
  if (input.risk !== undefined && !(RISK_LEVELS as readonly string[]).includes(input.risk)) {
    return mutationFail("USAGE", `unknown risk: ${input.risk}; expected ${oneOf(RISK_LEVELS)}`);
  }
  return undefined;
}
