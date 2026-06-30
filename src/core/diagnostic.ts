import { getDiagnosticDefinition } from "./diagnostic-registry.js";
import type { Diagnostic, DiagnosticLocation, DiagnosticsSummary, DiagnosticSeverity } from "./types.js";

export function diagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  location: DiagnosticLocation = {},
  details?: unknown
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
    ...(location.requirementId ? { requirementId: location.requirementId } : {}),
    ...(details !== undefined ? { details } : {})
  };
}

// @req REL-PARSE-002
function diagnosticDedupeKey(item: Diagnostic): string {
  return [item.code, item.filePath ?? "", typeof item.line === "number" ? String(item.line) : "", item.requirementId ?? "", item.message].join("\u0000");
}

// @req REL-PARSE-002
export function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const deduped: Diagnostic[] = [];
  for (const item of diagnostics) {
    const key = diagnosticDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function summarizeDiagnostics(diagnostics: Diagnostic[]): DiagnosticsSummary {
  const byCode: Record<string, number> = {};
  const deduped = dedupeDiagnostics(diagnostics);
  for (const item of deduped) {
    byCode[item.code] = (byCode[item.code] ?? 0) + 1;
  }
  return {
    errors: deduped.filter((item) => item.severity === "error").length,
    warnings: deduped.filter((item) => item.severity === "warning").length,
    byCode
  };
}

export function splitDiagnostics(diagnostics: Diagnostic[]) {
  const deduped = dedupeDiagnostics(diagnostics);
  return {
    diagnostics: deduped,
    errors: deduped.filter((item) => item.severity === "error"),
    warnings: deduped.filter((item) => item.severity === "warning")
  };
}
