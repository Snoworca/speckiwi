import { getDiagnosticDefinition } from "./diagnostic-registry.js";
import type { Diagnostic, DiagnosticLocation, DiagnosticsSummary, DiagnosticSeverity } from "./types.js";

export function diagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  location: DiagnosticLocation = {}
): Diagnostic {
  const definition = getDiagnosticDefinition(code);
  if (definition.severity !== severity) {
    throw new Error(`Diagnostic severity mismatch for ${code}: registry=${definition.severity} emitted=${severity}`);
  }
  return {
    code,
    severity,
    message,
    ...(location.filePath ? { filePath: location.filePath } : {}),
    ...(typeof location.line === "number" ? { line: location.line } : {}),
    ...(location.requirementId ? { requirementId: location.requirementId } : {})
  };
}

export function summarizeDiagnostics(diagnostics: Diagnostic[]): DiagnosticsSummary {
  const byCode: Record<string, number> = {};
  for (const item of diagnostics) {
    byCode[item.code] = (byCode[item.code] ?? 0) + 1;
  }
  return {
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    byCode
  };
}

export function splitDiagnostics(diagnostics: Diagnostic[]) {
  return {
    diagnostics,
    errors: diagnostics.filter((item) => item.severity === "error"),
    warnings: diagnostics.filter((item) => item.severity === "warning")
  };
}
