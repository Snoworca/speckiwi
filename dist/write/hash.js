import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
export function canonicalJsonHash(value) {
    return `sha256:${sha256(canonicalJson(value))}`;
}
export async function fileSha256(path) {
    return `sha256:${sha256(await readFile(path))}`;
}
export function sha256(input) {
    return createHash("sha256").update(input).digest("hex");
}
export function canonicalJson(value) {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string" || typeof value === "boolean") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? JSON.stringify(Object.is(value, -0) ? 0 : value) : "null";
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
    }
    if (typeof value === "object" && value !== null) {
        const record = value;
        return `{${Object.keys(record)
            .sort()
            .filter((key) => record[key] !== undefined)
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
            .join(",")}}`;
    }
    return "null";
}
//# sourceMappingURL=hash.js.map