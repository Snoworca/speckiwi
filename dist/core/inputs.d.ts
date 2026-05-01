import type { DocumentType, EntityType, PageInput, ProposalOperation, ProposalTarget, RequirementType, TraceDirection } from "./dto.js";
export type CacheMode = "auto" | "bypass";
export type RootInput = {
    root?: string;
    cacheMode?: CacheMode;
};
export type InitInput = RootInput & {
    projectId?: string;
    projectName?: string;
    language?: string;
    force?: boolean;
};
export type OverviewInput = RootInput;
export type ValidateInput = RootInput;
export type DoctorInput = RootInput;
export type CacheRebuildInput = RootInput;
export type CacheCleanInput = RootInput;
export type ListDocumentsInput = RootInput & PageInput & {
    type?: DocumentType;
    scope?: string;
    status?: string | string[];
};
export type ReadDocumentInput = RootInput & {
    id: string;
    includeRawYaml?: boolean;
    includeParsed?: boolean;
};
export type SearchFilters = {
    entityType?: EntityType | EntityType[];
    documentId?: string | string[];
    scope?: string | string[];
    type?: string | string[];
    status?: string | string[];
    tag?: string | string[];
    path?: string | string[];
};
export type SearchInput = RootInput & PageInput & {
    query: string;
    mode?: "auto" | "exact" | "bm25";
    filters?: SearchFilters;
};
export type GetRequirementInput = RootInput & {
    id: string;
    includeRelations?: boolean;
    includeDocument?: boolean;
};
export type ListRequirementsInput = RootInput & PageInput & {
    scope?: string | string[];
    type?: string | string[];
    status?: string | string[];
    tag?: string | string[];
    documentId?: string | string[];
    project?: string | string[];
};
export type GenerateRequirementIdInput = RootInput & {
    requirementType: RequirementType;
    scope: string;
    explicitId?: string;
};
export type RequirementCreateInput = RootInput & {
    scope: string;
    type: RequirementType;
    title: string;
    statement: string;
    id?: string;
    priority?: string;
    rationale?: string;
    description?: string;
    acceptanceCriteria?: Record<string, unknown>[];
    tags?: string[];
};
export type TraceRequirementInput = RootInput & {
    id: string;
    direction?: TraceDirection;
    depth?: number;
};
export type GraphInput = RootInput & {
    graphType?: "document" | "scope" | "requirement" | "dependency" | "traceability";
};
export type ImpactInput = RootInput & {
    id: string;
    depth?: number;
    includeDocuments?: boolean;
    includeScopes?: boolean;
};
export type JsonPatchOperation = {
    op: "add";
    path: string;
    value: unknown;
} | {
    op: "replace";
    path: string;
    value: unknown;
} | {
    op: "remove";
    path: string;
};
export type ProposeChangeInput = RootInput & {
    operation: ProposalOperation;
    target: ProposalTarget;
    changes: JsonPatchOperation[];
    reason: string;
};
export type ApplyChangeInput = RootInput & {
    confirm: true;
} & ({
    proposalId: string;
    proposalPath?: never;
    change?: never;
} | {
    proposalId?: never;
    proposalPath: string;
    change?: never;
} | {
    proposalId?: never;
    proposalPath?: never;
    change: ProposeChangeInput;
});
export type ExportMarkdownInput = RootInput & {
    outputRoot?: string;
    type?: string | string[];
    documentId?: string | string[];
    strict?: boolean;
};
//# sourceMappingURL=inputs.d.ts.map