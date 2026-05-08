import type { Diagnostic, DiagnosticSeverity } from "./types.js";

export function diagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  location: { filePath?: string; line?: number } = {}
): Diagnostic {
  return {
    code,
    severity,
    message,
    ...(location.filePath ? { filePath: location.filePath } : {}),
    ...(typeof location.line === "number" ? { line: location.line } : {})
  };
}

export function splitDiagnostics(diagnostics: Diagnostic[]) {
  return {
    diagnostics,
    errors: diagnostics.filter((item) => item.severity === "error"),
    warnings: diagnostics.filter((item) => item.severity === "warning")
  };
}
