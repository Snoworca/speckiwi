import type { Result } from "../core/result.js";

/**
 * @req IR-CLI-018 — the process exit code of a refused result, by its error code: 1 validation error,
 * 2 usage or argument error, 3 file I/O error, 4 parse fatal error, 5 state or not-found refusal,
 * 6 MCP server fatal error. A code with no row here exits 1.
 *
 * The PRD rows (FR-NODE-240, FR-NODE-241): a malformed cursor argument is an argument error; a
 * missing item answers like a missing file (NOT_FOUND); a finished round refuses a state transition;
 * a ledger line that is not JSON is a parse fatal error of that file; duplicate item IDs are a fault
 * of the PRD or the target that `prd check` and `validate` report, a validation error.
 */
export const CLI_EXIT_CODES: Readonly<Record<string, number>> = Object.freeze({
  VALIDATION: 1,
  USAGE: 2,
  IO: 3,
  PARSE: 4,
  MUTATION_DENIED: 5,
  NOT_FOUND: 5,
  TARGET_NOT_FOUND: 5,
  MCP_FATAL: 6,
  PRD_ITEM_NOT_FOUND: 5,
  PRD_CURSOR_INDEX_OUT_OF_RANGE: 2,
  PRD_CURSOR_VERDICT_INVALID: 2,
  PRD_CURSOR_VERDICT_REQUIRED: 2,
  PRD_CURSOR_DEFER_REASON_REQUIRED: 2,
  PRD_CURSOR_RUN_ID_INVALID: 2,
  PRD_CURSOR_POINTER_INVALID: 2,
  PRD_CURSOR_DONE: 5,
  PRD_LEDGER_CORRUPT: 4,
  PRD_CURSOR_DUPLICATE_ITEM: 1
});

/**
 * @req FR-NODE-137 — the `orchestrate` namespace's own table (05 §10.6): 0 success, 1 an operational
 * error, 2 a gate refusal whose payload names a `GateId`. A usage error a verb detects itself is an
 * operational error there, at 1 — IR-CLI-114 AC-1 and FR-NODE-247 AC-1 fix that exit for a wrong
 * selector — so exit 2 keeps meaning one thing in that namespace. A read verb whose report holds an
 * error finding exits 1 with the report (FR-NODE-246 AC-1). Commander's own argument errors are mapped
 * by the CLI entry for every namespace alike.
 */
export const ORCHESTRATE_EXIT_CODES = Object.freeze({
  OK: 0,
  OPERATIONAL_ERROR: 1,
  REPORTED_ERRORS: 1,
  GATE_REFUSAL: 2
});

export function exitCodeFor(code: string): number {
  if (code.startsWith("SRS-E")) return 1;
  return Object.prototype.hasOwnProperty.call(CLI_EXIT_CODES, code) ? (CLI_EXIT_CODES[code] as number) : 1;
}

export function mapResultToExitCode(result: Result<unknown>): number {
  return result.ok ? 0 : exitCodeFor(result.error.code);
}
