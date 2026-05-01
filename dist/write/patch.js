export class PatchError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PatchError";
    }
}
export function buildPatchOperations(change) {
    if (!Array.isArray(change.changes) || change.changes.length === 0) {
        throw new PatchError("INVALID_PATCH", "Proposal changes must contain at least one patch operation.");
    }
    return change.changes.map((operation) => {
        assertPatchOperation(operation);
        return clonePatchOperation(operation);
    });
}
export function applyPatch(value, operations) {
    let document = cloneJson(value);
    for (const operation of operations) {
        document = applyOperation(document, operation);
    }
    return document;
}
export function getJsonPointer(value, pointer) {
    if (pointer === "") {
        return value;
    }
    const tokens = parseJsonPointer(pointer, { allowRoot: false });
    let current = value;
    for (const token of tokens) {
        if (Array.isArray(current)) {
            const index = parseArrayIndex(token, current.length, false);
            current = current[index];
        }
        else if (isRecord(current) && Object.hasOwn(current, token)) {
            current = current[token];
        }
        else {
            throw new PatchError("PATCH_TARGET_NOT_FOUND", `JSON Pointer target does not exist: ${pointer}`);
        }
    }
    return current;
}
export function parseJsonPointer(pointer, options = {}) {
    if (pointer.startsWith("#")) {
        throw new PatchError("INVALID_PATCH_PATH", "URI fragment JSON Pointer form is not supported.");
    }
    if (pointer === "") {
        if (options.allowRoot === true) {
            return [];
        }
        throw new PatchError("INVALID_PATCH_PATH", "Root JSON Pointer replacement is not allowed.");
    }
    if (!pointer.startsWith("/")) {
        throw new PatchError("INVALID_PATCH_PATH", `JSON Pointer must start with '/': ${pointer}`);
    }
    return pointer
        .slice(1)
        .split("/")
        .map((token) => decodePointerToken(token));
}
function assertPatchOperation(operation) {
    if (!isRecord(operation)) {
        throw new PatchError("INVALID_PATCH", "Patch operation must be an object.");
    }
    if (operation.op !== "add" && operation.op !== "replace" && operation.op !== "remove") {
        throw new PatchError("UNSUPPORTED_PATCH_OP", "Only add, replace, and remove are supported.");
    }
    parseJsonPointer(operation.path);
    if (operation.op === "remove") {
        if (Object.keys(operation).some((key) => key !== "op" && key !== "path")) {
            throw new PatchError("INVALID_PATCH", "Remove patch operation cannot contain extra fields.");
        }
        return;
    }
    if (!Object.hasOwn(operation, "value")) {
        throw new PatchError("INVALID_PATCH", `${operation.op} patch operation requires value.`);
    }
}
function clonePatchOperation(operation) {
    if (operation.op === "remove") {
        return { op: "remove", path: operation.path };
    }
    return { op: operation.op, path: operation.path, value: cloneJson(operation.value) };
}
function applyOperation(document, operation) {
    const tokens = parseJsonPointer(operation.path);
    const parentTokens = tokens.slice(0, -1);
    const finalToken = tokens[tokens.length - 1];
    if (finalToken === undefined) {
        throw new PatchError("INVALID_PATCH_PATH", "Root JSON Pointer replacement is not allowed.");
    }
    const parent = getParent(document, parentTokens, operation.path);
    if (Array.isArray(parent)) {
        return applyArrayOperation(document, parent, finalToken, operation);
    }
    if (isRecord(parent)) {
        return applyObjectOperation(document, parent, finalToken, operation);
    }
    throw new PatchError("PATCH_TARGET_NOT_FOUND", `JSON Pointer parent does not exist: ${operation.path}`);
}
function getParent(document, tokens, path) {
    let current = document;
    for (const token of tokens) {
        if (Array.isArray(current)) {
            const index = parseArrayIndex(token, current.length, false);
            current = current[index];
        }
        else if (isRecord(current) && Object.hasOwn(current, token)) {
            current = current[token];
        }
        else {
            throw new PatchError("PATCH_TARGET_NOT_FOUND", `JSON Pointer parent does not exist: ${path}`);
        }
    }
    return current;
}
function applyArrayOperation(document, parent, token, operation) {
    if (operation.op === "add") {
        const index = token === "-" ? parent.length : parseArrayIndex(token, parent.length, true);
        parent.splice(index, 0, cloneJson(operation.value));
        return document;
    }
    const index = parseArrayIndex(token, parent.length, false);
    if (operation.op === "replace") {
        parent[index] = cloneJson(operation.value);
    }
    else {
        parent.splice(index, 1);
    }
    return document;
}
function applyObjectOperation(document, parent, token, operation) {
    if (operation.op === "add") {
        parent[token] = cloneJson(operation.value);
        return document;
    }
    if (!Object.hasOwn(parent, token)) {
        throw new PatchError("PATCH_TARGET_NOT_FOUND", `JSON Pointer target does not exist: ${operation.path}`);
    }
    if (operation.op === "replace") {
        parent[token] = cloneJson(operation.value);
    }
    else {
        delete parent[token];
    }
    return document;
}
function parseArrayIndex(token, length, allowEnd) {
    if (!/^(0|[1-9]\d*)$/.test(token)) {
        throw new PatchError("INVALID_PATCH_PATH", `Invalid array index token: ${token}`);
    }
    const index = Number.parseInt(token, 10);
    const max = allowEnd ? length : length - 1;
    if (index < 0 || index > max) {
        throw new PatchError("PATCH_TARGET_NOT_FOUND", `Array index is out of bounds: ${token}`);
    }
    return index;
}
function decodePointerToken(token) {
    if (/~(?![01])/.test(token)) {
        throw new PatchError("INVALID_PATCH_PATH", `Invalid JSON Pointer escape in token: ${token}`);
    }
    return token.replace(/~1/g, "/").replace(/~0/g, "~");
}
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=patch.js.map