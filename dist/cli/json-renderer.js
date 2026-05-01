export function renderJson(result) {
    return `${stableStringify(toJsonObject(result, new WeakSet()))}\n`;
}
function stableStringify(value) {
    return JSON.stringify(sortJson(value));
}
function sortJson(value) {
    if (Array.isArray(value)) {
        return value.map(sortJson);
    }
    if (value !== null && typeof value === "object") {
        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = sortJson(value[key] ?? null);
        }
        return sorted;
    }
    return value;
}
function toJsonObject(value, seen) {
    const json = toJsonValue(value, seen);
    if (json === null || Array.isArray(json) || typeof json !== "object") {
        throw new TypeError("CLI JSON renderer requires one top-level JSON object.");
    }
    return json;
}
function toJsonValue(value, seen) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError("CLI JSON renderer cannot serialize non-finite numbers.");
        }
        return value;
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) {
            throw new TypeError("CLI JSON renderer cannot serialize cyclic objects.");
        }
        seen.add(value);
        const output = value.map((item) => toJsonValue(item, seen));
        seen.delete(value);
        return output;
    }
    if (typeof value === "object") {
        if (seen.has(value)) {
            throw new TypeError("CLI JSON renderer cannot serialize cyclic objects.");
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError("CLI JSON renderer accepts plain JSON-compatible objects only.");
        }
        seen.add(value);
        const output = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            if (typeof nestedValue === "undefined" || typeof nestedValue === "function" || typeof nestedValue === "symbol") {
                throw new TypeError(`CLI JSON renderer cannot serialize key: ${key}`);
            }
            output[key] = toJsonValue(nestedValue, seen);
        }
        seen.delete(value);
        return output;
    }
    throw new TypeError(`CLI JSON renderer cannot serialize ${typeof value} values.`);
}
//# sourceMappingURL=json-renderer.js.map