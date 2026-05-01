import type { CoreError, CoreResult, Diagnostic, DiagnosticBag, ErrorResult, JsonObject, ResultPayload, ValidateResult } from "./dto.js";

export function createDiagnosticBag(diagnostics: Diagnostic[] = []): DiagnosticBag {
  const ordered = [...diagnostics].sort(compareDiagnostics);
  const errors = ordered.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = ordered.filter((diagnostic) => diagnostic.severity === "warning");
  const infos = ordered.filter((diagnostic) => diagnostic.severity === "info");

  return {
    errors,
    warnings,
    infos,
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: infos.length
    }
  };
}

export function emptyDiagnosticBag(): DiagnosticBag {
  return createDiagnosticBag();
}

export function ok<T extends JsonObject>(data: ResultPayload<T>, diagnostics: DiagnosticBag = emptyDiagnosticBag()): CoreResult<T> {
  assertNoReservedResultKeys(data);

  return {
    ...data,
    data,
    ok: true,
    diagnostics
  } as CoreResult<T>;
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    compareOptionalString(left.path, right.path) ||
    compareOptionalNumber(left.line, right.line) ||
    compareOptionalNumber(left.column, right.column) ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}

function compareOptionalString(left: string | undefined, right: string | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  return (left ?? -1) - (right ?? -1);
}

export function fail(error: CoreError, diagnostics: DiagnosticBag = emptyDiagnosticBag()): ErrorResult {
  return {
    ok: false,
    error,
    diagnostics
  };
}

function assertNoReservedResultKeys(data: JsonObject): void {
  for (const key of ["ok", "data", "diagnostics", "error"]) {
    if (Object.hasOwn(data, key)) {
      throw new TypeError(`CoreResult payload cannot contain reserved key: ${key}`);
    }
  }
}

export function validationResult(diagnostics: DiagnosticBag): ValidateResult {
  return {
    ok: diagnostics.summary.errorCount === 0,
    valid: diagnostics.summary.errorCount === 0,
    diagnostics
  };
}
