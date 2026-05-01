import type { DiagnosticBag } from "../core/dto.js";

export const exitCodes = {
  success: 0,
  error: 1,
  validation: 2,
  workspaceNotFound: 3,
  invalidArgument: 4,
  applyRejected: 5
} as const;

export type CliExitCode = (typeof exitCodes)[keyof typeof exitCodes];

export function mapCoreResultToExitCode(result: unknown): CliExitCode {
  if (!isResultLike(result)) {
    return exitCodes.error;
  }

  if (!result.ok && "error" in result && isCoreError(result.error)) {
    return mapErrorCode(result.error.code);
  }

  if ("valid" in result && result.valid === false) {
    return exitCodes.validation;
  }

  if (hasDiagnosticErrors(result.diagnostics)) {
    return exitCodes.validation;
  }

  return exitCodes.success;
}

export function mapErrorCode(code: string): CliExitCode {
  if (code === "WORKSPACE_NOT_FOUND") {
    return exitCodes.workspaceNotFound;
  }

  if (
    code === "INVALID_ARGUMENT" ||
    code === "INVALID_OPTION" ||
    code === "INVALID_STORE_PATH" ||
    code === "WORKSPACE_ESCAPE" ||
    code === "PATH_TRAVERSAL" ||
    code === "IMPACT_TARGET_TYPE_NOT_SUPPORTED" ||
    code === "EXPORT_TYPE_NOT_SUPPORTED"
  ) {
    return exitCodes.invalidArgument;
  }

  if (code.startsWith("APPLY_") || code.includes("APPLY_REJECTED")) {
    return exitCodes.applyRejected;
  }

  if (code.includes("VALIDATION") || code === "SCHEMA_VALIDATION_FAILED") {
    return exitCodes.validation;
  }

  return exitCodes.error;
}

export function validationExitCode(result: unknown): CliExitCode {
  if (isResultLike(result) && hasDiagnosticErrors(result.diagnostics)) {
    return exitCodes.validation;
  }
  return mapCoreResultToExitCode(result);
}

export function doctorExitCode(result: unknown): CliExitCode {
  if (!isObject(result) || result.ok !== true) {
    return mapCoreResultToExitCode(result);
  }

  const checks = Array.isArray(result.checks) ? result.checks : [];
  return checks.some((check) => isObject(check) && check.status === "error") ? exitCodes.error : exitCodes.success;
}

function hasDiagnosticErrors(diagnostics: DiagnosticBag): boolean {
  return diagnostics.summary.errorCount > 0;
}

function isResultLike(value: unknown): value is { ok: boolean; diagnostics: DiagnosticBag; valid?: boolean; error?: unknown } {
  return isObject(value) && typeof value.ok === "boolean" && isDiagnosticBag(value.diagnostics);
}

function isCoreError(value: unknown): value is { code: string } {
  return isObject(value) && typeof value.code === "string";
}

function isDiagnosticBag(value: unknown): value is DiagnosticBag {
  return (
    isObject(value) &&
    Array.isArray(value.errors) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.infos) &&
    isObject(value.summary) &&
    typeof value.summary.errorCount === "number"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
