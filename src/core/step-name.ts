// @req FR-NODE-080 FR-PARSE-033
/**
 * Shared step/task name guard. Lives in its own dependency-free module so both the
 * mutation layer (scaffold-step, set-sds-status) and the validator (loadStepDesign)
 * can use it without creating the validate-scoped -> scaffold-step -> templates ->
 * validate-scoped import cycle.
 */

/** A step/task name is a single path segment: no separators, traversal, or empties. */
export function isSafeTaskName(task: string): boolean {
  return task.trim().length > 0 && !/[\\/]/.test(task) && task !== "." && task !== "..";
}
