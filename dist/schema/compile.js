import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createDiagnosticBag } from "../core/result.js";
const schemaFiles = {
    index: "index.schema.json",
    overview: "overview.schema.json",
    dictionary: "dictionary.schema.json",
    srs: "srs.schema.json",
    prd: "prd.schema.json",
    technical: "technical.schema.json",
    adr: "adr.schema.json",
    rule: "rule.schema.json",
    proposal: "proposal.schema.json"
};
let cachedRegistry;
export function compileSchemas() {
    const ajv = new Ajv2020({
        strict: true,
        allErrors: true,
        validateSchema: true,
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
        allowUnionTypes: false,
        allowMatchingProperties: false
    });
    const registry = Object.fromEntries(Object.entries(schemaFiles).map(([kind, fileName]) => {
        const schema = JSON.parse(readFileSync(new URL(`../../schemas/${fileName}`, import.meta.url), "utf8"));
        return [kind, ajv.compile(schema)];
    }));
    return registry;
}
export function validateAgainstSchema(kind, value) {
    return createDiagnosticBag(validateAgainstSchemaDiagnostics(kind, value));
}
export function validateAgainstSchemaDiagnostics(kind, value, path) {
    const validator = getRegistry()[kind];
    const valid = validator(value);
    if (valid) {
        return [];
    }
    return (validator.errors ?? []).map((error) => ajvErrorToDiagnostic(kind, error, path));
}
export function schemaKindFromVersion(schemaVersion) {
    if (typeof schemaVersion !== "string") {
        return undefined;
    }
    const match = /^speckiwi\/([a-z]+)\/v1$/.exec(schemaVersion);
    if (match === null) {
        return undefined;
    }
    const kind = match[1];
    return isSchemaKind(kind) ? kind : undefined;
}
export function isSchemaKind(value) {
    return typeof value === "string" && Object.hasOwn(schemaFiles, value);
}
function getRegistry() {
    cachedRegistry ??= compileSchemas();
    return cachedRegistry;
}
function ajvErrorToDiagnostic(kind, error, path) {
    const code = diagnosticCodeForAjvError(error);
    const instancePath = error.instancePath === "" ? "/" : error.instancePath;
    const details = {
        schema: kind,
        keyword: error.keyword,
        instancePath,
        schemaPath: error.schemaPath,
        params: toJsonValue(error.params)
    };
    const diagnostic = {
        severity: "error",
        code,
        message: messageForAjvError(code, error),
        details
    };
    if (path !== undefined) {
        diagnostic.path = path;
    }
    return diagnostic;
}
function diagnosticCodeForAjvError(error) {
    if (error.keyword === "additionalProperties") {
        return "UNKNOWN_FIELD";
    }
    if (error.instancePath.endsWith("/metadata") && (error.keyword === "type" || error.keyword === "nullable")) {
        return "INVALID_METADATA";
    }
    if (error.keyword === "required") {
        const missingProperty = typeof error.params.missingProperty === "string" ? error.params.missingProperty : "";
        if (missingProperty === "schemaVersion") {
            return "MISSING_SCHEMA_VERSION";
        }
        if (missingProperty === "id") {
            return "MISSING_DOCUMENT_ID";
        }
        if (missingProperty === "path") {
            return "MISSING_DOCUMENT_PATH";
        }
    }
    if ((error.keyword === "const" || error.keyword === "enum") && error.instancePath === "/schemaVersion") {
        return "UNSUPPORTED_SCHEMA_VERSION";
    }
    if ((error.keyword === "const" || error.keyword === "enum") && error.instancePath === "/type") {
        return "DOCUMENT_TYPE_MISMATCH";
    }
    if ((error.keyword === "const" || error.keyword === "enum") && error.instancePath === "/status") {
        return "INVALID_DOCUMENT_STATUS";
    }
    if (error.keyword === "enum" && /\/requirements\/\d+\/type$/.test(error.instancePath)) {
        return "INVALID_REQUIREMENT_TYPE";
    }
    if (error.keyword === "enum" && /\/requirements\/\d+\/status$/.test(error.instancePath)) {
        return "INVALID_REQUIREMENT_STATUS";
    }
    if (error.keyword === "enum" && /\/relations\/\d+\/type$/.test(error.instancePath)) {
        return "INVALID_RELATION_TYPE";
    }
    if ((error.keyword === "const" || error.keyword === "enum") && /\/changes\/\d+\/op$/.test(error.instancePath)) {
        return "UNSUPPORTED_PATCH_OP";
    }
    return "SCHEMA_VALIDATION_FAILED";
}
function messageForAjvError(code, error) {
    if (code === "UNKNOWN_FIELD") {
        const field = typeof error.params.additionalProperty === "string" ? error.params.additionalProperty : "field";
        return `Unknown field is not allowed: ${field}`;
    }
    if (code === "INVALID_METADATA") {
        return "metadata must be an object when present.";
    }
    if (code === "MISSING_SCHEMA_VERSION") {
        return "Missing schemaVersion.";
    }
    if (code === "MISSING_DOCUMENT_ID") {
        return "Missing document id.";
    }
    if (code === "MISSING_DOCUMENT_PATH") {
        return "Missing document path.";
    }
    if (code === "UNSUPPORTED_SCHEMA_VERSION") {
        return "Unsupported schemaVersion.";
    }
    if (code === "DOCUMENT_TYPE_MISMATCH") {
        return "Document type does not match the expected schema.";
    }
    if (code === "INVALID_DOCUMENT_STATUS") {
        return "Document status is not valid for this document type.";
    }
    if (code === "INVALID_REQUIREMENT_TYPE") {
        return "Requirement type is not valid.";
    }
    if (code === "INVALID_REQUIREMENT_STATUS") {
        return "Requirement status is not valid.";
    }
    if (code === "INVALID_RELATION_TYPE") {
        return "Requirement relation type is not valid.";
    }
    if (code === "UNSUPPORTED_PATCH_OP") {
        return "JSON Patch operation is not supported in SpecKiwi v1.";
    }
    return error.message ?? "Schema validation failed.";
}
function toJsonValue(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (Array.isArray(value)) {
        return value.map((item) => toJsonValue(item));
    }
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
    }
    return null;
}
//# sourceMappingURL=compile.js.map