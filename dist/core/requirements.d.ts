import type { DiagnosticBag, DocumentSummary, JsonObject, RequirementIdPreviewResult, RequirementListResult, RequirementRelation, RequirementResult, RequirementSummary } from "./dto.js";
import type { GenerateRequirementIdInput, GetRequirementInput, ListRequirementsInput, RootInput } from "./inputs.js";
import { type LoadedWorkspace } from "../validate/semantic.js";
export type RegisteredDocument = DocumentSummary & {
    index: number;
    value?: JsonObject;
};
export type RegisteredScope = {
    id: string;
    index: number;
    tags: string[];
    name?: string;
    type?: string;
    parent?: string;
    description?: string;
};
export type RegisteredRequirement = RequirementSummary & {
    requirement: JsonObject;
    relations: RequirementRelation[];
};
export type RegisteredDocumentLink = {
    from: string;
    to: string;
    type: string;
    description?: string;
};
export type RequirementRegistry = {
    project: {
        id: string;
        name?: string;
        language?: string;
    };
    documents: RegisteredDocument[];
    scopes: RegisteredScope[];
    documentLinks: RegisteredDocumentLink[];
    requirements: RegisteredRequirement[];
    documentsById: Map<string, RegisteredDocument>;
    documentsByPath: Map<string, RegisteredDocument>;
    scopesById: Map<string, RegisteredScope>;
    requirementsById: Map<string, RegisteredRequirement>;
    incomingRelationsById: Map<string, RequirementRelation[]>;
    outgoingRelationsById: Map<string, RequirementRelation[]>;
};
export declare function loadRequirementRegistry(input?: RootInput): Promise<RequirementRegistry>;
export declare function buildRequirementRegistry(workspace: LoadedWorkspace): RequirementRegistry;
export declare function getRequirement(input: GetRequirementInput): Promise<RequirementResult>;
export declare function getRequirementFromRegistry(input: GetRequirementInput, registry: RequirementRegistry): RequirementResult;
export declare function listRequirements(input?: ListRequirementsInput): Promise<RequirementListResult>;
export declare function listRequirementsFromRegistry(input: ListRequirementsInput, registry: RequirementRegistry): RequirementListResult;
export declare function previewRequirementId(input: GenerateRequirementIdInput, registry: RequirementRegistry): RequirementIdPreviewResult;
export declare function assertExplicitRequirementId(id: string, registry: RequirementRegistry): DiagnosticBag;
export declare function requirementSummary(requirement: RegisteredRequirement): RequirementSummary;
//# sourceMappingURL=requirements.d.ts.map