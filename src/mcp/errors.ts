import { summarizeDiagnostics } from "../core/diagnostic.js";
import type { Diagnostic, DiagnosticsSummary } from "../core/types.js";

export interface McpStructuredError {
  code: string;
  message: string;
}

export interface McpRecoveryHint {
  tool: string;
  message?: string;
}

export function toStructuredError(error: { code: string; message: string }): McpStructuredError {
  return { code: error.code, message: error.message };
}

type McpResultLike<T> = {
  ok: boolean;
  value?: T;
  diagnostics?: unknown;
  diagnosticsSummary?: unknown;
  patch?: unknown;
  mutation?: unknown;
  indexSync?: unknown;
  error?: {
    code: string;
    message: string;
    diagnostics?: unknown;
    staleGuard?: unknown;
    lock?: unknown;
  };
};

function isDiagnosticsSummary(value: unknown): value is DiagnosticsSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { errors?: unknown }).errors === "number" &&
    typeof (value as { warnings?: unknown }).warnings === "number" &&
    typeof (value as { byCode?: unknown }).byCode === "object" &&
    (value as { byCode?: unknown }).byCode !== null
  );
}

function diagnosticsFrom(result: McpResultLike<unknown>): Diagnostic[] {
  if (Array.isArray(result.diagnostics)) return result.diagnostics as Diagnostic[];
  if (!result.ok && Array.isArray(result.error?.diagnostics)) return result.error.diagnostics as Diagnostic[];
  return [];
}

function diagnosticsSummaryFrom(result: McpResultLike<unknown>, diagnostics: Diagnostic[]): DiagnosticsSummary {
  return isDiagnosticsSummary(result.diagnosticsSummary) ? result.diagnosticsSummary : summarizeDiagnostics(diagnostics);
}

function diagnosticNextActions(diagnostics: Diagnostic[]): unknown[] {
  return diagnostics
    .map((item) => (typeof item.details === "object" && item.details !== null ? (item.details as { nextAction?: unknown }).nextAction : undefined))
    .filter((item): item is unknown => item !== undefined);
}

function envelopeExtras(result: { patch?: unknown; mutation?: unknown; indexSync?: unknown }): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if ("patch" in result && result.patch !== undefined) extras.patch = result.patch;
  if ("mutation" in result && result.mutation !== undefined) extras.mutation = result.mutation;
  if ("indexSync" in result && result.indexSync !== undefined) extras.indexSync = result.indexSync;
  return extras;
}

export function mcpSuccess<T>(value: T, diagnostics: Diagnostic[] = [], metadata: Record<string, unknown> = {}): unknown {
  return { ok: true, value, diagnostics, diagnosticsSummary: summarizeDiagnostics(diagnostics), ...metadata };
}

export function mcpFailure(
  code: string,
  message: string,
  options: { diagnostics?: Diagnostic[]; recovery?: McpRecoveryHint; metadata?: Record<string, unknown> } = {}
): unknown {
  const diagnostics = options.diagnostics ?? [];
  const nextActions = diagnosticNextActions(diagnostics);
  return {
    ok: false,
    error: { code, message },
    diagnostics,
    diagnosticsSummary: summarizeDiagnostics(diagnostics),
    ...(nextActions.length > 0 ? { nextActions } : {}),
    ...(options.recovery ? { recovery: options.recovery } : {}),
    ...(options.metadata ?? {})
  };
}

export function resultToMcp<T>(result: McpResultLike<T>): unknown {
  const diagnostics = diagnosticsFrom(result);
  const diagnosticsSummary = diagnosticsSummaryFrom(result, diagnostics);
  const extras = envelopeExtras(result);
  if (result.ok) return { ok: true, value: result.value, diagnostics, diagnosticsSummary, ...extras };
  const error = result.error ?? { code: "ERROR", message: "Unknown error" };
  const staleGuard = "staleGuard" in error ? error.staleGuard : undefined;
  const lock = "lock" in error ? error.lock : undefined;
  const nextActions = diagnosticNextActions(diagnostics);
  return {
    ok: false,
    error: { ...toStructuredError(error), ...(lock !== undefined ? { lock } : {}) },
    diagnostics,
    diagnosticsSummary,
    ...(nextActions.length > 0 ? { nextActions } : {}),
    ...(lock !== undefined ? { lock, recovery: { tool: "retry_mutation", message: "Retry after the SRS lock expires or rerun with ignoreLock when deliberately bypassing only the SRS lock." } } : {}),
    ...(staleGuard !== undefined ? { staleGuard, recovery: { tool: "retry_mutation", message: String((staleGuard as { retry?: unknown }).retry ?? "Retry the mutation.") } } : {}),
    ...extras
  };
}
