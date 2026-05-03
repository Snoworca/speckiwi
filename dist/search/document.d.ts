import type { EntityType } from "../core/dto.js";
import { type RequirementRegistry } from "../core/requirements.js";
import type { LoadedWorkspace } from "../validate/semantic.js";
import type { SearchFieldName } from "./tokenizer.js";
export type SearchDocumentFields = Partial<Record<SearchFieldName, string | string[]>>;
export type SearchDocument = {
    entityType: EntityType;
    id: string;
    path: string;
    fields: SearchDocumentFields;
    filters: {
        entityType: EntityType;
        path: string;
        documentId?: string;
        scope?: string;
        type?: string;
        status?: string;
        tags: string[];
    };
    documentId?: string;
    scope?: string;
    title?: string;
};
export type DictionaryExpansion = {
    groups: string[][];
};
export type ValidWorkspace = LoadedWorkspace;
export declare function flattenWorkspace(workspace: ValidWorkspace, registry?: RequirementRegistry): SearchDocument[];
export declare function buildDictionaryExpansion(workspace: ValidWorkspace): DictionaryExpansion;
//# sourceMappingURL=document.d.ts.map