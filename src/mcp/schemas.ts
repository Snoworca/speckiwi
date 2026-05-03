import { z } from "zod";

const cacheModeSchema = z.enum(["auto", "bypass"]);
const documentTypeSchema = z.enum(["overview", "prd", "srs", "technical", "adr", "rule", "dictionary"]);
const entityTypeSchema = z.enum(["document", "scope", "requirement", "prd_item", "technical_section", "adr", "rule"]);
const requirementTypeSchema = z.enum([
  "functional",
  "non_functional",
  "interface",
  "data",
  "constraint",
  "security",
  "performance",
  "reliability",
  "usability",
  "maintainability",
  "operational",
  "compliance",
  "migration",
  "observability"
]);
const graphTypeSchema = z.enum(["document", "scope", "requirement", "dependency", "traceability"]);
const traceDirectionSchema = z.enum(["upstream", "downstream", "both"]);
const stringOrStringArraySchema = z.union([z.string(), z.array(z.string())]);

const searchPageSchema = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional()
};

const listPageSchema = {
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
};

const cacheSchema = {
  cacheMode: cacheModeSchema.optional()
};

const jsonPatchOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("add"),
    path: z.string(),
    value: z.unknown()
  }),
  z.strictObject({
    op: z.literal("replace"),
    path: z.string(),
    value: z.unknown()
  }),
  z.strictObject({
    op: z.literal("remove"),
    path: z.string()
  })
]);

const proposalTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("requirement"),
    requirementId: z.string().optional(),
    documentId: z.string().optional(),
    scope: z.string().optional()
  }),
  z.strictObject({
    kind: z.literal("document"),
    documentId: z.string()
  }),
  z.strictObject({
    kind: z.literal("manifest")
  })
]);

export const overviewInputSchema = z.strictObject({
  ...cacheSchema
});

export const listDocumentsInputSchema = z.strictObject({
  ...cacheSchema,
  ...listPageSchema,
  type: documentTypeSchema.optional(),
  scope: z.string().optional(),
  status: stringOrStringArraySchema.optional()
});

export const readDocumentInputSchema = z.strictObject({
  ...cacheSchema,
  id: z.string(),
  includeRawYaml: z.boolean().optional(),
  includeParsed: z.boolean().optional()
});

export const searchFiltersSchema = z.strictObject({
  entityType: z.union([entityTypeSchema, z.array(entityTypeSchema)]).optional(),
  documentId: stringOrStringArraySchema.optional(),
  scope: stringOrStringArraySchema.optional(),
  type: stringOrStringArraySchema.optional(),
  status: stringOrStringArraySchema.optional(),
  tag: stringOrStringArraySchema.optional(),
  path: stringOrStringArraySchema.optional()
});

export const searchInputSchema = z.strictObject({
  ...cacheSchema,
  ...searchPageSchema,
  query: z.string(),
  mode: z.enum(["auto", "exact", "bm25"]).optional(),
  filters: searchFiltersSchema.optional()
});

export const getRequirementInputSchema = z.strictObject({
  ...cacheSchema,
  id: z.string(),
  includeRelations: z.boolean().optional(),
  includeDocument: z.boolean().optional()
});

export const listRequirementsInputSchema = z.strictObject({
  ...cacheSchema,
  ...listPageSchema,
  scope: stringOrStringArraySchema.optional(),
  type: stringOrStringArraySchema.optional(),
  status: stringOrStringArraySchema.optional(),
  tag: stringOrStringArraySchema.optional(),
  documentId: stringOrStringArraySchema.optional(),
  project: stringOrStringArraySchema.optional()
});

export const generateRequirementIdInputSchema = z.strictObject({
  ...cacheSchema,
  requirementType: requirementTypeSchema,
  scope: z.string(),
  explicitId: z.string().optional()
});

export const traceRequirementInputSchema = z.strictObject({
  ...cacheSchema,
  id: z.string(),
  direction: traceDirectionSchema.optional(),
  depth: z.number().int().min(0).max(5).optional()
});

export const graphInputSchema = z.strictObject({
  ...cacheSchema,
  graphType: graphTypeSchema.optional()
});

export const impactInputSchema = z.strictObject({
  ...cacheSchema,
  id: z.string(),
  depth: z.number().int().min(0).max(5).optional(),
  includeDocuments: z.boolean().optional(),
  includeScopes: z.boolean().optional()
});

export const validateInputSchema = z.strictObject({
  ...cacheSchema
});

export const proposeChangeInputSchema = z.strictObject({
  ...cacheSchema,
  operation: z.enum(["create_requirement", "update_requirement", "change_requirement_status", "add_relation", "remove_relation", "update_document"]),
  target: proposalTargetSchema,
  changes: z.array(jsonPatchOperationSchema),
  reason: z.string()
});

export const applyChangeInputSchema = z.strictObject({
  ...cacheSchema,
  proposalId: z.string().optional(),
  proposalPath: z.string().optional(),
  change: proposeChangeInputSchema.omit({ cacheMode: true }).optional(),
  confirm: z.boolean()
}).superRefine((value, ctx) => {
  const sourceCount = [value.proposalId, value.proposalPath, value.change].filter((source) => source !== undefined).length;
  if (sourceCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["proposalId"],
      message: "Exactly one of proposalId, proposalPath, or change is required."
    });
  }
});

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
