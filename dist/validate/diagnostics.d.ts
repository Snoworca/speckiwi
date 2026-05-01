import type { Diagnostic, DiagnosticBag, JsonObject } from "../core/dto.js";
export declare function diagnostic(input: {
    code: string;
    message: string;
    severity?: Diagnostic["severity"];
    path?: string;
    details?: JsonObject;
}): Diagnostic;
export declare function mergeDiagnosticBags(...bags: DiagnosticBag[]): DiagnosticBag;
export declare function diagnosticsToBag(diagnostics: Diagnostic[]): DiagnosticBag;
export declare function workspacePath(storePath: string): string;
//# sourceMappingURL=diagnostics.d.ts.map