import type { Diagnostic, DiagnosticBag, JsonObject } from "../core/dto.js";
import { createDiagnosticBag } from "../core/result.js";

export function diagnostic(input: {
  code: string;
  message: string;
  severity?: Diagnostic["severity"];
  path?: string;
  details?: JsonObject;
}): Diagnostic {
  const output: Diagnostic = {
    code: input.code,
    message: input.message,
    severity: input.severity ?? "error"
  };

  if (input.path !== undefined) {
    output.path = input.path;
  }
  if (input.details !== undefined) {
    output.details = input.details;
  }

  return output;
}

export function mergeDiagnosticBags(...bags: DiagnosticBag[]): DiagnosticBag {
  return createDiagnosticBag(bags.flatMap((bag) => [...bag.errors, ...bag.warnings, ...bag.infos]));
}

export function diagnosticsToBag(diagnostics: Diagnostic[]): DiagnosticBag {
  return createDiagnosticBag(diagnostics);
}

export function workspacePath(storePath: string): string {
  return `.speckiwi/${storePath}`;
}
