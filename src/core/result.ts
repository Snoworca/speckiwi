import type { Diagnostic } from "./types.js";

export type Result<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; error: { code: string; message: string; diagnostics?: Diagnostic[] }; diagnostics: Diagnostic[] };

export function ok<T>(value: T, diagnostics: Diagnostic[] = []): Result<T> {
  return { ok: true, value, diagnostics };
}

export function fail(code: string, message: string, diagnostics: Diagnostic[] = []): Result<never> {
  return {
    ok: false,
    error: { code, message, ...(diagnostics.length > 0 ? { diagnostics } : {}) },
    diagnostics
  };
}
