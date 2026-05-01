export declare const searchFieldOrder: readonly ["id", "title", "tags", "scope", "statement", "acceptanceCriteria", "rationale", "description", "body", "path"];
export type SearchFieldName = (typeof searchFieldOrder)[number];
export declare const fieldBoosts: Record<SearchFieldName, number>;
export declare function normalizeExactKey(input: string): string;
export declare function tokenizeSearchText(input: string): string[];
export declare function tokenizeFieldValues(values: readonly string[]): string[];
//# sourceMappingURL=tokenizer.d.ts.map