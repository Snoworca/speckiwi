import type { CoreError, CoreResult, Diagnostic, DiagnosticBag, ErrorResult, JsonObject, ResultPayload, ValidateResult } from "./dto.js";
export declare function createDiagnosticBag(diagnostics?: Diagnostic[]): DiagnosticBag;
export declare function emptyDiagnosticBag(): DiagnosticBag;
export declare function ok<T extends JsonObject>(data: ResultPayload<T>, diagnostics?: DiagnosticBag): CoreResult<T>;
export declare function fail(error: CoreError, diagnostics?: DiagnosticBag): ErrorResult;
export declare function validationResult(diagnostics: DiagnosticBag): ValidateResult;
//# sourceMappingURL=result.d.ts.map