import type { JsonPatchOperation } from "../core/inputs.js";
export declare class PatchError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export type ProposedChange = {
    changes: JsonPatchOperation[];
};
export declare function buildPatchOperations(change: ProposedChange): JsonPatchOperation[];
export declare function applyPatch(value: unknown, operations: JsonPatchOperation[]): unknown;
export declare function getJsonPointer(value: unknown, pointer: string): unknown;
export declare function parseJsonPointer(pointer: string, options?: {
    allowRoot?: boolean;
}): string[];
//# sourceMappingURL=patch.d.ts.map