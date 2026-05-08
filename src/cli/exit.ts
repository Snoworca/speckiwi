import type { Result } from "../core/result.js";

export function mapResultToExitCode(result: Result<unknown>): number {
  if (result.ok) return 0;
  if (result.error.code.startsWith("SRS-E")) return 1;
  if (result.error.code === "USAGE") return 2;
  if (result.error.code === "IO") return 3;
  if (result.error.code === "PARSE") return 4;
  if (result.error.code === "MUTATION_DENIED" || result.error.code === "NOT_FOUND") return 5;
  if (result.error.code === "MCP_FATAL") return 6;
  return 1;
}
