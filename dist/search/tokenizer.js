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
const tokenCache = new Map();
const TOKEN_CACHE_LIMIT = 50_000;
export function normalizeExactKey(input) {
    return input.normalize("NFKC").trim().toLowerCase();
}
export function tokenizeSearchText(input) {
    const cached = tokenCache.get(input);
    if (cached !== undefined) {
        return cached;
    }
    const tokens = [];
    const seen = new Set();
    const asciiOnly = isAsciiOnly(input);
    const normalized = splitCamelCase(asciiOnly ? input : input.normalize("NFKC")).toLowerCase();
    if (!asciiOnly && /[\uac00-\ud7a3]/.test(normalized)) {
        for (const token of tokenizeKorean(normalized)) {
            addToken(token, tokens, seen);
        }
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
    rememberTokens(input, tokens);
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
function isAsciiOnly(input) {
    for (let index = 0; index < input.length; index += 1) {
        if (input.charCodeAt(index) > 0x7f) {
            return false;
        }
    }
    return true;
}
function addToken(token, tokens, seen) {
    if (token.length > 0 && !seen.has(token)) {
        seen.add(token);
        tokens.push(token);
    }
}
function rememberTokens(input, tokens) {
    if (tokenCache.size >= TOKEN_CACHE_LIMIT) {
        tokenCache.clear();
    }
    tokenCache.set(input, tokens);
}
//# sourceMappingURL=tokenizer.js.map