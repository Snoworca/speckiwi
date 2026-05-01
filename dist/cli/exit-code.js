export const exitCodes = {
    success: 0,
    error: 1,
    validation: 2,
    workspaceNotFound: 3,
    invalidArgument: 4,
    applyRejected: 5
};
export function mapCoreResultToExitCode(result) {
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
export function mapErrorCode(code) {
    if (code === "WORKSPACE_NOT_FOUND") {
        return exitCodes.workspaceNotFound;
    }
    if (code === "INVALID_ARGUMENT" ||
        code === "INVALID_OPTION" ||
        code === "INVALID_STORE_PATH" ||
        code === "WORKSPACE_ESCAPE" ||
        code === "PATH_TRAVERSAL" ||
        code === "IMPACT_TARGET_TYPE_NOT_SUPPORTED" ||
        code === "EXPORT_TYPE_NOT_SUPPORTED") {
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
export function validationExitCode(result) {
    if (isResultLike(result) && hasDiagnosticErrors(result.diagnostics)) {
        return exitCodes.validation;
    }
    return mapCoreResultToExitCode(result);
}
export function doctorExitCode(result) {
    if (!isObject(result) || result.ok !== true) {
        return mapCoreResultToExitCode(result);
    }
    const checks = Array.isArray(result.checks) ? result.checks : [];
    return checks.some((check) => isObject(check) && check.status === "error") ? exitCodes.error : exitCodes.success;
}
function hasDiagnosticErrors(diagnostics) {
    return diagnostics.summary.errorCount > 0;
}
function isResultLike(value) {
    return isObject(value) && typeof value.ok === "boolean" && isDiagnosticBag(value.diagnostics);
}
function isCoreError(value) {
    return isObject(value) && typeof value.code === "string";
}
function isDiagnosticBag(value) {
    return (isObject(value) &&
        Array.isArray(value.errors) &&
        Array.isArray(value.warnings) &&
        Array.isArray(value.infos) &&
        isObject(value.summary) &&
        typeof value.summary.errorCount === "number");
}
function isObject(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=exit-code.js.map