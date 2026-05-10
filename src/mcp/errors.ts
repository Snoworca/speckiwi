import type { Result } from "../core/result.js";

export interface McpStructuredError {
  code: string;
  message: string;
}

export function toStructuredError(error: { code: string; message: string }): McpStructuredError {
  return { code: error.code, message: error.message };
}

export function resultToMcp<T>(result: Result<T> | { ok: boolean; value?: T; error?: { code: string; message: string } }): unknown {
  const patch = (result as { patch?: unknown }).patch;
  if (result.ok) return { ok: true, value: result.value, ...(patch ? { patch } : {}) };
  return { ok: false, error: toStructuredError(result.error ?? { code: "ERROR", message: "Unknown error" }) };
}
