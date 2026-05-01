export function createDiagnosticBag(diagnostics = []) {
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
export function emptyDiagnosticBag() {
    return createDiagnosticBag();
}
export function ok(data, diagnostics = emptyDiagnosticBag()) {
    assertNoReservedResultKeys(data);
    return {
        ...data,
        data,
        ok: true,
        diagnostics
    };
}
function compareDiagnostics(left, right) {
    return (compareOptionalString(left.path, right.path) ||
        compareOptionalNumber(left.line, right.line) ||
        compareOptionalNumber(left.column, right.column) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message));
}
function compareOptionalString(left, right) {
    return (left ?? "").localeCompare(right ?? "");
}
function compareOptionalNumber(left, right) {
    return (left ?? -1) - (right ?? -1);
}
export function fail(error, diagnostics = emptyDiagnosticBag()) {
    return {
        ok: false,
        error,
        diagnostics
    };
}
function assertNoReservedResultKeys(data) {
    for (const key of ["ok", "data", "diagnostics", "error"]) {
        if (Object.hasOwn(data, key)) {
            throw new TypeError(`CoreResult payload cannot contain reserved key: ${key}`);
        }
    }
}
export function validationResult(diagnostics) {
    return {
        ok: diagnostics.summary.errorCount === 0,
        valid: diagnostics.summary.errorCount === 0,
        diagnostics
    };
}
//# sourceMappingURL=result.js.map