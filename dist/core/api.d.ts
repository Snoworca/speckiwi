import type { ApplyResult, CacheResult, CoreResult, DoctorResult, ExportResult, GraphResult, ImpactResult, InitResult, JsonObject, OverviewResult, ReadDocumentResult, RequirementIdPreviewResult, RequirementListResult, RequirementResult, SearchResultSet, TraceResult, ValidateResult } from "./dto.js";
import type { ApplyChangeInput, CacheCleanInput, CacheMode, CacheRebuildInput, DoctorInput, ExportMarkdownInput, GenerateRequirementIdInput, GraphInput, GetRequirementInput, ImpactInput, InitInput, ListDocumentsInput, ListRequirementsInput, OverviewInput, ProposeChangeInput, ReadDocumentInput, SearchInput, TraceRequirementInput, ValidateInput } from "./inputs.js";
import { listDocuments } from "./documents.js";
import { createProposal } from "./propose-change.js";
import { type RequirementRegistry } from "./requirements.js";
import type { fail } from "./result.js";
export type SpecKiwiCore = {
    root: string;
    cacheMode: CacheMode;
    init(input?: InitInput): Promise<InitResult>;
    doctor(input?: DoctorInput): Promise<DoctorResult>;
    cacheRebuild(input?: CacheRebuildInput): Promise<CacheResult>;
    cacheClean(input?: CacheCleanInput): Promise<CacheResult>;
    exportMarkdown(input?: ExportMarkdownInput): Promise<ExportResult>;
    overview(input?: OverviewInput): Promise<OverviewResult>;
    listDocuments(input?: ListDocumentsInput): ReturnType<typeof listDocuments>;
    readDocument(input: ReadDocumentInput): Promise<ReadDocumentResult>;
    search(input: SearchInput): Promise<SearchResultSet>;
    getRequirement(input: GetRequirementInput): Promise<RequirementResult>;
    listRequirements(input?: ListRequirementsInput): Promise<RequirementListResult>;
    previewRequirementId(input: GenerateRequirementIdInput): Promise<RequirementIdPreviewResult>;
    traceRequirement(input: TraceRequirementInput): Promise<TraceResult>;
    graph(input?: GraphInput): Promise<GraphResult>;
    impact(input: ImpactInput): Promise<ImpactResult>;
    validate(input?: ValidateInput): Promise<ValidateResult>;
    proposeChange(input: ProposeChangeInput): ReturnType<typeof createProposal>;
    applyChange(input: ApplyChangeInput): Promise<ApplyResult>;
    loadRequirementRegistry(): Promise<RequirementRegistry>;
};
export type McpToolResultCore = OverviewResult | ReturnType<typeof fail> | ReadDocumentResult | SearchResultSet | RequirementResult | RequirementListResult | RequirementIdPreviewResult | GraphResult | TraceResult | ImpactResult | ValidateResult | ApplyResult | CacheResult | DoctorResult | InitResult | ExportResult | CoreResult<JsonObject>;
export declare function createSpecKiwiCore(input: {
    root: string;
    cacheMode?: CacheMode;
}): SpecKiwiCore;
//# sourceMappingURL=api.d.ts.map