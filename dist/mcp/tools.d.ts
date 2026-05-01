import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApplyResult, CacheResult, CoreResult, DoctorResult, GraphResult, ImpactResult, InitResult, JsonObject, MachineResult, OverviewResult, ReadDocumentResult, RequirementIdPreviewResult, RequirementListResult, RequirementResult, SearchResultSet, TraceResult, ValidateResult } from "../core/dto.js";
import type { CacheMode } from "../core/inputs.js";
import { listDocuments } from "../core/documents.js";
import { createProposal } from "../core/propose-change.js";
import { type RequirementRegistry } from "../core/requirements.js";
import { fail } from "../core/result.js";
import { machineResultOutputSchema } from "./structured-content.js";
import { type ApplyChangeToolInput, type GenerateRequirementIdToolInput, type GetRequirementToolInput, type GraphToolInput, type ImpactToolInput, type ListDocumentsToolInput, type ListRequirementsToolInput, type OverviewToolInput, type ProposeChangeToolInput, type ReadDocumentToolInput, type SearchToolInput, type TraceRequirementToolInput, type ValidateToolInput } from "./schemas.js";
export type SpecKiwiCore = {
    root: string;
    cacheMode: CacheMode;
    overview(input?: OverviewToolInput): Promise<OverviewResult>;
    listDocuments(input?: ListDocumentsToolInput): ReturnType<typeof listDocuments>;
    readDocument(input: ReadDocumentToolInput): Promise<ReadDocumentResult>;
    search(input: SearchToolInput): Promise<SearchResultSet>;
    getRequirement(input: GetRequirementToolInput): Promise<RequirementResult>;
    listRequirements(input?: ListRequirementsToolInput): Promise<RequirementListResult>;
    previewRequirementId(input: GenerateRequirementIdToolInput): Promise<RequirementIdPreviewResult>;
    traceRequirement(input: TraceRequirementToolInput): Promise<TraceResult>;
    graph(input?: GraphToolInput): Promise<GraphResult>;
    impact(input: ImpactToolInput): Promise<ImpactResult>;
    validate(input?: ValidateToolInput): Promise<ValidateResult>;
    proposeChange(input: ProposeChangeToolInput): ReturnType<typeof createProposal>;
    applyChange(input: ApplyChangeToolInput): Promise<ApplyResult>;
    loadRequirementRegistry(): Promise<RequirementRegistry>;
};
export type McpToolResultCore = OverviewResult | ReturnType<typeof fail> | ReadDocumentResult | SearchResultSet | RequirementResult | RequirementListResult | RequirementIdPreviewResult | GraphResult | TraceResult | ImpactResult | ValidateResult | ApplyResult | CacheResult | DoctorResult | InitResult | CoreResult<JsonObject>;
export declare function createSpecKiwiCore(input: {
    root: string;
    cacheMode?: CacheMode;
}): SpecKiwiCore;
export declare function registerMcpTools(server: McpServer, core: SpecKiwiCore): void;
export declare function toolResultFromCore<T extends MachineResult>(result: T): CallToolResult;
export declare function toolOutputSchemaFor(name: string): typeof machineResultOutputSchema;
//# sourceMappingURL=tools.d.ts.map