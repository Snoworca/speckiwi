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

export function exitCodeFor(code: string): number {
  if (code.startsWith("SRS-E")) return 1;
  return Object.prototype.hasOwnProperty.call(CLI_EXIT_CODES, code) ? (CLI_EXIT_CODES[code] as number) : 1;
}

export function mapResultToExitCode(result: Result<unknown>): number {
  return result.ok ? 0 : exitCodeFor(result.error.code);
}
