import { createDiagnosticBag } from "../core/result.js";
export function diagnostic(input) {
    const output = {
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
export function mergeDiagnosticBags(...bags) {
    return createDiagnosticBag(bags.flatMap((bag) => [...bag.errors, ...bag.warnings, ...bag.infos]));
}
export function diagnosticsToBag(diagnostics) {
    return createDiagnosticBag(diagnostics);
}
export function workspacePath(storePath) {
    return `.speckiwi/${storePath}`;
}
//# sourceMappingURL=diagnostics.js.map