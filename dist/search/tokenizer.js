import { tokenizeKorean } from "./korean.js";
export const searchFieldOrder = [
    "id",
    "title",
    "tags",
    "scope",
    "statement",
    "acceptanceCriteria",
    "rationale",
    "description",
    "body",
    "path"
];
export const fieldBoosts = {
    id: 10,
    title: 6,
    tags: 5,
    scope: 4,
    statement: 3,
    acceptanceCriteria: 2,
    rationale: 1,
    description: 1,
    body: 1,
    path: 1
};
export function normalizeExactKey(input) {
    return input.normalize("NFKC").trim().toLowerCase();
}
export function tokenizeSearchText(input) {
    const tokens = [];
    const seen = new Set();
    const normalized = splitCamelCase(input.normalize("NFKC")).toLowerCase();
    for (const token of tokenizeKorean(normalized)) {
        addToken(token, tokens, seen);
    }
    for (const match of normalized.match(/[a-z0-9][a-z0-9._/-]*/g) ?? []) {
        const codeToken = trimSeparators(match);
        if (codeToken.length === 0) {
            continue;
        }
        addToken(codeToken, tokens, seen);
        const compact = codeToken.replace(/[^a-z0-9]+/g, "");
        if (compact.length > 0 && compact !== codeToken) {
            addToken(compact, tokens, seen);
        }
        for (const part of codeToken.split(/[._/-]+/).filter((item) => item.length > 0)) {
            addToken(part, tokens, seen);
        }
    }
    return tokens;
}
export function tokenizeFieldValues(values) {
    const tokens = [];
    const seen = new Set();
    for (const value of values) {
        for (const token of tokenizeSearchText(value)) {
            addToken(token, tokens, seen);
        }
    }
    return tokens;
}
function splitCamelCase(input) {
    return input
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}
function trimSeparators(input) {
    return input.replace(/^[._/-]+|[._/-]+$/g, "");
}
function addToken(token, tokens, seen) {
    if (token.length > 0 && !seen.has(token)) {
        seen.add(token);
        tokens.push(token);
    }
}
//# sourceMappingURL=tokenizer.js.map