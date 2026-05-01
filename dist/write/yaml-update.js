import { stringify } from "yaml";
import { applyPatch } from "./patch.js";
export function applyProposalToDocument(document, proposal) {
    if (document.value === undefined) {
        throw new Error(`Cannot apply proposal to invalid YAML document: ${document.path}`);
    }
    const value = toJsonValue(applyPatch(document.value, proposal.changes));
    return {
        path: document.path,
        value,
        raw: `${stringify(value, { lineWidth: 0 }).trimEnd()}\n`
    };
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
//# sourceMappingURL=yaml-update.js.map