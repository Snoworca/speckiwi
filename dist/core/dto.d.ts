export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
export type Severity = "error" | "warning" | "info";
export type Diagnostic = {
    code: string;
    message: string;
    severity: Severity;
    path?: string;
    line?: number;
    column?: number;
    details?: JsonObject;
};
export type DiagnosticBag = {
    errors: Diagnostic[];
    warnings: Diagnostic[];
    infos: Diagnostic[];
    summary: {
        errorCount: number;
        warningCount: number;
        infoCount: number;
    };
};
export type CoreError = {
    code: string;
    message: string;
    details?: JsonObject;
};
export type ErrorResult = {
    ok: false;
    diagnostics: DiagnosticBag;
    error: CoreError;
};
export type ReservedResultKey = "ok" | "data" | "diagnostics" | "error";
export type ResultPayload<T extends JsonObject> = Extract<keyof T, ReservedResultKey> extends never ? T : never;
export type CoreResult<T extends JsonObject> = ({
    ok: true;
    data: ResultPayload<T>;
    diagnostics: DiagnosticBag;
} & ResultPayload<T>) | ErrorResult;
export type MachineResult = {
    ok: boolean;
    diagnostics: DiagnosticBag;
    error?: CoreError;
};
export type ValidationOutcome = {
    ok: boolean;
    valid: boolean;
    diagnostics: DiagnosticBag;
};
export type ValidateResult = ValidationOutcome | ErrorResult;
export type PageInput = {
    limit?: number;
    offset?: number;
};
export type PageInfo = {
    limit: number;
    offset: number;
    returned: number;
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
};
export type PerfCounters = {
    cacheHit: boolean;
    parsedFileCount: number;
    artifactHitCount: number;
    fallbackReason?: string;
};
export type DocumentType = "overview" | "prd" | "srs" | "technical" | "adr" | "rule" | "dictionary";
export type ExportableDocumentType = "overview" | "prd" | "srs" | "technical" | "adr";
export type EntityType = "document" | "scope" | "requirement" | "prd_item" | "technical_section" | "adr" | "rule";
export type RequirementRelation = {
    type: string;
    target: string;
    source?: string;
    description?: string;
};
export type RequirementType = "functional" | "non_functional" | "interface" | "data" | "constraint" | "security" | "performance" | "reliability" | "usability" | "maintainability" | "operational" | "compliance" | "migration" | "observability";
export type RequirementSummary = {
    id: string;
    type: string;
    title: string;
    status: string;
    priority?: string;
    statement: string;
    documentId: string;
    scope?: string;
    tags: string[];
    path: string;
};
export type SearchResultItem = {
    entityType: EntityType;
    id: string;
    documentId?: string;
    scope?: string;
    title?: string;
    score: number;
    matchedFields: string[];
    path: string;
};
export type DoctorCheck = {
    id: string;
    title: string;
    status: "ok" | "warning" | "error";
    message?: string;
    diagnostics: Diagnostic[];
};
export type InitResult = CoreResult<{
    created: string[];
    skipped: string[];
}>;
export type OverviewResult = CoreResult<{
    project: {
        id: string;
        name: string;
        language?: string;
    };
    overview: {
        id: string;
        title: string;
        summary?: string;
    };
    stats: {
        documents: number;
        scopes: number;
        requirements: number;
    };
}>;
export type DocumentSummary = {
    id: string;
    type: DocumentType;
    path: string;
    title?: string;
    status?: string;
    scope?: string;
    tags?: string[];
};
export type DocumentListResult = CoreResult<{
    documents: DocumentSummary[];
    page: PageInfo;
}>;
export type ReadDocumentResult = CoreResult<{
    documentId: string;
    path: string;
    rawYaml?: string;
    parsed?: JsonObject;
}>;
export type RequirementResult = CoreResult<{
    requirement: JsonObject;
    document?: DocumentSummary;
    relations?: {
        incoming: RequirementRelation[];
        outgoing: RequirementRelation[];
    };
}>;
export type RequirementListResult = CoreResult<{
    requirements: RequirementSummary[];
    page: PageInfo;
}>;
export type RequirementIdPreviewResult = CoreResult<{
    id: string;
    generated: boolean;
    prefix: string;
    projectSegment: string;
    scopeSegment: string;
    sequence: number;
    formattedSequence: string;
    collisionCount: number;
}>;
export type SearchResultSet = CoreResult<{
    query: string;
    mode: "auto" | "exact" | "bm25";
    results: SearchResultItem[];
    page: PageInfo;
}>;
export type DoctorResult = CoreResult<{
    checks: DoctorCheck[];
}>;
export type CacheResult = CoreResult<{
    operation: "rebuild" | "clean";
    touchedFiles: string[];
    staleBefore?: boolean;
}>;
export type GraphNode = {
    key: string;
    entityType: "document" | "scope" | "requirement";
    id: string;
    title?: string;
    documentId?: string;
    path?: string;
    scope?: string;
    status?: string;
};
export type GraphEdge = {
    key: string;
    source: string;
    target: string;
    relationType: string;
    sourceType: GraphNode["entityType"];
    targetType: GraphNode["entityType"];
    sourceId: string;
    targetId: string;
};
export type GraphResult = CoreResult<{
    graphType: "document" | "scope" | "requirement" | "dependency" | "traceability";
    nodes: GraphNode[];
    edges: GraphEdge[];
}>;
export type TraceDirection = "upstream" | "downstream" | "both";
export type TraceResult = CoreResult<{
    root: string;
    requirementId: string;
    direction: TraceDirection;
    depth: number;
    nodes: GraphNode[];
    edges: GraphEdge[];
}>;
export type ImpactItem = {
    id: string;
    depth: number;
    via: string[];
    relationType: string;
    path?: string;
};
export type ImpactResult = CoreResult<{
    root: string;
    requirementId: string;
    impacted: ImpactItem[];
    nodes: GraphNode[];
    edges: GraphEdge[];
}>;
export type ProposalOperation = "create_requirement" | "update_requirement" | "change_requirement_status" | "add_relation" | "remove_relation" | "update_document";
export type ProposalTarget = {
    kind: "requirement";
    requirementId?: string;
    documentId?: string;
    scope?: string;
} | {
    kind: "document";
    documentId: string;
} | {
    kind: "manifest";
};
export type ProposalSummary = {
    id: string;
    path: string;
    operation: ProposalOperation;
    target: ProposalTarget;
};
export type ProposalResult = CoreResult<{
    mode: "propose";
    applied: false;
    proposal: ProposalSummary;
}>;
export type ApplyResult = CoreResult<{
    mode: "apply";
    applied: true;
    modifiedFiles: string[];
    cacheStale: boolean;
}>;
export type ExportedFile = {
    path: string;
    sourceDocumentId?: string;
    sourcePath?: string;
    sha256?: string;
};
export type SkippedExportFile = {
    sourceDocumentId?: string;
    sourcePath: string;
    reasonCode: string;
    message: string;
};
export type ExportResult = ({
    ok: true;
    diagnostics: DiagnosticBag;
    strict: boolean;
    outputRoot: string;
    writtenFiles: ExportedFile[];
    skippedFiles: SkippedExportFile[];
}) | {
    ok: false;
    strict: true;
    outputRoot: string;
    writtenFiles: [];
    skippedFiles: SkippedExportFile[];
    diagnostics: DiagnosticBag;
} | ErrorResult;
//# sourceMappingURL=dto.d.ts.map