import { z } from "zod";
export declare const overviewInputSchema: z.ZodObject<{
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const listDocumentsInputSchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<{
        overview: "overview";
        prd: "prd";
        srs: "srs";
        technical: "technical";
        adr: "adr";
        rule: "rule";
        dictionary: "dictionary";
    }>>;
    scope: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const readDocumentInputSchema: z.ZodObject<{
    id: z.ZodString;
    includeRawYaml: z.ZodOptional<z.ZodBoolean>;
    includeParsed: z.ZodOptional<z.ZodBoolean>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const searchFiltersSchema: z.ZodObject<{
    entityType: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        adr: "adr";
        rule: "rule";
        document: "document";
        scope: "scope";
        requirement: "requirement";
        prd_item: "prd_item";
        technical_section: "technical_section";
    }>, z.ZodArray<z.ZodEnum<{
        adr: "adr";
        rule: "rule";
        document: "document";
        scope: "scope";
        requirement: "requirement";
        prd_item: "prd_item";
        technical_section: "technical_section";
    }>>]>>;
    documentId: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    scope: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    type: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    status: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    tag: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    path: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
}, z.core.$strict>;
export declare const searchInputSchema: z.ZodObject<{
    query: z.ZodString;
    mode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        exact: "exact";
        bm25: "bm25";
    }>>;
    filters: z.ZodOptional<z.ZodObject<{
        entityType: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            adr: "adr";
            rule: "rule";
            document: "document";
            scope: "scope";
            requirement: "requirement";
            prd_item: "prd_item";
            technical_section: "technical_section";
        }>, z.ZodArray<z.ZodEnum<{
            adr: "adr";
            rule: "rule";
            document: "document";
            scope: "scope";
            requirement: "requirement";
            prd_item: "prd_item";
            technical_section: "technical_section";
        }>>]>>;
        documentId: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        scope: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        type: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        status: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        tag: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        path: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    }, z.core.$strict>>;
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const getRequirementInputSchema: z.ZodObject<{
    id: z.ZodString;
    includeRelations: z.ZodOptional<z.ZodBoolean>;
    includeDocument: z.ZodOptional<z.ZodBoolean>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const listRequirementsInputSchema: z.ZodObject<{
    scope: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    type: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    status: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    tag: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    documentId: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    project: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const generateRequirementIdInputSchema: z.ZodObject<{
    requirementType: z.ZodEnum<{
        data: "data";
        functional: "functional";
        non_functional: "non_functional";
        interface: "interface";
        constraint: "constraint";
        security: "security";
        performance: "performance";
        reliability: "reliability";
        usability: "usability";
        maintainability: "maintainability";
        operational: "operational";
        compliance: "compliance";
        migration: "migration";
        observability: "observability";
    }>;
    scope: z.ZodString;
    explicitId: z.ZodOptional<z.ZodString>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const traceRequirementInputSchema: z.ZodObject<{
    id: z.ZodString;
    direction: z.ZodOptional<z.ZodEnum<{
        upstream: "upstream";
        downstream: "downstream";
        both: "both";
    }>>;
    depth: z.ZodOptional<z.ZodNumber>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const graphInputSchema: z.ZodObject<{
    graphType: z.ZodOptional<z.ZodEnum<{
        document: "document";
        scope: "scope";
        requirement: "requirement";
        dependency: "dependency";
        traceability: "traceability";
    }>>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const impactInputSchema: z.ZodObject<{
    id: z.ZodString;
    depth: z.ZodOptional<z.ZodNumber>;
    includeDocuments: z.ZodOptional<z.ZodBoolean>;
    includeScopes: z.ZodOptional<z.ZodBoolean>;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const validateInputSchema: z.ZodObject<{
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const proposeChangeInputSchema: z.ZodObject<{
    operation: z.ZodEnum<{
        create_requirement: "create_requirement";
        update_requirement: "update_requirement";
        change_requirement_status: "change_requirement_status";
        add_relation: "add_relation";
        remove_relation: "remove_relation";
        update_document: "update_document";
    }>;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"requirement">;
        requirementId: z.ZodOptional<z.ZodString>;
        documentId: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"document">;
        documentId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"manifest">;
    }, z.core.$strict>], "kind">;
    changes: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        op: z.ZodLiteral<"add">;
        path: z.ZodString;
        value: z.ZodUnknown;
    }, z.core.$strict>, z.ZodObject<{
        op: z.ZodLiteral<"replace">;
        path: z.ZodString;
        value: z.ZodUnknown;
    }, z.core.$strict>, z.ZodObject<{
        op: z.ZodLiteral<"remove">;
        path: z.ZodString;
    }, z.core.$strict>], "op">>;
    reason: z.ZodString;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export declare const applyChangeInputSchema: z.ZodObject<{
    proposalId: z.ZodOptional<z.ZodString>;
    proposalPath: z.ZodOptional<z.ZodString>;
    change: z.ZodOptional<z.ZodObject<{
        target: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"requirement">;
            requirementId: z.ZodOptional<z.ZodString>;
            documentId: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"document">;
            documentId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"manifest">;
        }, z.core.$strict>], "kind">;
        operation: z.ZodEnum<{
            create_requirement: "create_requirement";
            update_requirement: "update_requirement";
            change_requirement_status: "change_requirement_status";
            add_relation: "add_relation";
            remove_relation: "remove_relation";
            update_document: "update_document";
        }>;
        changes: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            op: z.ZodLiteral<"add">;
            path: z.ZodString;
            value: z.ZodUnknown;
        }, z.core.$strict>, z.ZodObject<{
            op: z.ZodLiteral<"replace">;
            path: z.ZodString;
            value: z.ZodUnknown;
        }, z.core.$strict>, z.ZodObject<{
            op: z.ZodLiteral<"remove">;
            path: z.ZodString;
        }, z.core.$strict>], "op">>;
        reason: z.ZodString;
    }, z.core.$strict>>;
    confirm: z.ZodBoolean;
    cacheMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        bypass: "bypass";
    }>>;
}, z.core.$strict>;
export type OverviewToolInput = z.infer<typeof overviewInputSchema>;
export type ListDocumentsToolInput = z.infer<typeof listDocumentsInputSchema>;
export type ReadDocumentToolInput = z.infer<typeof readDocumentInputSchema>;
export type SearchToolInput = z.infer<typeof searchInputSchema>;
export type GetRequirementToolInput = z.infer<typeof getRequirementInputSchema>;
export type ListRequirementsToolInput = z.infer<typeof listRequirementsInputSchema>;
export type GenerateRequirementIdToolInput = z.infer<typeof generateRequirementIdInputSchema>;
export type TraceRequirementToolInput = z.infer<typeof traceRequirementInputSchema>;
export type GraphToolInput = z.infer<typeof graphInputSchema>;
export type ImpactToolInput = z.infer<typeof impactInputSchema>;
export type ValidateToolInput = z.infer<typeof validateInputSchema>;
export type ProposeChangeToolInput = z.infer<typeof proposeChangeInputSchema>;
export type ApplyChangeToolInput = z.infer<typeof applyChangeInputSchema>;
//# sourceMappingURL=schemas.d.ts.map